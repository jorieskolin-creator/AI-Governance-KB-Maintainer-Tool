import { createHash } from 'node:crypto';
import { executeModel } from '../ai/provider-client.js';
import { getModelRoute, type ModelTarget } from '../ai/model-router.js';
import { buildPromptPacket } from '../cognitive/prompt-builder.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { materializeValidatedSirTaskOutput } from '../sir/task-artifact.js';
import {
  canPersistTaskAsCompleted,
  type CompletionContext
} from '../validation/cognitive-completion.js';
import { validateLifecycleAssuranceCompletion } from '../validation/lifecycle-assurance.js';
import { validateSirInitialCompletion } from '../validation/sir-initial-completion.js';
import { validateSirAtomicCompletion } from '../validation/sir-atomic-completion.js';
import { validateSirEvidenceCompletion } from '../validation/sir-evidence-completion.js';
import type { ValidationFinding } from '../validation/contracts.js';
import {
  completeTaskRun,
  createTaskRun,
  failTaskRun,
  getCompletedTaskTypes,
  persistModelCall,
  persistValidationFindings
} from './store.js';

const INITIAL_SIR_TASKS = new Set<CognitiveTaskType>([
  'PAIR_BOUNDARY',
  'AP_FAILURE_MODEL',
  'APPLICABILITY',
  'PRIMARY_QUESTIONS'
]);

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
    .join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function retries(): number {
  const parsed = Number(process.env.MODEL_MAX_RETRIES ?? 2);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, 5) : 2;
}

