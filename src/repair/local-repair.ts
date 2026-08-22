import { z } from 'zod';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding } from '../validation/contracts.js';
import { resolveRepairScope } from './impact-resolver.js';

export interface RepairPatch {
  path: string;
  value: unknown;
}

export interface LocalRepairOutput {
  objectId: string;
  repairs: RepairPatch[];
  rationale: string;
}

export function buildLocalRepairContract(input: {
  pairId: string;
  finding: ValidationFinding;
  frozenObject: unknown;
  relevantDependencies: Record<string, unknown>;
}): TaskContract<LocalRepairOutput> {
  const scope = resolveRepairScope(input.finding);
  return {
    contractVersion: '1.0.0',
    taskId: `${input.pairId}:LOCAL_REPAIR:${input.finding.checkId}`,
    taskType: 'LOCAL_REPAIR',
    targetObjectId: scope.targetObjectId,
    objective:
      'Repair only the validation defect identified by the supplied finding. Return path-scoped replacement values only. Preserve all unrelated content byte-for-byte at the semantic object level.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [],
    lockedInputs: {
      validation_finding: input.finding,
      allowed_target_paths: scope.targetPaths,
      frozen_object: input.frozenObject,
      relevant_dependencies: input.relevantDependencies,
      validators_to_rerun: scope.validatorsToRerun
    },
    allowedReferences: ['VALIDATION_FINDING', 'FROZEN_TARGET_OBJECT', 'RELEVANT_VALIDATED_DEPENDENCIES'],
    doNot: [
      'Do not return a complete rewritten object.',
      'Do not edit any path outside allowed_target_paths.',
      'Do not change stable IDs unless the validation finding explicitly identifies the ID as defective.',
      'Do not repair unrelated issues discovered during this task.',
      'Do not change source mappings, tactics, approval data or control consequences unless one of those exact paths is in allowed_target_paths.',
      'Do not make legal, approval, risk-acceptance or lifecycle-authorization decisions.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'LocalRepairOutput',
      requiredFields: ['objectId', 'repairs', 'rationale'],
      additionalProperties: false
    },
    validationProfile: ['REPAIR_OBJECT_ID_MATCH', 'REPAIR_PATHS_ALLOWED', 'REPAIR_NONEMPTY'],
    dependencyPaths: scope.targetPaths,
    failureMode: 'FAIL_CLOSED'
  };
}

const repairOutputSchema = z
  .object({
    objectId: z.string().min(1),
    repairs: z
      .array(z.object({ path: z.string().min(1), value: z.unknown() }).strict())
      .min(1),
    rationale: z.string().trim().min(10)
  })
  .strict();

export function validateLocalRepairOutput(
  output: unknown,
  expectedObjectId: string,
  allowedPaths: string[]
): LocalRepairOutput {
  const parsed = repairOutputSchema.parse(output);
  if (parsed.objectId !== expectedObjectId) {
    throw new Error(`Repair object mismatch: expected ${expectedObjectId}, received ${parsed.objectId}.`);
  }
  const allowed = new Set(allowedPaths);
  for (const repair of parsed.repairs) {
    if (!allowed.has(repair.path)) {
      throw new Error(`Repair attempted undeclared path ${repair.path}.`);
    }
  }
  return parsed;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function applyRepairPatches<T>(object: T, patches: RepairPatch[]): T {
  const result = clone(object) as Record<string, unknown>;
  for (const patch of patches) {
    const segments = patch.path.split('.').filter(Boolean);
    if (!segments.length) throw new Error('Repair path cannot be empty.');
    let cursor: Record<string, unknown> = result;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]!;
      const next = cursor[segment];
      if (!next || typeof next !== 'object' || Array.isArray(next)) {
        throw new Error(`Repair path ${patch.path} does not resolve through ${segment}.`);
      }
      cursor = next as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]!] = patch.value;
  }
  return result as T;
}
