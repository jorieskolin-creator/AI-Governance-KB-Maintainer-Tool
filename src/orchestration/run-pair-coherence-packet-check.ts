import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from '../cognitive/sir-initial-contracts.js';
import { materializeSirAtomics } from '../sir/atomic-materializer.js';
import { materializeSirEvidence } from '../sir/evidence-materializer.js';
import { materializeSirFindings } from '../sir/finding-materializer.js';
import { materializeSirLifecycleTargets } from '../sir/lifecycle-materializer.js';
import { materializeSirReferenceMappings } from '../sir/reference-mapping-materializer.js';
import type { MaterializedSirSourceMappings } from '../sir/source-mapping-materializer.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import {
  buildPairCoherencePacket,
  type PairCoherencePacketSeed
} from './pair-coherence-packet.js';
import { verifyPairCoherencePacket } from './pair-coherence-packet-verifier.js';

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
    baselineSnapshotId: 'baseline-pair-coherence-packet', baselineSha256: hash,
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
    lifecycleStages: [
      'QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION',
      'DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT'
    ]
  },
  allowedSources: [], allowedTactics: [],
  adjacentCriteria: [
    { criterionHandle: 'criterion_001', criterionId: 'AP-A2', boundarySummary: 'Paired anti-pattern boundary.' },
    { criterionHandle: 'criterion_002', criterionId: 'A1', boundarySummary: 'Purpose-boundary dependency.' }
  ]
});

