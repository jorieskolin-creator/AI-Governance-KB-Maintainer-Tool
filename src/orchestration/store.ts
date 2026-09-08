import { getDbPool } from '../db/client.js';
import type { CognitiveTaskType, DomainState, PairState } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding } from '../validation/contracts.js';
import type { ModelExecutionResponse } from '../ai/provider-client.js';
import type { ModelRole } from '../domain/task-contract.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import { PAIR_CANDIDATE_HASH_TASKS } from './pipeline.js';
import { SNAPSHOT_ROOT_TASK } from '../repair/qc-repair.js';
import { pairCandidateRevisionHash, domainCandidateRevisionHash } from './candidate-revision.js';
import {
  evaluateDomainGates,
  evaluatePairGates,
  snapshotIsComplete,
  type NamedGateOutcome,
  type NamedGateResult
} from './named-gates.js';
import { schemaGateSnapshotIssues } from '../validation/sir-snapshot-schema.js';
import type { FindingDisposition, FindingDispositionDraft } from '../repair/finding-dispositions.js';

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
        or (task_runs.task_type = 'LOCAL_REPAIR' and task_runs.status = 'COMPLETED')
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
      `Refusing to reopen ${input.contract.taskType} unless the stored row is FAILED${input.contract.taskType === 'LOCAL_REPAIR' ? ' or a completed LOCAL_REPAIR retry.' : '.'}`
    );
  }
  return row.id;
}

export function canReopenTaskRun(status: 'STARTED' | 'COMPLETED' | 'FAILED'): boolean {
  return status === 'FAILED';
}

export interface OrphanedStartedTask {
  id: string;
  pairId: string;
  taskType: CognitiveTaskType;
}

export async function failOrphanedStartedTasks(domain?: string): Promise<OrphanedStartedTask[]> {
  const db = getDbPool();
  const result = domain
    ? await db.query<OrphanedStartedTask>(
        `update task_runs tr
         set status = 'FAILED', completed_at = now()
         from pair_runs pr
         join domain_runs dr on dr.id = pr.domain_run_id
         where tr.pair_run_id = pr.id
           and tr.status = 'STARTED'
           and dr.domain = $1
         returning tr.id, pr.pair_id as "pairId", tr.task_type as "taskType"`,
        [domain]
      )
    : await db.query<OrphanedStartedTask>(
        `update task_runs tr
         set status = 'FAILED', completed_at = now()
         from pair_runs pr
         where tr.pair_run_id = pr.id
           and tr.status = 'STARTED'
         returning tr.id, pr.pair_id as "pairId", tr.task_type as "taskType"`
      );
  return result.rows;
}

