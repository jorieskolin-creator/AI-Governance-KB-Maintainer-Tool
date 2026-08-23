import {
  buildDomainCoherencePacket,
  type DomainCoherencePacket,
  type DomainCoherencePacketSeed
} from './domain-coherence-packet.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import { expectedDomainPairIds } from './pipeline.js';

export function verifyDomainCoherencePacket(
  packet: DomainCoherencePacket,
  seed: DomainCoherencePacketSeed
): void {
  if (packet.packetVersion !== '1.0.0') {
    throw new Error(`Unsupported Domain Coherence Packet version ${packet.packetVersion}.`);
  }
  if (packet.domain !== seed.domain) {
    throw new Error(`Domain Coherence Packet domain ${packet.domain} does not match ${seed.domain}.`);
  }
  if (packet.baselineSha256 !== seed.baselineSha256) {
    throw new Error('Domain Coherence Packet belongs to a different baseline.');
  }
  if (packet.pairDigests.length !== 5) {
    throw new Error('Domain Coherence Packet must contain exactly 5 pair digests.');
  }

  const expected = expectedDomainPairIds(seed.domain);
  packet.pairDigests.forEach((digest, index) => {
    const expectedHandle = `pair_${String(index + 1).padStart(3, '0')}`;
    if (digest.pairHandle !== expectedHandle) {
      throw new Error(
        `Domain Coherence pair handle order drift at index ${index}: expected ${expectedHandle}, received ${digest.pairHandle}.`
      );
    }
    if (digest.pairId !== expected[index]) {
      throw new Error(
        `Domain Coherence pair identity drift at index ${index}: expected ${expected[index]}, received ${digest.pairId}.`
      );
    }
    if (digest.passed !== true) {
      throw new Error(`Domain Coherence Packet includes a failing pair ${digest.pairId}.`);
    }
    if (digest.baselineSha256 !== packet.baselineSha256) {
      throw new Error(`Domain Coherence pair ${digest.pairId} drifted from the packet baseline.`);
    }
  });

  const { packetSha256, ...withoutHash } = packet;
  const computed = canonicalArtifactHash(withoutHash);
  if (packetSha256 !== computed) {
    throw new Error(
      `Domain Coherence Packet hash mismatch: persisted ${packetSha256}, computed ${computed}.`
    );
  }

  const handles = packet.pathRegistry.map((entry) => entry.pathHandle);
  const objectPaths = packet.pathRegistry.map((entry) => entry.objectPath);
  if (new Set(handles).size !== handles.length) {
    throw new Error('Domain Coherence Packet path handles must be unique.');
  }
  if (new Set(objectPaths).size !== objectPaths.length) {
    throw new Error('Domain Coherence Packet object paths must be unique.');
  }
  packet.pathRegistry.forEach((entry, index) => {
    const expectedPath = `path_${String(index + 1).padStart(3, '0')}`;
    if (entry.pathHandle !== expectedPath) {
      throw new Error(
        `Domain Coherence Packet path handle order drift at index ${index}: expected ${expectedPath}, received ${entry.pathHandle}.`
      );
    }
    if (!entry.objectPath.trim() || !entry.label.trim()) {
      throw new Error('Domain Coherence Packet path registry contains an empty path or label.');
    }
    if (!packet.pairDigests.some((digest) => digest.pairHandle === entry.pairHandle)) {
      throw new Error(`Domain Coherence path ${entry.pathHandle} references unknown pair handle ${entry.pairHandle}.`);
    }
  });

  const expectedPacket = buildDomainCoherencePacket(seed);
  if (canonicalArtifactHash(packet) !== canonicalArtifactHash(expectedPacket)) {
    throw new Error('Domain Coherence Packet drifted from the verified pair-coherence artifact set.');
  }
}
