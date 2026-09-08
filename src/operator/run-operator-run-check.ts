import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseModelJson, requestBody, supportsCustomTemperature, supportsProviderJsonSchema } from '../ai/provider-client.js';
import { getProviderBaseUrl } from '../ai/model-router.js';
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
import { PAIR_TASK_SEQUENCE, canTransition, pairTransitions } from '../orchestration/pipeline.js';
import { buildPairAuthoringPlan, goldenReferenceRecord } from './authoring-context.js';
import { commandAvailability, nextEligiblePairTask, classifyDomainPipelineStop, shouldReclaimStartedTask } from './eligibility.js';
import { dismissAvailability } from './dismiss.js';
import { relatedCriterionIds } from '../compiler/production-candidate.js';
import { remainingDefects, rematerializeHumanReview, renderPairReviewHtml, schemaGate, parseReviewSaveBody } from './pair-review.js';
import {
  remainingDomainDefects,
  renderDomainReviewHtml,
  snapshotPathFromDomainPath
} from './domain-review.js';
import { SNAPSHOT_ROOT_TASK } from '../repair/qc-repair.js';
import { validMinimalSnapshotFixture } from '../validation/sir-snapshot-schema.js';

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
assert('blocked' in blockedRepair, 'repair-required pairs with no completed pair coherence must block advance');

const allCompleted = PAIR_TASK_SEQUENCE.map((taskType) => ({ taskType, status: 'COMPLETED' as const }));
const qcRepair = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'VALIDATED', tasks: allCompleted },
  { pairId: 'A2_AP-A2', state: 'REPAIR_REQUIRED', tasks: allCompleted },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in qcRepair), 'completed pair-coherence defects must be repairable');
assert(!('blocked' in qcRepair) && qcRepair.taskType === 'LOCAL_REPAIR', 'QC repair is LOCAL_REPAIR');
assert(!('blocked' in qcRepair) && qcRepair.pairId === 'A2_AP-A2', 'QC repair stays on the defective pair');

const repairAvailability = commandAvailability({
  databaseReady: true,
  commandsEnabled: true,
  modelRoutesConfigured: true,
  domain: 'A',
  activeRun: {
    state: 'IN_PROGRESS',
    pairs: [
      { pairId: 'A1_AP-A1', state: 'VALIDATED', tasks: allCompleted },
      { pairId: 'A2_AP-A2', state: 'REPAIR_REQUIRED', tasks: allCompleted },
      { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
      { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
      { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
    ]
  }
});
assert(repairAvailability.startDomainRun.enabled === false, 'repair does not start a new run');
assert(repairAvailability.runNextTask.enabled === true, 'QC repair continue is enabled');
assert(repairAvailability.runNextTask.next?.taskType === 'LOCAL_REPAIR', 'continue next is LOCAL_REPAIR');
assert(repairAvailability.recordApproval.enabled === false, 'approval stays closed during repair');

const recheckQc = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'VALIDATED', tasks: allCompleted },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: allCompleted },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in recheckQc) && recheckQc.taskType === 'PAIR_COHERENCE_REVIEW', 'authoring pairs with all tasks completed re-check pair coherence');
assert(!('blocked' in recheckQc) && recheckQc.pairId === 'A2_AP-A2', 'pair coherence re-check stays on A2');

const failedQc = PAIR_TASK_SEQUENCE.map((taskType) => ({
  taskType,
  status: taskType === 'PAIR_COHERENCE_REVIEW' ? ('FAILED' as const) : ('COMPLETED' as const)
}));
const failedQcRepair = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'VALIDATED', tasks: allCompleted },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: failedQc },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in failedQcRepair) && failedQcRepair.taskType === 'PAIR_COHERENCE_REVIEW', 'failed pair-coherence with no completed QC retries pair coherence');
assert(!('blocked' in failedQcRepair) && failedQcRepair.pairId === 'A2_AP-A2', 'failed QC retry stays on A2');

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
    'Domain A DOMAIN_COHERENCE_REVIEW passed. READY_FOR_APPROVAL. Canonical compile stays closed until external APPROVED.'
  ) === 'DOMAIN_READY',
  'passed domain coherence must stop before compile and approval'
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
assert(
  classifyDomainPipelineStop(
    'Task PAIR_BOUNDARY failed deterministic completion after bounded content correction.'
  ) === 'FAILED',
  'still-invalid corrected content must stop for human review'
);

