import type { AdjacentCriterionRef, AuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirReferenceMappingOutput } from '../cognitive/sir-reference-mapping-contract.js';
import type { SirPairBoundaryOutput } from '../cognitive/sir-initial-contracts.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import {
  materializeSirReferenceMappings,
  type MaterializedSirReferenceMappings
} from '../sir/reference-mapping-materializer.js';
import { validateSirReferenceMappingCompletion } from '../validation/sir-reference-mapping-completion.js';
import { canonicalArtifactHash } from './artifact-hash.js';

function assertSameJson(left: unknown, right: unknown, label: string): void {
  if (canonicalArtifactHash(left) !== canonicalArtifactHash(right)) {
    throw new Error(`Persisted Reference Mapping contract ${label} drifted from the verified upstream artifact.`);
  }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unexpected or missing fields.`);
  }
}

function extractHandles(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Persisted Reference Mapping ${label} must be an array.`);
  }
  return value.map((raw, index) => {
    const item = objectRecord(raw, `Persisted Reference Mapping ${label}[${index}]`);
    exactKeys(
      item,
      ['criterionHandle', 'criterionId', 'boundarySummary'],
      `Persisted Reference Mapping ${label}[${index}]`
    );
    if (typeof item.criterionHandle !== 'string' || !/^criterion_.+/.test(item.criterionHandle)) {
      throw new Error(`Persisted Reference Mapping ${label}[${index}] has an invalid criterion handle.`);
    }
    if (typeof item.criterionId !== 'string' || !/^(AP-)?[A-F][1-5]$/.test(item.criterionId)) {
      throw new Error(`Persisted Reference Mapping ${label}[${index}] has an invalid criterion ID.`);
    }
    if (typeof item.boundarySummary !== 'string' || !item.boundarySummary.trim()) {
      throw new Error(`Persisted Reference Mapping ${label}[${index}] has an empty boundary summary.`);
    }
    return item.criterionHandle;
  });
}

export function verifyPersistedReferenceMappingArtifact(input: {
  output: unknown;
  referenceTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedPairBoundary: SirPairBoundaryOutput;
  verifiedFindings: MaterializedSirFindings;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}): asserts input is {
  output: MaterializedSirReferenceMappings;
  referenceTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedPairBoundary: SirPairBoundaryOutput;
  verifiedFindings: MaterializedSirFindings;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
} {
  const contract = input.referenceTaskContract;
  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'REFERENCE_MAPPING') {
    throw new Error('Persisted Reference Mapping verifier requires REFERENCE_MAPPING contractVersion 2.0.0.');
  }
  if (contract.targetObjectId !== input.authoringPlan.identity.pairId) {
    throw new Error('Persisted Reference Mapping target does not match the Authoring Plan pair.');
  }
  if (contract.lockedInputs.authoring_plan_sha256 !== input.authoringPlan.planSha256) {
    throw new Error('Persisted Reference Mapping belongs to a different Authoring Plan.');
  }

  assertSameJson(contract.lockedInputs.pair_boundary, input.verifiedPairBoundary, 'Pair Boundary');
  assertSameJson(contract.lockedInputs.capability_findings, input.verifiedFindings.capability, 'capability Findings');
  assertSameJson(contract.lockedInputs.antipattern_findings, input.verifiedFindings.antipattern, 'anti-pattern Findings');
  assertSameJson(contract.lockedInputs.adjacent_criteria, input.authoringPlan.adjacentCriteria, 'adjacent-criterion universe');
  assertSameJson(contract.lockedInputs.category_baseline, input.categoryBaseline, 'category baseline');
  assertSameJson(contract.lockedInputs.golden_reference, input.goldenReference, 'Golden reference');

  if (contract.lockedInputs.tactic_resolution_mode !== 'NO_APPROVED_TACTIC_AVAILABLE') {
    throw new Error('Persisted Reference Mapping uses an unsupported tactic resolution mode.');
  }
  if (
    input.authoringPlan.baseline.tacticCatalogVersion !== null ||
    input.authoringPlan.baseline.tacticCatalogSha256 !== null ||
    input.authoringPlan.tacticUniverse.length > 0
  ) {
    throw new Error('Persisted Reference Mapping fail-safe cannot be used when an approved tactic catalog is active.');
  }

  const output = objectRecord(input.output, 'Persisted Reference Mapping artifact');
  exactKeys(
    output,
    [
      'capabilityRelatedCriteria',
      'antipatternRelatedCriteria',
      'capabilityTacticRefs',
      'antipatternTacticRefs',
      'referenceNotes'
    ],
    'Persisted Reference Mapping artifact'
  );

  if (!Array.isArray(output.capabilityTacticRefs) || output.capabilityTacticRefs.length !== 0) {
    throw new Error('Persisted Reference Mapping capability tactic refs must be empty in fail-safe mode.');
  }
  if (!Array.isArray(output.antipatternTacticRefs) || output.antipatternTacticRefs.length !== 0) {
    throw new Error('Persisted Reference Mapping anti-pattern tactic refs must be empty in fail-safe mode.');
  }
  if (!Array.isArray(output.referenceNotes) || output.referenceNotes.some((note) => typeof note !== 'string' || !note.trim())) {
    throw new Error('Persisted Reference Mapping referenceNotes must contain strings only.');
  }

  const semanticOutput: SirReferenceMappingOutput = {
    capabilityRelatedCriterionHandles: extractHandles(
      output.capabilityRelatedCriteria,
      'capabilityRelatedCriteria'
    ) as SirReferenceMappingOutput['capabilityRelatedCriterionHandles'],
    antipatternRelatedCriterionHandles: extractHandles(
      output.antipatternRelatedCriteria,
      'antipatternRelatedCriteria'
    ) as SirReferenceMappingOutput['antipatternRelatedCriterionHandles'],
    referenceNotes: [...(output.referenceNotes as string[])]
  };

  const report = validateSirReferenceMappingCompletion(
    contract,
    new Set(contract.upstreamTaskTypes),
    semanticOutput,
    {
      runId: 'persisted-reference-mapping-artifact-verification',
      expectedPairId: input.authoringPlan.identity.pairId
    }
  );
  if (!report.passed) {
    const summary = report.findings
      .map((item) => `${item.checkId}@${item.objectPath}: ${item.issue}`)
      .join(' | ');
    throw new Error(`Persisted Reference Mapping artifact failed deterministic re-validation: ${summary}`);
  }

  const adjacentCriteria = contract.lockedInputs.adjacent_criteria;
  if (!Array.isArray(adjacentCriteria)) {
    throw new Error('Persisted Reference Mapping contract has no locked adjacent-criterion universe.');
  }
  const expected = materializeSirReferenceMappings(
    semanticOutput,
    {
      adjacentCriteria: adjacentCriteria as AdjacentCriterionRef[],
      tacticResolutionMode: 'NO_APPROVED_TACTIC_AVAILABLE'
    }
  );
  if (canonicalArtifactHash(expected) !== canonicalArtifactHash(input.output)) {
    throw new Error('Persisted Reference Mapping materialized content drifted from deterministic reconstruction.');
  }
}
