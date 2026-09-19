import type { DomainId } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType, DomainState, PairState } from '../domain/states.js';
import { PAIR_TASK_SEQUENCE, expectedDomainPairIds } from '../orchestration/pipeline.js';

const OPEN_DOMAIN_STATES: readonly DomainState[] = [
  'IN_PROGRESS',
  'DOMAIN_VALIDATING',
  'REPAIR_REQUIRED',
  'READY_FOR_APPROVAL'
];

export type OperatorTaskStatus = 'PENDING' | 'STARTED' | 'COMPLETED' | 'FAILED';

export interface EligiblePairSnapshot {
  pairId: string;
  state: PairState | 'NOT_STARTED';
  tasks: Array<{ taskType: CognitiveTaskType; status: OperatorTaskStatus }>;
  pairCoherencePassed?: boolean;
}

export interface DomainCoherenceSnapshot {
  status: OperatorTaskStatus;
  passed?: boolean;
}

export interface NextEligibleTask {
  domain: DomainId;
  pairId: string;
  taskType: CognitiveTaskType;
}

export function classifyDomainPipelineStop(
  errorMessage: string
): 'DOMAIN_READY' | 'BLOCKED' | 'FAILED' {
  if (
    errorMessage.includes('READY_FOR_APPROVAL') ||
    errorMessage.includes('Publication stays a separate operation') ||
    errorMessage.includes('compile stays closed until external APPROVED')
  ) {
    return 'DOMAIN_READY';
  }
  if (
    errorMessage.includes('Five pairs are VALIDATED') &&
    errorMessage.includes('stays closed')
  ) {
    return 'DOMAIN_READY';
  }
  if (errorMessage.includes('parked for later') || errorMessage.includes('remain unresolved')) {
    return 'DOMAIN_READY';
  }
  if (
    errorMessage.includes('already running') ||
    errorMessage.includes('No eligible SIR task') ||
    errorMessage.includes('requires local repair') ||
    errorMessage.includes('QC defects are listed') ||
    errorMessage.includes('HIGH defects listed') ||
    errorMessage.includes('not an operator-admitted') ||
    errorMessage.includes('requires completed PAIR_COHERENCE_REVIEW') ||
    errorMessage.includes('Pair Coherence did not pass') ||
    errorMessage.includes('Review remaining HIGH blockers')
  ) {
    return 'BLOCKED';
  }
  return 'FAILED';
}

export function shouldReclaimStartedTask(pipelineInFlight: boolean): boolean {
  return !pipelineInFlight;
}

export function isOpenDomainState(state: DomainState): boolean {
  return OPEN_DOMAIN_STATES.includes(state);
}

function authoringTasksCompleted(pair: EligiblePairSnapshot): boolean {
  return PAIR_TASK_SEQUENCE.every((taskType) => {
    if (taskType === 'PAIR_COHERENCE_REVIEW') return true;
    const cell = pair.tasks.find((task) => task.taskType === taskType);
    return cell?.status === 'COMPLETED';
  });
}

function retryableFailedTask(
  domain: DomainId,
  pair: EligiblePairSnapshot
): NextEligibleTask | undefined {
  const failed = pair.tasks.find((task) => task.status === 'FAILED');
  if (!failed) return undefined;
  const pairCoherence = pair.tasks.find((task) => task.taskType === 'PAIR_COHERENCE_REVIEW');
  if (
    failed.taskType === 'PAIR_COHERENCE_REVIEW' &&
    authoringTasksCompleted(pair) &&
    pairCoherence?.status === 'COMPLETED'
  ) {
    return undefined;
  }
  const failedIndex = PAIR_TASK_SEQUENCE.indexOf(failed.taskType);
  if (failedIndex < 0) return undefined;
  const skipped = PAIR_TASK_SEQUENCE.slice(0, failedIndex).some((taskType) => {
    const cell = pair.tasks.find((task) => task.taskType === taskType);
    return cell?.status !== 'COMPLETED';
  });
  if (skipped) return undefined;
  return { domain, pairId: pair.pairId, taskType: failed.taskType };
}

