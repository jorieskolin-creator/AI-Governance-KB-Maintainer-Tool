import { boolean, date, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

export const artifactRevisions = pgTable('artifact_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairRunId: uuid('pair_run_id').notNull(),
  taskType: text('task_type').notNull(),
  revisionNo: integer('revision_no').notNull(),
  inputHash: text('input_hash').notNull(),
  outputHash: text('output_hash').notNull(),
  output: jsonb('output').notNull(),
  taskContract: jsonb('task_contract').notNull(),
  taskRunId: uuid('task_run_id'),
  supersededRevisionId: uuid('superseded_revision_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const candidateRevisions = pgTable('candidate_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairRunId: uuid('pair_run_id'),
  domainRunId: uuid('domain_run_id'),
  scope: text('scope').notNull(),
  revisionHash: text('revision_hash').notNull(),
  artifactOutputHashes: jsonb('artifact_output_hashes').notNull(),
  supersededRevisionId: uuid('superseded_revision_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const gateResults = pgTable('gate_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  candidateRevisionId: uuid('candidate_revision_id').notNull(),
  gateName: text('gate_name').notNull(),
  outcome: text('outcome').notNull(),
  validatorVersion: text('validator_version').notNull(),
  findings: jsonb('findings').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const findingDispositions = pgTable('finding_dispositions', {
  id: uuid('id').defaultRandom().primaryKey(),
  candidateRevisionId: uuid('candidate_revision_id').notNull(),
  findingId: text('finding_id').notNull(),
  scope: text('scope').notNull(),
  disposition: text('disposition').notNull(),
  authority: text('authority').notNull(),
  rationale: text('rationale').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const approvalBundles = pgTable('approval_bundles', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainRunId: uuid('domain_run_id').notNull(),
  domainCandidateRevisionId: uuid('domain_candidate_revision_id').notNull(),
  domainCandidateHash: text('domain_candidate_hash').notNull(),
  bundle: jsonb('bundle').notNull(),
  bundleSha256: text('bundle_sha256').notNull(),
  payloads: jsonb('payloads').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const domainApprovals = pgTable('domain_approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainRunId: uuid('domain_run_id').notNull().unique(),
  domainCandidateHash: text('domain_candidate_hash').notNull(),
  approvalBundleSha256: text('approval_bundle_sha256').notNull(),
  proposedManifestSha256: text('proposed_manifest_sha256').notNull(),
  releaseManifest: jsonb('release_manifest').notNull(),
  releasePayloads: jsonb('release_payloads').notNull(),
  releaseManifestSha256: text('release_manifest_sha256').notNull(),
  approvalReference: text('approval_reference').notNull(),
  approvedByRole: text('approved_by_role').notNull(),
  approvedOn: timestamp('approved_on', { withTimezone: true }).notNull(),
  effectiveFrom: date('effective_from').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const registerRevisions = pgTable('register_revisions', {
  id: uuid('id').defaultRandom().primaryKey(),
  version: text('version').notNull(),
  sha256: text('sha256').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }).defaultNow().notNull(),
  gitCommitSha: text('git_commit_sha'),
  driveFileId: text('drive_file_id'),
  status: text('status').notNull()
});

export const syncEvents = pgTable('sync_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  revisionId: uuid('revision_id').notNull(),
  destination: text('destination').notNull(),
  status: text('status').notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
  detail: text('detail')
});

export const publicationJobs = pgTable('publication_jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainRunId: uuid('domain_run_id').notNull().unique(),
  domainApprovalId: uuid('domain_approval_id').notNull().unique(),
  releaseManifestSha256: text('release_manifest_sha256').notNull(),
  state: text('state').notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastError: text('last_error'),
  releaseId: uuid('release_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});
