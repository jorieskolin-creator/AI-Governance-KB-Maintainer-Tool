import type { DomainId } from '../authoring/authoring-plan.js';
import { getModelRoute } from '../ai/model-router.js';
import { loadRepoBaselineArtifacts } from '../baseline/repo-artifacts.js';
import { sealBaselineSnapshot, type BaselineSnapshot } from '../baseline/snapshot.js';
import type { CognitiveTaskType, PairState } from '../domain/states.js';
import {
  canTransition,
  expectedDomainPairIds,
  PAIR_TASK_SEQUENCE,
  pairTransitions
} from '../orchestration/pipeline.js';
import { resolveSirTaskContract, type ResolvableSirTaskType } from '../orchestration/sir-contract-resolver.js';
import {
  buildSourceContextPacket,
  type AuthoringSourceRegisterRecord
} from '../orchestration/source-context-packet.js';
import {
  createDomainRun,
  createPairRun,
  getBaselineSnapshotById,
  getCompletedTaskTypes,
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getPairRuns,
  getTaskRunsForPairs,
  updatePairState,
  failOrphanedStartedTasks,
  type PairRunRecord
} from '../orchestration/store.js';
import { runCognitiveTask } from '../orchestration/task-runner.js';
import { loadCategoriesBaseline } from '../baseline/categories.js';
import {
  buildPairAuthoringPlan,
  categoryBaselineRecord,
  goldenReferenceRecord
} from './authoring-context.js';
import {
  isOpenDomainState,
  nextEligiblePairTask,
  classifyDomainPipelineStop,
  type EligiblePairSnapshot,
  type NextEligibleTask
} from './eligibility.js';
import type { OperatorTaskStatus } from './eligibility.js';
import { operatorLog } from './log.js';
import { runPairQcRepair } from './qc-repair-command.js';

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
  return taskType !== 'DOMAIN_COHERENCE_REVIEW' && taskType !== 'LOCAL_REPAIR';
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
  }
  return { domainRunId, baselineSha256: snapshot.sha256 };
}

function sourceRecordsForPlan(plan: ReturnType<typeof buildPairAuthoringPlan>): AuthoringSourceRegisterRecord[] {
  const artifacts = loadRepoBaselineArtifacts();
  const register = artifacts.find((item) => item.artifactType === 'SOURCE_REGISTER')?.content as {
    sources: Array<{
      id: string;
      version_or_date: string;
      verification_status: string;
      last_verified_date: string;
      effective_status: string;
      authority_tier: string;
      authority_type: string;
      official_location: string;
      roles_or_applicability_conditions?: string[];
      licensing_storage_boundary: string;
      domain_coverage: string[];
    }>;
  };
  return plan.sourceUniverse.map((allowed) => {
    const source = register.sources.find((item) => item.id === allowed.sourceId);
    if (!source) throw new Error(`Source ${allowed.sourceId} is missing from the sealed register.`);
    return {
      sourceId: source.id,
      versionOrDate: source.version_or_date,
      verificationStatus: 'VERIFIED' as const,
      lastVerifiedDate: source.last_verified_date,
      effectiveStatus: source.effective_status === 'IN_FORCE' ? 'IN_FORCE' : 'PUBLISHED',
      authorityTier: source.authority_tier,
      authorityType: source.authority_type,
      officialLocation: source.official_location,
      applicabilityBoundary: (source.roles_or_applicability_conditions ?? ['Registered applicability boundary.']).join(' '),
      licensingBoundary: source.licensing_storage_boundary,
      domainCoverage: source.domain_coverage,
      modelContextPolicy: 'METADATA_LOCATOR_ONLY' as const,
      usageRightsReference: null
    };
  });
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

function isProviderRouteFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes('failed primary and fallback routes');
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
  const snapshots = pairSnapshots(expectedDomainPairIds(domain), pairRuns, taskRuns);
  const eligible = nextEligiblePairTask(domain, snapshots);
  if ('blocked' in eligible) throw new Error(eligible.blocked);
  let next: NextEligibleTask = eligible;
  const pairRun = pairRuns.find((item) => item.pairId === next.pairId);
  if (!pairRun) throw new Error(`Pair run ${next.pairId} is missing.`);

  if (next.taskType === 'LOCAL_REPAIR') {
    operatorLog('operator.task.admitted', { domain, pairId: next.pairId, taskType: next.taskType, domainRunId: run.id });
    const pairState = await reopenForRetry(pairRun.id, pairRun.state);
    try {
      await runPairQcRepair({
        pairRunId: pairRun.id,
        pairId: next.pairId,
        domainRunId: run.id
      });
      next = { domain, pairId: next.pairId, taskType: 'PAIR_COHERENCE_REVIEW' };
    } catch (error) {
      if (!isProviderRouteFailure(error)) {
        await markRepairRequired(pairRun.id, pairState);
      }
      throw error;
    }
  }

  if (!isResolvable(next.taskType)) {
    throw new Error(`${next.taskType} is not an operator-admitted pair task.`);
  }
  const sealed = await getBaselineSnapshotById(run.baselineSnapshotId);
  if (!sealed) throw new Error('Sealed baseline snapshot is missing.');
  const snapshot: BaselineSnapshot = {
    id: sealed.id,
    sha256: sealed.sha256,
    manifest: sealed.manifest as BaselineSnapshot['manifest']
  };
  const plan = buildPairAuthoringPlan({ domain, pairId: next.pairId, snapshot });
  const sourceContextPacket =
    next.taskType === 'SOURCE_MAPPING'
      ? buildSourceContextPacket({
          authoringPlan: plan,
          sealedSourceRegisterVersion: plan.baseline.sourceRegisterVersion,
          sealedSourceRegisterSha256: plan.baseline.sourceRegisterSha256,
          registerRecords: sourceRecordsForPlan(plan),
          locatorContexts: []
        })
      : undefined;

  const contract = await resolveSirTaskContract({
    pairRunId: pairRun.id,
    taskType: next.taskType,
    authoringPlan: plan,
    categoryBaseline: categoryBaselineRecord(domain),
    goldenReference: goldenReferenceRecord(),
    sourceContextPacket
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