export function unresolvedParkedDomainBlock(openParkedCount: number): string | undefined {
  if (openParkedCount <= 0) return undefined;
  return `${String(openParkedCount)} parked item(s) remain unresolved. They do not block Continue or READY_FOR_APPROVAL.`;
}

const DOMAIN_PAIR_PATH = /pairs\[([A-F][1-5]_AP-[A-F][1-5])\]/g;

export interface DomainDefectPairRef {
  pairId?: string;
  defectId?: string;
  affectedPairIds?: readonly string[];
  recommendedRepairPairIds?: readonly string[];
  affectedPaths?: readonly string[];
  recommendedRepairPaths?: readonly string[];
  domainPath?: string;
}

function addPairId(ids: Set<string>, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) ids.add(trimmed);
}

function pairIdsInPath(path: string | undefined, ids: Set<string>): void {
  if (!path) return;
  DOMAIN_PAIR_PATH.lastIndex = 0;
  for (const match of path.matchAll(DOMAIN_PAIR_PATH)) {
    if (match[1]) ids.add(match[1]);
  }
}

export function pairIdsFromDomainDefect(defect: DomainDefectPairRef): string[] {
  const ids = new Set<string>();
  addPairId(ids, defect.pairId);
  for (const id of defect.affectedPairIds ?? []) addPairId(ids, id);
  for (const id of defect.recommendedRepairPairIds ?? []) addPairId(ids, id);
  pairIdsInPath(defect.domainPath, ids);
  for (const path of defect.affectedPaths ?? []) pairIdsInPath(path, ids);
  for (const path of defect.recommendedRepairPaths ?? []) pairIdsInPath(path, ids);
  return [...ids];
}

export function pairIdFromDomainDefect(defect: DomainDefectPairRef): string {
  const path =
    defect.domainPath ?? defect.recommendedRepairPaths?.[0] ?? defect.affectedPaths?.[0] ?? '';
  DOMAIN_PAIR_PATH.lastIndex = 0;
  const fromPath = DOMAIN_PAIR_PATH.exec(path)?.[1];
  if (fromPath) return fromPath;
  if (typeof defect.pairId === 'string' && defect.pairId.trim()) return defect.pairId.trim();
  return defect.affectedPairIds?.[0] ?? defect.recommendedRepairPairIds?.[0] ?? '';
}

export function countUnparkedBlockingDefects(
  defects: ReadonlyArray<DomainDefectPairRef & { severity?: string }>,
  parkedPairIds: ReadonlySet<string>,
  extras?: { parkedCheckIds?: ReadonlySet<string>; domain?: DomainId }
): number {
  const domainPairsParked =
    extras?.domain !== undefined &&
    expectedDomainPairIds(extras.domain).every((id) => parkedPairIds.has(id));
  return defects.filter((item) => {
    if (item.severity !== 'HIGH' && item.severity !== 'BLOCKING') return false;
    const checkId = item.defectId?.trim();
    if (checkId && extras?.parkedCheckIds?.has(checkId)) return false;
    const displayPairId = pairIdFromDomainDefect(item);
    if (displayPairId && parkedPairIds.has(displayPairId)) return false;
    const pairIds = pairIdsFromDomainDefect(item);
    if (pairIds.some((id) => parkedPairIds.has(id))) return false;
    if (pairIds.length === 0 && domainPairsParked) return false;
    return true;
  }).length;
}

export function unresolvedParkedApprovalBlock(openParkedCount: number): string | undefined {
  if (openParkedCount <= 0) return undefined;
  return `${String(openParkedCount)} parked item(s) remain unresolved. Approval stays fail-closed.`;
}

export function reviewSaveMayValidatePair(namedGatesAllow: boolean, openParkedForPair: number): boolean {
  return namedGatesAllow && openParkedForPair <= 0;
}

