import type { Finding, StrictnessTier, ValidationResult } from './finding.js';
import { applyTier } from './finding.js';
import { governedInputs, joinTaskPrompts, renderTaskPrompt, type PipelinePlan, type PromptContract } from './prompt.js';
import { schemaFindings } from './schema.js';

const meaningful = { type: 'string', minLength: 10 } as const;
const nonEmpty = { type: 'string', minLength: 1 } as const;
const nonEmptyStrings = { type: 'array', items: nonEmpty } as const;

export const pairFrameSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ai-governance-kb.local/pipeline/pair-frame.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['pairBoundary', 'apFailureModel', 'applicability', 'primaryQuestions'],
  properties: {
    pairBoundary: {
      type: 'object',
      additionalProperties: false,
      required: ['capability', 'antipattern', 'boundaryRationale'],
      properties: {
        capability: {
          type: 'object',
          additionalProperties: false,
          required: ['canonicalDefinition', 'governancePurpose', 'distinctClaim', 'ownedTopics', 'excludedTopics'],
          properties: {
            canonicalDefinition: meaningful,
            governancePurpose: meaningful,
            distinctClaim: meaningful,
            ownedTopics: { type: 'array', minItems: 1, items: nonEmpty },
            excludedTopics: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['criterionHandle', 'ownershipBoundary'],
                properties: { criterionHandle: nonEmpty, ownershipBoundary: meaningful }
              }
            }
          }
        },
        antipattern: {
          type: 'object',
          additionalProperties: false,
          required: ['canonicalDefinition', 'pairedRelationship'],
          properties: { canonicalDefinition: meaningful, pairedRelationship: meaningful }
        },
        boundaryRationale: meaningful
      }
    },
    apFailureModel: {
      type: 'object',
      additionalProperties: false,
      required: [
        'failureMechanism',
        'triggeringConditions',
        'observableFailureSurfaces',
        'nonExamples',
        'distinctionFromCapabilityGap'
      ],
      properties: {
        failureMechanism: meaningful,
        triggeringConditions: { type: 'array', minItems: 1, items: nonEmpty },
        observableFailureSurfaces: { type: 'array', minItems: 1, items: nonEmpty },
        nonExamples: { type: 'array', minItems: 1, items: nonEmpty },
        distinctionFromCapabilityGap: meaningful
      }
    },
    applicability: {
      type: 'object',
      additionalProperties: false,
      required: ['capability', 'antipattern', 'consistencyNotes'],
      properties: {
        capability: { $ref: '#/$defs/applicabilityItem' },
        antipattern: { $ref: '#/$defs/applicabilityItem' },
        consistencyNotes: nonEmptyStrings
      }
    },
    primaryQuestions: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilityQuestions', 'antipatternQuestions', 'coverageRationale'],
      properties: {
        capabilityQuestions: { $ref: '#/$defs/questionTrio' },
        antipatternQuestions: { $ref: '#/$defs/questionTrio' },
        coverageRationale: meaningful
      }
    }
  },
  $defs: {
    applicabilityItem: {
      type: 'object',
      additionalProperties: false,
      required: ['statement', 'conditions', 'exclusions', 'reassessmentTriggers'],
      properties: {
        statement: meaningful,
        conditions: { type: 'array', minItems: 1, items: nonEmpty },
        exclusions: nonEmptyStrings,
        reassessmentTriggers: { type: 'array', minItems: 1, items: nonEmpty }
      }
    },
    questionTrio: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'question'],
        properties: {
          slot: { type: 'integer', enum: [1, 2, 3] },
          question: meaningful
        }
      }
    }
  }
} as const;

export interface PairBoundaryOutput {
  capability: {
    canonicalDefinition: string;
    governancePurpose: string;
    distinctClaim: string;
    ownedTopics: string[];
    excludedTopics: Array<{ criterionHandle: string; ownershipBoundary: string }>;
  };
  antipattern: { canonicalDefinition: string; pairedRelationship: string };
  boundaryRationale: string;
}

export interface ApFailureModelOutput {
  failureMechanism: string;
  triggeringConditions: string[];
  observableFailureSurfaces: string[];
  nonExamples: string[];
  distinctionFromCapabilityGap: string;
}

