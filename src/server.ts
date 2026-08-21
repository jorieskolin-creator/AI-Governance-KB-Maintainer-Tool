import Fastify from 'fastify';
import { checkDatabaseReady, closeDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';

const app = Fastify({ logger: true });

await runMigrations();

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

app.addHook('onClose', async () => {
  await closeDatabase();
});

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
