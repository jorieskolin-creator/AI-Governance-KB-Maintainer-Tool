import type { AdjacentCriterionRef } from '../authoring/authoring-plan.js';
import type { SirReferenceMappingOutput } from '../cognitive/sir-reference-mapping-contract.js';
import type { SirHandle } from './model.js';

export interface MaterializedSirRelatedCriterion {
  criterionHandle: SirHandle;
  criterionId: string;
  boundarySummary: string;
}

export interface MaterializedSirReferenceMappings {
  capabilityRelatedCriteria: MaterializedSirRelatedCriterion[];
  antipatternRelatedCriteria: MaterializedSirRelatedCriterion[];
  capabilityTacticRefs: [];
  antipatternTacticRefs: [];
  referenceNotes: string[];
}

export interface ReferenceMappingMaterializationContext {
  adjacentCriteria: AdjacentCriterionRef[];
  tacticResolutionMode: 'NO_APPROVED_TACTIC_AVAILABLE';
}

function assertContext(context: ReferenceMappingMaterializationContext): void {
  if (context.tacticResolutionMode !== 'NO_APPROVED_TACTIC_AVAILABLE') {
    throw new Error(
      'Cannot materialize Reference Mapping tactic refs without an approved reciprocal tactic-mapping packet.'
    );
  }
  const handles = new Set<string>();
  for (const criterion of context.adjacentCriteria) {
    if (!/^criterion_.+/.test(criterion.criterionHandle)) {
      throw new Error(`Adjacent criterion handle ${criterion.criterionHandle} is not a SIR criterion handle.`);
    }
    if (!/^(AP-)?[A-F][1-5]$/.test(criterion.criterionId)) {
      throw new Error(`Adjacent criterion ID ${criterion.criterionId} is not canonical.`);
    }
    if (!criterion.boundarySummary.trim()) {
      throw new Error(`Adjacent criterion ${criterion.criterionHandle} has an empty boundary summary.`);
    }
    if (handles.has(criterion.criterionHandle)) {
      throw new Error(`Adjacent criterion handle ${criterion.criterionHandle} is duplicated.`);
    }
    handles.add(criterion.criterionHandle);
  }
}

function resolveCriterion(
  handle: SirHandle,
  context: ReferenceMappingMaterializationContext
): MaterializedSirRelatedCriterion {
  const criterion = context.adjacentCriteria.find((item) => item.criterionHandle === handle);
  if (!criterion) {
    throw new Error(`Cannot materialize unknown adjacent criterion handle ${handle}.`);
  }
  return {
    criterionHandle: criterion.criterionHandle as SirHandle,
    criterionId: criterion.criterionId,
    boundarySummary: criterion.boundarySummary
  };
}

export function materializeSirReferenceMappings(
  output: SirReferenceMappingOutput,
  context: ReferenceMappingMaterializationContext
): MaterializedSirReferenceMappings {
  assertContext(context);
  return {
    capabilityRelatedCriteria: output.capabilityRelatedCriterionHandles.map((handle) =>
      resolveCriterion(handle, context)
    ),
    antipatternRelatedCriteria: output.antipatternRelatedCriterionHandles.map((handle) =>
      resolveCriterion(handle, context)
    ),
    capabilityTacticRefs: [],
    antipatternTacticRefs: [],
    referenceNotes: [...output.referenceNotes]
  };
}
