import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DomainId } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType } from '../domain/states.js';
import {
  DOMAIN_PAIR_SLOTS,
  expectedDomainCapabilityIds,
  expectedDomainPairIds,
  PAIR_TASK_SEQUENCE
} from '../orchestration/pipeline.js';
import type { CommandFlag } from './eligibility.js';
import type { OperatorTaskStatus } from './eligibility.js';
import type { DomainRunOverlay } from './overlay.js';

export const OPERATOR_SLICE = 'operator-run-v2' as const;
export const OPERATOR_SERVICE = 'ai-governance-kb-maintainer-tool' as const;

export const OPERATOR_DOMAINS: readonly DomainId[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export const DOMAIN_FLOW = [
  'SELECT_DOMAIN_BATCH',
  'FREEZE_AUTHORING_BASELINE',
  'PAIR_TASK_SEQUENCE',
  'DOMAIN_COHERENCE_REVIEW',
  'READY_FOR_APPROVAL',
  'EXTERNAL_HUMAN_APPROVAL',
  'CANONICAL_COMPILE',
  'STORE_VERSIONED_RELEASE'
] as const;

export type DomainFlowStep = (typeof DOMAIN_FLOW)[number];

export interface OperatorHealth {
  live: 'ok';
  ready: 'ready' | 'not_ready';
  database: { connected: boolean; schemaReady: boolean };
}

export interface OperatorTaskCell {
  taskType: CognitiveTaskType;
  status: OperatorTaskStatus;
  inputHash?: string;
  outputHash?: string;
}

export interface OperatorPairColumn {
  pairId: string;
  capabilityId: string;
  antipatternId: string;
  state: string;
  tasks: OperatorTaskCell[];
}

export interface OperatorDomainCard {
  domain: DomainId;
  title: string;
  state: string;
  runId?: string;
  baselineSha256?: string;
  pairIds: readonly string[];
  pairs: OperatorPairColumn[];
  commands: {
    startDomainRun: CommandFlag;
    runNextTask: CommandFlag;
    recordApproval: CommandFlag;
  };
}

export interface PipelineActivity {
  state: 'NOT_READY' | 'IDLE' | 'WAITING' | 'RUNNING' | 'BLOCKED';
  detail: string;
  domain?: DomainId;
  pairId?: string;
  taskType?: CognitiveTaskType;
}

export interface OperatorStatus {
  service: typeof OPERATOR_SERVICE;
  slice: typeof OPERATOR_SLICE;
  mode: 'READ_ONLY' | 'OPERATOR';
  health: OperatorHealth;
  pipelineActivity: PipelineActivity;
  pipeline: {
    pairTaskSequence: readonly CognitiveTaskType[];
    domainPairSlots: readonly number[];
    domainFlow: readonly DomainFlowStep[];
  };
  domains: OperatorDomainCard[];
  findings: Array<{ objectId: string; checkId: string; severity: string; issue: string }>;
  modelCalls: Array<{ role: string; provider: string; model: string; status: string; isFallback: boolean }>;
}

export interface DomainCoverageTitle {
  domain: DomainId;
  title: string;
}

function isDomainId(value: string): value is DomainId {
  return (OPERATOR_DOMAINS as readonly string[]).includes(value);
}

export function loadDomainCoverageTitles(
  sourceRegisterPath = resolve(process.cwd(), 'AI_Governance_Global_Source_Register_v1.5.0.json')
): readonly DomainCoverageTitle[] {
  const parsed = JSON.parse(readFileSync(sourceRegisterPath, 'utf8')) as {
    domain_coverage?: Array<{ domain?: unknown; title?: unknown }>;
  };
  const coverage = parsed.domain_coverage;
  if (!Array.isArray(coverage) || coverage.length !== OPERATOR_DOMAINS.length) {
    throw new Error('Source register must declare exactly six domain coverage titles.');
  }

  const titles = coverage.map((entry) => {
    if (typeof entry.domain !== 'string' || !isDomainId(entry.domain)) {
      throw new Error('Source register domain coverage contains an invalid domain id.');
    }
    if (typeof entry.title !== 'string' || entry.title.trim().length === 0) {
      throw new Error(`Source register is missing a title for domain ${entry.domain}.`);
    }
    return { domain: entry.domain, title: entry.title.trim() };
  });

  const ordered = OPERATOR_DOMAINS.map((domain) => {
    const match = titles.find((entry) => entry.domain === domain);
    if (!match) throw new Error(`Source register is missing domain ${domain}.`);
    return match;
  });

  return ordered;
}

export function taskLabel(taskType: CognitiveTaskType): string {
  return taskType
    .split('_')
    .map((part) => (part === 'AP' || part === 'SIR' ? part : `${part.charAt(0)}${part.slice(1).toLowerCase()}`))
    .join(' ');
}

export function flowLabel(step: DomainFlowStep): string {
  if (step === 'PAIR_TASK_SEQUENCE') return `${String(PAIR_TASK_SEQUENCE.length)} pair SIR tasks`;
  return step
    .split('_')
    .map((part) => `${part.charAt(0)}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

export function workOrderLabel(state: string, runId?: string): string {
  if (!runId) return 'NONE';
  if (state === 'IN_PROGRESS' || state === 'DOMAIN_VALIDATING' || state === 'REPAIR_REQUIRED') return 'OPEN';
  return state.replaceAll('_', ' ');
}

export function taskDisplayStatus(status: string): string {
  return status === 'STARTED' ? 'IN_PROGRESS' : status;
}

export function derivePipelineActivity(domains: OperatorDomainCard[]): PipelineActivity {
  for (const card of domains) {
    for (const pair of card.pairs) {
      const started = pair.tasks.find((task) => task.status === 'STARTED');
      if (started) {
        return {
          state: 'RUNNING',
          detail: `IN_PROGRESS ${pair.pairId} ${started.taskType}`,
          domain: card.domain,
          pairId: pair.pairId,
          taskType: started.taskType
        };
      }
    }
  }
  for (const card of domains) {
    for (const pair of card.pairs) {
      const failed = pair.tasks.find((task) => task.status === 'FAILED');
      if (failed) {
        return {
          state: 'BLOCKED',
          detail: `${pair.pairId} ${failed.taskType} FAILED · retry same task · no document produced`,
          domain: card.domain,
          pairId: pair.pairId,
          taskType: failed.taskType
        };
      }
    }
  }
  const open = domains.find((card) => card.runId);
  if (open) {
    return {
      state: 'WAITING',
      detail: `Work order OPEN for domain ${open.domain}; nothing is IN_PROGRESS`,
      domain: open.domain
    };
  }
  return { state: 'IDLE', detail: 'No work order is open' };
}

const CLOSED: CommandFlag = {
  enabled: false,
  reason: 'Database is not ready.'
};

const APPROVAL_CLOSED: CommandFlag = {
  enabled: false,
  reason: 'External approval intake stays closed. APPROVED is not granted in this UI.'
};

export function buildOperatorStatus(input: {
  database: { connected: boolean; schemaReady: boolean };
  domainTitles?: readonly DomainCoverageTitle[];
  overlays?: readonly DomainRunOverlay[];
}): OperatorStatus {
  const titles = input.domainTitles ?? loadDomainCoverageTitles();
  const dbReady = input.database.connected && input.database.schemaReady;
  const findings: OperatorStatus['findings'] = [];
  const modelCalls: OperatorStatus['modelCalls'] = [];

  const domains = titles.map((entry) => {
    const overlay = input.overlays?.find((item) => item.domain === entry.domain);
    const pairIds = expectedDomainPairIds(entry.domain);
    const capabilityIds = expectedDomainCapabilityIds(entry.domain);
    if (overlay?.findings.length) {
      findings.push(
        ...overlay.findings.map((item) => ({
          objectId: item.objectId,
          checkId: item.checkId,
          severity: item.severity,
          issue: item.issue
        }))
      );
    }
    if (overlay?.modelCalls.length) {
      modelCalls.push(
        ...overlay.modelCalls.map((item) => ({
          role: item.role,
          provider: item.provider,
          model: item.model,
          status: item.status,
          isFallback: item.isFallback
        }))
      );
    }
    return {
      domain: entry.domain,
      title: entry.title,
      state: overlay?.state ?? 'NOT_STARTED',
      runId: overlay?.runId || undefined,
      baselineSha256: overlay?.baselineSha256 || undefined,
      pairIds,
      pairs: pairIds.map((pairId, index) => {
        const capabilityId = capabilityIds[index];
        if (!capabilityId) throw new Error(`Missing capability id for ${pairId}.`);
        const live = overlay?.pairs.find((pair) => pair.pairId === pairId);
        return {
          pairId,
          capabilityId,
          antipatternId: `AP-${capabilityId}`,
          state: live?.state ?? 'NOT_STARTED',
          tasks: PAIR_TASK_SEQUENCE.map((taskType) => {
            const cell = live?.tasks.find((task) => task.taskType === taskType);
            return { taskType, status: cell?.status ?? 'PENDING' };
          })
        };
      }),
      commands: overlay?.commands ?? {
        startDomainRun: CLOSED,
        runNextTask: CLOSED,
        recordApproval: APPROVAL_CLOSED
      }
    };
  });

  return {
    service: OPERATOR_SERVICE,
    slice: OPERATOR_SLICE,
    mode: dbReady ? 'OPERATOR' : 'READ_ONLY',
    health: {
      live: 'ok',
      ready: dbReady ? 'ready' : 'not_ready',
      database: input.database
    },
    pipelineActivity: dbReady ? derivePipelineActivity(domains) : { state: 'NOT_READY', detail: 'Database is not ready' },
    pipeline: {
      pairTaskSequence: PAIR_TASK_SEQUENCE,
      domainPairSlots: DOMAIN_PAIR_SLOTS,
      domainFlow: DOMAIN_FLOW
    },
    domains,
    findings,
    modelCalls
  };
}
