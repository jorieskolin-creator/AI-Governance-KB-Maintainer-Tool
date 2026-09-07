import type { TaskContract } from '../domain/task-contract.js';
import type {
  ApplicabilityOutput,
  ApFailureModelOutput,
  PairBoundaryOutput
} from './initial-contracts.js';

export type QuestionDimension =
  | 'DEFINITION_AND_INTENT'
  | 'IMPLEMENTATION_AND_OPERATION'
  | 'EVIDENCE_AND_EFFECTIVENESS';

export interface PrimaryQuestion {
  id: string;
  dimension: QuestionDimension;
  question: string;
}

export interface PrimaryQuestionsSeed {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  applicability: ApplicabilityOutput;
  categoryBaseline: Record<string, unknown>;
  goldenStandardQuestionRules: Record<string, unknown>;
}

export interface PrimaryQuestionsOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityQuestions: [PrimaryQuestion, PrimaryQuestion, PrimaryQuestion];
  antipatternQuestions: [PrimaryQuestion, PrimaryQuestion, PrimaryQuestion];
  coverageRationale: string;
}

export interface CapabilityAtomicSubcriterionDraft {
  id: string;
  questionId: string;
  criterion: string;
  evidenceNeed: string;
}

export interface AntipatternAtomicTestDraft {
  id: string;
  questionId: string;
  test: string;
  evidenceNeed: string;
}

export interface AtomicDecompositionSeed {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  applicability: ApplicabilityOutput;
  primaryQuestions: PrimaryQuestionsOutput;
  categoryBaseline: Record<string, unknown>;
  goldenStandardAtomicityRules: Record<string, unknown>;
}

export interface AtomicDecompositionOutput {
  capabilityId: string;
  antipatternId: string;
  capabilitySubcriteria: CapabilityAtomicSubcriterionDraft[];
  antipatternTests: AntipatternAtomicTestDraft[];
  coverageNotes: string[];
}

export type TechnicalAssurance =
  | 'UNKNOWN'
  | 'DECLARED'
  | 'IMPLEMENTED'
  | 'TESTED'
  | 'OPERATIONALLY_OBSERVED';

export type HumanAssurance = 'PENDING' | 'HUMAN_VALIDATED' | 'FORMALLY_APPROVED';

export interface EvidenceRequirementDraft {
  id: string;
  title: string;
  claimSupported: string;
  evidenceClass: string;
  minimumTechnicalAssurance: TechnicalAssurance;
  requiredHumanAssurance: HumanAssurance;
  acceptanceConditions: string[];
  limitations: string[];
}

export interface AtomicEvidenceBinding {
  atomicItemId: string;
  evidenceIds: string[];
}

export interface EvidenceArchitectureSeed {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  applicability: ApplicabilityOutput;
  primaryQuestions: PrimaryQuestionsOutput;
  atomicDecomposition: AtomicDecompositionOutput;
  categoryBaseline: Record<string, unknown>;
  goldenStandardEvidenceRules: Record<string, unknown>;
}

export interface EvidenceArchitectureOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityEvidence: EvidenceRequirementDraft[];
  antipatternEvidence: EvidenceRequirementDraft[];
  capabilityBindings: AtomicEvidenceBinding[];
  antipatternBindings: AtomicEvidenceBinding[];
  sufficiencyNotes: string[];
}

export interface EvidenceRulesDraft {
  evidenceCeilings: string[];
  falsePositiveGuards: string[];
  prohibitedInferences: string[];
  contradictionHandling: string[];
  freshnessRules: string[];
}

export interface EvidenceSafetySeed {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  applicability: ApplicabilityOutput;
  primaryQuestions: PrimaryQuestionsOutput;
  atomicDecomposition: AtomicDecompositionOutput;
  evidenceArchitecture: EvidenceArchitectureOutput;
  categoryBaseline: Record<string, unknown>;
  goldenStandardEvidenceSafetyRules: Record<string, unknown>;
}

