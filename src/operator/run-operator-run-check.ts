import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseModelJson, requestBody, supportsCustomTemperature } from '../ai/provider-client.js';
import { loadCategoriesBaseline } from '../baseline/categories.js';
import { previewRepoBaselineManifest } from '../baseline/repo-artifacts.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { buildPromptPacket } from '../cognitive/prompt-builder.js';
import {
  buildSirApFailureModelContract,
  buildSirPairBoundaryContract,
  type SirPairBoundaryOutput
} from '../cognitive/sir-initial-contracts.js';
import { canReopenTaskRun } from '../orchestration/store.js';
import { PAIR_TASK_SEQUENCE } from '../orchestration/pipeline.js';
import { buildPairAuthoringPlan, goldenReferenceRecord } from './authoring-context.js';
import { commandAvailability, nextEligiblePairTask, classifyDomainPipelineStop, shouldReclaimStartedTask } from './eligibility.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const categories = loadCategoriesBaseline();
assert(categories.domains.length === 6, 'categories baseline must have six domains');
assert(
  categories.domains.reduce((count, domain) => count + domain.pairs.length, 0) === 30,
  'categories baseline must have thirty pairs'
);

const goldenA1 = JSON.parse(readFileSync(resolve(process.cwd(), 'golden/fixtures/A1_v1.0.0.json'), 'utf8')) as {
  title?: string;
  domain_title?: string;
};
const goldenAp = JSON.parse(readFileSync(resolve(process.cwd(), 'golden/fixtures/AP-A1_v1.0.0.json'), 'utf8')) as {
  title?: string;
};
const a1 = categories.domains[0]?.pairs[0];
assert(a1?.capabilityTitle === goldenA1.title, 'A1 title drifted from golden fixture');
assert(a1?.antipatternTitle === goldenAp.title, 'AP-A1 title drifted from golden fixture');
assert(categories.domains[0]?.title === goldenA1.domain_title, 'domain A title drifted from golden fixture');

const pending = PAIR_TASK_SEQUENCE.map((taskType) => ({ taskType, status: 'PENDING' as const }));
const next = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'AUTHORING', tasks: pending },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in next), 'A1 PAIR_BOUNDARY must be eligible on a fresh run');
assert(!('blocked' in next) && next.taskType === 'PAIR_BOUNDARY', 'first eligible task must be PAIR_BOUNDARY');
assert(!('blocked' in next) && next.pairId === 'A1_AP-A1', 'first eligible pair must be A1_AP-A1');

const blockedRepair = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'REPAIR_REQUIRED', tasks: pending },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert('blocked' in blockedRepair, 'repair-required pairs with no failed task must block advance');

const failedBoundary = PAIR_TASK_SEQUENCE.map((taskType) => ({
  taskType,
  status: taskType === 'PAIR_BOUNDARY' ? ('FAILED' as const) : ('PENDING' as const)
}));
const retryFailed = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'REPAIR_REQUIRED', tasks: failedBoundary },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in retryFailed), 'a failed PAIR_BOUNDARY must be retryable');
assert(!('blocked' in retryFailed) && retryFailed.taskType === 'PAIR_BOUNDARY', 'retry must not skip PAIR_BOUNDARY');
assert(!('blocked' in retryFailed) && retryFailed.pairId === 'A1_AP-A1', 'retry must not skip to another pair');

const completedBoundary = PAIR_TASK_SEQUENCE.map((taskType) => ({
  taskType,
  status: taskType === 'PAIR_BOUNDARY' ? ('COMPLETED' as const) : ('PENDING' as const)
}));
const second = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'AUTHORING', tasks: completedBoundary },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in second) && second.taskType === 'AP_FAILURE_MODEL', 'second task must stay sequential');

const failedLater = PAIR_TASK_SEQUENCE.map((taskType) => ({
  taskType,
  status:
    taskType === 'PAIR_BOUNDARY'
      ? ('COMPLETED' as const)
      : taskType === 'AP_FAILURE_MODEL'
        ? ('FAILED' as const)
        : ('PENDING' as const)
}));
const retryLater = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'AUTHORING', tasks: failedLater },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in retryLater) && retryLater.taskType === 'AP_FAILURE_MODEL', 'failed later tasks retry in place');
assert(canReopenTaskRun('FAILED') === true, 'failed task runs must be reopenable');
assert(canReopenTaskRun('STARTED') === false, 'in-flight task runs must not be reopened');
assert(canReopenTaskRun('COMPLETED') === false, 'completed task runs must keep persistence identity');
assert(
  shouldReclaimStartedTask(false) === true,
  'STARTED after a process restart is an orphan and must be reclaimed'
);
assert(
  shouldReclaimStartedTask(true) === false,
  'STARTED while this process owns the domain pipeline must stay a live lock'
);