assert(
  classifyDomainPipelineStop('1 pair(s) have HIGH blockers parked for later review. DOMAIN_COHERENCE stays closed.') ===
    'DOMAIN_READY',
  'parked blockers must stop the pair pipeline without looking like a crash'
);
assert(
  classifyDomainPipelineStop(
    'Domain A DOMAIN_COHERENCE_REVIEW has HIGH defects listed. Domain stays REPAIR_REQUIRED.'
  ) === 'BLOCKED',
  'failed domain coherence must stay blocked on listed defects'
);

const fiveValidated = [
  { pairId: 'A1_AP-A1', state: 'VALIDATED' as const, tasks: allCompleted, pairCoherencePassed: true },
  { pairId: 'A2_AP-A2', state: 'VALIDATED' as const, tasks: allCompleted, pairCoherencePassed: true },
  { pairId: 'A3_AP-A3', state: 'VALIDATED' as const, tasks: allCompleted, pairCoherencePassed: true },
  { pairId: 'A4_AP-A4', state: 'VALIDATED' as const, tasks: allCompleted, pairCoherencePassed: true },
  { pairId: 'A5_AP-A5', state: 'VALIDATED' as const, tasks: allCompleted, pairCoherencePassed: true }
];
const domainQc = nextEligiblePairTask('A', fiveValidated);
assert(!('blocked' in domainQc) && domainQc.taskType === 'DOMAIN_COHERENCE_REVIEW', 'five validated pairs admit domain coherence');
assert(!('blocked' in domainQc) && domainQc.pairId === 'A1_AP-A1', 'domain coherence persists on the host pair');
const domainQcPassed = nextEligiblePairTask('A', fiveValidated, { status: 'COMPLETED', passed: true });
assert(
  'blocked' in domainQcPassed && domainQcPassed.blocked.includes('READY_FOR_APPROVAL'),
  'passed domain coherence waits for external approval'
);
const domainQcFailed = nextEligiblePairTask('A', fiveValidated, { status: 'FAILED' });
assert(
  !('blocked' in domainQcFailed) && domainQcFailed.taskType === 'DOMAIN_COHERENCE_REVIEW',
  'failed domain coherence retries in place'
);

assert(
  relatedCriterionIds(['A2', { criterionId: 'A3', criterionHandle: 'criterion_001' }, 'A2']).join(',') === 'A2,A3',
  'candidate compile must normalize materialized related criteria to canonical ids'
);
assert(relatedCriterionIds([{ boundarySummary: 'x' }]).length === 0, 'related criteria without criterionId are dropped');

const fiveValidatedAvailability = commandAvailability({
  databaseReady: true,
  commandsEnabled: true,
  modelRoutesConfigured: true,
  domain: 'A',
  activeRun: {
    state: 'IN_PROGRESS',
    pairs: fiveValidated
  }
});
assert(fiveValidatedAvailability.runNextTask.enabled === true, 'five validated pairs must enable Continue');
assert(
  fiveValidatedAvailability.runNextTask.next?.taskType === 'DOMAIN_COHERENCE_REVIEW',
  'Continue after five VALIDATED pairs is domain coherence'
);
assert(fiveValidatedAvailability.recordApproval.enabled === false, 'approval stays closed after pair validation');

