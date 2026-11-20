import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelExecutionRequest } from '../../src/ai/provider-client.js';
import { buildCreatorApp } from '../../src/document-creator/app.js';
import type {
  CreatorAuthorProviderPort,
  PairAuthorModelOutput
} from '../../src/document-creator/author.js';
import {
  validateCreatorDocument,
  type BatchExecutionResult,
  type CreatorRunRecord,
  type RegenerationComparisonResult,
  type SourcePreparationBundle
} from '../../src/document-creator/contracts.js';
import {
  buildProfileFromInventoryFile,
  buildSaeLocalPilotProfile
} from '../../src/document-creator/profiles.js';
import type { FetchResponseLike, HttpFetchPort } from '../../src/document-creator/sources.js';
import { InMemoryCreatorRunStore } from '../../src/document-creator/store.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildTestTextPdf(pageLinesArray: string[][]): Buffer {
  const objects: Array<{ num: number; body: string; streamBytes: Buffer | null }> = [];
  const addObj = (body: string, streamBytes: Buffer | null = null): number => {
    const num = objects.length + 1;
    objects.push({ num, body, streamBytes });
    return num;
  };

  const fontNum = addObj(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  const pageNums: number[] = [];

  for (const lines of pageLinesArray) {
    let y = 740;
    const ops = ['BT', '/F1 11 Tf'];
    for (const line of lines) {
      const escaped = line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
      ops.push(`1 0 0 1 50 ${y} Tm (${escaped}) Tj`);
      y -= 18;
    }
    ops.push('ET');
    const compressed = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
    const contentNum = addObj(
      `<< /Length ${compressed.length} /Filter /FlateDecode >>`,
      compressed
    );
    const pageNum = addObj(
      `<< /Type /Page /Parent PAGES_REF 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
    );
    pageNums.push(pageNum);
  }

  const pagesNum = addObj(
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`
  );
  const catalogNum = addObj(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  for (const obj of objects) {
    const dict = obj.body.replaceAll('PAGES_REF', String(pagesNum));
    chunks.push(Buffer.from(`${obj.num} 0 obj\n${dict}\n`, 'latin1'));
    if (obj.streamBytes) {
      chunks.push(Buffer.from('stream\n', 'latin1'));
      chunks.push(obj.streamBytes);
      chunks.push(Buffer.from('\nendstream\n', 'latin1'));
    }
    chunks.push(Buffer.from('endobj\n', 'latin1'));
  }
  chunks.push(Buffer.from(`trailer\n<< /Root ${catalogNum} 0 R >>\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function mockHtmlResponse(
  status: number,
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }
): FetchResponseLike {
  const bytes = Buffer.from(body, 'utf8');
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    status,
    headers: {
      get(name: string) {
        return lowerHeaders[name.toLowerCase()] ?? null;
      }
    },
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
    body: {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      }
    }
  };
}

async function createSaeBatchSandbox() {
  const workspace = await mkdtemp(join(tmpdir(), 'dc06-sae-'));
  tempDirs.push(workspace);

  const profile = await buildSaeLocalPilotProfile(process.cwd());
  profile.limits.max_objects_per_run = 20;

  for (const ref of profile.input_refs) {
    const dest = join(workspace, ref.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(ref.path, dest);
  }
  await mkdir(join(workspace, profile.source_policy.references_subdir), { recursive: true });
  await mkdir(join(workspace, profile.storage_ref.output_root), { recursive: true });

  const nistPdf = buildTestTextPdf([
    [
      'NIST AI RMF 1.0 MAP 1.1 and MANAGE 1.1',
      'Organizations evaluate expected benefits alongside costs, risks, and non-AI baselines before deployment.'
    ]
  ]);
  const nistRelPath = 'baseline/sae-training/references/NIST_AI_RMF_1.0.pdf';
  await writeFile(join(workspace, nistRelPath), nistPdf);

  profile.reference_pdf_bindings = [
    {
      source_id: 'SRC-NIST-AI-RMF',
      edition_version: 'AI RMF 1.0 (2023-01-26)',
      path: nistRelPath,
      sha256: sha256(nistPdf),
      usage_policy: 'PERMITTED_ATTRIBUTED_EXCERPT',
      rights_confirmed_for_model: true,
      provenance: 'Pinned local test PDF in references/'
    }
  ];

  const mockFetch: HttpFetchPort = async (url) => {
    if (url.includes('eur-lex.europa.eu') || url.includes('example.org/synthetic')) {
      return mockHtmlResponse(
        200,
        '<html><body><h2>Section 1 — Governance Requirement</h2><p>Continuous lifecycle risk management and executed verification are required across all operating stages.</p></body></html>'
      );
    }
    return mockHtmlResponse(404, 'Not found');
  };

  return { workspace, profile, mockFetch };
}

function buildGenericPairDraftFromPrompt(
  req: ModelExecutionRequest,
  tag = 'v1'
): PairAuthorModelOutput {
  const parsedUser = JSON.parse(req.userPrompt) as {
    pair_id: string;
    capability_contract: {
      object_id: string;
      title: string;
      paired_antipattern_id: string;
      allowed_question_ids: string[];
      usable_source_unit_ids: string[];
    };
    antipattern_contract: {
      object_id: string;
      title: string;
      paired_capability_id: string;
      allowed_question_ids: string[];
      usable_source_unit_ids: string[];
    };
  };

  const capId = parsedUser.capability_contract.object_id;
  const apId = parsedUser.antipattern_contract.object_id;
  const capQIds = parsedUser.capability_contract.allowed_question_ids;
  const apQIds = parsedUser.antipattern_contract.allowed_question_ids;
  const capUnitIds = parsedUser.capability_contract.usable_source_unit_ids.slice(0, 1);
  const apUnitIds = parsedUser.antipattern_contract.usable_source_unit_ids.slice(0, 1);

  return {
    capability: {
      sections: {
        DEF: {
          prose: `[${tag}] ${capId} (${parsedUser.capability_contract.title}) defines distinct governance scope for ${parsedUser.pair_id}.`,
          bullets: [`Bounded scope for ${capId}.`],
          question_ids: capQIds.slice(0, 1),
          source_unit_ids: capUnitIds
        },
        APP: { prose: `[${tag}] Applies to all in-scope systems for ${capId}.` },
        CRI: { prose: `[${tag}] Evaluates ${capQIds.join(', ')}.`, question_ids: capQIds },
        EVI: { prose: `[${tag}] Requires verified implementation and test records for ${capId}.` },
        INT: { prose: `[${tag}] Missing or conflicting evidence keeps ${capId} UNKNOWN.` },
        LIF: { prose: `[${tag}] Verified across applicable lifecycle stages for ${capId}.` },
        REL: { prose: `[${tag}] Paired with ${apId} under non-inverse semantics.` },
        TAC: { prose: `[${tag}] Associated tactics are advisory only.` },
        SRC: { prose: `[${tag}] Grounded in registered passages and cognitive rules.`, source_unit_ids: capUnitIds },
        REV: { prose: `[${tag}] Creation-review draft for ${capId}.` }
      },
      assessment_boundaries: {
        unknown_handling: [`Missing evidence keeps ${capId} UNKNOWN without implying ${apId} presence.`],
        contradiction_handling: [`Conflicting records keep ${capId} UNKNOWN until adjudicated.`],
        false_positive_guards: [`Policy text alone does not prove ${capId} implementation.`],
        prohibited_inferences: [`Do not infer ${apId} presence from a ${capId} gap.`],
        human_decision_boundaries: [`Accountable human authority locks ${capId} findings.`],
        evidence_ceilings: [`Documentation alone caps ${capId} at DECLARED.`],
        paired_independence_rule: `Not satisfying ${capId} does not establish ${apId} presence.`
      },
      sourced_claims:
        capUnitIds.length > 0
          ? [
              {
                section_code: 'SRC',
                statement: `[${tag}] Continuous lifecycle risk management and verification apply to ${capId}.`,
                source_unit_ids: capUnitIds
              }
            ]
          : [
              {
                section_code: 'SRC',
                statement: `[${tag}] External source claim for ${capId} awaiting readable passage.`,
                source_unit_ids: [],
                unresolved_reason: 'No usable passage in packet.'
              }
            ]
    },
    antipattern: {
      sections: {
        DEF: {
          prose: `[${tag}] ${apId} (${parsedUser.antipattern_contract.title}) captures the paired failure mode for ${parsedUser.pair_id}.`,
          question_ids: apQIds.slice(0, 1)
        },
        IND: { prose: `[${tag}] Observable indicators for ${apId}.` },
        CRI: { prose: `[${tag}] Evaluates ${apQIds.join(', ')}.`, question_ids: apQIds },
        ABS: {
          prose: `[${tag}] TESTED_ABSENT requires an executed scoped absence test; missing evidence stays UNKNOWN rather than CONFIRMED_PRESENT.`
        },
        CON: { prose: `[${tag}] Silence or zero complaints never establishes ${apId} absence.` },
        REL: { prose: `[${tag}] Paired with ${capId} without inverse inference.` },
        LIF: { prose: `[${tag}] Re-verify ${apId} absence after material changes.` },
        TAC: { prose: `[${tag}] Advisory corrective tactics never close findings automatically.` },
        SRC: { prose: `[${tag}] Grounded in registered passages and tested-absence rules.`, source_unit_ids: apUnitIds },
        REV: { prose: `[${tag}] Creation-review draft for ${apId}.` }
      },
      assessment_boundaries: {
        unknown_handling: [
          `Missing anti-pattern evidence keeps ${apId} UNKNOWN rather than CONFIRMED_PRESENT or TESTED_ABSENT.`
        ],
        contradiction_handling: [`Preserve contradictions between declarations and runtime behavior for ${apId}.`],
        false_positive_guards: [`Constrained exceptions with explicit controls do not trigger ${apId}.`],
        prohibited_inferences: [`Do not infer ${apId} absence from silence, zero incidents, or missing complaints.`],
        human_decision_boundaries: [`Human authority locks ${apId} findings.`],
        evidence_ceilings: [`TESTED_ABSENT requires an executed scoped absence test for ${apId}.`],
        paired_independence_rule: `${capId} NOT_SATISFIED does not establish ${apId} presence.`,
        failure_mechanism: `Failure mechanism for ${apId} bypasses governed controls and verification.`,
        observable_indicators: [`Indicator 1 for ${apId}`, `Indicator 2 for ${apId}`],
        non_examples: [`Governed exception for ${apId}`],
        tested_absence_requirements: [`Executed scoped absence test covering ${apId} mechanisms.`]
      },
      sourced_claims:
        apUnitIds.length > 0
          ? [
              {
                section_code: 'SRC',
                statement: `[${tag}] Lifecycle verification prevents ${apId} drift.`,
                source_unit_ids: apUnitIds
              }
            ]
          : []
    }
  };
}

describe('DC-06: Bounded batches, explicit regeneration from new inputs, optional tactic rendering, and second-profile reuse', () => {
  it('B-01 & T-03: executes a multi-pair batch with one failed pair, preserves good work, marks the batch INCOMPLETE_PARTIAL_FAILURE, renders requested tactics with SOURCE_FIELDS_ONLY gaps, and delivers a valid pair without whole-domain approval', async () => {
    const { workspace, profile, mockFetch } = await createSaeBatchSandbox();
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc06-batch-token';

    const batchAuthorPort: CreatorAuthorProviderPort = async (req) => {
      const parsedUser = JSON.parse(req.userPrompt) as { pair_id: string };
      if (parsedUser.pair_id === 'PAIR-A3') {
        throw new Error('Simulated provider failure on PAIR-A3');
      }
      const payload = buildGenericPairDraftFromPrompt(req, 'Batch-Run-1');
      return {
        provider: 'OPENAI',
        model: 'mock-batch-author',
        rawText: JSON.stringify(payload),
        parsedJson: payload,
        inputTokens: 250,
        outputTokens: 300,
        latencyMs: 5,
        promptHash: sha256(req.userPrompt)
      };
    };

    const app = await buildCreatorApp({
      workspaceRoot: workspace,
      operatorToken: authToken,
      profiles: [profile],
      runStore,
      fetchPort: mockFetch,
      allowLiveSourceFetch: true,
      authorProviderPort: batchAuthorPort
    });
    const headers = { 'x-creator-token': authToken };

    // 1. Execute explicit batch for PAIR-A2, PAIR-A3 (fails), PAIR-A4, plus requested tactics TAC-PURPOSE-A2-01 and cross-domain TAC-PURPOSE-A3-01.
    const batchRes = await app.inject({
      method: 'POST',
      url: '/api/creator/batches/execute',
      headers,
      payload: {
        profileId: 'sae-local-pilot',
        enableUrlAcquisition: true,
        documentVersion: '1.0.0',
        selection: {
          mode: 'explicit',
          pair_ids: ['PAIR-A2', 'PAIR-A3', 'PAIR-A4'],
          include_tactics: true,
          tactic_ids: ['TAC-PURPOSE-A2-01', 'TAC-PURPOSE-A3-01']
        }
      }
    });

    // B-01: Partial failure returns 207 and status INCOMPLETE_PARTIAL_FAILURE (never COMPLETED!).
    expect(batchRes.statusCode).toBe(207);
    const batch = (batchRes.json() as { batch: BatchExecutionResult }).batch;
    expect(batch.status).toBe('INCOMPLETE_PARTIAL_FAILURE');
    expect(batch.summary).toEqual({
      requested_work_units: 5,
      requested_documents: 8,
      succeeded_documents: 6,
      failed_documents: 2,
      skipped_documents: 0,
      capability_count: 3,
      antipattern_count: 3,
      tactic_count: 2
    });

    const a2Progress = batch.documents.find((d) => d.object_id === 'A2');
    const a3Progress = batch.documents.find((d) => d.object_id === 'A3');
    const a4Progress = batch.documents.find((d) => d.object_id === 'A4');
    expect(a2Progress?.status).toBe('SUCCEEDED');
    expect(a3Progress?.status).toBe('FAILED');
    expect(a3Progress?.error_message).toContain('Simulated provider failure on PAIR-A3');
    expect(a4Progress?.status).toBe('SUCCEEDED');

    // T-03 & Playbook semantics: Requested tactic documents validate against CreatorDocument schema,
    // preserve SOURCE_FIELDS_ONLY gaps without invention, and place TAC-PURPOSE-A3-01 under shared/tactics/!
    expect(batch.tactic_documents).toHaveLength(2);
    for (const tacDoc of batch.tactic_documents) {
      expect(validateCreatorDocument(tacDoc.document)).toEqual([]);
      expect(tacDoc.validation.draft_valid).toBe(true);
      expect(tacDoc.validation.delivery_ready).toBe(true);
      expect(tacDoc.rendered.markdown).toContain('SOURCE_FIELDS_ONLY');
      expect(tacDoc.rendered.markdown).toContain('[Playbook gap');
      expect(tacDoc.rendered.markdown).toContain('NONE_IN_CREATOR');
    }
    const crossDomTac = batch.tactic_documents.find(
      (t) => t.document.object_id === 'TAC-PURPOSE-A3-01'
    )!;
    expect(crossDomTac.document.destination_path_template).toBe(
      'shared/tactics/TAC-PURPOSE-A3-01/{version}/document.md'
    );
    expect(crossDomTac.rendered.markdown).toContain('## TAC-PURPOSE-A3-01.ID —');
    expect(crossDomTac.rendered.markdown).toContain('## TAC-PURPOSE-A3-01.MAP —');

    // No whole-domain approval dependency: PAIR-A2 can be reviewed and delivered even though PAIR-A3 in Domain A failed!
    const a2RunId = a2Progress!.run_id!;
    const approveA2Res = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${a2RunId}/approve-review`,
      headers,
      payload: { reviewedBy: 'jori.eskolin@sujuva.co.site' }
    });
    expect(approveA2Res.statusCode).toBe(200);

    const deliverA2Res = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${a2RunId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(deliverA2Res.statusCode).toBe(200);
    expect(deliverA2Res.json()).toMatchObject({
      run: { state: 'DELIVERED' }
    });

    await app.close();
  });

  it('B-02: regenerates a delivered pair from a new input baseline into a new draft/version with provenance and section diffs while keeping old delivered documents intact', async () => {
    const { workspace, profile, mockFetch } = await createSaeBatchSandbox();
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc06-regen-token';

    let authorTag = 'Baseline-v1.0.0';
    const authorPort: CreatorAuthorProviderPort = async (req) => {
      const payload = buildGenericPairDraftFromPrompt(req, authorTag);
      return {
        provider: 'OPENAI',
        model: 'mock-regen-author',
        rawText: JSON.stringify(payload),
        parsedJson: payload,
        inputTokens: 200,
        outputTokens: 250,
        latencyMs: 5,
        promptHash: sha256(req.userPrompt)
      };
    };

    const app = await buildCreatorApp({
      workspaceRoot: workspace,
      operatorToken: authToken,
      profiles: [() => profile],
      runStore,
      fetchPort: mockFetch,
      allowLiveSourceFetch: true,
      authorProviderPort: authorPort
    });
    const headers = { 'x-creator-token': authToken };

    // 1. Author, review, and deliver PAIR-A2 v1.0.0 on the initial input baseline.
    const initialAuthorRes = await app.inject({
      method: 'POST',
      url: '/api/creator/documents/author',
      headers,
      payload: {
        profileId: 'sae-local-pilot',
        pairId: 'PAIR-A2',
        documentVersion: '1.0.0',
        enableUrlAcquisition: true
      }
    });
    expect(initialAuthorRes.statusCode).toBe(200);
    const priorRun = (initialAuthorRes.json() as { run: CreatorRunRecord }).run;

    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${priorRun.run_id}/approve-review`,
      headers,
      payload: { reviewedBy: 'jori.eskolin@sujuva.co.site' }
    });

    const deliverV1Res = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${priorRun.run_id}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(deliverV1Res.statusCode).toBe(200);

    const v1CapPath = join(
      workspace,
      profile.storage_ref.output_root,
      'A/capabilities/A2/1.0.0/document.md'
    );
    const v1ApPath = join(
      workspace,
      profile.storage_ref.output_root,
      'A/antipatterns/AP-A2/1.0.0/document.md'
    );
    const v1CapBytesBefore = await readFile(v1CapPath);
    const v1ApBytesBefore = await readFile(v1ApPath);

    // Rejects regeneration when input baseline has not changed!
    const unchangedInputRegen = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${priorRun.run_id}/regenerate`,
      headers,
      payload: { newDocumentVersion: '1.1.0' }
    });
    expect(unchangedInputRegen.statusCode).toBe(422);

    // 2. Update and re-pin the Source Register input in the sandbox to version 1.5.1 (new input baseline).
    const srRef = profile.input_refs.find((r) => r.role === 'source-register')!;
    const srFullPath = join(workspace, srRef.path);
    const srJson = JSON.parse(await readFile(srFullPath, 'utf8')) as Record<string, unknown>;
    srJson.version = '1.5.1';
    const nextSrBytes = Buffer.from(JSON.stringify(srJson, null, 2), 'utf8');
    await writeFile(srFullPath, nextSrBytes);
    srRef.version = '1.5.1';
    srRef.sha256 = sha256(nextSrBytes);
    profile.profile_version = '1.1.0';

    // Rejects regeneration when newDocumentVersion equals prior version 1.0.0!
    const sameVersionRegen = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${priorRun.run_id}/regenerate`,
      headers,
      payload: { newDocumentVersion: '1.0.0' }
    });
    expect(sameVersionRegen.statusCode).toBe(422);

    // 3. Regenerate into v1.1.0 from the new input baseline!
    authorTag = 'Regenerated-v1.1.0';
    const regenRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${priorRun.run_id}/regenerate`,
      headers,
      payload: {
        newDocumentVersion: '1.1.0',
        enableUrlAcquisition: true
      }
    });
    expect(regenRes.statusCode).toBe(200);
    const regenBody = regenRes.json() as {
      priorRun: CreatorRunRecord;
      newRun: CreatorRunRecord;
      comparison: RegenerationComparisonResult;
    };

    expect(regenBody.newRun.run_id).not.toBe(priorRun.run_id);
    expect(regenBody.comparison.prior_input_set_id).toBe(priorRun.input_set_id);
    expect(regenBody.comparison.new_input_set_id).not.toBe(priorRun.input_set_id);
    expect(regenBody.comparison.prior_document_version).toBe('1.0.0');
    expect(regenBody.comparison.new_document_version).toBe('1.1.0');
    expect(regenBody.comparison.changed_inputs.length).toBeGreaterThan(0);
    expect(regenBody.comparison.capability_diff.changed_section_ids.length).toBeGreaterThan(0);
    expect(regenBody.comparison.antipattern_diff.changed_section_ids.length).toBeGreaterThan(0);

    // Approve and deliver v1.1.0, and verify v1.0.0 files on disk remain 100% untouched!
    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${regenBody.newRun.run_id}/approve-review`,
      headers,
      payload: { reviewedBy: 'jori.eskolin@sujuva.co.site' }
    });
    const deliverV110Res = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${regenBody.newRun.run_id}/deliver`,
      headers,
      payload: { targetVersion: '1.1.0' }
    });
    expect(deliverV110Res.statusCode).toBe(200);

    expect(sha256(await readFile(v1CapPath))).toBe(sha256(v1CapBytesBefore));
    expect(sha256(await readFile(v1ApPath))).toBe(sha256(v1ApBytesBefore));

    const v110CapPath = join(
      workspace,
      profile.storage_ref.output_root,
      'A/capabilities/A2/1.1.0/document.md'
    );
    expect((await readFile(v110CapPath, 'utf8'))).toContain('[Regenerated-v1.1.0]');

    await app.close();
  });

  it('I-05: executes a full batch with tactics and delivers reviewed Markdown on the second synthetic non-A–F profile (OPS/SEC) without generic code changes', async () => {
    const synWorkspace = await mkdtemp(join(tmpdir(), 'dc06-syn-'));
    tempDirs.push(synWorkspace);

    const baseSynProfile = await buildProfileFromInventoryFile({
      workspaceRoot: process.cwd(),
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
    baseSynProfile.domain_folder_tokens = {
      OPS: 'operations-continuity',
      SEC: 'security-mesh'
    };

    for (const ref of baseSynProfile.input_refs) {
      const dest = join(synWorkspace, ref.path);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(ref.path, dest);
    }
    await mkdir(join(synWorkspace, baseSynProfile.storage_ref.output_root), {
      recursive: true
    });

    const synFetch: HttpFetchPort = async () =>
      mockHtmlResponse(
        200,
        '<html><body><h2>Synthetic Section</h2><p>Synthetic operational and security test passage.</p></body></html>'
      );

    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc06-syn-token';
    const app = await buildCreatorApp({
      workspaceRoot: synWorkspace,
      operatorToken: authToken,
      profiles: [baseSynProfile],
      runStore,
      fetchPort: synFetch,
      allowLiveSourceFetch: true,
      authorProviderPort: async (req) => {
        const payload = buildGenericPairDraftFromPrompt(req, 'Synthetic-Batch');
        return {
          provider: 'OPENAI',
          model: 'mock-syn-author',
          rawText: JSON.stringify(payload),
          parsedJson: payload,
          inputTokens: 150,
          outputTokens: 200,
          latencyMs: 3,
          promptHash: sha256(req.userPrompt)
        };
      }
    });
    const headers = { 'x-creator-token': authToken };

    const batchRes = await app.inject({
      method: 'POST',
      url: '/api/creator/batches/execute',
      headers,
      payload: {
        profileId: 'synthetic-operational-resilience',
        enableUrlAcquisition: true,
        documentVersion: '0.1.0',
        selection: {
          mode: 'all',
          include_tactics: true
        }
      }
    });

    expect(batchRes.statusCode).toBe(200);
    const batch = (batchRes.json() as { batch: BatchExecutionResult }).batch;
    expect(batch.status).toBe('COMPLETED');
    expect(batch.summary).toEqual({
      requested_work_units: 5,
      requested_documents: 8,
      succeeded_documents: 8,
      failed_documents: 0,
      skipped_documents: 0,
      capability_count: 3,
      antipattern_count: 3,
      tactic_count: 2
    });

    // Deliver SYN-PAIR-OPS-2 (OPS-2 / AP-OPS-2) and verify custom folder token paths on disk!
    const ops2RunId = batch.documents.find((d) => d.object_id === 'OPS-2')!.run_id!;
    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${ops2RunId}/approve-review`,
      headers,
      payload: { reviewedBy: 'jori.eskolin@sujuva.co.site' }
    });
    const deliverOps2Res = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${ops2RunId}/deliver`,
      headers,
      payload: { targetVersion: '0.1.0' }
    });
    expect(deliverOps2Res.statusCode).toBe(200);

    const ops2MdDisk = await readFile(
      join(
        synWorkspace,
        baseSynProfile.storage_ref.output_root,
        'operations-continuity/capabilities/OPS-2/0.1.0/document.md'
      ),
      'utf8'
    );
    expect(ops2MdDisk).toContain('SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE');
    expect(ops2MdDisk).toContain('## OPS-2.DEF —');

    // Verify repository folders remain completely untouched!
    expect(await readdir('tests/fixtures/synthetic-profile/output')).toEqual(['.gitkeep']);
    for (const dom of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(await readdir(join('baseline/sae-training/knowledge-base', dom))).toEqual([
        '.gitkeep'
      ]);
    }

    await app.close();
  });
});
