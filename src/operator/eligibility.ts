import type { DomainId } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType, DomainState, PairState } from '../domain/states.js';
import { PAIR_TASK_SEQUENCE } from '../orchestration/pipeline.js';

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
  if (errorMessage.includes('parked for later')) {
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

export function nextEligiblePairTask(
  domain: DomainId,
  pairs: readonly EligiblePairSnapshot[],
  domainCoherence?: DomainCoherenceSnapshot
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
  if (validated + deferred === pairs.length && pairs.length === 5) {
    if (deferred > 0) {
      return {
        blocked: `${String(deferred)} pair(s) have HIGH blockers parked for later review. DOMAIN_COHERENCE stays closed.`
      };
    }
    const unpaid = pairs.filter((pair) => pair.pairCoherencePassed !== true);
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
        blocked: `Domain ${domain} DOMAIN_COHERENCE_REVIEW passed. READY_FOR_APPROVAL. Canonical compile stays closed until external APPROVED.`
      };
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
  };
}): {
  startDomainRun: CommandFlag;
  runNextTask: CommandFlag;
  recordApproval: CommandFlag;
} {
  const recordApproval: CommandFlag = {
    enabled: false,
    reason: 'External approval intake stays closed. APPROVED is not granted in this UI.'
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

  if (input.activeRun && isOpenDomainState(input.activeRun.state)) {
    const next = nextEligiblePairTask(input.domain, input.activeRun.pairs, input.activeRun.domainCoherence);
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
