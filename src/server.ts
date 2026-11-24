import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { loadSourceRegister } from './assets/load.js';
import { checkDatabaseReady, closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildCreatorApp } from './document-creator/app.js';
import { PostgresCreatorRunStore } from './document-creator/store.js';
import { buildOperatorStatus } from './operator/board.js';
import { loadDomainOverlay } from './operator/overlay.js';
import { registerOperatorRoutes } from './operator/routes.js';
import { OPERATOR_DOMAINS } from './operator/board.js';
import { resumeOpenDomainPipelines } from './operator/commands.js';
import { failOrphanedStartedTasks } from './orchestration/store.js';
import { operatorLog } from './operator/log.js';
import { checkRegisterDriftOnBoot } from './register/drift.js';
import { registerRegisterRoutes } from './register/routes.js';

export type CreatorApplicationMode = 'legacy' | 'document';

export function resolveCreatorMode(raw = process.env.CREATOR_MODE): CreatorApplicationMode {
  const normalized = (raw ?? 'document').trim().toLowerCase();
  if (normalized === 'document' || normalized === '') return 'document';
  if (normalized === 'legacy') return 'legacy';
  throw new Error(`Unsupported CREATOR_MODE "${String(raw)}"; expected "legacy" or "document".`);
}

export function resolvePilotCreatorMode(raw = process.env.CREATOR_MODE): CreatorApplicationMode {
  return resolveCreatorMode(raw);
}

export interface BuildAppOptions {
  modeOverride?: CreatorApplicationMode;
  usePostgresStore?: boolean;
  allowOpenBrowserAccessWithoutToken?: boolean;
  allowLiveSourceFetch?: boolean;
  allowLiveAuthoring?: boolean;
}

export async function buildApp(
  modeOrOptions?: CreatorApplicationMode | BuildAppOptions
) {
  const opts: BuildAppOptions =
    typeof modeOrOptions === 'string'
      ? { modeOverride: modeOrOptions }
      : modeOrOptions ?? {};
  const mode = opts.modeOverride ?? resolveCreatorMode();
  if (mode === 'document') {
    const usePostgresStore =
      (opts.usePostgresStore ?? process.env.CREATOR_USE_POSTGRES_STORE === 'true') &&
      Boolean(process.env.DATABASE_URL?.trim());
    if (usePostgresStore) {
      await runMigrations();
    }
    return buildCreatorApp({
      logger: true,
      runStore: usePostgresStore ? new PostgresCreatorRunStore() : undefined,
      allowOpenBrowserAccessWithoutToken:
        opts.allowOpenBrowserAccessWithoutToken ?? false,
      allowLiveSourceFetch:
        opts.allowLiveSourceFetch ??
        process.env.CREATOR_ALLOW_LIVE_SOURCE_FETCH !== 'false',
      allowLiveAuthoring:
        opts.allowLiveAuthoring ??
        process.env.CREATOR_ALLOW_LIVE_AUTHORING !== 'false'
    });
  }

  const loadedRegister = loadSourceRegister();
  const app = Fastify({ logger: true });
  app.log.info(
    { version: loadedRegister.version, sha256: loadedRegister.sha256 },
    'source register loaded'
  );

  if (process.env.DATABASE_URL?.trim()) {
    await runMigrations();
  } else {
    app.log.warn('DATABASE_URL is not set; operator home will serve in degraded mode.');
  }

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try {
      const database = await checkDatabaseReady();
      if (!database.connected || !database.schemaReady) {
        return reply.code(503).send({
          status: 'not_ready',
          service: 'kb-document-creator',
          database
        });
      }
      return {
        status: 'ready',
        service: 'kb-document-creator',
        database
      };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({
        status: 'not_ready',
        service: 'kb-document-creator',
        database: { connected: false, schemaReady: false }
      });
    }
  });

  registerOperatorRoutes(app, async () => {
    let database = { connected: false, schemaReady: false };
    try {
      database = await checkDatabaseReady();
    } catch {
      database = { connected: false, schemaReady: false };
    }
    const dbReady = database.connected && database.schemaReady;
    const overlays = dbReady
      ? await Promise.all(OPERATOR_DOMAINS.map((domain) => loadDomainOverlay(domain, true)))
      : [];
    return buildOperatorStatus({
      database,
      overlays: overlays.filter((item): item is NonNullable<typeof item> => Boolean(item))
    });
  });

  registerRegisterRoutes(app);

  app.addHook('onClose', async () => {
    try {
      const reclaimed = await failOrphanedStartedTasks();
      if (reclaimed.length) {
        operatorLog('operator.pipeline.reclaimed_started', { reason: 'shutdown', tasks: reclaimed });
      }
    } catch (error) {
      app.log.error(error);
    }
    await closeDatabase();
  });

  try {
    await checkRegisterDriftOnBoot(app.log);
  } catch (error) {
    app.log.warn(error, 'source register drift check failed');
  }

  return app;
}

function isMainEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainEntrypoint()) {
  const mode = resolveCreatorMode();
  const app = await buildApp({
    modeOverride: mode,
    usePostgresStore: Boolean(process.env.DATABASE_URL?.trim()),
    allowOpenBrowserAccessWithoutToken: true,
    allowLiveSourceFetch: process.env.CREATOR_ALLOW_LIVE_SOURCE_FETCH !== 'false',
    allowLiveAuthoring: process.env.CREATOR_ALLOW_LIVE_AUTHORING !== 'false'
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: '0.0.0.0' });
  if (mode === 'legacy' && process.env.DATABASE_URL?.trim()) {
    try {
      const resumed = await resumeOpenDomainPipelines();
      operatorLog('operator.pipeline.boot', resumed);
    } catch (error) {
      app.log.error(error);
    }
  }
}
