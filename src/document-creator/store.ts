import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbPool } from '../db/client.js';
import type { ModelExecutionRequest, ModelExecutionResponse } from '../ai/provider-client.js';
import {
  authorPairWorkUnit,
  type AuthoredPairResult,
  type CreatorAuthorProviderPort,
  type ModelClaimDraft
} from './author.js';
import {
  validateCreatorRunRecord,
  type CreatorRunRecord,
  type DocumentPlan,
  type DocumentRevisionRecord,
  type ProviderCallAuditRecord,
  type SourcePreparationBundle
} from './contracts.js';
import { computeSha256 } from './inputs.js';
import type { ResolvedProfileRuntime } from './profiles.js';
import {
  applyDirectHumanEdit,
  applyTargetedSectionRepair,
  type DirectSectionEditPatch
} from './repair.js';
import { renderPairArtifacts } from './render.js';
import { reviewAuthoredPair } from './review.js';
import {
  prepareSourcesForPlan,
  SourcePreparationCache,
  type HostAddressResolver,
  type HttpFetchPort
} from './sources.js';
import { validateAuthoredPair } from './validate.js';

export interface CreatorRunStorePort {
  getRun(runId: string): Promise<CreatorRunRecord | undefined>;
  getLatestRunForPair(profileId: string, pairId: string): Promise<CreatorRunRecord | undefined>;
  listRuns(profileId?: string): Promise<CreatorRunRecord[]>;
  saveRun(record: CreatorRunRecord): Promise<void>;
}

function cloneRun(record: CreatorRunRecord): CreatorRunRecord {
  return JSON.parse(JSON.stringify(record)) as CreatorRunRecord;
}

export class InMemoryCreatorRunStore implements CreatorRunStorePort {
  private readonly runsById = new Map<string, CreatorRunRecord>();

  async getRun(runId: string): Promise<CreatorRunRecord | undefined> {
    const found = this.runsById.get(runId);
    return found ? cloneRun(found) : undefined;
  }

