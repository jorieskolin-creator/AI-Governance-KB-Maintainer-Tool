import type { ModelExecutionRequest, ModelExecutionResponse } from '../ai/provider-client.js';
import type { CreatorAuthorProviderPort, PairAuthorModelOutput } from './author.js';
import type { SourcePreparationBundle } from './contracts.js';
import { computeSha256 } from './inputs.js';

export function buildSaePilotPairA2DraftFromPassages(options: {
  eligiblePassages: ReadonlyArray<
    SourcePreparationBundle['model_ready_packet']['eligible_passages'][number]
  >;
  variationLabel?: string;
}): PairAuthorModelOutput {
  const { eligiblePassages } = options;
  const prefix = options.variationLabel ? `[${options.variationLabel}] ` : '';

  const nistP31 =
    eligiblePassages.find(
      (p) => p.source_id === 'SRC-NIST-AI-RMF' && p.locator_label.endsWith('#page=31')
    ) ?? eligiblePassages.find((p) => p.source_id === 'SRC-NIST-AI-RMF');
  const nistP32 =
    eligiblePassages.find(
      (p) => p.source_id === 'SRC-NIST-AI-RMF' && p.locator_label.endsWith('#page=32')
    ) ?? nistP31;
  const nistP37 =
    eligiblePassages.find(
      (p) => p.source_id === 'SRC-NIST-AI-RMF' && p.locator_label.endsWith('#page=37')
    ) ?? nistP31;
  const fiAdmin = eligiblePassages.find((p) => p.source_id === 'SRC-FI-ADMIN-LAW-434-2003');
  const oecd = eligiblePassages.find((p) => p.source_id === 'SRC-OECD-AI-PRINCIPLES-2024');

  const capUnits = [
    ...new Set(
      [
        nistP31?.source_unit_id,
        nistP32?.source_unit_id,
        nistP37?.source_unit_id,
        fiAdmin?.source_unit_id,
        oecd?.source_unit_id
      ].filter((id): id is string => typeof id === 'string')
    )
  ];

  const apUnits = [
    ...new Set(
      [
        nistP31?.source_unit_id,
        nistP32?.source_unit_id,
        nistP37?.source_unit_id
      ].filter((id): id is string => typeof id === 'string')
    )
  ];

  return {
    capability: {
      sections: {
        DEF: {
          prose: `${prefix}A2 (AI suitability, proportionality and value hypothesis) ensures the organization defines the business problem, affected process, and current-state non-AI baseline independently of AI, and demonstrates through a falsifiable value hypothesis that an AI mechanism is proportionate to expected benefits, total cost, operational burden, human impact, and risk. Within Domain A, A2 owns suitability, proportionality, and value justification, whereas A1 owns intended purpose and use boundaries, A3 owns value-chain role and accountability allocation, A4 owns legal and risk classification, and A5 owns lifecycle stage transition gating.`,
          bullets: [
            'Define the business problem, desired outcome, and non-AI baseline independently of model selection (A2-Q1).',
            'Compare the proposed AI mechanism against viable non-AI, rule-based, and lower-complexity alternatives across benefit, cost, risk, and operational burden (A2-Q2).',
            'Validate expected value through representative trials with pre-defined continuation and stop/disengagement criteria (A2-Q3).'
          ],
          question_ids: ['A2-Q1', 'A2-Q2', 'A2-Q3'],
          source_unit_ids: [nistP31?.source_unit_id, nistP37?.source_unit_id].filter(
            (id): id is string => typeof id === 'string'
          )
        },
        APP: {
          prose: `${prefix}Applies to all proposed and materially changed AI uses (instrument applicability: ALWAYS; human authority: GOVERNANCE). Assessment depth scales with autonomy, affected-person exposure, cost, operational dependency, and reversibility. Reassessment is triggered whenever business-case assumptions, baseline comparisons, cost/risk thresholds, or continuation/stop criteria materially change.`,
          bullets: [
            'No blanket exemption applies merely because an AI feature is embedded, pre-licensed, low-cost, or labeled experimental.',
            'ISOLATED_SANDBOX and CONTROLLED_PILOT are operating-boundary environments, not lifecycle stages; progression from pilot to production requires evidenced value and proportionality verification.'
          ]
        },
        CRI: {
          prose: `${prefix}Evaluates A2 across the three Solution Assurance Engine evidence dimensions: Definition and Intent (A2-Q1), Implementation and Operation (A2-Q2), and Evidence and Effectiveness (A2-Q3), grounded in Categories and Anti-Patterns v1.1 (PDF page 10) and Thinking Flow v3.1.0.`,
          bullets: [
            'Capability indicators from PDF page 10: Non-AI baseline exists; Value metrics and owners are named; Cost and operational consequences are considered; Continuation and stop criteria are enforced.'
          ],
          question_ids: ['A2-Q1', 'A2-Q2', 'A2-Q3']
        },
        EVI: {
          prose: `${prefix}Requires attributable evidence across the assurance ladder: (1) a technology-neutral problem, baseline, and falsifiable value hypothesis specification (DECLARED); (2) a comparative alternatives and total-cost/risk trade-off analysis covering viable non-AI options (IMPLEMENTED / FORMALLY_APPROVED); and (3) representative trial and operational evaluation records demonstrating net value against pre-declared continuation and stop thresholds (TESTED / OPERATIONALLY_OBSERVED).`,
          bullets: [
            'Business cases or vendor proposals establish DECLARED intent only and never satisfy TESTED or OPERATIONALLY_OBSERVED assurance.',
            'Model benchmark accuracy or prompt/usage volume never substitutes for realized business, user, or risk-adjusted outcome evidence.'
          ],
          source_unit_ids: [nistP32?.source_unit_id, nistP37?.source_unit_id].filter(
            (id): id is string => typeof id === 'string'
          )
        },
        INT: {
          prose: `${prefix}Where baseline measurements, non-AI alternative comparisons, or representative trial results are missing, incomplete, or contradictory, the affected A2 conclusion remains UNKNOWN (or NOT_SATISFIED where verified evidence demonstrates a material gap). Conflicting executive value claims and trial records are preserved for human governance adjudication rather than smoothed.`,
          question_ids: ['A2-Q1', 'A2-Q2', 'A2-Q3']
        },
        LIF: {
          prose: `${prefix}Applies across all seven canonical lifecycle stages: QUALIFICATION_AND_REGISTRATION (DECLARED / HUMAN_VALIDATED problem and baseline), DESIGN_AND_DEVELOPMENT (IMPLEMENTED / HUMAN_VALIDATED alternatives and trade-off analysis), VERIFICATION_AND_VALIDATION (TESTED / HUMAN_VALIDATED representative trial evidence), DEPLOYMENT (TESTED / FORMALLY_APPROVED continuation decision), OPERATION_AND_MONITORING (OPERATIONALLY_OBSERVED / HUMAN_VALIDATED sustained value monitoring), REVIEW_AND_EVALUATION (OPERATIONALLY_OBSERVED reassessment), and RETIREMENT (IMPLEMENTED / FORMALLY_APPROVED disengagement or decommissioning when value or proportionality fails).`
        },
        REL: {
          prose: `${prefix}A2 is paired with anti-pattern AP-A2 (AI-first solutionism or value theatre) under strict non-inverse assessment semantics, and connects to A1 (purpose boundary), A4 (classification), A5 (lifecycle gates), C2 (model/provider suitability), D2 (functional quality), and F4 (decision rights and authorization).`
        },
        TAC: {
          prose: `${prefix}Associated Tactic Playbook v1.0.0 entries (TAC-PURPOSE-A2-01, TAC-PURPOSE-A2-02, TAC-PURPOSE-A2-03) are object-level candidate remediation workstreams confirmed for the SAE reference case. Tactic selection or completion generates new evidence for reassessment only and confers zero automatic finding closure or customer activation authority in Creator.`
        },
        SRC: {
          prose: `${prefix}Distinguishes external registered source support (NIST AI RMF 1.0 MAP 1.3, MAP 1.4, MAP 3.1, MAP 3.2, MANAGE 1.1, MANAGE 2.1, MANAGE 2.2, MANAGE 2.4; Finnish Administrative Procedure Act 434/2003; OECD AI Principles 2024) from Solution Assurance Engine cognitive-model interpretations. ISO standards (SRC-ISO-42001-2023, SRC-ISO-23894-2023, SRC-ISO-42005-2025) are retained as metadata-and-locator-only boundaries without reproducing protected standard text, and EUR-Lex client-rendered shells without local PDF bindings remain explicitly outside passage-level claim support.`,
          source_unit_ids: capUnits
        },
        REV: {
          prose: `${prefix}Reviewed local SAE pilot reference document for A2 (v1.0.0). Creation review authorizes storage delivery of the reviewed Markdown bytes only; Knowledge Hub approval remains NOT_GRANTED_BY_CREATOR.`
        }
      },
      question_guidance: {
        'A2-Q1':
          'Verify that the business problem, target outcome, non-AI baseline, and falsifiable value hypothesis with named owners and thresholds are documented independently of AI model selection.',
        'A2-Q2':
          'Verify that viable non-AI, rule-based, and simpler alternatives were compared on consistent benefit, total-cost, human-impact, reversibility, and risk criteria.',
        'A2-Q3':
          'Verify that representative trials and operating records demonstrate sufficient net value and feasibility, and that explicit continuation/stop criteria are enforced by accountable governance authority.'
      },
      assessment_boundaries: {
        unknown_handling: [
          'Missing baseline data, uncompared non-AI alternatives, or unexecuted trials keep A2 UNKNOWN rather than SATISFIED, without automatically implying AP-A2 is CONFIRMED_PRESENT.'
        ],
        contradiction_handling: [
          'Conflicting business-case projections and negative trial or operational cost/risk records keep A2 UNKNOWN until human governance adjudication.'
        ],
        false_positive_guards: [
          'Do not treat model benchmark scores, token/query volume, or slide-deck ROI projections as evidence of realized value or proportionality.',
          'Do not treat a comparison solely between different LLM vendors as a technology-neutral alternatives assessment.'
        ],
        prohibited_inferences: [
          'Do not infer AP-A2 presence solely because A2 is NOT_SATISFIED or UNKNOWN.',
          'Do not infer legal or regulatory compliance from satisfying A2.',
          'Do not infer production value from an unconstrained prototype demo.'
        ],
        human_decision_boundaries: [
          'Accountable GOVERNANCE and business/risk owners retain authority to approve value thresholds, adjudicate conflicting trial evidence, accept residual risk, and authorize progression or stop/retirement.'
        ],
        evidence_ceilings: [
          'Problem and value-hypothesis statements establish DECLARED assurance only.',
          'Alternatives matrices and cost models establish IMPLEMENTED design analysis, not TESTED effectiveness.',
          'Executed representative trials establish TESTED assurance only for the evaluated system version and operating context.'
        ],
        paired_independence_rule:
          'Not satisfying capability A2 does not establish presence of anti-pattern AP-A2; AP-A2 presence and tested absence are assessed independently.'
      },
      sourced_claims: [
        ...(nistP31
          ? [
              {
                section_code: 'DEF',
                statement: `${prefix}NIST AI RMF 1.0 MAP 1.3 and MAP 1.4 establish that the organization's mission, relevant AI goals, and the business value or context of business use must be clearly defined or re-evaluated when assessing existing AI systems.`,
                source_unit_ids: [nistP31.source_unit_id],
                applicability_note:
                  'Voluntary risk-management framework guidance (TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE); supports governance criteria without establishing binding legal compliance.'
              }
            ]
          : []),
        ...(nistP32
          ? [
              {
                section_code: 'EVI',
                statement: `${prefix}NIST AI RMF 1.0 MAP 3, MAP 3.1, and MAP 3.2 require examining and documenting potential benefits of intended AI functionality alongside potential monetary and non-monetary costs resulting from expected or realized AI errors and trustworthiness limits compared against appropriate benchmarks.`,
                source_unit_ids: [nistP32.source_unit_id],
                applicability_note:
                  'Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds comparative benefit, cost, and benchmark evaluation for A2-Q2.'
              }
            ]
          : []),
        ...(nistP37
          ? [
              {
                section_code: 'LIF',
                statement: `${prefix}NIST AI RMF 1.0 MANAGE 1.1, MANAGE 2.1, MANAGE 2.2, and MANAGE 2.4 address determining whether an AI system achieves its intended purposes and stated objectives and whether development or deployment should proceed, taking viable non-AI alternative systems, approaches, or methods into account, sustaining deployed value, and superseding, disengaging, or deactivating systems whose outcomes are inconsistent with intended use.`,
                source_unit_ids: [nistP37.source_unit_id],
                applicability_note:
                  'Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds A2-Q2 non-AI alternatives comparison and A2-Q3 continuation/stop and disengagement gates.'
              }
            ]
          : [])
      ],
      methodology_interpretations: [
        {
          section_code: 'INT',
          statement:
            'Under the Solution Assurance Engine cognitive model (v3.1.0), unverified value hypotheses cannot exceed DECLARED technical assurance, and missing trial or baseline evidence resolves to UNKNOWN rather than being averaged or assumed satisfied.',
          cognitive_rule_refs: [
            'evidence_admissibility_and_ceilings',
            'unknown_is_valid_non_compliant_result',
            'human_authority_remains_outside_engine'
          ],
          question_ids: ['A2-Q1', 'A2-Q2', 'A2-Q3']
        }
      ],
      related_object_links: [
        {
          target_object_id: 'AP-A2',
          non_inverse_meaning:
            'Paired anti-pattern assessed independently; an A2 gap does not automatically establish AP-A2 presence.'
        },
        {
          target_object_id: 'A1',
          non_inverse_meaning:
            'A1 defines the bounded intended purpose and use envelope that A2 evaluates for suitability, proportionality, and value.'
        },
        {
          target_object_id: 'A5',
          non_inverse_meaning:
            'A2 continuation and stop determinations feed lifecycle transition gating in A5.'
        }
      ],
      tactic_refs: [
        {
          tactic_id: 'TAC-PURPOSE-A2-01',
          scope_and_boundary_note:
            'Advisory tactic to establish a technology-neutral problem, baseline, and falsifiable value hypothesis; completion requires reassessment and never closes findings.'
        },
        {
          tactic_id: 'TAC-PURPOSE-A2-02',
          scope_and_boundary_note:
            'Advisory tactic to conduct a technology-neutral alternatives and proportionality assessment; completion requires reassessment and never closes findings.'
        },
        {
          tactic_id: 'TAC-PURPOSE-A2-03',
          scope_and_boundary_note:
            'Advisory tactic to execute representative value validation and apply governed continuation/stop criteria; completion requires reassessment and never closes findings.'
        }
      ]
    },
    antipattern: {
      sections: {
        DEF: {
          prose: `${prefix}AP-A2 (AI-first solutionism or value theatre) occurs when AI is selected for novelty, vendor availability, or executive signaling before the problem and baseline are defined, when viable non-AI alternatives are bypassed, or when activity/usage metrics substitute for verified outcome and risk evidence. Within Domain A, AP-A2 owns solution-first selection and value-theatre failure modes, distinct from AP-A1 (elastic purpose), AP-A3 (responsibility displacement), AP-A4 (superficial classification), and AP-A5 (prototype-to-production drift).`,
          bullets: [
            'Detects pre-committed AI selection ahead of technology-neutral problem and baseline framing (AP-A2-Q1).',
            'Detects missing non-AI comparison or vanity activity metrics substituting for value (AP-A2-Q2).',
            'Tests presence of continued progression despite poor outcome evidence or verifies a current scoped absence test (AP-A2-Q3).'
          ],
          question_ids: ['AP-A2-Q1', 'AP-A2-Q2', 'AP-A2-Q3'],
          source_unit_ids: apUnits
        },
        IND: {
          prose: `${prefix}Observable indicators from Categories and Anti-Patterns v1.1 (PDF page 10) and instrument signals (value-theatre) identify solution-first commitment and unverified value reporting.`,
          bullets: [
            'The use case starts with a predetermined AI solution',
            'No baseline or alternative comparison',
            'Activity metrics substitute for value',
            'Progress continues despite poor outcome evidence'
          ]
        },
        CRI: {
          prose: `${prefix}Assesses AP-A2 across AP-A2-Q1 (Definition and Intent), AP-A2-Q2 (Implementation and Operation), and AP-A2-Q3 (Evidence and Effectiveness).`,
          question_ids: ['AP-A2-Q1', 'AP-A2-Q2', 'AP-A2-Q3']
        },
        ABS: {
          prose: `${prefix}TESTED_ABSENT requires a current, executed, and independently reviewed absence test covering decision chronology, non-AI alternatives evaluation, metric validity, and stop/continue governance for the current system version. When A2 is NOT_SATISFIED or UNKNOWN and AP-A2 evidence is unavailable, AP-A2 remains UNKNOWN rather than defaulting to CONFIRMED_PRESENT or TESTED_ABSENT.`,
          source_unit_ids: nistP37 ? [nistP37.source_unit_id] : []
        },
        CON: {
          prose: `${prefix}Contradictions between promotional value claims and negative trial, cost, or incident records are preserved without smoothing. Silence, absence of complaints, or unexecuted discovery never establishes AP-A2 absence.`
        },
        REL: {
          prose: `${prefix}Paired with capability A2 without automatic inverse assessment: failing A2 does not prove AP-A2 presence, and AP-A2 UNKNOWN does not satisfy A2.`
        },
        LIF: {
          prose: `${prefix}Applies across all seven canonical lifecycle stages from QUALIFICATION_AND_REGISTRATION through RETIREMENT. Any material change to problem framing, target users, cost/risk profile, or trial outcomes invalidates prior absence assurance and triggers reassessment.`
        },
        TAC: {
          prose: `${prefix}Associated Tactic Playbook v1.0.0 entries (TAC-PURPOSE-A2-01, TAC-PURPOSE-A2-02, TAC-PURPOSE-A2-03, and corrective tactic TAC-PURPOSE-AP-A2-01) provide advisory remediation candidates only (activation_authority: NONE_IN_CREATOR).`
        },
        SRC: {
          prose: `${prefix}Grounds anti-pattern evaluation in NIST AI RMF 1.0 MAP 1.4, MAP 3.1, MAP 3.2, MANAGE 1.1, MANAGE 2.1, and MANAGE 2.4 alongside Solution Assurance Engine tested-absence and contradiction rules.`,
          source_unit_ids: apUnits
        },
        REV: {
          prose: `${prefix}Reviewed local SAE pilot reference document for AP-A2 (v1.0.0). Creation review authorizes storage delivery of the reviewed Markdown bytes only; Knowledge Hub approval remains NOT_GRANTED_BY_CREATOR.`
        }
      },
      question_guidance: {
        'AP-A2-Q1':
          'Inspect charter, intake, and procurement chronology to determine whether an AI solution was mandated before defining the problem, baseline, and measurable value hypothesis.',
        'AP-A2-Q2':
          'Inspect workflows, KPIs, and architecture records for missing non-AI comparisons or adoption/prompt counts used in place of outcome and risk metrics.',
        'AP-A2-Q3':
          'Inspect trial and gate records to determine whether progression continued after failed value thresholds, or verify a complete, current scoped absence test.'
      },
      assessment_boundaries: {
        unknown_handling: [
          'When capability A2 is NOT_SATISFIED but AP-A2 chronology and trial evidence are missing, AP-A2 remains UNKNOWN rather than CONFIRMED_PRESENT or TESTED_ABSENT.'
        ],
        contradiction_handling: [
          'Where executive status reports claim value success but trial logs show unachieved thresholds, preserve the contradiction and evaluate the broader failure surface.'
        ],
        false_positive_guards: [
          'Do not classify a bounded, time-boxed technical feasibility spike as AP-A2 when it operates inside an isolated sandbox with explicit non-AI comparison and stop criteria.'
        ],
        prohibited_inferences: [
          'Do not infer AP-A2 absence from silence, zero reported incidents, or lack of stakeholder complaints.',
          'Do not infer AP-A2 presence solely from an A2 capability documentation gap.'
        ],
        human_decision_boundaries: [
          'Accountable GOVERNANCE authority is required to lock AP-A2 findings, enforce stop/containment decisions, and authorize requalification.'
        ],
        evidence_ceilings: [
          'TESTED_ABSENT requires a complete, current, executed, and independently reviewed absence test; policy statements alone never establish TESTED_ABSENT.'
        ],
        paired_independence_rule:
          'Capability A2 being NOT_SATISFIED does not establish AP-A2 presence, and AP-A2 UNKNOWN does not satisfy A2.',
        failure_mechanism:
          'Solution-first AI selection and activity-based value theatre bypass comparative alternatives analysis and conceal negative value, cost, or risk signals across lifecycle gates.',
        observable_indicators: [
          'The use case starts with a predetermined AI solution',
          'No baseline or alternative comparison',
          'Activity metrics substitute for value',
          'Progress continues despite poor outcome evidence'
        ],
        non_examples: [
          'Controlled feasibility experiment with pre-declared falsification thresholds, non-AI baseline comparison, and enforced stop gate.'
        ],
        tested_absence_requirements: [
          'Reconcile decision chronology confirming problem and non-AI baseline preceded AI selection.',
          'Verify executed comparative analysis of viable non-AI/simpler alternatives (NIST AI RMF MANAGE 2.1).',
          'Verify complete disclosure of representative trial outcomes and enforced continuation/stop determinations (NIST AI RMF MANAGE 1.1 and MANAGE 2.4).'
        ]
      },
      sourced_claims: [
        ...(nistP37
          ? [
              {
                section_code: 'ABS',
                statement: `${prefix}NIST AI RMF 1.0 MANAGE 1.1, MANAGE 2.1, and MANAGE 2.4 require an explicit determination of whether an AI system achieves its intended purposes and stated objectives and whether development or deployment should proceed, considering viable non-AI alternative systems and applying mechanisms to supersede, disengage, or deactivate systems with inconsistent performance or outcomes.`,
                source_unit_ids: [nistP37.source_unit_id],
                applicability_note:
                  'Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds testing for solution-first progression and missing disengagement gates in AP-A2.'
              }
            ]
          : []),
        ...(nistP31 && nistP32
          ? [
              {
                section_code: 'IND',
                statement: `${prefix}NIST AI RMF 1.0 MAP 1.4, MAP 3.1, and MAP 3.2 require clearly defining or re-evaluating business value and examining both potential benefits and monetary/non-monetary costs against benchmarks.`,
                source_unit_ids: [...new Set([nistP31.source_unit_id, nistP32.source_unit_id])],
                applicability_note:
                  'Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds detection of missing baseline benchmarks and unexamined error/trustworthiness costs.'
              }
            ]
          : [])
      ],
      methodology_interpretations: [
        {
          section_code: 'ABS',
          statement:
            'Under Solution Assurance Engine tested-absence rules (cognitive contract v3.1.0), silence, missing complaints, or unexecuted discovery always resolves to UNKNOWN and never satisfies TESTED_ABSENT.',
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
            'Corrective decision reset tactic; completion yields new evidence for reassessment without automatic finding closure.'
        }
      ]
    }
  };
}

export function createSaePilotReferenceAuthorPort(options?: {
  variationLabel?: string;
}): CreatorAuthorProviderPort {
  return async (req: ModelExecutionRequest): Promise<ModelExecutionResponse> => {
    const parsedUser = JSON.parse(req.userPrompt) as {
      model_ready_packet: SourcePreparationBundle['model_ready_packet'];
    };
    const payload = buildSaePilotPairA2DraftFromPassages({
      eligiblePassages: parsedUser.model_ready_packet.eligible_passages,
      variationLabel: options?.variationLabel
    });
    const rawText = JSON.stringify(payload);
    return {
      provider: 'OPENAI',
      model: 'sae-local-pilot-reference-v1',
      rawText,
      parsedJson: payload,
      inputTokens: 1420,
      outputTokens: 1680,
      latencyMs: 18,
      promptHash: computeSha256(`${req.systemPrompt}\n---\n${req.userPrompt}`)
    };
  };
}
