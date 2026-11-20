import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorPairWorkUnit,
  type CreatorAuthorProviderPort
} from '../../src/document-creator/author.js';
import {
  validateDeliveryReceipt,
  type DeliveryReceipt
} from '../../src/document-creator/contracts.js';
import {
  deliverReviewedCreatorRun,
  inspectDeliveredHandoff
} from '../../src/document-creator/delivery.js';
import { parseStandaloneDeliveredMarkdown } from '../../src/document-creator/handoff-reader.js';
import { createSaePilotReferenceAuthorPort } from '../../src/document-creator/pilot-reference.js';
import { createDocumentPlan } from '../../src/document-creator/plan.js';
import {
  buildSaeLocalPilotProfile,
  resolveProfileInputSet
} from '../../src/document-creator/profiles.js';
import {
  prepareSourcesForPlan,
  type FetchResponseLike,
  type HttpFetchPort
} from '../../src/document-creator/sources.js';
import {
  executeSemanticReviewForRun,
  InMemoryCreatorRunStore,
  reconcileInterruptedCreatorRuns,
  recordHumanCreationReview,
  startOrResumePairRun
} from '../../src/document-creator/store.js';
import { validateCreatorDocumentAgainstContext } from '../../src/document-creator/validate.js';
import { resolveCreatorMode, resolvePilotCreatorMode } from '../../src/server.js';

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

