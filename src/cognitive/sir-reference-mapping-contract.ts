import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import type { SirHandle } from '../sir/model.js';
import type { SirPairBoundaryOutput } from './sir-initial-contracts.js';

export interface SirReferenceMappingOutput {
  capabilityRelatedCriterionHandles: SirHandle[];
  antipatternRelatedCriterionHandles: SirHandle[];
  referenceNotes: string[];
}

export interface SirReferenceMappingSeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  findings: MaterializedSirFindings;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

function assertReferenceMappingTacticMode(plan: AuthoringPlan): void {
  const hasCatalog = plan.baseline.tacticCatalogVersion !== null || plan.baseline.tacticCatalogSha256 !== null;
  if (hasCatalog || plan.tacticUniverse.length > 0) {
    throw new Error(
      'REFERENCE_MAPPING SIR v2 requires an approved reciprocal tactic-mapping packet when a sealed Tactic Catalog is present; tactic identity alone is insufficient.'
    );
  }
}

export function buildSirReferenceMappingContract(
  seed: SirReferenceMappingSeed
): TaskContract<SirReferenceMappingOutput> {
  assertReferenceMappingTacticMode(seed.authoringPlan);

  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:REFERENCE_MAPPING:SIR`,
    taskType: 'REFERENCE_MAPPING',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Select only semantically justified related-criterion handles from the Authoring Plan adjacent-criterion universe for the capability and paired anti-pattern. Return handle selections and concise rationale notes only. Canonical criterion IDs are materialized deterministically. Tactic mappings are not model-authored and remain empty when no approved reciprocal tactic-mapping catalog is available.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'FINDING_ARCHITECTURE',
      'LIFECYCLE_ASSURANCE'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      pair_boundary: seed.pairBoundary,
      capability_findings: seed.findings.capability,
      antipattern_findings: seed.findings.antipattern,
      adjacent_criteria: seed.authoringPlan.adjacentCriteria,
      tactic_resolution_mode: 'NO_APPROVED_TACTIC_AVAILABLE',
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_MATERIALIZED_FINDINGS',
      'AUTHORING_PLAN_ADJACENT_CRITERIA',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not output capability IDs, anti-pattern IDs, canonical criterion IDs or canonical references.',
      'Do not output tactic IDs, tactic handles, tactic versions, mapping IDs, finding IDs, relationship values, mapping status or catalog versions.',
      'Do not infer a tactic mapping from domain, keyword, semantic similarity, finding wording or the Golden reference.',
      'Do not select a criterion handle that is absent from adjacent_criteria.',
      'Do not add the target object itself as its own related criterion.',
      'Do not rewrite findings, boundaries, evidence, controls, lifecycle targets or source mappings.',
      'Do not treat the paired capability or anti-pattern as a mandatory related criterion merely because the Golden reference contains a paired link.',
      'Do not create approval facts or imply that a related-criterion selection proves compliance, control satisfaction or lifecycle authorization.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirReferenceMappingOutput',
      requiredFields: [
        'capabilityRelatedCriterionHandles',
        'antipatternRelatedCriterionHandles',
        'referenceNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'CRITERION_HANDLES_RESOLVE_IN_AUTHORING_PLAN',
      'RELATED_CRITERION_HANDLES_UNIQUE_PER_OBJECT',
      'NO_SELF_REFERENCE',
      'NO_MODEL_AUTHORED_CANONICAL_CRITERION_IDS',
      'NO_MODEL_AUTHORED_TACTIC_REFERENCES',
      'NO_APPROVED_TACTIC_AVAILABLE_FAIL_SAFE'
    ],
    dependencyPaths: [
      'sir.capability.relatedCriteria',
      'sir.antipattern.relatedCriteria',
      'sir.capability.tacticRefs',
      'sir.antipattern.tacticRefs'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}
