import type { SirLifecycleAssuranceOutput } from '../cognitive/sir-lifecycle-contract.js';
import type { SirLifecycleTarget } from './model.js';

export interface MaterializedSirLifecycleTargets {
  capability: SirLifecycleTarget[];
  antipattern: SirLifecycleTarget[];
  rationaleNotes: string[];
}

function materialize(
  stages: readonly string[],
  targets: SirLifecycleAssuranceOutput['capabilityTargets'],
  label: string
): SirLifecycleTarget[] {
  if (targets.length !== stages.length) {
    throw new Error(
      `${label} lifecycle target count ${targets.length} does not match governed lifecycle stage count ${stages.length}.`
    );
  }
  return stages.map((lifecycleStage, index) => {
    const target = targets[index];
    if (!target) {
      throw new Error(`${label} lifecycle target ${index} is missing after validated cardinality check.`);
    }
    return {
      lifecycleStage,
      minimumTechnicalAssurance: target.minimumTechnicalAssurance,
      requiredHumanAssurance: target.requiredHumanAssurance
    };
  });
}

/**
 * Lifecycle stage identity is deterministic and Authoring-Plan-owned.
 * The model supplies only positional assurance values.
 */
export function materializeSirLifecycleTargets(
  output: SirLifecycleAssuranceOutput,
  lifecycleStageOrder: readonly string[]
): MaterializedSirLifecycleTargets {
  if (lifecycleStageOrder.length === 0 || new Set(lifecycleStageOrder).size !== lifecycleStageOrder.length) {
    throw new Error('Lifecycle stage materialization requires a non-empty unique Authoring Plan stage order.');
  }
  return {
    capability: materialize(lifecycleStageOrder, output.capabilityTargets, 'Capability'),
    antipattern: materialize(lifecycleStageOrder, output.antipatternTargets, 'Anti-pattern'),
    rationaleNotes: output.rationaleNotes
  };
}
