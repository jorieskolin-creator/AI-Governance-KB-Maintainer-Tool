import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createLiveAiAuthorPort,
  type AuthoredPairResult,
  type CreatorAuthorProviderPort,
  type ModelClaimDraft
} from './author.js';
import type {
  CreatorDeliveryMode,
  CreatorReviewCadence,
  DocumentPlanSelection,
  KbProfile
} from './contracts.js';
import {
  deliverReviewedCreatorRun,
  DeliveryStorageError,
  inspectDeliveredHandoff,
  type StorageWriteHookContext
} from './delivery.js';
import { createDocumentPlan, DocumentPlanError } from './plan.js';
import {
  buildProfileFromInventoryFile,
  buildSaeLocalPilotProfile,
  resolveProfileInputSet
} from './profiles.js';
import type { DirectSectionEditPatch } from './repair.js';
import {
  renderDeliveryViewHtml,
  renderDocumentPlanViewHtml,
  renderDocumentsPreviewViewHtml,
  renderHistoryViewHtml,
  renderInputsViewHtml,
  renderLoginViewHtml,
  renderSourcePreparationViewHtml
} from './render-ui.js';
import {
  prepareSourcesForPlan,
  SourcePreparationCache,
  type HostAddressResolver,
  type HttpFetchPort
} from './sources.js';
import {
  applyDirectEditToRun,
  applyMarkdownEditToRun,
  cancelCreatorRun,
  CreatorWorkspaceSession,
  executeCreatorBatch,
  executeSemanticReviewForRun,
  executeTargetedRepairForRun,
  grantCreatorRunContinuation,
  InMemoryCreatorRunStore,
  materializeAuthoredPairViewFromRun,
  recordHumanCreationReview,
  regeneratePairFromNewInputs,
  startOrResumePairRun,
  type CreatorRunStorePort
} from './store.js';
import { buildCreatorRunsZipExport } from './zip-export.js';

export class PairDraftMemoryStore {
  private readonly drafts = new Map<string, AuthoredPairResult>();

  private key(profileId: string, pairId: string): string {
    return `${profileId}:${pairId}`;
  }

  get(profileId: string, pairId: string): AuthoredPairResult | undefined {
    const found = this.drafts.get(this.key(profileId, pairId));
    return found ? (JSON.parse(JSON.stringify(found)) as AuthoredPairResult) : undefined;
  }

  set(profileId: string, pairId: string, result: AuthoredPairResult): string {
    const k = this.key(profileId, pairId);
    this.drafts.set(k, JSON.parse(JSON.stringify(result)) as AuthoredPairResult);
    return k;
  }

  clear(): void {
    this.drafts.clear();
  }
}

export interface CreatorRouteOptions {
  workspaceRoot?: string;
  operatorToken?: string | (() => string | undefined);
  profiles?: ReadonlyArray<KbProfile | (() => Promise<KbProfile>)>;
  redirectRootToCreator?: boolean;
  sourceCache?: SourcePreparationCache;
  draftStore?: PairDraftMemoryStore;
  runStore?: CreatorRunStorePort;
  workspaceSession?: CreatorWorkspaceSession;
  allowLiveSourceFetch?: boolean;
  fetchPort?: HttpFetchPort;
  resolveAddresses?: HostAddressResolver;
  authorProviderPort?: CreatorAuthorProviderPort;
  reviewerProviderPort?: CreatorAuthorProviderPort;
  repairProviderPort?: CreatorAuthorProviderPort;
  allowLiveAuthoring?: boolean;
  beforeStorageWriteHook?: (ctx: StorageWriteHookContext) => Promise<void> | void;
}

function sha256Buffer(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function buildSessionCookieSignature(expectedToken: string): string {
  return createHmac('sha256', expectedToken)
    .update('kb-document-creator-operator-session-v1', 'utf8')
    .digest('hex');
}

function extractSessionCookieValue(request: FastifyRequest): string | null {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === 'creator_session') {
      const value = rest.join('=').trim();
      if (value) return value;
    }
  }
  return null;
}

function extractRequestToken(request: FastifyRequest, expectedToken?: string): string | null {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  const customHeader = request.headers['x-creator-token'];
  if (typeof customHeader === 'string' && customHeader.trim().length > 0) {
    return customHeader.trim();
  }
  if (expectedToken) {
    const sessionSig = extractSessionCookieValue(request);
    const expectedSig = buildSessionCookieSignature(expectedToken);
    if (
      sessionSig &&
      sessionSig.length === expectedSig.length &&
      timingSafeEqual(Buffer.from(sessionSig, 'utf8'), Buffer.from(expectedSig, 'utf8'))
    ) {
      return expectedToken;
    }
  }
  return null;
}

function resolveExpectedToken(configured: CreatorRouteOptions['operatorToken']): string | undefined {
  if (typeof configured === 'function') {
    return configured()?.trim() || undefined;
  }
  if (typeof configured === 'string') {
    return configured.trim() || undefined;
  }
  return process.env.CREATOR_OPERATOR_TOKEN?.trim() || undefined;
}

function authorizeCreatorRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  configuredToken: CreatorRouteOptions['operatorToken']
): boolean {
  const expected = resolveExpectedToken(configuredToken);
  if (!expected) {
    void reply.code(503).send({
      error: 'CREATOR_AUTH_NOT_CONFIGURED',
      message: 'Creator operator authorization is not configured on this server.'
    });
    return false;
  }
  const provided = extractRequestToken(request, expected);
  if (!provided) {
    void reply.code(401).header('WWW-Authenticate', 'Bearer realm="kb-document-creator"').send({
      error: 'UNAUTHORIZED',
      message: 'Valid Creator operator authorization is required.'
    });
    return false;
  }
  const expectedDigest = sha256Buffer(expected);
  const providedDigest = sha256Buffer(provided);
  if (!timingSafeEqual(expectedDigest, providedDigest)) {
    void reply.code(401).header('WWW-Authenticate', 'Bearer realm="kb-document-creator"').send({
      error: 'UNAUTHORIZED',
      message: 'Valid Creator operator authorization is required.'
    });
    return false;
  }
  return true;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSelectionBody(raw: unknown): DocumentPlanSelection {
  if (!isObjectRecord(raw)) {
    throw new DocumentPlanError('INVALID_PLAN_SELECTION', 'Plan selection must be a JSON object.');
  }
  const mode = raw.mode;
  if (mode !== 'pair' && mode !== 'domain' && mode !== 'explicit' && mode !== 'all') {
    throw new DocumentPlanError(
      'INVALID_PLAN_SELECTION',
      'selection.mode must be one of "pair", "domain", "explicit", or "all".'
    );
  }
  const toStrings = (field: unknown, name: string): string[] | undefined => {
    if (field === undefined) return undefined;
    if (!Array.isArray(field) || !field.every((item) => typeof item === 'string' && item.trim().length > 0)) {
      throw new DocumentPlanError('INVALID_PLAN_SELECTION', `selection.${name} must be an array of non-empty strings.`);
    }
    return field.map((item) => item.trim());
  };
  if (raw.include_tactics !== undefined && typeof raw.include_tactics !== 'boolean') {
    throw new DocumentPlanError('INVALID_PLAN_SELECTION', 'selection.include_tactics must be a boolean.');
  }
  return {
    mode,
    pair_ids: toStrings(raw.pair_ids, 'pair_ids'),
    domain_ids: toStrings(raw.domain_ids, 'domain_ids'),
    object_ids: toStrings(raw.object_ids, 'object_ids'),
    include_tactics: raw.include_tactics,
    tactic_ids: toStrings(raw.tactic_ids, 'tactic_ids')
  };
}

export function registerCreatorRoutes(app: FastifyInstance, options: CreatorRouteOptions = {}): void {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const sourceCache = options.sourceCache ?? new SourcePreparationCache();
  const draftStore = options.draftStore ?? new PairDraftMemoryStore();
  const runStore = options.runStore ?? new InMemoryCreatorRunStore();
  const workspaceSession = options.workspaceSession ?? new CreatorWorkspaceSession();
  const profileProviders: ReadonlyArray<KbProfile | (() => Promise<KbProfile>)> =
    options.profiles ?? [() => buildSaeLocalPilotProfile(workspaceRoot)];

  const parseReviewCadence = (raw: unknown): CreatorReviewCadence | undefined => {
    if (
      raw === 'FINAL_REVIEW_ONLY' ||
      raw === 'PAUSE_AFTER_DOMAIN' ||
      raw === 'PAUSE_AFTER_PAIR'
    ) {
      return raw;
    }
    return undefined;
  };

  const parseDeliveryMode = (raw: unknown): CreatorDeliveryMode | undefined => {
    if (raw === 'STORAGE' || raw === 'ZIP') {
      return raw;
    }
    return undefined;
  };

  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_req, body, done) => {
        const params = new URLSearchParams(typeof body === 'string' ? body : String(body));
        const parsed: Record<string, string> = {};
        for (const [k, v] of params.entries()) {
          parsed[k] = v;
        }
        done(null, parsed);
      }
    );
  }

  const resolveAuthorPort = (selectedProfile: KbProfile): CreatorAuthorProviderPort | null => {
    if (options.authorProviderPort) {
      return options.authorProviderPort;
    }
    if (options.allowLiveAuthoring || process.env.CREATOR_ALLOW_LIVE_AUTHORING === 'true') {
      return createLiveAiAuthorPort(selectedProfile.model_config_ref.author_role);
    }
    return null;
  };

  const resolveReviewerPort = (selectedProfile: KbProfile): CreatorAuthorProviderPort | undefined => {
    if (options.reviewerProviderPort) {
      return options.reviewerProviderPort;
    }
    if (options.allowLiveAuthoring || process.env.CREATOR_ALLOW_LIVE_AUTHORING === 'true') {
      return createLiveAiAuthorPort(selectedProfile.model_config_ref.reviewer_role);
    }
    return undefined;
  };

  const resolveRepairPort = (selectedProfile: KbProfile): CreatorAuthorProviderPort | null => {
    if (options.repairProviderPort) {
      return options.repairProviderPort;
    }
    return resolveAuthorPort(selectedProfile);
  };

  const loadProfiles = async (): Promise<KbProfile[]> => {
    const loaded: KbProfile[] = [];
    for (const provider of profileProviders) {
      loaded.push(typeof provider === 'function' ? await provider() : provider);
    }
    for (const custom of workspaceSession.listCustomProfiles()) {
      const existingIdx = loaded.findIndex((p) => p.profile_id === custom.profile_id);
      if (existingIdx >= 0) {
        loaded[existingIdx] = custom;
      } else {
        loaded.push(custom);
      }
    }
    return loaded;
  };

  app.get('/creator/login', async (_request, reply) => {
    return reply
      .header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type('text/html; charset=utf-8')
      .send(renderLoginViewHtml());
  });

  app.post('/creator/login', async (request, reply) => {
    const expected = resolveExpectedToken(options.operatorToken);
    if (!expected) {
      return reply.code(503).send({
        error: 'CREATOR_AUTH_NOT_CONFIGURED',
        message: 'Creator operator authorization is not configured on this server.'
      });
    }
    const body = isObjectRecord(request.body) ? request.body : {};
    const provided = typeof body.token === 'string' ? body.token.trim() : '';
    if (
      !provided ||
      !timingSafeEqual(sha256Buffer(expected), sha256Buffer(provided))
    ) {
      return reply
        .code(401)
        .header(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
        )
        .type('text/html; charset=utf-8')
        .send(renderLoginViewHtml({ errorMessage: 'Invalid operator token.' }));
    }
    const sig = buildSessionCookieSignature(expected);
    return reply
      .header(
        'Set-Cookie',
        `creator_session=${sig}; Path=/; HttpOnly; SameSite=Lax`
      )
      .redirect('/creator');
  });

  app.post('/creator/logout', async (_request, reply) => {
    return reply
      .header(
        'Set-Cookie',
        'creator_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'
      )
      .redirect('/creator/login');
  });

  if (options.redirectRootToCreator) {
    app.get('/', async (request, reply) => {
      if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
      return reply.redirect('/creator');
    });
  }

  app.get('/creator', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const workspaceSnapshot = await workspaceSession.getSnapshot(runStore);
    const query = isObjectRecord(request.query) ? request.query : {};
    const requestedProfileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : workspaceSnapshot.latest_run?.profile_id ?? profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }
    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderInputsViewHtml({
          profiles,
          selectedProfileId: selected.profile_id,
          inputSet: runtime.inputSet,
          workspaceSnapshot,
          statusMessage:
            typeof query.status === 'string' && query.status.trim()
              ? query.status.trim()
              : undefined
        })
      );
  });

  app.get('/api/creator/workspace', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const snapshot = await workspaceSession.getSnapshot(runStore);
    return reply.code(200).send({ workspace: snapshot });
  });

  app.post('/creator/reset', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    await workspaceSession.resetWorkspace({
      store: runStore,
      onClearCaches: () => {
        draftStore.clear();
        sourceCache.clear();
      }
    });
    return reply.redirect(
      '/creator?status=' +
        encodeURIComponent(
          'Workspace reset complete. All active UI items cleared — configure input materials and storage to start from zero.'
        )
    );
  });

  app.post('/api/creator/reset', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const result = await workspaceSession.resetWorkspace({
      store: runStore,
      onClearCaches: () => {
        draftStore.clear();
        sourceCache.clear();
      }
    });
    const snapshot = await workspaceSession.getSnapshot(runStore);
    return reply.code(200).send({
      reset: true,
      cancelled_run_ids: result.cancelled_run_ids,
      workspace: snapshot
    });
  });

  const handleWorkspaceSetup = async (
    body: Record<string, unknown>
  ): Promise<{ profile: KbProfile; snapshot: Awaited<ReturnType<CreatorWorkspaceSession['getSnapshot']>> }> => {
    const cadence = parseReviewCadence(body.reviewCadence);
    const delivMode = parseDeliveryMode(body.deliveryMode);
    workspaceSession.setPreferences({
      reviewCadence: cadence,
      deliveryMode: delivMode
    });

    const inventoryPath =
      typeof body.inventoryPath === 'string' ? body.inventoryPath.trim() : '';
    const outputRoot =
      typeof body.outputRoot === 'string' ? body.outputRoot.trim() : '';
    const customProfileId =
      typeof body.customProfileId === 'string' && body.customProfileId.trim()
        ? body.customProfileId.trim()
        : 'custom-pilot-profile';
    const kbId =
      typeof body.kbId === 'string' && body.kbId.trim()
        ? body.kbId.trim()
        : 'solution-assurance-engine';
    const kbTitle =
      typeof body.kbTitle === 'string' && body.kbTitle.trim()
        ? body.kbTitle.trim()
        : 'Solution Assurance Engine Knowledge Base';

    let selectedProfile: KbProfile;
    if (inventoryPath && outputRoot) {
      selectedProfile = await buildProfileFromInventoryFile({
        workspaceRoot,
        inventoryPath,
        profileId: customProfileId,
        kbId,
        kbTitle,
        outputRoot
      });
      workspaceSession.registerCustomProfile(selectedProfile);
    } else {
      const profiles = await loadProfiles();
      selectedProfile = profiles[0]!;
    }

    const snapshot = await workspaceSession.getSnapshot(runStore);
    return { profile: selectedProfile, snapshot };
  };

  app.post('/creator/setup', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    try {
      const { profile } = await handleWorkspaceSetup(body);
      return reply.redirect(
        `/creator?profileId=${encodeURIComponent(profile.profile_id)}&status=${encodeURIComponent('Setup applied and inputs validated.')}`
      );
    } catch (error) {
      return reply.code(400).send({
        error: 'INVALID_WORKSPACE_SETUP',
        message: error instanceof Error ? error.message : 'Invalid workspace setup parameters.'
      });
    }
  });

  app.post('/api/creator/setup', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    try {
      const { profile, snapshot } = await handleWorkspaceSetup(body);
      const runtime = await resolveProfileInputSet({ workspaceRoot, profile });
      return reply.code(runtime.inputSet.readiness.planning_ready ? 200 : 422).send({
        profile_id: profile.profile_id,
        inputSet: runtime.inputSet,
        workspace: snapshot
      });
    } catch (error) {
      return reply.code(400).send({
        error: 'INVALID_WORKSPACE_SETUP',
        message: error instanceof Error ? error.message : 'Invalid workspace setup parameters.'
      });
    }
  });

  app.get('/creator/plan', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const query = isObjectRecord(request.query) ? request.query : {};
    const requestedProfileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const availablePairs = runtime.pairs.map((p) => ({
      pair_id: p.pair_id,
      domain_id: p.domain_id,
      title: p.capability.title
    }));
    const availableDomains = [...new Set(runtime.pairs.map((p) => p.domain_id))];

    let plan = null;
    let errorMessage: string | undefined;

    if (runtime.inputSet.readiness.planning_ready && availablePairs.length > 0) {
      const modeRaw = typeof query.mode === 'string' ? query.mode.trim() : 'pair';
      const mode: DocumentPlanSelection['mode'] =
        modeRaw === 'domain' || modeRaw === 'all' ? modeRaw : 'pair';
      const pairId =
        typeof query.pairId === 'string' && query.pairId.trim().length > 0
          ? query.pairId.trim()
          : availablePairs.find((p) => p.pair_id !== runtime.inputSet.golden_reference?.pair_id)?.pair_id ??
            availablePairs[0]!.pair_id;
      const domainId =
        typeof query.domainId === 'string' && query.domainId.trim().length > 0
          ? query.domainId.trim()
          : availableDomains[0]!;
      const includeTactics = query.includeTactics === 'true';

      try {
        plan = createDocumentPlan(runtime, {
          mode,
          pair_ids: mode === 'pair' ? [pairId] : undefined,
          domain_ids: mode === 'domain' ? [domainId] : undefined,
          include_tactics: includeTactics
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Failed to build document plan.';
      }
    }

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderDocumentPlanViewHtml({
          profiles,
          selectedProfileId: selected.profile_id,
          availablePairs,
          availableDomains,
          inputSet: runtime.inputSet,
          plan,
          errorMessage
        })
      );
  });

  app.get('/api/creator/profiles', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    return {
      profiles: profiles.map((p) => ({
        profile_id: p.profile_id,
        profile_version: p.profile_version,
        kb_id: p.kb_id,
        kb_title: p.kb_title,
        language: p.language,
        is_synthetic: p.is_synthetic,
        storage_provider: p.storage_ref.provider,
        output_root: p.storage_ref.output_root
      }))
    };
  });

  app.post('/api/creator/inputs/validate', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    if (!profileId) {
      return reply.code(400).send({
        error: 'MISSING_PROFILE_ID',
        message: 'Request body must specify a registered profileId.'
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === profileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${profileId}".`
      });
    }
    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const statusCode = runtime.inputSet.readiness.planning_ready ? 200 : 422;
    return reply.code(statusCode).send({
      inputSet: runtime.inputSet
    });
  });

  app.post('/api/creator/plan', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    if (!profileId) {
      return reply.code(400).send({
        error: 'MISSING_PROFILE_ID',
        message: 'Request body must specify a registered profileId.'
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === profileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${profileId}".`
      });
    }
    let selection: DocumentPlanSelection;
    try {
      selection = parseSelectionBody(body.selection);
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      return reply.code(400).send({
        error: planErr?.code ?? 'INVALID_PLAN_SELECTION',
        message: error instanceof Error ? error.message : 'Invalid plan selection.',
        findings: planErr?.findings ?? []
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    try {
      const plan = createDocumentPlan(runtime, selection);
      return reply.code(200).send({
        inputSet: runtime.inputSet,
        plan
      });
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      const status = planErr?.code === 'INPUT_SET_NOT_READY' ? 422 : 400;
      return reply.code(status).send({
        error: planErr?.code ?? 'PLAN_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create document plan.',
        findings: planErr?.findings ?? runtime.inputSet.readiness.findings,
        inputSet: runtime.inputSet
      });
    }
  });

  app.get('/creator/sources', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const query = isObjectRecord(request.query) ? request.query : {};
    const requestedProfileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const availablePairs = runtime.pairs.map((p) => ({
      pair_id: p.pair_id,
      domain_id: p.domain_id,
      title: p.capability.title
    }));
    const selectedPairId =
      typeof query.pairId === 'string' && query.pairId.trim().length > 0
        ? query.pairId.trim()
        : availablePairs.find((p) => p.pair_id !== runtime.inputSet.golden_reference?.pair_id)?.pair_id ??
          availablePairs[0]?.pair_id ??
          '';

    let bundle = null;
    let errorMessage: string | undefined;

    if (runtime.inputSet.readiness.planning_ready && selectedPairId) {
      try {
        const plan = createDocumentPlan(runtime, {
          mode: 'pair',
          pair_ids: [selectedPairId],
          include_tactics: false
        });
        bundle = await prepareSourcesForPlan({
          workspaceRoot,
          runtime,
          plan,
          cache: sourceCache,
          enableUrlAcquisition: Boolean(options.fetchPort) || Boolean(options.allowLiveSourceFetch),
          fetchPort: options.fetchPort,
          resolveAddresses: options.resolveAddresses
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Source preparation failed.';
      }
    }

    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderSourcePreparationViewHtml({
          profiles,
          selectedProfileId: selected.profile_id,
          availablePairs,
          selectedPairId,
          bundle,
          errorMessage
        })
      );
  });

  app.post('/api/creator/sources/prepare', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    if (!profileId) {
      return reply.code(400).send({
        error: 'MISSING_PROFILE_ID',
        message: 'Request body must specify a registered profileId.'
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === profileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${profileId}".`
      });
    }

    let selection: DocumentPlanSelection;
    try {
      selection = parseSelectionBody(body.selection);
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      return reply.code(400).send({
        error: planErr?.code ?? 'INVALID_PLAN_SELECTION',
        message: error instanceof Error ? error.message : 'Invalid plan selection.',
        findings: planErr?.findings ?? []
      });
    }

    const requestWantsUrlFetch = body.enableUrlAcquisition === true;
    const allowUrlFetch =
      requestWantsUrlFetch &&
      (Boolean(options.fetchPort) ||
        Boolean(options.allowLiveSourceFetch) ||
        process.env.CREATOR_ALLOW_LIVE_SOURCE_FETCH === 'true');

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    let plan;
    try {
      plan = createDocumentPlan(runtime, selection);
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      const status = planErr?.code === 'INPUT_SET_NOT_READY' ? 422 : 400;
      return reply.code(status).send({
        error: planErr?.code ?? 'PLAN_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create document plan.',
        findings: planErr?.findings ?? runtime.inputSet.readiness.findings,
        inputSet: runtime.inputSet
      });
    }

    const sourceBundle = await prepareSourcesForPlan({
      workspaceRoot,
      runtime,
      plan,
      cache: sourceCache,
      enableUrlAcquisition: allowUrlFetch,
      allowPublisherTermsModelEgress: body.allowPublisherTermsModelEgress === true,
      fetchPort: options.fetchPort,
      resolveAddresses: options.resolveAddresses
    });

    const status = sourceBundle.readiness.authoring_ready ? 200 : 422;
    return reply.code(status).send({
      inputSet: runtime.inputSet,
      plan,
      sourceBundle
    });
  });

  app.get('/creator/documents', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const query = isObjectRecord(request.query) ? request.query : {};
    const requestedProfileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const availablePairs = runtime.pairs.map((p) => ({
      pair_id: p.pair_id,
      domain_id: p.domain_id,
      title: p.capability.title
    }));
    const selectedPairId =
      typeof query.pairId === 'string' && query.pairId.trim().length > 0
        ? query.pairId.trim()
        : availablePairs.find((p) => p.pair_id !== runtime.inputSet.golden_reference?.pair_id)?.pair_id ??
          availablePairs[0]?.pair_id ??
          '';

    const workspaceSnapshot = await workspaceSession.getSnapshot(runStore);
    const requestedRunId =
      typeof query.runId === 'string' && query.runId.trim().length > 0
        ? query.runId.trim()
        : undefined;

    // When workspace is in EMPTY_SETUP (zero runs or after Reset) and no explicit runId was requested,
    // keep the document view clean and empty until new work starts.
    const activeRun = workspaceSnapshot.reset_to_empty && !requestedRunId
      ? null
      : requestedRunId
        ? (await runStore.getRun(requestedRunId)) ?? null
        : typeof query.pairId === 'string' && query.pairId.trim().length > 0
          ? (await runStore.getLatestRunForPair(selected.profile_id, selectedPairId)) ?? null
          : workspaceSnapshot.latest_run ??
            (selectedPairId
              ? (await runStore.getLatestRunForPair(selected.profile_id, selectedPairId)) ?? null
              : null);

    const effectivePairId = activeRun?.pair_id ?? selectedPairId;

    let storedDraft =
      workspaceSnapshot.reset_to_empty && !requestedRunId
        ? null
        : effectivePairId
          ? draftStore.get(selected.profile_id, effectivePairId) ?? null
          : null;

    if (activeRun && effectivePairId && runtime.inputSet.readiness.planning_ready) {
      try {
        const plan = createDocumentPlan(runtime, {
          mode: 'pair',
          pair_ids: [effectivePairId],
          include_tactics: false
        });
        const fromRun = materializeAuthoredPairViewFromRun(activeRun, runtime, plan);
        if (fromRun) {
          storedDraft = fromRun;
          draftStore.set(selected.profile_id, effectivePairId, fromRun);
        }
      } catch {
        // Ignore plan error if viewing an incomplete run.
      }
    }

    return reply
      .header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type('text/html; charset=utf-8')
      .send(
        renderDocumentsPreviewViewHtml({
          profiles,
          selectedProfileId: selected.profile_id,
          availablePairs,
          selectedPairId: effectivePairId,
          isSynthetic: selected.is_synthetic,
          authoredPair: storedDraft,
          activeRun,
          workspaceSnapshot,
          errorMessage:
            typeof query.error === 'string' && query.error.trim()
              ? query.error.trim()
              : undefined
        })
      );
  });

  app.get('/creator/history', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const query = isObjectRecord(request.query) ? request.query : {};
    const requestedProfileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : '';

    const runs = await runStore.listRuns(requestedProfileId || undefined);
    return reply
      .header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type('text/html; charset=utf-8')
      .send(
        renderHistoryViewHtml({
          profiles,
          selectedProfileId: requestedProfileId,
          runs
        })
      );
  });

  app.post('/creator/documents/author', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const body = isObjectRecord(request.body) ? request.body : {};
    const requestedProfileId =
      typeof body.profileId === 'string' && body.profileId.trim().length > 0
        ? body.profileId.trim()
        : profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const availablePairs = runtime.pairs.map((p) => ({
      pair_id: p.pair_id,
      domain_id: p.domain_id,
      title: p.capability.title
    }));
    const selectedPairId =
      typeof body.pairId === 'string' && body.pairId.trim().length > 0
        ? body.pairId.trim()
        : availablePairs.find((p) => p.pair_id !== runtime.inputSet.golden_reference?.pair_id)?.pair_id ??
          availablePairs[0]?.pair_id ??
          '';

    const authorPort = resolveAuthorPort(selected);
    let authoredPair: AuthoredPairResult | null = null;
    let activeRun = null;
    let errorMessage: string | undefined;

    if (!authorPort) {
      errorMessage =
        'Model authoring provider is not enabled on this server (set CREATOR_ALLOW_LIVE_AUTHORING=true or inject an offline provider port).';
      return reply
        .code(503)
        .header(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
        )
        .type('text/html; charset=utf-8')
        .send(
          renderDocumentsPreviewViewHtml({
            profiles,
            selectedProfileId: selected.profile_id,
            availablePairs,
            selectedPairId,
            isSynthetic: selected.is_synthetic,
            authoredPair: null,
            errorMessage
          })
        );
    }

    const cadence = parseReviewCadence(body.reviewCadence);
    const delivMode = parseDeliveryMode(body.deliveryMode);
    workspaceSession.setPreferences({
      reviewCadence: cadence,
      deliveryMode: delivMode
    });

    try {
      const plan = createDocumentPlan(runtime, {
        mode: 'pair',
        pair_ids: [selectedPairId],
        include_tactics: false
      });
      activeRun = await startOrResumePairRun({
        store: runStore,
        workspaceRoot,
        runtime,
        plan,
        pairId: selectedPairId,
        authorProviderPort: authorPort,
        reviewerProviderPort: resolveReviewerPort(selected),
        autoRunSemanticReview: true,
        enableUrlAcquisition: Boolean(options.fetchPort) || Boolean(options.allowLiveSourceFetch),
        sourceCache,
        fetchPort: options.fetchPort,
        resolveAddresses: options.resolveAddresses
      });
      workspaceSession.markWorkStarted(null);
      authoredPair = materializeAuthoredPairViewFromRun(activeRun, runtime, plan);
      if (authoredPair) {
        draftStore.set(selected.profile_id, selectedPairId, authoredPair);
      } else if (activeRun.interruption_detail) {
        errorMessage = activeRun.interruption_detail;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Pair authoring failed.';
    }

    const workspaceSnapshot = await workspaceSession.getSnapshot(runStore);
    const statusCode = !authoredPair || !authoredPair.validation.draft_valid ? 422 : 200;
    return reply
      .code(statusCode)
      .header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type('text/html; charset=utf-8')
      .send(
        renderDocumentsPreviewViewHtml({
          profiles,
          selectedProfileId: selected.profile_id,
          availablePairs,
          selectedPairId,
          isSynthetic: selected.is_synthetic,
          authoredPair,
          activeRun,
          workspaceSnapshot,
          errorMessage
        })
      );
  });

  app.post('/creator/documents/semantic-review', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : '';
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === profileId) ?? profiles[0]!;
    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });

    await executeSemanticReviewForRun({
      store: runStore,
      runId,
      runtime,
      reviewerProviderPort: resolveReviewerPort(selected)
    });

    return reply.redirect(
      `/creator/documents?profileId=${encodeURIComponent(selected.profile_id)}&pairId=${encodeURIComponent(pairId)}&runId=${encodeURIComponent(runId)}`
    );
  });

  app.post('/creator/documents/edit-markdown', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : '';
    const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : '';
    const editedMarkdown =
      typeof body.editedMarkdown === 'string' ? body.editedMarkdown : '';

    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === profileId) ?? profiles[0]!;
    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const plan = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: [pairId],
      include_tactics: false
    });

    try {
      const updatedRun = await applyMarkdownEditToRun({
        store: runStore,
        runId,
        objectId,
        editedMarkdown,
        runtime,
        plan
      });
      const authoredPair = materializeAuthoredPairViewFromRun(updatedRun, runtime, plan);
      if (authoredPair) {
        draftStore.set(selected.profile_id, pairId, authoredPair);
      }
      return reply.redirect(
        `/creator/documents?profileId=${encodeURIComponent(selected.profile_id)}&pairId=${encodeURIComponent(pairId)}&runId=${encodeURIComponent(runId)}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Manual Markdown edit failed.';
      return reply.redirect(
        `/creator/documents?profileId=${encodeURIComponent(selected.profile_id)}&pairId=${encodeURIComponent(pairId)}&runId=${encodeURIComponent(runId)}&error=${encodeURIComponent(msg)}`
      );
    }
  });

  app.post('/api/creator/runs/:runId/edit-markdown', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : '';
    const editedMarkdown =
      typeof body.editedMarkdown === 'string' ? body.editedMarkdown : '';

    if (!objectId || !editedMarkdown.trim()) {
      return reply.code(400).send({
        error: 'MISSING_MARKDOWN_EDIT_PARAMS',
        message: 'Request body must specify "objectId" and non-empty "editedMarkdown".'
      });
    }

    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === existing.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${existing.profile_id}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const plan = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: [existing.pair_id],
      include_tactics: false
    });

    try {
      const updatedRun = await applyMarkdownEditToRun({
        store: runStore,
        runId,
        objectId,
        editedMarkdown,
        runtime,
        plan
      });
      const authoredPair = materializeAuthoredPairViewFromRun(updatedRun, runtime, plan);
      if (authoredPair) {
        draftStore.set(selected.profile_id, existing.pair_id, authoredPair);
      }
      return reply.code(200).send({
        run: updatedRun,
        authoredPair
      });
    } catch (error) {
      return reply.code(422).send({
        error: 'MARKDOWN_EDIT_INVALID',
        message: error instanceof Error ? error.message : 'Manual Markdown edit rejected.'
      });
    }
  });

  app.post('/creator/documents/approve', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : '';
    const reviewedBy =
      typeof body.reviewedBy === 'string' && body.reviewedBy.trim()
        ? body.reviewedBy.trim()
        : 'operator@local';
    const targetVersion =
      typeof body.targetVersion === 'string' && body.targetVersion.trim()
        ? body.targetVersion.trim()
        : undefined;
    const requestedDeliveryMode =
      parseDeliveryMode(body.deliveryMode) ??
      workspaceSession.getPreferences().delivery_mode;

    const signoff = await recordHumanCreationReview({
      store: runStore,
      runId,
      reviewedBy,
      note:
        typeof body.note === 'string' && body.note.trim()
          ? body.note.trim()
          : 'Approved in .md review UI.'
    });

    if (!signoff.ok) {
      return reply.redirect(
        `/creator/documents?profileId=${encodeURIComponent(profileId)}&pairId=${encodeURIComponent(pairId)}&runId=${encodeURIComponent(runId)}&error=${encodeURIComponent(signoff.message)}`
      );
    }

    const profiles = await loadProfiles();
    const selected =
      profiles.find((p) => p.profile_id === signoff.run.profile_id) ?? profiles[0]!;
    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const plan = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: [signoff.run.pair_id],
      include_tactics: false
    });

    const refreshedPair = materializeAuthoredPairViewFromRun(signoff.run, runtime, plan);
    if (refreshedPair) {
      draftStore.set(selected.profile_id, signoff.run.pair_id, refreshedPair);
    }

    if (requestedDeliveryMode === 'ZIP') {
      const zipResult = buildCreatorRunsZipExport({
        runs: [signoff.run],
        planByRunId: new Map([[signoff.run.run_id, plan]]),
        targetVersion,
        requireApprovedSignoff: true
      });
      return reply
        .code(200)
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="${zipResult.filename}"`
        )
        .header('X-Zip-Sha256', zipResult.zip_sha256)
        .send(zipResult.zip_buffer);
    }

    // Default STORAGE option: store the approved .md documents to KB storage immediately!
    try {
      await deliverReviewedCreatorRun({
        store: runStore,
        workspaceRoot,
        runtime,
        plan,
        runId: signoff.run.run_id,
        targetVersion,
        beforeWriteHook: options.beforeStorageWriteHook
      });
      return reply.redirect(
        `/creator/delivery?profileId=${encodeURIComponent(selected.profile_id)}&pairId=${encodeURIComponent(signoff.run.pair_id)}&runId=${encodeURIComponent(signoff.run.run_id)}`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Storage delivery failed.';
      return reply.redirect(
        `/creator/documents?profileId=${encodeURIComponent(selected.profile_id)}&pairId=${encodeURIComponent(signoff.run.pair_id)}&runId=${encodeURIComponent(signoff.run.run_id)}&error=${encodeURIComponent(msg)}`
      );
    }
  });

  const handleRunZipExport = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const query = isObjectRecord(request.query) ? request.query : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === existing.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${existing.profile_id}".`
      });
    }
    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const plan = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: [existing.pair_id],
      include_tactics: false
    });

    const requireApproved = query.allowDraft === 'true' ? false : true;
    try {
      const zipResult = buildCreatorRunsZipExport({
        runs: [existing],
        planByRunId: new Map([[existing.run_id, plan]]),
        targetVersion:
          typeof query.targetVersion === 'string' && query.targetVersion.trim()
            ? query.targetVersion.trim()
            : undefined,
        requireApprovedSignoff: requireApproved
      });
      return reply
        .code(200)
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="${zipResult.filename}"`
        )
        .header('X-Zip-Sha256', zipResult.zip_sha256)
        .send(zipResult.zip_buffer);
    } catch (error) {
      return reply.code(422).send({
        error: 'ZIP_EXPORT_BLOCKED',
        message: error instanceof Error ? error.message : 'Failed to build ZIP archive.'
      });
    }
  };

  app.get('/creator/runs/:runId/export.zip', handleRunZipExport);
  app.get('/api/creator/runs/:runId/export.zip', handleRunZipExport);

  app.get('/api/creator/documents', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const query = isObjectRecord(request.query) ? request.query : {};
    const profileId = typeof query.profileId === 'string' ? query.profileId.trim() : '';
    const pairId = typeof query.pairId === 'string' ? query.pairId.trim() : '';
    if (!profileId || !pairId) {
      return reply.code(400).send({
        error: 'MISSING_QUERY_PARAMS',
        message: 'Query parameters "profileId" and "pairId" are required.'
      });
    }
    const latestRun = await runStore.getLatestRunForPair(profileId, pairId);
    const stored = draftStore.get(profileId, pairId);
    if (!stored && !latestRun) {
      return reply.code(404).send({
        error: 'DRAFT_NOT_FOUND',
        message: `No authored draft found in memory for "${profileId}:${pairId}".`
      });
    }
    return reply.code(200).send({
      draftKey: `${profileId}:${pairId}`,
      authoredPair: stored ?? null,
      run: latestRun ?? null
    });
  });

  app.post('/api/creator/documents/author', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    const pairId = typeof body.pairId === 'string' ? body.pairId.trim() : '';
    if (!profileId || !pairId) {
      return reply.code(400).send({
        error: 'MISSING_AUTHOR_PARAMETERS',
        message: 'Request body must specify "profileId" and "pairId".'
      });
    }

    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === profileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${profileId}".`
      });
    }

    const authorPort = resolveAuthorPort(selected);
    if (!authorPort) {
      return reply.code(503).send({
        error: 'AUTHOR_PROVIDER_NOT_CONFIGURED',
        message:
          'Model authoring provider is not enabled on this server (set CREATOR_ALLOW_LIVE_AUTHORING=true or inject an offline provider port).'
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    let plan;
    try {
      plan = createDocumentPlan(runtime, {
        mode: 'pair',
        pair_ids: [pairId],
        include_tactics: false
      });
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      const status = planErr?.code === 'INPUT_SET_NOT_READY' ? 422 : 400;
      return reply.code(status).send({
        error: planErr?.code ?? 'PLAN_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create document plan.',
        findings: planErr?.findings ?? runtime.inputSet.readiness.findings,
        inputSet: runtime.inputSet
      });
    }

    const requestWantsUrlFetch = body.enableUrlAcquisition === true;
    const allowUrlFetch =
      requestWantsUrlFetch &&
      (Boolean(options.fetchPort) ||
        Boolean(options.allowLiveSourceFetch) ||
        process.env.CREATOR_ALLOW_LIVE_SOURCE_FETCH === 'true');

    const documentVersion =
      typeof body.documentVersion === 'string' && body.documentVersion.trim().length > 0
        ? body.documentVersion.trim()
        : undefined;

    const run = await startOrResumePairRun({
      store: runStore,
      workspaceRoot,
      runtime,
      plan,
      pairId,
      authorProviderPort: authorPort,
      reviewerProviderPort: resolveReviewerPort(selected),
      autoRunSemanticReview: body.autoRunSemanticReview === true,
      documentVersion,
      enableUrlAcquisition: allowUrlFetch,
      allowPublisherTermsModelEgress: body.allowPublisherTermsModelEgress === true,
      pauseOnInputDrift: body.pauseOnInputDrift === true,
      sourceCache,
      fetchPort: options.fetchPort,
      resolveAddresses: options.resolveAddresses
    });

    const sourceBundle = run.checkpoints.source_bundle;
    if (!sourceBundle || !sourceBundle.readiness.authoring_ready) {
      return reply.code(422).send({
        error: 'SOURCE_BUNDLE_NOT_READY',
        message: 'Source preparation bundle did not pass authoring readiness.',
        inputSet: runtime.inputSet,
        plan,
        sourceBundle,
        run
      });
    }

    const authoredPair = materializeAuthoredPairViewFromRun(run, runtime, plan);
    if (!authoredPair) {
      return reply.code(502).send({
        error: run.interruption_state !== 'NONE' ? run.interruption_state : 'AUTHORING_INTERRUPTED',
        message: run.interruption_detail ?? 'Authoring call did not complete.',
        run
      });
    }

    const draftKey = draftStore.set(selected.profile_id, pairId, authoredPair);
    const status = authoredPair.validation.draft_valid ? 200 : 422;

    return reply.code(status).send({
      draftKey,
      inputSet: runtime.inputSet,
      plan,
      sourceBundle,
      authoredPair,
      run
    });
  });

  app.get('/api/creator/runs', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const query = isObjectRecord(request.query) ? request.query : {};
    const profileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : undefined;
    const runs = await runStore.listRuns(profileId);
    return reply.code(200).send({ runs });
  });

  app.get('/api/creator/runs/:runId', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const run = await runStore.getRun(runId);
    if (!run) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    return reply.code(200).send({ run });
  });

  app.post('/api/creator/runs/:runId/review', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === existing.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${existing.profile_id}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const updatedRun = await executeSemanticReviewForRun({
      store: runStore,
      runId,
      runtime,
      reviewerProviderPort: resolveReviewerPort(selected)
    });

    const review = updatedRun.checkpoints.latest_semantic_review;
    const hasBlocker =
      updatedRun.interruption_state === 'BUDGET_EXHAUSTED' ||
      Boolean(review && (review.blocking_defect_count > 0 || review.rejected_reviewer_attempts.length > 0));
    return reply.code(hasBlocker ? 422 : 200).send({
      run: updatedRun,
      review
    });
  });

  app.post('/api/creator/runs/:runId/edit', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : '';
    const rawPatches = Array.isArray(body.sectionPatches) ? body.sectionPatches : [];

    if (!objectId || rawPatches.length === 0) {
      return reply.code(400).send({
        error: 'INVALID_EDIT_REQUEST',
        message: 'Request body must specify "objectId" and a non-empty "sectionPatches" array.'
      });
    }

    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === existing.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${existing.profile_id}".`
      });
    }

    const sectionPatches: DirectSectionEditPatch[] = rawPatches
      .filter(isObjectRecord)
      .map((p) => ({
        section_id: typeof p.section_id === 'string' ? p.section_id : '',
        prose: typeof p.prose === 'string' ? p.prose : undefined,
        bullets: Array.isArray(p.bullets)
          ? p.bullets.filter((b): b is string => typeof b === 'string')
          : undefined,
        question_refs: Array.isArray(p.question_refs)
          ? p.question_refs.filter((q): q is string => typeof q === 'string')
          : undefined,
        source_unit_refs: Array.isArray(p.source_unit_refs)
          ? p.source_unit_refs.filter((u): u is string => typeof u === 'string')
          : undefined
      }))
      .filter((p) => p.section_id.length > 0);

    const claimsOverride: ModelClaimDraft[] | undefined = Array.isArray(body.sourcedClaimsOverride)
      ? body.sourcedClaimsOverride
          .filter(isObjectRecord)
          .map((c) => ({
            section_code: typeof c.section_code === 'string' ? c.section_code : undefined,
            statement: typeof c.statement === 'string' ? c.statement : '',
            source_unit_ids: Array.isArray(c.source_unit_ids)
              ? c.source_unit_ids.filter((u): u is string => typeof u === 'string')
              : undefined,
            applicability_note:
              typeof c.applicability_note === 'string' ? c.applicability_note : undefined,
            unresolved_reason:
              typeof c.unresolved_reason === 'string' ? c.unresolved_reason : undefined
          }))
          .filter((c) => c.statement.length > 0)
      : undefined;

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const plan = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: [existing.pair_id],
      include_tactics: false
    });

    const updatedRun = await applyDirectEditToRun({
      store: runStore,
      runId,
      objectId,
      sectionPatches,
      sourcedClaimsOverride: claimsOverride,
      runtime,
      plan
    });

    const authoredPair = materializeAuthoredPairViewFromRun(updatedRun, runtime, plan);
    if (authoredPair) {
      draftStore.set(selected.profile_id, existing.pair_id, authoredPair);
    }

    const status = authoredPair?.validation.draft_valid ? 200 : 422;
    return reply.code(status).send({
      run: updatedRun,
      authoredPair
    });
  });

  app.post('/api/creator/runs/:runId/repair', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : '';
    const targetSectionIds = Array.isArray(body.targetSectionIds)
      ? body.targetSectionIds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    const declaredDependencySectionIds = Array.isArray(body.declaredDependencySectionIds)
      ? body.declaredDependencySectionIds.filter(
          (s): s is string => typeof s === 'string' && s.trim().length > 0
        )
      : undefined;
    const operatorInstruction =
      typeof body.operatorInstruction === 'string' ? body.operatorInstruction : undefined;

    if (!objectId || targetSectionIds.length === 0) {
      return reply.code(400).send({
        error: 'INVALID_REPAIR_REQUEST',
        message: 'Request body must specify "objectId" and a non-empty "targetSectionIds" array.'
      });
    }

    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === existing.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${existing.profile_id}".`
      });
    }

    const repairPort = resolveRepairPort(selected);
    if (!repairPort) {
      return reply.code(503).send({
        error: 'REPAIR_PROVIDER_NOT_CONFIGURED',
        message: 'Model repair provider is not configured on this server.'
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const plan = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: [existing.pair_id],
      include_tactics: false
    });

    const { run: updatedRun, budgetExhausted } = await executeTargetedRepairForRun({
      store: runStore,
      runId,
      objectId,
      targetSectionIds,
      declaredDependencySectionIds,
      operatorInstruction,
      runtime,
      plan,
      repairProviderPort: repairPort
    });

    const authoredPair = materializeAuthoredPairViewFromRun(updatedRun, runtime, plan);
    if (authoredPair) {
      draftStore.set(selected.profile_id, existing.pair_id, authoredPair);
    }

    if (budgetExhausted) {
      return reply.code(429).send({
        error: 'REPAIR_BUDGET_EXHAUSTED',
        message:
          updatedRun.continuation_required_reason ??
          'Repair iteration or token budget exhausted; explicit continuation required.',
        run: updatedRun,
        authoredPair
      });
    }

    const status = authoredPair?.validation.draft_valid ? 200 : 422;
    return reply.code(status).send({
      run: updatedRun,
      authoredPair
    });
  });

  app.post('/api/creator/runs/:runId/continue', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }

    const updatedRun = await grantCreatorRunContinuation({
      store: runStore,
      runId,
      additionalRepairIterations:
        typeof body.additionalRepairIterations === 'number'
          ? body.additionalRepairIterations
          : 1,
      additionalTokens:
        typeof body.additionalTokens === 'number' ? body.additionalTokens : 0
    });

    return reply.code(200).send({ run: updatedRun });
  });

  app.post('/api/creator/runs/:runId/approve-review', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const reviewedBy = typeof body.reviewedBy === 'string' ? body.reviewedBy.trim() : '';
    if (!reviewedBy) {
      return reply.code(400).send({
        error: 'MISSING_REVIEWER_IDENTITY',
        message: 'Request body must specify "reviewedBy".'
      });
    }

    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }

    const outcome = await recordHumanCreationReview({
      store: runStore,
      runId,
      reviewedBy,
      note: typeof body.note === 'string' ? body.note : undefined
    });

    if (!outcome.ok) {
      return reply.code(422).send({
        error: outcome.code,
        message: outcome.message,
        run: outcome.run
      });
    }

    return reply.code(200).send({ run: outcome.run });
  });

  app.post('/api/creator/runs/:runId/cancel', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }

    const updatedRun = await cancelCreatorRun({
      store: runStore,
      runId,
      reason: typeof body.reason === 'string' ? body.reason : undefined
    });
    return reply.code(200).send({ run: updatedRun });
  });

  app.post('/api/creator/runs/:runId/retry', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === existing.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${existing.profile_id}".`
      });
    }

    const authorPort = resolveAuthorPort(selected);
    if (!authorPort) {
      return reply.code(503).send({
        error: 'AUTHOR_PROVIDER_NOT_CONFIGURED',
        message: 'Model authoring provider is not enabled on this server.'
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const plan = createDocumentPlan(runtime, {
      mode: 'pair',
      pair_ids: [existing.pair_id],
      include_tactics: false
    });

    const resumedRun = await startOrResumePairRun({
      store: runStore,
      workspaceRoot,
      runtime,
      plan,
      pairId: existing.pair_id,
      resumeRunId: runId,
      authorProviderPort: authorPort,
      reviewerProviderPort: resolveReviewerPort(selected),
      sourceCache,
      fetchPort: options.fetchPort,
      resolveAddresses: options.resolveAddresses
    });

    const authoredPair = materializeAuthoredPairViewFromRun(resumedRun, runtime, plan);
    if (authoredPair) {
      draftStore.set(selected.profile_id, existing.pair_id, authoredPair);
    }

    const status = resumedRun.state === 'FAILED' ? 502 : 200;
    return reply.code(status).send({
      run: resumedRun,
      authoredPair
    });
  });

  app.get('/creator/delivery', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const query = isObjectRecord(request.query) ? request.query : {};
    const requestedProfileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const availablePairs = runtime.pairs.map((p) => ({
      pair_id: p.pair_id,
      domain_id: p.domain_id,
      title: p.capability.title
    }));
    const selectedPairId =
      typeof query.pairId === 'string' && query.pairId.trim().length > 0
        ? query.pairId.trim()
        : availablePairs.find((p) => p.pair_id !== runtime.inputSet.golden_reference?.pair_id)?.pair_id ??
          availablePairs[0]?.pair_id ??
          '';
    const requestedRunId =
      typeof query.runId === 'string' && query.runId.trim().length > 0
        ? query.runId.trim()
        : undefined;

    const activeRun = requestedRunId
      ? (await runStore.getRun(requestedRunId)) ?? null
      : selectedPairId
        ? (await runStore.getLatestRunForPair(selected.profile_id, selectedPairId)) ?? null
        : null;

    return reply
      .header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type('text/html; charset=utf-8')
      .send(
        renderDeliveryViewHtml({
          profiles,
          selectedProfile: selected,
          availablePairs,
          selectedPairId,
          activeRun
        })
      );
  });

  app.post('/creator/delivery', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const body = isObjectRecord(request.body) ? request.body : {};
    const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
    const requestedProfileId =
      typeof body.profileId === 'string' && body.profileId.trim().length > 0
        ? body.profileId.trim()
        : profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    const availablePairs = runtime.pairs.map((p) => ({
      pair_id: p.pair_id,
      domain_id: p.domain_id,
      title: p.capability.title
    }));
    const selectedPairId =
      typeof body.pairId === 'string' && body.pairId.trim().length > 0
        ? body.pairId.trim()
        : availablePairs.find((p) => p.pair_id !== runtime.inputSet.golden_reference?.pair_id)?.pair_id ??
          availablePairs[0]?.pair_id ??
          '';
    const targetVersion =
      typeof body.targetVersion === 'string' && body.targetVersion.trim().length > 0
        ? body.targetVersion.trim()
        : undefined;

    let activeRun = runId
      ? (await runStore.getRun(runId)) ?? null
      : (await runStore.getLatestRunForPair(selected.profile_id, selectedPairId)) ?? null;
    let errorMessage: string | undefined;
    let statusCode = 200;

    if (!activeRun) {
      errorMessage = 'No active run found to deliver.';
      statusCode = 404;
    } else {
      try {
        const plan = createDocumentPlan(runtime, {
          mode: 'pair',
          pair_ids: [activeRun.pair_id],
          include_tactics: false
        });
        const delivered = await deliverReviewedCreatorRun({
          store: runStore,
          workspaceRoot,
          runtime,
          plan,
          runId: activeRun.run_id,
          targetVersion,
          beforeWriteHook: options.beforeStorageWriteHook
        });
        activeRun = delivered.run;
      } catch (error) {
        activeRun = (await runStore.getRun(activeRun.run_id)) ?? activeRun;
        errorMessage = error instanceof Error ? error.message : 'Delivery failed.';
        const code = error instanceof DeliveryStorageError ? error.code : 'DELIVERY_FAILED';
        statusCode =
          code === 'VERSION_CONFLICT_EXISTING_BYTES_DIFFER' ||
          code === 'CONCURRENT_VERSION_COLLISION'
            ? 409
            : code === 'PARTIAL_DELIVERY_FAILED'
              ? 502
              : 422;
      }
    }

    return reply
      .code(statusCode)
      .header(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'"
      )
      .type('text/html; charset=utf-8')
      .send(
        renderDeliveryViewHtml({
          profiles,
          selectedProfile: selected,
          availablePairs,
          selectedPairId,
          activeRun,
          errorMessage
        })
      );
  });

  app.post('/api/creator/runs/:runId/deliver', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const targetVersion =
      typeof body.targetVersion === 'string' && body.targetVersion.trim().length > 0
        ? body.targetVersion.trim()
        : undefined;

    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }

    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === existing.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${existing.profile_id}".`
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    let plan;
    try {
      plan = createDocumentPlan(runtime, {
        mode: 'pair',
        pair_ids: [existing.pair_id],
        include_tactics: false
      });
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      return reply.code(422).send({
        error: planErr?.code ?? 'PLAN_FAILED',
        message: error instanceof Error ? error.message : 'Failed to build plan for delivery.',
        findings: planErr?.findings ?? runtime.inputSet.readiness.findings
      });
    }

    try {
      const delivered = await deliverReviewedCreatorRun({
        store: runStore,
        workspaceRoot,
        runtime,
        plan,
        runId,
        targetVersion,
        beforeWriteHook: options.beforeStorageWriteHook
      });
      return reply.code(200).send({
        run: delivered.run,
        receipt: delivered.receipt,
        fileOutcomes: delivered.fileOutcomes
      });
    } catch (error) {
      const updatedRun = await runStore.getRun(runId);
      const delErr = error instanceof DeliveryStorageError ? error : null;
      const code = delErr?.code ?? 'DELIVERY_FAILED';
      const status =
        code === 'VERSION_CONFLICT_EXISTING_BYTES_DIFFER' ||
        code === 'CONCURRENT_VERSION_COLLISION'
          ? 409
          : code === 'PARTIAL_DELIVERY_FAILED'
            ? 502
            : 422;
      return reply.code(status).send({
        error: code,
        message: error instanceof Error ? error.message : 'Failed to deliver documents.',
        findings: delErr?.findings ?? [],
        run: updatedRun ?? existing
      });
    }
  });

  app.get('/api/creator/runs/:runId/receipt', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const runId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const existing = await runStore.getRun(runId);
    if (!existing) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown Creator run "${runId}".`
      });
    }
    if (!existing.checkpoints.completion_receipt) {
      return reply.code(404).send({
        error: 'RECEIPT_NOT_FOUND',
        message: `Run "${runId}" does not have a completed delivery receipt.`,
        runState: existing.state
      });
    }
    return reply.code(200).send({
      receipt: existing.checkpoints.completion_receipt
    });
  });

  app.get('/api/creator/handoff', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const profiles = await loadProfiles();
    const query = isObjectRecord(request.query) ? request.query : {};
    const requestedProfileId =
      typeof query.profileId === 'string' && query.profileId.trim().length > 0
        ? query.profileId.trim()
        : profiles[0]?.profile_id;
    const selected = profiles.find((p) => p.profile_id === requestedProfileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${String(requestedProfileId ?? '')}".`
      });
    }
    const handoff = await inspectDeliveredHandoff({
      workspaceRoot,
      profile: selected
    });
    return reply.code(200).send({
      profile_id: selected.profile_id,
      kb_id: selected.kb_id,
      handoff
    });
  });

  app.post('/api/creator/batches/execute', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const body = isObjectRecord(request.body) ? request.body : {};
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    if (!profileId) {
      return reply.code(400).send({
        error: 'MISSING_PROFILE_ID',
        message: 'Request body must specify a registered profileId.'
      });
    }

    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === profileId);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${profileId}".`
      });
    }

    let selection: DocumentPlanSelection;
    try {
      selection = parseSelectionBody(body.selection);
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      return reply.code(400).send({
        error: planErr?.code ?? 'INVALID_PLAN_SELECTION',
        message: error instanceof Error ? error.message : 'Invalid plan selection.',
        findings: planErr?.findings ?? []
      });
    }

    const authorPort = resolveAuthorPort(selected);
    if (!authorPort) {
      return reply.code(503).send({
        error: 'AUTHOR_PROVIDER_NOT_CONFIGURED',
        message: 'Model authoring provider is not enabled on this server.'
      });
    }

    const runtime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    let plan;
    try {
      plan = createDocumentPlan(runtime, selection);
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      const status = planErr?.code === 'INPUT_SET_NOT_READY' ? 422 : 400;
      return reply.code(status).send({
        error: planErr?.code ?? 'PLAN_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create document plan.',
        findings: planErr?.findings ?? runtime.inputSet.readiness.findings,
        inputSet: runtime.inputSet
      });
    }

    const requestWantsUrlFetch = body.enableUrlAcquisition === true;
    const allowUrlFetch =
      requestWantsUrlFetch &&
      (Boolean(options.fetchPort) ||
        Boolean(options.allowLiveSourceFetch) ||
        process.env.CREATOR_ALLOW_LIVE_SOURCE_FETCH === 'true');

    const batchCadence = parseReviewCadence(body.reviewCadence);
    const batchDeliveryMode = parseDeliveryMode(body.deliveryMode);
    workspaceSession.setPreferences({
      reviewCadence: batchCadence,
      deliveryMode: batchDeliveryMode
    });

    const batchResult = await executeCreatorBatch({
      store: runStore,
      workspaceRoot,
      runtime,
      plan,
      authorProviderPort: authorPort,
      reviewerProviderPort: resolveReviewerPort(selected),
      autoRunSemanticReview:
        typeof body.autoRunSemanticReview === 'boolean'
          ? body.autoRunSemanticReview
          : undefined,
      reviewCadence: batchCadence,
      deliveryMode: batchDeliveryMode,
      documentVersion:
        typeof body.documentVersion === 'string' && body.documentVersion.trim()
          ? body.documentVersion.trim()
          : undefined,
      maxObjectsOverride:
        typeof body.maxObjectsOverride === 'number' ? body.maxObjectsOverride : undefined,
      concurrencyOverride:
        typeof body.concurrencyOverride === 'number' ? body.concurrencyOverride : undefined,
      enableUrlAcquisition: allowUrlFetch,
      allowPublisherTermsModelEgress: body.allowPublisherTermsModelEgress === true,
      sourceCache,
      fetchPort: options.fetchPort,
      resolveAddresses: options.resolveAddresses
    });

    workspaceSession.markWorkStarted(batchResult);

    const status = batchResult.status === 'COMPLETED' ? 200 : 207;
    return reply.code(status).send({
      batch: batchResult
    });
  });

  app.post('/api/creator/runs/:runId/regenerate', async (request, reply) => {
    if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
    const params = isObjectRecord(request.params) ? request.params : {};
    const priorRunId = typeof params.runId === 'string' ? params.runId.trim() : '';
    const body = isObjectRecord(request.body) ? request.body : {};
    const newDocumentVersion =
      typeof body.newDocumentVersion === 'string' ? body.newDocumentVersion.trim() : '';

    if (!newDocumentVersion) {
      return reply.code(400).send({
        error: 'MISSING_NEW_DOCUMENT_VERSION',
        message: 'Request body must specify "newDocumentVersion" for regeneration.'
      });
    }

    const priorRun = await runStore.getRun(priorRunId);
    if (!priorRun) {
      return reply.code(404).send({
        error: 'RUN_NOT_FOUND',
        message: `Unknown prior Creator run "${priorRunId}".`
      });
    }

    const profiles = await loadProfiles();
    const selected = profiles.find((p) => p.profile_id === priorRun.profile_id);
    if (!selected) {
      return reply.code(404).send({
        error: 'UNKNOWN_PROFILE',
        message: `Unknown profileId "${priorRun.profile_id}".`
      });
    }

    const authorPort = resolveAuthorPort(selected);
    if (!authorPort) {
      return reply.code(503).send({
        error: 'AUTHOR_PROVIDER_NOT_CONFIGURED',
        message: 'Model authoring provider is not enabled on this server.'
      });
    }

    const newRuntime = await resolveProfileInputSet({ workspaceRoot, profile: selected });
    let newPlan;
    try {
      newPlan = createDocumentPlan(newRuntime, {
        mode: 'pair',
        pair_ids: [priorRun.pair_id],
        include_tactics: false
      });
    } catch (error) {
      const planErr = error instanceof DocumentPlanError ? error : null;
      return reply.code(422).send({
        error: planErr?.code ?? 'PLAN_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create regeneration plan.',
        findings: planErr?.findings ?? newRuntime.inputSet.readiness.findings
      });
    }

    const requestWantsUrlFetch = body.enableUrlAcquisition === true;
    const allowUrlFetch =
      requestWantsUrlFetch &&
      (Boolean(options.fetchPort) ||
        Boolean(options.allowLiveSourceFetch) ||
        process.env.CREATOR_ALLOW_LIVE_SOURCE_FETCH === 'true');

    try {
      const regenerated = await regeneratePairFromNewInputs({
        store: runStore,
        priorRunId,
        workspaceRoot,
        newRuntime,
        newPlan,
        newDocumentVersion,
        authorProviderPort: authorPort,
        reviewerProviderPort: resolveReviewerPort(selected),
        autoRunSemanticReview: body.autoRunSemanticReview === true,
        enableUrlAcquisition: allowUrlFetch,
        allowPublisherTermsModelEgress: body.allowPublisherTermsModelEgress === true,
        sourceCache,
        fetchPort: options.fetchPort,
        resolveAddresses: options.resolveAddresses
      });

      const authoredPair = materializeAuthoredPairViewFromRun(
        regenerated.newRun,
        newRuntime,
        newPlan
      );
      if (authoredPair) {
        draftStore.set(selected.profile_id, priorRun.pair_id, authoredPair);
      }

      return reply.code(200).send({
        priorRun: regenerated.priorRun,
        newRun: regenerated.newRun,
        comparison: regenerated.comparison,
        authoredPair
      });
    } catch (error) {
      return reply.code(422).send({
        error: 'REGENERATION_REJECTED',
        message: error instanceof Error ? error.message : 'Regeneration failed.'
      });
    }
  });
}
