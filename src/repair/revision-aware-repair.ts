import type { AuthoringPlan, DomainId } from '../authoring/authoring-plan.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { compileGateResult, compileSirPair } from '../compiler/sir-compiler.js';
import type { SirDomainCoherenceDefectDraft } from '../cognitive/sir-domain-coherence-contract.js';
import type { SirPairCoherenceDefectDraft } from '../cognitive/sir-pair-coherence-contract.js';
import type { TaskContract } from '../domain/task-contract.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import {
  buildDomainCoherencePacket,
  deriveDomainCoherencePairDigest,
  type DomainCoherencePacket
} from '../orchestration/domain-coherence-packet.js';
import {
  buildPairCoherencePacket,
  type PairCoherencePacket,
  type PairCoherenceSnapshot
} from '../orchestration/pair-coherence-packet.js';
import {
  getLatestCompletedTaskArtifact,
  recordPairNamedGates,
  type PairRunRecord
} from '../orchestration/store.js';
import { buildPairAuthoringPlan } from '../operator/authoring-context.js';
import {
  materializeDomainCoherenceReview,
  type MaterializedDomainCoherenceDefect,
  type MaterializedDomainCoherenceReview
} from '../sir/domain-coherence-materializer.js';
import {
  materializePairCoherenceReview,
  type MaterializedPairCoherenceDefect,
  type MaterializedPairCoherenceReview
} from '../sir/pair-coherence-materializer.js';
import {
  blockingOpenDefects,
  type FindingDispositionDraft
} from './finding-dispositions.js';

export const REPAIR_NOT_COHERENCE_ADMISSIBLE =
  'Invalid repaired content cannot reach coherence review.';

export function currentPairCoherencePacketSha256(contract: TaskContract): string | undefined {
  const sha = contract.lockedInputs.pair_coherence_packet_sha256;
  if (typeof sha === 'string' && sha.trim()) return sha.trim();
  const raw = contract.lockedInputs.pair_coherence_packet;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const packetSha = (raw as { packetSha256?: unknown }).packetSha256;
    if (typeof packetSha === 'string' && packetSha.trim()) return packetSha.trim();
  }
  return undefined;
}

export function bindPairCoherenceReviewContract(
  current: TaskContract,
  packet: PairCoherencePacket
): TaskContract {
  return {
    ...current,
    lockedInputs: {
      ...current.lockedInputs,
      pair_coherence_packet: packet,
      pair_coherence_packet_sha256: packet.packetSha256
    }
  };
}

export function bindDomainCoherenceReviewContract(
  current: TaskContract,
  packet: DomainCoherencePacket
): TaskContract {
  return {
    ...current,
    lockedInputs: {
      ...current.lockedInputs,
      domain_coherence_packet: packet,
      domain_coherence_packet_sha256: packet.packetSha256
    }
  };
}

export function pairPacketInputHash(contract: TaskContract, packet: PairCoherencePacket): string {
  return canonicalArtifactHash({
    contract,
    pairCoherencePacketSha256: packet.packetSha256
  });
}

export function domainPacketInputHash(contract: TaskContract, packet: DomainCoherencePacket): string {
  return canonicalArtifactHash({
    contract,
    domainCoherencePacketSha256: packet.packetSha256
  });
}

function pathHandleFor(packet: PairCoherencePacket, objectPath: string): PairCoherencePacket['pathRegistry'][number]['pathHandle'] {
  const entry = packet.pathRegistry.find((item) => item.objectPath === objectPath);
  if (!entry) {
    throw new Error(`Cannot rematerialize finding against the current packet: missing path ${objectPath}.`);
  }
  return entry.pathHandle;
}

export function rebindPairDefectsToPacket(
  defects: readonly MaterializedPairCoherenceDefect[],
  packet: PairCoherencePacket
): SirPairCoherenceDefectDraft[] {
  return defects.map((defect) => {
    const repairPaths = defect.recommendedRepairPaths.length
      ? defect.recommendedRepairPaths
      : defect.affectedPaths;
    return {
      severity: defect.severity,
      coherenceDimension: defect.coherenceDimension,
      affectedPathHandles: defect.affectedPaths.map((path) => pathHandleFor(packet, path)),
      issue: defect.issue,
      coherenceExpectation: defect.coherenceExpectation,
      recommendedRepairPathHandles: repairPaths.map((path) => pathHandleFor(packet, path))
    };
  });
}

