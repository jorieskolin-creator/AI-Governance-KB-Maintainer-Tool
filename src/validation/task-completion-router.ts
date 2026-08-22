import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { canPersistTaskAsCompleted, type CompletionContext } from './cognitive-completion.js';
import { validateLifecycleAssuranceCompletion } from './lifecycle-assurance.js';
import { validateSirApAbsenceCompletion } from './sir-ap-absence-completion.js';
import { validateSirAtomicCompletion } from './sir-atomic-completion.js';
import { validateSirEvidenceCompletion } from './sir-evidence-completion.js';
import { validateSirEvidenceSafetyCompletion } from './sir-evidence-safety-completion.js';
import { validateSirFindingCompletion } from './sir-finding-completion.js';
import { validateSirInitialCompletion } from './sir-initial-completion.js';
import { validateSirSourceMappingCompletion } from './sir-source-mapping-completion.js';

export type CompletionValidatorRoute =
  | 'SIR_INITIAL'
  | 'SIR_ATOMIC'
  | 'SIR_EVIDENCE'
  | 'SIR_EVIDENCE_SAFETY'
  | 'SIR_AP_ABSENCE'
  | 'SIR_SOURCE_MAPPING'
  | 'SIR_FINDING'
  | 'LIFECYCLE_ASSURANCE'
  | 'LEGACY_COMPLETION';

const INITIAL_SIR_TASKS = new Set<CognitiveTaskType>([
  'PAIR_BOUNDARY',
  'AP_FAILURE_MODEL',
  'APPLICABILITY',
  'PRIMARY_QUESTIONS'
]);

export function completionValidatorRoute(contract: TaskContract): CompletionValidatorRoute {
  if (contract.contractVersion === '2.0.0') {
    if (INITIAL_SIR_TASKS.has(contract.taskType)) return 'SIR_INITIAL';
    if (contract.taskType === 'ATOMIC_DECOMPOSITION') return 'SIR_ATOMIC';
    if (contract.taskType === 'EVIDENCE_ARCHITECTURE') return 'SIR_EVIDENCE';
    if (contract.taskType === 'EVIDENCE_SAFETY') return 'SIR_EVIDENCE_SAFETY';
    if (contract.taskType === 'AP_ABSENCE_CONTRACT') return 'SIR_AP_ABSENCE';
    if (contract.taskType === 'SOURCE_MAPPING') return 'SIR_SOURCE_MAPPING';
    if (contract.taskType === 'FINDING_ARCHITECTURE') return 'SIR_FINDING';
  }

  if (contract.taskType === 'LIFECYCLE_ASSURANCE') return 'LIFECYCLE_ASSURANCE';

  if (contract.contractVersion === '2.0.0') {
    throw new Error(
      `Unsupported SIR v2 completion route for task ${contract.taskType}. Register an explicit deterministic validator before enabling this task.`
    );
  }

  return 'LEGACY_COMPLETION';
}

export function validateTaskCompletion(input: {
  contract: TaskContract;
  completed: ReadonlySet<CognitiveTaskType>;
  output: unknown;
  completionContext: CompletionContext;
}) {
  const shortContext = {
    runId: input.completionContext.runId,
    expectedPairId: input.completionContext.expectedPairId
  };

  switch (completionValidatorRoute(input.contract)) {
    case 'SIR_INITIAL':
      return validateSirInitialCompletion(input.contract, input.completed, input.output, shortContext);
    case 'SIR_ATOMIC':
      return validateSirAtomicCompletion(input.contract, input.completed, input.output, shortContext);
    case 'SIR_EVIDENCE':
      return validateSirEvidenceCompletion(input.contract, input.completed, input.output, shortContext);
    case 'SIR_EVIDENCE_SAFETY':
      return validateSirEvidenceSafetyCompletion(input.contract, input.completed, input.output, shortContext);
    case 'SIR_AP_ABSENCE':
      return validateSirApAbsenceCompletion(input.contract, input.completed, input.output, shortContext);
    case 'SIR_SOURCE_MAPPING':
      return validateSirSourceMappingCompletion(input.contract, input.completed, input.output, shortContext);
    case 'SIR_FINDING':
      return validateSirFindingCompletion(input.contract, input.completed, input.output, shortContext);
    case 'LIFECYCLE_ASSURANCE':
      return validateLifecycleAssuranceCompletion(
        input.contract,
        input.completed,
        input.output,
        input.completionContext
      );
    case 'LEGACY_COMPLETION':
      return canPersistTaskAsCompleted(
        input.contract,
        input.completed,
        input.output,
        input.completionContext
      );
  }
}
