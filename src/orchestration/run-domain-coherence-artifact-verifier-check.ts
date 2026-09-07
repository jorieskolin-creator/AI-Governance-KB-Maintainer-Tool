import {
  buildSirDomainCoherenceContract,
  type SirDomainCoherenceOutput
} from '../cognitive/sir-domain-coherence-contract.js';
import type { MaterializedDomainCoherenceReview } from '../sir/domain-coherence-materializer.js';
import { materializeValidatedSirTaskOutput } from '../sir/task-artifact.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import { verifyPersistedDomainCoherenceArtifact } from './domain-coherence-artifact-verifier.js';
import {
  buildDomainCoherencePacket,
  type DomainCoherencePairDigestInput
} from './domain-coherence-packet.js';

const hash = 'a'.repeat(64);

function digest(slot: 1 | 2 | 3 | 4 | 5): DomainCoherencePairDigestInput {
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
    capabilityCanonicalDefinition: `${capabilityId} owns a distinct bounded capability claim used for domain-coherence artifact regression.`,
    antipatternCanonicalDefinition: `${antipatternId} owns the paired failure mechanism used for domain-coherence artifact regression.`,
    ownedTopics: [`${capabilityId} owned topic`],
    excludedTopics: [],
    relatedCapabilityCriterionIds: [],
    relatedAntipatternCriterionIds: [],
    capabilityFindingTitles: [`${capabilityId} finding`],
    antipatternFindingTitles: [`${antipatternId} finding`],
    capabilitySourceIds: [],
    antipatternSourceIds: []
  };
}

const packet = buildDomainCoherencePacket({
  domain: 'A',
  baselineSha256: hash,
  pairDigests: [digest(1), digest(2), digest(3), digest(4), digest(5)]
});
const domainBaseline = { domain: 'A', title: 'Purpose, value, context, roles and classification' };
const goldenStandardDomainRules = { reference_id: 'A1_AP-A1', normative: false };
const contract = buildSirDomainCoherenceContract({
  domain: 'A',
  domainCoherencePacket: packet,
  domainBaseline,
  goldenStandardDomainRules
});

const noDefects: SirDomainCoherenceOutput = {
  defects: [],
  coherenceSummary: 'No material cross-pair domain coherence defects were identified in this bounded five-pair review.'
};
const highDefect: SirDomainCoherenceOutput = {
  defects: [
    {
      severity: 'HIGH',
      coherenceDimension: 'OVERLAP',
      affectedPairHandles: ['pair_001', 'pair_002'],
      affectedPathHandles: ['path_001', 'path_011'],
      issue: 'A1 and A2 claim overlapping ownership of the same purpose-boundary decision, collapsing the intended pair separation.',
      coherenceExpectation: 'Each pair should retain a distinct ownership boundary without silently absorbing an adjacent criterion.',
      recommendedRepairPairHandles: ['pair_002'],
      recommendedRepairPathHandles: ['path_011']
    }
  ],
  coherenceSummary: 'One high-severity overlap requires local repair of the A2 capability boundary.'
};

const persistedClean = materializeValidatedSirTaskOutput(contract, noDefects) as MaterializedDomainCoherenceReview;
const persistedHigh = materializeValidatedSirTaskOutput(contract, highDefect) as MaterializedDomainCoherenceReview;

function verify(output: unknown, currentContract = contract, verifiedPacket = packet): void {
  verifyPersistedDomainCoherenceArtifact({
    output,
    domainCoherenceTaskContract: currentContract,
    domain: 'A',
    verifiedPacket,
    domainBaseline,
    goldenStandardDomainRules
  });
}

verify(persistedClean);
if (!persistedClean.passed || persistedClean.domain !== 'A') {
  throw new Error('Task artifact route did not persist a derived passing Domain Coherence review.');
}
if (persistedClean.domainCoherencePacketSha256 !== packet.packetSha256) {
  throw new Error('Task artifact route did not bind the persisted review to the locked packet hash.');
}

