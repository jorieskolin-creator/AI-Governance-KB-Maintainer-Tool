import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const nonEmpty = z.string().trim().min(1);
const rules = z.object({
  evidenceCeilings: z.array(nonEmpty).min(1),
  falsePositiveGuards: z.array(nonEmpty).min(1),
  prohibitedInferences: z.array(nonEmpty).min(1),
  contradictionHandling: z.array(nonEmpty).min(1),
  freshnessRules: z.array(nonEmpty).min(1)
}).strict();

const outputSchema = z.object({
  capabilityRules: rules,
  antipatternRules: rules,
  crossPairSafetyNotes: z.array(nonEmpty)
}).strict();

export interface SirEvidenceSafetyCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(
  context: SirEvidenceSafetyCompletionContext,
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

function report(
  context: SirEvidenceSafetyCompletionContext,
  findings: ValidationFinding[]
): ValidationReport {
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
  context: SirEvidenceSafetyCompletionContext,
  findings: ValidationFinding[]
): void {
  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(
        finding(
          context,
          'SIR_PREREQUISITE_MISSING',
          '/',
          `${contract.taskType} requires validated ${prerequisite}.`
        )
      );
    }
  }
}

function nonEmptyLockedArray(contract: TaskContract, key: string): boolean {
  const value = contract.lockedInputs[key];
  return Array.isArray(value) && value.length > 0;
}

export function validateSirEvidenceSafetyCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirEvidenceSafetyCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'EVIDENCE_SAFETY') {
    findings.push(
      finding(
        context,
        'SIR_EVIDENCE_SAFETY_CONTRACT_IDENTITY',
        '/',
        'Evidence Safety SIR completion requires EVIDENCE_SAFETY contractVersion 2.0.0.'
      )
    );
    return report(context, findings);
  }

  validatePrerequisites(contract, completed, context, findings);

  for (const key of [
    'capability_atomics',
    'antipattern_atomics',
    'capability_evidence',
    'antipattern_evidence'
  ]) {
    if (!nonEmptyLockedArray(contract, key)) {
      findings.push(
        finding(
          context,
          'SIR_EVIDENCE_SAFETY_UPSTREAM_GRAPH_REQUIRED',
          '/',
          `${key} must contain validated materialized SIR before Evidence Safety can complete.`,
          'REFERENCE'
        )
      );
    }
  }

  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        finding(
          context,
          'SIR_EVIDENCE_SAFETY_OUTPUT_CONTRACT',
          `/${issue.path.join('/')}`,
          issue.message
        )
      );
    }
  }

  return report(context, findings);
}