export function nextEligiblePairTask(
  domain: DomainId,
  pairs: readonly EligiblePairSnapshot[],
  domainCoherence?: DomainCoherenceSnapshot,
  openParkedCount = 0,
  unparkedBlockingDomainDefects?: number
): NextEligibleTask | { blocked: string } {
  for (const pair of pairs) {
    if (pair.state === 'NOT_STARTED' || pair.state === 'VALIDATED' || pair.state === 'DEFERRED') continue;

    const retry = retryableFailedTask(domain, pair);
    if (retry) return retry;

    const pairCoherence = pair.tasks.find((task) => task.taskType === 'PAIR_COHERENCE_REVIEW');
    if (authoringTasksCompleted(pair) && pairCoherence?.status === 'COMPLETED' && pair.state === 'REPAIR_REQUIRED') {
      return { domain, pairId: pair.pairId, taskType: 'LOCAL_REPAIR' };
    }

    if (pair.state === 'REPAIR_REQUIRED') {
      return {
        blocked: `${pair.pairId} requires local repair before another SIR task can run.`
      };
    }

    const started = pair.tasks.find((task) => task.status === 'STARTED');
    if (started) {
      return {
        blocked: `${pair.pairId} ${started.taskType} is already running.`
      };
    }

    for (const taskType of PAIR_TASK_SEQUENCE) {
      const cell = pair.tasks.find((task) => task.taskType === taskType);
      if (!cell || cell.status === 'PENDING') {
        return { domain, pairId: pair.pairId, taskType };
      }
      if (cell.status !== 'COMPLETED') {
        return { blocked: `${pair.pairId} ${taskType} is ${cell.status}.` };
      }
    }

    return { domain, pairId: pair.pairId, taskType: 'PAIR_COHERENCE_REVIEW' };
  }

  const validated = pairs.filter((pair) => pair.state === 'VALIDATED').length;
  const deferred = pairs.filter((pair) => pair.state === 'DEFERRED').length;
  void openParkedCount;
  if (validated + deferred === pairs.length && pairs.length === 5) {
    const unpaid = pairs.filter(
      (pair) => pair.state !== 'DEFERRED' && pair.pairCoherencePassed !== true
    );
    if (unpaid.length > 0) {
      const pairId = unpaid[0]?.pairId ?? `domain ${domain}`;
      return {
        blocked: `${pairId} Pair Coherence did not pass. Review remaining HIGH blockers, edit or delete, then Save. DOMAIN_COHERENCE stays closed.`
      };
    }
    const hostPairId = pairs[0]?.pairId;
    if (!hostPairId) {
      return { blocked: `No eligible SIR task in domain ${domain}.` };
    }
    if (!domainCoherence || domainCoherence.status === 'PENDING') {
      return { domain, pairId: hostPairId, taskType: 'DOMAIN_COHERENCE_REVIEW' };
    }
    if (domainCoherence.status === 'STARTED') {
      return { blocked: `Domain ${domain} DOMAIN_COHERENCE_REVIEW is already running.` };
    }
    if (domainCoherence.status === 'FAILED') {
      return { domain, pairId: hostPairId, taskType: 'DOMAIN_COHERENCE_REVIEW' };
    }
    if (domainCoherence.passed === true) {
      return {
        blocked: `Domain ${domain} DOMAIN_COHERENCE_REVIEW passed. READY_FOR_APPROVAL. Record operator approval against the hash-bound bundle. Publication stays a separate operation.`
      };
    }
    const remaining =
      unparkedBlockingDomainDefects ?? (deferred > 0 ? 0 : Number.POSITIVE_INFINITY);
    if (remaining === 0) {
      return { domain, pairId: hostPairId, taskType: 'DOMAIN_COHERENCE_REVIEW' };
    }
    return {
      blocked: `Domain ${domain} DOMAIN_COHERENCE_REVIEW has HIGH defects listed. Domain stays REPAIR_REQUIRED.`
    };
  }

  return { blocked: `No eligible SIR task in domain ${domain}.` };
}

export function assertSequentialAdmission(
  requested: CognitiveTaskType,
  eligible: NextEligibleTask
): void {
  if (requested !== eligible.taskType || eligible.pairId === '') {
    throw new Error('Operator commands cannot select an arbitrary SIR task.');
  }
}

export interface CommandFlag {
  enabled: boolean;
  reason: string;
  next?: NextEligibleTask;
}