assert(
  classifyDomainPipelineStop(
    'Five pairs are VALIDATED. DOMAIN_COHERENCE_REVIEW is the next unit and stays closed in Slice 2.'
  ) === 'DOMAIN_READY',
  'validated domain must stop the pair pipeline without asking approval'
);
assert(
  classifyDomainPipelineStop('A1_AP-A1 PAIR_BOUNDARY is already running.') === 'BLOCKED',
  'an in-flight task must not start a second pipeline'
);
assert(
  classifyDomainPipelineStop('A1_AP-A1 requires local repair before another SIR task can run.') === 'BLOCKED',
  'repair-required pairs must stop auto-advance'
);
assert(
  classifyDomainPipelineStop('Task PAIR_BOUNDARY failed primary and fallback routes') === 'FAILED',
  'model or SIR failure must stop the pipeline for in-place retry'
);

const availability = commandAvailability({
  databaseReady: true,
  commandsEnabled: true,
  modelRoutesConfigured: false,
  domain: 'A',
  activeRun: {
    state: 'IN_PROGRESS',
    pairs: [{ pairId: 'A1_AP-A1', state: 'AUTHORING', tasks: pending }]
  }
});
assert(availability.startDomainRun.enabled === false, 'open runs cannot be started again');
assert(availability.runNextTask.enabled === false, 'next-task must fail closed without model routing');
assert(availability.recordApproval.enabled === false, 'approval must stay closed');
assert(availability.runNextTask.next?.taskType === 'PAIR_BOUNDARY', 'eligibility is visible even when routing is missing');

assert(supportsCustomTemperature({ provider: 'OPENAI', model: 'gpt-4o' }) === true, 'gpt-4o keeps temperature 0');
assert(
  supportsCustomTemperature({ provider: 'OPENAI', model: 'gpt-5.6-terra' }) === false,
  'gpt-5.6-terra must omit temperature'
);
assert(supportsCustomTemperature({ provider: 'OPENAI', model: 'o3-mini' }) === false, 'o-series must omit temperature');
assert(supportsCustomTemperature({ provider: 'KIMI', model: 'kimi-k3' }) === false, 'Kimi must omit temperature');
assert(supportsCustomTemperature({ provider: 'GROK', model: 'grok-4.6' }) === true, 'Grok keeps temperature 0');
assert(
  !('temperature' in requestBody({
    target: { provider: 'OPENAI', model: 'gpt-5.6-terra' },
    systemPrompt: 'sys',
    userPrompt: 'user'
  })),
  'reasoner body must not send temperature for gpt-5.6-terra'
);
assert(
  requestBody({
    target: { provider: 'GROK', model: 'grok-4.6' },
    systemPrompt: 'sys',
    userPrompt: 'user'
  }).temperature === 0,
  'quality-checker Grok body still uses temperature 0'
);

const manifest = previewRepoBaselineManifest();
assert(
  manifest.some((item) => item.artifactType === 'CATEGORIES_BASELINE'),
  'repo baseline must include the categories baseline'
);
const snapshot: BaselineSnapshot = {
  id: 'baseline-operator-regression',
  sha256: 'a'.repeat(64),
  manifest
};
const plan = buildPairAuthoringPlan({ domain: 'A', pairId: 'A1_AP-A1', snapshot, categories });
assert(plan.identity.pairId === 'A1_AP-A1', 'authoring plan pair id must be derived');
assert(plan.tacticUniverse.length === 0, 'tactic universe must stay empty without a sealed catalog');
assert(
  plan.adjacentCriteria.map((item) => item.criterionId).join(',') === 'A2,A3,A4,A5',
  'adjacent criteria must be the other domain capabilities'
);
assert(plan.compilerPolicies.canonicalIdsFromModelOutputAllowed === false, 'canonical ids remain code-owned');

const goldenLock = goldenReferenceRecord();
assert(!('fixtures' in goldenLock), 'golden lock must not embed canonical fixture bodies');
assert(!JSON.stringify(goldenLock).includes('A1-Q1'), 'golden lock must not leak canonical question ids');
assert(!JSON.stringify(goldenLock).includes('EVD-A1-001'), 'golden lock must not leak canonical evidence ids');

