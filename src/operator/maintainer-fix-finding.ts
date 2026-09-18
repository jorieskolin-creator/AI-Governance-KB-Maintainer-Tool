import type { DomainId } from '../authoring/authoring-plan.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import { PAIR_TASK_SEQUENCE, expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getLatestTaskArtifactWithOutput,
  getPairRuns,
  replaceCompletedTaskOutput
} from '../orchestration/store.js';
import {
  blockingQcDefects,
  patchedSnapshotRoots,
  reviewFromUnknown,
  snapshotSlice,
  SNAPSHOT_ROOT_TASK,
  tokenizeRepairPath
} from '../repair/qc-repair.js';
import { domainReviewFromUnknown, snapshotPathFromDomainPath } from './domain-review.js';
import {
  assertReworkWithGenAiAvailable,
  operatorCommandsEnabled,
  regenerateSection
} from './commands.js';
import { isOpenDomainState } from './eligibility.js';
import { operatorLog } from './log.js';
import { loadPairCoherenceSnapshot } from './qc-repair-command.js';
import { coerceLockedTechnicalAssurance } from './schema-gate.js';
import type { CognitiveTaskType } from '../domain/states.js';

export interface MaintainerFixFindingResult {
  domain: DomainId;
  pairId: string;
  findingId: string;
  persisted: boolean;
  queued: 'rework' | 'regenerate' | false;
  coercedPaths: string[];
  gateIssues: string[];
}

function taskTypeFromSnapshotPath(path: string): CognitiveTaskType | undefined {
  if (!path.trim()) return undefined;
  const root = tokenizeRepairPath(path)[0];
  if (!root || root.kind !== 'key') return undefined;
  return SNAPSHOT_ROOT_TASK[root.value];
}

function isRegenerable(taskType: CognitiveTaskType | undefined): taskType is CognitiveTaskType {
  return Boolean(
    taskType && taskType !== 'PAIR_COHERENCE_REVIEW' && PAIR_TASK_SEQUENCE.includes(taskType)
  );
}

/**
 * Option 2: Maintainer fixes this finding. Illegal locked technical-assurance
 * values are coerced to UNKNOWN and the finding stays open. Semantic defects
 * use the existing rework or regenerate loop. Failed focused checks stay on
 * the page; Park remains available. Locked vocabulary is not waived.
 */
export async function maintainerFixFinding(input: {
  domain: DomainId;
  pairId: string;
  findingId: string;
}): Promise<MaintainerFixFindingResult> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  const findingId = input.findingId.trim();
  if (!findingId) throw new Error('Finding id is missing.');
  const run = await getLatestDomainRun(input.domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${input.domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const pairRun = pairRuns.find((item) => item.pairId === input.pairId);
  if (!pairRun) throw new Error(`Pair ${input.pairId} is missing.`);

  const pairArtifact = await getLatestTaskArtifactWithOutput(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  const pairReview = reviewFromUnknown(input.pairId, pairArtifact?.output);
  const pairDefect = pairReview?.defects.find((item) => item.defectId === findingId);

  const hostPairId = expectedDomainPairIds(input.domain)[0];
  const hostPair = hostPairId ? pairRuns.find((item) => item.pairId === hostPairId) : undefined;
  const domainArtifact = hostPair
    ? await getLatestCompletedTaskArtifact(hostPair.id, 'DOMAIN_COHERENCE_REVIEW')
    : undefined;
  const domainReview = domainArtifact ? domainReviewFromUnknown(domainArtifact.output) : undefined;
  const domainDefect = domainReview?.defects.find((item) => item.defectId === findingId);
  const mapped = domainDefect
    ? snapshotPathFromDomainPath(domainDefect.recommendedRepairPaths[0] ?? domainDefect.affectedPaths[0] ?? '')
    : undefined;

  const snapshotPath =
    pairDefect?.recommendedRepairPaths[0] ??
    pairDefect?.affectedPaths[0] ??
    mapped?.snapshotPath ??
    '';

  const snapshot = await loadPairCoherenceSnapshot(pairRun.id);
  const coerced = coerceLockedTechnicalAssurance(snapshot);
  if (coerced.coercedPaths.length) {
    const touched = patchedSnapshotRoots(coerced.coercedPaths);
    for (const taskType of touched) {
      const nextOutput = snapshotSlice(coerced.snapshot, taskType);
      await replaceCompletedTaskOutput({
        pairRunId: pairRun.id,
        taskType,
        output: nextOutput,
        outputHash: canonicalArtifactHash(nextOutput)
      });
    }
  }

  const blocking = pairReview ? blockingQcDefects(pairReview) : [];
  const section = snapshotPath ? taskTypeFromSnapshotPath(snapshotPath) : undefined;
  const coercedThisSection = Boolean(
    section &&
      coerced.coercedPaths.some((path) => {
        try {
          return taskTypeFromSnapshotPath(path) === section;
        } catch {
          return false;
        }
      })
  );

  if (blocking.length) {
    await assertReworkWithGenAiAvailable({ domain: input.domain, pairId: input.pairId });
    operatorLog('operator.finding.maintainer_rework', {
      domain: input.domain,
      pairId: input.pairId,
      findingId,
      coercedPaths: coerced.coercedPaths
    });
    return {
      domain: input.domain,
      pairId: input.pairId,
      findingId,
      persisted: true,
      queued: 'rework',
      coercedPaths: coerced.coercedPaths,
      gateIssues: []
    };
  }

  if (isRegenerable(section) && !coercedThisSection) {
    await regenerateSection({ domain: input.domain, pairId: input.pairId, taskType: section });
    operatorLog('operator.finding.maintainer_regenerate', {
      domain: input.domain,
      pairId: input.pairId,
      findingId,
      taskType: section,
      coercedPaths: coerced.coercedPaths
    });
    return {
      domain: input.domain,
      pairId: input.pairId,
      findingId,
      persisted: true,
      queued: 'regenerate',
      coercedPaths: coerced.coercedPaths,
      gateIssues: []
    };
  }

  if (coerced.coercedPaths.length) {
    operatorLog('operator.finding.maintainer_coerced', {
      domain: input.domain,
      pairId: input.pairId,
      findingId,
      coercedPaths: coerced.coercedPaths
    });
    return {
      domain: input.domain,
      pairId: input.pairId,
      findingId,
      persisted: true,
      queued: false,
      coercedPaths: coerced.coercedPaths,
      gateIssues: []
    };
  }

  throw new Error(
    'Maintainer cannot fix this finding from here. Stay on this defect, edit and Fix, save and continue, or Park it for an expert.'
  );
}
