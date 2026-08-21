import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const baselineSnapshots = pgTable('baseline_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  sha256: text('sha256').notNull(),
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
  pairRunId: uuid('pair_run_id').notNull(),
  checkId: text('check_id').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  objectId: text('object_id').notNull(),
  objectPath: text('object_path').notNull(),
  issue: text('issue').notNull(),
  dependencyScope: jsonb('dependency_scope').notNull(),
  resolved: boolean('resolved').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
