import Fastify from 'fastify';
import { checkDatabaseReady, closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildOperatorStatus } from './operator/board.js';
import { registerOperatorRoutes } from './operator/routes.js';

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
    return buildOperatorStatus({ database });
  });

  app.addHook('onClose', async () => {
    await closeDatabase();
  });

  return app;
}

const app = await buildApp();
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
