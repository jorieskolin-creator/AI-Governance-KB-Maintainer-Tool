import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type {
  PairCoherencePacket,
  PairCoherencePathHandle
} from '../orchestration/pair-coherence-packet.js';

export type SirPairCoherenceSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';

export type SirPairCoherenceDimension =
  | 'SEMANTIC_BOUNDARY'
  | 'CAPABILITY_ANTIPATTERN_RELATIONSHIP'
  | 'APPLICABILITY'
  | 'QUESTION_ATOMIC_ALIGNMENT'
  | 'EVIDENCE_INTERPRETATION'
  | 'SOURCE_INTERPRETATION'
  | 'FINDING_LOGIC'
  | 'CONTROL_AUTHORITY'
  | 'LIFECYCLE_ASSURANCE'
  | 'REFERENCE_OWNERSHIP'
  | 'CROSS_ARTIFACT_CONTRADICTION';

export interface SirPairCoherenceDefectDraft {
  severity: SirPairCoherenceSeverity;
  coherenceDimension: SirPairCoherenceDimension;
  affectedPathHandles: PairCoherencePathHandle[];
  issue: string;
  coherenceExpectation: string;
  recommendedRepairPathHandles: PairCoherencePathHandle[];
}

export interface SirPairCoherenceOutput {
  defects: SirPairCoherenceDefectDraft[];
  coherenceSummary: string;
}

export interface SirPairCoherenceSeed {
  authoringPlan: AuthoringPlan;
  pairCoherencePacket: PairCoherencePacket;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirPairCoherenceContract(
  seed: SirPairCoherenceSeed
): TaskContract<SirPairCoherenceOutput> {
  if (seed.pairCoherencePacket.pairId !== seed.authoringPlan.identity.pairId) {
    throw new Error('Pair Coherence Packet pair does not match the Authoring Plan pair.');
  }
  if (seed.pairCoherencePacket.authoringPlanSha256 !== seed.authoringPlan.planSha256) {
    throw new Error('Pair Coherence Packet belongs to a different Authoring Plan.');
  }

  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:PAIR_COHERENCE_REVIEW:SIR`,
    taskType: 'PAIR_COHERENCE_REVIEW',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Independently review the complete verified pair snapshot for semantic cross-artifact coherence. Identify contradictions, boundary leakage, unsupported semantic progression, evidence-to-finding inconsistencies, control/authority inconsistencies, lifecycle-assurance inconsistencies and related-criterion ownership problems. Return defects only. Structural identity, reference resolution, source metadata integrity, tactic reciprocity and artifact hashes are deterministic upstream gates and must not be re-decided here.',
    modelRole: 'QUALITY_CHECKER',
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
      'CONTROL_BOUNDARY',
      'LIFECYCLE_ASSURANCE',
      'REFERENCE_MAPPING'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      pair_coherence_packet_sha256: seed.pairCoherencePacket.packetSha256,
      pair_coherence_packet: seed.pairCoherencePacket,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference,
      deterministic_preflight_status: 'PASSED_BEFORE_PAIR_COHERENCE_QC'
    },
    allowedReferences: [
      'VERIFIED_PAIR_COHERENCE_PACKET',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE_AS_QUALITY_EXEMPLAR'
    ],
    doNot: [
      'Do not output pair ID, capability ID, anti-pattern ID, defect IDs, pass/fail status or canonical IDs.',
      'Do not output free-form object paths; select only supplied path_* handles.',
      'Do not rewrite, normalize, improve or silently repair any production content.',
      'Do not propose replacement text or return corrected artifacts.',
      'Do not create sources, source locators, evidence, findings, tactics, controls, lifecycle targets or related criteria.',
      'Do not re-run deterministic identity, schema, hash, source-metadata or tactic-reciprocity validation as a model judgment.',
      'Do not claim factual source support beyond the bounded source interpretation already present in the verified packet.',
      'Do not grant approval, legal compliance, residual-risk acceptance or lifecycle authorization.',
      'Do not treat the Golden reference as a normative rulebook or require category-specific counts or wording to match it.',
      'Do not suppress a material defect merely because repairing it affects multiple upstream paths.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirPairCoherenceOutput',
      requiredFields: ['defects', 'coherenceSummary'],
      additionalProperties: false
    },
    validationProfile: [
      'DEFECT_ONLY_OUTPUT',
      'NO_MODEL_OWNED_PAIR_OR_DEFECT_IDENTITY',
      'NO_MODEL_OWNED_PASS_STATUS',
      'PATH_HANDLES_RESOLVE_TO_LOCKED_REGISTRY',
      'AFFECTED_PATHS_NONEMPTY_PER_DEFECT',
      'REPAIR_PATHS_NONEMPTY_PER_DEFECT',
      'SEVERITY_AND_COHERENCE_DIMENSION_GOVERNED',
      'NO_REWRITTEN_PRODUCTION_CONTENT',
      'PASS_STATUS_DERIVED_DETERMINISTICALLY_AFTER_VALIDATION'
    ],
    dependencyPaths: [],
    failureMode: 'FAIL_CLOSED'
  };
}