export async function completeTaskRun(input: {
  taskRunId: string;
  output: unknown;
  outputHash: string;
}): Promise<void> {
  const result = await getDbPool().query<{
    pair_run_id: string;
    task_type: CognitiveTaskType;
    input_hash: string;
    task_contract: TaskContract;
  }>(
    `update task_runs
     set status = 'COMPLETED', output = $2::jsonb, output_hash = $3, completed_at = now()
     where id = $1
     returning pair_run_id, task_type, input_hash, task_contract`,
    [input.taskRunId, JSON.stringify(input.output), input.outputHash]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Failed to complete task ${input.taskRunId}.`);
  }
  await insertArtifactRevision({
    pairRunId: row.pair_run_id,
    taskType: row.task_type,
    inputHash: row.input_hash,
    output: input.output,
    outputHash: input.outputHash,
    taskContract: row.task_contract,
    taskRunId: input.taskRunId
  });
  await persistPairCandidate(row.pair_run_id);
  if (row.task_type === 'DOMAIN_COHERENCE_REVIEW') {
    await persistDomainCandidateForHostPair(row.pair_run_id, input.output);
  }
}

export async function failTaskRun(taskRunId: string): Promise<void> {
  await getDbPool().query(
    `update task_runs set status = 'FAILED', completed_at = now() where id = $1`,
    [taskRunId]
  );
}

export async function persistRejectedTaskOutput(input: {
  taskRunId: string;
  output: unknown;
  outputHash: string;
}): Promise<void> {
  await getDbPool().query(
    `update task_runs
     set output = $2::jsonb, output_hash = $3
     where id = $1 and status = 'STARTED'`,
    [input.taskRunId, JSON.stringify(input.output), input.outputHash]
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
  const revision = await getDbPool().query<{
    output: T;
    task_contract: TaskContract;
    input_hash: string;
    output_hash: string;
  }>(
    `select output, task_contract, input_hash, output_hash from artifact_revisions
     where pair_run_id = $1 and task_type = $2
     order by revision_no desc limit 1`,
    [pairRunId, taskType]
  );
  const revisionRow = revision.rows[0];
  if (revisionRow) {
    return {
      output: revisionRow.output,
      taskContract: revisionRow.task_contract,
      inputHash: revisionRow.input_hash,
      outputHash: revisionRow.output_hash
    };
  }
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

export async function getLatestTaskArtifactWithOutput<T>(
  pairRunId: string,
  taskType: CognitiveTaskType
): Promise<CompletedTaskArtifact<T> | undefined> {
  const revision = await getLatestCompletedTaskArtifact<T>(pairRunId, taskType);
  if (revision) return revision;
  const result = await getDbPool().query<{
    output: T;
    task_contract: TaskContract;
    input_hash: string;
    output_hash: string | null;
  }>(
    `select output, task_contract, input_hash, output_hash from task_runs
     where pair_run_id = $1 and task_type = $2 and output is not null
     order by completed_at desc nulls last, created_at desc
     limit 1`,
    [pairRunId, taskType]
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    output: row.output,
    taskContract: row.task_contract,
    inputHash: row.input_hash,
    outputHash: row.output_hash ?? ''
  };
}

export async function replaceCompletedTaskOutput(input: {
  pairRunId: string;
  taskType: CognitiveTaskType;
  output: unknown;
  outputHash: string;
  taskContract?: TaskContract;
  inputHash?: string;
}): Promise<void> {
  const current = await getLatestCompletedTaskArtifact(input.pairRunId, input.taskType);
  if (!current) {
    throw new Error(`No completed ${input.taskType} artifact to patch.`);
  }
  await insertArtifactRevision({
    pairRunId: input.pairRunId,
    taskType: input.taskType,
    inputHash: input.inputHash ?? current.inputHash,
    output: input.output,
    outputHash: input.outputHash,
    taskContract: input.taskContract ?? current.taskContract
  });
}

export async function failLatestCompletedTask(
  pairRunId: string,
  taskType: CognitiveTaskType
): Promise<void> {
  const result = await getDbPool().query(
    `update task_runs
     set status = 'FAILED', completed_at = now()
     where id = (
       select id from task_runs
       where pair_run_id = $1 and task_type = $2 and status = 'COMPLETED'
       order by completed_at desc
       limit 1
     )`,
    [pairRunId, taskType]
  );
  if (result.rowCount !== 1) {
    throw new Error(`No completed ${taskType} task to reopen after repair.`);
  }
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
       and coalesce(v.recommended_action, '') <> 'PARKED_FOR_LATER_REVIEW'
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

export async function persistParkedDefects(
  pairRunId: string,
  domainRunId: string,
  defects: Array<{
    checkId: string;
    severity: string;
    objectId: string;
    objectPath: string;
    issue: string;
  }>
): Promise<void> {
  const db = getDbPool();
  for (const item of defects) {
    await db.query(
      `insert into validation_findings(
        pair_run_id, domain_run_id, check_id, kind, severity, object_id, object_path, issue,
        dependency_scope, recommended_action, resolved
      ) values ($1,$2,$3,'DEFERRED_QC',$4,$5,$6,$7,'[]'::jsonb,'PARKED_FOR_LATER_REVIEW', false)`,
      [pairRunId, domainRunId, item.checkId, item.severity, item.objectId, item.objectPath, item.issue]
    );
  }
}

export async function getParkedFindings(domainRunId: string): Promise<FindingRecord[]> {
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
       and v.recommended_action = 'PARKED_FOR_LATER_REVIEW'
     order by v.created_at desc`,
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

export async function closeParkedFinding(findingId: string): Promise<{
  pairRunId: string | null;
  remaining: number;
}> {
  const db = getDbPool();
  const closed = await db.query<{ pair_run_id: string | null }>(
    `update validation_findings
     set resolved = true
     where id = $1
       and resolved = false
       and recommended_action = 'PARKED_FOR_LATER_REVIEW'
     returning pair_run_id`,
    [findingId]
  );
  const pairRunId = closed.rows[0]?.pair_run_id ?? null;
  if (!pairRunId) {
    return { pairRunId: null, remaining: 0 };
  }
  const remaining = await db.query<{ count: string }>(
    `select count(*)::text as count
     from validation_findings
     where pair_run_id = $1
       and resolved = false
       and recommended_action = 'PARKED_FOR_LATER_REVIEW'`,
    [pairRunId]
  );
  return { pairRunId, remaining: Number(remaining.rows[0]?.count ?? 0) };
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

async function insertArtifactRevision(input: {
  pairRunId: string;
  taskType: CognitiveTaskType;
  inputHash: string;
  output: unknown;
  outputHash: string;
  taskContract: TaskContract;
  taskRunId?: string;
}): Promise<void> {
  await getDbPool().query(
    `insert into artifact_revisions(
      pair_run_id, task_type, revision_no, input_hash, output_hash, output, task_contract,
      task_run_id, superseded_revision_id
    )
    select $1, $2,
      coalesce((select max(revision_no) from artifact_revisions where pair_run_id = $1 and task_type = $2), 0) + 1,
      $3, $4, $5::jsonb, $6::jsonb, $7,
      (select id from artifact_revisions where pair_run_id = $1 and task_type = $2 order by revision_no desc limit 1)`,
    [
      input.pairRunId,
      input.taskType,
      input.inputHash,
      input.outputHash,
      JSON.stringify(input.output),
      JSON.stringify(input.taskContract),
      input.taskRunId ?? null
    ]
  );
}

export async function persistDeterministicArtifact(input: {
  pairRunId: string;
  taskType: CognitiveTaskType;
  output: unknown;
  outputHash: string;
  inputHash: string;
  taskContract: TaskContract;
}): Promise<void> {
  if (input.outputHash !== canonicalArtifactHash(input.output)) {
    throw new Error(`${input.taskType} output hash does not match the artifact being persisted.`);
  }
  await insertArtifactRevision({
    pairRunId: input.pairRunId,
    taskType: input.taskType,
    inputHash: input.inputHash,
    output: input.output,
    outputHash: input.outputHash,
    taskContract: input.taskContract
  });
  await persistPairCandidate(input.pairRunId);
}

function pairCandidateArtifactHashes(hashes: Record<string, string>): Record<string, string> {
  const pairHashes: Record<string, string> = {};
  for (const taskType of PAIR_CANDIDATE_HASH_TASKS) {
    if (hashes[taskType]) pairHashes[taskType] = hashes[taskType];
  }
  return pairHashes;
}

export async function getPairArtifactOutputHashes(pairRunId: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  const completed = await getDbPool().query<{ task_type: string; output_hash: string }>(
    `select task_type, output_hash from task_runs
     where pair_run_id = $1 and status = 'COMPLETED' and output_hash is not null`,
    [pairRunId]
  );
  for (const row of completed.rows) hashes[row.task_type] = row.output_hash;
  const revisions = await getDbPool().query<{ task_type: string; output_hash: string }>(
    `select distinct on (task_type) task_type, output_hash
     from artifact_revisions
     where pair_run_id = $1
     order by task_type, revision_no desc`,
    [pairRunId]
  );
  for (const row of revisions.rows) hashes[row.task_type] = row.output_hash;
  return hashes;
}

export async function currentPairCandidateHash(pairRunId: string, pairId: string): Promise<string> {
  const hashes = await getPairArtifactOutputHashes(pairRunId);
  return pairCandidateRevisionHash(pairId, pairCandidateArtifactHashes(hashes));
}

export async function currentDomainCandidateHash(
  domain: string,
  pairRuns: readonly PairRunRecord[],
  domainCoherenceOutputHash: string
): Promise<string> {
  const pairHashes: Record<string, string> = {};
  for (const pair of pairRuns) {
    pairHashes[pair.pairId] = await currentPairCandidateHash(pair.id, pair.pairId);
  }
  return domainCandidateRevisionHash(domain, pairHashes, domainCoherenceOutputHash);
}

async function ensurePairCandidateRevision(pairRunId: string): Promise<string | undefined> {
  const pair = await getDbPool().query<{ pair_id: string }>(
    'select pair_id from pair_runs where id = $1',
    [pairRunId]
  );
  const pairId = pair.rows[0]?.pair_id;
  if (!pairId) return undefined;
  const hashes = await getPairArtifactOutputHashes(pairRunId);
  const pairHashes = pairCandidateArtifactHashes(hashes);
  const revisionHash = pairCandidateRevisionHash(pairId, pairHashes);
  const existing = await getDbPool().query<{ id: string }>(
    `select id from candidate_revisions where pair_run_id = $1 and revision_hash = $2 and scope = 'PAIR'`,
    [pairRunId, revisionHash]
  );
  let candidateId = existing.rows[0]?.id;
  if (!candidateId) {
    const previous = await getDbPool().query<{ id: string }>(
      `select id from candidate_revisions where pair_run_id = $1 and scope = 'PAIR' order by created_at desc limit 1`,
      [pairRunId]
    );
    const inserted = await getDbPool().query<{ id: string }>(
      `insert into candidate_revisions(
        pair_run_id, scope, revision_hash, artifact_output_hashes, superseded_revision_id
      ) values ($1, 'PAIR', $2, $3::jsonb, $4)
      returning id`,
      [pairRunId, revisionHash, JSON.stringify(pairHashes), previous.rows[0]?.id ?? null]
    );
    candidateId = inserted.rows[0]?.id;
  }
  return candidateId;
}

async function persistGateResults(candidateRevisionId: string, results: NamedGateResult[]): Promise<void> {
  for (const result of results) {
    await getDbPool().query(
      `insert into gate_results(candidate_revision_id, gate_name, outcome, validator_version, findings)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (candidate_revision_id, gate_name) do nothing`,
      [
        candidateRevisionId,
        result.gateName,
        result.outcome,
        result.validatorVersion,
        JSON.stringify(result.findings)
      ]
    );
  }
}

export async function recordPairNamedGates(
  pairRunId: string,
  results: NamedGateResult[]
): Promise<void> {
  const candidateId = await ensurePairCandidateRevision(pairRunId);
  if (!candidateId) return;
  await persistGateResults(candidateId, results);
}

export async function persistPairCandidate(
  pairRunId: string,
  reviewOverride?: unknown
): Promise<NamedGateOutcome[]> {
  const candidateId = await ensurePairCandidateRevision(pairRunId);
  if (!candidateId) return [];

  const snapshot: Record<string, unknown> = {};
  for (const [root, taskType] of Object.entries(SNAPSHOT_ROOT_TASK)) {
    const artifact = await getLatestCompletedTaskArtifact(pairRunId, taskType);
    if (artifact) snapshot[root] = artifact.output;
  }
  const reviewArtifact =
    reviewOverride !== undefined
      ? { output: reviewOverride }
      : await getLatestCompletedTaskArtifact(pairRunId, 'PAIR_COHERENCE_REVIEW');
  const hashes = await getPairArtifactOutputHashes(pairRunId);
  const complete = snapshotIsComplete(hashes);
  const schemaIssues = complete ? schemaGateSnapshotIssues(snapshot) : ['snapshot incomplete'];
  const sourceContextArtifact = await getLatestCompletedTaskArtifact(pairRunId, 'SOURCE_CONTEXT');
  const gates = evaluatePairGates({
    snapshotComplete: complete,
    schemaIssues,
    sourceMappings: snapshot.sourceMappings,
    sourceContextPacket: sourceContextArtifact?.output,
    review: reviewArtifact?.output
  });
  await persistGateResults(candidateId, gates);
  return gates.map((item) => item.outcome);
}

export async function persistDomainCandidateForHostPair(
  hostPairRunId: string,
  reviewOverride?: unknown
): Promise<NamedGateOutcome[]> {
  const host = await getDbPool().query<{ domain_run_id: string; domain: string }>(
    `select pr.domain_run_id, dr.domain
     from pair_runs pr
     join domain_runs dr on dr.id = pr.domain_run_id
     where pr.id = $1`,
    [hostPairRunId]
  );
  const row = host.rows[0];
  if (!row) return [];
  const pairRuns = await getPairRuns(row.domain_run_id);
  const reviewArtifact = await getLatestCompletedTaskArtifact(hostPairRunId, 'DOMAIN_COHERENCE_REVIEW');
  const hash = reviewArtifact?.outputHash ?? '';
  if (!hash) return [];
  const revisionHash = await currentDomainCandidateHash(row.domain, pairRuns, hash);
  const existing = await getDbPool().query<{ id: string }>(
    `select id from candidate_revisions where domain_run_id = $1 and revision_hash = $2 and scope = 'DOMAIN'`,
    [row.domain_run_id, revisionHash]
  );
  let candidateId = existing.rows[0]?.id;
  if (!candidateId) {
    const previous = await getDbPool().query<{ id: string }>(
      `select id from candidate_revisions where domain_run_id = $1 and scope = 'DOMAIN' order by created_at desc limit 1`,
      [row.domain_run_id]
    );
    const pairHashes: Record<string, string> = {};
    for (const pairRun of pairRuns) {
      pairHashes[pairRun.pairId] = await currentPairCandidateHash(pairRun.id, pairRun.pairId);
    }
    const inserted = await getDbPool().query<{ id: string }>(
      `insert into candidate_revisions(
        domain_run_id, scope, revision_hash, artifact_output_hashes, superseded_revision_id
      ) values ($1, 'DOMAIN', $2, $3::jsonb, $4)
      returning id`,
      [
        row.domain_run_id,
        revisionHash,
        JSON.stringify({ ...pairHashes, DOMAIN_COHERENCE_REVIEW: hash }),
        previous.rows[0]?.id ?? null
      ]
    );
    candidateId = inserted.rows[0]?.id;
  }
  if (!candidateId) return [];
  const gates = evaluateDomainGates({ review: reviewOverride ?? reviewArtifact?.output });
  await persistGateResults(candidateId, gates);
  return gates.map((item) => item.outcome);
}

export async function latestPairCandidateRevisionId(pairRunId: string): Promise<string | undefined> {
  const result = await getDbPool().query<{ id: string }>(
    `select id from candidate_revisions where pair_run_id = $1 and scope = 'PAIR' order by created_at desc limit 1`,
    [pairRunId]
  );
  return result.rows[0]?.id;
}

export async function latestDomainCandidateRevisionId(domainRunId: string): Promise<string | undefined> {
  const result = await getDbPool().query<{ id: string }>(
    `select id from candidate_revisions where domain_run_id = $1 and scope = 'DOMAIN' order by created_at desc limit 1`,
    [domainRunId]
  );
  return result.rows[0]?.id;
}

export async function persistFindingDispositions(
  candidateRevisionId: string,
  scope: 'PAIR' | 'DOMAIN',
  drafts: readonly FindingDispositionDraft[]
): Promise<void> {
  const db = getDbPool();
  for (const draft of drafts) {
    await db.query(
      `insert into finding_dispositions(
        candidate_revision_id, finding_id, scope, disposition, authority, rationale
      ) values ($1, $2, $3, $4, $5, $6)
      on conflict (candidate_revision_id, finding_id, scope)
      do update set disposition = excluded.disposition, authority = excluded.authority, rationale = excluded.rationale`,
      [
        candidateRevisionId,
        draft.findingId,
        scope,
        draft.disposition,
        draft.authority,
        draft.rationale.trim()
      ]
    );
  }
}

export async function loadFindingDispositions(
  candidateRevisionId: string,
  scope: 'PAIR' | 'DOMAIN'
): Promise<FindingDispositionDraft[]> {
  const result = await getDbPool().query<{
    finding_id: string;
    disposition: FindingDisposition;
    authority: string;
    rationale: string;
  }>(
    `select finding_id, disposition, authority, rationale
     from finding_dispositions
     where candidate_revision_id = $1 and scope = $2
     order by finding_id`,
    [candidateRevisionId, scope]
  );
  return result.rows.map((row) => ({
    findingId: row.finding_id,
    disposition: row.disposition,
    authority: row.authority,
    rationale: row.rationale
  }));
}