export interface ApplicabilityItem {
  statement: string;
  conditions: string[];
  exclusions: string[];
  reassessmentTriggers: string[];
}

export interface ApplicabilityOutput {
  capability: ApplicabilityItem;
  antipattern: ApplicabilityItem;
  consistencyNotes: string[];
}

export interface QuestionContent {
  slot: 1 | 2 | 3;
  question: string;
}

export interface PrimaryQuestionsOutput {
  capabilityQuestions: QuestionContent[];
  antipatternQuestions: QuestionContent[];
  coverageRationale: string;
}

export interface PairFrameOutput {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  applicability: ApplicabilityOutput;
  primaryQuestions: PrimaryQuestionsOutput;
}

function slotOrderFindings(output: unknown): Finding[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const questions = (output as { primaryQuestions?: unknown }).primaryQuestions;
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) return [];
  const record = questions as Record<string, unknown>;
  const findings: Finding[] = [];
  for (const key of ['capabilityQuestions', 'antipatternQuestions'] as const) {
    const items = record[key];
    if (!Array.isArray(items)) continue;
    items.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const slot = (item as { slot?: unknown }).slot;
      const expected = index + 1;
      if (slot !== expected) {
        findings.push({
          code: 'QUESTION_SLOTS_FIXED_AND_ORDERED',
          path: `/primaryQuestions/${key}/${String(index)}/slot`,
          message: `Expected governed slot ${String(expected)}.`
        });
      }
    });
  }
  return findings;
}

export function validatePairFrame(output: unknown, tier: StrictnessTier = 'RELEASE'): ValidationResult {
  return applyTier(schemaFindings(pairFrameSchema, output), slotOrderFindings(output), tier);
}

export interface PairFramePromptSeed {
  plan: PipelinePlan;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
  pairBoundary: unknown;
  apFailureModel: unknown;
  applicability: unknown;
}

function contract(partial: Omit<PromptContract, 'contractVersion' | 'failureMode'>): PromptContract {
  return { contractVersion: '2.0.0', failureMode: 'FAIL_CLOSED', ...partial };
}

