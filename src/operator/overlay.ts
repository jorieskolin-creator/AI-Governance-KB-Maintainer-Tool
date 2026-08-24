import type { DomainId } from '../authoring/authoring-plan.js';
import { expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  getLatestDomainRun,
  getOpenFindings,
  getPairRuns,
  getRecentModelCalls,
  getTaskRunsForPairs,
  type FindingRecord,
  type ModelCallRecord
} from '../orchestration/store.js';
import { pairSnapshots } from './commands.js';
import { commandAvailability, type CommandFlag } from './eligibility.js';
import { modelRoutesConfigured, operatorCommandsEnabled } from './commands.js';
import type { EligiblePairSnapshot } from './eligibility.js';

export interface DomainRunOverlay {
  domain: DomainId;
  runId: string;
  state: string;
  baselineSha256: string;
  pairs: EligiblePairSnapshot[];
  findings: FindingRecord[];
  modelCalls: ModelCallRecord[];
  commands: {
    startDomainRun: CommandFlag;
    runNextTask: CommandFlag;
    recordApproval: CommandFlag;
  };
}

export async function loadDomainOverlay(
  domain: DomainId,
  databaseReady: boolean
): Promise<DomainRunOverlay | undefined> {
  if (!databaseReady) return undefined;
  const run = await getLatestDomainRun(domain);
  if (!run) {
    return {
      domain,
      runId: '',
      state: 'NOT_STARTED',
      baselineSha256: '',
      pairs: pairSnapshots(expectedDomainPairIds(domain), [], []),
      findings: [],
      modelCalls: [],
      commands: commandAvailability({
        databaseReady,
        commandsEnabled: operatorCommandsEnabled(),
        modelRoutesConfigured: modelRoutesConfigured(),
        domain
      })
    };
  }
  const pairRuns = await getPairRuns(run.id);
  const taskRuns = await getTaskRunsForPairs(pairRuns.map((item) => item.id));
  const pairs = pairSnapshots(expectedDomainPairIds(domain), pairRuns, taskRuns);
  const findings = await getOpenFindings(run.id);
  const modelCalls = await getRecentModelCalls(pairRuns.map((item) => item.id));
  return {
    domain,
    runId: run.id,
    state: run.state,
    baselineSha256: run.baselineSha256,
    pairs,
    findings,
    modelCalls,
    commands: commandAvailability({
      databaseReady,
      commandsEnabled: operatorCommandsEnabled(),
      modelRoutesConfigured: modelRoutesConfigured(),
      domain,
      activeRun: { state: run.state, pairs }
    })
  };
}
