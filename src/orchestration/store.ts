import { getDbPool } from '../db/client.js';
import type { CognitiveTaskType, DomainState, PairState } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding } from '../validation/contracts.js';
import type { ModelExecutionResponse } from '../ai/provider-client.js';
import type { ModelRole } from '../domain/task-contract.js';

export async function createDomainRun(input: {
  domain: string;
  baselineSnapshotId: string;
}): Promise<string> {
  const db = getDbPool();
  const result = await db.query<{ id: string }>(
    `insert into domain_runs(domain, state, baseline_snapshot_id)
     values ($1, 'IN_PROGRESS', $2) returning id`,
    [input.domain, input.baselineSnapshotId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create domain run.');
  return row.id;
}

export async function createPairRun(input: {
  domainRunId: string;
  pairId: string;
  targetVersion: string;
}): Promise<string> {
  const db = getDbPool();
  const result = await db.query<{ id: string }>(
    `insert into pair_runs(domain_run_id, pair_id, state, target_version)
     values ($1, $2, 'DRAFT', $3) returning id`,
    [input.domainRunId, input.pairId, input.targetVersion]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create pair run.');
  return row.id;
}

export async function updatePairState(pairRunId: string, state: PairState): Promise<void> {
  await getDbPool().query(
    'update pair_runs set state = $2, updated_at = now() where id = $1',
    [pairRunId, state]
  );
}

export async function updateDomainState(domainRunId: string, state: DomainState): Promise<void> {
  await getDbPool().query(
    'update domain_runs set state = $2, updated_at = now() where id = $1',
    [domainRunId, state]
  );
}

export async function createTaskRun(input: {
  pairRunId: string;
  contract: TaskContract;
  inputHash: string;
}): Promise<string> {
  const result = await getDbPool().query<{ id: string }>(
    `insert into task_runs(pair_run_id, task_type, target_object_id, status, input_hash, task_contract)
     values ($1, $2, $3, 'STARTED', $4, $5::jsonb)
     returning id`,
    [
      input.pairRunId,
      input.contract.taskType,
      input.contract.targetObjectId,
      input.inputHash,
      JSON.stringify(input.contract)
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to create task run.');
  return row.id;
}

export async function completeTaskRun(input: {
  taskRunId: string;
  output: unknown;
  outputHash: string;
}): Promise<void> {
  await getDbPool().query(
    `update task_runs
     set status = 'COMPLETED', output = $2::jsonb, output_hash = $3, completed_at = now()
     where id = $1`,
    [input.taskRunId, JSON.stringify(input.output), input.outputHash]
  );
}

export async function failTaskRun(taskRunId: string): Promise<void> {
  await getDbPool().query(
    `update task_runs set status = 'FAILED', completed_at = now() where id = $1`,
    [taskRunId]
  );
}

export async function getCompletedTaskTypes(pairRunId: string): Promise<Set<CognitiveTaskType>> {
  const result = await getDbPool().query<{ task_type: CognitiveTaskType }>(
    `select distinct task_type from task_runs where pair_run_id = $1 and status = 'COMPLETED'`,
    [pairRunId]
  );
  return new Set(result.rows.map((row) => row.task_type));
}

export interface CompletedTaskArtifact<T = unknown> {
  output: T;
  taskContract: TaskContract;
  inputHash: string;
  outputHash: string;
}

export async function getLatestCompletedTaskArtifact<T>(
  pairRunId: string,
  taskType: CognitiveTaskType
): Promise<CompletedTaskArtifact<T> | undefined> {
  const result = await getDbPool().query<{
    output: T;
    task_contract: TaskContract;
    input_hash: string;
    output_hash: string;
  }>(
    `select output, task_contract, input_hash, output_hash from task_runs
     where pair_run_id = $1 and task_type = $2 and status = 'COMPLETED'
     order by completed_at desc limit 1`,
    [pairRunId, taskType]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    output: row.output,
    taskContract: row.task_contract,
    inputHash: row.input_hash,
    outputHash: row.output_hash
  };
}

export async function getLatestCompletedTaskOutput<T>(
  pairRunId: string,
  taskType: CognitiveTaskType
): Promise<T | undefined> {
  return (await getLatestCompletedTaskArtifact<T>(pairRunId, taskType))?.output;
}

export async function persistValidationFindings(
  pairRunId: string,
  findings: ValidationFinding[]
): Promise<void> {
  const db = getDbPool();
  for (const item of findings) {
    await db.query(
      `insert into validation_findings(
        pair_run_id, check_id, kind, severity, object_id, object_path, issue,
        dependency_scope, recommended_action
      ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        pairRunId,
        item.checkId,
        item.kind,
        item.severity,
        item.objectId,
        item.objectPath,
        item.issue,
        JSON.stringify(item.dependencyScope),
        item.recommendedAction ?? null
      ]
    );
  }
}

export async function persistModelCall(input: {
  taskRunId: string;
  role: ModelRole;
  response?: ModelExecutionResponse;
  provider: string;
  model: string;
  isFallback: boolean;
  promptHash: string;
  status: 'COMPLETED' | 'FAILED';
  errorCode?: string;
  latencyMs?: number;
}): Promise<void> {
  await getDbPool().query(
    `insert into model_calls(
      task_run_id, role, provider, model, is_fallback, prompt_hash,
      input_tokens, output_tokens, status, error_code, latency_ms
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.taskRunId,
      input.role,
      input.provider,
      input.model,
      input.isFallback,
      input.promptHash,
      input.response?.inputTokens ?? null,
      input.response?.outputTokens ?? null,
      input.status,
      input.errorCode ?? null,
      input.response?.latencyMs ?? input.latencyMs ?? null
    ]
  );
}
