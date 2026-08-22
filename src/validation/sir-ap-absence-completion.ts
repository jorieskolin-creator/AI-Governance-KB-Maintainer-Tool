import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const outputSchema = z.object({
  requiredArtifacts: z.array(z.string().trim().min(1)).min(1),
  interpretationBoundary: z.string().trim().min(10)
}).strict();

export interface SirApAbsenceCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(
  context: SirApAbsenceCompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'SCHEMA'
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: []
  };
}

function report(context: SirApAbsenceCompletionContext, findings: ValidationFinding[]): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

function validatePrerequisites(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  context: SirApAbsenceCompletionContext,
  findings: ValidationFinding[]
): void {
  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(
        finding(context, 'SIR_PREREQUISITE_MISSING', '/', `${contract.taskType} requires validated ${prerequisite}.`)
      );
    }
  }
}

function validateNormativeConditions(
  contract: TaskContract,
  context: SirApAbsenceCompletionContext,
  findings: ValidationFinding[]
): void {
  const expectedKeys = ['scope_defined', 'executed', 'successful', 'current', 'independently_verified'];
  const conditions = contract.lockedInputs.normative_absence_conditions as Record<string, unknown> | undefined;
  if (!conditions) {
    findings.push(
      finding(context, 'SIR_AP_ABSENCE_NORMATIVE_CONDITIONS_REQUIRED', '/', 'Normative absence conditions are missing from the task contract.')
    );
    return;
  }
  for (const key of expectedKeys) {
    if (conditions[key] !== true) {
      findings.push(
        finding(
          context,
          'SIR_AP_ABSENCE_NORMATIVE_CONDITION_TRUE',
          `/normative_absence_conditions/${key}`,
          `${key} must remain the deterministic literal true.`
        )
      );
    }
  }
}

export function validateSirApAbsenceCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirApAbsenceCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'AP_ABSENCE_CONTRACT') {
    findings.push(
      finding(
        context,
        'SIR_AP_ABSENCE_CONTRACT_IDENTITY',
        '/',
        'AP absence SIR completion requires AP_ABSENCE_CONTRACT contractVersion 2.0.0.'
      )
    );
    return report(context, findings);
  }

  validatePrerequisites(contract, completed, context, findings);
  validateNormativeConditions(contract, context, findings);

  const atomics = contract.lockedInputs.antipattern_atomics;
  const evidence = contract.lockedInputs.antipattern_evidence;
  const safety = contract.lockedInputs.antipattern_evidence_safety;
  if (!Array.isArray(atomics) || atomics.length === 0 || !Array.isArray(evidence) || evidence.length === 0 || !safety) {
    findings.push(
      finding(
        context,
        'SIR_AP_ABSENCE_UPSTREAM_GRAPH_REQUIRED',
        '/',
        'AP absence authoring requires validated anti-pattern atomic, evidence and evidence-safety SIR.',
        'REFERENCE'
      )
    );
  }

  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        finding(context, 'SIR_AP_ABSENCE_OUTPUT_CONTRACT', `/${issue.path.join('/')}`, issue.message)
      );
    }
  }

  return report(context, findings);
}
