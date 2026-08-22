import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from './sir-initial-contracts.js';

export interface SirEvidenceContent {
  title: string;
  claimSupported: string;
  evidenceClass: string;
  minimumTechnicalAssurance: string;
  requiredHumanAssurance: string;
  acceptanceConditions: string[];
  limitations: string[];
  supportsAtomicHandles: string[];
}

export interface SirEvidenceArchitectureOutput {
  capabilityEvidence: SirEvidenceContent[];
  antipatternEvidence: SirEvidenceContent[];
  sufficiencyNotes: string[];
}

export interface SirEvidenceArchitectureSeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
  primaryQuestions: SirPrimaryQuestionsOutput;
  atomics: MaterializedSirAtomics;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirEvidenceArchitectureContract(
  seed: SirEvidenceArchitectureSeed
): TaskContract<SirEvidenceArchitectureOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:EVIDENCE_ARCHITECTURE:SIR`,
    taskType: 'EVIDENCE_ARCHITECTURE',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define semantic evidence requirements for the validated capability and anti-pattern atomic items. Return evidence meaning and exact relationships to supplied local atomic handles only. Deterministic code will assign evidence handles and the canonical compiler will later materialize all EVD-* IDs and canonical reference fields.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'AP_FAILURE_MODEL',
      'APPLICABILITY',
      'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      governed_technical_assurance_vocabulary: seed.authoringPlan.vocabulary.technicalAssurance,
      governed_human_assurance_vocabulary: seed.authoringPlan.vocabulary.humanAssurance,
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
    ],
    dependencyPaths: [
      'sir.capability.evidence',
      'sir.capability.atomics.supportingEvidenceHandles',
      'sir.antipattern.evidence',
      'sir.antipattern.atomics.supportingEvidenceHandles'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}
