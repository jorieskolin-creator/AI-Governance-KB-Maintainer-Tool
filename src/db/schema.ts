import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const baselineSnapshots = pgTable('baseline_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  sha256: text('sha256').notNull().unique(),
  manifest: jsonb('manifest').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const domainRuns = pgTable('domain_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  domain: text('domain').notNull(),
  state: text('state').notNull(),
  baselineSnapshotId: uuid('baseline_snapshot_id').notNull(),
  approvalReference: text('approval_reference'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const pairRuns = pgTable('pair_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainRunId: uuid('domain_run_id').notNull(),
  pairId: text('pair_id').notNull(),
  state: text('state').notNull(),
  targetVersion: text('target_version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

export const taskRuns = pgTable('task_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairRunId: uuid('pair_run_id').notNull(),
  taskType: text('task_type').notNull(),
  targetObjectId: text('target_object_id').notNull(),
  status: text('status').notNull(),
  inputHash: text('input_hash').notNull(),
  outputHash: text('output_hash'),
  taskContract: jsonb('task_contract').notNull(),
  output: jsonb('output'),
  retryCount: integer('retry_count').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
});

export const validationFindings = pgTable('validation_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairRunId: uuid('pair_run_id'),
  domainRunId: uuid('domain_run_id'),
  checkId: text('check_id').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  objectId: text('object_id').notNull(),
  objectPath: text('object_path').notNull(),
  issue: text('issue').notNull(),
  dependencyScope: jsonb('dependency_scope').notNull(),
  recommendedAction: text('recommended_action'),
  resolved: boolean('resolved').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const modelCalls = pgTable('model_calls', {
  id: uuid('id').defaultRandom().primaryKey(),
  taskRunId: uuid('task_run_id'),
  role: text('role').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  isFallback: boolean('is_fallback').default(false).notNull(),
  promptHash: text('prompt_hash').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const repairRuns = pgTable('repair_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairRunId: uuid('pair_run_id').notNull(),
  findingId: uuid('finding_id').notNull(),
  state: text('state').notNull(),
  targetPaths: jsonb('target_paths').notNull(),
  validatorsToRerun: jsonb('validators_to_rerun').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
});

export const releases = pgTable('releases', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainRunId: uuid('domain_run_id').notNull(),
  releaseVersion: text('release_version').notNull(),
  manifest: jsonb('manifest').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const artifacts = pgTable('artifacts', {
  id: uuid('id').defaultRandom().primaryKey(),
  releaseId: uuid('release_id').notNull(),
  artifactType: text('artifact_type').notNull(),
  objectId: text('object_id'),
  version: text('version'),
  storageUri: text('storage_uri').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
