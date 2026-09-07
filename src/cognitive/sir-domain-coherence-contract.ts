import type { DomainId } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type {
  DomainCoherencePacket,
  DomainCoherencePairHandle,
  DomainCoherencePathHandle
} from '../orchestration/domain-coherence-packet.js';

export type SirDomainCoherenceSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';

export type SirDomainCoherenceDimension =
  | 'OVERLAP'
  | 'COVERAGE_GAP'
  | 'CONTRADICTORY_BOUNDARY'
  | 'DUPLICATED_ATOMIC_MECHANISM'
  | 'INCONSISTENT_TERMINOLOGY'
  | 'CONFLICTING_SOURCE_INTERPRETATION'
  | 'INCONSISTENT_EVIDENCE_OR_ASSURANCE'
  | 'BROKEN_RELATED_CRITERION'
  | 'CROSS_PAIR_CONTRADICTION';

export interface SirDomainCoherenceDefectDraft {
  severity: SirDomainCoherenceSeverity;
  coherenceDimension: SirDomainCoherenceDimension;
  affectedPairHandles: DomainCoherencePairHandle[];
  affectedPathHandles: DomainCoherencePathHandle[];
  issue: string;
  coherenceExpectation: string;
  recommendedRepairPairHandles: DomainCoherencePairHandle[];
  recommendedRepairPathHandles: DomainCoherencePathHandle[];
}

export interface SirDomainCoherenceOutput {
  defects: SirDomainCoherenceDefectDraft[];
  coherenceSummary: string;
}

export interface SirDomainCoherenceSeed {
  domain: DomainId;
  domainCoherencePacket: DomainCoherencePacket;
  domainBaseline: Record<string, unknown>;
  goldenStandardDomainRules: Record<string, unknown>;
}

export function buildSirDomainCoherenceContract(
  seed: SirDomainCoherenceSeed
): TaskContract<SirDomainCoherenceOutput> {
  if (seed.domainCoherencePacket.domain !== seed.domain) {
    throw new Error('Domain Coherence Packet domain does not match the requested domain.');
  }
  if (seed.domainCoherencePacket.pairDigests.length !== 5) {
    throw new Error('Domain Coherence SIR contract requires a five-pair Domain Coherence Packet.');
  }

  return {
    contractVersion: '2.0.0',
    taskId: `DOMAIN-${seed.domain}:DOMAIN_COHERENCE_REVIEW:SIR`,
    taskType: 'DOMAIN_COHERENCE_REVIEW',
    targetObjectId: `DOMAIN-${seed.domain}`,
    objective:
      'Independently review the complete verified five-pair domain batch for overlap, coverage gaps, contradictory boundaries, duplicated atomic mechanisms, inconsistent terminology, conflicting source interpretation, inconsistent evidence/assurance logic and broken related-criterion relationships. Return defects only. Pair identity, Authoring Plan hashes, pair-coherence pass status, path resolution and artifact hashes are deterministic upstream gates and must not be re-decided here.',
    modelRole: 'QUALITY_CHECKER',
    upstreamTaskTypes: [],
    lockedInputs: {
      domain: seed.domain,
      domain_coherence_packet_sha256: seed.domainCoherencePacket.packetSha256,
      domain_coherence_packet: seed.domainCoherencePacket,
      domain_baseline: seed.domainBaseline,
      golden_standard_domain_rules: seed.goldenStandardDomainRules,
      deterministic_preflight_status: 'PASSED_BEFORE_DOMAIN_COHERENCE_QC'
    },
    allowedReferences: [
      'VERIFIED_DOMAIN_COHERENCE_PACKET',
      'DOMAIN_BASELINE',
      'GOLDEN_STANDARD_DOMAIN_RULES_AS_QUALITY_EXEMPLAR'
    ],
    doNot: [
      'Do not output domain, pair IDs, defect IDs, pass/fail status or canonical IDs.',
      'Do not output free-form object paths or pair IDs; select only supplied pair_* and path_* handles.',
      'Do not rewrite, normalize, improve or silently repair any pair content.',
      'Do not propose replacement text or return corrected pair artifacts.',
      'Do not create sources, evidence, findings, tactics, controls, lifecycle targets or new criteria.',
      'Do not merge two categories merely because their terminology is similar.',
      'Do not re-run deterministic identity, schema, hash, source-metadata or pair-coherence validation as a model judgment.',
      'Do not approve the domain batch, legal compliance, residual-risk acceptance or lifecycle authorization.',
      'Do not treat the Golden reference as a normative rulebook or require category-specific counts or wording to match it.',
      'Do not suppress a material defect merely because repairing it affects multiple pairs.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirDomainCoherenceOutput',
      requiredFields: ['defects', 'coherenceSummary'],
      additionalProperties: false
    },
    validationProfile: [
      'DEFECT_ONLY_OUTPUT',
      'NO_MODEL_OWNED_DOMAIN_PAIR_OR_DEFECT_IDENTITY',
      'NO_MODEL_OWNED_PASS_STATUS',
      'PAIR_HANDLES_RESOLVE_TO_LOCKED_REGISTRY',
      'PATH_HANDLES_RESOLVE_TO_LOCKED_REGISTRY',
      'AFFECTED_PAIRS_NONEMPTY_PER_DEFECT',
      'AFFECTED_PATHS_NONEMPTY_PER_DEFECT',
      'REPAIR_PAIRS_NONEMPTY_PER_DEFECT',
      'REPAIR_PATHS_NONEMPTY_PER_DEFECT',
      'SEVERITY_AND_COHERENCE_DIMENSION_GOVERNED',
      'NO_REWRITTEN_PRODUCTION_CONTENT',
      'PASS_STATUS_DERIVED_DETERMINISTICALLY_AFTER_VALIDATION'
    ],
    dependencyPaths: [],
    failureMode: 'FAIL_CLOSED'
  };
}
