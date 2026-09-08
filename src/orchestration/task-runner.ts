import { createHash } from 'node:crypto';
import { executeModel } from '../ai/provider-client.js';
import { getModelRoute, type ModelTarget } from '../ai/model-router.js';
import { buildPromptPacket, type CognitivePromptPacket } from '../cognitive/prompt-builder.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { materializeValidatedSirTaskOutput } from '../sir/task-artifact.js';
import type { CompletionContext } from '../validation/cognitive-completion.js';
import { validateTaskCompletion } from '../validation/task-completion-router.js';
import type { ValidationFinding } from '../validation/contracts.js';
import { operatorLog } from '../operator/log.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import {
  completeTaskRun,
  createTaskRun,
  failTaskRun,
  getCompletedTaskTypes,
  persistModelCall,
  persistRejectedTaskOutput,
  persistValidationFindings,
  resolveFindingsForPair
} from './store.js';
import {
  buildContentCorrectionPacket,
  contentCorrectionFailureMessage,
  providerRouteFailureMessage,
  routeCognitiveTask,
  uniqueValidationFindings,
  type PacketKind,
  type RouteTarget
} from '../repair/content-correction.js';

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
        userPrompt: input.packet.user,
        structuredOutput: {
          schemaName: input.contract.outputContract.schemaName,
          requiredFields: input.contract.outputContract.requiredFields
        }
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
  operatorLog('operator.model.attempt', {
    taskType: input.contract.taskType,
    provider: input.target.provider,
    model: input.target.model,
    isFallback: input.isFallback
  });
  try {
    const output = await executeTarget({
      taskRunId: input.taskRunId,
      contract: input.contract,
      target: input.target,
      isFallback: input.isFallback,
      packet: input.packet
    });
    const gate = validateTaskCompletion({
      contract: input.contract,
      completed: input.completed,
      output,
      completionContext: input.completionContext
    });
    operatorLog('operator.model.completed', {
      taskType: input.contract.taskType,
      provider: input.target.provider,
      model: input.target.model,
      isFallback: input.isFallback,
      passed: gate.passed,
      findings: gate.findings.length,
      outputType: typeof output,
      issues: gate.findings.slice(0, 8).map((item) => `${item.checkId}: ${item.issue}`)
    });
    return { passed: gate.passed, output, findings: gate.findings };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Model execution failed.';
    operatorLog('operator.model.failed', {
      taskType: input.contract.taskType,
      provider: input.target.provider,
      model: input.target.model,
      isFallback: input.isFallback,
      error: message
    });
    return {
      passed: false,
      findings: [],
      executionError: error instanceof Error ? error : new Error('Model execution failed.')
    };
  }
}

async function persistCompletedOutput(input: {
  taskRunId: string;
  pairRunId: string;
  contract: TaskContract;
  modelOutput: unknown;
}): Promise<unknown> {
  await resolveFindingsForPair(input.pairRunId);
  const persistedOutput = materializeValidatedSirTaskOutput(input.contract, input.modelOutput);
  await completeTaskRun({
    taskRunId: input.taskRunId,
    output: persistedOutput,
    outputHash: canonicalArtifactHash(persistedOutput)
  });
  return persistedOutput;
}

export async function runCognitiveTask(input: {
  pairRunId: string;
  contract: TaskContract;
  completionContext: CompletionContext;
}): Promise<{ output: unknown; usedFallback: boolean }> {
  const completed = await getCompletedTaskTypes(input.pairRunId);
  const inputHash = canonicalArtifactHash({ contract: input.contract, completed: [...completed].sort() });
  const taskRunId = await createTaskRun({
    pairRunId: input.pairRunId,
    contract: input.contract,
    inputHash
  });
  await resolveFindingsForPair(input.pairRunId);
  operatorLog('operator.task.started', {
    pairRunId: input.pairRunId,
    taskType: input.contract.taskType,
    taskRunId,
    inputHash
  });
  const originalPacket = buildPromptPacket(input.contract);
  const route = getModelRoute(input.contract.modelRole);
  operatorLog('operator.model.route', {
    taskType: input.contract.taskType,
    role: input.contract.modelRole,
    primary: `${route.primary.provider}/${route.primary.model}`,
    fallback: `${route.fallback.provider}/${route.fallback.model}`
  });

  let correctionPacket: CognitivePromptPacket | undefined;
  const routed = await routeCognitiveTask({
    async runAttempt(args: { target: RouteTarget; packetKind: PacketKind }) {
      const packet = args.packetKind === 'CORRECTION' ? correctionPacket : originalPacket;
      if (!packet) {
        throw new Error('Content correction packet was requested before a validation defect was persisted.');
      }
      const target = args.target === 'primary' ? route.primary : route.fallback;
      operatorLog(args.packetKind === 'CORRECTION' ? 'operator.model.correction' : 'operator.model.route_attempt', {
        taskType: input.contract.taskType,
        target: args.target,
        packetKind: args.packetKind,
        provider: target.provider,
        model: target.model
      });
      return tryRoute({
        taskRunId,
        pairRunId: input.pairRunId,
        contract: input.contract,
        target,
        isFallback: args.target === 'fallback',
        packet,
        completed,
        completionContext: input.completionContext
      });
    },
    async onValidationFailure({ rejectedJson, findings }) {
      correctionPacket = buildContentCorrectionPacket(input.contract, rejectedJson, findings);
      if (rejectedJson !== undefined) {
        await persistRejectedTaskOutput({
          taskRunId,
          output: rejectedJson,
          outputHash: canonicalArtifactHash(rejectedJson)
        });
      }
      if (findings.length) {
        await persistValidationFindings(input.pairRunId, findings);
      }
    }
  });

  if (routed.status === 'COMPLETED') {
    const output = await persistCompletedOutput({
      taskRunId,
      pairRunId: input.pairRunId,
      contract: input.contract,
      modelOutput: routed.output
    });
    return { output, usedFallback: routed.usedFallback };
  }

  if (routed.status === 'FAIL_CONTENT_CORRECTION') {
    const correction = routed.attempts.find((item) => item.packetKind === 'CORRECTION');
    const prior = routed.attempts
      .filter((item) => item.packetKind !== 'CORRECTION')
      .flatMap((item) => item.findings);
    const extra = uniqueValidationFindings(correction?.findings ?? []).filter(
      (item) =>
        !prior.some(
          (other) =>
            other.checkId === item.checkId && other.objectPath === item.objectPath && other.issue === item.issue
        )
    );
    if (extra.length) {
      await persistValidationFindings(input.pairRunId, extra);
    }
    if (routed.rejectedJson !== undefined) {
      await persistRejectedTaskOutput({
        taskRunId,
        output: routed.rejectedJson,
        outputHash: canonicalArtifactHash(routed.rejectedJson)
      });
    }
  }
  await failTaskRun(taskRunId);

  if (routed.status === 'FAIL_EXECUTION_ROUTES') {
    const failureMessages = routed.attempts
      .map((item) => item.executionError?.message)
      .filter(Boolean)
      .join(' | ');
    throw new Error(providerRouteFailureMessage(input.contract.taskType, failureMessages || undefined));
  }

  throw new Error(contentCorrectionFailureMessage(input.contract.taskType));
}
