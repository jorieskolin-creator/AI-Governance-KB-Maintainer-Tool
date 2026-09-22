import type { Finding, StrictnessTier, ValidationResult } from './finding.js';
import { applyTier } from './finding.js';
import { joinTaskPrompts, renderTaskPrompt, type PipelinePlan, type PromptContract } from './prompt.js';
import { schemaFindings } from './schema.js';

const meaningful = { type: 'string', minLength: 10 } as const;
const nonEmpty = { type: 'string', minLength: 1 } as const;
const technical = {
  type: 'string',
  enum: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED']
} as const;
const human = { type: 'string', enum: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'] } as const;
const handle = { type: 'string', pattern: '^atomic_[0-9]{3}$' } as const;

const ruleFamily = { type: 'array', minItems: 1, items: nonEmpty } as const;

export const evidenceAndSafetySchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ai-governance-kb.local/pipeline/evidence-and-safety.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['atomicDecomposition', 'evidenceArchitecture', 'evidenceSafety', 'apAbsenceContract'],
  properties: {
    atomicDecomposition: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilitySubcriteria', 'antipatternTests', 'coverageNotes'],
      properties: {
        capabilitySubcriteria: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['questionSlot', 'criterion', 'evidenceNeed'],
            properties: {
              questionSlot: { type: 'integer', enum: [1, 2, 3] },
              criterion: meaningful,
              evidenceNeed: meaningful
            }
          }
        },
        antipatternTests: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['questionSlot', 'test', 'evidenceNeed'],
            properties: {
              questionSlot: { type: 'integer', enum: [1, 2, 3] },
              test: meaningful,
              evidenceNeed: meaningful
            }
          }
        },
        coverageNotes: { type: 'array', items: nonEmpty }
      }
    },
    evidenceArchitecture: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilityEvidence', 'antipatternEvidence', 'sufficiencyNotes'],
      properties: {
        capabilityEvidence: { $ref: '#/$defs/evidenceList' },
        antipatternEvidence: { $ref: '#/$defs/evidenceList' },
        sufficiencyNotes: { type: 'array', items: nonEmpty }
      }
    },
    evidenceSafety: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilityRules', 'antipatternRules', 'crossPairSafetyNotes'],
      properties: {
        capabilityRules: { $ref: '#/$defs/rules' },
        antipatternRules: { $ref: '#/$defs/rules' },
        crossPairSafetyNotes: { type: 'array', items: nonEmpty }
      }
    },
    apAbsenceContract: {
      type: 'object',
      additionalProperties: false,
      required: ['requiredArtifacts', 'interpretationBoundary'],
      properties: {
        requiredArtifacts: { type: 'array', minItems: 1, items: nonEmpty },
        interpretationBoundary: meaningful
      }
    }
  },
  $defs: {
    evidenceList: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'claimSupported',
          'evidenceClass',
          'minimumTechnicalAssurance',
          'requiredHumanAssurance',
          'acceptanceConditions',
          'limitations',
          'supportsAtomicHandles'
        ],
        properties: {
          title: { type: 'string', minLength: 3 },
          claimSupported: meaningful,
          evidenceClass: nonEmpty,
          minimumTechnicalAssurance: technical,
          requiredHumanAssurance: human,
          acceptanceConditions: { type: 'array', minItems: 1, items: nonEmpty },
          limitations: { type: 'array', minItems: 1, items: nonEmpty },
          supportsAtomicHandles: { type: 'array', minItems: 1, items: handle }
        }
      }
    },
    rules: {
      type: 'object',
      additionalProperties: false,
      required: [
        'evidenceCeilings',
        'falsePositiveGuards',
        'prohibitedInferences',
        'contradictionHandling',
        'freshnessRules'
      ],
      properties: {
        evidenceCeilings: ruleFamily,
        falsePositiveGuards: ruleFamily,
        prohibitedInferences: ruleFamily,
        contradictionHandling: ruleFamily,
        freshnessRules: ruleFamily
      }
    }
  }
} as const;

export interface AtomicDecompositionOutput {
  capabilitySubcriteria: Array<{ questionSlot: 1 | 2 | 3; criterion: string; evidenceNeed: string }>;
  antipatternTests: Array<{ questionSlot: 1 | 2 | 3; test: string; evidenceNeed: string }>;
  coverageNotes: string[];
}

