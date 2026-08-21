import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health/live', async () => ({ status: 'ok' }));
app.get('/health/ready', async () => ({ status: 'ready', service: 'ai-governance-kb-maintainer-tool' }));

const port = Number(process.env.PORT ?? 3000);

await app.listen({ port, host: '0.0.0.0' });
