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
}

export interface NextEligibleTask {
  domain: DomainId;
  pairId: string;
  taskType: CognitiveTaskType;
}

export function isOpenDomainState(state: DomainState): boolean {
  return OPEN_DOMAIN_STATES.includes(state);
}

function retryableFailedTask(
  domain: DomainId,
  pair: EligiblePairSnapshot
): NextEligibleTask | undefined {
  const failed = pair.tasks.find((task) => task.status === 'FAILED');
  if (!failed) return undefined;
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
  pairs: readonly EligiblePairSnapshot[]
): NextEligibleTask | { blocked: string } {
  for (const pair of pairs) {
    if (pair.state === 'NOT_STARTED' || pair.state === 'VALIDATED') continue;

    const retry = retryableFailedTask(domain, pair);
    if (retry) return retry;

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
  }

  const validated = pairs.filter((pair) => pair.state === 'VALIDATED').length;
  if (validated === pairs.length && pairs.length === 5) {
    return {
      blocked:
        'Five pairs are VALIDATED. DOMAIN_COHERENCE_REVIEW is the next unit and stays closed in Slice 2.'
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
  activeRun?: { state: DomainState; pairs: readonly EligiblePairSnapshot[] };
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
    const next = nextEligiblePairTask(input.domain, input.activeRun.pairs);
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
        reason: `Next eligible task is ${next.pairId} ${next.taskType}.`,
        next
      },
      recordApproval
    };
  }

  return {
    startDomainRun: {
      enabled: true,
      reason: `Start a domain ${input.domain} run from the sealed baseline.`
    },
    runNextTask: { enabled: false, reason: `No open domain ${input.domain} run.` },
    recordApproval
  };
}
