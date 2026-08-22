import { buildAuthoringPlan, type AuthoringPlanInput } from '../authoring/authoring-plan.js';
import type {
  SirPairBoundaryOutput,
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPrimaryQuestionsOutput
} from '../cognitive/sir-initial-contracts.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { materializeSirAtomics } from '../sir/atomic-materializer.js';
import type { CompletedTaskArtifact } from './store.js';
import { resolveSirTaskContract } from './sir-contract-resolver.js';

const planInput: AuthoringPlanInput = {
  identity: {
    capabilityId: 'A2', antipatternId: 'AP-A2', pairId: 'A2_AP-A2', domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'Sample capability', antipatternTitle: 'Sample anti-pattern'
  },
  targetVersion: '1.0.0', schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-test', baselineSha256: 'a'.repeat(64),
    productionContractVersion: '1.1.0', productionContractSha256: 'b'.repeat(64),
    capabilitySchemaVersion: '2.1.0', capabilitySchemaSha256: 'c'.repeat(64),
    antipatternSchemaVersion: '2.1.0', antipatternSchemaSha256: 'd'.repeat(64),
    sharedDefinitionsVersion: '2.1.0', sharedDefinitionsSha256: 'e'.repeat(64),
    sourceRegisterVersion: '1.5.0', sourceRegisterSha256: 'f'.repeat(64),
    tacticCatalogVersion: null, tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1', goldenReferenceVersion: '1.0.0', goldenReferenceSha256: '1'.repeat(64)
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
};

const plan = buildAuthoringPlan(planInput);
const categoryBaseline = { criterion: 'A2 sample baseline' };
const goldenReference = { reference_id: 'A1_AP-A1', normative: false };
const artifacts = new Map<CognitiveTaskType, CompletedTaskArtifact>();

function put<T>(taskType: CognitiveTaskType, taskContract: TaskContract, output: T): void {
  artifacts.set(taskType, {
    output,
    taskContract,
    inputHash: `input-${taskType}`,
    outputHash: `output-${taskType}`
  });
}

const loadArtifact = async <T>(
  _pairRunId: string,
  taskType: CognitiveTaskType
): Promise<CompletedTaskArtifact<T> | undefined> => artifacts.get(taskType) as CompletedTaskArtifact<T> | undefined;

const base = { pairRunId: 'pair-run-test', authoringPlan: plan, categoryBaseline, goldenReference, loadArtifact };

const boundaryOutput: SirPairBoundaryOutput = {
  capability: {
    canonicalDefinition: 'A bounded capability definition for dependency resolution.',
    governancePurpose: 'A bounded governance purpose for dependency resolution.',
    distinctClaim: 'A distinct capability claim for dependency resolution.',
    ownedTopics: ['Owned topic'], excludedTopics: []
  },
  antipattern: {
    canonicalDefinition: 'A bounded anti-pattern definition for dependency resolution.',
    pairedRelationship: 'The anti-pattern captures failure of the paired capability.'
  },
  boundaryRationale: 'The semantic pair boundary is explicit and stable.'
};
const failureOutput: SirApFailureModelOutput = {
  failureMechanism: 'A concrete governed failure mechanism occurs under defined conditions.',
  triggeringConditions: ['A material trigger occurs.'],
  observableFailureSurfaces: ['An observable failure surface exists.'],
  nonExamples: ['A maturity gap without the defined failure mechanism.'],
  distinctionFromCapabilityGap: 'The anti-pattern requires the failure mechanism, not incomplete maturity alone.'
};
const applicabilityOutput: SirApplicabilityOutput = {
  capability: { statement: 'The capability applies in the governed scope.', conditions: ['Relevant context exists.'], exclusions: ['A bounded exclusion exists.'], reassessmentTriggers: ['A material context change occurs.'] },
  antipattern: { statement: 'The anti-pattern is assessed in the same governed scope.', conditions: ['The failure mechanism is assessable.'], exclusions: ['A bounded evidenced exclusion exists.'], reassessmentTriggers: ['A material failure-surface change occurs.'] },
  consistencyNotes: ['The pair is scoped coherently while remaining independently assessable.']
};
const questionsOutput: SirPrimaryQuestionsOutput = {
  capabilityQuestions: [
    { slot: 1, question: 'Is definition and intent sufficiently specific and bounded?' },
    { slot: 2, question: 'Is implementation and operation consistent with intended capability?' },
    { slot: 3, question: 'Does current evidence demonstrate intended effectiveness?' }
  ],
  antipatternQuestions: [
    { slot: 1, question: 'Is the failure mechanism clearly defined and distinguishable?' },
    { slot: 2, question: 'Does operation exhibit the defined failure mechanism?' },
    { slot: 3, question: 'Does evidence establish presence, uncertainty or tested absence?' }
  ],
  coverageRationale: 'All governed semantic question slots are covered.'
};

