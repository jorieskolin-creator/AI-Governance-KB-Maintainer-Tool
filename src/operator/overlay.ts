import type { DomainId } from '../authoring/authoring-plan.js';
import { expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  getLatestDomainRun,
  getLatestTaskArtifactWithOutput,
  getOpenFindings,
  getParkedFindings,
  getPairRuns,
  getRecentModelCalls,
  getTaskRunsForPairs,
  type FindingRecord,
  type ModelCallRecord
} from '../orchestration/store.js';
import { blockingQcDefects, qcDefectsToFindings, reviewFromUnknown } from '../repair/qc-repair.js';
import { pairSnapshots } from './commands.js';
import { commandAvailability, type CommandFlag } from './eligibility.js';
import { modelRoutesConfigured, operatorCommandsEnabled } from './commands.js';
import type { EligiblePairSnapshot } from './eligibility.js';
import { dismissAvailability } from './dismiss.js';

export interface DomainRunOverlay {
  domain: DomainId;
  runId: string;
  state: string;
  baselineSha256: string;
  pairs: EligiblePairSnapshot[];
  findings: FindingRecord[];
  parkedFindings: FindingRecord[];
  modelCalls: ModelCallRecord[];
  commands: {
    startDomainRun: CommandFlag;
    runNextTask: CommandFlag;
    recordApproval: CommandFlag;
    dismissBlockers: CommandFlag;
  };
}

export async function loadDomainOverlay(
  domain: DomainId,
  databaseReady: boolean
): Promise<DomainRunOverlay | undefined> {
  if (!databaseReady) return undefined;
  const run = await getLatestDomainRun(domain);
  const closedDismiss: CommandFlag = { enabled: false, reason: 'No HIGH blockers to park.' };
  if (!run) {
    return {
      domain,
      runId: '',
      state: 'NOT_STARTED',
      baselineSha256: '',
      pairs: pairSnapshots(expectedDomainPairIds(domain), [], []),
      findings: [],
      parkedFindings: [],
      modelCalls: [],
      commands: {
        ...commandAvailability({
          databaseReady,
          commandsEnabled: operatorCommandsEnabled(),
          modelRoutesConfigured: modelRoutesConfigured(),
          domain
        }),
        dismissBlockers: closedDismiss
      }
    };
  }
  const pairRuns = await getPairRuns(run.id);
  const taskRuns = await getTaskRunsForPairs(pairRuns.map((item) => item.id));
  const pairs = pairSnapshots(expectedDomainPairIds(domain), pairRuns, taskRuns);
  const openFindings = await getOpenFindings(run.id);
  const parkedFindings = await getParkedFindings(run.id);
  const parkedKeys = new Set(parkedFindings.map((item) => `${item.objectId}|${item.checkId}`));
  const qcFindings: FindingRecord[] = [];
  for (const pairRun of pairRuns) {
    const artifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    const review = reviewFromUnknown(pairRun.pairId, artifact?.output);
    if (!review || review.passed === true || review.defects.length === 0) continue;
    for (const item of qcDefectsToFindings(pairRun.pairId, review)) {
      if (parkedKeys.has(`${item.objectId}|${item.checkId}`)) continue;
      qcFindings.push({
        id: `${pairRun.id}:${item.checkId}`,
        pairRunId: pairRun.id,
        checkId: item.checkId,
        severity: item.severity,
        objectId: item.objectId,
        objectPath: item.objectPath,
        issue: item.issue,
        resolved: false,
        createdAt: new Date()
      });
    }
  }
  const findings = [...qcFindings, ...openFindings];
  const modelCalls = await getRecentModelCalls(pairRuns.map((item) => item.id));
  const taskInFlight = taskRuns.some((task) => task.status === 'STARTED');
  let dismissBlockers = closedDismiss;
  for (const pairRun of pairRuns) {
    const pair = pairs.find((item) => item.pairId === pairRun.pairId);
    if (!pair) continue;
    const artifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    const review = reviewFromUnknown(pairRun.pairId, artifact?.output);
    const blocking = review ? blockingQcDefects(review).filter((defect) => !parkedKeys.has(`${pairRun.pairId}|${defect.defectId}`)).length : 0;
    const localRepairCompleted = taskRuns.some(
      (task) => task.pairRunId === pairRun.id && task.taskType === 'LOCAL_REPAIR' && task.status === 'COMPLETED'
    );
    const flag = dismissAvailability({
      blockingDefectCount: blocking,
      localRepairCompleted,
      pairState: pair.state,
      taskInFlight
    });
    if (flag.enabled) {
      dismissBlockers = {
        ...flag,
        next: { domain, pairId: pair.pairId, taskType: 'LOCAL_REPAIR' }
      };
      break;
    }
    if (dismissBlockers.enabled === false && flag.reason && blocking > 0) {
      dismissBlockers = flag;
    }
  }
  return {
    domain,
    runId: run.id,
    state: run.state,
    baselineSha256: run.baselineSha256,
    pairs,
    findings,
    parkedFindings,
    modelCalls,
    commands: {
      ...commandAvailability({
        databaseReady,
        commandsEnabled: operatorCommandsEnabled(),
        modelRoutesConfigured: modelRoutesConfigured(),
        domain,
        activeRun: { state: run.state, pairs }
      }),
      dismissBlockers
    }
  };
}