export interface EvidenceSafetyOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityRules: EvidenceRulesDraft;
  antipatternRules: EvidenceRulesDraft;
  crossPairSafetyNotes: string[];
}

const CONTRACT_VERSION = '1.0.0';

export function buildPrimaryQuestionsContract(
  seed: PrimaryQuestionsSeed
): TaskContract<PrimaryQuestionsOutput> {
  const capabilityId = seed.pairBoundary.capabilityId;
  const antipatternId = seed.pairBoundary.antipatternId;

  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:PRIMARY_QUESTIONS`,
    taskType: 'PRIMARY_QUESTIONS',
    targetObjectId: seed.pairBoundary.pairId,
    objective:
      'Author exactly three primary assessment questions for the capability and exactly three for the paired anti-pattern using the fixed dimensions DEFINITION_AND_INTENT, IMPLEMENTATION_AND_OPERATION, and EVIDENCE_AND_EFFECTIVENESS. Each question must test the validated semantic boundary without introducing evidence objects, findings, sources or controls.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY'],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      category_baseline: seed.categoryBaseline,
      golden_standard_question_rules: seed.goldenStandardQuestionRules,
      required_capability_question_ids: [`${capabilityId}-Q1`, `${capabilityId}-Q2`, `${capabilityId}-Q3`],
      required_antipattern_question_ids: [
        `${antipatternId}-Q1`,
        `${antipatternId}-Q2`,
        `${antipatternId}-Q3`
      ],
      required_dimension_order: [
        'DEFINITION_AND_INTENT',
        'IMPLEMENTATION_AND_OPERATION',
        'EVIDENCE_AND_EFFECTIVENESS'
      ]
    },
    allowedReferences: [
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_AP_FAILURE_MODEL',
      'VALIDATED_APPLICABILITY',
      'CATEGORY_BASELINE',
      'GOLDEN_STANDARD'
    ],
    doNot: [
      'Do not redefine the capability distinct claim, anti-pattern failure mechanism or applicability.',
      'Do not change, omit, reorder or invent question IDs or dimensions.',
      'Do not create atomic criteria, atomic tests, evidence, findings, source mappings, tactics or lifecycle consequences.',
      'Do not combine multiple dimensions into one question.',
      'Do not make real-system compliance, applicability, approval or authorization conclusions.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'PrimaryQuestionsOutput',
      requiredFields: [
        'capabilityId',
        'antipatternId',
        'capabilityQuestions',
        'antipatternQuestions',
        'coverageRationale'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'CAPABILITY_ID_MATCH',
      'ANTIPATTERN_ID_MATCH',
      'EXACTLY_THREE_QUESTIONS_PER_OBJECT',
      'QUESTION_IDS_DETERMINISTIC',
      'QUESTION_DIMENSIONS_FIXED_AND_ORDERED',
      'QUESTION_TEXT_NONEMPTY',
      'NO_OUT_OF_SCOPE_SECTIONS'
    ],
    dependencyPaths: ['capability.primary_questions', 'antipattern.primary_questions'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildAtomicDecompositionContract(
  seed: AtomicDecompositionSeed
): TaskContract<AtomicDecompositionOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:ATOMIC_DECOMPOSITION`,
    taskType: 'ATOMIC_DECOMPOSITION',
    targetObjectId: seed.pairBoundary.pairId,
    objective:
      'Decompose each validated primary question into independently assessable capability subcriteria and independently executable anti-pattern tests. Keep every atomic item single-purpose and traceable to exactly one primary question. Describe the evidence need semantically, but do not create evidence objects or final evidence IDs.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY', 'PRIMARY_QUESTIONS'],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      primary_questions: seed.primaryQuestions,
      category_baseline: seed.categoryBaseline,
      golden_standard_atomicity_rules: seed.goldenStandardAtomicityRules,
      capability_atomic_id_rule: `${seed.pairBoundary.capabilityId}-SC-001..n in output order`,
      antipattern_atomic_id_rule: `${seed.pairBoundary.antipatternId}-AT-001..n in output order`
    },
    allowedReferences: [
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_AP_FAILURE_MODEL',
      'VALIDATED_APPLICABILITY',
      'VALIDATED_PRIMARY_QUESTIONS',
      'CATEGORY_BASELINE',
      'GOLDEN_STANDARD'
    ],
    doNot: [
      'Do not redefine or rewrite primary questions.',
      'Do not merge Definition/Intent, Implementation/Operation and Evidence/Effectiveness into one atomic item.',
      'Do not create evidence IDs, evidence acceptance conditions, findings, sources, tactics or lifecycle consequences.',
      'Do not create an atomic item that is not traceable to exactly one supplied question ID.',
      'Do not skip a supplied primary question.',
      'Do not create legal or governance conclusions; define assessable criteria/tests only.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'AtomicDecompositionOutput',
      requiredFields: [
        'capabilityId',
        'antipatternId',
        'capabilitySubcriteria',
        'antipatternTests',
        'coverageNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'CAPABILITY_ID_MATCH',
      'ANTIPATTERN_ID_MATCH',
      'ATOMIC_IDS_SEQUENTIAL_AND_DETERMINISTIC',
      'ATOMIC_QUESTION_REFERENCES_RESOLVE',
      'EVERY_PRIMARY_QUESTION_COVERED',
      'ATOMIC_ITEMS_NONEMPTY',
      'EVIDENCE_NEED_DESCRIBED_WITHOUT_EVIDENCE_IDS',
      'NO_OUT_OF_SCOPE_SECTIONS'
    ],
    dependencyPaths: ['capability.atomic_subcriteria', 'antipattern.atomic_tests'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildEvidenceArchitectureContract(
  seed: EvidenceArchitectureSeed
): TaskContract<EvidenceArchitectureOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:EVIDENCE_ARCHITECTURE`,
    taskType: 'EVIDENCE_ARCHITECTURE',
    targetObjectId: seed.pairBoundary.pairId,
    objective:
      'Define the evidence requirements needed to assess the validated capability subcriteria and anti-pattern tests. For each evidence object define the supported claim, assurance floor, acceptance conditions and limitations, then bind atomic items to evidence IDs. Do not author evidence safety rules, findings or source mappings.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'AP_FAILURE_MODEL',
      'APPLICABILITY',
      'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION'
    ],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      primary_questions: seed.primaryQuestions,
      atomic_decomposition: seed.atomicDecomposition,
      category_baseline: seed.categoryBaseline,
      golden_standard_evidence_rules: seed.goldenStandardEvidenceRules,
      capability_evidence_id_rule: `EVD-${seed.pairBoundary.capabilityId}-001..n in output order`,
      antipattern_evidence_id_rule: `EVD-${seed.pairBoundary.antipatternId}-001..n in output order`
    },
    allowedReferences: [
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_AP_FAILURE_MODEL',
      'VALIDATED_APPLICABILITY',
      'VALIDATED_PRIMARY_QUESTIONS',
      'VALIDATED_ATOMIC_DECOMPOSITION',
      'CATEGORY_BASELINE',
      'GOLDEN_STANDARD'
    ],
    doNot: [
      'Do not rewrite atomic criteria or tests.',
      'Do not create evidence objects that support no atomic item.',
      'Do not leave any atomic item without at least one evidence binding.',
      'Do not claim that document presence proves implementation, testing or operational effectiveness.',
      'Do not author evidence ceilings, false-positive guards, prohibited inferences, contradiction rules or freshness rules; those belong to EVIDENCE_SAFETY.',
      'Do not create findings, source mappings, tactics or lifecycle consequences.',
      'Do not infer legal compliance from any evidence requirement.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'EvidenceArchitectureOutput',
      requiredFields: [
        'capabilityId',
        'antipatternId',
        'capabilityEvidence',
        'antipatternEvidence',
        'capabilityBindings',
        'antipatternBindings',
        'sufficiencyNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'CAPABILITY_ID_MATCH',
      'ANTIPATTERN_ID_MATCH',
      'EVIDENCE_IDS_SEQUENTIAL_AND_DETERMINISTIC',
      'EVIDENCE_OBJECTS_NONEMPTY',
      'ATOMIC_BINDINGS_RESOLVE',
      'EVERY_ATOMIC_ITEM_HAS_EVIDENCE',
      'EVERY_EVIDENCE_OBJECT_IS_USED',
      'ASSURANCE_VALUES_ALLOWED',
      'ACCEPTANCE_CONDITIONS_AND_LIMITATIONS_PRESENT',
      'NO_OUT_OF_SCOPE_SECTIONS'
    ],
    dependencyPaths: [
      'capability.required_evidence',
      'capability.atomic_subcriteria.required_evidence_ids',
      'antipattern.required_evidence',
      'antipattern.atomic_tests.required_evidence_ids'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildEvidenceSafetyContract(
  seed: EvidenceSafetySeed
): TaskContract<EvidenceSafetyOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:EVIDENCE_SAFETY`,
    taskType: 'EVIDENCE_SAFETY',
    targetObjectId: seed.pairBoundary.pairId,
    objective:
      'Define the evidence interpretation safeguards for the capability and anti-pattern: evidence ceilings, false-positive guards, prohibited inferences, contradiction handling and freshness rules. Protect against unsupported positive conclusions and unsupported anti-pattern absence without changing evidence objects or atomic content.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'AP_FAILURE_MODEL',
      'APPLICABILITY',
      'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION',
      'EVIDENCE_ARCHITECTURE'
    ],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      primary_questions: seed.primaryQuestions,
      atomic_decomposition: seed.atomicDecomposition,
      evidence_architecture: seed.evidenceArchitecture,
      category_baseline: seed.categoryBaseline,
      golden_standard_evidence_safety_rules: seed.goldenStandardEvidenceSafetyRules
    },
    allowedReferences: [
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_AP_FAILURE_MODEL',
      'VALIDATED_APPLICABILITY',
      'VALIDATED_PRIMARY_QUESTIONS',
      'VALIDATED_ATOMIC_DECOMPOSITION',
      'VALIDATED_EVIDENCE_ARCHITECTURE',
      'CATEGORY_BASELINE',
      'GOLDEN_STANDARD'
    ],
    doNot: [
      'Do not rewrite evidence requirements, atomic criteria/tests or primary questions.',
      'Do not raise assurance beyond what the evidence class and scope can establish.',
      'Do not treat missing incidents, complaints, contradictions or discovered evidence as proof that an anti-pattern is absent.',
      'Do not infer implementation from policy/document approval.',
      'Do not infer legal compliance, legal applicability, residual-risk acceptance or lifecycle authorization.',
      'Do not create findings, source mappings, tactics or lifecycle consequences.',
      'Do not author the formal anti-pattern absence-test contract in this task; define interpretation safeguards only.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'EvidenceSafetyOutput',
      requiredFields: [
        'capabilityId',
        'antipatternId',
        'capabilityRules',
        'antipatternRules',
        'crossPairSafetyNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'CAPABILITY_ID_MATCH',
      'ANTIPATTERN_ID_MATCH',
      'ALL_EVIDENCE_RULE_FAMILIES_PRESENT',
      'NO_EMPTY_RULE_FAMILIES',
      'ANTI_PATTERN_ABSENCE_NOT_INFERRED_FROM_SILENCE',
      'NO_LEGAL_COMPLIANCE_INFERENCE',
      'NO_OUT_OF_SCOPE_SECTIONS'
    ],
    dependencyPaths: ['capability.evidence_rules', 'antipattern.evidence_rules'],
    failureMode: 'FAIL_CLOSED'
  };
}