function domainPathHandleFor(
  packet: DomainCoherencePacket,
  objectPath: string
): DomainCoherencePacket['pathRegistry'][number]['pathHandle'] {
  const entry = packet.pathRegistry.find((item) => item.objectPath === objectPath);
  if (!entry) {
    throw new Error(
      `Cannot rematerialize domain finding against the current packet: missing path ${objectPath}.`
    );
  }
  return entry.pathHandle;
}

function domainPairHandleFor(
  packet: DomainCoherencePacket,
  pairId: string
): DomainCoherencePacket['pairDigests'][number]['pairHandle'] {
  const entry = packet.pairDigests.find((item) => item.pairId === pairId);
  if (!entry) {
    throw new Error(
      `Cannot rematerialize domain finding against the current packet: missing pair ${pairId}.`
    );
  }
  return entry.pairHandle;
}

export function rebindDomainDefectsToPacket(
  defects: readonly MaterializedDomainCoherenceDefect[],
  packet: DomainCoherencePacket
): SirDomainCoherenceDefectDraft[] {
  return defects.map((defect) => {
    const repairPaths = defect.recommendedRepairPaths.length
      ? defect.recommendedRepairPaths
      : defect.affectedPaths;
    const repairPairs = defect.recommendedRepairPairIds.length
      ? defect.recommendedRepairPairIds
      : defect.affectedPairIds;
    return {
      severity: defect.severity,
      coherenceDimension: defect.coherenceDimension,
      affectedPairHandles: defect.affectedPairIds.map((pairId) => domainPairHandleFor(packet, pairId)),
      affectedPathHandles: defect.affectedPaths.map((path) => domainPathHandleFor(packet, path)),
      issue: defect.issue,
      coherenceExpectation: defect.coherenceExpectation,
      recommendedRepairPairHandles: repairPairs.map((pairId) => domainPairHandleFor(packet, pairId)),
      recommendedRepairPathHandles: repairPaths.map((path) => domainPathHandleFor(packet, path))
    };
  });
}

function pairDispositionNote(dispositions: readonly FindingDispositionDraft[], savedAt: string): string {
  if (!dispositions.length) {
    return ` Human approved ${savedAt}: semantic edits saved. Section schema and reference-graph gate passed.`;
  }
  const parts = dispositions.map((item) => `${item.findingId}=${item.disposition}`);
  return ` Human approved ${savedAt}: dispositions ${parts.join(', ')}. Section schema and reference-graph gate passed.`;
}

export function rematerializePairReviewForCurrentPacket(input: {
  review: MaterializedPairCoherenceReview;
  packet: PairCoherencePacket;
  dispositions: readonly FindingDispositionDraft[];
  savedAt: string;
}): MaterializedPairCoherenceReview {
  const rematerialized = materializePairCoherenceReview(
    {
      defects: rebindPairDefectsToPacket(input.review.defects, input.packet),
      coherenceSummary: `${input.review.coherenceSummary.trim()}${pairDispositionNote(input.dispositions, input.savedAt)}`.trim()
    },
    input.packet
  );
  return {
    ...rematerialized,
    passed: blockingOpenDefects(rematerialized.defects, input.dispositions).length === 0
  };
}

export function rematerializeDomainReviewForCurrentPacket(input: {
  review: MaterializedDomainCoherenceReview;
  packet: DomainCoherencePacket;
  dispositions: readonly FindingDispositionDraft[];
  savedAt: string;
}): MaterializedDomainCoherenceReview {
  const rematerialized = materializeDomainCoherenceReview(
    {
      defects: rebindDomainDefectsToPacket(input.review.defects, input.packet),
      coherenceSummary: `${input.review.coherenceSummary.trim()}${pairDispositionNote(input.dispositions, input.savedAt)}`.trim()
    },
    input.packet
  );
  return {
    ...rematerialized,
    passed: blockingOpenDefects(rematerialized.defects, input.dispositions).length === 0
  };
}

