import type { TaskContract } from '../domain/task-contract.js';
import type { SirAtomicDecompositionOutput } from '../cognitive/sir-atomic-contract.js';
import type { SirEvidenceArchitectureOutput } from '../cognitive/sir-evidence-contract.js';
import { materializeSirAtomics } from './atomic-materializer.js';
import { materializeSirEvidence } from './evidence-materializer.js';

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

  return output;
}
