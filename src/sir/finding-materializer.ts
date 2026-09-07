import type { SirFindingArchitectureOutput } from '../cognitive/sir-finding-contract.js';
import type { SirFinding } from './model.js';
import { SirHandleAllocator } from './handles.js';

export interface MaterializedSirFindings {
  capability: SirFinding[];
  antipattern: SirFinding[];
  findingLogicNotes: string[];
}

function materialize(
  items: SirFindingArchitectureOutput['capabilityFindings'] | SirFindingArchitectureOutput['antipatternFindings']
):SirFinding[] {
  const allocator = new SirHandleAllocator();
  return items.map((item)=>({
    handle:allocator.next('finding'),
    title:item.title,
    eligibleConclusionStates:[...item.eligibleConclusionStates],
    atomicHandles:item.atomicHandles,
    evidenceHandles:item.evidenceHandles,
    defaultSeverity:item.defaultSeverity,
    lifecycleConsequence:item.lifecycleConsequence,
    humanLockRequired:item.humanLockRequired
  }));
}

/**
 * Local finding identity is deterministic and object-scoped.
 * Canonical FND-* IDs are intentionally deferred to canonical compilation.
 */
export function materializeSirFindings(
  output:SirFindingArchitectureOutput
):MaterializedSirFindings {
  return {
    capability:materialize(output.capabilityFindings),
    antipattern:materialize(output.antipatternFindings),
    findingLogicNotes:output.findingLogicNotes
  };
}
