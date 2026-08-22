import type {
  SirPairCoherenceDefectDraft,
  SirPairCoherenceOutput
} from '../cognitive/sir-pair-coherence-contract.js';
import type {
  PairCoherencePacket,
  PairCoherencePathHandle
} from '../orchestration/pair-coherence-packet.js';

export interface MaterializedPairCoherenceDefect {
  defectId: `defect_${string}`;
  severity: SirPairCoherenceDefectDraft['severity'];
  coherenceDimension: SirPairCoherenceDefectDraft['coherenceDimension'];
  affectedPathHandles: PairCoherencePathHandle[];
  affectedPaths: string[];
  issue: string;
  coherenceExpectation: string;
  recommendedRepairPathHandles: PairCoherencePathHandle[];
  recommendedRepairPaths: string[];
}

export interface MaterializedPairCoherenceReview {
  pairId: string;
  pairCoherencePacketSha256: string;
  passed: boolean;
  defects: MaterializedPairCoherenceDefect[];
  coherenceSummary: string;
}

function resolvePaths(
  handles: PairCoherencePathHandle[],
  packet: PairCoherencePacket
): string[] {
  return handles.map((handle) => {
    const entry = packet.pathRegistry.find((candidate) => candidate.pathHandle === handle);
    if (!entry) {
      throw new Error(`Cannot materialize unknown Pair Coherence path handle ${handle}.`);
    }
    return entry.objectPath;
  });
}

export function materializePairCoherenceReview(
  output: SirPairCoherenceOutput,
  packet: PairCoherencePacket
): MaterializedPairCoherenceReview {
  if (!packet.pathRegistry.length) {
    throw new Error('Pair Coherence materialization requires a non-empty path registry.');
  }

  const defects = output.defects.map((defect, index): MaterializedPairCoherenceDefect => ({
    defectId: `defect_${String(index + 1).padStart(3, '0')}`,
    severity: defect.severity,
    coherenceDimension: defect.coherenceDimension,
    affectedPathHandles: [...defect.affectedPathHandles],
    affectedPaths: resolvePaths(defect.affectedPathHandles, packet),
    issue: defect.issue,
    coherenceExpectation: defect.coherenceExpectation,
    recommendedRepairPathHandles: [...defect.recommendedRepairPathHandles],
    recommendedRepairPaths: resolvePaths(defect.recommendedRepairPathHandles, packet)
  }));

  const passed = !defects.some(
    (defect) => defect.severity === 'HIGH' || defect.severity === 'BLOCKING'
  );

  return {
    pairId: packet.pairId,
    pairCoherencePacketSha256: packet.packetSha256,
    passed,
    defects,
    coherenceSummary: output.coherenceSummary
  };
}
