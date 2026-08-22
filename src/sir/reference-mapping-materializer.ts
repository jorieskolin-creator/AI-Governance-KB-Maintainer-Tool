import type { AdjacentCriterionRef, AuthoringPlan } from '../authoring/authoring-plan.js';
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

function assertNoApprovedTacticCatalog(plan: AuthoringPlan): void {
  if (
    plan.baseline.tacticCatalogVersion !== null ||
    plan.baseline.tacticCatalogSha256 !== null ||
    plan.tacticUniverse.length > 0
  ) {
    throw new Error(
      'Cannot materialize Reference Mapping tactic refs without an approved reciprocal tactic-mapping packet.'
    );
  }
}

function resolveCriterion(
  handle: SirHandle,
  plan: AuthoringPlan
): MaterializedSirRelatedCriterion {
  const criterion = plan.adjacentCriteria.find((item) => item.criterionHandle === handle);
  if (!criterion) {
    throw new Error(`Cannot materialize unknown adjacent criterion handle ${handle}.`);
  }
  return materializeCriterion(criterion);
}

function materializeCriterion(criterion: AdjacentCriterionRef): MaterializedSirRelatedCriterion {
  if (!/^criterion_.+/.test(criterion.criterionHandle)) {
    throw new Error(`Adjacent criterion handle ${criterion.criterionHandle} is not a SIR criterion handle.`);
  }
  return {
    criterionHandle: criterion.criterionHandle as SirHandle,
    criterionId: criterion.criterionId,
    boundarySummary: criterion.boundarySummary
  };
}

export function materializeSirReferenceMappings(
  output: SirReferenceMappingOutput,
  plan: AuthoringPlan
): MaterializedSirReferenceMappings {
  assertNoApprovedTacticCatalog(plan);
  return {
    capabilityRelatedCriteria: output.capabilityRelatedCriterionHandles.map((handle) =>
      resolveCriterion(handle, plan)
    ),
    antipatternRelatedCriteria: output.antipatternRelatedCriterionHandles.map((handle) =>
      resolveCriterion(handle, plan)
    ),
    capabilityTacticRefs: [],
    antipatternTacticRefs: [],
    referenceNotes: [...output.referenceNotes]
  };
}
