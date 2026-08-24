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

export const OPERATOR_SLICE = 'operator-home-v1' as const;
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
  status: 'PENDING';
}

export interface OperatorPairColumn {
  pairId: string;
  capabilityId: string;
  antipatternId: string;
  state: 'NOT_STARTED';
  tasks: OperatorTaskCell[];
}

export interface OperatorDomainCard {
  domain: DomainId;
  title: string;
  state: 'NOT_STARTED';
  pairIds: readonly string[];
  pairs: OperatorPairColumn[];
}

export interface OperatorCommand {
  enabled: false;
  reason: string;
}

export interface OperatorStatus {
  service: typeof OPERATOR_SERVICE;
  slice: typeof OPERATOR_SLICE;
  mode: 'READ_ONLY';
  health: OperatorHealth;
  pipeline: {
    pairTaskSequence: readonly CognitiveTaskType[];
    domainPairSlots: readonly number[];
    domainFlow: readonly DomainFlowStep[];
  };
  domains: OperatorDomainCard[];
  commands: {
    startDomainRun: OperatorCommand;
    runNextTask: OperatorCommand;
    recordApproval: OperatorCommand;
  };
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

const SLICE_REASON = 'Slice 1 is a read-only operator board. Commands stay closed until Slice 2.';

export function buildOperatorStatus(input: {
  database: { connected: boolean; schemaReady: boolean };
  domainTitles?: readonly DomainCoverageTitle[];
}): OperatorStatus {
  const titles = input.domainTitles ?? loadDomainCoverageTitles();
  const domains = titles.map((entry) => {
    const pairIds = expectedDomainPairIds(entry.domain);
    const capabilityIds = expectedDomainCapabilityIds(entry.domain);
    return {
      domain: entry.domain,
      title: entry.title,
      state: 'NOT_STARTED' as const,
      pairIds,
      pairs: pairIds.map((pairId, index) => {
        const capabilityId = capabilityIds[index];
        if (!capabilityId) throw new Error(`Missing capability id for ${pairId}.`);
        return {
          pairId,
          capabilityId,
          antipatternId: `AP-${capabilityId}`,
          state: 'NOT_STARTED' as const,
          tasks: PAIR_TASK_SEQUENCE.map((taskType) => ({ taskType, status: 'PENDING' as const }))
        };
      })
    };
  });

  return {
    service: OPERATOR_SERVICE,
    slice: OPERATOR_SLICE,
    mode: 'READ_ONLY',
    health: {
      live: 'ok',
      ready: input.database.connected && input.database.schemaReady ? 'ready' : 'not_ready',
      database: input.database
    },
    pipeline: {
      pairTaskSequence: PAIR_TASK_SEQUENCE,
      domainPairSlots: DOMAIN_PAIR_SLOTS,
      domainFlow: DOMAIN_FLOW
    },
    domains,
    commands: {
      startDomainRun: { enabled: false, reason: SLICE_REASON },
      runNextTask: { enabled: false, reason: SLICE_REASON },
      recordApproval: { enabled: false, reason: SLICE_REASON }
    }
  };
}
