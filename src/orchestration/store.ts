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
     on conflict (pair_run_id, task_type, input_hash)
     do update set
       status = 'STARTED',
       retry_count = task_runs.retry_count + 1,
       task_contract = excluded.task_contract,
       output = null,
       output_hash = null,
       completed_at = null
     where task_runs.status = 'FAILED'
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
  if (!row) {
    throw new Error(
      `Refusing to reopen ${input.contract.taskType} unless the stored row is FAILED.`
    );
  }
  return row.id;
}

export function canReopenTaskRun(status: 'STARTED' | 'COMPLETED' | 'FAILED'): boolean {
  return status === 'FAILED';
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

export async function resolveFindingsForPair(pairRunId: string): Promise<void> {
  await getDbPool().query(
    `update validation_findings
     set resolved = true
     where pair_run_id = $1 and resolved = false`,
    [pairRunId]
  );
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

export interface DomainRunRecord {
  id: string;
  domain: string;
  state: DomainState;
  baselineSnapshotId: string;
  baselineSha256: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PairRunRecord {
  id: string;
  domainRunId: string;
  pairId: string;
  state: PairState;
  targetVersion: string;
}

export interface TaskRunRecord {
  id: string;
  pairRunId: string;
  taskType: CognitiveTaskType;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  inputHash: string;
  outputHash: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface FindingRecord {
  id: string;
  pairRunId: string | null;
  checkId: string;
  severity: string;
  objectId: string;
  objectPath: string;
  issue: string;
  resolved: boolean;
  createdAt: Date;
}

export interface ModelCallRecord {
  id: string;
  taskRunId: string | null;
  role: string;
  provider: string;
  model: string;
  isFallback: boolean;
  status: string;
  latencyMs: number | null;
  createdAt: Date;
}

export async function getBaselineSnapshotById(id: string): Promise<{
  id: string;
  sha256: string;
  manifest: unknown;
} | undefined> {
  const result = await getDbPool().query<{ id: string; sha256: string; manifest: unknown }>(
    'select id, sha256, manifest from baseline_snapshots where id = $1',
    [id]
  );
  return result.rows[0];
}

export async function getLatestDomainRun(domain: string): Promise<DomainRunRecord | undefined> {
  const result = await getDbPool().query<{
    id: string;
    domain: string;
    state: DomainState;
    baseline_snapshot_id: string;
    sha256: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `select d.id, d.domain, d.state, d.baseline_snapshot_id, b.sha256, d.created_at, d.updated_at
     from domain_runs d
     join baseline_snapshots b on b.id = d.baseline_snapshot_id
     where d.domain = $1
     order by d.created_at desc
     limit 1`,
    [domain]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    id: row.id,
    domain: row.domain,
    state: row.state,
    baselineSnapshotId: row.baseline_snapshot_id,
    baselineSha256: row.sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function getPairRuns(domainRunId: string): Promise<PairRunRecord[]> {
  const result = await getDbPool().query<{
    id: string;
    domain_run_id: string;
    pair_id: string;
    state: PairState;
    target_version: string;
  }>(
    `select id, domain_run_id, pair_id, state, target_version
     from pair_runs where domain_run_id = $1`,
    [domainRunId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    domainRunId: row.domain_run_id,
    pairId: row.pair_id,
    state: row.state,
    targetVersion: row.target_version
  }));
}

export async function getTaskRunsForPairs(pairRunIds: string[]): Promise<TaskRunRecord[]> {
  if (pairRunIds.length === 0) return [];
  const result = await getDbPool().query<{
    id: string;
    pair_run_id: string;
    task_type: CognitiveTaskType;
    status: 'STARTED' | 'COMPLETED' | 'FAILED';
    input_hash: string;
    output_hash: string | null;
    created_at: Date;
    completed_at: Date | null;
  }>(
    `select id, pair_run_id, task_type, status, input_hash, output_hash, created_at, completed_at
     from task_runs
     where pair_run_id = any($1::uuid[])
     order by created_at desc`,
    [pairRunIds]
  );
  return result.rows.map((row) => ({
    id: row.id,
    pairRunId: row.pair_run_id,
    taskType: row.task_type,
    status: row.status,
    inputHash: row.input_hash,
    outputHash: row.output_hash,
    createdAt: row.created_at,
    completedAt: row.completed_at
  }));
}

export async function getOpenFindings(domainRunId: string): Promise<FindingRecord[]> {
  const result = await getDbPool().query<{
    id: string;
    pair_run_id: string | null;
    check_id: string;
    severity: string;
    object_id: string;
    object_path: string;
    issue: string;
    resolved: boolean;
    created_at: Date;
  }>(
    `select v.id, v.pair_run_id, v.check_id, v.severity, v.object_id, v.object_path, v.issue, v.resolved, v.created_at
     from validation_findings v
     left join pair_runs p on p.id = v.pair_run_id
     where (v.domain_run_id = $1 or p.domain_run_id = $1)
       and v.resolved = false
     order by v.created_at desc
     limit 20`,
    [domainRunId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    pairRunId: row.pair_run_id,
    checkId: row.check_id,
    severity: row.severity,
    objectId: row.object_id,
    objectPath: row.object_path,
    issue: row.issue,
    resolved: row.resolved,
    createdAt: row.created_at
  }));
}

export async function getRecentModelCalls(pairRunIds: string[]): Promise<ModelCallRecord[]> {
  if (pairRunIds.length === 0) return [];
  const result = await getDbPool().query<{
    id: string;
    task_run_id: string | null;
    role: string;
    provider: string;
    model: string;
    is_fallback: boolean;
    status: string;
    latency_ms: number | null;
    created_at: Date;
  }>(
    `select m.id, m.task_run_id, m.role, m.provider, m.model, m.is_fallback, m.status, m.latency_ms, m.created_at
     from model_calls m
     left join task_runs t on t.id = m.task_run_id
     where t.pair_run_id = any($1::uuid[])
     order by m.created_at desc
     limit 20`,
    [pairRunIds]
  );
  return result.rows.map((row) => ({
    id: row.id,
    taskRunId: row.task_run_id,
    role: row.role,
    provider: row.provider,
    model: row.model,
    isFallback: row.is_fallback,
    status: row.status,
    latencyMs: row.latency_ms,
    createdAt: row.created_at
  }));
}

