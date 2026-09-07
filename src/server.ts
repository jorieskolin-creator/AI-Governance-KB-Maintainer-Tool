import Fastify from 'fastify';
import { checkDatabaseReady, closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildOperatorStatus } from './operator/board.js';
import { loadDomainOverlay } from './operator/overlay.js';
import { registerOperatorRoutes } from './operator/routes.js';
import { OPERATOR_DOMAINS } from './operator/board.js';
import { resumeOpenDomainPipelines } from './operator/commands.js';
import { failOrphanedStartedTasks } from './orchestration/store.js';
import { operatorLog } from './operator/log.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

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
          service: 'ai-governance-kb-maintainer-tool',
          database
        });
      }
      return {
        status: 'ready',
        service: 'ai-governance-kb-maintainer-tool',
        database
      };
    } catch (error) {
      app.log.error(error);
      return reply.code(503).send({
        status: 'not_ready',
        service: 'ai-governance-kb-maintainer-tool',
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

  return app;
}

const app = await buildApp();
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
if (process.env.DATABASE_URL?.trim()) {
  try {
    const resumed = await resumeOpenDomainPipelines();
    operatorLog('operator.pipeline.boot', resumed);
  } catch (error) {
    app.log.error(error);
  }
}
