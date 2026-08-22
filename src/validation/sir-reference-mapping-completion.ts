import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';
import { validateTaskPrerequisites } from './cognitive-completion.js';

interface ShortContext {
  runId: string;
  expectedPairId: string;
}

interface AdjacentCriterionLike {
  criterionHandle?: unknown;
  criterionId?: unknown;
  boundarySummary?: unknown;
}

const outputSchema = z
  .object({
    capabilityRelatedCriterionHandles: z.array(z.string().regex(/^criterion_.+/)),
    antipatternRelatedCriterionHandles: z.array(z.string().regex(/^criterion_.+/)),
    referenceNotes: z.array(z.string().trim().min(1))
  })
  .strict();

function defect(
  context: ShortContext,
  checkId: string,
  objectPath: string,
  issue: string
): ValidationFinding {
  return {
    checkId,
    kind: 'SCHEMA',
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: ['REFERENCE_MAPPING']
  };
}

function pairIds(pairId: string): { capabilityId: string; antipatternId: string } | null {
  const match = /^([A-F][1-5])_(AP-[A-F][1-5])$/.exec(pairId);
  if (!match) return null;
  return { capabilityId: match[1]!, antipatternId: match[2]! };
}

function adjacentUniverse(contract: TaskContract): Map<string, string> | null {
  const raw = contract.lockedInputs.adjacent_criteria;
  if (!Array.isArray(raw)) return null;
  const map = new Map<string, string>();
  for (const item of raw as AdjacentCriterionLike[]) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.criterionHandle !== 'string' || !/^criterion_.+/.test(item.criterionHandle)) return null;
    if (typeof item.criterionId !== 'string' || !/^(AP-)?[A-F][1-5]$/.test(item.criterionId)) return null;
    if (typeof item.boundarySummary !== 'string' || !item.boundarySummary.trim()) return null;
    if (map.has(item.criterionHandle)) return null;
    map.set(item.criterionHandle, item.criterionId);
  }
  return map;
}

function validateSelections(
  values: string[],
  label: 'capability' | 'antipattern',
  ownId: string,
  universe: Map<string, string>,
  context: ShortContext,
  findings: ValidationFinding[]
): void {
  if (new Set(values).size !== values.length) {
    findings.push(
      defect(
        context,
        'SIR_REFERENCE_DUPLICATE_CRITERION_HANDLE',
        `${label}RelatedCriterionHandles`,
        'Related-criterion handles must be unique within each object.'
      )
    );
  }

  values.forEach((handle, index) => {
    const criterionId = universe.get(handle);
    if (!criterionId) {
      findings.push(
        defect(
          context,
          'SIR_REFERENCE_UNKNOWN_CRITERION_HANDLE',
          `${label}RelatedCriterionHandles.${index}`,
          `Criterion handle ${handle} is absent from the Authoring Plan adjacent-criterion universe.`
        )
      );
      return;
    }
    if (criterionId === ownId) {
      findings.push(
        defect(
          context,
          'SIR_REFERENCE_SELF_REFERENCE',
          `${label}RelatedCriterionHandles.${index}`,
          `${label} object ${ownId} cannot reference itself as a related criterion.`
        )
      );
    }
  });
}

export function validateSirReferenceMappingCompletion(
  contract: TaskContract,
  completedTaskTypes: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: ShortContext
): ValidationReport {
  const prerequisite = validateTaskPrerequisites(contract, completedTaskTypes, context);
  if (!prerequisite.passed) return prerequisite;

  const findings: ValidationFinding[] = [];
  if (contract.lockedInputs.tactic_resolution_mode !== 'NO_APPROVED_TACTIC_AVAILABLE') {
    findings.push(
      defect(
        context,
        'SIR_REFERENCE_TACTIC_MODE_UNSUPPORTED',
        'lockedInputs.tactic_resolution_mode',
        'Reference Mapping SIR v2 may use the no-approved-tactic fail-safe only until an approved reciprocal tactic-mapping packet is implemented.'
      )
    );
  }

  const ids = pairIds(context.expectedPairId);
  if (!ids) {
    findings.push(
      defect(context, 'SIR_REFERENCE_PAIR_ID_INVALID', 'targetObjectId', 'Expected pair ID is not canonical.')
    );
  }

  const universe = adjacentUniverse(contract);
  if (!universe) {
    findings.push(
      defect(
        context,
        'SIR_REFERENCE_ADJACENT_UNIVERSE_INVALID',
        'lockedInputs.adjacent_criteria',
        'Adjacent-criterion universe is missing, malformed or contains duplicate handles.'
      )
    );
  }

  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        defect(
          context,
          'SIR_REFERENCE_OUTPUT_CONTRACT',
          issue.path.join('.') || 'REFERENCE_MAPPING',
          issue.message
        )
      );
    }
  } else if (ids && universe) {
    validateSelections(
      parsed.data.capabilityRelatedCriterionHandles,
      'capability',
      ids.capabilityId,
      universe,
      context,
      findings
    );
    validateSelections(
      parsed.data.antipatternRelatedCriterionHandles,
      'antipattern',
      ids.antipatternId,
      universe,
      context,
      findings
    );
  }

  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}
