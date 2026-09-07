import { buildAuthoringPlan, type AuthoringPlan } from '../authoring/authoring-plan.js';
import { buildSirPairCoherenceContract } from '../cognitive/sir-pair-coherence-contract.js';
import type { SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from '../cognitive/sir-initial-contracts.js';
import type { TaskContract } from '../domain/task-contract.js';
import { materializeValidatedSirTaskOutput } from '../sir/task-artifact.js';
import type { MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import type { MaterializedSirSourceMappings } from '../sir/source-mapping-materializer.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import {
  resolveDomainCoherenceContract,
  type DomainCoherencePairResolutionInput
} from './domain-coherence-resolver.js';
import { buildPairCoherencePacket, type PairCoherencePacketSeed } from './pair-coherence-packet.js';

const hash = 'a'.repeat(64);
const titles: Record<number, { capability: string; antipattern: string }> = {
  1: { capability: 'Intended purpose and use boundaries', antipattern: 'Purpose-free or unbounded AI use' },
  2: { capability: 'AI suitability, proportionality and value hypothesis', antipattern: 'AI-first solutionism or value theatre' },
  3: { capability: 'Value-chain roles and responsibility allocation', antipattern: 'Responsibility diffusion across the AI value chain' },
  4: { capability: 'Risk, legal and regulatory classification', antipattern: 'Classification theatre or obligation-evading scoping' },
  5: { capability: 'Lifecycle stage, transition and operating-boundary control', antipattern: 'Lifecycle-blind or unauthorized operational expansion' }
};

function planFor(slot: 1 | 2 | 3 | 4 | 5, baselineSha256 = hash): AuthoringPlan {
  const capabilityId = `A${slot}`;
  const title = titles[slot]!;
  return buildAuthoringPlan({
    identity: {
      capabilityId,
      antipatternId: `AP-${capabilityId}`,
      pairId: `${capabilityId}_AP-${capabilityId}`,
      domain: 'A',
      domainTitle: 'Purpose, value, context, roles and classification',
      capabilityTitle: title.capability,
      antipatternTitle: title.antipattern
    },
    targetVersion: '1.0.0',
    schemaVersion: '2.1.0',
    baseline: {
      baselineSnapshotId: 'baseline-domain-coherence',
      baselineSha256,
      productionContractVersion: '1.1.0',
      productionContractSha256: hash,
      capabilitySchemaVersion: '2.1.0',
      capabilitySchemaSha256: hash,
      antipatternSchemaVersion: '2.1.0',
      antipatternSchemaSha256: hash,
      sharedDefinitionsVersion: '2.1.0',
      sharedDefinitionsSha256: hash,
      sourceRegisterVersion: '1.5.0',
      sourceRegisterSha256: hash,
      tacticCatalogVersion: null,
      tacticCatalogSha256: null,
      goldenReferenceId: 'A1_AP-A1',
      goldenReferenceVersion: '1.0.0',
      goldenReferenceSha256: hash
    },
    questionDimensions: ['DEFINITION_AND_INTENT', 'IMPLEMENTATION_AND_OPERATION', 'EVIDENCE_AND_EFFECTIVENESS'],
    vocabulary: {
      technicalAssurance: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED'],
      humanAssurance: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'],
      capabilityConclusionStates: ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE'],
      antipatternConclusionStates: ['CONFIRMED_PRESENT', 'PARTIALLY_PRESENT', 'TESTED_ABSENT', 'UNKNOWN', 'NOT_APPLICABLE'],
      hardGateEffects: ['NONE', 'WARN', 'BLOCK', 'CONSTRAIN'],
      lifecycleStages: [
        'QUALIFICATION_AND_REGISTRATION',
        'DESIGN_AND_DEVELOPMENT',
        'VERIFICATION_AND_VALIDATION',
        'DEPLOYMENT',
        'OPERATION_AND_MONITORING',
        'REVIEW_AND_EVALUATION',
        'RETIREMENT'
      ]
    },
    allowedSources: [],
    allowedTactics: [],
    adjacentCriteria: []
  });
}

const questions: SirPrimaryQuestionsOutput = {
  capabilityQuestions: [
    { slot: 1, question: 'Is the governed capability claim bounded clearly enough to be assessed?' },
    { slot: 2, question: 'Is the capability implemented and operated within that bounded claim?' },
    { slot: 3, question: 'Does current evidence support effectiveness of the bounded claim?' }
  ],
  antipatternQuestions: [
    { slot: 1, question: 'Is the paired failure mechanism distinguishable from ordinary immaturity?' },
    { slot: 2, question: 'Is the failure mechanism present in the operating decision path?' },
    { slot: 3, question: 'Does current evidence support presence, uncertainty or tested absence?' }
  ],
  coverageRationale: 'The governed definition, operation and evidence dimensions are covered.'
};
const applicability: SirApplicabilityOutput = {
  capability: {
    statement: 'Applies where the governed capability claim can be assessed in a defined operating context.',
    conditions: ['The assessed system has a bounded purpose or decision context.'],
    exclusions: [],
    reassessmentTriggers: ['Purpose, users or operating context change materially.']
  },
  antipattern: {
    statement: 'Applies where the paired failure mechanism can be independently assessed.',
    conditions: ['Decision chronology and rationale are assessable.'],
    exclusions: [],
    reassessmentTriggers: ['New evidence changes the failure-mechanism assessment.']
  },
  consistencyNotes: ['Capability and anti-pattern remain independently assessable.']
};
const evidenceSafety = {
  capabilityRules: {
    evidenceCeilings: ['Intent does not prove effectiveness.'],
    falsePositiveGuards: ['Require attributable evidence.'],
    prohibitedInferences: ['Do not infer approval.'],
    contradictionHandling: ['Conflicts keep conclusions unresolved.'],
    freshnessRules: ['Evidence must remain current.']
  },
  antipatternRules: {
    evidenceCeilings: ['Concern alone does not prove the failure mechanism.'],
    falsePositiveGuards: ['Distinguish ordinary maturity gaps.'],
    prohibitedInferences: ['Do not infer absence from silence.'],
    contradictionHandling: ['Conflicts prevent definitive absence.'],
    freshnessRules: ['Absence evidence must remain current.']
  },
  crossPairSafetyNotes: ['Capability and anti-pattern conclusions remain independent.']
};
const apAbsence = {
  requiredArtifacts: ['Scoped executed absence test', 'Independent verification record'],
  interpretationBoundary: 'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'
};
const sourceMappings: MaterializedSirSourceMappings = {
  sourceContextPacketSha256: '2'.repeat(64),
  capability: [],
  antipattern: [],
  unmappedClaims: [],
  mappingNotes: ['No source mapping is required for this domain-coherence resolver regression.']
};
const controlBoundary: SirControlBoundaryOutput = {
  capabilityHardGate: { effect: 'CONSTRAIN', conditions: ['Material evidence remains unresolved.'], overrideAuthority: 'Designated accountable human authority' },
  antipatternHardGate: { effect: 'BLOCK', conditions: ['Failure mechanism is confirmed.'], overrideAuthority: 'Designated accountable human authority' },
  capabilityRuntimeBoundary: { machineMay: ['Summarize validated evidence.'], machineMustNot: ['Approve progression.'], humanAuthorityRequiredFor: ['Any progression or exception decision.'] },
  antipatternRuntimeBoundary: { machineMay: ['Surface validated failure indicators.'], machineMustNot: ['Accept residual risk.'], humanAuthorityRequiredFor: ['Any residual-risk or progression decision.'] },
  controlNotes: ['Control semantics do not authorize a real system.']
};

function pairBoundary(plan: AuthoringPlan): SirPairBoundaryOutput {
  return {
    capability: {
      canonicalDefinition: `${plan.identity.capabilityId} defines ${plan.identity.capabilityTitle} as a bounded, independently assessable capability.`,
      governancePurpose: `Keep ${plan.identity.capabilityId} from absorbing adjacent category ownership.`,
      distinctClaim: `${plan.identity.capabilityId} owns one distinct governance claim.`,
      ownedTopics: [plan.identity.capabilityTitle],
      excludedTopics: []
    },
    antipattern: {
      canonicalDefinition: `${plan.identity.antipatternId} captures ${plan.identity.antipatternTitle} as the paired failure mechanism.`,
      pairedRelationship: `${plan.identity.antipatternId} is the failure mechanism paired with ${plan.identity.capabilityId}.`
    },
    boundaryRationale: `${plan.identity.pairId} is bounded around one capability and its paired anti-pattern.`
  };
}

function apFailureModel(plan: AuthoringPlan): SirApFailureModelOutput {
  return {
    failureMechanism: `${plan.identity.antipatternTitle} appears when the paired capability boundary is bypassed.`,
    triggeringConditions: ['The bounded capability claim is treated as optional or theatrical.'],
    observableFailureSurfaces: ['Records omit the owned decision or treat it as a label only.'],
    nonExamples: ['A documented, scoped decision that stays inside the capability boundary.'],
    distinctionFromCapabilityGap: 'The anti-pattern requires the failure mechanism, not merely incomplete maturity evidence.'
  };
}

function pairFixture(slot: 1 | 2 | 3 | 4 | 5, baselineSha256 = hash): DomainCoherencePairResolutionInput {
  const authoringPlan = planFor(slot, baselineSha256);
  const categoryBaseline = { criterion: authoringPlan.identity.capabilityId };
  const goldenReference = { reference_id: 'A1_AP-A1', normative: false };
  const seed: PairCoherencePacketSeed = {
    authoringPlan,
    pairBoundary: pairBoundary(authoringPlan),
    apFailureModel: apFailureModel(authoringPlan),
    applicability,
    primaryQuestions: questions,
    atomics: { capability: [], antipattern: [] },
    evidence: { capability: [], antipattern: [] },
    evidenceSafety,
    apAbsence,
    sourceMappings,
    findings: { capability: [], antipattern: [], findingLogicNotes: ['No finding is required for this resolver regression.'] },
    controlBoundary,
    lifecycleTargets: { capability: [], antipattern: [], rationaleNotes: ['Lifecycle targets are not required for this resolver regression.'] },
    referenceMappings: {
      capabilityRelatedCriteria: [],
      antipatternRelatedCriteria: [],
      capabilityTacticRefs: [],
      antipatternTacticRefs: [],
      referenceNotes: ['Related criteria remain empty in this resolver regression.']
    }
  };
  const pairCoherencePacket = buildPairCoherencePacket(seed);
  const pairCoherenceTaskContract = buildSirPairCoherenceContract({
    authoringPlan,
    pairCoherencePacket,
    categoryBaseline,
    goldenReference
  });
  const pairCoherenceOutput = materializeValidatedSirTaskOutput(pairCoherenceTaskContract, {
    defects: [],
    coherenceSummary: `${authoringPlan.identity.pairId} has no material pair-coherence defects in this resolver regression.`
  });
  return {
    authoringPlan,
    pairCoherenceTaskContract,
    pairCoherenceOutput,
    categoryBaseline,
    goldenReference
  };
}

const domainBaseline = { domain: 'A', title: 'Purpose, value, context, roles and classification' };
const goldenStandardDomainRules = { reference_id: 'A1_AP-A1', normative: false };
const pairs = [pairFixture(1), pairFixture(2), pairFixture(3), pairFixture(4), pairFixture(5)];

const contract = resolveDomainCoherenceContract({
  domain: 'A',
  domainBaseline,
  goldenStandardDomainRules,
  pairs
});
if (contract.taskType !== 'DOMAIN_COHERENCE_REVIEW' || contract.contractVersion !== '2.0.0' || contract.modelRole !== 'QUALITY_CHECKER') {
  throw new Error('Resolver did not construct QUALITY_CHECKER Domain Coherence SIR v2 contract.');
}
if (contract.targetObjectId !== 'DOMAIN-A') {
  throw new Error('Domain Coherence contract target is not DOMAIN-A.');
}
const locked = contract.lockedInputs.domain_coherence_packet as { pairDigests?: Array<{ pairId: string; pairHandle: string }>; packetSha256?: string };
if (locked.pairDigests?.[0]?.pairHandle !== 'pair_001' || locked.pairDigests?.[4]?.pairId !== 'A5_AP-A5') {
  throw new Error('Domain Coherence resolver did not lock the expected five-pair digest set.');
}
if (!locked.packetSha256 || contract.lockedInputs.domain_coherence_packet_sha256 !== locked.packetSha256) {
  throw new Error('Domain Coherence resolver packet hash binding is inconsistent.');
}

async function expectReject(fn: () => void, expected: string): Promise<void> {
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

await expectReject(
  () => resolveDomainCoherenceContract({ domain: 'A', domainBaseline, goldenStandardDomainRules, pairs: pairs.slice(0, 4) }),
  'exactly 5 validated pairs'
);

await expectReject(
  () => resolveDomainCoherenceContract({
    domain: 'A',
    domainBaseline,
    goldenStandardDomainRules,
    pairs: [pairs[0]!, pairs[1]!, pairs[2]!, pairs[3]!, pairs[0]!]
  }),
  'pair set must be'
);

await expectReject(
  () => resolveDomainCoherenceContract({
    domain: 'A',
    domainBaseline,
    goldenStandardDomainRules,
    pairs: [pairs[0]!, pairs[1]!, pairs[2]!, pairs[3]!, pairFixture(5, 'b'.repeat(64))]
  }),
  'share one sealed baseline hash'
);

const failingPair = pairFixture(2);
const failingOutput = materializeValidatedSirTaskOutput(failingPair.pairCoherenceTaskContract, {
  defects: [
    {
      severity: 'HIGH',
      coherenceDimension: 'CROSS_ARTIFACT_CONTRADICTION',
      affectedPathHandles: [((failingPair.pairCoherenceTaskContract.lockedInputs.pair_coherence_packet as { pathRegistry: Array<{ pathHandle: string }> }).pathRegistry[0]!.pathHandle)],
      issue: 'Pair Coherence found a high-severity contradiction that must block domain admission.',
      coherenceExpectation: 'The pair must be repaired before domain review can start.',
      recommendedRepairPathHandles: [((failingPair.pairCoherenceTaskContract.lockedInputs.pair_coherence_packet as { pathRegistry: Array<{ pathHandle: string }> }).pathRegistry[0]!.pathHandle)]
    }
  ],
  coherenceSummary: 'Pair Coherence failed and cannot enter domain review.'
}) as MaterializedPairCoherenceReview;
if (failingOutput.passed) {
  throw new Error('Resolver regression fixture did not produce a failing Pair Coherence review.');
}
await expectReject(
  () => resolveDomainCoherenceContract({
    domain: 'A',
    domainBaseline,
    goldenStandardDomainRules,
    pairs: [pairs[0]!, { ...failingPair, pairCoherenceOutput: failingOutput }, pairs[2]!, pairs[3]!, pairs[4]!]
  }),
  'Pair Coherence did not pass'
);

const rawSemantic = {
  ...failingPair,
  pairCoherenceOutput: {
    defects: [],
    coherenceSummary: 'Raw semantic Pair Coherence output cannot be admitted to domain review.'
  }
};
await expectReject(
  () => resolveDomainCoherenceContract({
    domain: 'A',
    domainBaseline,
    goldenStandardDomainRules,
    pairs: [pairs[0]!, rawSemantic, pairs[2]!, pairs[3]!, pairs[4]!]
  }),
  'contains unexpected or missing fields'
);

const tampered = structuredClone(pairs[1]!.pairCoherenceOutput) as MaterializedPairCoherenceReview;
tampered.passed = false;
await expectReject(
  () => resolveDomainCoherenceContract({
    domain: 'A',
    domainBaseline,
    goldenStandardDomainRules,
    pairs: [pairs[0]!, { ...pairs[1]!, pairCoherenceOutput: tampered }, pairs[2]!, pairs[3]!, pairs[4]!]
  }),
  'pass status drifted'
);

const staleContract: TaskContract = structuredClone(pairs[1]!.pairCoherenceTaskContract);
staleContract.contractVersion = '1.0.0';
await expectReject(
  () => resolveDomainCoherenceContract({
    domain: 'A',
    domainBaseline,
    goldenStandardDomainRules,
    pairs: [pairs[0]!, { ...pairs[1]!, pairCoherenceTaskContract: staleContract }, pairs[2]!, pairs[3]!, pairs[4]!]
  }),
  'contractVersion 2.0.0'
);

console.log(JSON.stringify({
  domainCoherenceResolver: 'PASS',
  fivePairAdmission: 'PASS',
  packetHashBinding: 'PASS',
  incompletePairSet: 'REJECTED',
  foreignPairIdentity: 'REJECTED',
  mixedBaseline: 'REJECTED',
  failedPairCoherence: 'REJECTED',
  rawSemanticPairCoherenceOutput: 'REJECTED',
  tamperedPairCoherenceArtifact: 'REJECTED',
  legacyPairCoherenceContract: 'REJECTED',
  independentRebuildHash: canonicalArtifactHash(contract.lockedInputs.domain_coherence_packet)
}, null, 2));
