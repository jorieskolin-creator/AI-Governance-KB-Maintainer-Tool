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
  latestDomainCandidateRevisionId,
  latestPairCandidateRevisionId,
  loadFindingDispositions,
  type FindingRecord,
  type ModelCallRecord
} from '../orchestration/store.js';
import { qcDefectsToFindings, reviewFromUnknown } from '../repair/qc-repair.js';
import { blockingOpenDefects, openDefects } from '../repair/finding-dispositions.js';
import { pairSnapshots, readDomainCoherenceSnapshot, enrichPairSnapshots } from './commands.js';
import { commandAvailability, type CommandFlag } from './eligibility.js';
import { modelRoutesConfigured, operatorCommandsEnabled } from './commands.js';
import type { EligiblePairSnapshot } from './eligibility.js';
import { dismissAvailability } from './dismiss.js';

function domainReviewPassed(output: unknown): boolean | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const passed = (output as { passed?: unknown }).passed;
  return typeof passed === 'boolean' ? passed : undefined;
}

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
  documents: {
    available: boolean;
    indexHref: string;
    bundleHref: string;
    approvalHref: string;
    approvalAvailable: boolean;
  };
  review: {
    available: boolean;
    href: string;
    pairId: string;
    kind: 'PAIR' | 'DOMAIN' | '';
    reason: string;
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
      },
      documents: {
        available: false,
        indexHref: `/documents/${domain}`,
        bundleHref: `/api/operator/documents/${domain}`,
        approvalHref: `/approval/${domain}`,
        approvalAvailable: false
      },
      review: {
        available: false,
        href: '',
        pairId: '',
        kind: '',
        reason: 'No remaining HIGH blockers to review.'
      }
    };
  }
  const pairRuns = await getPairRuns(run.id);
  const taskRuns = await getTaskRunsForPairs(pairRuns.map((item) => item.id));
  const pairs = await enrichPairSnapshots(
    pairSnapshots(expectedDomainPairIds(domain), pairRuns, taskRuns),
    pairRuns
  );
  const openFindings = await getOpenFindings(run.id);
  const parkedFindings = await getParkedFindings(run.id);
  const parkedKeys = new Set(parkedFindings.map((item) => `${item.objectId}|${item.checkId}`));
  const qcFindings: FindingRecord[] = [];
  for (const pairRun of pairRuns) {
    const artifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    const review = reviewFromUnknown(pairRun.pairId, artifact?.output);
    if (!review || review.passed === true || review.defects.length === 0) continue;
    const candidateId = await latestPairCandidateRevisionId(pairRun.id);
    const dispositions = candidateId ? await loadFindingDispositions(candidateId, 'PAIR') : [];
    const openReview = { ...review, defects: openDefects(review.defects, dispositions) };
    if (openReview.defects.length === 0) continue;
    for (const item of qcDefectsToFindings(pairRun.pairId, openReview)) {
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
  const hostPairId = expectedDomainPairIds(domain)[0];
  const hostPair = pairRuns.find((item) => item.pairId === hostPairId);
  const domainArtifact = hostPair
    ? await getLatestTaskArtifactWithOutput<{
        passed?: boolean;
        defects?: Array<{
          defectId?: string;
          severity?: string;
          issue?: string;
          affectedPaths?: string[];
          affectedPairIds?: string[];
        }>;
      }>(hostPair.id, 'DOMAIN_COHERENCE_REVIEW')
    : undefined;
  const domainPassed = domainReviewPassed(domainArtifact?.output);
  if (domainArtifact?.output && domainPassed !== true) {
    const domainCandidateId = hostPair ? await latestDomainCandidateRevisionId(run.id) : undefined;
    const domainDispositions = domainCandidateId
      ? await loadFindingDispositions(domainCandidateId, 'DOMAIN')
      : [];
    const defects = Array.isArray(domainArtifact.output.defects) ? domainArtifact.output.defects : [];
    const openDomain = openDefects(
      defects.map((defect, index) => ({
        ...defect,
        defectId: typeof defect.defectId === 'string' ? defect.defectId : `defect_${String(index + 1).padStart(3, '0')}`
      })),
      domainDispositions
    );
    for (const [index, defect] of openDomain.entries()) {
      const objectId =
        Array.isArray(defect.affectedPairIds) && typeof defect.affectedPairIds[0] === 'string'
          ? defect.affectedPairIds[0]
          : `DOMAIN-${domain}`;
      const checkId = typeof defect.defectId === 'string' ? defect.defectId : `defect_${String(index + 1).padStart(3, '0')}`;
      if (parkedKeys.has(`${objectId}|${checkId}`)) continue;
      findings.push({
        id: `${hostPair?.id ?? run.id}:${checkId}`,
        pairRunId: hostPair?.id ?? null,
        checkId,
        severity: defect.severity === 'BLOCKING' || defect.severity === 'HIGH' || defect.severity === 'MEDIUM' || defect.severity === 'LOW'
          ? defect.severity
          : 'HIGH',
        objectId,
        objectPath: Array.isArray(defect.affectedPaths) && typeof defect.affectedPaths[0] === 'string'
          ? defect.affectedPaths[0]
          : 'domainCoherence',
        issue: typeof defect.issue === 'string' ? defect.issue : 'Domain coherence defect.',
        resolved: false,
        createdAt: new Date()
      });
    }
  }
  const domainCoherence = readDomainCoherenceSnapshot(domain, pairRuns, taskRuns, domainPassed);
  let dismissBlockers = closedDismiss;
  for (const pairRun of pairRuns) {
    const pair = pairs.find((item) => item.pairId === pairRun.pairId);
    if (!pair) continue;
    const artifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    const review = reviewFromUnknown(pairRun.pairId, artifact?.output);
    const candidateId = await latestPairCandidateRevisionId(pairRun.id);
    const dispositions = candidateId ? await loadFindingDispositions(candidateId, 'PAIR') : [];
    const blocking = review
      ? blockingOpenDefects(review.defects, dispositions).filter(
          (defect) => !parkedKeys.has(`${pairRun.pairId}|${defect.defectId}`)
        ).length
      : 0;
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
        activeRun: { state: run.state, pairs, domainCoherence }
      }),
      dismissBlockers
    },
    documents: {
      available: pairs.filter((pair) => pair.state === 'VALIDATED').length === 5,
      indexHref: `/documents/${domain}`,
      bundleHref: `/api/operator/documents/${domain}`,
      approvalHref: `/approval/${domain}`,
      approvalAvailable: [
        'READY_FOR_APPROVAL',
        'APPROVED',
        'PUBLISHING',
        'PUBLICATION_FAILED',
        'PUBLISHED'
      ].includes(run.state)
    },
    review: (() => {
      const unpaid = pairs.find((pair) => pair.pairCoherencePassed !== true && pair.tasks.some((task) => task.taskType === 'PAIR_COHERENCE_REVIEW' && task.status === 'COMPLETED'));
      if (unpaid) {
        return {
          available: true,
          href: `/review/${domain}/${unpaid.pairId}`,
          pairId: unpaid.pairId,
          kind: 'PAIR' as const,
          reason: `${unpaid.pairId} Pair Coherence did not pass. Edit, Rework with GenAI, Regenerate a section, or Save & Finalize Later. Record an explicit disposition (RESOLVED, WAIVED, ACCEPTED_RISK, or REJECTED) with authority and rationale. Deleting a finding does not close it. BLOCKING findings are not waivable. Saves bind a new candidate revision and are not domain APPROVED.`
        };
      }
      const domainDefects =
        domainArtifact?.output && Array.isArray(domainArtifact.output.defects) ? domainArtifact.output.defects : [];
      const domainBlocking = domainDefects.some(
        (item) => item.severity === 'HIGH' || item.severity === 'BLOCKING'
      );
      if (domainPassed === false && domainBlocking) {
        return {
          available: true,
          href: `/review/${domain}`,
          pairId: `DOMAIN-${domain}`,
          kind: 'DOMAIN' as const,
          reason: `Domain ${domain} DOMAIN_COHERENCE_REVIEW has HIGH defects listed. Record an explicit disposition with authority and rationale. Deleting a finding does not close it. BLOCKING findings are not waivable. Continue stays closed until no HIGH domain defects remain. That save is not domain APPROVED.`
        };
      }
      // Any other defected pair (an earlier SIR task failed, or the pair is parked/DEFERRED)
      // still needs a reachable editing surface: Edit, Regenerate a section, or Finalize Later.
      const defected = pairs.find(
        (pair) => pair.state === 'REPAIR_REQUIRED' || pair.state === 'DEFERRED'
      );
      if (defected) {
        return {
          available: true,
          href: `/review/${domain}/${defected.pairId}`,
          pairId: defected.pairId,
          kind: 'PAIR' as const,
          reason: `${defected.pairId} is ${defected.state}. Open the object to Edit flagged paths, Rework with GenAI, Regenerate a section, or Save & Finalize Later while it waits on an external dependency.`
        };
      }
      return {
        available: false,
        href: '',
        pairId: '',
        kind: '' as const,
        reason: 'No remaining HIGH blockers to review.'
      };
    })()
  };
}