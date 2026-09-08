import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import { buildSirApAbsenceContract } from '../cognitive/sir-ap-absence-contract.js';
import { buildSirAtomicDecompositionContract } from '../cognitive/sir-atomic-contract.js';
import { buildSirControlBoundaryContract } from '../cognitive/sir-control-contract.js';
import { buildSirEvidenceArchitectureContract } from '../cognitive/sir-evidence-contract.js';
import { buildSirEvidenceSafetyContract } from '../cognitive/sir-evidence-safety-contract.js';
import { buildSirFindingArchitectureContract } from '../cognitive/sir-finding-contract.js';
import {
  buildSirApFailureModelContract,
  buildSirApplicabilityContract,
  buildSirPairBoundaryContract,
  buildSirPrimaryQuestionsContract
} from '../cognitive/sir-initial-contracts.js';
import { buildSirLifecycleAssuranceContract } from '../cognitive/sir-lifecycle-contract.js';
import { buildSirPairCoherenceContract } from '../cognitive/sir-pair-coherence-contract.js';
import { buildSirReferenceMappingContract } from '../cognitive/sir-reference-mapping-contract.js';
import { buildSirSourceMappingContract } from '../cognitive/sir-source-mapping-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { PairCoherencePacket } from './pair-coherence-packet.js';
import { PAIR_CANDIDATE_HASH_TASKS, PAIR_TASK_SEQUENCE } from './pipeline.js';
import { sourceContextAcquisitionContract } from './source-context-acquisition.js';
import type { SourceContextPacket } from './source-context-packet.js';
import {
  decideConsolidation,
  emptyEvidence,
  highRepairSourceMappingEvidence,
  optimisticMeasureEvidence
} from './task-boundary-evidence.js';
import {
  ALL_TASK_POLICIES,
  CONSOLIDATION_MERGE_AUTHORIZED,
  CONTRACT_UPSTREAM,
  independentValidatorsForCandidate,
  isPairSirTask,
  isForbiddenConsolidation,
  MEASURE_ONLY_CANDIDATE,
  operatorTaskBoundarySummary,
  PAIR_SIR_TASK_COUNT,
  type PairSirTaskType,
  PAIR_TASK_POLICIES,
  REFERENCE_MAPPING_CONTRACT_UPSTREAM_IS_RESOLVER_SUBSET,
  resolverLoadPrefix,
  SIR_V2_VALIDATOR_ROUTE,
  SOURCE_CONTEXT_POLICY,
  taskBoundaryPolicy
} from './task-boundaries.js';
import { completionValidatorRoute, validateTaskCompletion } from '../validation/task-completion-router.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sameList(actual: readonly string[], expected: readonly string[], label: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} drifted: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`
  );
}

function routerContract(taskType: CognitiveTaskType, version = '2.0.0'): TaskContract {
  return {
    contractVersion: version,
    taskId: `boundary:${taskType}`,
    taskType,
    targetObjectId: 'A2_AP-A2',
    objective: 'Task-boundary live validator fixture.',
    modelRole: 'REASONER',
    upstreamTaskTypes: isPairSirTask(taskType) ? [...CONTRACT_UPSTREAM[taskType]] : [],
    lockedInputs: {},
    allowedReferences: [],
    doNot: [],
    outputContract: {
      format: 'JSON',
      schemaName: 'BoundaryFixture',
      requiredFields: [],
      additionalProperties: false
    },
    validationProfile: [],
    dependencyPaths: [],
    failureMode: 'FAIL_CLOSED'
  };
}

