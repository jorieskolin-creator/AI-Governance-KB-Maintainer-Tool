import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import {
  buildSirPairCoherenceContract,
  type SirPairCoherenceOutput
} from '../cognitive/sir-pair-coherence-contract.js';
import type { MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import { materializeValidatedSirTaskOutput } from '../sir/task-artifact.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import { verifyPersistedPairCoherenceArtifact } from './pair-coherence-artifact-verifier.js';
import type {
  PairCoherencePacket,
  PairCoherenceSnapshot
} from './pair-coherence-packet.js';

const hash = 'a'.repeat(64);
const plan = buildAuthoringPlan({
  identity: {
    capabilityId: 'A2', antipatternId: 'AP-A2', pairId: 'A2_AP-A2', domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'AI suitability, proportionality and value hypothesis',
    antipatternTitle: 'AI-first solutionism or value theatre'
  },
  targetVersion: '1.0.0', schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-pair-coherence-artifact', baselineSha256: hash,
    productionContractVersion: '1.0.0', productionContractSha256: hash,
    capabilitySchemaVersion: '2.1.0', capabilitySchemaSha256: hash,
    antipatternSchemaVersion: '2.1.0', antipatternSchemaSha256: hash,
    sharedDefinitionsVersion: '2.1.0', sharedDefinitionsSha256: hash,
    sourceRegisterVersion: '1.5.0', sourceRegisterSha256: hash,
    tacticCatalogVersion: null, tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1', goldenReferenceVersion: '1.0.0', goldenReferenceSha256: hash
  },
  questionDimensions: ['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary: {
    technicalAssurance: ['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],
    antipatternConclusionStates: ['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],
    hardGateEffects: ['NONE','WARN','BLOCK','CONSTRAIN'],
    lifecycleStages: ['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']
  },
  allowedSources: [], allowedTactics: [], adjacentCriteria: []
});

const packetWithoutHash = {
  packetVersion: '1.0.0' as const,
  pairId: plan.identity.pairId,
  authoringPlanSha256: plan.planSha256,
  snapshot: {} as PairCoherenceSnapshot,
  pathRegistry: [
    { pathHandle: 'path_001' as const, objectPath: 'pairBoundary.capability', label: 'Capability boundary' },
    { pathHandle: 'path_002' as const, objectPath: 'findings.capability[finding_001]', label: 'Capability finding' },
    { pathHandle: 'path_003' as const, objectPath: 'controlBoundary.capabilityHardGate', label: 'Capability hard gate' }
  ]
};
const packet: PairCoherencePacket = {
  ...packetWithoutHash,
  packetSha256: canonicalArtifactHash(packetWithoutHash)
};

const categoryBaseline = { criterion: 'A2 baseline' };
const goldenReference = { reference_id: 'A1_AP-A1', normative: false };
const contract = buildSirPairCoherenceContract({
  authoringPlan: plan,
  pairCoherencePacket: packet,
  categoryBaseline,
  goldenReference
});

const noDefects: SirPairCoherenceOutput = {
  defects: [],
  coherenceSummary: 'No material semantic cross-artifact coherence defects were identified in this bounded review.'
};
const highDefect: SirPairCoherenceOutput = {
  defects: [
    {
      severity: 'HIGH',
      coherenceDimension: 'CROSS_ARTIFACT_CONTRADICTION',
      affectedPathHandles: ['path_002','path_003'],
      issue: 'The hard-gate semantics materially understate the consequence described by the validated finding.',
      coherenceExpectation: 'Control consequences should remain semantically consistent with the validated finding without rewriting it.',
      recommendedRepairPathHandles: ['path_003']
    }
  ],
  coherenceSummary: 'One high-severity cross-artifact inconsistency requires local repair of the control boundary.'
};

const persistedClean = materializeValidatedSirTaskOutput(
  contract,
  noDefects
) as MaterializedPairCoherenceReview;
const persistedHigh = materializeValidatedSirTaskOutput(
  contract,
  highDefect
) as MaterializedPairCoherenceReview;

function verify(output: unknown, currentContract = contract, verifiedPacket = packet): void {
  verifyPersistedPairCoherenceArtifact({
    output,
    pairCoherenceTaskContract: currentContract,
    authoringPlan: plan,
    verifiedPacket,
    categoryBaseline,
    goldenReference
  });
}

verify(persistedClean);
if (!persistedClean.passed || persistedClean.pairId !== plan.identity.pairId) {
  throw new Error('Task artifact route did not persist a derived passing Pair Coherence review.');
}
if (persistedClean.pairCoherencePacketSha256 !== packet.packetSha256) {
  throw new Error('Task artifact route did not bind the persisted review to the locked packet hash.');
}

verify(persistedHigh);
if (persistedHigh.passed) {
  throw new Error('HIGH Pair Coherence defect did not persist as derived passed=false.');
}
if (persistedHigh.defects[0]?.defectId !== 'defect_001') {
  throw new Error('Task artifact route did not materialize deterministic defect identity.');
}
if (persistedHigh.defects[0]?.affectedPaths[0] !== 'findings.capability[finding_001]') {
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

const tamperedPass = {
  ...structuredClone(persistedHigh),
  passed: true
};
expectReject(() => verify(tamperedPass), 'pass status drifted');

const tamperedDefectId = structuredClone(persistedHigh);
tamperedDefectId.defects[0]!.defectId = 'defect_999';
expectReject(() => verify(tamperedDefectId), 'materialized content drifted');

const tamperedPath = structuredClone(persistedHigh);
tamperedPath.defects[0]!.affectedPaths = ['pairBoundary.capability'];
expectReject(() => verify(tamperedPath), 'materialized content drifted');

const tamperedPacketHash = {
  ...structuredClone(persistedClean),
  pairCoherencePacketSha256: 'b'.repeat(64)
};
expectReject(() => verify(tamperedPacketHash), 'packet hash drifted');

const driftedBaseline = structuredClone(contract);
driftedBaseline.lockedInputs.category_baseline = { criterion: 'Drifted baseline' };
expectReject(() => verify(persistedClean, driftedBaseline), 'category baseline drifted');

const driftedPacket = structuredClone(contract);
const embedded = structuredClone(packet);
embedded.pathRegistry[0]!.label = 'Tampered packet label';
driftedPacket.lockedInputs.pair_coherence_packet = embedded;
expectReject(() => verify(persistedClean, driftedPacket), 'does not match its SHA-256 hash');

const rehashedPacket = structuredClone(contract);
const rehashedEmbedded = structuredClone(packet);
rehashedEmbedded.pathRegistry[0]!.label = 'Rehashed packet label';
const { packetSha256: _ignored, ...rehashedWithoutHash } = rehashedEmbedded;
const rehashed = {
  ...rehashedWithoutHash,
  packetSha256: canonicalArtifactHash(rehashedWithoutHash)
};
rehashedPacket.lockedInputs.pair_coherence_packet = rehashed;
rehashedPacket.lockedInputs.pair_coherence_packet_sha256 = rehashed.packetSha256;
expectReject(() => verify(persistedClean, rehashedPacket), 'Pair Coherence Packet drifted');

const wrongRole = structuredClone(contract);
wrongRole.modelRole = 'WORKHORSE';
expectReject(() => verify(persistedClean, wrongRole), 'QUALITY_CHECKER critic-only');

console.log(JSON.stringify({
  persistedPairCoherenceArtifact: 'PASS',
  taskRunnerMaterializationPath: 'PASS',
  deterministicDefectIdentity: 'PASS',
  highDefectDerivedFail: 'PASS',
  rawSemanticPairCoherenceOutput: 'REJECTED',
  tamperedDerivedPassStatus: 'REJECTED',
  tamperedDefectIdentity: 'REJECTED',
  tamperedResolvedPath: 'REJECTED',
  tamperedPacketHashBinding: 'REJECTED',
  categoryBaselineDrift: 'REJECTED',
  lockedPacketHashTamper: 'REJECTED',
  rehashedLockedPacketDrift: 'REJECTED',
  nonQualityCheckerRole: 'REJECTED'
}, null, 2));