const pairBoundary: SirPairBoundaryOutput = {
  capability: {
    canonicalDefinition: 'A2 defines evidence-based AI suitability and proportionality in a bounded decision context.',
    governancePurpose: 'Keep AI selection tied to a defined problem, alternatives, proportionality and expected value.',
    distinctClaim: 'A2 owns the quality of the AI-selection decision.',
    ownedTopics: ['AI suitability','proportionality'],
    excludedTopics: [{ criterionHandle: 'criterion_002', ownershipBoundary: 'A1 owns authoritative purpose definition.' }]
  },
  antipattern: {
    canonicalDefinition: 'AP-A2 captures solution-first AI selection without adequate problem, alternative and value justification.',
    pairedRelationship: 'AP-A2 is the failure mechanism paired with A2 suitability and proportionality.'
  },
  boundaryRationale: 'The pair is bounded around selection quality rather than purpose definition.'
};
const apFailureModel: SirApFailureModelOutput = {
  failureMechanism: 'AI is predetermined before the problem and credible alternatives are adequately bounded.',
  triggeringConditions: ['Technology choice precedes proportionate problem and alternative analysis.'],
  observableFailureSurfaces: ['Decision records assume AI without comparing credible alternatives.'],
  nonExamples: ['A documented AI choice made after proportionate alternatives analysis.'],
  distinctionFromCapabilityGap: 'The anti-pattern requires solution-first logic, not merely incomplete maturity evidence.'
};
const applicability: SirApplicabilityOutput = {
  capability: {
    statement: 'Applies when an organization makes or maintains a material decision to use AI for a defined purpose.',
    conditions: ['An AI solution decision is materially relevant.'], exclusions: [],
    reassessmentTriggers: ['Problem, alternatives, expected value or operating context changes materially.']
  },
  antipattern: {
    statement: 'Applies where the ordering and rationale of the AI-selection decision can be assessed.',
    conditions: ['Decision chronology and rationale are assessable.'], exclusions: [],
    reassessmentTriggers: ['New decision evidence changes the solution-selection chronology.']
  },
  consistencyNotes: ['Capability and anti-pattern remain independently assessable in the same decision scope.']
};
const primaryQuestions: SirPrimaryQuestionsOutput = {
  capabilityQuestions: [
    { slot: 1, question: 'Is the AI-selection problem and intended value sufficiently bounded?' },
    { slot: 2, question: 'Was AI selected proportionately against credible implementation alternatives?' },
    { slot: 3, question: 'Does current evidence support the claimed suitability and expected value?' }
  ],
  antipatternQuestions: [
    { slot: 1, question: 'Is the solution-first failure mechanism clearly distinguishable from an ordinary evidence gap?' },
    { slot: 2, question: 'Did AI selection materially precede adequate problem and alternatives analysis?' },
    { slot: 3, question: 'Does current evidence support presence, uncertainty or tested absence of the failure mechanism?' }
  ],
  coverageRationale: 'The governed definition, operation and evidence dimensions are covered.'
};
const atomics = materializeSirAtomics({
  capabilitySubcriteria: [
    { questionSlot: 1, criterion: 'Problem and value hypothesis are explicit.', evidenceNeed: 'Authoritative problem and value record.' },
    { questionSlot: 2, criterion: 'Credible alternatives were proportionately considered.', evidenceNeed: 'Decision record comparing alternatives.' },
    { questionSlot: 3, criterion: 'Suitability and value claims have current evidence.', evidenceNeed: 'Current validation or operational evidence.' }
  ],
  antipatternTests: [
    { questionSlot: 1, test: 'Failure mechanism is distinguishable from ordinary immaturity.', evidenceNeed: 'Bounded failure-mechanism analysis.' },
    { questionSlot: 2, test: 'AI choice preceded adequate problem and alternatives analysis.', evidenceNeed: 'Decision chronology and rationale.' },
    { questionSlot: 3, test: 'Presence or tested absence is supported by current evidence.', evidenceNeed: 'Current independent test evidence.' }
  ],
  coverageNotes: ['Every governed question slot has an atomic item.']
});
const evidence = materializeSirEvidence({
  capabilityEvidence: [
    { title: 'Problem and value record', claimSupported: 'The problem and expected value are explicitly bounded.', evidenceClass: 'DECISION_RECORD', minimumTechnicalAssurance: 'DECLARED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Record is current and attributable.'], limitations: ['Document presence alone does not prove effectiveness.'], supportsAtomicHandles: ['atomic_001'] },
    { title: 'Alternatives analysis', claimSupported: 'Credible alternatives were considered before selecting AI.', evidenceClass: 'DECISION_RECORD', minimumTechnicalAssurance: 'IMPLEMENTED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Analysis covers credible alternatives.'], limitations: ['A post-hoc rationale is insufficient.'], supportsAtomicHandles: ['atomic_002'] },
    { title: 'Suitability validation', claimSupported: 'Current evidence supports the claimed suitability and expected value.', evidenceClass: 'TEST_RESULT', minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Validation is current and scope-aligned.'], limitations: ['Out-of-scope testing is insufficient.'], supportsAtomicHandles: ['atomic_003'] }
  ],
  antipatternEvidence: [
    { title: 'Failure-mechanism analysis', claimSupported: 'The solution-first mechanism can be distinguished from ordinary immaturity.', evidenceClass: 'ANALYSIS_RECORD', minimumTechnicalAssurance: 'DECLARED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Mechanism and scope are explicit.'], limitations: ['Definition alone does not prove presence.'], supportsAtomicHandles: ['atomic_001'] },
    { title: 'Decision chronology', claimSupported: 'Decision chronology can show whether AI was predetermined.', evidenceClass: 'DECISION_RECORD', minimumTechnicalAssurance: 'IMPLEMENTED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Chronology is attributable and complete enough.'], limitations: ['Timing alone does not prove motive.'], supportsAtomicHandles: ['atomic_002'] },
    { title: 'Independent absence test', claimSupported: 'Independent testing can support presence, uncertainty or tested absence.', evidenceClass: 'INDEPENDENT_TEST', minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'FORMALLY_APPROVED', acceptanceConditions: ['Testing covers the defined mechanism and scope.'], limitations: ['Silence cannot establish tested absence.'], supportsAtomicHandles: ['atomic_003'] }
  ],
  sufficiencyNotes: ['Every atomic item has explicit evidence coverage.']
});
const evidenceSafety = {
  capabilityRules: { evidenceCeilings: ['Intent does not prove effectiveness.'], falsePositiveGuards: ['Require attributable evidence.'], prohibitedInferences: ['Do not infer approval.'], contradictionHandling: ['Conflicts keep conclusions unresolved.'], freshnessRules: ['Evidence must remain current.'] },
  antipatternRules: { evidenceCeilings: ['Concern alone does not prove the failure mechanism.'], falsePositiveGuards: ['Distinguish ordinary maturity gaps.'], prohibitedInferences: ['Do not infer absence from silence.'], contradictionHandling: ['Conflicts prevent definitive absence.'], freshnessRules: ['Absence evidence must remain current.'] },
  crossPairSafetyNotes: ['Capability and anti-pattern conclusions remain independent.']
};
const apAbsence = {
  requiredArtifacts: ['Scoped executed absence test','Independent verification record'],
  interpretationBoundary: 'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'
};
const sourceMappings: MaterializedSirSourceMappings = {
  sourceContextPacketSha256: '2'.repeat(64), capability: [], antipattern: [], unmappedClaims: [],
  mappingNotes: ['No source mapping is required for this packet-builder regression.']
};
const findings = materializeSirFindings({
  capabilityFindings: [{ title: 'Suitability evidence is materially insufficient.', eligibleConclusionStates: ['NOT_SATISFIED','UNKNOWN'], atomicHandles: ['atomic_003'], evidenceHandles: ['evidence_003'], defaultSeverity: 'HIGH', lifecycleConsequence: 'Constrain progression pending evidence.', humanLockRequired: true }],
  antipatternFindings: [{ title: 'Solution-first decision logic is materially evidenced.', eligibleConclusionStates: ['CONFIRMED_PRESENT','UNKNOWN'], atomicHandles: ['atomic_002'], evidenceHandles: ['evidence_002'], defaultSeverity: 'HIGH', lifecycleConsequence: 'Require human review before progression.', humanLockRequired: true }],
  findingLogicNotes: ['Findings remain evidence-bounded reusable knowledge definitions.']
});
const controlBoundary: SirControlBoundaryOutput = {
  capabilityHardGate: { effect: 'CONSTRAIN', conditions: ['Material suitability evidence remains unresolved.'], overrideAuthority: 'Designated accountable human authority' },
  antipatternHardGate: { effect: 'BLOCK', conditions: ['Solution-first failure mechanism is confirmed.'], overrideAuthority: 'Designated accountable human authority' },
  capabilityRuntimeBoundary: { machineMay: ['Summarize validated evidence.'], machineMustNot: ['Approve progression.'], humanAuthorityRequiredFor: ['Any progression or exception decision.'] },
  antipatternRuntimeBoundary: { machineMay: ['Surface validated failure indicators.'], machineMustNot: ['Accept residual risk.'], humanAuthorityRequiredFor: ['Any residual-risk or progression decision.'] },
  controlNotes: ['Control semantics do not authorize a real system.']
};
const lifecycleTargets = materializeSirLifecycleTargets({
  capabilityTargets: plan.vocabulary.lifecycleStages.map(() => ({ minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'HUMAN_VALIDATED' })),
  antipatternTargets: plan.vocabulary.lifecycleStages.map(() => ({ minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'HUMAN_VALIDATED' })),
  rationaleNotes: ['Lifecycle assurance values are reusable knowledge targets.']
}, plan.vocabulary.lifecycleStages);
const referenceMappings = materializeSirReferenceMappings({
  capabilityRelatedCriterionHandles: ['criterion_001','criterion_002'],
  antipatternRelatedCriterionHandles: [],
  referenceNotes: ['Related criteria remain bounded to the Authoring Plan universe.']
}, { adjacentCriteria: plan.adjacentCriteria, tacticResolutionMode: 'NO_APPROVED_TACTIC_AVAILABLE' });