export interface EvidenceItem {
  title: string;
  claimSupported: string;
  evidenceClass: string;
  minimumTechnicalAssurance: 'UNKNOWN' | 'DECLARED' | 'IMPLEMENTED' | 'TESTED' | 'OPERATIONALLY_OBSERVED';
  requiredHumanAssurance: 'PENDING' | 'HUMAN_VALIDATED' | 'FORMALLY_APPROVED';
  acceptanceConditions: string[];
  limitations: string[];
  supportsAtomicHandles: string[];
}

export interface EvidenceArchitectureOutput {
  capabilityEvidence: EvidenceItem[];
  antipatternEvidence: EvidenceItem[];
  sufficiencyNotes: string[];
}

export interface EvidenceRules {
  evidenceCeilings: string[];
  falsePositiveGuards: string[];
  prohibitedInferences: string[];
  contradictionHandling: string[];
  freshnessRules: string[];
}

export interface EvidenceSafetyOutput {
  capabilityRules: EvidenceRules;
  antipatternRules: EvidenceRules;
  crossPairSafetyNotes: string[];
}

export interface ApAbsenceOutput {
  requiredArtifacts: string[];
  interpretationBoundary: string;
}

export interface EvidenceAndSafetyOutput {
  atomicDecomposition: AtomicDecompositionOutput;
  evidenceArchitecture: EvidenceArchitectureOutput;
  evidenceSafety: EvidenceSafetyOutput;
  apAbsenceContract: ApAbsenceOutput;
}

function coveredSlots(items: unknown, slotKey: 'questionSlot'): Set<unknown> {
  const slots = new Set<unknown>();
  if (!Array.isArray(items)) return slots;
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      slots.add((item as Record<string, unknown>)[slotKey]);
    }
  }
  return slots;
}

function slotCoverageFindings(output: unknown): Finding[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const atomic = (output as { atomicDecomposition?: unknown }).atomicDecomposition;
  if (!atomic || typeof atomic !== 'object' || Array.isArray(atomic)) return [];
  const record = atomic as Record<string, unknown>;
  const findings: Finding[] = [];
  for (const key of ['capabilitySubcriteria', 'antipatternTests'] as const) {
    const slots = coveredSlots(record[key], 'questionSlot');
    for (const expected of [1, 2, 3]) {
      if (!slots.has(expected)) {
        findings.push({
          code: 'EVERY_PRIMARY_QUESTION_SLOT_COVERED',
          path: `/atomicDecomposition/${key}`,
          message: `Question slot ${String(expected)} has no atomic item.`
        });
      }
    }
  }
  return findings;
}

export function validateEvidenceAndSafety(output: unknown, tier: StrictnessTier = 'RELEASE'): ValidationResult {
  return applyTier(schemaFindings(evidenceAndSafetySchema, output), slotCoverageFindings(output), tier);
}

export interface EvidenceAndSafetyPromptSeed {
  plan: PipelinePlan;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
  pairBoundary: unknown;
  apFailureModel: unknown;
  applicability: unknown;
  primaryQuestions: unknown;
  atomics: { capability: unknown; antipattern: unknown };
  evidence: { capability: unknown; antipattern: unknown };
  evidenceSafety: { capabilityRules: unknown; antipatternRules: unknown };
}

function contract(partial: Omit<PromptContract, 'contractVersion' | 'failureMode'>): PromptContract {
  return { contractVersion: '2.0.0', failureMode: 'FAIL_CLOSED', ...partial };
}

