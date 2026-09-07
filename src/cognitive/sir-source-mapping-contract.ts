import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { SourceContextPacket } from '../orchestration/source-context-packet.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type { SirHandle } from '../sir/model.js';
import type { SirApAbsenceOutput } from './sir-ap-absence-contract.js';
import type { SirEvidenceSafetyOutput } from './sir-evidence-safety-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from './sir-initial-contracts.js';

export interface SirSourceMappingCandidate {
  sourceHandle: SirHandle;
  locatorHandle: SirHandle;
  relationship: string;
  supportedClaim: string;
  categoryRationale: string;
  applicabilityConditions: string[];
  exclusions: string[];
}

export type SirUnmappedSourceReason =
  | 'INSUFFICIENT_SOURCE_CONTEXT'
  | 'NO_ALLOWED_SOURCE_SUPPORT'
  | 'APPLICABILITY_AMBIGUOUS'
  | 'RIGHTS_RESTRICTED_SOURCE_CONTEXT';

export interface SirUnmappedSourceClaim {
  objectKind: 'CAPABILITY' | 'ANTIPATTERN';
  claim: string;
  reason: SirUnmappedSourceReason;
  consideredSourceHandles: SirHandle[];
}

export interface SirSourceMappingOutput {
  capabilityMappings: SirSourceMappingCandidate[];
  antipatternMappings: SirSourceMappingCandidate[];
  unmappedClaims: SirUnmappedSourceClaim[];
  mappingNotes: string[];
}

export interface SirSourceMappingSeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
  primaryQuestions: SirPrimaryQuestionsOutput;
  atomics: MaterializedSirAtomics;
  evidence: MaterializedSirEvidence;
  evidenceSafety: SirEvidenceSafetyOutput;
  apAbsence: SirApAbsenceOutput;
  sourceContextPacket: SourceContextPacket;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirSourceMappingContract(
  seed: SirSourceMappingSeed
): TaskContract<SirSourceMappingOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:SOURCE_MAPPING:SIR`,
    taskType: 'SOURCE_MAPPING',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Create category-specific semantic source-mapping candidates using only the sealed Source Context Packet. Select supplied source and locator handles and state the bounded relationship, supported claim, rationale, applicability conditions and exclusions. Factual verification remains a separate downstream quality gate.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'AP_FAILURE_MODEL',
      'APPLICABILITY',
      'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION',
      'EVIDENCE_ARCHITECTURE',
      'EVIDENCE_SAFETY',
      'AP_ABSENCE_CONTRACT'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      source_context_packet_sha256: seed.sourceContextPacket.packetSha256,
      source_context_packet: seed.sourceContextPacket,
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
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_PAIR_SIR_THROUGH_AP_ABSENCE',
      'SEALED_SOURCE_CONTEXT_PACKET',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not output source IDs, source versions/dates, verification status/dates, mapping IDs or canonical reference strings.',
      'Do not output an exact locator string; select only a supplied locatorHandle. Deterministic code materializes exact_locator.',
      'Do not invent a sourceHandle or locatorHandle that is absent from the Source Context Packet.',
      'Do not use general model memory to fill a missing article, clause, paragraph, control or source statement.',
      'Do not treat Source Register inclusion or domain coverage as proof that a category mapping is correct.',
      'Do not infer legal applicability, compliance, control satisfaction, residual-risk acceptance or decision authority from source registration or mapping.',
      'Do not represent voluntary guidance or a published standard as binding legislation.',
      'Do not infer protected licensed-source content that was withheld by the Source Context Packet.',
      'If the supplied source context is insufficient, return an unmappedClaims item with a governed reason instead of inventing support.',
      'Do not rewrite upstream category content, evidence, findings, controls, tactics or lifecycle consequences.',
      'Do not mark a mapping factually verified; factual/source support is checked by a separate quality gate.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirSourceMappingOutput',
      requiredFields: [
        'capabilityMappings',
        'antipatternMappings',
        'unmappedClaims',
        'mappingNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'SOURCE_CONTEXT_PACKET_HASH_MATCH',
      'SOURCE_HANDLES_RESOLVE',
      'LOCATOR_HANDLES_RESOLVE_WITHIN_SELECTED_SOURCE',
      'NO_FREEFORM_EXACT_LOCATORS',
      'NO_CANONICAL_SOURCE_METADATA_IN_MODEL_OUTPUT',
      'SUPPORTED_CLAIM_AND_RATIONALE_NONEMPTY',
      'UNMAPPED_CLAIMS_USE_GOVERNED_REASONS',
      'NO_REGISTRATION_EQUALS_APPLICABILITY_OR_COMPLIANCE',
      'FACTUAL_VERIFICATION_REMAINS_DOWNSTREAM'
    ],
    dependencyPaths: ['sir.capability.sources', 'sir.antipattern.sources'],
    failureMode: 'FAIL_CLOSED'
  };
}