async function executeTarget(input: {
  taskRunId: string;
  contract: TaskContract;
  target: ModelTarget;
  isFallback: boolean;
  packet: { system: string; user: string };
}): Promise<unknown> {
  let lastError: unknown;
  const promptHash = createHash('sha256')
    .update(input.packet.system)
    .update('\n---\n')
    .update(input.packet.user)
    .digest('hex');

  for (let attempt = 0; attempt <= retries(); attempt += 1) {
    const started = Date.now();
    try {
      const response = await executeModel({
        target: input.target,
        systemPrompt: input.packet.system,
        userPrompt: input.packet.user
      });
      await persistModelCall({
        taskRunId: input.taskRunId,
        role: input.contract.modelRole,
        response,
        provider: input.target.provider,
        model: input.target.model,
        isFallback: input.isFallback,
        promptHash,
        status: 'COMPLETED'
      });
      return response.parsedJson;
    } catch (error) {
      lastError = error;
      await persistModelCall({
        taskRunId: input.taskRunId,
        role: input.contract.modelRole,
        provider: input.target.provider,
        model: input.target.model,
        isFallback: input.isFallback,
        promptHash,
        status: 'FAILED',
        errorCode: error instanceof Error ? error.name : 'MODEL_EXECUTION_ERROR',
        latencyMs: Date.now() - started
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Model execution failed.');
}

function runDeterministicCompletionGate(input: {
  contract: TaskContract;
  completed: ReadonlySet<CognitiveTaskType>;
  output: unknown;
  completionContext: CompletionContext;
}) {
  if (input.contract.contractVersion === '2.0.0' && INITIAL_SIR_TASKS.has(input.contract.taskType)) {
    return validateSirInitialCompletion(
      input.contract,
      input.completed,
      input.output,
      {
        runId: input.completionContext.runId,
        expectedPairId: input.completionContext.expectedPairId
      }
    );
  }

  if (input.contract.contractVersion === '2.0.0' && input.contract.taskType === 'ATOMIC_DECOMPOSITION') {
    return validateSirAtomicCompletion(
      input.contract,
      input.completed,
      input.output,
      {
        runId: input.completionContext.runId,
        expectedPairId: input.completionContext.expectedPairId
      }
    );
  }

  if (input.contract.contractVersion === '2.0.0' && input.contract.taskType === 'EVIDENCE_ARCHITECTURE') {
    return validateSirEvidenceCompletion(
      input.contract,
      input.completed,
      input.output,
      {
        runId: input.completionContext.runId,
        expectedPairId: input.completionContext.expectedPairId
      }
    );
  }

  if (input.contract.taskType === 'LIFECYCLE_ASSURANCE') {
    return validateLifecycleAssuranceCompletion(
      input.contract,
      input.completed,
      input.output,
      input.completionContext
    );
  }
  return canPersistTaskAsCompleted(
    input.contract,
    input.completed,
    input.output,
    input.completionContext
  );
}

async function tryRoute(input: {
  taskRunId: string;
  pairRunId: string;
  contract: TaskContract;
  target: ModelTarget;
  isFallback: boolean;
  packet: { system: string; user: string };
  completed: ReadonlySet<CognitiveTaskType>;
  completionContext: CompletionContext;
}): Promise<{ passed: boolean; output?: unknown; findings: ValidationFinding[]; executionError?: Error }> {
  try {
    const output = await executeTarget({
      taskRunId: input.taskRunId,
      contract: input.contract,
      target: input.target,
      isFallback: input.isFallback,
      packet: input.packet
    });
    const gate = runDeterministicCompletionGate({
      contract: input.contract,
      completed: input.completed,
      output,
      completionContext: input.completionContext
    });
    return { passed: gate.passed, output, findings: gate.findings };
  } catch (error) {
    return {
      passed: false,
      findings: [],
      executionError: error instanceof Error ? error : new Error('Model execution failed.')
    };
  }
}

async function persistCompletedOutput(input: {
  taskRunId: string;
  contract: TaskContract;
  modelOutput: unknown;
}): Promise<unknown> {
  const persistedOutput = materializeValidatedSirTaskOutput(input.contract, input.modelOutput);
  await completeTaskRun({
    taskRunId: input.taskRunId,
    output: persistedOutput,
    outputHash: hash(persistedOutput)
  });
  return persistedOutput;
}

export async function runCognitiveTask(input: {
  pairRunId: string;
  contract: TaskContract;
  completionContext: CompletionContext;
}): Promise<{ output: unknown; usedFallback: boolean }> {
  const completed = await getCompletedTaskTypes(input.pairRunId);
  const inputHash = hash({ contract: input.contract, completed: [...completed].sort() });
  const taskRunId = await createTaskRun({
    pairRunId: input.pairRunId,
    contract: input.contract,
    inputHash
  });
  const packet = buildPromptPacket(input.contract);
  const route = getModelRoute(input.contract.modelRole);

  const primary = await tryRoute({
    taskRunId,
    pairRunId: input.pairRunId,
    contract: input.contract,
    target: route.primary,
    isFallback: false,
    packet,
    completed,
    completionContext: input.completionContext
  });

  if (primary.passed && primary.output !== undefined) {
    const output = await persistCompletedOutput({
      taskRunId,
      contract: input.contract,
      modelOutput: primary.output
    });
    return { output, usedFallback: false };
  }

  const fallback = await tryRoute({
    taskRunId,
    pairRunId: input.pairRunId,
    contract: input.contract,
    target: route.fallback,
    isFallback: true,
    packet,
    completed,
    completionContext: input.completionContext
  });

  if (fallback.passed && fallback.output !== undefined) {
    const output = await persistCompletedOutput({
      taskRunId,
      contract: input.contract,
      modelOutput: fallback.output
    });
    return { output, usedFallback: true };
  }

  const terminalFindings = fallback.findings.length ? fallback.findings : primary.findings;
  if (terminalFindings.length) {
    await persistValidationFindings(input.pairRunId, terminalFindings);
  }
  await failTaskRun(taskRunId);

  const failureMessages = [primary.executionError?.message, fallback.executionError?.message]
    .filter(Boolean)
    .join(' | ');
  throw new Error(
    `Task ${input.contract.taskType} failed primary and fallback routes${
      failureMessages ? `: ${failureMessages}` : ' due to deterministic completion failure.'
    }`
  );
}