const boundaryContract = await resolveSirTaskContract({ ...base, taskType: 'PAIR_BOUNDARY' });
put('PAIR_BOUNDARY', boundaryContract, boundaryOutput);

const failureContract = await resolveSirTaskContract({ ...base, taskType: 'AP_FAILURE_MODEL' });
put('AP_FAILURE_MODEL', failureContract, failureOutput);

const applicabilityContract = await resolveSirTaskContract({ ...base, taskType: 'APPLICABILITY' });
put('APPLICABILITY', applicabilityContract, applicabilityOutput);

const questionsContract = await resolveSirTaskContract({ ...base, taskType: 'PRIMARY_QUESTIONS' });
put('PRIMARY_QUESTIONS', questionsContract, questionsOutput);

const atomicContract = await resolveSirTaskContract({ ...base, taskType: 'ATOMIC_DECOMPOSITION' });
const atomics = materializeSirAtomics({
  capabilitySubcriteria: [
    { questionSlot: 1, criterion: 'Capability definition atomic criterion.', evidenceNeed: 'Definition evidence is required.' },
    { questionSlot: 2, criterion: 'Capability implementation atomic criterion.', evidenceNeed: 'Implementation evidence is required.' },
    { questionSlot: 3, criterion: 'Capability effectiveness atomic criterion.', evidenceNeed: 'Effectiveness evidence is required.' }
  ],
  antipatternTests: [
    { questionSlot: 1, test: 'Anti-pattern definition atomic test.', evidenceNeed: 'Failure-definition evidence is required.' },
    { questionSlot: 2, test: 'Anti-pattern operation atomic test.', evidenceNeed: 'Operational failure evidence is required.' },
    { questionSlot: 3, test: 'Anti-pattern evidence atomic test.', evidenceNeed: 'Independent test evidence is required.' }
  ],
  coverageNotes: ['All question slots are covered.']
});
put('ATOMIC_DECOMPOSITION', atomicContract, atomics);

const evidenceContract = await resolveSirTaskContract({ ...base, taskType: 'EVIDENCE_ARCHITECTURE' });
const lockedCapabilityAtomics = evidenceContract.lockedInputs.capability_atomics as Array<{ handle: string }>;
if (lockedCapabilityAtomics[0]?.handle !== 'atomic_001') {
  throw new Error('Evidence contract did not receive deterministically materialized atomic SIR.');
}

const originalBoundary = artifacts.get('PAIR_BOUNDARY')!;
artifacts.set('PAIR_BOUNDARY', {
  ...originalBoundary,
  taskContract: {
    ...originalBoundary.taskContract,
    lockedInputs: {
      ...originalBoundary.taskContract.lockedInputs,
      authoring_plan_sha256: 'wrong-plan-hash'
    }
  }
});
let rejectedPlanMismatch = false;
try {
  await resolveSirTaskContract({ ...base, taskType: 'AP_FAILURE_MODEL' });
} catch (error) {
  rejectedPlanMismatch = String(error).includes('Authoring Plan');
}
if (!rejectedPlanMismatch) throw new Error('Authoring Plan mismatch was not rejected.');

artifacts.set('PAIR_BOUNDARY', {
  ...originalBoundary,
  taskContract: { ...originalBoundary.taskContract, contractVersion: '1.0.0' }
});
let rejectedLegacy = false;
try {
  await resolveSirTaskContract({ ...base, taskType: 'AP_FAILURE_MODEL' });
} catch (error) {
  rejectedLegacy = String(error).includes('contractVersion');
}
if (!rejectedLegacy) throw new Error('Legacy dependency was not rejected.');

artifacts.set('PAIR_BOUNDARY', originalBoundary);
console.log(JSON.stringify({
  sirDependencyResolver: 'PASS',
  persistedArtifactProvenance: 'PASS',
  authoringPlanBinding: 'PASS',
  legacyDependencyRejection: 'PASS',
  materializedAtomicDependency: 'PASS'
}, null, 2));
