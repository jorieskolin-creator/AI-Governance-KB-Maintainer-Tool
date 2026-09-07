import {
  buildPairCoherencePacket,
  type PairCoherencePacket,
  type PairCoherencePacketSeed
} from './pair-coherence-packet.js';
import { canonicalArtifactHash } from './artifact-hash.js';

export function verifyPairCoherencePacket(
  packet: PairCoherencePacket,
  seed: PairCoherencePacketSeed
): void {
  if (packet.packetVersion !== '1.0.0') {
    throw new Error(`Unsupported Pair Coherence Packet version ${packet.packetVersion}.`);
  }
  if (packet.pairId !== seed.authoringPlan.identity.pairId) {
    throw new Error(
      `Pair Coherence Packet pair ${packet.pairId} does not match ${seed.authoringPlan.identity.pairId}.`
    );
  }
  if (packet.authoringPlanSha256 !== seed.authoringPlan.planSha256) {
    throw new Error('Pair Coherence Packet belongs to a different Authoring Plan.');
  }

  const { packetSha256, ...withoutHash } = packet;
  const computed = canonicalArtifactHash(withoutHash);
  if (packetSha256 !== computed) {
    throw new Error(
      `Pair Coherence Packet hash mismatch: persisted ${packetSha256}, computed ${computed}.`
    );
  }

  const handles = packet.pathRegistry.map((entry) => entry.pathHandle);
  const objectPaths = packet.pathRegistry.map((entry) => entry.objectPath);
  if (new Set(handles).size !== handles.length) {
    throw new Error('Pair Coherence Packet path handles must be unique.');
  }
  if (new Set(objectPaths).size !== objectPaths.length) {
    throw new Error('Pair Coherence Packet object paths must be unique.');
  }
  packet.pathRegistry.forEach((entry, index) => {
    const expected = `path_${String(index + 1).padStart(3, '0')}`;
    if (entry.pathHandle !== expected) {
      throw new Error(
        `Pair Coherence Packet path handle order drift at index ${index}: expected ${expected}, received ${entry.pathHandle}.`
      );
    }
    if (!entry.objectPath.trim() || !entry.label.trim()) {
      throw new Error('Pair Coherence Packet path registry contains an empty path or label.');
    }
  });

  const expected = buildPairCoherencePacket(seed);
  if (canonicalArtifactHash(packet) !== canonicalArtifactHash(expected)) {
    throw new Error('Pair Coherence Packet drifted from the verified upstream SIR artifact set.');
  }
}