const boundaryContract = buildSirPairBoundaryContract({
  authoringPlan: plan,
  categoryBaseline: { title: 'domain A' },
  goldenReference: goldenLock
});
const packet = buildPromptPacket(boundaryContract);
assert(!packet.user.includes('"pair_identity"'), 'PAIR_BOUNDARY prompt must omit pair_identity');
assert(!packet.user.includes('"pair_id"'), 'PAIR_BOUNDARY prompt must omit pair_id');
assert(!packet.user.includes('"criterionId"'), 'PAIR_BOUNDARY prompt must omit criterionId');
assert(packet.user.includes('criterionHandle'), 'PAIR_BOUNDARY prompt must keep adjacent handles');
assert(packet.user.includes('output_shape'), 'PAIR_BOUNDARY prompt must include the identity-free output shape');

const pairBoundary: SirPairBoundaryOutput = {
  capability: {
    canonicalDefinition: 'Capability definition for prompt regression.',
    governancePurpose: 'Governance purpose for prompt regression.',
    distinctClaim: 'Distinct claim versus adjacent handles.',
    ownedTopics: ['owned topic'],
    excludedTopics: [{ criterionHandle: 'criterion_001', ownershipBoundary: 'Neighbor owns this topic.' }]
  },
  antipattern: {
    canonicalDefinition: 'Anti-pattern definition for prompt regression.',
    pairedRelationship: 'Paired relationship for prompt regression.'
  },
  boundaryRationale: 'Boundary rationale for prompt regression.'
};
const failureContract = buildSirApFailureModelContract({
  authoringPlan: plan,
  categoryBaseline: { title: 'domain A' },
  goldenReference: goldenLock,
  pairBoundary
});
const failurePacket = buildPromptPacket(failureContract);
assert(!failurePacket.user.includes('"pair_identity"'), 'AP_FAILURE_MODEL prompt must omit pair_identity');
assert(!failurePacket.user.includes('"pair_id"'), 'AP_FAILURE_MODEL prompt must omit pair_id');
assert(failurePacket.user.includes('output_shape'), 'AP_FAILURE_MODEL prompt must include the identity-free output shape');
assert(failurePacket.user.includes('failureMechanism'), 'AP_FAILURE_MODEL prompt must name failureMechanism');

const atomicPacketUser = JSON.stringify(
  JSON.parse(
    buildPromptPacket({
      ...failureContract,
      taskType: 'ATOMIC_DECOMPOSITION',
      outputContract: {
        format: 'JSON',
        schemaName: 'SirAtomicDecompositionOutput',
        requiredFields: ['capabilitySubcriteria', 'antipatternTests', 'coverageNotes'],
        additionalProperties: false
      }
    }).user
  )
);
assert(atomicPacketUser.includes('output_shape'), 'ATOMIC_DECOMPOSITION prompt must include output_shape');
assert(atomicPacketUser.includes('capabilitySubcriteria'), 'ATOMIC_DECOMPOSITION prompt must name capabilitySubcriteria');
assert(atomicPacketUser.includes('questionSlot'), 'ATOMIC_DECOMPOSITION prompt must name questionSlot');

const unwrapped = parseModelJson('"{\\"failureMechanism\\":\\"Semantic failure mechanism text.\\"}"');
assert(
  typeof unwrapped === 'object' && unwrapped !== null && 'failureMechanism' in unwrapped,
  'double-encoded JSON strings must unwrap to objects'
);
const fenced = parseModelJson('```json\n{"failureMechanism":"Semantic failure mechanism text."}\n```');
assert(
  typeof fenced === 'object' && fenced !== null && 'failureMechanism' in fenced,
  'fenced JSON must parse to objects'
);

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      categoriesPairs: 30,
      firstEligibleTask: 'PAIR_BOUNDARY',
      sequentialAdmission: 'PASS',
      repairBlocksAdvance: 'PASS',
      failedTaskRetriesInPlace: 'PASS',
      domainPipelineStopsAtReady: 'PASS',
      orphanedStartedReclaim: 'PASS',
      completedTaskIdentityHeld: 'PASS',
      goldenLockOmitsFixtureBodies: 'PASS',
      pairBoundaryPromptOmitsCanonicalIds: 'PASS',
      apFailurePromptIncludesOutputShape: 'PASS',
      atomicPromptIncludesOutputShape: 'PASS',
      modelJsonUnwrapsStringPayload: 'PASS',
      gpt56OmitsTemperature: 'PASS',
      modelRoutingFailClosed: 'PASS',
      authoringPlanPairId: plan.planId
    },
    null,
    2
  )
);
