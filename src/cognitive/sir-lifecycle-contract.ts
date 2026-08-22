import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import type { SirApAbsenceOutput } from './sir-ap-absence-contract.js';
import type { SirControlBoundaryOutput } from './sir-control-contract.js';
import type { SirEvidenceSafetyOutput } from './sir-evidence-safety-contract.js';
import type { SirPairBoundaryOutput } from './sir-initial-contracts.js';

export type SirTechnicalAssurance =
  | 'UNKNOWN'
  | 'DECLARED'
  | 'IMPLEMENTED'
  | 'TESTED'
  | 'OPERATIONALLY_OBSERVED';

export type SirHumanAssurance =
  | 'PENDING'
  | 'HUMAN_VALIDATED'
  | 'FORMALLY_APPROVED';

export interface SirLifecycleAssuranceTargetContent {
  minimumTechnicalAssurance: SirTechnicalAssurance;
  requiredHumanAssurance: SirHumanAssurance;
}

export interface SirLifecycleAssuranceOutput {
  capabilityTargets: SirLifecycleAssuranceTargetContent[];
  antipatternTargets: SirLifecycleAssuranceTargetContent[];
  rationaleNotes: string[];
}

export interface SirLifecycleAssuranceSeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  evidence: MaterializedSirEvidence;
  evidenceSafety: SirEvidenceSafetyOutput;
  apAbsence: SirApAbsenceOutput;
  findings: MaterializedSirFindings;
  controlBoundary: SirControlBoundaryOutput;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirLifecycleAssuranceContract(
  seed: SirLifecycleAssuranceSeed
): TaskContract<SirLifecycleAssuranceOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:LIFECYCLE_ASSURANCE:SIR`,
    taskType: 'LIFECYCLE_ASSURANCE',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define minimum technical assurance and required human assurance for the capability and anti-pattern at every governed lifecycle stage. Return assurance values only, in exactly the same positional order as the locked lifecycle_stage_order. Deterministic code owns lifecycle-stage identity and will materialize stage names after validation. These are reusable knowledge targets, not approval or authorization decisions for a real system.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'AP_FAILURE_MODEL',
      'APPLICABILITY',
      'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION',
      'EVIDENCE_ARCHITECTURE',
      'EVIDENCE_SAFETY',
      'AP_ABSENCE_CONTRACT',
      'SOURCE_MAPPING',
      'FINDING_ARCHITECTURE',
      'CONTROL_BOUNDARY'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      lifecycle_stage_order: seed.authoringPlan.vocabulary.lifecycleStages,
      governed_technical_assurance_vocabulary: seed.authoringPlan.vocabulary.technicalAssurance,
      governed_human_assurance_vocabulary: seed.authoringPlan.vocabulary.humanAssurance,
      pair_boundary: seed.pairBoundary,
      capability_evidence: seed.evidence.capability,
      antipattern_evidence: seed.evidence.antipattern,
      capability_evidence_safety: seed.evidenceSafety.capabilityRules,
      antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
      ap_absence_contract: seed.apAbsence,
      capability_findings: seed.findings.capability,
      antipattern_findings: seed.findings.antipattern,
      control_boundary: seed.controlBoundary,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_MATERIALIZED_SIR_EVIDENCE',
      'VALIDATED_SIR_EVIDENCE_SAFETY',
      'VALIDATED_SIR_AP_ABSENCE',
      'VERIFIED_MATERIALIZED_FINDINGS',
      'VERIFIED_PERSISTED_CONTROL_BOUNDARY',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not output capability IDs, anti-pattern IDs, lifecycle-stage names, indexes or canonical references.',
      'Do not add, remove, reorder or rename lifecycle stages.',
      'Do not create hard-gate semantics or runtime decision boundaries; CONTROL_BOUNDARY owns those semantics.',
      'Do not create findings, evidence requirements, source mappings, tactics or related-criteria relationships.',
      'Do not treat an assurance target as proof that the assurance has been achieved in a real system.',
      'Do not grant approval, deployment authorization, continued-operation authorization, residual-risk acceptance, legal compliance or retirement authorization.',
      'Do not weaken the AP tested-absence evidence boundary or infer absence from silence.',
      'Do not copy assurance values or progression patterns from the Golden reference without category-specific justification.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirLifecycleAssuranceOutput',
      requiredFields: ['capabilityTargets', 'antipatternTargets', 'rationaleNotes'],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'TARGET_COUNT_EQUALS_GOVERNED_LIFECYCLE_STAGE_COUNT',
      'TECHNICAL_ASSURANCE_FROM_AUTHORING_PLAN',
      'HUMAN_ASSURANCE_FROM_AUTHORING_PLAN',
      'NO_MODEL_OWNED_LIFECYCLE_STAGE_IDENTITY',
      'NO_MODEL_OWNED_CANONICAL_IDENTITY',
      'NO_LIFECYCLE_AUTHORIZATION_INFERENCE'
    ],
    dependencyPaths: [
      'sir.capability.lifecycleTargets',
      'sir.antipattern.lifecycleTargets'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}