export function evidenceAndSafetyContracts(seed: EvidenceAndSafetyPromptSeed): PromptContract[] {
  const plan = seed.plan;
  const baseLocked = {
    authoring_plan_id: plan.planId,
    authoring_plan_sha256: plan.planSha256
  };
  return [
    contract({
      taskType: 'ATOMIC_DECOMPOSITION',
      objective:
        'Decompose each validated primary-question slot into independently assessable capability subcriteria and independently executable anti-pattern tests. Return semantic content only. The orchestrator will assign local SIR handles after validation and the canonical compiler will later assign canonical IDs.',
      lockedInputs: {
        ...baseLocked,
        fixed_question_slots: plan.fixedQuestionSlots,
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        applicability: seed.applicability,
        primary_questions: seed.primaryQuestions,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_SIR_PAIR_BOUNDARY',
        'VALIDATED_SIR_AP_FAILURE_MODEL',
        'VALIDATED_SIR_APPLICABILITY',
        'VALIDATED_SIR_PRIMARY_QUESTIONS',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not create canonical IDs.',
        'Do not create SIR local handles; handles are assigned by deterministic code after validation.',
        'Do not output canonical question IDs or dimensions; use only questionSlot 1, 2 or 3.',
        'Do not create evidence objects, evidence IDs, findings, sources, tactics or lifecycle consequences.',
        'Do not rewrite primary questions or previously validated semantic boundaries.',
        'Do not hard-code collection depth from the Golden reference; create the number of atomic items semantically required for this category.',
        'Do not combine materially independent assessment obligations into one atomic item.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirAtomicDecompositionOutput',
        requiredFields: ['capabilitySubcriteria', 'antipatternTests', 'coverageNotes'],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'NO_MODEL_OWNED_HANDLES',
        'QUESTION_SLOTS_RESOLVE',
        'EVERY_PRIMARY_QUESTION_SLOT_COVERED',
        'ATOMIC_CONTENT_NONEMPTY',
        'EVIDENCE_NEED_DESCRIBED_WITHOUT_EVIDENCE_IDS',
        'NO_CANONICAL_IDENTITY_FIELDS'
      ]
    }),
    contract({
      taskType: 'EVIDENCE_ARCHITECTURE',
      objective:
        'Define semantic evidence requirements for the validated capability and anti-pattern atomic items. Return evidence meaning and exact relationships to supplied local atomic handles only. Deterministic code will assign evidence handles and the canonical compiler will later materialize all EVD-* IDs and canonical reference fields.',
      lockedInputs: {
        ...baseLocked,
        governed_technical_assurance_vocabulary: plan.vocabulary.technicalAssurance,
        governed_human_assurance_vocabulary: plan.vocabulary.humanAssurance,
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        applicability: seed.applicability,
        primary_questions: seed.primaryQuestions,
        capability_atomics: seed.atomics.capability,
        antipattern_atomics: seed.atomics.antipattern,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_SIR_PAIR_BOUNDARY',
        'VALIDATED_SIR_AP_FAILURE_MODEL',
        'VALIDATED_SIR_APPLICABILITY',
        'VALIDATED_SIR_PRIMARY_QUESTIONS',
        'VALIDATED_MATERIALIZED_SIR_ATOMICS',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not create canonical IDs or canonical reference strings.',
        'Do not create evidence local handles; deterministic code assigns evidence handles after validation.',
        'Do not rewrite atomic items or invent atomic handles that were not supplied.',
        'Do not leave any supplied atomic item without at least one evidence relationship.',
        'Do not create an evidence item that supports no atomic item.',
        'Do not infer implementation, testing, effectiveness or legal compliance merely from document presence.',
        'Do not author evidence ceilings, false-positive guards, prohibited inferences, contradiction handling or freshness rules; those belong to EVIDENCE_SAFETY.',
        'Do not create findings, source mappings, tactic mappings or lifecycle consequences.',
        'Do not copy evidence counts from the Golden reference; semantic collection depth is category-specific.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirEvidenceArchitectureOutput',
        requiredFields: ['capabilityEvidence', 'antipatternEvidence', 'sufficiencyNotes'],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'NO_MODEL_OWNED_EVIDENCE_HANDLES',
        'ATOMIC_HANDLES_RESOLVE_TO_SUPPLIED_OBJECT',
        'EVERY_ATOMIC_ITEM_HAS_EVIDENCE',
        'EVERY_EVIDENCE_ITEM_SUPPORTS_AT_LEAST_ONE_ATOMIC',
        'ASSURANCE_VALUES_FROM_GOVERNED_VOCABULARY',
        'ACCEPTANCE_CONDITIONS_PRESENT',
        'LIMITATIONS_PRESENT',
        'NO_CANONICAL_IDENTITY_FIELDS'
      ]
    }),
    contract({
      taskType: 'EVIDENCE_SAFETY',
      objective:
        'Define semantic evidence-interpretation safeguards for the validated capability and anti-pattern evidence graph: evidence ceilings, false-positive guards, prohibited inferences, contradiction handling and freshness rules. Return rule content only; identity and canonical placement remain deterministic.',
      lockedInputs: {
        ...baseLocked,
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        applicability: seed.applicability,
        primary_questions: seed.primaryQuestions,
        capability_atomics: seed.atomics.capability,
        antipattern_atomics: seed.atomics.antipattern,
        capability_evidence: seed.evidence.capability,
        antipattern_evidence: seed.evidence.antipattern,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_SIR_PAIR_BOUNDARY',
        'VALIDATED_SIR_AP_FAILURE_MODEL',
        'VALIDATED_SIR_APPLICABILITY',
        'VALIDATED_SIR_PRIMARY_QUESTIONS',
        'VALIDATED_MATERIALIZED_SIR_ATOMICS',
        'VALIDATED_MATERIALIZED_SIR_EVIDENCE',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not create or rewrite evidence objects, atomic items or primary questions.',
        'Do not create canonical IDs, local handles or canonical references.',
        'Do not raise assurance beyond what an evidence item can establish.',
        'Do not treat policy or document presence alone as proof of implementation, testing or operational effectiveness.',
        'Do not treat missing incidents, complaints or discovered evidence as proof that the anti-pattern is absent.',
        'Do not infer legal compliance, legal applicability, residual-risk acceptance or lifecycle authorization.',
        'Do not define the formal TESTED_ABSENT contract here; AP_ABSENCE_CONTRACT owns that semantic decision.',
        'Do not create findings, source mappings, tactic mappings or lifecycle consequences.',
        'Do not copy rule counts or wording from the Golden reference unless independently justified by this category.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirEvidenceSafetyOutput',
        requiredFields: [
          'capabilityRules.evidenceCeilings',
          'capabilityRules.falsePositiveGuards',
          'capabilityRules.prohibitedInferences',
          'capabilityRules.contradictionHandling',
          'capabilityRules.freshnessRules',
          'antipatternRules.evidenceCeilings',
          'antipatternRules.falsePositiveGuards',
          'antipatternRules.prohibitedInferences',
          'antipatternRules.contradictionHandling',
          'antipatternRules.freshnessRules',
          'crossPairSafetyNotes'
        ],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'ALL_EVIDENCE_RULE_FAMILIES_PRESENT',
        'NO_EMPTY_RULE_FAMILIES',
        'ANTI_PATTERN_ABSENCE_NOT_INFERRED_FROM_SILENCE',
        'NO_DOCUMENT_PRESENCE_EQUALS_IMPLEMENTATION',
        'NO_LEGAL_OR_LIFECYCLE_AUTHORIZATION_INFERENCE',
        'NO_CANONICAL_IDENTITY_FIELDS'
      ]
    }),
    contract({
      taskType: 'AP_ABSENCE_CONTRACT',
      objective:
        'Author only the semantic artifact requirements and interpretation boundary for the anti-pattern absence-test knowledge contract. Structural boolean requirements are deterministic constants.',
      lockedInputs: {
        ...baseLocked,
        normative_absence_conditions: {
          scope_defined: true,
          executed: true,
          successful: true,
          current: true,
          independently_verified: true
        },
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        applicability: seed.applicability,
        primary_questions: seed.primaryQuestions,
        antipattern_atomics: seed.atomics.antipattern,
        antipattern_evidence: seed.evidence.antipattern,
        antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_SIR_PAIR_BOUNDARY',
        'VALIDATED_SIR_AP_FAILURE_MODEL',
        'VALIDATED_SIR_APPLICABILITY',
        'VALIDATED_SIR_PRIMARY_QUESTIONS',
        'VALIDATED_MATERIALIZED_SIR_ATOMICS',
        'VALIDATED_MATERIALIZED_SIR_EVIDENCE',
        'VALIDATED_SIR_EVIDENCE_SAFETY',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not output the five normative boolean conditions.',
        'Do not make a real-system absence conclusion.',
        'Do not rewrite upstream semantic artifacts.',
        'Do not create canonical IDs or downstream mappings.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirApAbsenceOutput',
        requiredFields: ['requiredArtifacts', 'interpretationBoundary'],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'REQUIRED_ARTIFACTS_NONEMPTY',
        'INTERPRETATION_BOUNDARY_NONEMPTY',
        'NORMATIVE_ABSENCE_BOOLEANS_NOT_MODEL_AUTHORED'
      ]
    })
  ];
}

export function buildEvidenceAndSafetyPrompt(seed: EvidenceAndSafetyPromptSeed): string {
  return joinTaskPrompts(evidenceAndSafetyContracts(seed).map((item) => renderTaskPrompt(item)));
}