const readyAvailability = commandAvailability({
  databaseReady: true,
  commandsEnabled: true,
  modelRoutesConfigured: true,
  domain: 'A',
  activeRun: {
    state: 'READY_FOR_APPROVAL',
    pairs: fiveValidated,
    domainCoherence: { status: 'COMPLETED', passed: true }
  }
});
assert(readyAvailability.recordApproval.enabled === true, 'READY_FOR_APPROVAL enables hash-bound operator approval');
assert(readyAvailability.startDomainRun.enabled === false, 'ready domain does not start a new run');
assert(
  readyAvailability.runNextTask.enabled === false,
  'Continue stays closed after READY_FOR_APPROVAL because approval is a separate command'
);

const deferredPairs = nextEligiblePairTask('B', [
  { pairId: 'B1_AP-B1', state: 'VALIDATED', tasks: allCompleted },
  { pairId: 'B2_AP-B2', state: 'VALIDATED', tasks: allCompleted },
  { pairId: 'B3_AP-B3', state: 'DEFERRED', tasks: allCompleted },
  { pairId: 'B4_AP-B4', state: 'AUTHORING', tasks: pending },
  { pairId: 'B5_AP-B5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in deferredPairs) && deferredPairs.pairId === 'B4_AP-B4', 'deferred pairs must not block remaining pairs');
assert(!('blocked' in deferredPairs) && deferredPairs.taskType === 'PAIR_BOUNDARY', 'next pair after deferral starts at PAIR_BOUNDARY');

const parkBeforeRepair = dismissAvailability({
  blockingDefectCount: 1,
  localRepairCompleted: false,
  pairState: 'REPAIR_REQUIRED',
  taskInFlight: false
});
assert(parkBeforeRepair.enabled === false, 'park stays closed before one repair loop');

const parkAfterRepair = dismissAvailability({
  blockingDefectCount: 1,
  localRepairCompleted: true,
  pairState: 'REPAIR_REQUIRED',
  taskInFlight: false
});
assert(parkAfterRepair.enabled === true, 'park opens after one repair loop');

const parkWhileRunning = dismissAvailability({
  blockingDefectCount: 1,
  localRepairCompleted: true,
  pairState: 'AUTHORING',
  taskInFlight: true
});
assert(parkWhileRunning.enabled === false, 'park stays closed while a task is running');

assert(
  classifyDomainPipelineStop(
    'Domain Coherence cannot admit A2_AP-A2 because Pair Coherence did not pass.'
  ) === 'BLOCKED',
  'pair-coherence admission failure is blocked, not a crash'
);
assert(
  classifyDomainPipelineStop(
    'A2_AP-A2 Pair Coherence did not pass. Review remaining HIGH blockers, edit or delete, then Save. DOMAIN_COHERENCE stays closed.'
  ) === 'BLOCKED',
  'unpaid pair coherence must keep domain coherence closed'
);

const unpaidValidated = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'VALIDATED', tasks: allCompleted, pairCoherencePassed: true },
  { pairId: 'A2_AP-A2', state: 'VALIDATED', tasks: allCompleted, pairCoherencePassed: false },
  { pairId: 'A3_AP-A3', state: 'VALIDATED', tasks: allCompleted, pairCoherencePassed: true },
  { pairId: 'A4_AP-A4', state: 'VALIDATED', tasks: allCompleted, pairCoherencePassed: true },
  { pairId: 'A5_AP-A5', state: 'VALIDATED', tasks: allCompleted, pairCoherencePassed: true }
]);
assert('blocked' in unpaidValidated, 'VALIDATED-with-debt must not admit domain coherence');
assert(
  'blocked' in unpaidValidated && unpaidValidated.blocked.includes('A2_AP-A2'),
  'blocked reason names the pair that did not pass pair coherence'
);
assert(canTransition(pairTransitions, 'VALIDATED', 'REPAIR_REQUIRED'), 'false VALIDATED can reopen for human review');

