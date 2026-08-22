import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type { MaterializedSirSourceMappings } from '../sir/source-mapping-materializer.js';
import type { SirHandle } from '../sir/model.js';
import type { SirApAbsenceOutput } from './sir-ap-absence-contract.js';
import type { SirEvidenceSafetyOutput } from './sir-evidence-safety-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from './sir-initial-contracts.js';

export type SirCapabilityConclusionState =
  | 'SATISFIED'
  | 'PARTIALLY_SATISFIED'
  | 'NOT_SATISFIED'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE';

export type SirAntipatternConclusionState =
  | 'CONFIRMED_PRESENT'
  | 'PARTIALLY_PRESENT'
  | 'TESTED_ABSENT'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE';

export type SirFindingSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';

interface SirFindingContentBase {
  title: string;
  atomicHandles: SirHandle[];
  evidenceHandles: SirHandle[];
  defaultSeverity: SirFindingSeverity;
  lifecycleConsequence: string;
  humanLockRequired: boolean;
}

export interface SirCapabilityFindingContent extends SirFindingContentBase {
  eligibleConclusionStates: SirCapabilityConclusionState[];
}

export interface SirAntipatternFindingContent extends SirFindingContentBase {
  eligibleConclusionStates: SirAntipatternConclusionState[];
}

export interface SirFindingArchitectureOutput {
  capabilityFindings: SirCapabilityFindingContent[];
  antipatternFindings: SirAntipatternFindingContent[];
  findingLogicNotes: string[];
}

export interface SirFindingArchitectureSeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
  primaryQuestions: SirPrimaryQuestionsOutput;
  atomics: MaterializedSirAtomics;
  evidence: MaterializedSirEvidence;
  evidenceSafety: SirEvidenceSafetyOutput;
  apAbsence: SirApAbsenceOutput;
  sourceMappings: MaterializedSirSourceMappings;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirFindingArchitectureContract(
  seed: SirFindingArchitectureSeed
): TaskContract<SirFindingArchitectureOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:FINDING_ARCHITECTURE:SIR`,
    taskType: 'FINDING_ARCHITECTURE',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define semantic finding definitions for the validated capability and anti-pattern graphs. Each finding must select supplied same-object atomic and evidence handles, use only the governed conclusion-state vocabulary, and state severity, lifecycle consequence and human-lock semantics. Deterministic code assigns finding handles and later canonical FND-* IDs.',
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
      'SOURCE_MAPPING'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      capability_conclusion_states: seed.authoringPlan.vocabulary.capabilityConclusionStates,
      antipattern_conclusion_states: seed.authoringPlan.vocabulary.antipatternConclusionStates,
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      primary_questions: seed.primaryQuestions,
      capability_atomics: seed.atomics.capability,
      antipattern_atomics: seed.atomics.antipattern,
      capability_evidence: seed.evidence.capability,
      antipattern_evidence: seed.evidence.antipattern,
      capability_evidence_safety: seed.evidenceSafety.capabilityRules,
      antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
      ap_absence_contract: seed.apAbsence,
      source_mappings: seed.sourceMappings,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_PAIR_SIR_THROUGH_AP_ABSENCE',
      'VALIDATED_MATERIALIZED_SOURCE_MAPPINGS',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not create finding IDs or local finding handles; deterministic code assigns them after validation.',
      'Do not invent atomic or evidence handles. Use only supplied handles from the same capability or anti-pattern object.',
      'Do not reference capability atomic/evidence handles from an anti-pattern finding or vice versa.',
      'Do not use capability conclusion states for anti-pattern findings or anti-pattern conclusion states for capability findings.',
      'Do not treat a source mapping candidate as assessment-time evidence or as proof of control satisfaction.',
      'Do not hide or repair an unresolved source mapping inside a finding definition.',
      'Do not permit TESTED_ABSENT semantics to bypass the validated AP absence contract.',
      'Do not create hard gates, runtime authority, lifecycle assurance targets, tactic mappings or approvals.',
      'Do not assess a real system or create a locked finding instance; this task authors reusable Knowledge Base finding definitions.',
      'Do not infer legal compliance, residual-risk acceptance or lifecycle authorization.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirFindingArchitectureOutput',
      requiredFields: ['capabilityFindings', 'antipatternFindings', 'findingLogicNotes'],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'NO_MODEL_OWNED_FINDING_IDS_OR_HANDLES',
      'FINDING_ATOMIC_HANDLES_RESOLVE_TO_SAME_OBJECT',
      'FINDING_EVIDENCE_HANDLES_RESOLVE_TO_SAME_OBJECT',
      'FINDING_EVIDENCE_COVERS_SELECTED_ATOMICS',
      'OBJECT_SPECIFIC_CONCLUSION_STATE_VOCABULARY',
      'TESTED_ABSENT_REQUIRES_VALIDATED_ABSENCE_CONTRACT',
      'NO_SOURCE_MAPPING_SUBSTITUTES_FOR_EVIDENCE',
      'NO_CONTROL_OR_AUTHORITY_CONTENT'
    ],
    dependencyPaths: ['sir.capability.findings', 'sir.antipattern.findings'],
    failureMode: 'FAIL_CLOSED'
  };
}
