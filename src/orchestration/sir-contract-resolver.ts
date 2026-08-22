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
import { buildSirAtomicDecompositionContract } from '../cognitive/sir-atomic-contract.js';
import { buildSirEvidenceArchitectureContract } from '../cognitive/sir-evidence-contract.js';
import {
  buildSirEvidenceSafetyContract,
  type SirEvidenceSafetyOutput
} from '../cognitive/sir-evidence-safety-contract.js';
import {
  buildSirApAbsenceContract,
  type SirApAbsenceOutput
} from '../cognitive/sir-ap-absence-contract.js';
import { buildSirSourceMappingContract } from '../cognitive/sir-source-mapping-contract.js';
import { buildSirFindingArchitectureContract } from '../cognitive/sir-finding-contract.js';
import {
  buildSirControlBoundaryContract,
  type SirControlBoundaryOutput
} from '../cognitive/sir-control-contract.js';
import { buildSirLifecycleAssuranceContract } from '../cognitive/sir-lifecycle-contract.js';
import { buildSirReferenceMappingContract } from '../cognitive/sir-reference-mapping-contract.js';
import { buildSirPairCoherenceContract } from '../cognitive/sir-pair-coherence-contract.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import type { MaterializedSirLifecycleTargets } from '../sir/lifecycle-materializer.js';
import type { MaterializedSirReferenceMappings } from '../sir/reference-mapping-materializer.js';
import type { MaterializedSirSourceMappings } from '../sir/source-mapping-materializer.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import { verifyPersistedControlArtifact } from './control-artifact-verifier.js';
import { verifyMaterializedFindingArtifact } from './finding-artifact-verifier.js';
import { verifyPersistedLifecycleArtifact } from './lifecycle-artifact-verifier.js';
import { buildPairCoherencePacket } from './pair-coherence-packet.js';
import { verifyPairCoherencePacket } from './pair-coherence-packet-verifier.js';
import { verifyPersistedReferenceMappingArtifact } from './reference-mapping-artifact-verifier.js';
import type { SourceContextPacket } from './source-context-packet.js';
import { verifySourceContextPacket } from './source-context-verifier.js';
import { verifyMaterializedSourceMappingArtifact } from './source-mapping-artifact-verifier.js';
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
  | 'EVIDENCE_ARCHITECTURE'
  | 'EVIDENCE_SAFETY'
  | 'AP_ABSENCE_CONTRACT'
  | 'SOURCE_MAPPING'
  | 'FINDING_ARCHITECTURE'
  | 'CONTROL_BOUNDARY'
  | 'LIFECYCLE_ASSURANCE'
  | 'REFERENCE_MAPPING'
  | 'PAIR_COHERENCE_REVIEW';

