import type { DomainId } from '../authoring/authoring-plan.js';
import { getModelRoute } from '../ai/model-router.js';
import { loadRepoBaselineArtifacts } from '../baseline/repo-artifacts.js';
import { sealBaselineSnapshot, type BaselineSnapshot } from '../baseline/snapshot.js';
import type { CognitiveTaskType, DomainState, PairState } from '../domain/states.js';
import {
  canTransition,
  domainTransitions,
  expectedDomainPairIds,
  PAIR_TASK_SEQUENCE,
  pairTransitions
} from '../orchestration/pipeline.js';
import { resolveSirTaskContract, type ResolvableSirTaskType } from '../orchestration/sir-contract-resolver.js';
import { resolveDomainCoherenceContract } from '../orchestration/domain-coherence-resolver.js';
import { ensurePersistedSourceContext } from '../orchestration/source-context-acquisition.js';
import {
  createDomainRun,
  createPairRun,
  getBaselineSnapshotById,
  getCompletedTaskTypes,
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getLatestTaskArtifactWithOutput,
  getPairRuns,
  getTaskRunsForPairs,
  persistParkedDefects,
  parkPairForLater,
  closeParkedFinding,
  getParkedFindings,
  failLatestCompletedTask,
  updatePairState,
  updateDomainState,
  failOrphanedStartedTasks,
  type PairRunRecord,
  type TaskRunRecord
} from '../orchestration/store.js';
import { runCognitiveTask } from '../orchestration/task-runner.js';
import { isProviderRouteFailure } from '../repair/content-correction.js';
import { loadCategoriesBaseline } from '../baseline/categories.js';
import {
  buildPairAuthoringPlan,
  categoryBaselineRecord,
  goldenReferenceRecord
} from './authoring-context.js';
import {
  isOpenDomainState,
  mayHealDomainReady,
  nextEligiblePairTask,
  classifyDomainPipelineStop,
  countUnparkedBlockingDefects,
  type DomainCoherenceSnapshot,
  type EligiblePairSnapshot,
  type NextEligibleTask
} from './eligibility.js';
import type { OperatorTaskStatus } from './eligibility.js';
import { operatorLog } from './log.js';
import { runPairQcRepair } from './qc-repair-command.js';
import { dismissAvailability } from './dismiss.js';
import { blockingQcDefects, qcDefectsToFindings, reviewFromUnknown } from '../repair/qc-repair.js';
import { parkReasonAndOwner } from './review-fix-ui.js';

const TARGET_VERSION = '1.0.0';

export function operatorCommandsEnabled(): boolean {
  return process.env.OPERATOR_COMMANDS_ENABLED === 'true';
}

export function modelRoutesConfigured(): boolean {
  try {
    getModelRoute('WORKHORSE');
    getModelRoute('REASONER');
    getModelRoute('QUALITY_CHECKER');
    return true;
  } catch {
    return false;
  }
}

export function parseDomainId(value: unknown): DomainId {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'E' || value === 'F') {
    return value;
  }
  throw new Error('Domain must be one of A–F.');
}

function isResolvable(taskType: CognitiveTaskType): taskType is ResolvableSirTaskType {
  return (
    taskType !== 'DOMAIN_COHERENCE_REVIEW' &&
    taskType !== 'LOCAL_REPAIR' &&
    taskType !== 'SOURCE_CONTEXT'
  );
}

export function pairSnapshots(
  expectedPairIds: readonly string[],
  pairRuns: PairRunRecord[],
  taskRuns: Array<{ pairRunId: string; taskType: CognitiveTaskType; status: 'STARTED' | 'COMPLETED' | 'FAILED' }>
): EligiblePairSnapshot[] {
  return expectedPairIds.map((pairId) => {
    const run = pairRuns.find((item) => item.pairId === pairId);
    const tasks = PAIR_TASK_SEQUENCE.map((taskType) => {
      const latest = taskRuns.find((item) => item.pairRunId === run?.id && item.taskType === taskType);
      return { taskType, status: (latest?.status ?? 'PENDING') as OperatorTaskStatus };
    });
    return {
      pairId,
      state: run?.state ?? 'NOT_STARTED',
      tasks
    };
  });
}

export async function enrichPairSnapshots(
  snapshots: EligiblePairSnapshot[],
  pairRuns: PairRunRecord[]
): Promise<EligiblePairSnapshot[]> {
  return Promise.all(
    snapshots.map(async (pair) => {
      const run = pairRuns.find((item) => item.pairId === pair.pairId);
      if (!run) return { ...pair, pairCoherencePassed: false };
      const artifact = await getLatestTaskArtifactWithOutput(run.id, 'PAIR_COHERENCE_REVIEW');
      const review = reviewFromUnknown(pair.pairId, artifact?.output);
      return { ...pair, pairCoherencePassed: review?.passed === true };
    })
  );
}

