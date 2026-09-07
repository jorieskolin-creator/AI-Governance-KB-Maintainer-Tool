import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type { SirEvidenceSafetyOutput } from './sir-evidence-safety-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from './sir-initial-contracts.js';

export interface SirApAbsenceOutput {
  requiredArtifacts: string[];
  interpretationBoundary: string;
}

export interface SirApAbsenceSeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
  primaryQuestions: SirPrimaryQuestionsOutput;
  atomics: MaterializedSirAtomics;
  evidence: MaterializedSirEvidence;
  evidenceSafety: SirEvidenceSafetyOutput;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirApAbsenceContract(seed: SirApAbsenceSeed): TaskContract<SirApAbsenceOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:AP_ABSENCE_CONTRACT:SIR`,
    taskType: 'AP_ABSENCE_CONTRACT',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective: 'Author only the semantic artifact requirements and interpretation boundary for the anti-pattern absence-test knowledge contract. Structural boolean requirements are deterministic constants.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY', 'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION', 'EVIDENCE_ARCHITECTURE', 'EVIDENCE_SAFETY'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
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
      'AUTHORING_PLAN', 'VALIDATED_SIR_PAIR_BOUNDARY', 'VALIDATED_SIR_AP_FAILURE_MODEL',
      'VALIDATED_SIR_APPLICABILITY', 'VALIDATED_SIR_PRIMARY_QUESTIONS',
      'VALIDATED_MATERIALIZED_SIR_ATOMICS', 'VALIDATED_MATERIALIZED_SIR_EVIDENCE',
      'VALIDATED_SIR_EVIDENCE_SAFETY', 'CATEGORY_BASELINE', 'GOLDEN_REFERENCE'
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
    ],
    dependencyPaths: ['sir.antipattern.absenceTest'],
    failureMode: 'FAIL_CLOSED'
  };
}