export interface SirContractResolverInput {
  pairRunId: string;
  taskType: ResolvableSirTaskType;
  authoringPlan: AuthoringPlan;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
  sourceContextPacket?: SourceContextPacket;
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
  const computedOutputHash = canonicalArtifactHash(artifact.output);
  if (artifact.outputHash !== computedOutputHash) {
    throw new Error(
      `Dependency ${expectedTaskType} output hash mismatch: persisted ${artifact.outputHash}, computed ${computedOutputHash}.`
    );
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

  if (input.taskType === 'PAIR_BOUNDARY') return buildSirPairBoundaryContract(base);

  const pairBoundary = assertCompatibleArtifact(
    await load<SirPairBoundaryOutput>(input.pairRunId, 'PAIR_BOUNDARY'),
    'PAIR_BOUNDARY', input.authoringPlan
  );
  if (input.taskType === 'AP_FAILURE_MODEL') return buildSirApFailureModelContract({ ...base, pairBoundary });

  const apFailureModel = assertCompatibleArtifact(
    await load<SirApFailureModelOutput>(input.pairRunId, 'AP_FAILURE_MODEL'),
    'AP_FAILURE_MODEL', input.authoringPlan
  );
  if (input.taskType === 'APPLICABILITY') return buildSirApplicabilityContract({ ...base, pairBoundary, apFailureModel });

  const applicability = assertCompatibleArtifact(
    await load<SirApplicabilityOutput>(input.pairRunId, 'APPLICABILITY'),
    'APPLICABILITY', input.authoringPlan
  );
  if (input.taskType === 'PRIMARY_QUESTIONS') {
    return buildSirPrimaryQuestionsContract({ ...base, pairBoundary, apFailureModel, applicability });
  }

  const primaryQuestions = assertCompatibleArtifact(
    await load<SirPrimaryQuestionsOutput>(input.pairRunId, 'PRIMARY_QUESTIONS'),
    'PRIMARY_QUESTIONS', input.authoringPlan
  );
  if (input.taskType === 'ATOMIC_DECOMPOSITION') {
    return buildSirAtomicDecompositionContract({ ...base, pairBoundary, apFailureModel, applicability, primaryQuestions });
  }

  const atomics = assertCompatibleArtifact(
    await load<MaterializedSirAtomics>(input.pairRunId, 'ATOMIC_DECOMPOSITION'),
    'ATOMIC_DECOMPOSITION', input.authoringPlan
  );
  if (input.taskType === 'EVIDENCE_ARCHITECTURE') {
    return buildSirEvidenceArchitectureContract({ ...base, pairBoundary, apFailureModel, applicability, primaryQuestions, atomics });
  }

  const evidence = assertCompatibleArtifact(
    await load<MaterializedSirEvidence>(input.pairRunId, 'EVIDENCE_ARCHITECTURE'),
    'EVIDENCE_ARCHITECTURE', input.authoringPlan
  );
  if (input.taskType === 'EVIDENCE_SAFETY') {
    return buildSirEvidenceSafetyContract({ ...base, pairBoundary, apFailureModel, applicability, primaryQuestions, atomics, evidence });
  }

  const evidenceSafety = assertCompatibleArtifact(
    await load<SirEvidenceSafetyOutput>(input.pairRunId, 'EVIDENCE_SAFETY'),
    'EVIDENCE_SAFETY', input.authoringPlan
  );
  if (input.taskType === 'AP_ABSENCE_CONTRACT') {
    return buildSirApAbsenceContract({ ...base, pairBoundary, apFailureModel, applicability, primaryQuestions, atomics, evidence, evidenceSafety });
  }

  const apAbsence = assertCompatibleArtifact(
    await load<SirApAbsenceOutput>(input.pairRunId, 'AP_ABSENCE_CONTRACT'),
    'AP_ABSENCE_CONTRACT', input.authoringPlan
  );

  if (input.taskType === 'SOURCE_MAPPING') {
    if (!input.sourceContextPacket) {
      throw new Error(`SOURCE_MAPPING requires a Source Context Packet for ${input.authoringPlan.identity.pairId}.`);
    }
    verifySourceContextPacket(input.sourceContextPacket, input.authoringPlan);
    return buildSirSourceMappingContract({
      ...base, pairBoundary, apFailureModel, applicability, primaryQuestions,
      atomics, evidence, evidenceSafety, apAbsence, sourceContextPacket: input.sourceContextPacket
    });
  }

  const sourceMappingArtifact = await load<MaterializedSirSourceMappings>(
    input.pairRunId,
    'SOURCE_MAPPING'
  );
  const sourceMappings = assertCompatibleArtifact(
    sourceMappingArtifact,
    'SOURCE_MAPPING', input.authoringPlan
  );
  const persistedSourceContextPacket = sourceMappingArtifact?.taskContract.lockedInputs
    .source_context_packet as SourceContextPacket | undefined;
  if (!persistedSourceContextPacket) {
    throw new Error('Persisted SOURCE_MAPPING dependency has no locked Source Context Packet.');
  }
  const lockedPacketHash = sourceMappingArtifact?.taskContract.lockedInputs.source_context_packet_sha256;
  if (lockedPacketHash !== persistedSourceContextPacket.packetSha256) {
    throw new Error('Persisted SOURCE_MAPPING contract Source Context Packet hash binding is inconsistent.');
  }
  verifyMaterializedSourceMappingArtifact({
    output: sourceMappings,
    sourceContextPacket: persistedSourceContextPacket,
    authoringPlan: input.authoringPlan
  });

  if (input.taskType === 'FINDING_ARCHITECTURE') {
    return buildSirFindingArchitectureContract({
      ...base,
      pairBoundary,
      apFailureModel,
      applicability,
      primaryQuestions,
      atomics,
      evidence,
      evidenceSafety,
      apAbsence,
      sourceMappings
    });
  }

  const findingArtifact = await load<MaterializedSirFindings>(
    input.pairRunId,
    'FINDING_ARCHITECTURE'
  );
  const findings = assertCompatibleArtifact(
    findingArtifact,
    'FINDING_ARCHITECTURE',
    input.authoringPlan
  );
  if (!findingArtifact) {
    throw new Error(`Missing completed dependency FINDING_ARCHITECTURE for ${input.authoringPlan.identity.pairId}.`);
  }
  verifyMaterializedFindingArtifact({
    output: findings,
    findingTaskContract: findingArtifact.taskContract,
    authoringPlan: input.authoringPlan
  });

  if (input.taskType === 'CONTROL_BOUNDARY') {
    return buildSirControlBoundaryContract({
      ...base,
      pairBoundary,
      evidenceSafety,
      apAbsence,
      findings
    });
  }

  const controlArtifact = await load<SirControlBoundaryOutput>(
    input.pairRunId,
    'CONTROL_BOUNDARY'
  );
  const controlBoundary = assertCompatibleArtifact(
    controlArtifact,
    'CONTROL_BOUNDARY',
    input.authoringPlan
  );
  if (!controlArtifact) {
    throw new Error(`Missing completed dependency CONTROL_BOUNDARY for ${input.authoringPlan.identity.pairId}.`);
  }
  verifyPersistedControlArtifact({
    output: controlBoundary,
    controlTaskContract: controlArtifact.taskContract,
    authoringPlan: input.authoringPlan,
    verifiedFindings: findings,
    verifiedEvidenceSafety: evidenceSafety,
    verifiedApAbsence: apAbsence
  });

  if (input.taskType === 'LIFECYCLE_ASSURANCE') {
    return buildSirLifecycleAssuranceContract({
      ...base,
      pairBoundary,
      evidence,
      evidenceSafety,
      apAbsence,
      findings,
      controlBoundary
    });
  }

  const lifecycleArtifact = await load<MaterializedSirLifecycleTargets>(
    input.pairRunId,
    'LIFECYCLE_ASSURANCE'
  );
  const lifecycleTargets = assertCompatibleArtifact(
    lifecycleArtifact,
    'LIFECYCLE_ASSURANCE',
    input.authoringPlan
  );
  if (!lifecycleArtifact) {
    throw new Error(`Missing completed dependency LIFECYCLE_ASSURANCE for ${input.authoringPlan.identity.pairId}.`);
  }
  verifyPersistedLifecycleArtifact({
    output: lifecycleTargets,
    lifecycleTaskContract: lifecycleArtifact.taskContract,
    authoringPlan: input.authoringPlan,
    verifiedPairBoundary: pairBoundary,
    verifiedEvidence: evidence,
    verifiedEvidenceSafety: evidenceSafety,
    verifiedApAbsence: apAbsence,
    verifiedFindings: findings,
    verifiedControl: controlBoundary,
    categoryBaseline: input.categoryBaseline,
    goldenReference: input.goldenReference
  });

  if (input.taskType === 'REFERENCE_MAPPING') {
    return buildSirReferenceMappingContract({
      ...base,
      pairBoundary,
      findings
    });
  }

  const referenceArtifact = await load<MaterializedSirReferenceMappings>(
    input.pairRunId,
    'REFERENCE_MAPPING'
  );
  const referenceMappings = assertCompatibleArtifact(
    referenceArtifact,
    'REFERENCE_MAPPING',
    input.authoringPlan
  );
  if (!referenceArtifact) {
    throw new Error(`Missing completed dependency REFERENCE_MAPPING for ${input.authoringPlan.identity.pairId}.`);
  }
  verifyPersistedReferenceMappingArtifact({
    output: referenceMappings,
    referenceTaskContract: referenceArtifact.taskContract,
    authoringPlan: input.authoringPlan,
    verifiedPairBoundary: pairBoundary,
    verifiedFindings: findings,
    categoryBaseline: input.categoryBaseline,
    goldenReference: input.goldenReference
  });

  const pairCoherenceSeed = {
    authoringPlan: input.authoringPlan,
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
  };
  const pairCoherencePacket = buildPairCoherencePacket(pairCoherenceSeed);
  verifyPairCoherencePacket(pairCoherencePacket, pairCoherenceSeed);

  return buildSirPairCoherenceContract({
    ...base,
    pairCoherencePacket
  });
}