export function readDomainCoherenceSnapshot(
  domain: DomainId,
  pairRuns: readonly PairRunRecord[],
  taskRuns: readonly TaskRunRecord[],
  passed?: boolean
): DomainCoherenceSnapshot | undefined {
  const hostPairId = expectedDomainPairIds(domain)[0];
  const host = pairRuns.find((item) => item.pairId === hostPairId);
  if (!host) return undefined;
  const latest = taskRuns.find(
    (task) => task.pairRunId === host.id && task.taskType === 'DOMAIN_COHERENCE_REVIEW'
  );
  if (!latest) return undefined;
  return { status: latest.status, passed };
}

function domainReviewPassed(output: unknown): boolean | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const passed = (output as { passed?: unknown }).passed;
  return typeof passed === 'boolean' ? passed : undefined;
}

async function enterDomainValidating(domainRunId: string, state: DomainState): Promise<DomainState> {
  if (state === 'DOMAIN_VALIDATING') return state;
  if (!canTransition(domainTransitions, state, 'DOMAIN_VALIDATING')) {
    throw new Error(`Illegal domain transition ${state} → DOMAIN_VALIDATING.`);
  }
  await updateDomainState(domainRunId, 'DOMAIN_VALIDATING');
  return 'DOMAIN_VALIDATING';
}

function deferredPairIdsOf(pairRuns: readonly PairRunRecord[]): Set<string> {
  return new Set(pairRuns.filter((item) => item.state === 'DEFERRED').map((item) => item.pairId));
}

function domainDefectsFromOutput(output: unknown): Array<{
  severity?: string;
  affectedPairIds?: string[];
  affectedPaths?: string[];
  recommendedRepairPaths?: string[];
}> {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const defects = (output as { defects?: unknown }).defects;
  return Array.isArray(defects) ? defects : [];
}

/**
 * Parked pairs wait. They must not keep the domain OPEN after domain coherence.
 * When DOMAIN_COHERENCE_REVIEW passed, or every remaining HIGH/BLOCKING defect
 * is parked, promote to READY_FOR_APPROVAL including from IN_PROGRESS so
 * Continue is not deadlocked on a passed review that never wrote READY.
 */
export async function promoteDomainReadyWhenOnlyParkedRemain(input: {
  domain: DomainId;
  domainRunId: string;
  state: DomainState;
  pairRuns: readonly PairRunRecord[];
  domainOutput: unknown;
  parkedObjectIds?: ReadonlySet<string>;
  parkedCheckIds?: ReadonlySet<string>;
}): Promise<boolean> {
  const expected = expectedDomainPairIds(input.domain);
  const complete = input.pairRuns.filter(
    (item) => item.state === 'VALIDATED' || item.state === 'DEFERRED'
  );
  if (complete.length !== expected.length) return false;
  const parkedPairIds = new Set([
    ...deferredPairIdsOf(input.pairRuns),
    ...(input.parkedObjectIds ?? [])
  ]);
  const remaining = countUnparkedBlockingDefects(domainDefectsFromOutput(input.domainOutput), parkedPairIds, {
    parkedCheckIds: input.parkedCheckIds,
    domain: input.domain
  });
  const passed = domainReviewPassed(input.domainOutput);
  const hasDomainReviewOutput =
    input.domainOutput !== null &&
    input.domainOutput !== undefined &&
    typeof input.domainOutput === 'object' &&
    !Array.isArray(input.domainOutput);
  if (
    !mayHealDomainReady({
      state: input.state,
      remainingUnparkedBlocking: remaining,
      domainReviewPassed: passed,
      hasDomainReviewOutput
    })
  ) {
    return false;
  }
  if (input.state === 'READY_FOR_APPROVAL') return true;
  const current = await enterDomainValidating(input.domainRunId, input.state);
  if (current !== 'DOMAIN_VALIDATING') return false;
  if (!canTransition(domainTransitions, 'DOMAIN_VALIDATING', 'READY_FOR_APPROVAL')) {
    throw new Error('Illegal domain transition DOMAIN_VALIDATING → READY_FOR_APPROVAL.');
  }
  await updateDomainState(input.domainRunId, 'READY_FOR_APPROVAL');
  operatorLog('operator.domain.ready_after_park', {
    domain: input.domain,
    domainRunId: input.domainRunId
  });
  return true;
}

function domainReadyStopMessage(domain: DomainId, domainOutput: unknown): string {
  return domainReviewPassed(domainOutput) === true
    ? `Domain ${domain} DOMAIN_COHERENCE_REVIEW passed. READY_FOR_APPROVAL. Record operator approval against the hash-bound bundle. Publication stays a separate operation.`
    : `Domain ${domain} remaining HIGH defects are parked. READY_FOR_APPROVAL. Record operator approval against the hash-bound bundle. Publication stays a separate operation.`;
}