const reviewHtml = renderPairReviewHtml({
  domain: 'A',
  pairId: 'A2_AP-A2',
  pairState: 'VALIDATED',
  passed: false,
  coherenceSummary: 'HIGH evidence defect remains.',
  blockingCount: 1,
  gateIssues: [],
  defects: [
    {
      defectId: 'defect_001',
      severity: 'HIGH',
      coherenceDimension: 'EVIDENCE_INTERPRETATION',
      issue: 'Capability evidence title is too thin to support the governed claim.',
      coherenceExpectation: 'Evidence titles must state a testable, attributable claim.',
      path: 'evidence.capability[evidence_001]',
      currentValue: { handle: 'evidence_001', title: 'Thin evidence title' },
      valueJson: '{\n  "handle": "evidence_001",\n  "title": "Thin evidence title"\n}',
      disposition: 'OPEN',
      rationale: ''
    }
  ]
});
assert(reviewHtml.includes('Approve and save'), 'review page must human-approve through save');
assert(reviewHtml.includes('expectedCandidateHash'), 'review save binds the current candidate revision');
assert(reviewHtml.includes('data-disposition-finding="defect_001"'), 'review page must record an explicit disposition');
assert(reviewHtml.includes('data-path="evidence.capability[evidence_001]"'), 'review page must allow editing the semantic path');
assert(!reviewHtml.includes('Delete this blocker'), 'review page must not infer resolution from form deletion');
assert(reviewHtml.includes('not domain APPROVED'), 'review save must not grant domain approval');
assert(reviewHtml.includes('Human pair approval'), 'review save is pair-level human approval');

const highDefect = {
  defectId: 'defect_001' as const,
  severity: 'HIGH' as const,
  coherenceDimension: 'EVIDENCE_INTERPRETATION' as const,
  affectedPathHandles: ['path_001' as const],
  affectedPaths: ['evidence.capability[evidence_001]'],
  issue: 'Capability evidence title is too thin to support the governed claim.',
  coherenceExpectation: 'Evidence titles must state a testable, attributable claim.',
  recommendedRepairPathHandles: ['path_001' as const],
  recommendedRepairPaths: ['evidence.capability[evidence_001]']
};
assert(remainingDefects({
  pairId: 'A2_AP-A2',
  pairCoherencePacketSha256: 'a'.repeat(64),
  passed: false,
  coherenceSummary: 'HIGH evidence defect remains.',
  defects: [highDefect]
}, []).length === 1, 'findings stay open without an explicit closing disposition');
assert(remainingDefects({
  pairId: 'A2_AP-A2',
  pairCoherencePacketSha256: 'a'.repeat(64),
  passed: false,
  coherenceSummary: 'HIGH evidence defect remains.',
  defects: [highDefect]
}, [{
  findingId: 'defect_001',
  disposition: 'RESOLVED',
  authority: 'OPERATOR',
  rationale: 'Evidence title now states the governed claim with attribution.'
}]).length === 0, 'RESOLVED with rationale closes the finding for coherence');

const rematerialized = rematerializeHumanReview({
  review: {
    pairId: 'A2_AP-A2',
    pairCoherencePacketSha256: 'a'.repeat(64),
    passed: false,
    coherenceSummary: 'HIGH evidence defect remains.',
    defects: [highDefect]
  },
  packet: {
    packetVersion: '1.0.0',
    pairId: 'A2_AP-A2',
    authoringPlanSha256: 'b'.repeat(64),
    snapshot: {} as never,
    pathRegistry: [{ pathHandle: 'path_001', objectPath: 'evidence.capability[evidence_001]', label: 'Capability evidence' }],
    packetSha256: 'a'.repeat(64)
  },
  dispositions: [{
    findingId: 'defect_001',
    disposition: 'RESOLVED',
    authority: 'OPERATOR',
    rationale: 'Evidence title now states the governed claim with attribution.'
  }],
  savedAt: '2026-09-07T04:20:00.000Z'
});
assert(rematerialized.passed === true, 'closing remaining HIGH defects derives passed=true');
assert(rematerialized.defects.length === 1, 'dispositioned findings remain listed on the saved revision');
assert(rematerialized.coherenceSummary.includes('Human approved'), 'human save is recorded as pair-level approval');

