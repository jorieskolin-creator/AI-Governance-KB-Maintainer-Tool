import {
  buildSirDomainCoherenceContract,
  type SirDomainCoherenceOutput
} from '../cognitive/sir-domain-coherence-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import {
  buildDomainCoherencePacket,
  type DomainCoherencePairDigestInput
} from '../orchestration/domain-coherence-packet.js';
import { coerceSirDomainCoherenceOutput, validateSirDomainCoherenceCompletion } from '../validation/sir-domain-coherence-completion.js';
import { buildPromptPacket } from '../cognitive/prompt-builder.js';
import { materializeDomainCoherenceReview } from './domain-coherence-materializer.js';

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
    capabilityCanonicalDefinition: `${capabilityId} owns a distinct bounded capability claim used for domain-coherence SIR regression.`,
    antipatternCanonicalDefinition: `${antipatternId} owns the paired failure mechanism used for domain-coherence SIR regression.`,
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
const contract = buildSirDomainCoherenceContract({
  domain: 'A',
  domainCoherencePacket: packet,
  domainBaseline: { domain: 'A', title: 'Purpose, value, context, roles and classification' },
  goldenStandardDomainRules: { reference_id: 'A1_AP-A1', normative: false }
});
const completed = new Set<CognitiveTaskType>(contract.upstreamTaskTypes);

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

function validate(output: unknown, currentContract = contract, currentCompleted = completed) {
  return validateSirDomainCoherenceCompletion(
    currentContract,
    currentCompleted,
    output,
    { runId: 'domain-coherence-sir-regression', expectedDomain: 'A' }
  );
}

if (!validate(noDefects).passed) throw new Error('Defect-free Domain Coherence output failed structural completion.');
if (!validate(highDefect).passed) throw new Error('High-severity defect should be a valid completed QC result.');

const materializedClean = materializeDomainCoherenceReview(noDefects, packet);
if (!materializedClean.passed) throw new Error('Defect-free Domain Coherence review did not materialize passed=true.');

const materializedHigh = materializeDomainCoherenceReview(highDefect, packet);
if (materializedHigh.passed) throw new Error('HIGH Domain Coherence defect did not materialize passed=false.');
if (materializedHigh.defects[0]?.defectId !== 'defect_001') {
  throw new Error('Domain Coherence defect identity is not deterministic.');
}
if (materializedHigh.defects[0]?.affectedPairIds[0] !== 'A1_AP-A1') {
  throw new Error('Domain Coherence pair handle did not materialize deterministically.');
}
if (materializedHigh.defects[0]?.affectedPaths[0] !== 'pairs[A1_AP-A1].capability.boundary') {
  throw new Error('Domain Coherence affected path handle did not materialize deterministically.');
}

const mediumDefect = structuredClone(highDefect);
mediumDefect.defects[0]!.severity = 'MEDIUM';
if (!materializeDomainCoherenceReview(mediumDefect, packet).passed) {
  throw new Error('MEDIUM Domain Coherence defect incorrectly blocked deterministic domain pass status.');
}

const unknownPath = structuredClone(highDefect);
unknownPath.defects[0]!.affectedPathHandles = ['path_999'];
if (!validate(unknownPath).findings.some((item) => item.checkId === 'SIR_DOMAIN_COHERENCE_UNKNOWN_PATH_HANDLE')) {
  throw new Error('Unknown Domain Coherence path handle was not rejected.');
}

const unknownPair = structuredClone(highDefect);
unknownPair.defects[0]!.affectedPairHandles = ['pair_009'];
if (!validate(unknownPair).findings.some((item) => item.checkId === 'SIR_DOMAIN_COHERENCE_UNKNOWN_PAIR_HANDLE')) {
  throw new Error('Unknown Domain Coherence pair handle was not rejected.');
}

const duplicatePath = structuredClone(highDefect);
duplicatePath.defects[0]!.affectedPathHandles = ['path_001', 'path_001'];
if (!validate(duplicatePath).passed) {
  throw new Error('Duplicate Domain Coherence path handles should collapse during coerce.');
}

const freePath = {
  ...highDefect,
  defects: [{ ...highDefect.defects[0]!, affectedPaths: ['pairs[A1_AP-A1].capability.boundary'] }]
};
if (!validate(freePath).passed) {
  throw new Error('Resolvable free-form Domain Coherence paths should coerce to locked path handles.');
}

const modelOwnedPass = { ...noDefects, passed: true, domain: 'A' };
if (!validate(modelOwnedPass).passed) {
  throw new Error('Model-owned passed/domain fields should be stripped before Domain Coherence completion.');
}

const messyModelOutput = {
  summary: 'Cross-pair overlap remains after pair-level human approval of residual blockers.',
  findings: [
    {
      severity: 'high',
      type: 'overlap',
      pairs: ['A1', 'A2'],
      description: 'A1 and A2 still claim overlapping ownership of the same purpose-boundary decision.',
      expected: 'Each pair should retain a distinct ownership boundary without silently absorbing an adjacent criterion.'
    }
  ]
};
const coercedMessy = coerceSirDomainCoherenceOutput(messyModelOutput, packet);
if (!coercedMessy || coercedMessy.defects.length !== 1 || coercedMessy.defects[0]?.severity !== 'HIGH') {
  throw new Error('Messy Domain Coherence model JSON was not coerced to the SIR defect contract.');
}
if (!validate(messyModelOutput).passed) {
  throw new Error('Coerced messy Domain Coherence model JSON failed completion.');
}

const domainPrompt = buildPromptPacket(contract);
if (!domainPrompt.user.includes('DOMAIN_COHERENCE_REVIEW') || !domainPrompt.user.includes('affectedPairHandles')) {
  throw new Error('Domain Coherence prompt must include the identity-free output shape.');
}

const tamperedPacket = structuredClone(contract);
const embedded = structuredClone(packet);
embedded.pathRegistry[0]!.label = 'Tampered label';
tamperedPacket.lockedInputs.domain_coherence_packet = embedded;
if (!validate(noDefects, tamperedPacket).findings.some((item) => item.checkId === 'SIR_DOMAIN_COHERENCE_PACKET_HASH_INTEGRITY')) {
  throw new Error('Tampered Domain Coherence Packet was not rejected during task completion.');
}

console.log(JSON.stringify({
  domainCoherenceSir: 'PASS',
  defectOnlyQualityCheckerOutput: 'PASS',
  highDefectAsValidQcCompletion: 'PASS',
  deterministicPassDerivation: 'PASS',
  deterministicDefectIds: 'PASS',
  deterministicPairAndPathResolution: 'PASS',
  mediumDefectNonBlocking: 'PASS',
  unknownPathHandle: 'REJECTED',
  unknownPairHandle: 'REJECTED',
  duplicatePathHandle: 'COLLAPSED',
  freeFormObjectPath: 'COERCED',
  modelOwnedPassAndDomainIdentity: 'STRIPPED',
  messyModelJson: 'COERCED',
  tamperedDomainCoherencePacket: 'REJECTED'
}, null, 2));