async function runDomainCoherenceReview(input: {
  domain: DomainId;
  domainRunId: string;
  hostPairRunId: string;
  snapshot: BaselineSnapshot;
}): Promise<{ usedFallback: boolean; passed: boolean }> {
  const pairRuns = await getPairRuns(input.domainRunId);
  const pairs = await Promise.all(
    expectedDomainPairIds(input.domain).map(async (pairId) => {
      const pairRun = pairRuns.find((item) => item.pairId === pairId);
      if (!pairRun) throw new Error(`Pair run ${pairId} is missing.`);
      const artifact = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
      if (!artifact) {
        throw new Error(
          `DOMAIN_COHERENCE_REVIEW requires completed PAIR_COHERENCE_REVIEW on all five pairs; missing ${pairId}.`
        );
      }
      const plan = buildPairAuthoringPlan({
        domain: input.domain,
        pairId,
        snapshot: input.snapshot
      });
      return {
        authoringPlan: plan,
        pairCoherenceTaskContract: artifact.taskContract,
        pairCoherenceOutput: artifact.output,
        categoryBaseline: categoryBaselineRecord(input.domain),
        goldenReference: goldenReferenceRecord()
      };
    })
  );
  const contract = resolveDomainCoherenceContract({
    domain: input.domain,
    domainBaseline: categoryBaselineRecord(),
    goldenStandardDomainRules: goldenReferenceRecord(),
    pairs
  });
  const hostPlan = pairs[0]?.authoringPlan;
  if (!hostPlan) throw new Error(`Domain ${input.domain} is missing a host pair for domain coherence.`);
  const result = await runCognitiveTask({
    pairRunId: input.hostPairRunId,
    contract,
    completionContext: {
      runId: input.domainRunId,
      expectedPairId: hostPlan.identity.pairId,
      expectedCapabilityId: hostPlan.identity.capabilityId,
      expectedAntipatternId: hostPlan.identity.antipatternId
    }
  });
  const passed = domainReviewPassed(result.output);
  if (passed !== true) {
    return { usedFallback: result.usedFallback, passed: false };
  }
  return { usedFallback: result.usedFallback, passed: true };
}

export async function freezeRepoBaseline(): Promise<BaselineSnapshot> {
  return sealBaselineSnapshot(loadRepoBaselineArtifacts());
}

export async function startDomainRun(domain: DomainId): Promise<{ domainRunId: string; baselineSha256: string }> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  const existing = await getLatestDomainRun(domain);
  if (existing && isOpenDomainState(existing.state)) {
    throw new Error(`Domain ${domain} already has an open run.`);
  }
  const snapshot = await freezeRepoBaseline();
  loadCategoriesBaseline();
  const domainRunId = await createDomainRun({ domain, baselineSnapshotId: snapshot.id });
  for (const pairId of expectedDomainPairIds(domain)) {
    const pairRunId = await createPairRun({ domainRunId, pairId, targetVersion: TARGET_VERSION });
    if (!canTransition(pairTransitions, 'DRAFT', 'AUTHORING')) {
      throw new Error('Illegal pair transition DRAFT → AUTHORING.');
    }
    await updatePairState(pairRunId, 'AUTHORING');
    const plan = buildPairAuthoringPlan({ domain, pairId, snapshot });
    await ensurePersistedSourceContext(pairRunId, plan);
  }
  return { domainRunId, baselineSha256: snapshot.sha256 };
}

async function transitionAfterTask(pairRunId: string, pairState: PairState, taskType: CognitiveTaskType): Promise<void> {
  if (taskType !== 'PAIR_COHERENCE_REVIEW') return;
  const completed = await getCompletedTaskTypes(pairRunId);
  if (!completed.has('PAIR_COHERENCE_REVIEW')) return;
  const artifact = await getLatestCompletedTaskArtifact<{ passed?: boolean }>(pairRunId, 'PAIR_COHERENCE_REVIEW');
  const next: PairState = artifact?.output.passed === true ? 'VALIDATED' : 'REPAIR_REQUIRED';
  let current = pairState;
  if (current !== 'VALIDATING') {
    if (!canTransition(pairTransitions, current, 'VALIDATING')) {
      throw new Error(`Illegal pair transition ${current} → VALIDATING.`);
    }
    await updatePairState(pairRunId, 'VALIDATING');
    current = 'VALIDATING';
  }
  if (!canTransition(pairTransitions, current, next)) {
    throw new Error(`Illegal pair transition ${current} → ${next}.`);
  }
  await updatePairState(pairRunId, next);
}

async function markRepairRequired(pairRunId: string, pairState: PairState): Promise<void> {
  if (pairState === 'REPAIR_REQUIRED') return;
  if (!canTransition(pairTransitions, pairState, 'REPAIR_REQUIRED')) {
    throw new Error(`Illegal pair transition ${pairState} → REPAIR_REQUIRED.`);
  }
  await updatePairState(pairRunId, 'REPAIR_REQUIRED');
}

async function reopenForRetry(pairRunId: string, pairState: PairState): Promise<PairState> {
  if (pairState !== 'REPAIR_REQUIRED') return pairState;
  if (!canTransition(pairTransitions, 'REPAIR_REQUIRED', 'AUTHORING')) {
    throw new Error('Illegal pair transition REPAIR_REQUIRED → AUTHORING.');
  }
  await updatePairState(pairRunId, 'AUTHORING');
  return 'AUTHORING';
}