const seed: PairCoherencePacketSeed = {
  authoringPlan: plan, pairBoundary, apFailureModel, applicability, primaryQuestions, atomics, evidence,
  evidenceSafety, apAbsence, sourceMappings, findings, controlBoundary, lifecycleTargets, referenceMappings
};

const first = buildPairCoherencePacket(seed);
const second = buildPairCoherencePacket(seed);
verifyPairCoherencePacket(first, seed);
if (first.packetSha256 !== second.packetSha256) {
  throw new Error('Identical Pair Coherence inputs produced different packet hashes.');
}
if (first.pathRegistry[0]?.pathHandle !== 'path_001') {
  throw new Error('Pair Coherence path handles are not deterministic.');
}
if (!first.pathRegistry.some((entry) => entry.objectPath === 'findings.capability[finding_001]')) {
  throw new Error('Pair Coherence path registry omitted materialized Finding paths.');
}
if (!first.pathRegistry.some((entry) => entry.objectPath === 'lifecycleTargets.capability[DEPLOYMENT]')) {
  throw new Error('Pair Coherence path registry omitted lifecycle-stage paths.');
}

function expectReject(fn: () => void, expected: string): void {
  try { fn(); } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw new Error(`Expected ${expected}; received ${message}`);
    return;
  }
  throw new Error(`Expected rejection containing ${expected}.`);
}

const staleHash = structuredClone(first);
staleHash.pathRegistry[0]!.label = 'Tampered label.';
expectReject(() => verifyPairCoherencePacket(staleHash, seed), 'hash mismatch');

const rehashedTamper = structuredClone(first);
rehashedTamper.snapshot.findings.capability[0]!.title = 'Tampered persisted finding.';
const { packetSha256: _old, ...tamperedWithoutHash } = rehashedTamper;
rehashedTamper.packetSha256 = canonicalArtifactHash(tamperedWithoutHash);
expectReject(() => verifyPairCoherencePacket(rehashedTamper, seed), 'drifted from the verified upstream');

const reordered = structuredClone(first);
const firstPath = reordered.pathRegistry[0]!;
const secondPath = reordered.pathRegistry[1]!;
reordered.pathRegistry[0] = secondPath;
reordered.pathRegistry[1] = firstPath;
const { packetSha256: _oldReordered, ...reorderedWithoutHash } = reordered;
reordered.packetSha256 = canonicalArtifactHash(reorderedWithoutHash);
expectReject(() => verifyPairCoherencePacket(reordered, seed), 'path handle order drift');

console.log(JSON.stringify({
  pairCoherencePacket: 'PASS',
  deterministicPacketHash: 'PASS',
  deterministicPathHandles: 'PASS',
  findingPathCoverage: 'PASS',
  lifecycleStagePathCoverage: 'PASS',
  staleHashTamper: 'REJECTED',
  rehashedSnapshotTamper: 'REJECTED',
  pathRegistryReorder: 'REJECTED'
}, null, 2));
