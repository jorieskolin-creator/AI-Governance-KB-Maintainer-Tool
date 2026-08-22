import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import {
  buildSirPairCoherenceContract,
  type SirPairCoherenceOutput
} from '../cognitive/sir-pair-coherence-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type {
  PairCoherencePacket,
  PairCoherenceSnapshot
} from '../orchestration/pair-coherence-packet.js';
import { validateSirPairCoherenceCompletion } from '../validation/sir-pair-coherence-completion.js';
import { materializePairCoherenceReview } from './pair-coherence-materializer.js';

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
    baselineSnapshotId: 'baseline-pair-coherence', baselineSha256: hash,
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

const contract = buildSirPairCoherenceContract({
  authoringPlan: plan,
  pairCoherencePacket: packet,
  categoryBaseline: { criterion: 'A2 baseline' },
  goldenReference: { reference_id: 'A1_AP-A1', normative: false }
});
const completed = new Set<CognitiveTaskType>(contract.upstreamTaskTypes);

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

function validate(output: unknown, currentContract = contract, currentCompleted = completed) {
  return validateSirPairCoherenceCompletion(
    currentContract,
    currentCompleted,
    output,
    { runId: 'pair-coherence-sir-regression', expectedPairId: plan.identity.pairId }
  );
}

if (!validate(noDefects).passed) throw new Error('Defect-free Pair Coherence output failed structural completion.');
if (!validate(highDefect).passed) throw new Error('High-severity defect should be a valid completed QC result.');

const materializedClean = materializePairCoherenceReview(noDefects, packet);
if (!materializedClean.passed) throw new Error('Defect-free Pair Coherence review did not materialize passed=true.');

const materializedHigh = materializePairCoherenceReview(highDefect, packet);
if (materializedHigh.passed) throw new Error('HIGH Pair Coherence defect did not materialize passed=false.');
if (materializedHigh.defects[0]?.defectId !== 'defect_001') {
  throw new Error('Pair Coherence defect identity is not deterministic.');
}
if (materializedHigh.defects[0]?.affectedPaths[0] !== 'findings.capability[finding_001]') {
  throw new Error('Pair Coherence affected path handle did not materialize deterministically.');
}

const mediumDefect = structuredClone(highDefect);
mediumDefect.defects[0]!.severity = 'MEDIUM';
if (!materializePairCoherenceReview(mediumDefect, packet).passed) {
  throw new Error('MEDIUM Pair Coherence defect incorrectly blocked deterministic pair pass status.');
}

const unknownPath = structuredClone(highDefect);
unknownPath.defects[0]!.affectedPathHandles = ['path_999'];
if (!validate(unknownPath).findings.some((item) => item.checkId === 'SIR_PAIR_COHERENCE_UNKNOWN_PATH_HANDLE')) {
  throw new Error('Unknown Pair Coherence path handle was not rejected.');
}

const duplicatePath = structuredClone(highDefect);
duplicatePath.defects[0]!.affectedPathHandles = ['path_002','path_002'];
if (!validate(duplicatePath).findings.some((item) => item.checkId === 'SIR_PAIR_COHERENCE_DUPLICATE_PATH_HANDLE')) {
  throw new Error('Duplicate Pair Coherence path handle was not rejected.');
}

const freePath = {
  ...highDefect,
  defects: [{ ...highDefect.defects[0]!, affectedPaths: ['findings.capability'] }]
};
if (!validate(freePath).findings.some((item) => item.checkId === 'SIR_PAIR_COHERENCE_OUTPUT_CONTRACT')) {
  throw new Error('Free-form affectedPaths field was not rejected by strict Pair Coherence output contract.');
}

const modelOwnedPass = { ...noDefects, passed: true, pairId: 'A2_AP-A2' };
if (!validate(modelOwnedPass).findings.some((item) => item.checkId === 'SIR_PAIR_COHERENCE_OUTPUT_CONTRACT')) {
  throw new Error('Model-owned Pair Coherence pass/pair identity was not rejected.');
}

const tamperedPacket = structuredClone(contract);
const embedded = structuredClone(packet);
embedded.pathRegistry[0]!.label = 'Tampered label';
tamperedPacket.lockedInputs.pair_coherence_packet = embedded;
if (!validate(noDefects, tamperedPacket).findings.some((item) => item.checkId === 'SIR_PAIR_COHERENCE_PACKET_HASH_INTEGRITY')) {
  throw new Error('Tampered Pair Coherence Packet was not rejected during task completion.');
}

const incomplete = new Set<CognitiveTaskType>(completed);
incomplete.delete('REFERENCE_MAPPING');
if (!validate(noDefects, contract, incomplete).findings.some((item) => item.checkId === 'SIR_PREREQUISITE_MISSING')) {
  throw new Error('Missing Reference Mapping prerequisite was not rejected.');
}

console.log(JSON.stringify({
  pairCoherenceSir: 'PASS',
  defectOnlyQualityCheckerOutput: 'PASS',
  highDefectAsValidQcCompletion: 'PASS',
  deterministicPassDerivation: 'PASS',
  deterministicDefectIds: 'PASS',
  deterministicRepairPathResolution: 'PASS',
  mediumDefectNonBlocking: 'PASS',
  unknownPathHandle: 'REJECTED',
  duplicatePathHandle: 'REJECTED',
  freeFormObjectPath: 'REJECTED',
  modelOwnedPassAndPairIdentity: 'REJECTED',
  tamperedPairCoherencePacket: 'REJECTED',
  missingReferencePrerequisite: 'REJECTED'
}, null, 2));
