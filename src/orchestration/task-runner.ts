import { createHash } from 'node:crypto';
import { executeModel } from '../ai/provider-client.js';
import { getModelRoute, type ModelTarget } from '../ai/model-router.js';
import { buildPromptPacket } from '../cognitive/prompt-builder.js';
import type { TaskContract } from '../domain/task-contract.js';
import {
  canPersistTaskAsCompleted,
  type CompletionContext
} from '../validation/cognitive-completion.js';
import {
  completeTaskRun,
  createTaskRun,
  failTaskRun,
  getCompletedTaskTypes,
  persistModelCall,
  persistValidationFindings
} from './store.js';

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

  try {
    const primaryOutput = await executeTarget({
      taskRunId,
      contract: input.contract,
      target: route.primary,
      isFallback: false,
      packet
    });
    const primaryGate = canPersistTaskAsCompleted(
      input.contract,
      completed,
      primaryOutput,
      input.completionContext
    );

    if (primaryGate.passed) {
      await completeTaskRun({ taskRunId, output: primaryOutput, outputHash: hash(primaryOutput) });
      return { output: primaryOutput, usedFallback: false };
    }

    const fallbackOutput = await executeTarget({
      taskRunId,
      contract: input.contract,
      target: route.fallback,
      isFallback: true,
      packet
    });
    const fallbackGate = canPersistTaskAsCompleted(
      input.contract,
      completed,
      fallbackOutput,
      input.completionContext
    );

    if (!fallbackGate.passed) {
      await persistValidationFindings(input.pairRunId, fallbackGate.findings);
      await failTaskRun(taskRunId);
      throw new Error(
        `Task ${input.contract.taskType} failed deterministic completion after primary and fallback execution.`
      );
    }

    await completeTaskRun({ taskRunId, output: fallbackOutput, outputHash: hash(fallbackOutput) });
    return { output: fallbackOutput, usedFallback: true };
  } catch (error) {
    await failTaskRun(taskRunId);
    throw error;
  }
}