const plan = buildAuthoringPlan({
  identity: {
    capabilityId: 'A2',
    antipatternId: 'AP-A2',
    pairId: 'A2_AP-A2',
    domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'Sample capability',
    antipatternTitle: 'Sample anti-pattern'
  },
  targetVersion: '1.0.0',
  schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-test',
    baselineSha256: 'a'.repeat(64),
    productionContractVersion: '1.1.0',
    productionContractSha256: 'b'.repeat(64),
    capabilitySchemaVersion: '2.1.0',
    capabilitySchemaSha256: 'c'.repeat(64),
    antipatternSchemaVersion: '2.1.0',
    antipatternSchemaSha256: 'd'.repeat(64),
    sharedDefinitionsVersion: '2.1.0',
    sharedDefinitionsSha256: 'e'.repeat(64),
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: 'f'.repeat(64),
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1',
    goldenReferenceVersion: '1.0.0',
    goldenReferenceSha256: '1'.repeat(64)
  },
  questionDimensions: ['DEFINITION_AND_INTENT', 'IMPLEMENTATION_AND_OPERATION', 'EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary: {
    technicalAssurance: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE'],
    antipatternConclusionStates: [
      'CONFIRMED_PRESENT',
      'PARTIALLY_PRESENT',
      'TESTED_ABSENT',
      'UNKNOWN',
      'NOT_APPLICABLE'
    ],
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

const stub = {
  authoringPlan: plan,
  categoryBaseline: { criterion: 'A2' },
  goldenReference: { reference_id: 'A1_AP-A1' },
  pairBoundary: {},
  apFailureModel: {},
  applicability: {},
  primaryQuestions: {},
  atomics: { capability: [], antipattern: [] },
  evidence: { capability: [], antipattern: [] },
  evidenceSafety: { capabilityRules: {}, antipatternRules: {} },
  apAbsence: {},
  sourceMappings: {},
  findings: { capability: [], antipattern: [], findingLogicNotes: [] },
  controlBoundary: {},
  sourceContextPacket: { packetSha256: 'packet' },
  pairCoherencePacket: {
    pairId: plan.identity.pairId,
    authoringPlanSha256: plan.planSha256,
    packetSha256: 'coherence'
  }
};

function livePairContracts(authoringPlan: AuthoringPlan): Record<PairSirTaskType, TaskContract> {
  const seed = { ...stub, authoringPlan };
  return {
    PAIR_BOUNDARY: buildSirPairBoundaryContract(seed),
    AP_FAILURE_MODEL: buildSirApFailureModelContract(seed as never),
    APPLICABILITY: buildSirApplicabilityContract(seed as never),
    PRIMARY_QUESTIONS: buildSirPrimaryQuestionsContract(seed as never),
    ATOMIC_DECOMPOSITION: buildSirAtomicDecompositionContract(seed as never),
    EVIDENCE_ARCHITECTURE: buildSirEvidenceArchitectureContract(seed as never),
    EVIDENCE_SAFETY: buildSirEvidenceSafetyContract(seed as never),
    AP_ABSENCE_CONTRACT: buildSirApAbsenceContract(seed as never),
    SOURCE_MAPPING: buildSirSourceMappingContract({
      ...seed,
      sourceContextPacket: seed.sourceContextPacket as SourceContextPacket
    } as never),
    FINDING_ARCHITECTURE: buildSirFindingArchitectureContract(seed as never),
    CONTROL_BOUNDARY: buildSirControlBoundaryContract(seed as never),
    LIFECYCLE_ASSURANCE: buildSirLifecycleAssuranceContract(seed as never),
    REFERENCE_MAPPING: buildSirReferenceMappingContract(seed as never),
    PAIR_COHERENCE_REVIEW: buildSirPairCoherenceContract({
      authoringPlan,
      categoryBaseline: seed.categoryBaseline,
      goldenReference: seed.goldenReference,
      pairCoherencePacket: seed.pairCoherencePacket as PairCoherencePacket
    })
  };
}

assert(PAIR_TASK_SEQUENCE.length === PAIR_SIR_TASK_COUNT, 'pair SIR sequence is no longer 14 tasks');
assert(!PAIR_TASK_SEQUENCE.includes('SOURCE_CONTEXT'), 'SOURCE_CONTEXT must not enter the model SIR sequence');
assert(PAIR_CANDIDATE_HASH_TASKS[0] === 'SOURCE_CONTEXT', 'candidate hash still starts with SOURCE_CONTEXT');
assert(SOURCE_CONTEXT_POLICY.executionKind === 'CODE', 'SOURCE_CONTEXT must remain code-owned');
assert(CONSOLIDATION_MERGE_AUTHORIZED === false, 'MERGE authorization must stay closed in this slice');
assert(REFERENCE_MAPPING_CONTRACT_UPSTREAM_IS_RESOLVER_SUBSET === true, 'REFERENCE_MAPPING subset exception must stay explicit');

for (const taskType of PAIR_TASK_SEQUENCE) {
  assert(isPairSirTask(taskType), `PAIR_TASK_SEQUENCE contains non-model SIR task ${taskType}`);
  const policy = taskBoundaryPolicy(taskType);
  sameList([...policy.contractUpstream], [...CONTRACT_UPSTREAM[taskType]], `${taskType} policy contractUpstream`);
  sameList(
    [...policy.resolverLoadPrefix],
    [...PAIR_TASK_SEQUENCE.slice(0, PAIR_TASK_SEQUENCE.indexOf(taskType))],
    `${taskType} resolver prefix`
  );
  for (const prerequisite of policy.contractUpstream) {
    assert(
      policy.resolverLoadPrefix.includes(prerequisite),
      `${taskType} contract upstream ${prerequisite} is missing from resolver prefix`
    );
  }
  if (taskType !== 'REFERENCE_MAPPING') {
    sameList(
      [...policy.contractUpstream],
      [...policy.resolverLoadPrefix],
      `${taskType} contract upstream must equal resolver prefix`
    );
  } else {
    assert(
      policy.contractUpstream.length < policy.resolverLoadPrefix.length,
      'REFERENCE_MAPPING contract upstream must be a documented subset of the resolver prefix'
    );
    sameList(
      [...policy.contractUpstream],
      ['PAIR_BOUNDARY', 'FINDING_ARCHITECTURE', 'LIFECYCLE_ASSURANCE'],
      'REFERENCE_MAPPING contract upstream'
    );
  }
  if (taskType === 'SOURCE_MAPPING') {
    assert(
      policy.extraRequirements.includes('SEALED_SOURCE_CONTEXT_PACKET'),
      'SOURCE_MAPPING must require the sealed Source Context Packet in addition to SIR upstreams'
    );
    assert(
      !policy.contractUpstream.includes('SOURCE_CONTEXT'),
      'SOURCE_CONTEXT is not a SIR upstreamTaskType; it is a sealed packet'
    );
  }
}

const liveContracts = livePairContracts(plan);
for (const taskType of PAIR_TASK_SEQUENCE) {
  assert(isPairSirTask(taskType), `PAIR_TASK_SEQUENCE contains non-model SIR task ${taskType}`);
  sameList(
    liveContracts[taskType].upstreamTaskTypes,
    [...CONTRACT_UPSTREAM[taskType]],
    `${taskType} live builder upstreamTaskTypes`
  );
  assert(liveContracts[taskType].taskType === taskType, `${taskType} builder taskType drifted`);
  assert(
    completionValidatorRoute(liveContracts[taskType]) === SIR_V2_VALIDATOR_ROUTE[taskType],
    `${taskType} live builder validator route drifted`
  );
  assert(
    completionValidatorRoute(routerContract(taskType)) === SIR_V2_VALIDATOR_ROUTE[taskType],
    `${taskType} router fixture validator route drifted`
  );
}

const sourceContextContract = sourceContextAcquisitionContract(plan);
assert(sourceContextContract.taskType === 'SOURCE_CONTEXT', 'SOURCE_CONTEXT acquisition contract task type drifted');
assert(sourceContextContract.upstreamTaskTypes.length === 0, 'SOURCE_CONTEXT has no SIR upstream tasks');
try {
  completionValidatorRoute(routerContract('SOURCE_CONTEXT'));
  throw new Error('SOURCE_CONTEXT SIR v2 unexpectedly routed');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  assert(message.includes('Unsupported SIR v2 completion route'), `SOURCE_CONTEXT route error drifted: ${message}`);
}

assert(
  SIR_V2_VALIDATOR_ROUTE.EVIDENCE_ARCHITECTURE !== SIR_V2_VALIDATOR_ROUTE.EVIDENCE_SAFETY,
  'Evidence Architecture and Evidence Safety must keep independent validator routes'
);
assert(
  completionValidatorRoute(routerContract('EVIDENCE_ARCHITECTURE')) === 'SIR_EVIDENCE',
  'Evidence Architecture route drifted'
);
assert(
  completionValidatorRoute(routerContract('EVIDENCE_SAFETY')) === 'SIR_EVIDENCE_SAFETY',
  'Evidence Safety route drifted'
);
assert(
  SIR_V2_VALIDATOR_ROUTE.PRIMARY_QUESTIONS !== SIR_V2_VALIDATOR_ROUTE.ATOMIC_DECOMPOSITION,
  'PRIMARY_QUESTIONS and ATOMIC_DECOMPOSITION must keep independent validator routes even if later measured together'
);
sameList(
  [...independentValidatorsForCandidate('PRIMARY_QUESTIONS', 'ATOMIC_DECOMPOSITION')],
  ['SIR_INITIAL', 'SIR_ATOMIC'],
  'measure-only independent validators'
);

const sharedInitialRoute = PAIR_TASK_SEQUENCE.slice(0, 4);
assert(
  sharedInitialRoute.every((taskType) => isPairSirTask(taskType) && SIR_V2_VALIDATOR_ROUTE[taskType] === 'SIR_INITIAL'),
  'initial four share SIR_INITIAL as a validator route, not as a merged model task'
);
assert(
  sharedInitialRoute.length === 4 && new Set(sharedInitialRoute).size === 4,
  'initial four remain distinct sequence entries'
);

const missingAtomic = validateTaskCompletion({
  contract: {
    ...routerContract('EVIDENCE_ARCHITECTURE'),
    upstreamTaskTypes: [...CONTRACT_UPSTREAM.EVIDENCE_ARCHITECTURE]
  },
  completed: new Set<CognitiveTaskType>(),
  output: {},
  completionContext: {
    runId: 'task-boundary-check',
    expectedPairId: 'A2_AP-A2',
    expectedCapabilityId: 'A2',
    expectedAntipatternId: 'AP-A2'
  }
});
assert(missingAtomic.passed === false, 'EVIDENCE_ARCHITECTURE must fail when ATOMIC_DECOMPOSITION is missing');
assert(
  missingAtomic.findings.some(
    (item) =>
      item.checkId === 'SIR_PREREQUISITE_MISSING' &&
      item.issue.includes('ATOMIC_DECOMPOSITION')
  ),
  'missing ATOMIC_DECOMPOSITION must emit SIR_PREREQUISITE_MISSING'
);

const missingPrimary = validateTaskCompletion({
  contract: {
    ...routerContract('ATOMIC_DECOMPOSITION'),
    upstreamTaskTypes: [...CONTRACT_UPSTREAM.ATOMIC_DECOMPOSITION]
  },
  completed: new Set<CognitiveTaskType>(['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY']),
  output: {},
  completionContext: {
    runId: 'task-boundary-check',
    expectedPairId: 'A2_AP-A2',
    expectedCapabilityId: 'A2',
    expectedAntipatternId: 'AP-A2'
  }
});
assert(missingPrimary.passed === false, 'ATOMIC_DECOMPOSITION must fail when PRIMARY_QUESTIONS is missing');
assert(
  missingPrimary.findings.some(
    (item) => item.checkId === 'SIR_PREREQUISITE_MISSING' && item.issue.includes('PRIMARY_QUESTIONS')
  ),
  'missing PRIMARY_QUESTIONS must emit SIR_PREREQUISITE_MISSING'
);

const sourceWithoutPacket = validateTaskCompletion({
  contract: {
    ...routerContract('SOURCE_MAPPING'),
    upstreamTaskTypes: [...CONTRACT_UPSTREAM.SOURCE_MAPPING],
    lockedInputs: {}
  },
  completed: new Set<CognitiveTaskType>(CONTRACT_UPSTREAM.SOURCE_MAPPING),
  output: {
    capabilityMappings: [],
    antipatternMappings: [],
    unmappedClaims: [],
    mappingNotes: []
  },
  completionContext: {
    runId: 'task-boundary-check',
    expectedPairId: 'A2_AP-A2',
    expectedCapabilityId: 'A2',
    expectedAntipatternId: 'AP-A2'
  }
});
assert(
  sourceWithoutPacket.passed === false,
  'SOURCE_MAPPING must fail without a sealed Source Context Packet even when SIR upstreams are complete'
);
assert(
  sourceWithoutPacket.findings.some((item) => item.checkId === 'SIR_SOURCE_CONTEXT_PACKET_REQUIRED'),
  'SOURCE_MAPPING without a packet must emit SIR_SOURCE_CONTEXT_PACKET_REQUIRED'
);
assert(
  !sourceWithoutPacket.findings.some((item) => item.checkId === 'SIR_PREREQUISITE_MISSING'),
  'completed SIR upstreams must not be reported missing when the packet is the actual gap'
);

const forbiddenSamples: Array<[CognitiveTaskType, CognitiveTaskType]> = [
  ['SOURCE_CONTEXT', 'SOURCE_MAPPING'],
  ['SOURCE_CONTEXT', 'PRIMARY_QUESTIONS'],
  ['SOURCE_MAPPING', 'FINDING_ARCHITECTURE'],
  ['SOURCE_MAPPING', 'REFERENCE_MAPPING'],
  ['EVIDENCE_ARCHITECTURE', 'EVIDENCE_SAFETY'],
  ['ATOMIC_DECOMPOSITION', 'EVIDENCE_ARCHITECTURE'],
  ['AP_ABSENCE_CONTRACT', 'EVIDENCE_SAFETY'],
  ['FINDING_ARCHITECTURE', 'CONTROL_BOUNDARY'],
  ['CONTROL_BOUNDARY', 'LIFECYCLE_ASSURANCE'],
  ['PRIMARY_QUESTIONS', 'PAIR_COHERENCE_REVIEW'],
  ['SOURCE_MAPPING', 'DOMAIN_COHERENCE_REVIEW'],
  ['PAIR_COHERENCE_REVIEW', 'LOCAL_REPAIR'],
  ['FINDING_ARCHITECTURE', 'LOCAL_REPAIR']
];

for (const [left, right] of forbiddenSamples) {
  assert(isForbiddenConsolidation(left, right), `${left}+${right} must be forbidden`);
  const verdict = decideConsolidation(left, right, highRepairSourceMappingEvidence());
  assert(verdict.decision === 'FORBIDDEN', `${left}+${right} must stay FORBIDDEN even with optimistic repair metrics`);
  assert(verdict.mergeEligible === false, `${left}+${right} mergeEligible must stay false`);
}

const measureEmpty = decideConsolidation(
  MEASURE_ONLY_CANDIDATE.left,
  MEASURE_ONLY_CANDIDATE.right,
  emptyEvidence(MEASURE_ONLY_CANDIDATE.left, MEASURE_ONLY_CANDIDATE.right)
);
assert(measureEmpty.decision === 'KEEP_SEPARATE', 'measure-only candidate without evidence stays KEEP_SEPARATE');
assert(measureEmpty.mergeEligible === false, 'measure-only merge stays closed without evidence');
assert(measureEmpty.reasons.includes('MERGE_AUTHORIZATION_CLOSED'), 'measure-only must cite closed merge authorization');
assert(measureEmpty.reasons.includes('INDEPENDENT_VALIDATORS_REQUIRED'), 'measure-only must keep both validators');

const measureOptimistic = decideConsolidation(
  MEASURE_ONLY_CANDIDATE.left,
  MEASURE_ONLY_CANDIDATE.right,
  optimisticMeasureEvidence()
);
assert(
  measureOptimistic.decision === 'KEEP_SEPARATE',
  'optimistic PRIMARY_QUESTIONS+ATOMIC_DECOMPOSITION evidence must not merge in this slice'
);
assert(measureOptimistic.mergeEligible === false, 'MERGE remains unreachable even with optimistic measure evidence');
assert(
  !isForbiddenConsolidation(MEASURE_ONLY_CANDIDATE.left, MEASURE_ONLY_CANDIDATE.right),
  'PRIMARY_QUESTIONS+ATOMIC_DECOMPOSITION is measure-only, not a forbidden ownership merge'
);

const validatorShareIsNotMerge = decideConsolidation('PAIR_BOUNDARY', 'AP_FAILURE_MODEL', emptyEvidence('PAIR_BOUNDARY', 'AP_FAILURE_MODEL'));
assert(validatorShareIsNotMerge.decision === 'KEEP_SEPARATE', 'shared SIR_INITIAL route is not a task merge');
assert(!isForbiddenConsolidation('PAIR_BOUNDARY', 'AP_FAILURE_MODEL'), 'initial tasks stay separate, not forbidden-collapsed');

assert(ALL_TASK_POLICIES.length === PAIR_TASK_POLICIES.length + 3, 'policy graph must cover pair tasks plus SOURCE_CONTEXT, domain QC, and local repair');
assert(operatorTaskBoundarySummary().mergeAuthorized === false, 'operator summary must report merge closed');
assert(operatorTaskBoundarySummary().pairSirTaskCount === 14, 'operator summary pair count drifted');
assert(resolverLoadPrefix('SOURCE_MAPPING').at(-1) === 'AP_ABSENCE_CONTRACT', 'SOURCE_MAPPING resolver prefix must end at AP_ABSENCE_CONTRACT');

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      pairSirTasks: PAIR_SIR_TASK_COUNT,
      sourceContextIsModelTask: false,
      consolidationPolicy: 'KEEP_SEPARATE_UNTIL_MEASURED',
      mergeAuthorized: CONSOLIDATION_MERGE_AUTHORIZED,
      mergeDecision: 'UNREACHABLE',
      referenceMappingContractUpstream: 'RESOLVER_SUBSET',
      evidenceSafetyIndependentOfArchitecture: true,
      livePrerequisiteMissing: 'SIR_PREREQUISITE_MISSING',
      liveSourcePacketRequired: 'SIR_SOURCE_CONTEXT_PACKET_REQUIRED',
      measureOnlyCandidate: 'PRIMARY_QUESTIONS+ATOMIC_DECOMPOSITION',
      measureOnlyDecision: measureOptimistic.decision,
      independentValidators: MEASURE_ONLY_CANDIDATE.independentValidatorRoutes
    },
    null,
    2
  )
);