assert(
  snapshotPathFromDomainPath('pairs[A2_AP-A2].capability.relatedCriteria')?.snapshotPath ===
    'referenceMappings.capabilityRelatedCriteria',
  'domain relatedCriteria path maps to pair snapshot path'
);
const domainHtml = renderDomainReviewHtml({
  domain: 'A',
  domainState: 'REPAIR_REQUIRED',
  passed: false,
  coherenceSummary: 'HIGH related-criteria defect remains.',
  blockingCount: 1,
  gateIssues: [],
  defects: [
    {
      defectId: 'defect_001',
      severity: 'HIGH',
      coherenceDimension: 'BROKEN_RELATED_CRITERION',
      issue: 'The lifecycle pair omits a reciprocal related-criterion link to the suitability pair.',
      coherenceExpectation: 'Related-criterion lists must be reciprocal across the affected pairs.',
      pairId: 'A2_AP-A2',
      domainPath: 'pairs[A2_AP-A2].capability.relatedCriteria',
      snapshotPath: 'referenceMappings.capabilityRelatedCriteria',
      currentValue: [],
      valueJson: '[]',
      disposition: 'OPEN',
      rationale: ''
    }
  ]
});
assert(domainHtml.includes('Approve and save'), 'domain review page must human-approve through save');
assert(domainHtml.includes('expectedCandidateHash'), 'domain save binds the current candidate revision');
assert(domainHtml.includes('save-domain-review'), 'domain review posts save-domain-review');
assert(domainHtml.includes('Human domain approval'), 'domain save is domain-level human approval');
assert(domainHtml.includes('not domain APPROVED'), 'domain save must not grant domain APPROVED');

const domainHigh = {
  defectId: 'defect_001' as const,
  severity: 'HIGH' as const,
  coherenceDimension: 'BROKEN_RELATED_CRITERION' as const,
  affectedPairHandles: ['pair_002' as const],
  affectedPairIds: ['A2_AP-A2'],
  affectedPathHandles: ['path_015' as const],
  affectedPaths: ['pairs[A2_AP-A2].capability.relatedCriteria'],
  issue: 'The lifecycle pair omits a reciprocal related-criterion link to the suitability pair.',
  coherenceExpectation: 'Related-criterion lists must be reciprocal across the affected pairs.',
  recommendedRepairPairHandles: ['pair_002' as const],
  recommendedRepairPairIds: ['A2_AP-A2'],
  recommendedRepairPathHandles: ['path_015' as const],
  recommendedRepairPaths: ['pairs[A2_AP-A2].capability.relatedCriteria']
};
assert(remainingDomainDefects({
  domain: 'A',
  domainCoherencePacketSha256: 'a'.repeat(64),
  passed: false,
  coherenceSummary: 'HIGH related-criteria defect remains.',
  defects: [domainHigh]
}, []).length === 1, 'domain findings stay open without an explicit closing disposition');

