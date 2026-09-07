import type { SirEvidenceArchitectureOutput } from '../cognitive/sir-evidence-contract.js';
import type { SirEvidenceItem } from './model.js';
import { SirHandleAllocator } from './handles.js';

export interface MaterializedSirEvidence {
  capability: SirEvidenceItem[];
  antipattern: SirEvidenceItem[];
}

function materialize(items: SirEvidenceArchitectureOutput['capabilityEvidence']): SirEvidenceItem[] {
  const allocator = new SirHandleAllocator();
  return items.map((item) => ({
    handle: allocator.next('evidence'),
    title: item.title,
    claimSupported: item.claimSupported,
    evidenceClass: item.evidenceClass,
    minimumTechnicalAssurance: item.minimumTechnicalAssurance,
    requiredHumanAssurance: item.requiredHumanAssurance,
    acceptanceConditions: item.acceptanceConditions,
    limitations: item.limitations,
    supportsAtomicHandles: item.supportsAtomicHandles
  }));
}

/**
 * Evidence identity is deterministic and object-scoped.
 * Models author evidence semantics and atomic relationships only.
 */
export function materializeSirEvidence(
  output: SirEvidenceArchitectureOutput
): MaterializedSirEvidence {
  return {
    capability: materialize(output.capabilityEvidence),
    antipattern: materialize(output.antipatternEvidence)
  };
}
