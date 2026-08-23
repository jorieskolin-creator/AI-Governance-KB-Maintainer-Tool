import {
  buildDomainCoherencePacket,
  type DomainCoherencePairDigestInput
} from './domain-coherence-packet.js';
import { verifyDomainCoherencePacket } from './domain-coherence-packet-verifier.js';
import { canonicalArtifactHash } from './artifact-hash.js';

const hash = 'a'.repeat(64);

function digest(slot: 1 | 2 | 3 | 4 | 5, extra: Partial<DomainCoherencePairDigestInput> = {}): DomainCoherencePairDigestInput {
  const capabilityId = `A${slot}`;
  const antipatternId = `AP-${capabilityId}`;
  return {
    pairId: `${capabilityId}_${antipatternId}`,
    capabilityId,
    antipatternId,
    capabilityTitle: `${capabilityId} capability title`,
    antipatternTitle: `${antipatternId} anti-pattern title`,
    authoringPlanSha256: hash,
    baselineSha256: hash,
    pairCoherencePacketSha256: String(slot).repeat(64),
    pairCoherenceOutputHash: String(slot + 5).repeat(64),
    passed: true,
    capabilityCanonicalDefinition: `${capabilityId} owns a distinct bounded capability claim used for domain-coherence packet regression.`,
    antipatternCanonicalDefinition: `${antipatternId} owns the paired failure mechanism used for domain-coherence packet regression.`,
    ownedTopics: [`${capabilityId} owned topic`],
    excludedTopics: [],
    relatedCapabilityCriterionIds: slot === 1 ? ['A2'] : [],
    relatedAntipatternCriterionIds: [],
    capabilityFindingTitles: [`${capabilityId} finding`],
    antipatternFindingTitles: [`${antipatternId} finding`],
    capabilitySourceIds: [],
    antipatternSourceIds: [],
    ...extra
  };
}

const seed = {
  domain: 'A' as const,
  baselineSha256: hash,
  pairDigests: [digest(1), digest(2), digest(3), digest(4), digest(5)]
};

const first = buildDomainCoherencePacket(seed);
const second = buildDomainCoherencePacket(seed);
verifyDomainCoherencePacket(first, seed);
if (first.packetSha256 !== second.packetSha256) {
  throw new Error('Identical Domain Coherence inputs produced different packet hashes.');
}
if (first.pairDigests[0]?.pairHandle !== 'pair_001' || first.pairDigests[4]?.pairHandle !== 'pair_005') {
  throw new Error('Domain Coherence pair handles are not deterministic.');
}
if (first.pathRegistry[0]?.pathHandle !== 'path_001') {
  throw new Error('Domain Coherence path handles are not deterministic.');
}
if (!first.pathRegistry.some((entry) => entry.objectPath === 'pairs[A1_AP-A1].capability.boundary')) {
  throw new Error('Domain Coherence path registry omitted pair-scoped boundary paths.');
}
if (!first.pathRegistry.some((entry) => entry.objectPath === 'pairs[A5_AP-A5].antipattern.sources')) {
  throw new Error('Domain Coherence path registry omitted the fifth-pair source path.');
}
if (first.pathRegistry.length !== 50) {
  throw new Error(`Expected 50 domain path entries; received ${first.pathRegistry.length}.`);
}

function expectReject(fn: () => void, expected: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw new Error(`Expected ${expected}; received ${message}`);
    return;
  }
  throw new Error(`Expected rejection containing ${expected}.`);
}

expectReject(() => buildDomainCoherencePacket({ ...seed, pairDigests: seed.pairDigests.slice(0, 4) }), 'exactly 5');
expectReject(
  () => buildDomainCoherencePacket({
    ...seed,
    pairDigests: [digest(1), digest(2), digest(3), digest(4), { ...digest(5), pairId: 'B1_AP-B1', capabilityId: 'B1', antipatternId: 'AP-B1' }]
  }),
  'pair set must be'
);
expectReject(
  () => buildDomainCoherencePacket({
    ...seed,
    pairDigests: [digest(1), digest(2), digest(3), digest(4), { ...digest(5), baselineSha256: 'b'.repeat(64) }]
  }),
  'different baseline'
);

const staleHash = structuredClone(first);
staleHash.pathRegistry[0]!.label = 'Tampered label.';
expectReject(() => verifyDomainCoherencePacket(staleHash, seed), 'hash mismatch');

const rehashedTamper = structuredClone(first);
rehashedTamper.pairDigests[0]!.capabilityCanonicalDefinition = 'Tampered definition.';
const { packetSha256: _old, ...tamperedWithoutHash } = rehashedTamper;
rehashedTamper.packetSha256 = canonicalArtifactHash(tamperedWithoutHash);
expectReject(() => verifyDomainCoherencePacket(rehashedTamper, seed), 'drifted from the verified pair-coherence');

const reordered = structuredClone(first);
const firstPath = reordered.pathRegistry[0]!;
const secondPath = reordered.pathRegistry[1]!;
reordered.pathRegistry[0] = secondPath;
reordered.pathRegistry[1] = firstPath;
const { packetSha256: _oldReordered, ...reorderedWithoutHash } = reordered;
reordered.packetSha256 = canonicalArtifactHash(reorderedWithoutHash);
expectReject(() => verifyDomainCoherencePacket(reordered, seed), 'path handle order drift');

console.log(JSON.stringify({
  domainCoherencePacket: 'PASS',
  deterministicPacketHash: 'PASS',
  deterministicPairHandles: 'PASS',
  deterministicPathHandles: 'PASS',
  fivePairPathCoverage: 'PASS',
  incompletePairSet: 'REJECTED',
  foreignPairIdentity: 'REJECTED',
  mixedBaseline: 'REJECTED',
  staleHashTamper: 'REJECTED',
  rehashedDigestTamper: 'REJECTED',
  pathRegistryReorder: 'REJECTED'
}, null, 2));
