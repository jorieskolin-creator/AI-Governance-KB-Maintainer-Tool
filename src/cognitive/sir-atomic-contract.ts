import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from './sir-initial-contracts.js';

export interface SirAtomicCapabilityContent {
  questionSlot: 1 | 2 | 3;
  criterion: string;
  evidenceNeed: string;
}

export interface SirAtomicAntipatternContent {
  questionSlot: 1 | 2 | 3;
  test: string;
  evidenceNeed: string;
}

export interface SirAtomicDecompositionOutput {
  capabilitySubcriteria: SirAtomicCapabilityContent[];
  antipatternTests: SirAtomicAntipatternContent[];
  coverageNotes: string[];
}

export interface SirAtomicDecompositionSeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
  primaryQuestions: SirPrimaryQuestionsOutput;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirAtomicDecompositionContract(
  seed: SirAtomicDecompositionSeed
): TaskContract<SirAtomicDecompositionOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:ATOMIC_DECOMPOSITION:SIR`,
    taskType: 'ATOMIC_DECOMPOSITION',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Decompose each validated primary-question slot into independently assessable capability subcriteria and independently executable anti-pattern tests. Return semantic content only. The orchestrator will assign local SIR handles after validation and the canonical compiler will later assign canonical IDs.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY', 'PRIMARY_QUESTIONS'],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      fixed_question_slots: seed.authoringPlan.fixedQuestionSlots,
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
      requiredFields: [
        'capabilitySubcriteria',
        'antipatternTests',
        'coverageNotes'
      ],
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
    ],
    dependencyPaths: ['sir.capability.atomics', 'sir.antipattern.atomics'],
    failureMode: 'FAIL_CLOSED'
  };
}
