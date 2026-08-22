import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import {
  buildSirReferenceMappingContract,
  type SirReferenceMappingOutput
} from '../cognitive/sir-reference-mapping-contract.js';
import type { SirPairBoundaryOutput } from '../cognitive/sir-initial-contracts.js';
import { materializeSirFindings } from '../sir/finding-materializer.js';
import type { MaterializedSirReferenceMappings } from '../sir/reference-mapping-materializer.js';
import { materializeValidatedSirTaskOutput } from '../sir/task-artifact.js';
import { verifyPersistedReferenceMappingArtifact } from './reference-mapping-artifact-verifier.js';

const hash = 'a'.repeat(64);
const plan = buildAuthoringPlan({
  identity: {
    capabilityId: 'A2',
    antipatternId: 'AP-A2',
    pairId: 'A2_AP-A2',
    domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'AI suitability, proportionality and value hypothesis',
    antipatternTitle: 'AI-first solutionism or value theatre'
  },
  targetVersion: '1.0.0',
  schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-reference-artifact',
    baselineSha256: hash,
    productionContractVersion: '1.0.0',
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
  questionDimensions: [
    'DEFINITION_AND_INTENT',
    'IMPLEMENTATION_AND_OPERATION',
    'EVIDENCE_AND_EFFECTIVENESS'
  ],
  vocabulary: {
    technicalAssurance: ['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],
    antipatternConclusionStates: ['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],
    hardGateEffects: ['NONE','WARN','BLOCK','CONSTRAIN'],
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
  adjacentCriteria: [
    { criterionHandle: 'criterion_001', criterionId: 'AP-A2', boundarySummary: 'Paired anti-pattern boundary.' },
    { criterionHandle: 'criterion_002', criterionId: 'A2', boundarySummary: 'Paired capability boundary.' },
    { criterionHandle: 'criterion_003', criterionId: 'A1', boundarySummary: 'Purpose-boundary dependency.' }
  ]
});

const pairBoundary: SirPairBoundaryOutput = {
  capability: {
    canonicalDefinition: 'A2 defines evidence-based suitability and proportionality for choosing AI in a bounded decision context.',
    governancePurpose: 'Keep AI selection tied to a defined problem, alternatives, proportionality and expected value.',
    distinctClaim: 'A2 owns the suitability and proportionality decision rather than the upstream statement of intended purpose.',
    ownedTopics: ['AI suitability'],
    excludedTopics: [
      {
        criterionHandle: 'criterion_003',
        ownershipBoundary: 'A1 owns authoritative purpose definition; A2 consumes that boundary when judging solution suitability.'
      }
    ]
  },
  antipattern: {
    canonicalDefinition: 'AP-A2 captures solution-first AI selection without adequate problem, alternative and value justification.',
    pairedRelationship: 'AP-A2 is the failure mechanism paired with A2 suitability and proportionality.'
  },
  boundaryRationale: 'The pair is bounded around AI-selection quality rather than upstream purpose definition.'
};

const findings = materializeSirFindings({
  capabilityFindings: [
    {
      title: 'Capability finding with bounded traceability.',
      eligibleConclusionStates: ['NOT_SATISFIED','UNKNOWN'],
      atomicHandles: ['atomic_001'],
      evidenceHandles: ['evidence_001'],
      defaultSeverity: 'HIGH',
      lifecycleConsequence: 'Constrain progression pending evidence.',
      humanLockRequired: true
    }
  ],
  antipatternFindings: [
    {
      title: 'Anti-pattern finding with bounded traceability.',
      eligibleConclusionStates: ['CONFIRMED_PRESENT','UNKNOWN'],
      atomicHandles: ['atomic_001'],
      evidenceHandles: ['evidence_001'],
      defaultSeverity: 'HIGH',
      lifecycleConsequence: 'Require human review before progression.',
      humanLockRequired: true
    }
  ],
  findingLogicNotes: ['Findings remain reusable knowledge definitions.']
});
const categoryBaseline = { criterion: 'A2 baseline' };
const goldenReference = { reference_id: 'A1_AP-A1', normative: false };

const contract = buildSirReferenceMappingContract({
  authoringPlan: plan,
  pairBoundary,
  findings,
  categoryBaseline,
  goldenReference
});

const semantic: SirReferenceMappingOutput = {
  capabilityRelatedCriterionHandles: ['criterion_001','criterion_003'],
  antipatternRelatedCriterionHandles: ['criterion_002'],
  referenceNotes: ['Related criteria are bounded to the Authoring Plan universe.']
};

const persisted = materializeValidatedSirTaskOutput(
  contract,
  semantic
) as MaterializedSirReferenceMappings;

function verify(output: unknown, currentContract = contract): void {
  verifyPersistedReferenceMappingArtifact({
    output,
    referenceTaskContract: currentContract,
    authoringPlan: plan,
    verifiedPairBoundary: pairBoundary,
    verifiedFindings: findings,
    categoryBaseline,
    goldenReference
  });
}

verify(persisted);
if (persisted.capabilityRelatedCriteria[0]?.criterionId !== 'AP-A2') {
  throw new Error('Task artifact route did not materialize the paired anti-pattern criterion ID.');
}
if (persisted.capabilityTacticRefs.length !== 0 || persisted.antipatternTacticRefs.length !== 0) {
  throw new Error('Task artifact route emitted tactic refs in fail-safe mode.');
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

expectReject(() => verify(semantic), 'contains unexpected or missing fields');

const badId = structuredClone(persisted);
badId.capabilityRelatedCriteria[0]!.criterionId = 'A5';
expectReject(() => verify(badId), 'materialized content drifted');

const badBoundary = structuredClone(persisted);
badBoundary.capabilityRelatedCriteria[0]!.boundarySummary = 'Tampered boundary.';
expectReject(() => verify(badBoundary), 'materialized content drifted');

const tacticInjection = structuredClone(persisted) as MaterializedSirReferenceMappings & {
  capabilityTacticRefs: unknown[];
};
tacticInjection.capabilityTacticRefs = [{ tacticId: 'TAC-UNAPPROVED' }];
expectReject(() => verify(tacticInjection), 'capability tactic refs must be empty');

const driftedContract = structuredClone(contract);
driftedContract.lockedInputs.adjacent_criteria = [
  { criterionHandle: 'criterion_001', criterionId: 'AP-A2', boundarySummary: 'Drifted boundary.' }
];
expectReject(
  () => verify(persisted, driftedContract),
  'adjacent-criterion universe drifted'
);

const wrongMode = structuredClone(contract);
wrongMode.lockedInputs.tactic_resolution_mode = 'MODEL_SELECTS_TACTICS';
expectReject(
  () => verify(persisted, wrongMode),
  'unsupported tactic resolution mode'
);

console.log(JSON.stringify({
  persistedReferenceMappingArtifact: 'PASS',
  taskRunnerMaterializationPath: 'PASS',
  deterministicCriterionIdentity: 'PASS',
  rawSemanticReferenceOutput: 'REJECTED',
  tamperedCriterionId: 'REJECTED',
  tamperedBoundarySummary: 'REJECTED',
  tacticReferenceInjection: 'REJECTED',
  lockedAdjacentUniverseDrift: 'REJECTED',
  unsupportedTacticMode: 'REJECTED'
}, null, 2));