export async function runNextEligibleTask(domain: DomainId): Promise<{
  domainRunId: string;
  next: NextEligibleTask;
  usedFallback: boolean;
}> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  if (!modelRoutesConfigured()) {
    throw new Error('Model role routing is not configured.');
  }
  const run = await getLatestDomainRun(domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const taskRuns = await getTaskRunsForPairs(pairRuns.map((item) => item.id));
  const snapshots = await enrichPairSnapshots(
    pairSnapshots(expectedDomainPairIds(domain), pairRuns, taskRuns),
    pairRuns
  );
  const hostPairId = expectedDomainPairIds(domain)[0];
  const hostPair = pairRuns.find((item) => item.pairId === hostPairId);
  const domainArtifact = hostPair
    ? await getLatestTaskArtifactWithOutput<{ passed?: boolean }>(hostPair.id, 'DOMAIN_COHERENCE_REVIEW')
    : undefined;
  const domainCoherence = readDomainCoherenceSnapshot(
    domain,
    pairRuns,
    taskRuns,
    domainReviewPassed(domainArtifact?.output)
  );
  const parkedFindings = await getParkedFindings(run.id);
  const parkedPairIds = new Set([
    ...deferredPairIdsOf(pairRuns),
    ...parkedFindings.map((item) => item.objectId)
  ]);
  const parkedCheckIds = new Set(parkedFindings.map((item) => item.checkId));
  const unparkedBlocking = countUnparkedBlockingDefects(
    domainDefectsFromOutput(domainArtifact?.output),
    parkedPairIds,
    { parkedCheckIds, domain }
  );
  if (
    await promoteDomainReadyWhenOnlyParkedRemain({
      domain,
      domainRunId: run.id,
      state: run.state,
      pairRuns,
      domainOutput: domainArtifact?.output,
      parkedObjectIds: parkedPairIds,
      parkedCheckIds
    })
  ) {
    throw new Error(domainReadyStopMessage(domain, domainArtifact?.output));
  }
  const eligible = nextEligiblePairTask(
    domain,
    snapshots,
    domainCoherence,
    parkedFindings.length,
    unparkedBlocking
  );
  if ('blocked' in eligible) throw new Error(eligible.blocked);
  let next: NextEligibleTask = eligible;
  const pairRun = pairRuns.find((item) => item.pairId === next.pairId);
  if (!pairRun) throw new Error(`Pair run ${next.pairId} is missing.`);

  const sealed = await getBaselineSnapshotById(run.baselineSnapshotId);
  if (!sealed) throw new Error('Sealed baseline snapshot is missing.');
  const snapshot: BaselineSnapshot = {
    id: sealed.id,
    sha256: sealed.sha256,
    manifest: sealed.manifest as BaselineSnapshot['manifest']
  };

  if (next.taskType === 'DOMAIN_COHERENCE_REVIEW') {
    operatorLog('operator.task.admitted', {
      domain,
      pairId: next.pairId,
      taskType: next.taskType,
      domainRunId: run.id
    });
    if (
      await promoteDomainReadyWhenOnlyParkedRemain({
        domain,
        domainRunId: run.id,
        state: run.state,
        pairRuns,
        domainOutput: domainArtifact?.output,
        parkedObjectIds: parkedPairIds,
        parkedCheckIds
      })
    ) {
      throw new Error(
        `Domain ${domain} remaining HIGH defects are parked. READY_FOR_APPROVAL. Record operator approval against the hash-bound bundle. Publication stays a separate operation.`
      );
    }
    try {
      await enterDomainValidating(run.id, run.state);
      const review = await runDomainCoherenceReview({
        domain,
        domainRunId: run.id,
        hostPairRunId: pairRun.id,
        snapshot
      });
      if (review.passed) {
        if (!canTransition(domainTransitions, 'DOMAIN_VALIDATING', 'READY_FOR_APPROVAL')) {
          throw new Error('Illegal domain transition DOMAIN_VALIDATING → READY_FOR_APPROVAL.');
        }
        await updateDomainState(run.id, 'READY_FOR_APPROVAL');
        throw new Error(
          `Domain ${domain} DOMAIN_COHERENCE_REVIEW passed. READY_FOR_APPROVAL. Record operator approval against the hash-bound bundle. Publication stays a separate operation.`
        );
      }
      if (!canTransition(domainTransitions, 'DOMAIN_VALIDATING', 'REPAIR_REQUIRED')) {
        throw new Error('Illegal domain transition DOMAIN_VALIDATING → REPAIR_REQUIRED.');
      }
      await updateDomainState(run.id, 'REPAIR_REQUIRED');
      throw new Error(
        `Domain ${domain} DOMAIN_COHERENCE_REVIEW has HIGH defects listed. Domain stays REPAIR_REQUIRED.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('READY_FOR_APPROVAL') || message.includes('HIGH defects listed')) {
        throw error;
      }
      if (canTransition(domainTransitions, 'DOMAIN_VALIDATING', 'REPAIR_REQUIRED')) {
        await updateDomainState(run.id, 'REPAIR_REQUIRED');
      }
      throw error;
    }
  }

  if (next.taskType === 'LOCAL_REPAIR') {
    operatorLog('operator.task.admitted', { domain, pairId: next.pairId, taskType: next.taskType, domainRunId: run.id });
    const pairState = await reopenForRetry(pairRun.id, pairRun.state);
    try {
      await runPairQcRepair({
        pairRunId: pairRun.id,
        pairId: next.pairId,
        domainRunId: run.id,
        domain,
        baseline: snapshot,
        targetVersion: pairRun.targetVersion
      });
      next = { domain, pairId: next.pairId, taskType: 'PAIR_COHERENCE_REVIEW' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no completed PAIR_COHERENCE_REVIEW to repair from')) {
        next = { domain, pairId: next.pairId, taskType: 'PAIR_COHERENCE_REVIEW' };
      } else {
        if (!isProviderRouteFailure(error)) {
          await markRepairRequired(pairRun.id, pairState);
        }
        throw error;
      }
    }
  }

  if (!isResolvable(next.taskType)) {
    throw new Error(`${next.taskType} is not an operator-admitted pair task.`);
  }
  const plan = buildPairAuthoringPlan({ domain, pairId: next.pairId, snapshot });
  const sourceContextPacket = await ensurePersistedSourceContext(pairRun.id, plan);
  const contract = await resolveSirTaskContract({
    pairRunId: pairRun.id,
    taskType: next.taskType,
    authoringPlan: plan,
    categoryBaseline: categoryBaselineRecord(domain),
    goldenReference: goldenReferenceRecord(),
    sourceContextPacket: next.taskType === 'SOURCE_MAPPING' ? sourceContextPacket : undefined
  });

  operatorLog('operator.task.admitted', { domain, pairId: next.pairId, taskType: next.taskType, domainRunId: run.id });
  const pairState = await reopenForRetry(pairRun.id, pairRun.state);

  try {
    const result = await runCognitiveTask({
      pairRunId: pairRun.id,
      contract,
      completionContext: {
        runId: run.id,
        expectedPairId: plan.identity.pairId,
        expectedCapabilityId: plan.identity.capabilityId,
        expectedAntipatternId: plan.identity.antipatternId
      }
    });
    await transitionAfterTask(pairRun.id, pairState, next.taskType);
    if (next.taskType === 'PAIR_COHERENCE_REVIEW') {
      const review = await getLatestCompletedTaskArtifact<{ passed?: boolean }>(pairRun.id, 'PAIR_COHERENCE_REVIEW');
      if (review?.output.passed !== true) {
        throw new Error(
          `${next.pairId} REPAIR_REQUIRED. QC defects are listed. Continue repairs recommended paths then re-checks pair coherence.`
        );
      }
    }
    return { domainRunId: run.id, next, usedFallback: result.usedFallback };
  } catch (error) {
    if (!isProviderRouteFailure(error)) {
      await markRepairRequired(pairRun.id, pairState);
    }
    throw error;
  }
}

export async function dismissBlockingDefects(domain: DomainId): Promise<{
  domain: DomainId;
  pairId: string;
  parked: number;
}> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  const run = await getLatestDomainRun(domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const taskRuns = await getTaskRunsForPairs(pairRuns.map((item) => item.id));
  const snapshots = pairSnapshots(expectedDomainPairIds(domain), pairRuns, taskRuns);
  const taskInFlight = taskRuns.some((task) => task.status === 'STARTED');
  for (const pairRun of pairRuns) {
    const pair = snapshots.find((item) => item.pairId === pairRun.pairId);
    if (!pair) continue;
    const artifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    const review = reviewFromUnknown(pairRun.pairId, artifact?.output);
    if (!review) continue;
    const blocking = blockingQcDefects(review);
    const localRepairCompleted = taskRuns.some(
      (task) => task.pairRunId === pairRun.id && task.taskType === 'LOCAL_REPAIR' && task.status === 'COMPLETED'
    );
    const flag = dismissAvailability({
      blockingDefectCount: blocking.length,
      localRepairCompleted,
      pairState: pair.state,
      taskInFlight
    });
    if (!flag.enabled) continue;
    await persistParkedDefects(
      pairRun.id,
      run.id,
      qcDefectsToFindings(pairRun.pairId, { ...review, defects: blocking })
    );
    if (pairRun.state !== 'DEFERRED') {
      if (!canTransition(pairTransitions, pairRun.state, 'DEFERRED')) {
        throw new Error(`Illegal pair transition ${pairRun.state} → DEFERRED.`);
      }
      await updatePairState(pairRun.id, 'DEFERRED');
    }
    const freshPairs = await getPairRuns(run.id);
    const hostPairId = expectedDomainPairIds(domain)[0];
    const hostPair = freshPairs.find((item) => item.pairId === hostPairId);
    const domainArtifact = hostPair
      ? await getLatestTaskArtifactWithOutput(hostPair.id, 'DOMAIN_COHERENCE_REVIEW')
      : undefined;
    const promoted = await promoteDomainReadyWhenOnlyParkedRemain({
      domain,
      domainRunId: run.id,
      state: run.state,
      pairRuns: freshPairs,
      domainOutput: domainArtifact?.output,
      parkedObjectIds: new Set(freshPairs.filter((item) => item.state === 'DEFERRED').map((item) => item.pairId))
    });
    operatorLog('operator.defects.parked', {
      domain,
      pairId: pairRun.pairId,
      parked: blocking.length,
      domainReady: promoted
    });
    return { domain, pairId: pairRun.pairId, parked: blocking.length };
  }
  throw new Error('Park is available after one repair loop, and only for HIGH blockers.');
}

export async function closeParkedDefect(domain: DomainId, findingId: string): Promise<{
  domain: DomainId;
  remaining: number;
  pairValidated: boolean;
}> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  const run = await getLatestDomainRun(domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${domain} run.`);
  }
  const closed = await closeParkedFinding(findingId);
  if (!closed.pairRunId) {
    throw new Error('Parked item was not found or is already closed.');
  }
  let pairValidated = false;
  if (closed.remaining === 0) {
    const pairRuns = await getPairRuns(run.id);
    const pairRun = pairRuns.find((item) => item.id === closed.pairRunId);
    if (pairRun?.state === 'DEFERRED') {
      const artifact = await getLatestCompletedTaskArtifact<{ passed?: boolean }>(
        pairRun.id,
        'PAIR_COHERENCE_REVIEW'
      );
      if (artifact?.output.passed === true && canTransition(pairTransitions, 'DEFERRED', 'VALIDATED')) {
        await updatePairState(pairRun.id, 'VALIDATED');
        pairValidated = true;
      }
    }
  }
  operatorLog('operator.defects.closed', {
    domain,
    findingId,
    remaining: closed.remaining,
    pairValidated
  });
  return { domain, remaining: closed.remaining, pairValidated };
}

async function reopenPairToAuthoring(pairRunId: string, state: PairState): Promise<void> {
  if (state === 'AUTHORING') return;
  let current = state;
  if (current !== 'REPAIR_REQUIRED' && canTransition(pairTransitions, current, 'REPAIR_REQUIRED')) {
    await updatePairState(pairRunId, 'REPAIR_REQUIRED');
    current = 'REPAIR_REQUIRED';
  }
  if (!canTransition(pairTransitions, current, 'AUTHORING')) {
    throw new Error(`Cannot reopen ${current} → AUTHORING for regeneration.`);
  }
  await updatePairState(pairRunId, 'AUTHORING');
}

async function reopenValidatedForRepair(pairRunId: string, state: PairState): Promise<PairState> {
  if (state !== 'VALIDATED') return state;
  if (!canTransition(pairTransitions, 'VALIDATED', 'REPAIR_REQUIRED')) {
    throw new Error('Illegal pair transition VALIDATED → REPAIR_REQUIRED.');
  }
  await updatePairState(pairRunId, 'REPAIR_REQUIRED');
  return 'REPAIR_REQUIRED';
}

/**
 * Park this pair/object so other pairs can continue. This is a defer, not accepted
 * risk: parked pairs are omitted from Finalize ready documents and wait for later.
 * VALIDATED pairs on domain review may be parked (reopened to REPAIR_REQUIRED, then DEFERRED).
 */
export async function finalizeLaterForPair(input: {
  domain: DomainId;
  pairId: string;
  reason: string;
  owner: string;
}): Promise<{
  domain: DomainId;
  pairId: string;
  parked: number;
  state: PairState;
  persisted: true;
  status: 'PARKED';
  reason: string;
  alreadyParked?: boolean;
  domainReady?: boolean;
}> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  const parkedMeta = parkReasonAndOwner(input.reason, input.owner);
  const reason = parkedMeta.reason;
  const owner = parkedMeta.owner;
  const run = await getLatestDomainRun(input.domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${input.domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const pairRun = pairRuns.find((item) => item.pairId === input.pairId);
  if (!pairRun) throw new Error(`Pair ${input.pairId} is missing.`);
  if (pairRun.state === 'DEFERRED') {
    const parkedFindings = (await getParkedFindings(run.id)).filter((item) => item.pairRunId === pairRun.id);
    const hostPairId = expectedDomainPairIds(input.domain)[0];
    const hostPair = pairRuns.find((item) => item.pairId === hostPairId);
    const domainArtifact = hostPair
      ? await getLatestTaskArtifactWithOutput(hostPair.id, 'DOMAIN_COHERENCE_REVIEW')
      : undefined;
    const promoted = await promoteDomainReadyWhenOnlyParkedRemain({
      domain: input.domain,
      domainRunId: run.id,
      state: run.state,
      pairRuns,
      domainOutput: domainArtifact?.output,
      parkedObjectIds: new Set(parkedFindings.map((item) => item.objectId))
    });
    return {
      domain: input.domain,
      pairId: input.pairId,
      parked: parkedFindings.length,
      state: 'DEFERRED',
      persisted: true,
      status: 'PARKED',
      reason:
        parkedFindings.find((item) => item.checkId === 'FINALIZE_LATER')?.parkReason ??
        parkedFindings[0]?.parkReason ??
        parkedFindings[0]?.issue ??
        reason,
      alreadyParked: true,
      domainReady: promoted
    };
  }
  const currentState = await reopenValidatedForRepair(pairRun.id, pairRun.state);
  const artifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  const review = reviewFromUnknown(pairRun.pairId, artifact?.output);
  const contextDefects = review
    ? qcDefectsToFindings(pairRun.pairId, { ...review, defects: blockingQcDefects(review) })
    : [];
  const parked = await parkPairForLater({
    pairRunId: pairRun.id,
    domainRunId: run.id,
    pairId: input.pairId,
    reason,
    owner,
    contextDefects
  });
  if (!canTransition(pairTransitions, currentState, 'DEFERRED')) {
    throw new Error(`Illegal pair transition ${currentState} → DEFERRED.`);
  }
  await updatePairState(pairRun.id, 'DEFERRED');
  const freshPairs = await getPairRuns(run.id);
  const hostPairId = expectedDomainPairIds(input.domain)[0];
  const hostPair = freshPairs.find((item) => item.pairId === hostPairId);
  const domainArtifact = hostPair
    ? await getLatestTaskArtifactWithOutput(hostPair.id, 'DOMAIN_COHERENCE_REVIEW')
    : undefined;
  const promoted = await promoteDomainReadyWhenOnlyParkedRemain({
    domain: input.domain,
    domainRunId: run.id,
    state: run.state,
    pairRuns: freshPairs,
    domainOutput: domainArtifact?.output,
    parkedObjectIds: new Set([input.pairId, ...freshPairs.filter((item) => item.state === 'DEFERRED').map((item) => item.pairId)])
  });
  operatorLog('operator.pair.finalize_later', {
    domain: input.domain,
    pairId: input.pairId,
    owner,
    parked: parked.parked,
    domainReady: promoted
  });
  return {
    domain: input.domain,
    pairId: input.pairId,
    parked: parked.parked,
    state: 'DEFERRED',
    persisted: true,
    status: 'PARKED',
    reason,
    domainReady: promoted
  };
}

/**
 * Section/object-level regeneration: discard the current authored content for one SIR
 * section and its Pair Coherence review as new superseding revisions, then reopen the
 * pair so a fresh cognitive attempt re-authors that section and re-runs the gates.
 * Canonical IDs/hashes/references stay code-owned; the model only re-authors content.
 */
export async function regenerateSection(input: {
  domain: DomainId;
  pairId: string;
  taskType: CognitiveTaskType;
}): Promise<{ domain: DomainId; pairId: string; taskType: CognitiveTaskType }> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  if (!modelRoutesConfigured()) {
    throw new Error('Model role routing is not configured. Regeneration stays fail-closed.');
  }
  if (input.taskType === 'PAIR_COHERENCE_REVIEW' || !isResolvable(input.taskType)) {
    throw new Error(`${input.taskType} is not a regenerable section.`);
  }
  const run = await getLatestDomainRun(input.domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${input.domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const pairRun = pairRuns.find((item) => item.pairId === input.pairId);
  if (!pairRun) throw new Error(`Pair ${input.pairId} is missing.`);
  const currentState = await reopenValidatedForRepair(pairRun.id, pairRun.state);
  const existing = await getLatestCompletedTaskArtifact(pairRun.id, input.taskType);
  if (!existing) {
    throw new Error(`${input.pairId} has no completed ${input.taskType} section to regenerate.`);
  }
  await failLatestCompletedTask(pairRun.id, input.taskType);
  const coherence = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  if (coherence) {
    await failLatestCompletedTask(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  }
  await reopenPairToAuthoring(pairRun.id, currentState);
  operatorLog('operator.section.regenerate', {
    domain: input.domain,
    pairId: input.pairId,
    taskType: input.taskType
  });
  return { domain: input.domain, pairId: input.pairId, taskType: input.taskType };
}

/**
 * "Rework with GenAI": trigger the existing bounded content-correction / LOCAL_REPAIR
 * loop for a defected pair. Deterministic validation remains the authority; this only
 * confirms the pair is eligible before the pipeline runs the repair and re-checks
 * Pair Coherence.
 */
export async function assertReworkWithGenAiAvailable(input: {
  domain: DomainId;
  pairId: string;
}): Promise<void> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  if (!modelRoutesConfigured()) {
    throw new Error('Model role routing is not configured. Rework with GenAI stays fail-closed.');
  }
  const run = await getLatestDomainRun(input.domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${input.domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const pairRun = pairRuns.find((item) => item.pairId === input.pairId);
  if (!pairRun) throw new Error(`Pair ${input.pairId} is missing.`);
  const artifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  const review = reviewFromUnknown(pairRun.pairId, artifact?.output);
  if (!review || blockingQcDefects(review).length === 0) {
    throw new Error(`${input.pairId} has no HIGH/BLOCKING pair-coherence defects for GenAI rework.`);
  }
  if (pairRun.state !== 'REPAIR_REQUIRED' && canTransition(pairTransitions, pairRun.state, 'REPAIR_REQUIRED')) {
    await updatePairState(pairRun.id, 'REPAIR_REQUIRED');
  }
}

const domainPipelinesInFlight = new Set<DomainId>();

export interface DomainPipelineStop {
  domain: DomainId;
  status: 'DOMAIN_READY' | 'BLOCKED' | 'FAILED' | 'ALREADY_RUNNING';
  completed: NextEligibleTask[];
  reason?: string;
}

export async function runDomainPipeline(domain: DomainId): Promise<DomainPipelineStop> {
  if (domainPipelinesInFlight.has(domain)) {
    operatorLog('operator.pipeline.already_running', { domain });
    return { domain, status: 'ALREADY_RUNNING', completed: [] };
  }
  const reclaimed = await failOrphanedStartedTasks(domain);
  if (reclaimed.length) {
    operatorLog('operator.pipeline.reclaimed_started', { domain, tasks: reclaimed });
  }
  domainPipelinesInFlight.add(domain);
  const completed: NextEligibleTask[] = [];
  operatorLog('operator.pipeline.started', { domain });
  try {
    while (true) {
      try {
        const result = await runNextEligibleTask(domain);
        completed.push(result.next);
        operatorLog('operator.pipeline.advanced', {
          domain,
          pairId: result.next.pairId,
          taskType: result.next.taskType,
          usedFallback: result.usedFallback,
          completedCount: completed.length
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = classifyDomainPipelineStop(message);
        operatorLog('operator.pipeline.stopped', {
          domain,
          status,
          reason: message,
          completedCount: completed.length
        });
        return { domain, status, completed, reason: message };
      }
    }
  } finally {
    domainPipelinesInFlight.delete(domain);
  }
}

export async function resumeOpenDomainPipelines(): Promise<{ reclaimed: number; resumed: DomainId[] }> {
  const reclaimed = await failOrphanedStartedTasks();
  if (reclaimed.length) {
    operatorLog('operator.pipeline.reclaimed_started', { tasks: reclaimed });
  }
  if (!operatorCommandsEnabled() || !modelRoutesConfigured()) {
    return { reclaimed: reclaimed.length, resumed: [] };
  }
  const resumed: DomainId[] = [];
  for (const domain of ['A', 'B', 'C', 'D', 'E', 'F'] as const) {
    const run = await getLatestDomainRun(domain);
    if (!run || !isOpenDomainState(run.state)) continue;
    const pairRuns = await getPairRuns(run.id);
    const taskRuns = await getTaskRunsForPairs(pairRuns.map((item) => item.id));
    const snapshots = await enrichPairSnapshots(
      pairSnapshots(expectedDomainPairIds(domain), pairRuns, taskRuns),
      pairRuns
    );
    const hostPairId = expectedDomainPairIds(domain)[0];
    const hostPair = pairRuns.find((item) => item.pairId === hostPairId);
    const domainArtifact = hostPair
      ? await getLatestTaskArtifactWithOutput<{ passed?: boolean }>(hostPair.id, 'DOMAIN_COHERENCE_REVIEW')
      : undefined;
    const parkedFindings = await getParkedFindings(run.id);
    const domainOutput = domainArtifact?.output;
    const parkedPairIds = new Set([
      ...deferredPairIdsOf(pairRuns),
      ...parkedFindings.map((item) => item.objectId)
    ]);
    const parkedCheckIds = new Set(parkedFindings.map((item) => item.checkId));
    const unparkedBlocking = countUnparkedBlockingDefects(
      domainDefectsFromOutput(domainOutput),
      parkedPairIds,
      { parkedCheckIds, domain }
    );
    if (
      await promoteDomainReadyWhenOnlyParkedRemain({
        domain,
        domainRunId: run.id,
        state: run.state,
        pairRuns,
        domainOutput,
        parkedObjectIds: parkedPairIds,
        parkedCheckIds
      })
    ) {
      continue;
    }
    const next = nextEligiblePairTask(
      domain,
      snapshots,
      readDomainCoherenceSnapshot(domain, pairRuns, taskRuns, domainReviewPassed(domainOutput)),
      parkedFindings.length,
      unparkedBlocking
    );
    if ('blocked' in next || next.taskType === 'DOMAIN_COHERENCE_REVIEW') continue;
    resumed.push(domain);
    operatorLog('operator.pipeline.resume', { domain, domainRunId: run.id });
    void runDomainPipeline(domain)
      .then((result) => {
        operatorLog('operator.pipeline.finished', {
          domain,
          status: result.status,
          completedCount: result.completed.length,
          reason: result.reason
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        operatorLog('operator.pipeline.failed', { domain, error: message });
      });
  }
  return { reclaimed: reclaimed.length, resumed };
}

