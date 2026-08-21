import { z } from 'zod';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';
import type { CompletionContext } from './cognitive-completion.js';
import { validateTaskPrerequisites } from './cognitive-completion.js';
import {
  REQUIRED_LIFECYCLE_STAGES,
  type LifecycleAssuranceOutput
} from '../cognitive/lifecycle-assurance-contract.js';

const targetSchema = z
  .object({
    lifecycleStage: z.enum(REQUIRED_LIFECYCLE_STAGES),
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
    capabilityTargets: z.array(targetSchema).length(7),
    antipatternTargets: z.array(targetSchema).length(7),
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

function validateStageSet(
  targets: LifecycleAssuranceOutput['capabilityTargets'],
  path: string,
  context: CompletionContext,
  findings: ValidationFinding[]
): void {
  targets.forEach((target, index) => {
    const expected = REQUIRED_LIFECYCLE_STAGES[index];
    if (target.lifecycleStage !== expected) {
      findings.push(
        defect(
          context,
          'LIFECYCLE_STAGE_ORDER',
          `${path}.${index}.lifecycleStage`,
          `Expected ${expected}, received ${target.lifecycleStage}.`
        )
      );
    }
  });

  const unique = new Set(targets.map((target) => target.lifecycleStage));
  if (unique.size !== REQUIRED_LIFECYCLE_STAGES.length) {
    findings.push(
      defect(
        context,
        'LIFECYCLE_STAGE_COVERAGE',
        path,
        'Each required lifecycle stage must occur exactly once.'
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
  const parsed = lifecycleAssuranceOutputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        defect(context, 'LIFECYCLE_OUTPUT_CONTRACT', issue.path.join('.') || 'LIFECYCLE_ASSURANCE', issue.message)
      );
    }
  } else {
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
    validateStageSet(value.capabilityTargets, 'capabilityTargets', context, findings);
    validateStageSet(value.antipatternTargets, 'antipatternTargets', context, findings);
  }

  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}