export function pairFrameContracts(seed: PairFramePromptSeed): PromptContract[] {
  const plan = seed.plan;
  return [
    contract({
      taskType: 'PAIR_BOUNDARY',
      objective:
        'Define only the semantic ownership boundary of the capability and paired anti-pattern. Return meaning, not canonical identity or canonical references.',
      lockedInputs: {
        ...governedInputs(plan),
        adjacent_criteria: plan.adjacentCriteria,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: ['AUTHORING_PLAN', 'CATEGORY_BASELINE', 'ADJACENT_CRITERIA', 'GOLDEN_REFERENCE'],
      doNot: [
        'Do not output pairId, capabilityId, antipatternId, domain, schema version, release status or any other canonical root metadata.',
        'Do not generate canonical criterion IDs. Refer to adjacent criteria only by the supplied criterionHandle.',
        'Do not create canonical question, atomic, evidence, finding, source-mapping or tactic-mapping IDs.',
        'Do not author evidence, findings, source mappings, tactics or lifecycle consequences.',
        'Do not make legal applicability, compliance, approval or authorization conclusions.',
        'Do not redefine adjacent criteria; describe only the semantic boundary against them.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirPairBoundaryOutput',
        requiredFields: [
          'capability.canonicalDefinition',
          'capability.governancePurpose',
          'capability.distinctClaim',
          'capability.ownedTopics',
          'capability.excludedTopics',
          'antipattern.canonicalDefinition',
          'antipattern.pairedRelationship',
          'boundaryRationale'
        ],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'NONEMPTY_SEMANTIC_BOUNDARY',
        'ADJACENT_HANDLES_RESOLVE',
        'NO_CANONICAL_IDENTITY_FIELDS',
        'NO_OUT_OF_SCOPE_SECTIONS'
      ]
    }),
    contract({
      taskType: 'AP_FAILURE_MODEL',
      objective:
        'Define only the semantic anti-pattern failure mechanism and its distinguishing characteristics. Canonical anti-pattern identity is owned by the Authoring Plan and compiler.',
      lockedInputs: {
        ...governedInputs(plan),
        pair_boundary: seed.pairBoundary,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: ['AUTHORING_PLAN', 'VALIDATED_SIR_PAIR_BOUNDARY', 'CATEGORY_BASELINE', 'GOLDEN_REFERENCE'],
      doNot: [
        'Do not output canonical IDs or canonical references.',
        'Do not redefine the validated capability boundary.',
        'Do not author evidence, atomic tests, findings, source mappings or tactics.',
        'Do not infer anti-pattern presence or absence for any real system.',
        'Do not make legal non-compliance conclusions.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirApFailureModelOutput',
        requiredFields: [
          'failureMechanism',
          'triggeringConditions',
          'observableFailureSurfaces',
          'nonExamples',
          'distinctionFromCapabilityGap'
        ],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'FAILURE_MECHANISM_NONEMPTY',
        'NONEXAMPLES_PRESENT',
        'NO_CANONICAL_IDENTITY_FIELDS',
        'NO_EVIDENCE_OR_FINDING_CONTENT'
      ]
    }),
    contract({
      taskType: 'APPLICABILITY',
      objective:
        'Define semantic applicability for the capability and anti-pattern as separate but coherent content objects. Identity and canonical placement remain deterministic.',
      lockedInputs: {
        ...governedInputs(plan),
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_SIR_PAIR_BOUNDARY',
        'VALIDATED_SIR_AP_FAILURE_MODEL',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not output canonical IDs or canonical root metadata.',
        'Do not redefine the capability distinct claim or anti-pattern failure mechanism.',
        'Do not create blanket exclusions unsupported by the category baseline.',
        'Do not determine legal applicability for a real assessed system.',
        'Do not author primary questions, evidence, findings, source mappings, tactics or lifecycle consequences.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirApplicabilityOutput',
        requiredFields: [
          'capability.statement',
          'capability.conditions',
          'capability.exclusions',
          'capability.reassessmentTriggers',
          'antipattern.statement',
          'antipattern.conditions',
          'antipattern.exclusions',
          'antipattern.reassessmentTriggers',
          'consistencyNotes'
        ],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'APPLICABILITY_NONEMPTY',
        'REASSESSMENT_TRIGGERS_PRESENT',
        'PAIR_APPLICABILITY_COHERENCE',
        'NO_CANONICAL_IDENTITY_FIELDS'
      ]
    }),
    contract({
      taskType: 'PRIMARY_QUESTIONS',
      objective:
        'Author only the wording of the three governed primary-question slots for the capability and anti-pattern. Slot dimensions and future canonical question IDs are owned by the Authoring Plan and compiler.',
      lockedInputs: {
        ...governedInputs(plan),
        fixed_question_slots: plan.fixedQuestionSlots,
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        applicability: seed.applicability,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_SIR_PAIR_BOUNDARY',
        'VALIDATED_SIR_AP_FAILURE_MODEL',
        'VALIDATED_SIR_APPLICABILITY',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not output canonical question IDs.',
        'Do not output question dimensions; dimensions are fixed by the Authoring Plan.',
        'Do not change, omit or duplicate slots 1, 2 and 3.',
        'Do not create atomic criteria, evidence, findings, sources, tactics or lifecycle consequences.',
        'Do not make real-system compliance, applicability, approval or authorization conclusions.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirPrimaryQuestionsOutput',
        requiredFields: ['capabilityQuestions', 'antipatternQuestions', 'coverageRationale'],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'EXACTLY_THREE_QUESTION_SLOTS_PER_OBJECT',
        'QUESTION_SLOTS_FIXED_AND_ORDERED',
        'QUESTION_TEXT_NONEMPTY',
        'NO_CANONICAL_IDENTITY_FIELDS',
        'NO_OUT_OF_SCOPE_SECTIONS'
      ]
    })
  ];
}

export function buildPairFramePrompt(seed: PairFramePromptSeed): string {
  return joinTaskPrompts(pairFrameContracts(seed).map((item) => renderTaskPrompt(item)));
}
