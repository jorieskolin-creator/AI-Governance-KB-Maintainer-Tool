import type {
  SirDomainCoherenceDefectDraft,
  SirDomainCoherenceOutput
} from '../cognitive/sir-domain-coherence-contract.js';
import type {
  DomainCoherencePacket,
  DomainCoherencePairHandle,
  DomainCoherencePathHandle
} from '../orchestration/domain-coherence-packet.js';

export interface MaterializedDomainCoherenceDefect {
  defectId: `defect_${string}`;
  severity: SirDomainCoherenceDefectDraft['severity'];
  coherenceDimension: SirDomainCoherenceDefectDraft['coherenceDimension'];
  affectedPairHandles: DomainCoherencePairHandle[];
  affectedPairIds: string[];
  affectedPathHandles: DomainCoherencePathHandle[];
  affectedPaths: string[];
  issue: string;
  coherenceExpectation: string;
  recommendedRepairPairHandles: DomainCoherencePairHandle[];
  recommendedRepairPairIds: string[];
  recommendedRepairPathHandles: DomainCoherencePathHandle[];
  recommendedRepairPaths: string[];
}

export interface MaterializedDomainCoherenceReview {
  domain: string;
  domainCoherencePacketSha256: string;
  passed: boolean;
  defects: MaterializedDomainCoherenceDefect[];
  coherenceSummary: string;
}

function resolvePairIds(
  handles: DomainCoherencePairHandle[],
  packet: DomainCoherencePacket
): string[] {
  return handles.map((handle) => {
    const entry = packet.pairDigests.find((candidate) => candidate.pairHandle === handle);
    if (!entry) {
      throw new Error(`Cannot materialize unknown Domain Coherence pair handle ${handle}.`);
    }
    return entry.pairId;
  });
}

function resolvePaths(
  handles: DomainCoherencePathHandle[],
  packet: DomainCoherencePacket
): string[] {
  return handles.map((handle) => {
    const entry = packet.pathRegistry.find((candidate) => candidate.pathHandle === handle);
    if (!entry) {
      throw new Error(`Cannot materialize unknown Domain Coherence path handle ${handle}.`);
    }
    return entry.objectPath;
  });
}

export function materializeDomainCoherenceReview(
  output: SirDomainCoherenceOutput,
  packet: DomainCoherencePacket
): MaterializedDomainCoherenceReview {
  if (packet.pairDigests.length !== 5) {
    throw new Error('Domain Coherence materialization requires exactly five verified pair digests.');
  }
  if (!packet.pathRegistry.length) {
    throw new Error('Domain Coherence materialization requires a non-empty path registry.');
  }

  const defects = output.defects.map((defect, index): MaterializedDomainCoherenceDefect => ({
    defectId: `defect_${String(index + 1).padStart(3, '0')}`,
    severity: defect.severity,
    coherenceDimension: defect.coherenceDimension,
    affectedPairHandles: [...defect.affectedPairHandles],
    affectedPairIds: resolvePairIds(defect.affectedPairHandles, packet),
    affectedPathHandles: [...defect.affectedPathHandles],
    affectedPaths: resolvePaths(defect.affectedPathHandles, packet),
    issue: defect.issue,
    coherenceExpectation: defect.coherenceExpectation,
    recommendedRepairPairHandles: [...defect.recommendedRepairPairHandles],
    recommendedRepairPairIds: resolvePairIds(defect.recommendedRepairPairHandles, packet),
    recommendedRepairPathHandles: [...defect.recommendedRepairPathHandles],
    recommendedRepairPaths: resolvePaths(defect.recommendedRepairPathHandles, packet)
  }));

  const passed = !defects.some(
    (defect) => defect.severity === 'HIGH' || defect.severity === 'BLOCKING'
  );

  return {
    domain: packet.domain,
    domainCoherencePacketSha256: packet.packetSha256,
    passed,
    defects,
    coherenceSummary: output.coherenceSummary
  };
}
