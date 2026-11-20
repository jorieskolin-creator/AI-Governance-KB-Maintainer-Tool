import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
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
  validateDeliveryReceipt,
  type CreatorRunRecord,
  type DeliveryReceipt,
  type KbProfile,
  type SourcePreparationBundle
} from '../../src/document-creator/contracts.js';
import {
  DeliveryStorageError,
  resolvePlannedDocumentRelativePath,
  validateDeliveryConnection,
  type StorageWriteHookContext
} from '../../src/document-creator/delivery.js';
import {
  buildSaeLocalPilotProfile,
  resolveProfileInputSet
} from '../../src/document-creator/profiles.js';
import { createDocumentPlan } from '../../src/document-creator/plan.js';
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

async function createSaeDeliverySandbox() {
  const workspace = await mkdtemp(join(tmpdir(), 'dc05-sae-'));
  tempDirs.push(workspace);

  const profile = await buildSaeLocalPilotProfile(process.cwd());
  const inputHashesBefore = new Map<string, string>();

  for (const ref of profile.input_refs) {
    const dest = join(workspace, ref.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(ref.path, dest);
    const bytes = await readFile(dest);
    inputHashesBefore.set(ref.path, sha256(bytes));
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
    if (url.includes('eur-lex.europa.eu')) {
      return mockHtmlResponse(
        200,
        '<html><body><h2>Article 9 — Risk management system</h2><p>Risk management shall be a continuous iterative process planned and run throughout the entire lifecycle.</p></body></html>'
      );
    }
    return mockHtmlResponse(404, 'Not found');
  };

  return { workspace, profile, mockFetch, inputHashesBefore };
}

function buildCleanPairA2Draft(req: ModelExecutionRequest): PairAuthorModelOutput {
  const parsedUser = JSON.parse(req.userPrompt) as {
    model_ready_packet: SourcePreparationBundle['model_ready_packet'];
  };
  const passages = parsedUser.model_ready_packet.eligible_passages;
  const nistUnit = passages.find((p) => p.source_id === 'SRC-NIST-AI-RMF');
  const euUnit = passages.find((p) => p.source_id === 'SRC-EU-AIA');
  const validUnits = [nistUnit?.source_unit_id, euUnit?.source_unit_id].filter(
    (id): id is string => typeof id === 'string'
  );

  return {
    capability: {
      sections: {
        DEF: {
          prose:
            'A2 owns technology-neutral problem framing, baseline comparison, and falsifiable value hypotheses; A1 owns purpose boundary, A3 role allocation, A4 classification, and A5 lifecycle gating.',
          bullets: ['Define problem and baseline independently of AI selection.'],
          question_ids: ['A2-Q1'],
          source_unit_ids: nistUnit ? [nistUnit.source_unit_id] : []
        },
        APP: {
          prose: 'Applies to all proposed and materially changed AI uses.'
        },
        CRI: {
          prose: 'Evaluates A2-Q1, A2-Q2, and A2-Q3.',
          question_ids: ['A2-Q1', 'A2-Q2', 'A2-Q3']
        },
        EVI: {
          prose:
            'Requires technology-neutral baseline records, alternatives comparison matrices, and executed trial outcomes.'
        },
        INT: {
          prose: 'Conflicting or missing trial evidence keeps A2 UNKNOWN until human adjudication.'
        },
        LIF: {
          prose: 'Value hypotheses are verified across all seven canonical lifecycle stages.'
        },
        REL: {
          prose: 'Paired with AP-A2 under non-inverse semantics.'
        },
        TAC: {
          prose: 'Advisory playbook tactics require reassessment and never close findings.'
        },
        SRC: {
          prose: 'Separates registered publication claims from SAE cognitive-model rules.',
          source_unit_ids: validUnits
        },
        REV: {
          prose: 'Creation-review draft for A2.'
        }
      },
      assessment_boundaries: {
        unknown_handling: [
          'Missing baseline or trial evidence keeps A2 UNKNOWN without implying AP-A2 presence.'
        ],
        contradiction_handling: [
          'Conflicting value metrics remain UNKNOWN pending human review.'
        ],
        false_positive_guards: [
          'Do not treat model accuracy or usage volume as proof of business value.'
        ],
        prohibited_inferences: [
          'Do not infer AP-A2 presence from an A2 capability gap.'
        ],
        human_decision_boundaries: [
          'Accountable governance and business owners decide continuation, stop, and risk acceptance.'
        ],
        evidence_ceilings: [
          'Proposal slides establish DECLARED intent only; executed trials are required for TESTED assurance.'
        ],
        paired_independence_rule:
          'Not satisfying A2 does not establish AP-A2 presence; AP-A2 is assessed independently.'
      },
      sourced_claims: [
        {
          section_code: 'SRC',
          statement:
            'Risk management and proportionality evaluation operate as a continuous iterative process across the AI lifecycle.',
          source_unit_ids: validUnits
        }
      ],
      methodology_interpretations: [
        {
          section_code: 'INT',
          statement: 'Unverified value hypotheses cannot exceed DECLARED technical assurance.',
          cognitive_rule_refs: ['evidence_admissibility_and_ceilings'],
          question_ids: ['A2-Q1']
        }
      ]
    },
    antipattern: {
      sections: {
        DEF: {
          prose: 'AP-A2 captures solution-first AI selection and value-theatre reporting.',
          question_ids: ['AP-A2-Q1']
        },
        IND: {
          prose: 'Triggered when AI is selected prior to problem/baseline definition or activity counts replace outcomes.'
        },
        CRI: {
          prose: 'Evaluates AP-A2-Q1, AP-A2-Q2, and AP-A2-Q3.',
          question_ids: ['AP-A2-Q1', 'AP-A2-Q2', 'AP-A2-Q3']
        },
        ABS: {
          prose:
            'TESTED_ABSENT requires a current, executed, scoped absence test; missing AP evidence remains UNKNOWN rather than CONFIRMED_PRESENT or TESTED_ABSENT.'
        },
        CON: {
          prose: 'Silence or zero complaints never establishes anti-pattern absence.'
        },
        REL: {
          prose: 'Paired with A2 without inverse inference.'
        },
        LIF: {
          prose: 'Repeat absence testing after material business-case or scope changes.'
        },
        TAC: {
          prose: 'Advisory corrective tactics never automatically close findings.'
        },
        SRC: {
          prose: 'Grounded in registered source passages and SAE tested-absence rules.',
          source_unit_ids: validUnits
        },
        REV: {
          prose: 'Creation-review draft for AP-A2.'
        }
      },
      assessment_boundaries: {
        unknown_handling: [
          'Missing anti-pattern evidence keeps AP-A2 UNKNOWN rather than CONFIRMED_PRESENT or TESTED_ABSENT.'
        ],
        contradiction_handling: [
          'Preserve contradictions between executive slides and negative trial records.'
        ],
        false_positive_guards: [
          'Bounded technical spike with explicit stop gates is not solution-first lock-in.'
        ],
        prohibited_inferences: [
          'Do not infer anti-pattern absence from silence, zero incidents, or missing complaints.'
        ],
        human_decision_boundaries: [
          'Human governance authority locks AP-A2 findings and requalification decisions.'
        ],
        evidence_ceilings: [
          'TESTED_ABSENT requires an executed scoped absence test.'
        ],
        paired_independence_rule:
          'A2 NOT_SATISFIED does not establish AP-A2 presence, and AP-A2 UNKNOWN does not satisfy A2.',
        failure_mechanism:
          'Pre-committed AI selection and vanity metrics conceal missing value and uncompared simpler alternatives.',
        observable_indicators: [
          'Predetermined AI solution',
          'No baseline comparison',
          'Activity metrics substitute for value'
        ],
        non_examples: ['Governed feasibility spike with falsification thresholds'],
        tested_absence_requirements: [
          'Current executed chronology and alternatives verification covering AP-A2 failure mechanisms.'
        ]
      },
      sourced_claims: [
        {
          section_code: 'SRC',
          statement: 'Continuous lifecycle risk management prevents unverified assumptions from persisting.',
          source_unit_ids: validUnits
        }
      ]
    }
  };
}

describe('DC-05: Deliver reviewed Markdown to storage, post-write verification, and completion receipts', () => {
  it('O-01, O-07, O-08: delivers reviewed PAIR-A2 Markdown to taxonomy-derived paths, verifies readback bytes, writes Master-Table-free completion receipt, and preserves input/schema/Golden bytes untouched', async () => {
    const { workspace, profile, mockFetch, inputHashesBefore } = await createSaeDeliverySandbox();
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc05-deliver-token';

    const authorPort: CreatorAuthorProviderPort = async (req) => {
      const payload = buildCleanPairA2Draft(req);
      return {
        provider: 'OPENAI',
        model: 'mock-author-dc05',
        rawText: JSON.stringify(payload),
        parsedJson: payload,
        inputTokens: 300,
        outputTokens: 350,
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
      authorProviderPort: authorPort
    });
    const headers = { 'x-creator-token': authToken };

    // 1. Author PAIR-A2 and run semantic review.
    const authorRes = await app.inject({
      method: 'POST',
      url: '/api/creator/documents/author',
      headers,
      payload: {
        profileId: 'sae-local-pilot',
        pairId: 'PAIR-A2',
        documentVersion: '1.0.0',
        enableUrlAcquisition: true,
        autoRunSemanticReview: true
      }
    });
    expect(authorRes.statusCode).toBe(200);
    const runId = (authorRes.json() as { run: CreatorRunRecord }).run.run_id;

    // Attempting delivery BEFORE human creation review sign-off is rejected (422)!
    const unreviewedDeliver = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(unreviewedDeliver.statusCode).toBe(422);
    expect(unreviewedDeliver.json()).toMatchObject({ error: 'REVIEW_REQUIRED_BEFORE_DELIVERY' });

    // 2. Record human creation review sign-off.
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/approve-review`,
      headers,
      payload: {
        reviewedBy: 'jori.eskolin@sujuva.co.site',
        note: 'Reviewed A2 and AP-A2 for local SAE pilot delivery.'
      }
    });
    expect(approveRes.statusCode).toBe(200);

    // 3. Deliver reviewed Markdown to storage.
    const deliverRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(deliverRes.statusCode).toBe(200);
    const deliverBody = deliverRes.json() as {
      run: CreatorRunRecord;
      receipt: DeliveryReceipt;
      fileOutcomes: Array<{ document_id: string; path: string; outcome: string }>;
    };

    expect(deliverBody.run.state).toBe('DELIVERED');
    expect(deliverBody.fileOutcomes).toEqual([
      {
        document_id: 'solution-assurance-engine:A2',
        path: 'A/capabilities/A2/1.0.0/document.md',
        outcome: 'WRITTEN_AND_VERIFIED'
      },
      {
        document_id: 'solution-assurance-engine:AP-A2',
        path: 'A/antipatterns/AP-A2/1.0.0/document.md',
        outcome: 'WRITTEN_AND_VERIFIED'
      }
    ]);

    // O-01: Read stored file bytes directly from the destination and verify exact byte/hash match!
    const capDiskPath = join(
      workspace,
      profile.storage_ref.output_root,
      'A/capabilities/A2/1.0.0/document.md'
    );
    const apDiskPath = join(
      workspace,
      profile.storage_ref.output_root,
      'A/antipatterns/AP-A2/1.0.0/document.md'
    );
    const capDiskBytes = await readFile(capDiskPath);
    const apDiskBytes = await readFile(apDiskPath);

    const activeCapRev = deliverBody.run.revisions.find(
      (r) => r.revision_id === deliverBody.run.checkpoints.active_capability_revision_id
    )!;
    const activeApRev = deliverBody.run.revisions.find(
      (r) => r.revision_id === deliverBody.run.checkpoints.active_antipattern_revision_id
    )!;

    expect(capDiskBytes.toString('utf8')).toBe(activeCapRev.rendered.markdown);
    expect(sha256(capDiskBytes)).toBe(activeCapRev.rendered.markdown_sha256);
    expect(apDiskBytes.toString('utf8')).toBe(activeApRev.rendered.markdown);
    expect(sha256(apDiskBytes)).toBe(activeApRev.rendered.markdown_sha256);

    // O-08: Verify completion receipt in _operations/<run_id>/completion-receipt.json has NO Master Table or Hub approval!
    const receiptDiskPath = join(
      workspace,
      profile.storage_ref.operations_root,
      runId,
      'completion-receipt.json'
    );
    const receiptFromDisk = JSON.parse(await readFile(receiptDiskPath, 'utf8')) as DeliveryReceipt;
    expect(validateDeliveryReceipt(receiptFromDisk)).toEqual([]);
    expect(receiptFromDisk.creation_review_status).toBe('REVIEWED_FOR_DELIVERY');
    expect(receiptFromDisk.hub_approval_status).toBe('NOT_GRANTED_BY_CREATOR');
    expect(receiptFromDisk.expected_document_ids).toEqual([
      'solution-assurance-engine:A2',
      'solution-assurance-engine:AP-A2'
    ]);
    expect('master_table' in (receiptFromDisk as unknown as Record<string, unknown>)).toBe(false);
    expect('themes' in (receiptFromDisk as unknown as Record<string, unknown>)).toBe(false);
    expect('tactic_activations' in (receiptFromDisk as unknown as Record<string, unknown>)).toBe(
      false
    );

    // O-08 schema guard: injecting Master Table or Hub approval fields into a receipt fails validation.
    expect(
      validateDeliveryReceipt({
        ...receiptFromDisk,
        master_table: { objects: [] }
      }).some((f) => f.code === 'SCHEMA_ADDITIONALPROPERTIES')
    ).toBe(true);

    // O-07: Verify every input, schema, and Golden file in workspace is byte-identical after delivery,
    // and repository baseline/sae-training/knowledge-base/ remains completely untouched!
    for (const [relPath, expectedHash] of inputHashesBefore.entries()) {
      const currentBytes = await readFile(join(workspace, relPath));
      expect(sha256(currentBytes), relPath).toBe(expectedHash);
    }
    for (const dom of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const repoEntries = await readdir(join('baseline/sae-training/knowledge-base', dom));
      expect(repoEntries).toEqual(['.gitkeep']);
    }

    await app.close();
  });

  it('O-02, O-03 & O-04: retains partial upload without receipt on 2nd file failure, finishes idempotently on retry without duplicates, and blocks conflicting bytes at an existing version', async () => {
    const { workspace, profile, mockFetch } = await createSaeDeliverySandbox();
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc05-retry-token';

    let failSecondUpload = true;
    const writeHook = async (ctx: StorageWriteHookContext) => {
      if (failSecondUpload && ctx.scope === 'output' && ctx.fileIndex === 1) {
        throw new Error('Simulated disk I/O failure on second file upload (AP-A2)');
      }
    };

    const authorPort: CreatorAuthorProviderPort = async (req) => {
      const payload = buildCleanPairA2Draft(req);
      return {
        provider: 'OPENAI',
        model: 'mock-author-dc05',
        rawText: JSON.stringify(payload),
        parsedJson: payload,
        inputTokens: 200,
        outputTokens: 250,
        latencyMs: 4,
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
      authorProviderPort: authorPort,
      beforeStorageWriteHook: writeHook
    });
    const headers = { 'x-creator-token': authToken };

    const authorRes = await app.inject({
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
    const runId = (authorRes.json() as { run: CreatorRunRecord }).run.run_id;

    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/approve-review`,
      headers,
      payload: { reviewedBy: 'jori.eskolin@sujuva.co.site' }
    });

    // 1. O-02: First delivery attempt fails on 2nd file (AP-A2).
    const failDeliverRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(failDeliverRes.statusCode).toBe(502);

    // First file (A2) is preserved on disk; second file (AP-A2) and completion receipt do NOT exist!
    const capDiskPath = join(
      workspace,
      profile.storage_ref.output_root,
      'A/capabilities/A2/1.0.0/document.md'
    );
    const apDiskPath = join(
      workspace,
      profile.storage_ref.output_root,
      'A/antipatterns/AP-A2/1.0.0/document.md'
    );
    const receiptDiskPath = join(
      workspace,
      profile.storage_ref.operations_root,
      runId,
      'completion-receipt.json'
    );

    const capBytesAfterFirstAttempt = await readFile(capDiskPath);
    expect(capBytesAfterFirstAttempt.byteLength).toBeGreaterThan(100);
    await expect(readFile(apDiskPath)).rejects.toThrow();
    await expect(readFile(receiptDiskPath)).rejects.toThrow();

    const receiptGet404 = await app.inject({
      method: 'GET',
      url: `/api/creator/runs/${runId}/receipt`,
      headers
    });
    expect(receiptGet404.statusCode).toBe(404);

    // Handoff inspection excludes the unreceipted partial A2 file!
    const partialHandoff = await app.inject({
      method: 'GET',
      url: '/api/creator/handoff?profileId=sae-local-pilot',
      headers
    });
    expect(partialHandoff.json()).toMatchObject({
      handoff: {
        completed_receipts: [],
        ready_documents: [],
        unreceipted_partial_paths: ['A/capabilities/A2/1.0.0/document.md']
      }
    });

    // 2. O-03: Retry delivery -> A2 is verified idempotently, AP-A2 is written, and receipt is created!
    failSecondUpload = false;
    const retryDeliverRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(retryDeliverRes.statusCode).toBe(200);
    const retryBody = retryDeliverRes.json() as {
      fileOutcomes: Array<{ document_id: string; outcome: string }>;
    };
    expect(retryBody.fileOutcomes).toEqual([
      {
        document_id: 'solution-assurance-engine:A2',
        path: 'A/capabilities/A2/1.0.0/document.md',
        outcome: 'IDEMPOTENT_EXISTING'
      },
      {
        document_id: 'solution-assurance-engine:AP-A2',
        path: 'A/antipatterns/AP-A2/1.0.0/document.md',
        outcome: 'WRITTEN_AND_VERIFIED'
      }
    ]);

    // Retrying the exact same delivery again is 100% idempotent for both files.
    const secondRetryRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(secondRetryRes.statusCode).toBe(200);
    expect(
      (
        secondRetryRes.json() as {
          fileOutcomes: Array<{ outcome: string }>;
        }
      ).fileOutcomes.every((f) => f.outcome === 'IDEMPOTENT_EXISTING')
    ).toBe(true);

    // 3. O-04: Edit A2 content, re-approve review, and attempt to deliver different bytes to existing v1.0.0 -> 409 CONFLICT!
    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/edit`,
      headers,
      payload: {
        objectId: 'A2',
        sectionPatches: [
          {
            section_id: 'A2.APP',
            prose: 'Updated applicability wording for version 1.0.1.'
          }
        ]
      }
    });
    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/approve-review`,
      headers,
      payload: { reviewedBy: 'jori.eskolin@sujuva.co.site' }
    });

    const conflictRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.0' }
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json()).toMatchObject({
      error: 'VERSION_CONFLICT_EXISTING_BYTES_DIFFER'
    });

    // Previous v1.0.0 bytes on disk are completely unchanged!
    const v1BytesStillIntact = await readFile(capDiskPath);
    expect(sha256(v1BytesStillIntact)).toBe(sha256(capBytesAfterFirstAttempt));

    // Delivering to new version 1.0.1 succeeds!
    const v101Res = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.0.1' }
    });
    expect(v101Res.statusCode).toBe(200);

    await app.close();
  });

  it('O-05, O-06, I-09, S-06 & U-01: blocks path traversal/symlinks/Drive/URL links/restricted-source writes, excludes non-document prefixes from handoff, and renders stage 4 Delivery UI', async () => {
    const { workspace, profile, mockFetch } = await createSaeDeliverySandbox();
    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });

    // O-05: Reject unsafe/traversal version tokens before storage write.
    expect(() =>
      resolvePlannedDocumentRelativePath(plan.documents[0]!, '../../etc/passwd')
    ).toThrowError(DeliveryStorageError);
    expect(() =>
      resolvePlannedDocumentRelativePath(plan.documents[0]!, '../1.0.0')
    ).toThrowError(DeliveryStorageError);

    // I-09 / Google Drive & pasted link exclusion:
    const driveProfile: KbProfile = {
      ...JSON.parse(JSON.stringify(profile)),
      storage_ref: {
        ...profile.storage_ref,
        connection_id: 'google-drive-mirror'
      }
    };
    await expect(
      validateDeliveryConnection({ workspaceRoot: workspace, profile: driveProfile })
    ).rejects.toMatchObject({ code: 'GOOGLE_DRIVE_EXCLUDED' });

    const pastedLinkProfile: KbProfile = {
      ...JSON.parse(JSON.stringify(profile)),
      storage_ref: {
        ...profile.storage_ref,
        location: 'https://blob.vercel-storage.com/pasted-link'
      }
    };
    await expect(
      validateDeliveryConnection({ workspaceRoot: workspace, profile: pastedLinkProfile })
    ).rejects.toMatchObject({ code: 'URL_LINK_DOES_NOT_GRANT_ACCESS' });

    // Author, review, and deliver PAIR-A2 v1.0.0, plus populate non-document prefixes under output_root (O-06).
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc05-security-token';
    const authorPort: CreatorAuthorProviderPort = async (req) => {
      const payload = buildCleanPairA2Draft(req);
      return {
        provider: 'OPENAI',
        model: 'mock-author-dc05',
        rawText: JSON.stringify(payload),
        parsedJson: payload,
        inputTokens: 200,
        outputTokens: 200,
        latencyMs: 4,
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
      authorProviderPort: authorPort
    });
    const headers = { 'x-creator-token': authToken };

    // U-01: Unauthenticated requests to delivery/receipt/handoff routes are rejected (401).
    for (const [method, url] of [
      ['GET', '/creator/delivery'],
      ['POST', '/creator/delivery'],
      ['POST', '/api/creator/runs/run-1/deliver'],
      ['GET', '/api/creator/runs/run-1/receipt'],
      ['GET', '/api/creator/handoff']
    ] as const) {
      const unauth = await app.inject({ method, url });
      expect(unauth.statusCode, `${method} ${url}`).toBe(401);
    }

    const authorRes = await app.inject({
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
    const runId = (authorRes.json() as { run: CreatorRunRecord }).run.run_id;

    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/approve-review`,
      headers,
      payload: { reviewedBy: 'jori.eskolin@sujuva.co.site' }
    });

    // Deliver via HTML form POST /creator/delivery and inspect Stage 4 UI.
    const uiDeliverRes = await app.inject({
      method: 'POST',
      url: '/creator/delivery',
      headers: {
        ...headers,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: `runId=${encodeURIComponent(runId)}&profileId=sae-local-pilot&pairId=PAIR-A2&targetVersion=1.0.0`
    });
    expect(uiDeliverRes.statusCode).toBe(200);
    expect(uiDeliverRes.body).toContain('4. Delivery — Immutable Markdown storage &amp; completion receipt');
    expect(uiDeliverRes.body).toContain('Completion Receipt Issued: <strong>YES</strong>');
    expect(uiDeliverRes.body).toContain('NOT_GRANTED_BY_CREATOR');

    // O-06: Coexisting drafts/, inputs/, schemas/, golden-reference/ inside output_root are excluded from handoff!
    const outRoot = join(workspace, profile.storage_ref.output_root);
    for (const prefix of ['drafts', 'inputs', 'schemas', 'golden-reference']) {
      await mkdir(join(outRoot, prefix), { recursive: true });
      await writeFile(join(outRoot, prefix, 'ignored.md'), '# Not a ready KB document\n');
    }

    const handoffRes = await app.inject({
      method: 'GET',
      url: '/api/creator/handoff?profileId=sae-local-pilot',
      headers
    });
    expect(handoffRes.statusCode).toBe(200);
    const handoffJson = handoffRes.json() as {
      handoff: {
        ready_documents: Array<{ document_id: string; path: string }>;
        excluded_non_document_prefixes: string[];
      };
    };
    expect(handoffJson.handoff.ready_documents.map((d) => d.document_id)).toEqual([
      'solution-assurance-engine:A2',
      'solution-assurance-engine:AP-A2'
    ]);
    expect(handoffJson.handoff.excluded_non_document_prefixes).toEqual(
      expect.arrayContaining(['_operations', 'drafts', 'golden-reference', 'inputs', 'schemas'])
    );

    // S-06: Restricted non-egress source text in rendered Markdown is blocked from storage write!
    const currentRun = (await runStore.getRun(runId))!;
    currentRun.checkpoints.source_bundle!.source_units.push({
      source_unit_id: 'f'.repeat(64),
      source_id: 'SRC-OECD-AI-PRINCIPLES-2024',
      source_version: '2024',
      source_title: 'OECD AI Principles',
      authority_tier: 'TIER_2_AUTHORITATIVE',
      authority_type: 'INTERGOVERNMENTAL_POLICY_GUIDANCE',
      origin_kind: 'bound_reference_pdf',
      original_sha256: 'e'.repeat(64),
      locator: { kind: 'pdf_page_section', label: 'restricted.pdf#page=1', page: 1, section: '1' },
      text: 'RESTRICTED_INTERNAL_PUBLISHER_CLAUSE_NEVER_WRITE_TO_STORAGE',
      extraction_status: 'COMPLETE',
      limitations: [],
      usage_policy: 'PERMITTED_ATTRIBUTED_EXCERPT',
      model_eligible: false,
      substantive_support_eligible: true,
      untrusted_content_flags: [],
      human_verification: null,
      retrieved_at: new Date().toISOString(),
      extractor_version: 'dc02',
      text_sha256: 'd'.repeat(64)
    });
    const capRev = currentRun.revisions.find((r) => r.object_id === 'A2')!;
    capRev.rendered.markdown += '\nRESTRICTED_INTERNAL_PUBLISHER_CLAUSE_NEVER_WRITE_TO_STORAGE\n';
    await runStore.saveRun(currentRun);

    const restrictedWriteRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '1.5.0' }
    });
    expect(restrictedWriteRes.statusCode).toBe(422);
    expect(restrictedWriteRes.json()).toMatchObject({
      error: 'RESTRICTED_SOURCE_WRITE_BLOCKED'
    });

    // Restore clean markdown before testing O-05 symlink escape.
    capRev.rendered.markdown = capRev.rendered.markdown.replace(
      '\nRESTRICTED_INTERNAL_PUBLISHER_CLAUSE_NEVER_WRITE_TO_STORAGE\n',
      ''
    );
    await runStore.saveRun(currentRun);

    // O-05 symlink escape: symlink a directory inside output_root to an outside folder -> delivery fails closed!
    const outsideDir = await mkdtemp(join(tmpdir(), 'dc05-outside-'));
    tempDirs.push(outsideDir);
    await rm(join(outRoot, 'A/capabilities'), { recursive: true, force: true });
    await symlink(outsideDir, join(outRoot, 'A/capabilities'));

    const symlinkEscapeRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${runId}/deliver`,
      headers,
      payload: { targetVersion: '2.0.0' }
    });
    expect(symlinkEscapeRes.statusCode).toBe(422);
    expect(symlinkEscapeRes.json()).toMatchObject({ error: 'SYMLINK_ESCAPE_REJECTED' });
    expect(await readdir(outsideDir)).toEqual([]);

    await app.close();
  });
});