export function rebuildPairCoherencePacket(input: {
  snapshot: PairCoherenceSnapshot;
  authoringPlan: AuthoringPlan;
}): PairCoherencePacket {
  return buildPairCoherencePacket({
    ...input.snapshot,
    authoringPlan: input.authoringPlan
  });
}

export function staleDomainPairSnapshotIssues(
  packet: DomainCoherencePacket,
  currentPackets: ReadonlyArray<{ pairId: string; packetSha256: string }>
): string[] {
  const issues: string[] = [];
  const current = new Map(currentPackets.map((item) => [item.pairId, item.packetSha256]));
  for (const digest of packet.pairDigests) {
    const sha = current.get(digest.pairId);
    if (!sha) {
      issues.push(
        `Domain review cannot use a stale pair snapshot: ${digest.pairId} has no current Pair Coherence Packet.`
      );
      continue;
    }
    if (sha !== digest.pairCoherencePacketSha256) {
      issues.push(
        `Domain review cannot use a stale pair snapshot: ${digest.pairId} packet ${digest.pairCoherencePacketSha256.slice(0, 12)} was superseded by ${sha.slice(0, 12)}.`
      );
    }
  }
  return issues;
}

export async function currentPairPacketBindings(
  pairRuns: readonly PairRunRecord[]
): Promise<Array<{ pairId: string; packetSha256: string }>> {
  const bindings: Array<{ pairId: string; packetSha256: string }> = [];
  for (const pairRun of pairRuns) {
    const artifact = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    const sha = artifact ? currentPairCoherencePacketSha256(artifact.taskContract) : undefined;
    bindings.push({ pairId: pairRun.pairId, packetSha256: sha ?? '' });
  }
  return bindings;
}

export async function rebuildDomainPacketFromCurrentPairs(input: {
  domain: DomainId;
  pairRuns: readonly PairRunRecord[];
  baseline: BaselineSnapshot;
}): Promise<DomainCoherencePacket> {
  const pairDigests = [];
  for (const pairRun of input.pairRuns) {
    const artifact = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    if (!artifact) {
      throw new Error(`Domain review cannot use a stale pair snapshot: ${pairRun.pairId} has no Pair Coherence review.`);
    }
    const raw = artifact.taskContract.lockedInputs.pair_coherence_packet;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Domain review cannot use a stale pair snapshot: ${pairRun.pairId} has no locked Pair Coherence Packet.`);
    }
    const packet = raw as PairCoherencePacket;
    const review = artifact.output as MaterializedPairCoherenceReview;
    pairDigests.push(
      deriveDomainCoherencePairDigest({
        authoringPlan: buildPairAuthoringPlan({
          domain: input.domain,
          pairId: pairRun.pairId,
          snapshot: input.baseline,
          targetVersion: pairRun.targetVersion
        }),
        pairCoherencePacket: packet,
        pairCoherenceReview: review
      })
    );
  }
  return buildDomainCoherencePacket({
    domain: input.domain,
    baselineSha256: input.baseline.sha256,
    pairDigests
  });
}

export function reviewNotesFromReview(output: unknown): string[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const record = output as Record<string, unknown>;
  const notes: string[] = [];
  if (typeof record.coherenceSummary === 'string' && record.coherenceSummary.trim()) {
    notes.push(record.coherenceSummary.trim());
  }
  if (Array.isArray(record.defects) && record.defects.length > 0) {
    notes.push(`Pair coherence recorded ${String(record.defects.length)} finding(s) on this candidate revision.`);
  }
  return notes;
}

export async function compileAndRecordCurrentPair(input: {
  pairRunId: string;
  pairId: string;
  domain: DomainId;
  snapshot: unknown;
  baseline: BaselineSnapshot;
  targetVersion?: string;
  reviewNotes?: string[];
}): Promise<'CANONICAL_COMPILE_VALID' | 'COMPILE_FAILED'> {
  const compiled = await compileSirPair({
    authoringPlan: buildPairAuthoringPlan({
      domain: input.domain,
      pairId: input.pairId,
      snapshot: input.baseline,
      targetVersion: input.targetVersion
    }),
    snapshot: input.snapshot,
    mode: 'DRAFT',
    reviewNotes: input.reviewNotes
  });
  await recordPairNamedGates(input.pairRunId, [compileGateResult(compiled)]);
  return compiled.outcome;
}