  async getLatestRunForPair(
    profileId: string,
    pairId: string
  ): Promise<CreatorRunRecord | undefined> {
    const matches = [...this.runsById.values()]
      .filter((r) => r.profile_id === profileId && r.pair_id === pairId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return matches[0] ? cloneRun(matches[0]) : undefined;
  }

  async listRuns(profileId?: string): Promise<CreatorRunRecord[]> {
    return [...this.runsById.values()]
      .filter((r) => !profileId || r.profile_id === profileId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(cloneRun);
  }

  async saveRun(record: CreatorRunRecord): Promise<void> {
    const errors = validateCreatorRunRecord(record);
    if (errors.length > 0) {
      throw new Error(`CreatorRunRecord failed schema validation: ${JSON.stringify(errors)}`);
    }
    this.runsById.set(record.run_id, cloneRun(record));
  }
}

export class PostgresCreatorRunStore implements CreatorRunStorePort {
  private readonly pool: pg.Pool;

  constructor(pool?: pg.Pool) {
    this.pool = pool ?? getDbPool();
  }

  async getRun(runId: string): Promise<CreatorRunRecord | undefined> {
    const res = await this.pool.query<{ run_record: CreatorRunRecord }>(
      'SELECT run_record FROM creator_runs WHERE run_id = $1',
      [runId]
    );
    const row = res.rows[0];
    return row ? cloneRun(row.run_record) : undefined;
  }

  async getLatestRunForPair(
    profileId: string,
    pairId: string
  ): Promise<CreatorRunRecord | undefined> {
    const res = await this.pool.query<{ run_record: CreatorRunRecord }>(
      `SELECT run_record FROM creator_runs
       WHERE profile_id = $1 AND pair_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [profileId, pairId]
    );
    const row = res.rows[0];
    return row ? cloneRun(row.run_record) : undefined;
  }

  async listRuns(profileId?: string): Promise<CreatorRunRecord[]> {
    const res = profileId
      ? await this.pool.query<{ run_record: CreatorRunRecord }>(
          'SELECT run_record FROM creator_runs WHERE profile_id = $1 ORDER BY updated_at DESC',
          [profileId]
        )
      : await this.pool.query<{ run_record: CreatorRunRecord }>(
          'SELECT run_record FROM creator_runs ORDER BY updated_at DESC'
        );
    return res.rows.map((r) => cloneRun(r.run_record));
  }

  async saveRun(record: CreatorRunRecord): Promise<void> {
    const errors = validateCreatorRunRecord(record);
    if (errors.length > 0) {
      throw new Error(`CreatorRunRecord failed schema validation: ${JSON.stringify(errors)}`);
    }
    await this.pool.query(
      `INSERT INTO creator_runs (
         run_id, profile_id, kb_id, pair_id, input_set_id, plan_id,
         state, interruption_state, run_record, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, $11::timestamptz)
       ON CONFLICT (run_id) DO UPDATE SET
         state = EXCLUDED.state,
         interruption_state = EXCLUDED.interruption_state,
         run_record = EXCLUDED.run_record,
         updated_at = EXCLUDED.updated_at`,
      [
        record.run_id,
        record.profile_id,
        record.kb_id,
        record.pair_id,
        record.input_set_id,
        record.plan_id,
        record.state,
        record.interruption_state,
        JSON.stringify(record),
        record.created_at,
        record.updated_at
      ]
    );
  }
}

/**
 * Reconciles runs left in `GENERATING` / `IN_FLIGHT` after a process crash or server restart (`R-04`).
 * Never automatically replays an interrupted provider request; retains all completed checkpoints.
 */
export async function reconcileInterruptedCreatorRuns(
  store: CreatorRunStorePort,
  now: () => Date = () => new Date()
): Promise<CreatorRunRecord[]> {
  const nowIso = now().toISOString();
  const allRuns = await store.listRuns();
  const reconciled: CreatorRunRecord[] = [];

  for (const run of allRuns) {
    const hasInFlightCall = run.provider_calls.some((c) => c.status === 'IN_FLIGHT');
    if (run.state !== 'GENERATING' && !hasInFlightCall) continue;

    for (const call of run.provider_calls) {
      if (call.status === 'IN_FLIGHT') {
        call.status = 'INTERRUPTED_ON_RESTART_OUTCOME_UNKNOWN';
        call.completed_at = nowIso;
        call.error_message =
          'Server restarted while provider call was in flight; outcome unknown (never automatically replayed).';
      }
    }

    const hasDraftRevisions =
      Boolean(run.checkpoints.active_capability_revision_id) &&
      Boolean(run.checkpoints.active_antipattern_revision_id);

    run.interruption_state = 'PROVIDER_OUTCOME_UNKNOWN';
    run.interruption_detail =
      'Provider request was interrupted by server restart; completed checkpoints are retained. Use explicit retry to continue.';
    run.state = hasDraftRevisions ? 'REVIEW_REQUIRED' : 'FAILED';
    run.updated_at = nowIso;

    await store.saveRun(run);
    reconciled.push(run);
  }

  return reconciled;
}

function withTimeoutPort(
  port: CreatorAuthorProviderPort,
  timeoutMs: number
): CreatorAuthorProviderPort {
  return async (request: ModelExecutionRequest): Promise<ModelExecutionResponse> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        port(request),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            const err = new Error(`Provider request timed out after ${timeoutMs}ms.`);
            err.name = 'ProviderTimeoutError';
            reject(err);
          }, timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ProviderTimeoutError' ||
    error.name === 'AbortError' ||
    /\btimed?\s*out\b|\babort/i.test(error.message)
  );
}

export function getActiveRunRevisions(run: CreatorRunRecord): {
  capability: DocumentRevisionRecord | null;
  antipattern: DocumentRevisionRecord | null;
} {
  const cap =
    run.revisions.find((r) => r.revision_id === run.checkpoints.active_capability_revision_id) ??
    null;
  const ap =
    run.revisions.find((r) => r.revision_id === run.checkpoints.active_antipattern_revision_id) ??
    null;
  return { capability: cap, antipattern: ap };
}

export function materializeAuthoredPairViewFromRun(
  run: CreatorRunRecord,
  runtime: ResolvedProfileRuntime,
  plan: DocumentPlan
): AuthoredPairResult | null {
  const { capability, antipattern } = getActiveRunRevisions(run);
  const sourceBundle = run.checkpoints.source_bundle;
  if (!capability || !antipattern || !sourceBundle) return null;

  const rendered = renderPairArtifacts({
    capability: capability.document,
    antipattern: antipattern.document
  });
  const validation = validateAuthoredPair({
    workUnitId: `${runtime.profile.kb_id}:unit:${run.pair_id}`,
    pairId: run.pair_id,
    capability: capability.document,
    antipattern: antipattern.document,
    runtime,
    plan,
    sourceBundle
  });
  const latestCall = [...run.provider_calls].reverse()[0];

  return {
    work_unit_id: `${runtime.profile.kb_id}:unit:${run.pair_id}`,
    pair_id: run.pair_id,
    capability: capability.document,
    antipattern: antipattern.document,
    rendered,
    validation,
    call_telemetry: {
      provider: latestCall?.provider ?? capability.document.provenance.provider,
      model: latestCall?.model ?? capability.document.provenance.model,
      prompt_hash: latestCall?.prompt_hash ?? capability.document.provenance.prompt_hash,
      latency_ms: 0,
      input_tokens: latestCall?.input_tokens ?? 0,
      output_tokens: latestCall?.output_tokens ?? 0
    }
  };
}

function invalidateHumanSignoffIfPresent(
  run: CreatorRunRecord,
  reason: string,
  nowIso: string
): void {
  if (run.checkpoints.human_review_signoff && !run.checkpoints.human_review_signoff.invalidated_at) {
    run.checkpoints.human_review_signoff = {
      ...run.checkpoints.human_review_signoff,
      invalidated_at: nowIso,
      invalidation_reason: reason
    };
  }
}

export interface StartOrResumePairRunOptions {
  store: CreatorRunStorePort;
  workspaceRoot?: string;
  runtime: ResolvedProfileRuntime;
  plan: DocumentPlan;
  pairId: string;
  authorProviderPort: CreatorAuthorProviderPort;
  reviewerProviderPort?: CreatorAuthorProviderPort;
  autoRunSemanticReview?: boolean;
  resumeRunId?: string;
  documentVersion?: string;
  enableUrlAcquisition?: boolean;
  allowPublisherTermsModelEgress?: boolean;
  pauseOnInputDrift?: boolean;
  sourceCache?: SourcePreparationCache;
  fetchPort?: HttpFetchPort;
  resolveAddresses?: HostAddressResolver;
  now?: () => Date;
}

export async function startOrResumePairRun(
  options: StartOrResumePairRunOptions
): Promise<CreatorRunRecord> {
  const { store, runtime, plan, pairId } = options;
  const now = options.now ?? (() => new Date());
  const nowIso = now().toISOString();

  let run: CreatorRunRecord;
  if (options.resumeRunId) {
    const existing = await store.getRun(options.resumeRunId);
    if (!existing) {
      throw new Error(`Cannot resume unknown Creator run "${options.resumeRunId}".`);
    }
    run = existing;
  } else {
    const runId = `run-${randomUUID()}`;
    run = {
      schema_version: '1.0.0',
      run_id: runId,
      profile_id: runtime.profile.profile_id,
      profile_version: runtime.profile.profile_version,
      kb_id: runtime.profile.kb_id,
      pair_id: pairId,
      input_set_id: runtime.inputSet.input_set_id,
      plan_id: plan.plan_id,
      state: runtime.inputSet.readiness.planning_ready ? 'READY' : 'INPUTS_REQUIRED',
      interruption_state: 'NONE',
      interruption_detail: null,
      continuation_required_reason: null,
      budgets: {
        max_tokens_per_run: runtime.profile.limits.max_tokens_per_run,
        tokens_used: 0,
        max_repair_iterations: runtime.profile.limits.max_repair_iterations,
        repair_iterations_used: 0,
        continuation_granted_iterations: 0,
        request_timeout_ms: runtime.profile.limits.request_timeout_ms
      },
      checkpoints: {
        source_bundle: null,
        active_capability_revision_id: null,
        active_antipattern_revision_id: null,
        latest_semantic_review: null,
        latest_diffs: {
          capability: null,
          antipattern: null
        },
        human_review_signoff: null,
        drift_findings: []
      },
      revisions: [],
      provider_calls: [],
      created_at: nowIso,
      updated_at: nowIso
    };
    await store.saveRun(run);
  }

  if (!runtime.inputSet.readiness.planning_ready) {
    run.state = 'INPUTS_REQUIRED';
    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return run;
  }

  // I-07: Check disk drift against pinned verified bytes.
  const driftFindings = await runtime.pinned.checkSourceDrift();
  if (driftFindings.length > 0) {
    run.checkpoints.drift_findings = driftFindings;
    if (options.pauseOnInputDrift) {
      run.interruption_state = 'INPUT_DRIFT_PAUSED';
      run.interruption_detail =
        'Disk input files changed while run was active; paused to prevent version mixing.';
      run.state = run.revisions.length > 0 ? 'REVIEW_REQUIRED' : 'READY';
      run.updated_at = now().toISOString();
      await store.saveRun(run);
      return run;
    }
  }

  // Checkpoint 1: Source preparation (reused on resume if already captured for this input_set_id).
  let sourceBundle: SourcePreparationBundle | null = run.checkpoints.source_bundle;
  if (!sourceBundle || sourceBundle.input_set_id !== runtime.inputSet.input_set_id) {
    sourceBundle = await prepareSourcesForPlan({
      workspaceRoot: options.workspaceRoot,
      runtime,
      plan,
      cache: options.sourceCache,
      enableUrlAcquisition: options.enableUrlAcquisition,
      allowPublisherTermsModelEgress: options.allowPublisherTermsModelEgress,
      fetchPort: options.fetchPort,
      resolveAddresses: options.resolveAddresses,
      now
    });
    run.checkpoints.source_bundle = sourceBundle;
    run.updated_at = now().toISOString();
    await store.saveRun(run);
  }

  if (!sourceBundle.readiness.authoring_ready) {
    run.state = 'INPUTS_REQUIRED';
    run.interruption_detail = 'Source preparation bundle is not authoring_ready.';
    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return run;
  }

  // R-05: Check token budget before starting provider call.
  if (run.budgets.tokens_used >= run.budgets.max_tokens_per_run) {
    run.interruption_state = 'BUDGET_EXHAUSTED';
    run.continuation_required_reason = `Run token budget (${run.budgets.tokens_used}/${run.budgets.max_tokens_per_run}) is exhausted; explicit continuation required.`;
    run.state = run.revisions.length > 0 ? 'REVIEW_REQUIRED' : 'READY';
    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return run;
  }

  // Record pre-call IN_FLIGHT audit fence before calling provider (`R-04`).
  const callId = `call-${randomUUID()}`;
  const inFlightCall: ProviderCallAuditRecord = {
    call_id: callId,
    stage: 'PAIR_AUTHOR',
    status: 'IN_FLIGHT',
    provider: 'CONFIGURED_PORT',
    model: runtime.profile.model_config_ref.author_role,
    prompt_hash: computeSha256(`${run.run_id}:author:${now().toISOString()}`),
    started_at: now().toISOString(),
    completed_at: null,
    input_tokens: 0,
    output_tokens: 0,
    error_message: null
  };
  run.provider_calls.push(inFlightCall);
  run.state = 'GENERATING';
  run.interruption_state = 'NONE';
  run.interruption_detail = null;
  run.updated_at = now().toISOString();
  await store.saveRun(run);

  const boundedPort = withTimeoutPort(
    options.authorProviderPort,
    run.budgets.request_timeout_ms
  );

  let authored: AuthoredPairResult;
  try {
    authored = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId,
      providerPort: boundedPort,
      documentVersion: options.documentVersion,
      now
    });
  } catch (error) {
    const timedOut = isTimeoutError(error);
    inFlightCall.status = timedOut ? 'TIMED_OUT_OUTCOME_UNKNOWN' : 'FAILED';
    inFlightCall.completed_at = now().toISOString();
    inFlightCall.error_message = error instanceof Error ? error.message : String(error);

    run.interruption_state = timedOut ? 'PROVIDER_TIMED_OUT' : 'PROVIDER_OUTCOME_UNKNOWN';
    run.interruption_detail = inFlightCall.error_message;
    run.state = run.revisions.length > 0 ? 'REVIEW_REQUIRED' : 'FAILED';
    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return run;
  }

  const callTokens =
    (authored.call_telemetry.input_tokens ?? 0) +
    (authored.call_telemetry.output_tokens ?? 0);

  inFlightCall.status = 'SUCCEEDED';
  inFlightCall.provider = authored.call_telemetry.provider;
  inFlightCall.model = authored.call_telemetry.model;
  inFlightCall.prompt_hash = authored.call_telemetry.prompt_hash;
  inFlightCall.completed_at = now().toISOString();
  inFlightCall.input_tokens = authored.call_telemetry.input_tokens ?? 0;
  inFlightCall.output_tokens = authored.call_telemetry.output_tokens ?? 0;

  run.budgets.tokens_used += callTokens;

  const nextCapRevNum =
    run.revisions.filter((r) => r.object_type === 'capability').length + 1;
  const nextApRevNum =
    run.revisions.filter((r) => r.object_type === 'antipattern').length + 1;

  const capRevId = `${run.run_id}:${authored.capability.object_id}:r${nextCapRevNum}`;
  const apRevId = `${run.run_id}:${authored.antipattern.object_id}:r${nextApRevNum}`;

  const capRevRecord: DocumentRevisionRecord = {
    revision_id: capRevId,
    object_id: authored.capability.object_id,
    object_type: 'capability',
    revision_number: nextCapRevNum,
    origin: 'INITIAL_AUTHOR',
    parent_revision_id: run.checkpoints.active_capability_revision_id,
    created_at: now().toISOString(),
    document: authored.capability,
    rendered: authored.rendered.capability,
    deterministic_validation: authored.validation.capability
  };

  const apRevRecord: DocumentRevisionRecord = {
    revision_id: apRevId,
    object_id: authored.antipattern.object_id,
    object_type: 'antipattern',
    revision_number: nextApRevNum,
    origin: 'INITIAL_AUTHOR',
    parent_revision_id: run.checkpoints.active_antipattern_revision_id,
    created_at: now().toISOString(),
    document: authored.antipattern,
    rendered: authored.rendered.antipattern,
    deterministic_validation: authored.validation.antipattern
  };

  run.revisions.push(capRevRecord, apRevRecord);
  run.checkpoints.active_capability_revision_id = capRevId;
  run.checkpoints.active_antipattern_revision_id = apRevId;
  invalidateHumanSignoffIfPresent(
    run,
    'New authored draft revision superseded prior review.',
    now().toISOString()
  );
  run.state = 'REVIEW_REQUIRED';
  run.updated_at = now().toISOString();
  await store.saveRun(run);

  if (options.autoRunSemanticReview || options.reviewerProviderPort) {
    return executeSemanticReviewForRun({
      store,
      runId: run.run_id,
      runtime,
      reviewerProviderPort: options.reviewerProviderPort,
      now
    });
  }

  return run;
}

export async function executeSemanticReviewForRun(options: {
  store: CreatorRunStorePort;
  runId: string;
  runtime: ResolvedProfileRuntime;
  reviewerProviderPort?: CreatorAuthorProviderPort;
  now?: () => Date;
}): Promise<CreatorRunRecord> {
  const { store, runtime } = options;
  const now = options.now ?? (() => new Date());
  const run = await store.getRun(options.runId);
  if (!run) {
    throw new Error(`Unknown Creator run "${options.runId}".`);
  }

  const { capability, antipattern } = getActiveRunRevisions(run);
  const sourceBundle = run.checkpoints.source_bundle;
  if (!capability || !antipattern || !sourceBundle) {
    throw new Error(`Run "${options.runId}" has no active draft revisions to review.`);
  }

  let inFlightCall: ProviderCallAuditRecord | undefined;
  let boundedReviewerPort: CreatorAuthorProviderPort | undefined;

  if (options.reviewerProviderPort) {
    if (run.budgets.tokens_used >= run.budgets.max_tokens_per_run) {
      run.interruption_state = 'BUDGET_EXHAUSTED';
      run.continuation_required_reason = `Run token budget (${run.budgets.tokens_used}/${run.budgets.max_tokens_per_run}) is exhausted before semantic review.`;
      run.updated_at = now().toISOString();
      await store.saveRun(run);
      return run;
    }

    inFlightCall = {
      call_id: `call-${randomUUID()}`,
      stage: 'SEMANTIC_REVIEW',
      status: 'IN_FLIGHT',
      provider: 'CONFIGURED_PORT',
      model: runtime.profile.model_config_ref.reviewer_role,
      prompt_hash: computeSha256(`${run.run_id}:review:${now().toISOString()}`),
      started_at: now().toISOString(),
      completed_at: null,
      input_tokens: 0,
      output_tokens: 0,
      error_message: null
    };
    run.provider_calls.push(inFlightCall);
    run.state = 'GENERATING';
    run.updated_at = now().toISOString();
    await store.saveRun(run);

    boundedReviewerPort = withTimeoutPort(
      options.reviewerProviderPort,
      run.budgets.request_timeout_ms
    );
  }

  try {
    const { review, callTelemetry } = await reviewAuthoredPair({
      runtime,
      capability: capability.document,
      antipattern: antipattern.document,
      capabilityRevisionId: capability.revision_id,
      antipatternRevisionId: antipattern.revision_id,
      sourceBundle,
      reviewerProviderPort: boundedReviewerPort,
      now
    });

    if (inFlightCall) {
      inFlightCall.status = 'SUCCEEDED';
      inFlightCall.provider = callTelemetry.provider;
      inFlightCall.model = callTelemetry.model;
      inFlightCall.prompt_hash = callTelemetry.promptHash;
      inFlightCall.completed_at = now().toISOString();
      inFlightCall.input_tokens = callTelemetry.inputTokens;
      inFlightCall.output_tokens = callTelemetry.outputTokens;
      run.budgets.tokens_used += callTelemetry.inputTokens + callTelemetry.outputTokens;
    }

    run.checkpoints.latest_semantic_review = review;
    if (review.blocking_defect_count > 0 || review.rejected_reviewer_attempts.length > 0) {
      invalidateHumanSignoffIfPresent(
        run,
        'Semantic review reported blocking defects.',
        now().toISOString()
      );
      run.state = 'REVIEW_REQUIRED';
    } else if (
      run.checkpoints.human_review_signoff &&
      !run.checkpoints.human_review_signoff.invalidated_at &&
      run.checkpoints.human_review_signoff.capability_revision_id === capability.revision_id &&
      run.checkpoints.human_review_signoff.antipattern_revision_id === antipattern.revision_id
    ) {
      run.state = 'READY_TO_DELIVER';
    } else {
      run.state = 'REVIEW_REQUIRED';
    }

    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return run;
  } catch (error) {
    if (inFlightCall) {
      const timedOut = isTimeoutError(error);
      inFlightCall.status = timedOut ? 'TIMED_OUT_OUTCOME_UNKNOWN' : 'FAILED';
      inFlightCall.completed_at = now().toISOString();
      inFlightCall.error_message = error instanceof Error ? error.message : String(error);
      run.interruption_state = timedOut ? 'PROVIDER_TIMED_OUT' : 'PROVIDER_OUTCOME_UNKNOWN';
      run.interruption_detail = inFlightCall.error_message;
    }
    run.state = 'REVIEW_REQUIRED';
    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return run;
  }
}

export async function applyDirectEditToRun(options: {
  store: CreatorRunStorePort;
  runId: string;
  objectId: string;
  sectionPatches: ReadonlyArray<DirectSectionEditPatch>;
  sourcedClaimsOverride?: ReadonlyArray<ModelClaimDraft>;
  runtime: ResolvedProfileRuntime;
  plan: DocumentPlan;
  now?: () => Date;
}): Promise<CreatorRunRecord> {
  const { store, runtime, plan } = options;
  const now = options.now ?? (() => new Date());
  const nowIso = now().toISOString();

  const run = await store.getRun(options.runId);
  if (!run) {
    throw new Error(`Unknown Creator run "${options.runId}".`);
  }

  const { capability, antipattern } = getActiveRunRevisions(run);
  const sourceBundle = run.checkpoints.source_bundle;
  if (!capability || !antipattern || !sourceBundle) {
    throw new Error(`Run "${options.runId}" has no active draft revisions to edit.`);
  }

  const targetRev =
    capability.object_id === options.objectId
      ? capability
      : antipattern.object_id === options.objectId
        ? antipattern
        : null;
  if (!targetRev) {
    throw new Error(
      `Object "${options.objectId}" is not part of run "${options.runId}" (${capability.object_id} / ${antipattern.object_id}).`
    );
  }

  const plannedDoc = plan.documents.find((d) => d.object_id === targetRev.object_id);
  if (!plannedDoc) {
    throw new Error(`PlannedDocument not found for "${targetRev.object_id}".`);
  }

  const nextRevNumber =
    run.revisions.filter((r) => r.object_id === targetRev.object_id).length + 1;
  const nextRevId = `${run.run_id}:${targetRev.object_id}:r${nextRevNumber}`;

  const edited = applyDirectHumanEdit({
    currentDoc: targetRev.document,
    fromRevisionId: targetRev.revision_id,
    toRevisionId: nextRevId,
    sectionPatches: options.sectionPatches,
    sourcedClaimsOverride: options.sourcedClaimsOverride,
    plannedDoc,
    runtime,
    plan,
    sourceBundle,
    now
  });

  const newRevRecord: DocumentRevisionRecord = {
    revision_id: nextRevId,
    object_id: targetRev.object_id,
    object_type: targetRev.object_type,
    revision_number: nextRevNumber,
    origin: 'DIRECT_HUMAN_EDIT',
    parent_revision_id: targetRev.revision_id,
    created_at: nowIso,
    document: edited.document,
    rendered: edited.rendered,
    deterministic_validation: edited.validation
  };

  run.revisions.push(newRevRecord);
  if (targetRev.object_type === 'capability') {
    run.checkpoints.active_capability_revision_id = nextRevId;
    run.checkpoints.latest_diffs.capability = edited.diff;
    if (antipattern.document.creation_review_state === 'READY_TO_DELIVER') {
      antipattern.document.creation_review_state = 'REVIEW_REQUIRED';
    }
  } else {
    run.checkpoints.active_antipattern_revision_id = nextRevId;
    run.checkpoints.latest_diffs.antipattern = edited.diff;
    if (capability.document.creation_review_state === 'READY_TO_DELIVER') {
      capability.document.creation_review_state = 'REVIEW_REQUIRED';
    }
  }

  // R-03: Editing reviewed content invalidates old review and requires fresh review before delivery!
  invalidateHumanSignoffIfPresent(
    run,
    `Document "${targetRev.object_id}" was edited after review (${targetRev.revision_id} -> ${nextRevId}); fresh review required (R-03).`,
    nowIso
  );
  run.state = 'REVIEW_REQUIRED';
  run.updated_at = nowIso;
  await store.saveRun(run);
  return run;
}

export async function executeTargetedRepairForRun(options: {
  store: CreatorRunStorePort;
  runId: string;
  objectId: string;
  targetSectionIds: ReadonlyArray<string>;
  declaredDependencySectionIds?: ReadonlyArray<string>;
  operatorInstruction?: string;
  runtime: ResolvedProfileRuntime;
  plan: DocumentPlan;
  repairProviderPort: CreatorAuthorProviderPort;
  now?: () => Date;
}): Promise<{ run: CreatorRunRecord; budgetExhausted: boolean }> {
  const { store, runtime, plan } = options;
  const now = options.now ?? (() => new Date());
  const nowIso = now().toISOString();

  const run = await store.getRun(options.runId);
  if (!run) {
    throw new Error(`Unknown Creator run "${options.runId}".`);
  }

  const { capability, antipattern } = getActiveRunRevisions(run);
  const sourceBundle = run.checkpoints.source_bundle;
  if (!capability || !antipattern || !sourceBundle) {
    throw new Error(`Run "${options.runId}" has no active draft revisions to repair.`);
  }

  const targetRev =
    capability.object_id === options.objectId
      ? capability
      : antipattern.object_id === options.objectId
        ? antipattern
        : null;
  if (!targetRev) {
    throw new Error(`Object "${options.objectId}" is not part of run "${options.runId}".`);
  }

  // R-05: Default is 1 targeted repair pass before requiring explicit operator continuation,
  // bounded by profile max_repair_iterations and max_tokens_per_run.
  const basePassAllowance = Math.min(run.budgets.max_repair_iterations, 1);
  const allowedPasses = basePassAllowance + run.budgets.continuation_granted_iterations;

  if (run.budgets.repair_iterations_used >= allowedPasses) {
    run.interruption_state = 'BUDGET_EXHAUSTED';
    run.continuation_required_reason = `Targeted repair iteration limit reached (${run.budgets.repair_iterations_used}/${allowedPasses} passes used); explicit operator continuation required before another repair pass (R-05).`;
    run.state = 'REVIEW_REQUIRED';
    run.updated_at = nowIso;
    await store.saveRun(run);
    return { run, budgetExhausted: true };
  }

  if (run.budgets.tokens_used >= run.budgets.max_tokens_per_run) {
    run.interruption_state = 'BUDGET_EXHAUSTED';
    run.continuation_required_reason = `Run token budget reached (${run.budgets.tokens_used}/${run.budgets.max_tokens_per_run} tokens); explicit operator continuation required (R-05).`;
    run.state = 'REVIEW_REQUIRED';
    run.updated_at = nowIso;
    await store.saveRun(run);
    return { run, budgetExhausted: true };
  }

  const plannedDoc = plan.documents.find((d) => d.object_id === targetRev.object_id);
  if (!plannedDoc) {
    throw new Error(`PlannedDocument not found for "${targetRev.object_id}".`);
  }

  const nextRevNumber =
    run.revisions.filter((r) => r.object_id === targetRev.object_id).length + 1;
  const nextRevId = `${run.run_id}:${targetRev.object_id}:r${nextRevNumber}`;

  const inFlightCall: ProviderCallAuditRecord = {
    call_id: `call-${randomUUID()}`,
    stage: 'TARGETED_REPAIR',
    status: 'IN_FLIGHT',
    provider: 'CONFIGURED_PORT',
    model: runtime.profile.model_config_ref.author_role,
    prompt_hash: computeSha256(`${run.run_id}:repair:${nextRevId}:${nowIso}`),
    started_at: nowIso,
    completed_at: null,
    input_tokens: 0,
    output_tokens: 0,
    error_message: null
  };
  run.provider_calls.push(inFlightCall);
  run.state = 'GENERATING';
  run.interruption_state = 'NONE';
  run.interruption_detail = null;
  run.updated_at = nowIso;
  await store.saveRun(run);

  const boundedPort = withTimeoutPort(
    options.repairProviderPort,
    run.budgets.request_timeout_ms
  );

  const relevantDefects =
    run.checkpoints.latest_semantic_review?.defects.filter(
      (d) => d.object_id === targetRev.object_id
    ) ?? [];

  try {
    const repaired = await applyTargetedSectionRepair({
      currentDoc: targetRev.document,
      fromRevisionId: targetRev.revision_id,
      toRevisionId: nextRevId,
      targetSectionIds: options.targetSectionIds,
      declaredDependencySectionIds: options.declaredDependencySectionIds,
      defectsToResolve: relevantDefects,
      operatorInstruction: options.operatorInstruction,
      plannedDoc,
      runtime,
      plan,
      sourceBundle,
      repairProviderPort: boundedPort,
      now
    });

    inFlightCall.status = 'SUCCEEDED';
    inFlightCall.provider = repaired.callTelemetry.provider;
    inFlightCall.model = repaired.callTelemetry.model;
    inFlightCall.prompt_hash = repaired.callTelemetry.promptHash;
    inFlightCall.completed_at = now().toISOString();
    inFlightCall.input_tokens = repaired.callTelemetry.inputTokens;
    inFlightCall.output_tokens = repaired.callTelemetry.outputTokens;

    run.budgets.repair_iterations_used += 1;
    run.budgets.tokens_used +=
      repaired.callTelemetry.inputTokens + repaired.callTelemetry.outputTokens;

    const newRevRecord: DocumentRevisionRecord = {
      revision_id: nextRevId,
      object_id: targetRev.object_id,
      object_type: targetRev.object_type,
      revision_number: nextRevNumber,
      origin: 'TARGETED_REPAIR',
      parent_revision_id: targetRev.revision_id,
      created_at: now().toISOString(),
      document: repaired.document,
      rendered: repaired.rendered,
      deterministic_validation: repaired.validation
    };

    run.revisions.push(newRevRecord);
    if (targetRev.object_type === 'capability') {
      run.checkpoints.active_capability_revision_id = nextRevId;
      run.checkpoints.latest_diffs.capability = repaired.diff;
      if (antipattern.document.creation_review_state === 'READY_TO_DELIVER') {
        antipattern.document.creation_review_state = 'REVIEW_REQUIRED';
      }
    } else {
      run.checkpoints.active_antipattern_revision_id = nextRevId;
      run.checkpoints.latest_diffs.antipattern = repaired.diff;
      if (capability.document.creation_review_state === 'READY_TO_DELIVER') {
        capability.document.creation_review_state = 'REVIEW_REQUIRED';
      }
    }

    invalidateHumanSignoffIfPresent(
      run,
      `Targeted repair created new revision "${nextRevId}"; fresh review required (R-03).`,
      now().toISOString()
    );
    run.state = 'REVIEW_REQUIRED';
    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return { run, budgetExhausted: false };
  } catch (error) {
    const timedOut = isTimeoutError(error);
    inFlightCall.status = timedOut ? 'TIMED_OUT_OUTCOME_UNKNOWN' : 'FAILED';
    inFlightCall.completed_at = now().toISOString();
    inFlightCall.error_message = error instanceof Error ? error.message : String(error);

    run.interruption_state = timedOut ? 'PROVIDER_TIMED_OUT' : 'PROVIDER_OUTCOME_UNKNOWN';
    run.interruption_detail = inFlightCall.error_message;
    run.state = 'REVIEW_REQUIRED';
    run.updated_at = now().toISOString();
    await store.saveRun(run);
    return { run, budgetExhausted: false };
  }
}

export async function grantCreatorRunContinuation(options: {
  store: CreatorRunStorePort;
  runId: string;
  additionalRepairIterations?: number;
  additionalTokens?: number;
  now?: () => Date;
}): Promise<CreatorRunRecord> {
  const nowIso = (options.now ?? (() => new Date()))().toISOString();
  const run = await options.store.getRun(options.runId);
  if (!run) {
    throw new Error(`Unknown Creator run "${options.runId}".`);
  }

  const addIters = Math.max(0, options.additionalRepairIterations ?? 1);
  const addTokens = Math.max(0, options.additionalTokens ?? 0);

  run.budgets.continuation_granted_iterations += addIters;
  run.budgets.max_tokens_per_run += addTokens;
  run.interruption_state = 'NONE';
  run.continuation_required_reason = null;
  run.updated_at = nowIso;

  await options.store.saveRun(run);
  return run;
}

export async function recordHumanCreationReview(options: {
  store: CreatorRunStorePort;
  runId: string;
  reviewedBy: string;
  note?: string;
  now?: () => Date;
}): Promise<
  | { ok: true; run: CreatorRunRecord }
  | { ok: false; code: string; message: string; run: CreatorRunRecord }
> {
  const nowIso = (options.now ?? (() => new Date()))().toISOString();
  const run = await options.store.getRun(options.runId);
  if (!run) {
    throw new Error(`Unknown Creator run "${options.runId}".`);
  }

  const { capability, antipattern } = getActiveRunRevisions(run);
  if (!capability || !antipattern) {
    return {
      ok: false,
      code: 'MISSING_ACTIVE_REVISIONS',
      message: 'Cannot approve creation review without active capability and anti-pattern revisions.',
      run
    };
  }

  if (
    !capability.deterministic_validation.draft_valid ||
    !antipattern.deterministic_validation.draft_valid ||
    !capability.deterministic_validation.delivery_ready ||
    !antipattern.deterministic_validation.delivery_ready
  ) {
    return {
      ok: false,
      code: 'DETERMINISTIC_BLOCKERS_OPEN',
      message:
        'Cannot mark READY_TO_DELIVER while deterministic validation findings or unresolved delivery blockers remain open.',
      run
    };
  }

  const semReview = run.checkpoints.latest_semantic_review;
  const semReviewMatchesCurrentRevs =
    semReview &&
    semReview.capability_revision_id === capability.revision_id &&
    semReview.antipattern_revision_id === antipattern.revision_id;

  if (semReviewMatchesCurrentRevs && semReview.blocking_defect_count > 0) {
    return {
      ok: false,
      code: 'SEMANTIC_REVIEW_DEFECTS_OPEN',
      message: `Cannot mark READY_TO_DELIVER while ${semReview.blocking_defect_count} blocking semantic review defect(s) remain unresolved.`,
      run
    };
  }

  capability.document.creation_review_state = 'READY_TO_DELIVER';
  antipattern.document.creation_review_state = 'READY_TO_DELIVER';

  run.checkpoints.human_review_signoff = {
    reviewed_by: options.reviewedBy.trim(),
    reviewed_at: nowIso,
    note:
      options.note?.trim() ||
      'Creation review confirmed for delivery; Knowledge Hub approval remains separate.',
    capability_revision_id: capability.revision_id,
    antipattern_revision_id: antipattern.revision_id,
    capability_content_sha256: capability.document.provenance.content_sha256,
    antipattern_content_sha256: antipattern.document.provenance.content_sha256,
    invalidated_at: null,
    invalidation_reason: null
  };

  run.state = 'READY_TO_DELIVER';
  run.interruption_state = 'NONE';
  run.interruption_detail = null;
  run.updated_at = nowIso;

  await options.store.saveRun(run);
  return { ok: true, run };
}

export async function cancelCreatorRun(options: {
  store: CreatorRunStorePort;
  runId: string;
  reason?: string;
  now?: () => Date;
}): Promise<CreatorRunRecord> {
  const nowIso = (options.now ?? (() => new Date()))().toISOString();
  const run = await options.store.getRun(options.runId);
  if (!run) {
    throw new Error(`Unknown Creator run "${options.runId}".`);
  }

  for (const call of run.provider_calls) {
    if (call.status === 'IN_FLIGHT') {
      call.status = 'CANCELLED';
      call.completed_at = nowIso;
      call.error_message = options.reason?.trim() || 'Cancelled by operator.';
    }
  }

  run.state = 'CANCELLED';
  run.interruption_state = 'CANCELLED_BY_OPERATOR';
  run.interruption_detail =
    options.reason?.trim() || 'Run cancelled by operator; completed checkpoints retained.';
  run.updated_at = nowIso;

  await options.store.saveRun(run);
  return run;
}
