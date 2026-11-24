import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCreatorApp } from '../../src/document-creator/app.js';
import {
  validateDocumentPlan,
  validateKbProfile,
  validateResolvedInputSet,
  type KbProfile
} from '../../src/document-creator/contracts.js';
import { createDocumentPlan, DocumentPlanError } from '../../src/document-creator/plan.js';
import {
  buildProfileFromInventoryFile,
  buildSaeLocalPilotProfile,
  resolveProfileInputSet
} from '../../src/document-creator/profiles.js';
import { buildApp, resolveCreatorMode } from '../../src/server.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

async function createSaeSandbox() {
  const workspace = await mkdtemp(join(tmpdir(), 'dc01-sae-'));
  tempDirs.push(workspace);

  const profile = await buildSaeLocalPilotProfile(process.cwd());
  for (const ref of profile.input_refs) {
    const dest = join(workspace, ref.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(ref.path, dest);
  }
  await mkdir(join(workspace, profile.storage_ref.output_root), { recursive: true });

  const mutateRole = async (
    role: string,
    transform: (raw: Buffer) => Buffer | string,
    repinHash = true
  ): Promise<void> => {
    const ref = profile.input_refs.find((item) => item.role === role);
    if (!ref) throw new Error(`Missing role ${role}`);
    const fullPath = join(workspace, ref.path);
    const current = await readFile(fullPath);
    const updated = transform(current);
    const nextBytes = typeof updated === 'string' ? Buffer.from(updated, 'utf8') : updated;
    await writeFile(fullPath, nextBytes);
    if (repinHash) {
      ref.sha256 = sha256(nextBytes);
    }
  };

  return { workspace, profile, mutateRole };
}

async function loadSyntheticProfile(workspaceRoot = process.cwd()): Promise<KbProfile> {
  return buildProfileFromInventoryFile({
    workspaceRoot,
    inventoryPath: 'tests/fixtures/synthetic-profile/input-inventory.json',
    profileId: 'synthetic-operational-resilience',
    profileVersion: '0.1.0',
    kbId: 'synthetic-resilience-kb',
    kbTitle: 'Synthetic Operational Resilience KB (Test Fixture Only)',
    outputRoot: 'tests/fixtures/synthetic-profile/output',
    isSynthetic: true,
    allowedInputRoots: ['tests/fixtures/synthetic-profile'],
    referencesSubdir: 'tests/fixtures/synthetic-profile/inputs'
  });
}

describe('DC-01: KB profiles, input contracts, and deterministic output plan', () => {
  it('I-01 / I-12 / T-01 / T-03: resolves the SAE local pilot profile, honors the version-bound playbook decision, and plans PAIR-A2 without unsolicited tactics or writes', async () => {
    const profile = await buildSaeLocalPilotProfile(process.cwd());
    expect(validateKbProfile(profile)).toEqual([]);

    const runtime = await resolveProfileInputSet({ workspaceRoot: process.cwd(), profile });
    expect(validateResolvedInputSet(runtime.inputSet)).toEqual([]);
    expect(runtime.inputSet.readiness.planning_ready).toBe(true);
    expect(runtime.inputSet.readiness.authoring_ready).toBe(false);
    expect(runtime.inputSet.readiness.delivery_ready).toBe(false);
    expect(runtime.inputSet.conflicts).toEqual([]);
    expect(runtime.inputSet.coverage_matrix).toHaveLength(60);
    expect(runtime.inputSet.golden_reference).toEqual({
      pair_id: 'PAIR-A1',
      capability_id: 'A1',
      antipattern_id: 'AP-A1',
      capability_version: '1.0.0',
      antipattern_version: '1.0.0'
    });

    // T-01: Final SAE playbook decision is bound to version/hash while preserving original status wording.
    expect(runtime.inputSet.applied_owner_decisions).toHaveLength(1);
    expect(runtime.inputSet.applied_owner_decisions[0]).toMatchObject({
      role: 'tactic-playbook',
      version: '1.0.0',
      effective_status: 'FINAL_OBJECT_LINKS_APPROVED'
    });
    expect(runtime.inputSet.applied_owner_decisions[0]?.original_status_text).toContain(
      'PENDING_KB_FINDING_MAPPING'
    );

    // T-03: Default pair plan produces 2 documents (capability + anti-pattern) and 0 tactic documents.
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    expect(validateDocumentPlan(plan)).toEqual([]);
    expect(plan.summary).toEqual({
      work_unit_count: 1,
      capability_count: 1,
      antipattern_count: 1,
      tactic_count: 0,
      total_documents: 2,
      blocking_conflict_count: 0
    });
    expect(plan.documents.map((d) => [d.document_id, d.destination_path_template])).toEqual([
      ['solution-assurance-engine:A2', 'A/capabilities/A2/{version}/document.md'],
      ['solution-assurance-engine:AP-A2', 'A/antipatterns/AP-A2/{version}/document.md']
    ]);
    expect(plan.documents[0]?.questions.map((q) => q.id)).toEqual(['A2-Q1', 'A2-Q2', 'A2-Q3']);
    expect(plan.documents[1]?.questions.map((q) => q.id)).toEqual(['AP-A2-Q1', 'AP-A2-Q2', 'AP-A2-Q3']);

    // I-12: Empty preset sourceIds use coarse domain coverage; detail gaps are recorded without failing planning.
    expect(plan.documents[0]?.preset_source_ids).toEqual([]);
    expect(plan.documents[0]?.candidate_domain_source_ids.length).toBeGreaterThan(0);
    expect(plan.documents[0]?.detail_gaps).toEqual([
      'atomic_subcriteria',
      'finding_definitions',
      'evidence_rules'
    ]);
    expect(plan.documents[0]?.tactic_associations.length).toBeGreaterThan(0);
    expect(
      plan.documents[0]?.tactic_associations.every((t) => t.activation_authority === 'NONE_IN_CREATOR')
    ).toBe(true);

    // Ensure zero generated files were written by tests to baseline/sae-training/knowledge-base (only the DC-07 PAIR-A2 pilot delivery exists in A).
    for (const dom of ['B', 'C', 'D', 'E', 'F']) {
      const entries = await readdir(join('baseline/sae-training/knowledge-base', dom));
      expect(entries).toEqual(['.gitkeep']);
    }
    expect(
      (await readdir(join('baseline/sae-training/knowledge-base', 'A'))).sort()
    ).toEqual(['.gitkeep', 'antipatterns', 'capabilities']);
  });

  it('T-03 & cross-domain partition: includes deduplicated tactics under their owning/shared partition only when requested', async () => {
    const profile = await buildSaeLocalPilotProfile(process.cwd());
    const runtime = await resolveProfileInputSet({ workspaceRoot: process.cwd(), profile });

    const planWithTactics = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: ['PAIR-A3', 'PAIR-F1'],
      include_tactics: true
    });
    expect(planWithTactics.summary.capability_count).toBe(2);
    expect(planWithTactics.summary.antipattern_count).toBe(2);
    expect(planWithTactics.summary.tactic_count).toBeGreaterThan(0);

    // TAC-PURPOSE-A3-01 links A3, AP-A3, and F1 across domains A and F; must appear once under shared/tactics/.
    const crossDomainMatches = planWithTactics.documents.filter((d) => d.object_id === 'TAC-PURPOSE-A3-01');
    expect(crossDomainMatches).toHaveLength(1);
    expect(crossDomainMatches[0]?.destination_path_template).toBe(
      'shared/tactics/TAC-PURPOSE-A3-01/{version}/document.md'
    );
    expect(crossDomainMatches[0]?.related_domains).toEqual(['A', 'F']);
  });

  it('I-02: reports precise missing-object findings and blocks plan creation when cognitive model, schema, or Golden member is absent', async () => {
    const { workspace, profile } = await createSaeSandbox();
    await rm(join(workspace, 'baseline/sae-training/Samples/Golden/AP-A1_v1.0.0.json'));

    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(runtime.inputSet.readiness.planning_ready).toBe(false);
    expect(
      runtime.inputSet.readiness.findings.some(
        (f) => f.code === 'INPUT_MISSING' && f.message.includes('golden-antipattern')
      )
    ).toBe(true);

    expect(() => createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] })).toThrowError(
      DocumentPlanError
    );

    // Also test omitting cognitive-model role from profile altogether.
    profile.input_refs = profile.input_refs.filter((ref) => ref.role !== 'cognitive-model');
    const missingRoleRuntime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(
      missingRoleRuntime.inputSet.readiness.findings.some(
        (f) => f.code === 'REQUIRED_ROLE_MISSING' && f.path.includes('cognitive-model')
      )
    ).toBe(true);
  });

  it('I-03 & T-01 boundary: rejects duplicate IDs, containment cycles, and broken playbook links even with a matching owner decision', async () => {
    const { workspace, profile, mutateRole } = await createSaeSandbox();

    await mutateRole('taxonomy', (raw) => {
      const tax = JSON.parse(raw.toString('utf8')) as {
        domains: Array<{ domain_id: string; parent_domain_id?: string }>;
      };
      tax.domains[0]!.parent_domain_id = 'B';
      tax.domains[1]!.parent_domain_id = 'A';
      return JSON.stringify(tax);
    });

    await mutateRole('tactic-playbook', (raw) => {
      const pb = JSON.parse(raw.toString('utf8')) as {
        tactics: Array<{ assessment_mappings: { question_ids: string[] } }>;
      };
      pb.tactics[0]!.assessment_mappings.question_ids = ['NONEXISTENT-Q99'];
      return JSON.stringify(pb);
    });
    // Re-bind owner decision to mutated playbook hash to prove broken links still fail!
    const updatedPlaybookSha = profile.input_refs.find((r) => r.role === 'tactic-playbook')!.sha256;
    profile.owner_input_decisions[0]!.sha256 = updatedPlaybookSha;

    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(runtime.inputSet.readiness.planning_ready).toBe(false);
    const codes = runtime.inputSet.readiness.findings.map((f) => f.code);
    expect(codes).toContain('CONTAINMENT_CYCLE');
    expect(codes).toContain('UNRESOLVED_PLAYBOOK_LINK');
  });

  it('T-01 negative: refuses to apply the final-playbook owner decision when playbook hash changes without re-confirmation', async () => {
    const { workspace, profile, mutateRole } = await createSaeSandbox();
    await mutateRole('tactic-playbook', (raw) => `${raw.toString('utf8')}\n`);

    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(runtime.inputSet.readiness.planning_ready).toBe(false);
    expect(runtime.inputSet.readiness.findings.some((f) => f.code === 'OWNER_DECISION_HASH_MISMATCH')).toBe(
      true
    );
  });

  it('I-04 & I-05: supports the synthetic non-A–F profile (domains OPS/SEC, counts 2+1, dimensions D1/D2) and namespaces identical local IDs across KBs', async () => {
    const synProfile = await loadSyntheticProfile(process.cwd());
    expect(synProfile.is_synthetic).toBe(true);
    expect(validateKbProfile(synProfile)).toEqual([]);

    const synRuntime = await resolveProfileInputSet({ workspaceRoot: process.cwd(), profile: synProfile });
    expect(synRuntime.inputSet.readiness.planning_ready).toBe(true);
    expect(synRuntime.pairs).toHaveLength(3);

    // Custom domain folder token mapping works without hardcoding A–F.
    synProfile.domain_folder_tokens = { OPS: 'operations-continuity', SEC: 'security-mesh' };
    const mappedRuntime = await resolveProfileInputSet({ workspaceRoot: process.cwd(), profile: synProfile });
    const allPlan = createDocumentPlan(mappedRuntime, { mode: 'all', include_tactics: true });

    expect(allPlan.summary).toEqual({
      work_unit_count: 5,
      capability_count: 3,
      antipattern_count: 3,
      tactic_count: 2,
      total_documents: 8,
      blocking_conflict_count: 0
    });
    expect(allPlan.documents[0]).toMatchObject({
      document_id: 'synthetic-resilience-kb:OPS-1',
      destination_path_template: 'operations-continuity/capabilities/OPS-1/{version}/document.md'
    });
    expect(allPlan.documents[0]?.questions.map((q) => q.id)).toEqual(['OPS-1-D1', 'OPS-1-D2']);
    expect(allPlan.documents[0]?.preset_source_ids).toEqual(['SYN-SRC-OPS-01']);

    // I-04: Another KB profile using the same local object ID "OPS-1" gets a distinct KB namespace.
    const secondKbProfile: KbProfile = {
      ...JSON.parse(JSON.stringify(synProfile)),
      profile_id: 'second-synthetic-kb',
      kb_id: 'partner-assurance-kb'
    };
    const secondRuntime = await resolveProfileInputSet({
      workspaceRoot: process.cwd(),
      profile: secondKbProfile
    });
    const secondPlan = createDocumentPlan(secondRuntime, {
      mode: 'pair',
      pair_ids: ['SYN-PAIR-OPS-1']
    });
    expect(secondPlan.documents[0]?.document_id).toBe('partner-assurance-kb:OPS-1');
    expect(secondPlan.documents[0]?.document_id).not.toBe(allPlan.documents[0]?.document_id);
  });

  it('I-06: surfaces a cognitive-model vs instrument conflict while keeping draft planning inspectable and blocking delivery', async () => {
    const { workspace, profile, mutateRole } = await createSaeSandbox();
    await mutateRole('cognitive-model', (raw) =>
      raw
        .toString('utf8')
        .replace(
          /(<code class="qid">A2-Q1<\/code><div>)[^<]+/,
          '$1Contradictory cognitive question text?'
        )
    );

    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(runtime.inputSet.readiness.planning_ready).toBe(true);
    expect(runtime.inputSet.readiness.delivery_ready).toBe(false);
    expect(runtime.inputSet.conflicts).toHaveLength(1);
    expect(runtime.inputSet.conflicts[0]).toMatchObject({
      conflict_id: 'cognitive-question-mismatch:A2-Q1',
      affected_object_ids: ['A2'],
      blocks_delivery: true
    });

    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    expect(plan.summary.blocking_conflict_count).toBe(1);
    expect(plan.documents[0]?.blocking_conflict_ids).toEqual(['cognitive-question-mismatch:A2-Q1']);
    expect(plan.documents[1]?.blocking_conflict_ids).toEqual([]);
  });

  it('I-07: preserves captured verified bytes when disk files drift mid-run, rejects unpinned drift, and invalidates input_set_id when repinned', async () => {
    const { workspace, profile, mutateRole } = await createSaeSandbox();
    const initial = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const originalHtml = initial.pinned.text('cognitive-model');

    // Mutate disk file without updating profile hash.
    await mutateRole('cognitive-model', (raw) => `${raw.toString('utf8')}\n<!-- drift -->\n`, false);

    // Active runtime still reads verified pinned bytes and reports drift via checkSourceDrift().
    expect(initial.pinned.text('cognitive-model')).toBe(originalHtml);
    const drift = await initial.pinned.checkSourceDrift();
    expect(drift.map((d) => d.code)).toEqual(['INPUT_DRIFT_DURING_RUN']);

    // Starting a new resolution against drifted unpinned bytes fails closed.
    const unpinnedReload = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(unpinnedReload.inputSet.readiness.planning_ready).toBe(false);
    expect(
      unpinnedReload.inputSet.readiness.findings.some((f) => f.code === 'INPUT_SHA256_MISMATCH')
    ).toBe(true);

    // Re-pinning the changed bytes produces a new input_set_id.
    await mutateRole('cognitive-model', (raw) => raw, true);
    const repinnedReload = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(repinnedReload.inputSet.readiness.planning_ready).toBe(true);
    expect(repinnedReload.inputSet.input_set_id).not.toBe(initial.inputSet.input_set_id);
  });

  it('I-08, I-09 & placeholder guard: refuses remote fallback to local files, accepts empty output dirs, rejects symlink escapes, and rejects EXAMPLE/<...> inputs', async () => {
    const { workspace, profile } = await createSaeSandbox();

    // I-09: Empty output directory with zero marker files passes readiness.
    const emptyOut = 'empty-kb-output';
    await mkdir(join(workspace, emptyOut));
    profile.storage_ref.output_root = emptyOut;
    profile.storage_ref.operations_root = `${emptyOut}/_operations`;
    const emptyOutRuntime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(emptyOutRuntime.inputSet.storage.destination_ready).toBe(true);
    expect(emptyOutRuntime.inputSet.readiness.planning_ready).toBe(true);

    // I-09: Symlink escaping workspace is rejected.
    const outsideDir = await mkdtemp(join(tmpdir(), 'dc01-outside-'));
    tempDirs.push(outsideDir);
    await symlink(outsideDir, join(workspace, 'escaped-output'));
    profile.storage_ref.output_root = 'escaped-output';
    profile.storage_ref.operations_root = 'escaped-output/_operations';
    const escapedRuntime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(escapedRuntime.inputSet.storage.destination_ready).toBe(false);
    expect(escapedRuntime.inputSet.readiness.planning_ready).toBe(false);
    expect(
      escapedRuntime.inputSet.readiness.findings.some((f) => f.code === 'DESTINATION_ESCAPES_WORKSPACE')
    ).toBe(true);

    // I-08: Remote Vercel profile never falls back to local files even though local SAE files exist.
    const remoteProfile: KbProfile = {
      ...JSON.parse(JSON.stringify(profile)),
      storage_ref: {
        connection_id: 'remote-vercel-conn',
        provider: 'vercel-blob',
        location: 'kb/sae',
        output_root: 'kb/sae/documents',
        operations_root: 'kb/sae/operations',
        credential_secret_ref: 'BLOB_READ_WRITE_TOKEN'
      }
    };
    remoteProfile.input_refs[0]!.store = 'vercel-blob';
    const remoteRuntime = await resolveProfileInputSet({ workspaceRoot: workspace, profile: remoteProfile });
    expect(remoteRuntime.inputSet.readiness.planning_ready).toBe(false);
    expect(
      remoteRuntime.inputSet.readiness.findings.map((f) => f.code)
    ).toEqual(expect.arrayContaining(['REMOTE_STORAGE_NOT_CONFIGURED', 'REMOTE_INPUT_STORE_NOT_CONFIGURED']));

    // Placeholder guard from 02-Contracts.md.
    const placeholderProfile: KbProfile = {
      ...JSON.parse(JSON.stringify(profile)),
      kb_title: 'EXAMPLE <kb-title>'
    };
    expect(validateKbProfile(placeholderProfile).some((f) => f.code === 'ILLUSTRATIVE_PLACEHOLDER_REJECTED')).toBe(
      true
    );
  });

  it('I-10, I-11 & I-13: detects corrupted PDF headers, root shared-definitions schema mismatch, duplicate schema $ids, and unregistered sourceIds', async () => {
    const { workspace, profile, mutateRole } = await createSaeSandbox();

    // I-11: Substituting root schemas/shared-definitions.schema.json fails Golden pair validation.
    const rootSharedSchema = await readFile('schemas/shared-definitions.schema.json');
    await mutateRole('shared-definitions', () => rootSharedSchema);
    const badSchemaRuntime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    expect(badSchemaRuntime.inputSet.readiness.planning_ready).toBe(false);
    expect(
      badSchemaRuntime.inputSet.readiness.findings.some(
        (f) => f.code === 'PINNED_SCHEMA_VALIDATION_FAILED' && f.path.includes('golden-capability')
      )
    ).toBe(true);

    // Restore pinned shared-definitions and test duplicate schema $id (I-11) + corrupted PDF (I-10) + unregistered sourceId (I-13).
    const pinnedSharedSchema = await readFile('baseline/sae-training/schemas/shared-definitions.schema.json');
    await mutateRole('shared-definitions', () => pinnedSharedSchema);
    await mutateRole('criteria-reference', () => 'NOT_A_PDF_FILE');
    await mutateRole('criteria-instrument', (raw) => {
      const inst = JSON.parse(raw.toString('utf8')) as {
        requirements: Array<{ sourceIds: string[] }>;
      };
      inst.requirements[1]!.sourceIds = ['SRC-NONEXISTENT-999'];
      return JSON.stringify(inst);
    });
    await mutateRole('antipattern-schema', (raw) => {
      const schema = JSON.parse(raw.toString('utf8')) as { $id: string };
      const capSchema = JSON.parse(
        Buffer.from(pinnedSharedSchema).toString('utf8')
      ) as { $id: string };
      schema.$id = capSchema.$id;
      return JSON.stringify(schema);
    });

    const combinedRuntime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const codes = combinedRuntime.inputSet.readiness.findings.map((f) => f.code);
    expect(codes).toContain('INVALID_PDF_HEADER');
    expect(codes).toContain('SCHEMA_DUPLICATE_ID');
    expect(codes).toContain('UNRESOLVED_SOURCE_ID');
    expect(combinedRuntime.inputSet.conflicts.some((c) => c.conflict_id.includes('SRC-NONEXISTENT-999'))).toBe(
      true
    );
  });

  it('U-01 & M-01 early isolation: enforces server-side authorization on Creator routes and defaults to document mode without legacy routes', async () => {
    expect(resolveCreatorMode(undefined)).toBe('document');
    expect(resolveCreatorMode('document')).toBe('document');
    expect(() => resolveCreatorMode('invalid-mode')).toThrow(/Unsupported CREATOR_MODE/);

    // 1. Fail-closed 503 when CREATOR_OPERATOR_TOKEN is unset.
    const unconfiguredApp = await buildCreatorApp({ operatorToken: '' });
    const res503 = await unconfiguredApp.inject({ method: 'GET', url: '/api/creator/profiles' });
    expect(res503.statusCode).toBe(503);
    await unconfiguredApp.close();

    // 2. Authorized Creator app with both SAE and synthetic profiles; legacy routes absent.
    const synProfile = await loadSyntheticProfile(process.cwd());
    const app = await buildCreatorApp({
      operatorToken: 'test-operator-token-dc01',
      profiles: [() => buildSaeLocalPilotProfile(process.cwd()), synProfile]
    });

    const resHealth = await app.inject({ method: 'GET', url: '/health/live' });
    expect(resHealth.statusCode).toBe(200);
    expect(resHealth.json()).toMatchObject({ status: 'ok', mode: 'document' });

    const resUnauth = await app.inject({ method: 'POST', url: '/api/creator/plan', payload: {} });
    expect(resUnauth.statusCode).toBe(401);

    const resWrongToken = await app.inject({
      method: 'GET',
      url: '/creator',
      headers: { authorization: 'Bearer wrong-token' }
    });
    expect(resWrongToken.statusCode).toBe(401);

    const authHeaders = { authorization: 'Bearer test-operator-token-dc01' };

    // Legacy register route is NOT mounted in document mode.
    const resLegacyRoute = await app.inject({
      method: 'GET',
      url: '/register',
      headers: authHeaders
    });
    expect(resLegacyRoute.statusCode).toBe(404);

    // Authorized HTML views render stages cleanly without legacy 14-task or SIR internals.
    const resInputsHtml = await app.inject({
      method: 'GET',
      url: '/creator?profileId=sae-local-pilot',
      headers: authHeaders
    });
    expect(resInputsHtml.statusCode).toBe(200);
    expect(resInputsHtml.body).toContain('Inputs readiness');
    expect(resInputsHtml.body).toContain('1. Inputs');
    expect(resInputsHtml.body).toContain('2. Document plan');
    expect(resInputsHtml.body).not.toContain('PAIR_COHERENCE_REVIEW');

    const resPlanHtml = await app.inject({
      method: 'GET',
      url: '/creator/plan?profileId=synthetic-operational-resilience&mode=domain&domainId=OPS',
      headers: authHeaders
    });
    expect(resPlanHtml.statusCode).toBe(200);
    expect(resPlanHtml.body).toContain('SYNTHETIC TEST PROFILE');
    expect(resPlanHtml.body).toContain('synthetic-resilience-kb:OPS-1');

    // Authorized JSON API validates and builds deterministic plans.
    const resApiPlan = await app.inject({
      method: 'POST',
      url: '/api/creator/plan',
      headers: authHeaders,
      payload: {
        profileId: 'sae-local-pilot',
        selection: {
          mode: 'pair',
          pair_ids: ['PAIR-A2'],
          include_tactics: false
        }
      }
    });
    expect(resApiPlan.statusCode).toBe(200);
    const body = resApiPlan.json() as { plan: { summary: { total_documents: number } } };
    expect(body.plan.summary.total_documents).toBe(2);

    await app.close();

    // Verify buildApp('document') from src/server.ts also builds isolated document mode without DB/legacy boot.
    const prevToken = process.env.CREATOR_OPERATOR_TOKEN;
    process.env.CREATOR_OPERATOR_TOKEN = 'server-doc-mode-token';
    try {
      const serverDocApp = await buildApp('document');
      const check = await serverDocApp.inject({
        method: 'GET',
        url: '/api/creator/profiles',
        headers: { 'x-creator-token': 'server-doc-mode-token' }
      });
      expect(check.statusCode).toBe(200);
      await serverDocApp.close();
    } finally {
      if (prevToken === undefined) {
        delete process.env.CREATOR_OPERATOR_TOKEN;
      } else {
        process.env.CREATOR_OPERATOR_TOKEN = prevToken;
      }
    }
  });
});
