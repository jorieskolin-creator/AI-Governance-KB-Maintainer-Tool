import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  authorPairWorkUnit,
  createLiveAiAuthorPort,
  type AuthoredPairResult,
  type CreatorAuthorProviderPort
} from './author.js';
import type { DocumentPlanSelection, KbProfile } from './contracts.js';
import { createDocumentPlan, DocumentPlanError } from './plan.js';
import { buildSaeLocalPilotProfile, resolveProfileInputSet } from './profiles.js';
import {
  renderDocumentPlanViewHtml,
  renderDocumentsPreviewViewHtml,
  renderInputsViewHtml,
  renderSourcePreparationViewHtml
} from './render-ui.js';
import {
  prepareSourcesForPlan,
  SourcePreparationCache,
  type HostAddressResolver,
  type HttpFetchPort
} from './sources.js';

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
}

export interface CreatorRouteOptions {
  workspaceRoot?: string;
  operatorToken?: string | (() => string | undefined);
  profiles?: ReadonlyArray<KbProfile | (() => Promise<KbProfile>)>;
  redirectRootToCreator?: boolean;
  sourceCache?: SourcePreparationCache;
  draftStore?: PairDraftMemoryStore;
  allowLiveSourceFetch?: boolean;
  fetchPort?: HttpFetchPort;
  resolveAddresses?: HostAddressResolver;
  authorProviderPort?: CreatorAuthorProviderPort;
  allowLiveAuthoring?: boolean;
}

function sha256Buffer(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function extractRequestToken(request: FastifyRequest): string | null {
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
  const provided = extractRequestToken(request);
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
  const profileProviders: ReadonlyArray<KbProfile | (() => Promise<KbProfile>)> =
    options.profiles ?? [() => buildSaeLocalPilotProfile(workspaceRoot)];

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

  const loadProfiles = async (): Promise<KbProfile[]> => {
    const loaded: KbProfile[] = [];
    for (const provider of profileProviders) {
      loaded.push(typeof provider === 'function' ? await provider() : provider);
    }
    return loaded;
  };

  if (options.redirectRootToCreator) {
    app.get('/', async (request, reply) => {
      if (!authorizeCreatorRequest(request, reply, options.operatorToken)) return;
      return reply.redirect('/creator');
    });
  }

  app.get('/creator', async (request, reply) => {
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
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderInputsViewHtml({
          profiles,
          selectedProfileId: selected.profile_id,
          inputSet: runtime.inputSet
        })
      );
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

    const storedDraft = selectedPairId
      ? draftStore.get(selected.profile_id, selectedPairId) ?? null
      : null;

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
          selectedPairId,
          isSynthetic: selected.is_synthetic,
          authoredPair: storedDraft
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

    try {
      const plan = createDocumentPlan(runtime, {
        mode: 'pair',
        pair_ids: [selectedPairId],
        include_tactics: false
      });
      const sourceBundle = await prepareSourcesForPlan({
        workspaceRoot,
        runtime,
        plan,
        cache: sourceCache,
        enableUrlAcquisition: Boolean(options.fetchPort) || Boolean(options.allowLiveSourceFetch),
        fetchPort: options.fetchPort,
        resolveAddresses: options.resolveAddresses
      });
      authoredPair = await authorPairWorkUnit({
        runtime,
        plan,
        sourceBundle,
        pairId: selectedPairId,
        providerPort: authorPort
      });
      draftStore.set(selected.profile_id, selectedPairId, authoredPair);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Pair authoring failed.';
    }

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
          errorMessage
        })
      );
  });

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
    const stored = draftStore.get(profileId, pairId);
    if (!stored) {
      return reply.code(404).send({
        error: 'DRAFT_NOT_FOUND',
        message: `No authored draft found in memory for "${profileId}:${pairId}".`
      });
    }
    return reply.code(200).send({
      draftKey: `${profileId}:${pairId}`,
      authoredPair: stored
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

    if (!sourceBundle.readiness.authoring_ready) {
      return reply.code(422).send({
        error: 'SOURCE_BUNDLE_NOT_READY',
        message: 'Source preparation bundle did not pass authoring readiness.',
        inputSet: runtime.inputSet,
        plan,
        sourceBundle
      });
    }

    const documentVersion =
      typeof body.documentVersion === 'string' && body.documentVersion.trim().length > 0
        ? body.documentVersion.trim()
        : undefined;

    const authoredPair = await authorPairWorkUnit({
      runtime,
      plan,
      sourceBundle,
      pairId,
      providerPort: authorPort,
      documentVersion
    });

    const draftKey = draftStore.set(selected.profile_id, pairId, authoredPair);
    const status = authoredPair.validation.draft_valid ? 200 : 422;

    return reply.code(status).send({
      draftKey,
      inputSet: runtime.inputSet,
      plan,
      sourceBundle,
      authoredPair
    });
  });
}