async function createSaePilotSandbox() {
  const workspace = await mkdtemp(join(tmpdir(), 'dc07-sae-'));
  tempDirs.push(workspace);

  const profile = await buildSaeLocalPilotProfile(process.cwd());
  for (const ref of profile.input_refs) {
    const dest = join(workspace, ref.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(ref.path, dest);
  }
  await mkdir(join(workspace, profile.source_policy.references_subdir), { recursive: true });
  await mkdir(join(workspace, profile.storage_ref.output_root), { recursive: true });

  // Build a multi-page test PDF matching NIST AI RMF pages 31, 32, and 37 for offline deterministic verification.
  const pages: string[][] = Array.from({ length: 37 }, (_, i) => [
    `NIST AI 100-1 AI RMF 1.0 Page ${i + 1}`
  ]);
  pages[30] = [
    'NIST AI 100-1 AI RMF 1.0 Table 2 MAP',
    'MAP 1.3: The organization mission and relevant goals for AI technology are understood and documented.',
    'MAP 1.4: The business value or context of business use has been clearly defined or re-evaluated.'
  ];
  pages[31] = [
    'NIST AI 100-1 AI RMF 1.0 Table 2 MAP Continued',
    'MAP 3.1: Potential benefits of intended AI system functionality and performance are examined and documented.',
    'MAP 3.2: Potential costs, including non-monetary costs, resulting from AI errors are examined and documented.'
  ];
  pages[36] = [
    'NIST AI 100-1 AI RMF 1.0 Table 4 MANAGE',
    'MANAGE 1.1: A determination is made as to whether the AI system achieves its intended purposes and stated objectives and whether its development or deployment should proceed.',
    'MANAGE 2.1: Resources required to manage AI risks are taken into account along with viable non-AI alternative systems.',
    'MANAGE 2.4: Mechanisms are in place to supersede, disengage, or deactivate AI systems inconsistent with intended use.'
  ];

  const nistPdf = buildTestTextPdf(pages);
  const nistRelPath = 'baseline/sae-training/references/NIST_AI_RMF_1.0.pdf';
  await writeFile(join(workspace, nistRelPath), nistPdf);

  profile.reference_pdf_bindings = [
    {
      source_id: 'SRC-NIST-AI-RMF',
      edition_version: 'NIST AI 100-1, January 2023',
      path: nistRelPath,
      sha256: sha256(nistPdf),
      usage_policy: 'PERMITTED_ATTRIBUTED_EXCERPT',
      rights_confirmed_for_model: true,
      provenance: 'Pinned local test PDF in references/'
    }
  ];

  const mockFetch: HttpFetchPort = async (url) => {
    if (url.includes('finlex.fi/fi/lainsaadanto/2003/434')) {
      return mockHtmlResponse(
        200,
        '<html><body><h2>434/2003 — Hallintolaki</h2><p>Automated administrative decision-making requires defined rules, proportionality, and human accountability.</p></body></html>'
      );
    }
    if (url.includes('oecd.org')) {
      return mockHtmlResponse(
        200,
        '<html><body><h2>OECD AI Principles</h2><p>Inclusive growth, sustainable development, human-centered values, and accountability.</p></body></html>'
      );
    }
    return mockHtmlResponse(404, 'Not found');
  };

  return { workspace, profile, mockFetch };
}

describe('DC-07: Complete local SAE pilot path, standalone Markdown extraction, 3-run evaluation, negative injections, and cutover/rollback readiness', () => {
  it('Verifies the delivered PAIR-A2 (A2 & AP-A2 v1.0.0) in baseline/sae-training/knowledge-base/ and recovers all sections, questions, claims, tactics, and bibliography via the independent standalone Markdown reader', async () => {
    const profile = await buildSaeLocalPilotProfile(process.cwd());
    const handoff = await inspectDeliveredHandoff({
      workspaceRoot: process.cwd(),
      profile
    });

    expect(handoff.unreceipted_partial_paths).toEqual([]);
    expect(handoff.excluded_non_document_prefixes).toContain('_operations');
    expect(handoff.completed_receipts).toHaveLength(1);
    expect(handoff.ready_documents.map((d) => [d.document_id, d.path])).toEqual([
      ['solution-assurance-engine:A2', 'A/capabilities/A2/1.0.0/document.md'],
      ['solution-assurance-engine:AP-A2', 'A/antipatterns/AP-A2/1.0.0/document.md']
    ]);

    const receipt = handoff.completed_receipts[0]!;
    expect(validateDeliveryReceipt(receipt)).toEqual([]);
    expect(receipt.run_id).toBe('run-sae-pilot-pair-a2-v1');
    expect(receipt.creation_review_status).toBe('REVIEWED_FOR_DELIVERY');
    expect(receipt.hub_approval_status).toBe('NOT_GRANTED_BY_CREATOR');

    // Read raw delivered Markdown files from baseline/sae-training/knowledge-base/ and parse independently.
    const a2Raw = await readFile(
      'baseline/sae-training/knowledge-base/A/capabilities/A2/1.0.0/document.md',
      'utf8'
    );
    const apA2Raw = await readFile(
      'baseline/sae-training/knowledge-base/A/antipatterns/AP-A2/1.0.0/document.md',
      'utf8'
    );

    expect(sha256(a2Raw)).toBe(receipt.files[0]?.sha256);
    expect(sha256(apA2Raw)).toBe(receipt.files[1]?.sha256);

    const parsedA2 = parseStandaloneDeliveredMarkdown(a2Raw);
    expect(parsedA2.has_unsafe_yaml_tags).toBe(false);
    expect(parsedA2.front_matter).toMatchObject({
      document_id: 'solution-assurance-engine:A2',
      kb_id: 'solution-assurance-engine',
      object_id: 'A2',
      object_type: 'capability',
      document_version: '1.0.0',
      pair_id: 'PAIR-A2',
      paired_object_id: 'AP-A2',
      creation_review_state: 'READY_TO_DELIVER',
      hub_approval_status: 'NOT_GRANTED_BY_CREATOR',
      is_synthetic: false
    });
    expect(parsedA2.sections.map((s) => s.section_id)).toEqual([
      'A2.DEF',
      'A2.APP',
      'A2.CRI',
      'A2.EVI',
      'A2.INT',
      'A2.LIF',
      'A2.REL',
      'A2.TAC',
      'A2.SRC',
      'A2.REV'
    ]);
    expect(parsedA2.questions.map((q) => q.id)).toEqual(['A2-Q1', 'A2-Q2', 'A2-Q3']);
    expect(parsedA2.tactics.map((t) => t.tactic_id)).toEqual([
      'TAC-PURPOSE-A2-01',
      'TAC-PURPOSE-A2-02',
      'TAC-PURPOSE-A2-03'
    ]);
    expect(parsedA2.tactics.every((t) => t.activation_authority === 'NONE_IN_CREATOR')).toBe(
      true
    );
    expect(parsedA2.sourced_claims).toHaveLength(3);
    expect(
      parsedA2.sourced_claims.every((c) => c.support_state === 'SOURCE_SUPPORTED')
    ).toBe(true);
    expect(parsedA2.bibliography.some((b) => b.source_id === 'SRC-NIST-AI-RMF')).toBe(true);
    expect(parsedA2.unresolved_items).toEqual([]);

    const parsedApA2 = parseStandaloneDeliveredMarkdown(apA2Raw);
    expect(parsedApA2.has_unsafe_yaml_tags).toBe(false);
    expect(parsedApA2.front_matter).toMatchObject({
      document_id: 'solution-assurance-engine:AP-A2',
      object_id: 'AP-A2',
      object_type: 'antipattern',
      document_version: '1.0.0',
      pair_id: 'PAIR-A2',
      paired_object_id: 'A2',
      creation_review_state: 'READY_TO_DELIVER',
      hub_approval_status: 'NOT_GRANTED_BY_CREATOR'
    });
    expect(parsedApA2.sections.map((s) => s.section_id)).toEqual([
      'AP-A2.DEF',
      'AP-A2.IND',
      'AP-A2.CRI',
      'AP-A2.ABS',
      'AP-A2.CON',
      'AP-A2.REL',
      'AP-A2.LIF',
      'AP-A2.TAC',
      'AP-A2.SRC',
      'AP-A2.REV'
    ]);
    expect(parsedApA2.questions.map((q) => q.id)).toEqual([
      'AP-A2-Q1',
      'AP-A2-Q2',
      'AP-A2-Q3'
    ]);
    expect(parsedApA2.tactics.map((t) => t.tactic_id)).toEqual([
      'TAC-PURPOSE-A2-01',
      'TAC-PURPOSE-A2-02',
      'TAC-PURPOSE-A2-03',
      'TAC-PURPOSE-AP-A2-01'
    ]);
    expect(parsedApA2.sourced_claims).toHaveLength(2);
    expect(parsedApA2.unresolved_items).toEqual([]);
  });

  it('Executes 3 independent generations of PAIR-A2 on the confirmed input set and compares required-section coverage, citation resolution, tactic status, and prose variation (04-Validation-and-Acceptance §3)', async () => {
    const { workspace, profile, mockFetch } = await createSaePilotSandbox();
    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const sourceBundle = await prepareSourcesForPlan({
      workspaceRoot: workspace,
      runtime,
      plan,
      enableUrlAcquisition: true,
      fetchPort: mockFetch
    });

    const runLabels = ['Pilot-Run-1', 'Pilot-Run-2', 'Pilot-Run-3'] as const;
    const capHashes = new Set<string>();
    const apHashes = new Set<string>();

    for (const label of runLabels) {
      const result = await authorPairWorkUnit({
        runtime,
        plan,
        sourceBundle,
        pairId: 'PAIR-A2',
        documentVersion: '1.0.0',
        providerPort: createSaePilotReferenceAuthorPort({ variationLabel: label })
      });

      expect(result.validation.draft_valid, label).toBe(true);
      expect(result.validation.delivery_ready, label).toBe(true);
      expect(result.capability.sections, label).toHaveLength(10);
      expect(result.antipattern.sections, label).toHaveLength(10);
      expect(
        result.capability.sourced_claims.every((c) => c.support_state === 'SOURCE_SUPPORTED'),
        label
      ).toBe(true);
      expect(
        result.antipattern.sourced_claims.every((c) => c.support_state === 'SOURCE_SUPPORTED'),
        label
      ).toBe(true);
      expect(
        result.capability.tactic_associations.every(
          (t) =>
            t.effective_association_status === 'OBJECT_LINK_ASSOCIATED' &&
            t.activation_authority === 'NONE_IN_CREATOR'
        ),
        label
      ).toBe(true);

      capHashes.add(result.rendered.capability.markdown_sha256);
      apHashes.add(result.rendered.antipattern.markdown_sha256);
    }

    // All 3 runs satisfy all structural/citation/tactic invariants without requiring identical prose.
    expect(capHashes.size).toBe(3);
    expect(apHashes.size).toBe(3);
  });

  it('Detects deliberate missing support, invalid tactic target link, absent required input, interrupted generation, partial delivery failure, and confirms pilot mode default + rollback', async () => {
    const { workspace, profile, mockFetch } = await createSaePilotSandbox();
    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const sourceBundle = await prepareSourcesForPlan({
      workspaceRoot: workspace,
      runtime,
      plan,
      enableUrlAcquisition: true,
      fetchPort: mockFetch
    });

    // 1. Deliberate unsupported claim (empty source_unit_ids) + tactic link to nonexistent target:
    const badPort: CreatorAuthorProviderPort = async (req) => {
      const base = await createSaePilotReferenceAuthorPort()(req);
      const parsed = JSON.parse(base.rawText);
      parsed.capability.sourced_claims.push({
        section_code: 'SRC',
        statement: 'Deliberately injected unsupported claim without any passage handle.',
        source_unit_ids: []
      });
      return {
        ...base,
        rawText: JSON.stringify(parsed),
        parsedJson: parsed
      };
    };

    const injectedResult = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId: 'PAIR-A2',
      providerPort: badPort
    });

    // Unsupported claim is kept explicitly UNRESOLVED and blocks delivery_ready!
    expect(injectedResult.validation.draft_valid).toBe(true);
    expect(injectedResult.validation.delivery_ready).toBe(false);
    expect(
      injectedResult.capability.sourced_claims.some((c) => c.support_state === 'UNRESOLVED')
    ).toBe(true);

    // Inject tactic link to nonexistent criterion/object in runtime tactics -> caught by validateCreatorDocumentAgainstContext!
    const brokenLinkCheck = validateCreatorDocumentAgainstContext({
      document: injectedResult.capability,
      plannedDocument: plan.documents[0]!,
      runtime: {
        ...runtime,
        tactics: runtime.tactics.map((t) =>
          t.tactic_id === 'TAC-PURPOSE-A2-01'
            ? { ...t, reassessment_targets: ['NONEXISTENT-CRITERION-999'] }
            : t
        )
      },
      plan,
      sourceBundle
    });
    expect(brokenLinkCheck.draft_valid).toBe(false);
    expect(brokenLinkCheck.findings.map((f) => f.code)).toContain('TACTIC_LINK_MISSING_TARGET');

    // 2. Interrupted generation + startup reconciliation + partial delivery + idempotent retry:
    const store = new InMemoryCreatorRunStore();
    const run = await startOrResumePairRun({
      store,
      workspaceRoot: workspace,
      runtime,
      plan,
      pairId: 'PAIR-A2',
      documentVersion: '1.0.0',
      enableUrlAcquisition: true,
      authorProviderPort: createSaePilotReferenceAuthorPort(),
      fetchPort: mockFetch
    });
    await executeSemanticReviewForRun({ store, runId: run.run_id, runtime });
    await recordHumanCreationReview({
      store,
      runId: run.run_id,
      reviewedBy: 'jori.eskolin@sujuva.co.site'
    });

    let failSecondWrite = true;
    await expect(
      deliverReviewedCreatorRun({
        store,
        workspaceRoot: workspace,
        runtime,
        plan,
        runId: run.run_id,
        targetVersion: '1.0.0',
        beforeWriteHook: async (ctx) => {
          if (failSecondWrite && ctx.scope === 'output' && ctx.fileIndex === 1) {
            throw new Error('Injected partial delivery failure');
          }
        }
      })
    ).rejects.toThrow(/Injected partial delivery failure/);

    failSecondWrite = false;
    const recoveredDelivery = await deliverReviewedCreatorRun({
      store,
      workspaceRoot: workspace,
      runtime,
      plan,
      runId: run.run_id,
      targetVersion: '1.0.0'
    });
    expect(recoveredDelivery.run.state).toBe('DELIVERED');
    expect(recoveredDelivery.fileOutcomes[0]?.outcome).toBe('IDEMPOTENT_EXISTING');
    expect(recoveredDelivery.fileOutcomes[1]?.outcome).toBe('WRITTEN_AND_VERIFIED');

    // Simulate interrupted in-flight call on restart -> reconciled without automatic replay.
    const interruptedRun = (await store.getRun(run.run_id))!;
    interruptedRun.state = 'GENERATING';
    interruptedRun.provider_calls.push({
      call_id: 'call-interrupted-dc07',
      stage: 'TARGETED_REPAIR',
      status: 'IN_FLIGHT',
      provider: 'OPENAI',
      model: 'WORKHORSE',
      prompt_hash: 'a'.repeat(64),
      started_at: new Date().toISOString(),
      completed_at: null,
      input_tokens: 0,
      output_tokens: 0,
      error_message: null
    });
    await store.saveRun(interruptedRun);
    const reconciled = await reconcileInterruptedCreatorRuns(store);
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]?.interruption_state).toBe('PROVIDER_OUTCOME_UNKNOWN');

    // 3. Absent required input (cognitive-model removed from disk) blocks planning_ready:
    await rm(
      join(workspace, profile.input_refs.find((r) => r.role === 'cognitive-model')!.path)
    );
    const missingInputRuntime = await resolveProfileInputSet({
      workspaceRoot: workspace,
      profile
    });
    expect(missingInputRuntime.inputSet.readiness.planning_ready).toBe(false);
    expect(
      missingInputRuntime.inputSet.readiness.findings.some((f) => f.code === 'INPUT_MISSING')
    ).toBe(true);

    // 4. Pilot mode default vs deployed fallback & rollback:
    expect(resolvePilotCreatorMode(undefined)).toBe('document');
    expect(resolvePilotCreatorMode('legacy')).toBe('legacy');
    expect(resolveCreatorMode(undefined)).toBe('legacy');
    expect(resolveCreatorMode('document')).toBe('document');

    const envExample = await readFile('.env.example', 'utf8');
    expect(envExample).toContain('CREATOR_MODE=document');
    expect(envExample).toContain('CREATOR_MODE=legacy');
  });
});