const emptyRoots = Object.fromEntries(Object.keys(SNAPSHOT_ROOT_TASK).map((key) => [key, {}]));
assert(schemaGate('A2_AP-A2', emptyRoots).length > 0, 'schema gate rejects empty required sections');
assert(
  schemaGate('A2_AP-A2', emptyRoots).some((item) => item.includes('atomics') || item.includes('empty or structurally incomplete')),
  'empty objects do not satisfy SIR section contracts'
);
assert(
  schemaGate('A2_AP-A2', { pairBoundary: {} }).some((item) => item.includes('atomics')),
  'schema gate requires the pair SIR sections'
);
const validSnapshot = validMinimalSnapshotFixture();
assert(schemaGate('A2_AP-A2', validSnapshot).length === 0, 'schema gate passes a complete section-valid snapshot');
assert(
  schemaGate('A2_AP-A2', { ...validSnapshot, pairBoundary: { ...(validSnapshot.pairBoundary as object), pairId: 'B1_AP-B1' } }).some((item) =>
    item.includes('pairId drifted')
  ),
  'schema gate rejects identity drift'
);
assert(
  parseReviewSaveBody({ deletedDefectIds: ['defect_001'], patches: [{ path: 'evidence.capability[evidence_001]', value: { title: 'Fixed' } }] }).deletedIds.join(',') === 'defect_001',
  'JSON save body still parses deleted blockers so they can be rejected'
);
assert(
  parseReviewSaveBody({
    findingDispositions: [{
      findingId: 'defect_001',
      disposition: 'RESOLVED',
      authority: 'OPERATOR',
      rationale: 'Evidence title now states the governed claim with attribution.'
    }],
    patches: [{ path: 'evidence.capability[evidence_001]', value: { title: 'Fixed' } }]
  }).dispositions[0]?.disposition === 'RESOLVED',
  'JSON save body parses explicit finding dispositions'
);
assert(
  (parseReviewSaveBody({ deletedDefectIds: ['defect_001'], patches: [{ path: 'evidence.capability[evidence_001]', value: { title: 'Fixed' } }] }).patches[0]?.value as { title?: string }).title === 'Fixed',
  'JSON save body parses human content edits'
);
assert(
  parseReviewSaveBody({
    deletedDefectIds: ['defect_001'],
    expectedCandidateHash: 'a'.repeat(64),
    patches: [{ path: 'evidence.capability[evidence_001]', value: { title: 'Fixed' } }]
  }).expectedCandidateHash === 'a'.repeat(64),
  'JSON save body parses the bound candidate revision hash'
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
assert(supportsCustomTemperature({ provider: 'META', model: 'muse-spark-1.2' }) === false, 'Muse Spark must omit temperature');
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
  !('temperature' in requestBody({
    target: { provider: 'META', model: 'muse-spark-1.2' },
    systemPrompt: 'sys',
    userPrompt: 'user'
  })),
  'Muse Spark body must not send temperature'
);
assert(
  (requestBody({
    target: { provider: 'META', model: 'muse-spark-1.2' },
    systemPrompt: 'sys',
    userPrompt: 'user'
  }).response_format as { type?: string }).type === 'json_object',
  'Muse Spark still requests json_object'
);
assert(supportsProviderJsonSchema({ provider: 'OPENAI', model: 'gpt-4o' }) === true, 'gpt-4o may send json_schema');
assert(
  supportsProviderJsonSchema({ provider: 'OPENAI', model: 'gpt-5.6-terra' }) === false,
  'gpt-5.6-terra must not send json_schema'
);
assert(
  (
    requestBody({
      target: { provider: 'OPENAI', model: 'gpt-4o' },
      systemPrompt: 'sys',
      userPrompt: 'user',
      structuredOutput: {
        schemaName: 'SirPairBoundaryOutput',
        requiredFields: ['capability.canonicalDefinition', 'boundaryRationale']
      }
    }).response_format as { type?: string }
  ).type === 'json_schema',
  'gpt-4o request uses json_schema as a transport hint only'
);
assert(
  (
    requestBody({
      target: { provider: 'OPENAI', model: 'gpt-5.6-terra' },
      systemPrompt: 'sys',
      userPrompt: 'user',
      structuredOutput: {
        schemaName: 'SirPairBoundaryOutput',
        requiredFields: ['capability.canonicalDefinition']
      }
    }).response_format as { type?: string }
  ).type === 'json_object',
  'gpt-5.6-terra request keeps json_object'
);
assert(getProviderBaseUrl('META') === 'https://api.meta.ai/v1', 'Meta default base URL is the Model API');
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
      qcRepairEligibility: 'PASS',
      pairCoherenceRecheckAfterRepair: 'PASS',
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
