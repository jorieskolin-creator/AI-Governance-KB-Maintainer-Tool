import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationReport } from './contracts.js';

export interface SirReferenceMappingCompletionContext {
  runId: string;
  expectedPairId: string;
}

export function validateSirReferenceMappingCompletion(
  contract: TaskContract,
  _completed: ReadonlySet<unknown>,
  output: unknown,
  context: SirReferenceMappingCompletionContext
): ValidationReport {
  const validContract = contract.contractVersion === '2.0.0' && contract.taskType === 'REFERENCE_MAPPING';
  const validOutput = output !== null && typeof output === 'object' && !Array.isArray(output);
  const passed = validContract && validOutput;
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed,
    findings: passed
      ? []
      : [{
          checkId: 'SIR_REFERENCE_COMPILE_BOUNDARY',
          kind: 'SCHEMA',
          severity: 'BLOCKING',
          objectId: context.expectedPairId,
          objectPath: '/',
          issue: 'Reference Mapping contract/output boundary is invalid.',
          dependencyScope: []
        }]
  };
}
