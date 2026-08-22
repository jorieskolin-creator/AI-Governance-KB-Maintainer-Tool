import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const meaningful = z.string().trim().min(10);
const atomicCapability = z.object({
  questionSlot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  criterion: meaningful,
  evidenceNeed: meaningful
}).strict();
const atomicAntipattern = z.object({
  questionSlot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  test: meaningful,
  evidenceNeed: meaningful
}).strict();
const atomicSchema = z.object({
  capabilitySubcriteria: z.array(atomicCapability).min(3),
  antipatternTests: z.array(atomicAntipattern).min(3),
  coverageNotes: z.array(z.string().trim().min(1))
}).strict();

export interface SirAtomicCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(context: SirAtomicCompletionContext, checkId: string, objectPath: string, issue: string): ValidationFinding {
  return { checkId, kind: 'SCHEMA', severity: 'BLOCKING', objectId: context.expectedPairId, objectPath, issue, dependencyScope: [] };
}

function report(context: SirAtomicCompletionContext, findings: ValidationFinding[]): ValidationReport {
  return { runId: context.runId, objectId: context.expectedPairId, passed: findings.length === 0, findings };
}

function validatePrerequisites(contract: TaskContract, completed: ReadonlySet<CognitiveTaskType>, context: SirAtomicCompletionContext, findings: ValidationFinding[]): void {
  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(finding(context, 'SIR_PREREQUISITE_MISSING', '/', `${contract.taskType} requires validated ${prerequisite}.`));
    }
  }
}

function validateCoverage(items: Array<{ questionSlot: 1 | 2 | 3 }>, path: string, context: SirAtomicCompletionContext, findings: ValidationFinding[]): void {
  const covered = new Set(items.map((item) => item.questionSlot));
  for (const slot of [1, 2, 3] as const) {
    if (!covered.has(slot)) {
      findings.push(finding(context, 'SIR_PRIMARY_QUESTION_SLOT_COVERAGE', path, `No atomic semantic item covers governed question slot ${slot}.`));
    }
  }
}

export function validateSirAtomicCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirAtomicCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];
  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'ATOMIC_DECOMPOSITION') {
    findings.push(finding(context, 'SIR_ATOMIC_CONTRACT', '/', 'Atomic SIR completion requires ATOMIC_DECOMPOSITION contractVersion 2.0.0.'));
    return report(context, findings);
  }
  validatePrerequisites(contract, completed, context, findings);
  const parsed = atomicSchema.safeParse(output);
  if (!parsed.success) {
    for (const item of parsed.error.issues) {
      findings.push(finding(context, 'SIR_ATOMIC_OUTPUT_CONTRACT', `/${item.path.join('/')}`, item.message));
    }
    return report(context, findings);
  }
  validateCoverage(parsed.data.capabilitySubcriteria, '/capabilitySubcriteria', context, findings);
  validateCoverage(parsed.data.antipatternTests, '/antipatternTests', context, findings);
  return report(context, findings);
}
