import type { SirAtomicItem } from './model.js';
import { SirHandleAllocator } from './handles.js';
import type { SirAtomicDecompositionOutput } from '../cognitive/sir-atomic-contract.js';

export interface MaterializedSirAtomics {
  capability: SirAtomicItem[];
  antipattern: SirAtomicItem[];
}

function materializeCapability(
  items: SirAtomicDecompositionOutput['capabilitySubcriteria']
): SirAtomicItem[] {
  const allocator = new SirHandleAllocator();
  return items.map((item) => ({
    handle: allocator.next('atomic'),
    questionSlot: item.questionSlot,
    statement: item.criterion,
    evidenceNeed: item.evidenceNeed
  }));
}

function materializeAntipattern(
  items: SirAtomicDecompositionOutput['antipatternTests']
): SirAtomicItem[] {
  const allocator = new SirHandleAllocator();
  return items.map((item) => ({
    handle: allocator.next('atomic'),
    questionSlot: item.questionSlot,
    statement: item.test,
    evidenceNeed: item.evidenceNeed
  }));
}

/**
 * Local dynamic handles are deterministic, object-scoped SIR identity.
 * They are not canonical IDs and are never supplied by model output.
 */
export function materializeSirAtomics(
  output: SirAtomicDecompositionOutput
): MaterializedSirAtomics {
  return {
    capability: materializeCapability(output.capabilitySubcriteria),
    antipattern: materializeAntipattern(output.antipatternTests)
  };
}
