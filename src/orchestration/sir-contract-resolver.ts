import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import {
  buildSirPairBoundaryContract,
  buildSirApFailureModelContract,
  buildSirApplicabilityContract,
  buildSirPrimaryQuestionsContract,
  type SirPairBoundaryOutput,
  type SirApFailureModelOutput,
  type SirApplicabilityOutput,
  type SirPrimaryQuestionsOutput
} from '../cognitive/sir-initial-contracts.js';
import {
  buildSirAtomicDecompositionContract
} from '../cognitive/sir-atomic-contract.js';
import { buildSirEvidenceArchitectureContract } from '../cognitive/sir-evidence-contract.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import {
  getLatestCompletedTaskArtifact,
  type CompletedTaskArtifact
} from './store.js';

export type ResolvableSirTaskType =
  | 'PAIR_BOUNDARY'
  | 'AP_FAILURE_MODEL'
  | 'APPLICABILITY'
  | 'PRIMARY_QUESTIONS'
  | 'ATOMIC_DECOMPOSITION'
  | 'EVIDENCE_ARCHITECTURE';

export interface SirContractResolverInput {
  pairRunId: string;
  taskType: ResolvableSirTaskType;
  authoringPlan: AuthoringPlan;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
  loadArtifact?: <T>(
    pairRunId: string,
    taskType: CognitiveTaskType
  ) => Promise<CompletedTaskArtifact<T> | undefined>;
}

function assertCompatibleArtifact<T>(
  artifact: CompletedTaskArtifact<T> | undefined,
  expectedTaskType: CognitiveTaskType,
  plan: AuthoringPlan
): T {
  if (!artifact) {
    throw new Error(`Missing completed dependency ${expectedTaskType} for ${plan.identity.pairId}.`);
  }

  const contract = artifact.taskContract;
  if (contract.taskType !== expectedTaskType) {
    throw new Error(
      `Dependency type mismatch: expected ${expectedTaskType}, received ${contract.taskType}.`
    );
  }
  if (contract.contractVersion !== '2.0.0') {
    throw new Error(
      `Dependency ${expectedTaskType} uses contractVersion ${contract.contractVersion}; SIR v2 requires 2.0.0.`
    );
  }
  if (contract.targetObjectId !== plan.identity.pairId) {
    throw new Error(
      `Dependency ${expectedTaskType} target ${contract.targetObjectId} does not match ${plan.identity.pairId}.`
    );
  }

  const artifactPlanHash = contract.lockedInputs.authoring_plan_sha256;
  if (artifactPlanHash !== plan.planSha256) {
    throw new Error(
      `Dependency ${expectedTaskType} belongs to Authoring Plan ${String(artifactPlanHash)}, expected ${plan.planSha256}.`
    );
  }
  if (!artifact.outputHash) {
    throw new Error(`Dependency ${expectedTaskType} has no persisted output hash.`);
  }

  return artifact.output;
}

export async function resolveSirTaskContract(
  input: SirContractResolverInput
): Promise<TaskContract> {
  const load = input.loadArtifact ?? getLatestCompletedTaskArtifact;
  const base = {
    authoringPlan: input.authoringPlan,
    categoryBaseline: input.categoryBaseline,
    goldenReference: input.goldenReference
  };

  if (input.taskType === 'PAIR_BOUNDARY') {
    return buildSirPairBoundaryContract(base);
  }

  const pairBoundary = assertCompatibleArtifact(
    await load<SirPairBoundaryOutput>(input.pairRunId, 'PAIR_BOUNDARY'),
    'PAIR_BOUNDARY',
    input.authoringPlan
  );

  if (input.taskType === 'AP_FAILURE_MODEL') {
    return buildSirApFailureModelContract({ ...base, pairBoundary });
  }

  const apFailureModel = assertCompatibleArtifact(
    await load<SirApFailureModelOutput>(input.pairRunId, 'AP_FAILURE_MODEL'),
    'AP_FAILURE_MODEL',
    input.authoringPlan
  );

  if (input.taskType === 'APPLICABILITY') {
    return buildSirApplicabilityContract({ ...base, pairBoundary, apFailureModel });
  }

  const applicability = assertCompatibleArtifact(
    await load<SirApplicabilityOutput>(input.pairRunId, 'APPLICABILITY'),
    'APPLICABILITY',
    input.authoringPlan
  );

  if (input.taskType === 'PRIMARY_QUESTIONS') {
    return buildSirPrimaryQuestionsContract({
      ...base,
      pairBoundary,
      apFailureModel,
      applicability
    });
  }

  const primaryQuestions = assertCompatibleArtifact(
    await load<SirPrimaryQuestionsOutput>(input.pairRunId, 'PRIMARY_QUESTIONS'),
    'PRIMARY_QUESTIONS',
    input.authoringPlan
  );

  if (input.taskType === 'ATOMIC_DECOMPOSITION') {
    return buildSirAtomicDecompositionContract({
      ...base,
      pairBoundary,
      apFailureModel,
      applicability,
      primaryQuestions
    });
  }

  const atomics = assertCompatibleArtifact(
    await load<MaterializedSirAtomics>(input.pairRunId, 'ATOMIC_DECOMPOSITION'),
    'ATOMIC_DECOMPOSITION',
    input.authoringPlan
  );

  return buildSirEvidenceArchitectureContract({
    ...base,
    pairBoundary,
    apFailureModel,
    applicability,
    primaryQuestions,
    atomics
  });
}
