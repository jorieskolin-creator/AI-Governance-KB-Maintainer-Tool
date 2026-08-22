import type { TaskContract } from '../domain/task-contract.js';
import type { SirAtomicDecompositionOutput } from '../cognitive/sir-atomic-contract.js';
import type { SirEvidenceArchitectureOutput } from '../cognitive/sir-evidence-contract.js';
import type { SirFindingArchitectureOutput } from '../cognitive/sir-finding-contract.js';
import type { SirLifecycleAssuranceOutput } from '../cognitive/sir-lifecycle-contract.js';
import type { SirSourceMappingOutput } from '../cognitive/sir-source-mapping-contract.js';
import type { SourceContextPacket } from '../orchestration/source-context-packet.js';
import { materializeSirAtomics } from './atomic-materializer.js';
import { materializeSirEvidence } from './evidence-materializer.js';
import { materializeSirFindings } from './finding-materializer.js';
import { materializeSirLifecycleTargets } from './lifecycle-materializer.js';
import { materializeSirSourceMappings } from './source-mapping-materializer.js';

/**
 * Convert a validated model-authored semantic payload into the persisted SIR artifact
 * consumed by downstream cognitive tasks. Canonical IDs are never created here.
 */
export function materializeValidatedSirTaskOutput(
  contract: TaskContract,
  output: unknown
): unknown {
  if (contract.contractVersion !== '2.0.0') return output;

  if (contract.taskType === 'ATOMIC_DECOMPOSITION') {
    return materializeSirAtomics(output as SirAtomicDecompositionOutput);
  }

  if (contract.taskType === 'EVIDENCE_ARCHITECTURE') {
    return materializeSirEvidence(output as SirEvidenceArchitectureOutput);
  }

  if (contract.taskType === 'SOURCE_MAPPING') {
    const packet = contract.lockedInputs.source_context_packet as SourceContextPacket | undefined;
    if (!packet) {
      throw new Error('Validated SOURCE_MAPPING output cannot be materialized without its Source Context Packet.');
    }
    return materializeSirSourceMappings(output as SirSourceMappingOutput, packet);
  }

  if (contract.taskType === 'FINDING_ARCHITECTURE') {
    return materializeSirFindings(output as SirFindingArchitectureOutput);
  }

  if (contract.taskType === 'LIFECYCLE_ASSURANCE') {
    const lifecycleStageOrder = contract.lockedInputs.lifecycle_stage_order;
    if (!Array.isArray(lifecycleStageOrder) || lifecycleStageOrder.some((stage) => typeof stage !== 'string')) {
      throw new Error('Validated LIFECYCLE_ASSURANCE output cannot be materialized without its Authoring Plan lifecycle stage order.');
    }
    return materializeSirLifecycleTargets(
      output as SirLifecycleAssuranceOutput,
      lifecycleStageOrder as string[]
    );
  }

  return output;
}