verify(persistedHigh);
if (persistedHigh.passed) {
  throw new Error('HIGH Domain Coherence defect did not persist as derived passed=false.');
}
if (persistedHigh.defects[0]?.defectId !== 'defect_001') {
  throw new Error('Task artifact route did not materialize deterministic defect identity.');
}
if (persistedHigh.defects[0]?.affectedPairIds[1] !== 'A2_AP-A2') {
  throw new Error('Task artifact route did not resolve pair handles deterministically.');
}
if (persistedHigh.defects[0]?.affectedPaths[0] !== 'pairs[A1_AP-A1].capability.boundary') {
  throw new Error('Task artifact route did not resolve path handles deterministically.');
}

function expectReject(fn: () => void, expected: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) {
      throw new Error(`Expected ${expected}; received ${message}`);
    }
    return;
  }
  throw new Error(`Expected rejection containing ${expected}.`);
}

expectReject(() => verify(noDefects), 'contains unexpected or missing fields');
expectReject(() => verify(highDefect), 'contains unexpected or missing fields');

const tamperedPass = { ...structuredClone(persistedHigh), passed: true };
expectReject(() => verify(tamperedPass), 'pass status drifted');

const tamperedDefectId = structuredClone(persistedHigh);
tamperedDefectId.defects[0]!.defectId = 'defect_999';
expectReject(() => verify(tamperedDefectId), 'materialized content drifted');

const tamperedPath = structuredClone(persistedHigh);
tamperedPath.defects[0]!.affectedPaths = ['pairs[A2_AP-A2].capability.boundary'];
expectReject(() => verify(tamperedPath), 'materialized content drifted');

const tamperedPacketHash = { ...structuredClone(persistedClean), domainCoherencePacketSha256: 'b'.repeat(64) };
expectReject(() => verify(tamperedPacketHash), 'packet hash drifted');

const driftedBaseline = structuredClone(contract);
driftedBaseline.lockedInputs.domain_baseline = { domain: 'A', title: 'Drifted baseline' };
expectReject(() => verify(persistedClean, driftedBaseline), 'domain baseline drifted');

const driftedPacket = structuredClone(contract);
const embedded = structuredClone(packet);
embedded.pathRegistry[0]!.label = 'Tampered packet label';
driftedPacket.lockedInputs.domain_coherence_packet = embedded;
expectReject(() => verify(persistedClean, driftedPacket), 'does not match its SHA-256 hash');

const rehashedPacket = structuredClone(contract);
const rehashedEmbedded = structuredClone(packet);
rehashedEmbedded.pathRegistry[0]!.label = 'Rehashed packet label';
const { packetSha256: _ignored, ...rehashedWithoutHash } = rehashedEmbedded;
const rehashed = {
  ...rehashedWithoutHash,
  packetSha256: canonicalArtifactHash(rehashedWithoutHash)
};
rehashedPacket.lockedInputs.domain_coherence_packet = rehashed;
rehashedPacket.lockedInputs.domain_coherence_packet_sha256 = rehashed.packetSha256;
expectReject(() => verify(persistedClean, rehashedPacket), 'Domain Coherence Packet drifted');

const wrongRole = structuredClone(contract);
wrongRole.modelRole = 'WORKHORSE';
expectReject(() => verify(persistedClean, wrongRole), 'QUALITY_CHECKER critic-only');

console.log(JSON.stringify({
  persistedDomainCoherenceArtifact: 'PASS',
  taskRunnerMaterializationPath: 'PASS',
  deterministicDefectIdentity: 'PASS',
  highDefectDerivedFail: 'PASS',
  rawSemanticDomainCoherenceOutput: 'REJECTED',
  tamperedDerivedPassStatus: 'REJECTED',
  tamperedDefectIdentity: 'REJECTED',
  tamperedResolvedPath: 'REJECTED',
  tamperedPacketHashBinding: 'REJECTED',
  domainBaselineDrift: 'REJECTED',
  lockedPacketHashTamper: 'REJECTED',
  rehashedLockedPacketDrift: 'REJECTED',
  nonQualityCheckerRole: 'REJECTED'
}, null, 2));