export function commandAvailability(input: {
  databaseReady: boolean;
  commandsEnabled: boolean;
  modelRoutesConfigured: boolean;
  domain: DomainId;
  activeRun?: {
    state: DomainState;
    pairs: readonly EligiblePairSnapshot[];
    domainCoherence?: DomainCoherenceSnapshot;
    openParkedCount?: number;
    unparkedBlockingDomainDefects?: number;
  };
}): {
  startDomainRun: CommandFlag;
  runNextTask: CommandFlag;
  recordApproval: CommandFlag;
} {
  let recordApproval: CommandFlag = {
    enabled: false,
    reason: 'Approval is available only after a current READY_FOR_APPROVAL bundle is assembled.'
  };

  if (!input.databaseReady) {
    return {
      startDomainRun: { enabled: false, reason: 'Database is not ready.' },
      runNextTask: { enabled: false, reason: 'Database is not ready.' },
      recordApproval
    };
  }

  if (!input.commandsEnabled) {
    const reason = 'Operator commands are disabled on this deployment.';
    return {
      startDomainRun: { enabled: false, reason },
      runNextTask: { enabled: false, reason },
      recordApproval
    };
  }

  if (input.activeRun?.state === 'READY_FOR_APPROVAL') {
    const parkedApproval = unresolvedParkedApprovalBlock(input.activeRun.openParkedCount ?? 0);
    recordApproval = parkedApproval
      ? { enabled: false, reason: parkedApproval }
      : {
          enabled: true,
          reason:
            'Record standalone operator approval against the exact current candidate, approval-bundle, and proposed-manifest hashes. Publication remains a separate operation.'
        };
    const parkedReady =
      (input.activeRun.openParkedCount ?? 0) > 0 || input.activeRun.domainCoherence?.passed !== true;
    return {
      startDomainRun: {
        enabled: false,
        reason: `Domain ${input.domain} already has an open run.`
      },
      runNextTask: {
        enabled: false,
        reason: parkedReady
          ? `Domain ${input.domain} remaining HIGH defects are parked. READY_FOR_APPROVAL. Record operator approval against the hash-bound bundle. Publication stays a separate operation.`
          : `Domain ${input.domain} DOMAIN_COHERENCE_REVIEW passed. READY_FOR_APPROVAL. Record operator approval against the hash-bound bundle. Publication stays a separate operation.`
      },
      recordApproval
    };
  }

  if (input.activeRun && isOpenDomainState(input.activeRun.state)) {
    const next = nextEligiblePairTask(
      input.domain,
      input.activeRun.pairs,
      input.activeRun.domainCoherence,
      input.activeRun.openParkedCount ?? 0,
      input.activeRun.unparkedBlockingDomainDefects
    );
    if ('blocked' in next) {
      return {
        startDomainRun: {
          enabled: false,
          reason: `Domain ${input.domain} already has an open run.`
        },
        runNextTask: { enabled: false, reason: next.blocked },
        recordApproval
      };
    }
    if (!input.modelRoutesConfigured) {
      return {
        startDomainRun: {
          enabled: false,
          reason: `Domain ${input.domain} already has an open run.`
        },
        runNextTask: {
          enabled: false,
          reason: 'Model role routing is not configured. Next-task stays fail-closed.',
          next
        },
        recordApproval
      };
    }
    return {
      startDomainRun: {
        enabled: false,
        reason: `Domain ${input.domain} already has an open run.`
      },
      runNextTask: {
        enabled: true,
        reason:
          next.taskType === 'LOCAL_REPAIR'
            ? `Repair recommended QC paths on ${next.pairId}, then re-check pair coherence. Per-task approval is not requested.`
            : next.taskType === 'DOMAIN_COHERENCE_REVIEW'
              ? `Run DOMAIN_COHERENCE_REVIEW for domain ${input.domain}. Stops after that review. Approval and compile stay closed.`
              : `Continue domain ${input.domain} from ${next.pairId} ${next.taskType} until five pairs are VALIDATED. Per-task approval is not requested.`,
        next
      },
      recordApproval
    };
  }

  return {
    startDomainRun: {
      enabled: true,
      reason: `Start a domain ${input.domain} run from the sealed baseline. Pair SIR tasks then run until the domain is ready.`
    },
    runNextTask: { enabled: false, reason: `No open domain ${input.domain} run.` },
    recordApproval
  };
}
