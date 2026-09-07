import type { CognitiveTaskType } from '../domain/states.js';
import type { DomainId } from '../authoring/authoring-plan.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';
import {
  getLatestCompletedTaskArtifact,
  getLatestTaskArtifactWithOutput,
  persistPairCandidate,
  replaceCompletedTaskOutput
} from '../orchestration/store.js';
import { runCognitiveTask } from '../orchestration/task-runner.js';
import {
  applySnapshotPatches,
  blockingQcDefects,
  buildQcLocalRepairContract,
  patchedSnapshotRoots,
  repairPathsFromDefects,
  reviewFromUnknown,
  snapshotSlice
} from '../repair/qc-repair.js';
import { validateLocalRepairOutput } from '../repair/local-repair.js';
import {
  compileAndRecordCurrentPair,
  REPAIR_NOT_COHERENCE_ADMISSIBLE,
  reviewNotesFromReview
} from '../repair/revision-aware-repair.js';
import { schemaGate } from './schema-gate.js';
import { operatorLog } from './log.js';

async function requiredArtifact<T>(pairRunId: string, taskType: CognitiveTaskType): Promise<T> {
  const artifact = await getLatestCompletedTaskArtifact<T>(pairRunId, taskType);
  if (!artifact) throw new Error(`Missing completed ${taskType} artifact for QC repair.`);
  return artifact.output;
}

export async function loadPairCoherenceSnapshot(pairRunId: string): Promise<PairCoherenceSnapshot> {
  const [
    pairBoundary,
    apFailureModel,
    applicability,
    primaryQuestions,
    atomics,
    evidence,
    evidenceSafety,
    apAbsence,
    sourceMappings,
    findings,
    controlBoundary,
    lifecycleTargets,
    referenceMappings
  ] = await Promise.all([
    requiredArtifact(pairRunId, 'PAIR_BOUNDARY'),
    requiredArtifact(pairRunId, 'AP_FAILURE_MODEL'),
    requiredArtifact(pairRunId, 'APPLICABILITY'),
    requiredArtifact(pairRunId, 'PRIMARY_QUESTIONS'),
    requiredArtifact(pairRunId, 'ATOMIC_DECOMPOSITION'),
    requiredArtifact(pairRunId, 'EVIDENCE_ARCHITECTURE'),
    requiredArtifact(pairRunId, 'EVIDENCE_SAFETY'),
    requiredArtifact(pairRunId, 'AP_ABSENCE_CONTRACT'),
    requiredArtifact(pairRunId, 'SOURCE_MAPPING'),
    requiredArtifact(pairRunId, 'FINDING_ARCHITECTURE'),
    requiredArtifact(pairRunId, 'CONTROL_BOUNDARY'),
    requiredArtifact(pairRunId, 'LIFECYCLE_ASSURANCE'),
    requiredArtifact(pairRunId, 'REFERENCE_MAPPING')
  ]);
  return {
    pairBoundary,
    apFailureModel,
    applicability,
    primaryQuestions,
    atomics,
    evidence,
    evidenceSafety,
    apAbsence,
    sourceMappings,
    findings,
    controlBoundary,
    lifecycleTargets,
    referenceMappings
  } as PairCoherenceSnapshot;
}

export async function runPairQcRepair(input: {
  pairRunId: string;
  pairId: string;
  domainRunId: string;
  domain: DomainId;
  baseline: BaselineSnapshot;
  targetVersion?: string;
}): Promise<{ usedFallback: boolean; repairedTaskTypes: CognitiveTaskType[]; coherenceAdmissible: boolean }> {
  const reviewArtifact = await getLatestTaskArtifactWithOutput(
    input.pairRunId,
    'PAIR_COHERENCE_REVIEW'
  );
  if (!reviewArtifact) {
    throw new Error(`${input.pairId} has no completed PAIR_COHERENCE_REVIEW to repair from.`);
  }
  const review = reviewFromUnknown(input.pairId, reviewArtifact.output);
  if (!review) {
    throw new Error(`${input.pairId} PAIR_COHERENCE_REVIEW output has no defects to repair.`);
  }
  const snapshot = await loadPairCoherenceSnapshot(input.pairRunId);
  const contract = buildQcLocalRepairContract({
    pairId: input.pairId,
    review,
    snapshot
  });
  const allowed = contract.lockedInputs.allowed_target_paths as string[];
  const defects = blockingQcDefects(review);

  operatorLog('operator.repair.started', {
    pairId: input.pairId,
    defectIds: defects.map((item) => item.defectId),
    allowedPaths: allowed
  });

  const result = await runCognitiveTask({
    pairRunId: input.pairRunId,
    contract,
    completionContext: {
      runId: input.domainRunId,
      expectedPairId: input.pairId,
      expectedCapabilityId: input.pairId.split('_')[0] ?? input.pairId,
      expectedAntipatternId: input.pairId.replace(/^[A-F][1-5]_/, '')
    }
  });

  const output = validateLocalRepairOutput(result.output, input.pairId, allowed);
  const patched = applySnapshotPatches(snapshot, output.repairs);
  const touched = patchedSnapshotRoots(output.repairs.map((item) => item.path));
  for (const taskType of touched) {
    const nextOutput = snapshotSlice(patched, taskType);
    await replaceCompletedTaskOutput({
      pairRunId: input.pairRunId,
      taskType,
      output: nextOutput,
      outputHash: canonicalArtifactHash(nextOutput)
    });
  }
  await persistPairCandidate(input.pairRunId);
  const gateIssues = schemaGate(input.pairId, patched);
  if (gateIssues.length) {
    operatorLog('operator.repair.rejected_revision', {
      pairId: input.pairId,
      repairedTaskTypes: touched,
      repairCount: output.repairs.length,
      gateIssues
    });
    throw new Error(`${REPAIR_NOT_COHERENCE_ADMISSIBLE} ${gateIssues.join(' ')}`);
  }
  await compileAndRecordCurrentPair({
    pairRunId: input.pairRunId,
    pairId: input.pairId,
    domain: input.domain,
    snapshot: patched,
    baseline: input.baseline,
    targetVersion: input.targetVersion,
    reviewNotes: reviewNotesFromReview(review)
  });
  operatorLog('operator.repair.applied', {
    pairId: input.pairId,
    repairedTaskTypes: touched,
    repairCount: output.repairs.length
  });
  return { usedFallback: result.usedFallback, repairedTaskTypes: touched, coherenceAdmissible: true };
}

export { repairPathsFromDefects };
