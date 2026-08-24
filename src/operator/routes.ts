import type { FastifyInstance } from 'fastify';
import type { OperatorStatus } from './board.js';
import { renderOperatorHome } from './render-home.js';

export function registerOperatorRoutes(
  app: FastifyInstance,
  loadStatus: () => OperatorStatus | Promise<OperatorStatus>
): void {
  app.get('/', async (_request, reply) => {
    const status = await loadStatus();
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(renderOperatorHome(status));
  });

  app.get('/api/operator/status', async (_request, reply) => {
    const status = await loadStatus();
    return reply.header('cache-control', 'no-store').send(status);
  });
}
