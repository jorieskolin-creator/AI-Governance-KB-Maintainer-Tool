import { z } from 'zod';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';
import type { CompletionContext } from './cognitive-completion.js';
import { validateTaskPrerequisites } from './cognitive-completion.js';
import {
  LIFECYCLE_STAGE_VOCABULARY,
  type LifecycleStage,
  type LifecycleAssuranceOutput
} from '../cognitive/lifecycle-assurance-contract.js';

const targetSchema = z
  .object({
    lifecycleStage: z.enum(LIFECYCLE_STAGE_VOCABULARY),
    minimumTechnicalAssurance: z.enum([
      'UNKNOWN',
      'DECLARED',
      'IMPLEMENTED',
      'TESTED',
      'OPERATIONALLY_OBSERVED'
    ]),
    requiredHumanAssurance: z.enum(['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'])
  })
  .strict();

const lifecycleAssuranceOutputSchema = z
  .object({
    capabilityId: z.string().regex(/^[A-F][1-5]$/),
    antipatternId: z.string().regex(/^AP-[A-F][1-5]$/),
    capabilityTargets: z.array(targetSchema).min(1),
    antipatternTargets: z.array(targetSchema).min(1),
    rationaleNotes: z.array(z.string().trim().min(1))
  })
  .strict();

function defect(
  context: CompletionContext,
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
    dependencyScope: []
  };
}

function requiredStagesFromContract(contract: TaskContract): LifecycleStage[] | null {
  const value = contract.lockedInputs.required_lifecycle_stages;
  if (!Array.isArray(value) || value.length === 0) return null;
  const allowed = new Set<string>(LIFECYCLE_STAGE_VOCABULARY);
  const stages = value.filter((stage): stage is LifecycleStage => typeof stage === 'string' && allowed.has(stage));
  if (stages.length !== value.length || new Set(stages).size !== stages.length) return null;
  return stages;
}

function validateStageSet(
  targets: LifecycleAssuranceOutput['capabilityTargets'],
  requiredStages: LifecycleStage[],
  path: string,
  context: CompletionContext,
  findings: ValidationFinding[]
): void {
  if (targets.length !== requiredStages.length) {
    findings.push(
      defect(
        context,
        'LIFECYCLE_STAGE_COVERAGE',
        path,
        `Expected ${requiredStages.length} lifecycle targets from the active normative policy, received ${targets.length}.`
      )
    );
    return;
  }

  targets.forEach((target, index) => {
    const expected = requiredStages[index];
    if (target.lifecycleStage !== expected) {
      findings.push(
        defect(
          context,
          'LIFECYCLE_STAGE_ORDER',
          `${path}.${index}.lifecycleStage`,
          `Expected normative stage ${expected}, received ${target.lifecycleStage}.`
        )
      );
    }
  });

  const unique = new Set(targets.map((target) => target.lifecycleStage));
  if (unique.size !== requiredStages.length) {
    findings.push(
      defect(
        context,
        'LIFECYCLE_STAGE_UNIQUENESS',
        path,
        'Each lifecycle stage required by the active normative policy must occur exactly once.'
      )
    );
  }
}

export function validateLifecycleAssuranceCompletion(
  contract: TaskContract,
  completedTaskTypes: ReadonlySet<any>,
  output: unknown,
  context: CompletionContext
): ValidationReport {
  const prerequisite = validateTaskPrerequisites(contract, completedTaskTypes, context);
  if (!prerequisite.passed) return prerequisite;

  const findings: ValidationFinding[] = [];
  const requiredStages = requiredStagesFromContract(contract);
  if (!requiredStages) {
    findings.push(
      defect(
        context,
        'NORMATIVE_LIFECYCLE_POLICY_MISSING',
        'lockedInputs.required_lifecycle_stages',
        'Lifecycle validation requires an explicit, valid lifecycle-stage set from the active normative baseline; Golden reference content cannot substitute for it.'
      )
    );
  }

  const parsed = lifecycleAssuranceOutputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        defect(context, 'LIFECYCLE_OUTPUT_CONTRACT', issue.path.join('.') || 'LIFECYCLE_ASSURANCE', issue.message)
      );
    }
  } else if (requiredStages) {
    const value = parsed.data;
    if (value.capabilityId !== context.expectedCapabilityId) {
      findings.push(
        defect(context, 'CAPABILITY_ID_MATCH', 'capabilityId', `Expected ${context.expectedCapabilityId}.`)
      );
    }
    if (value.antipatternId !== context.expectedAntipatternId) {
      findings.push(
        defect(context, 'ANTIPATTERN_ID_MATCH', 'antipatternId', `Expected ${context.expectedAntipatternId}.`)
      );
    }
    validateStageSet(value.capabilityTargets, requiredStages, 'capabilityTargets', context, findings);
    validateStageSet(value.antipatternTargets, requiredStages, 'antipatternTargets', context, findings);
  }

  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}
