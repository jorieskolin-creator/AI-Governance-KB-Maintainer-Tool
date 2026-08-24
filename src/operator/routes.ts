import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OperatorStatus } from './board.js';
import { parseDomainId, runNextEligibleTask, startDomainRun } from './commands.js';
import { renderOperatorHome } from './render-home.js';

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

export function registerOperatorRoutes(
  app: FastifyInstance,
  loadStatus: () => OperatorStatus | Promise<OperatorStatus>
): void {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const params = new URLSearchParams(String(body));
    done(null, Object.fromEntries(params.entries()));
  });

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

  app.post('/api/operator/commands', async (request, reply) => {
    const body = (request.body ?? {}) as { domain?: unknown; action?: unknown };
    try {
      const domain = parseDomainId(body.domain);
      const action = String(body.action ?? '');
      if (action === 'start-domain-run') {
        const result = await startDomainRun(domain);
        if (wantsHtml(request)) return reply.redirect('/');
        return result;
      }
      if (action === 'run-next-task') {
        const result = await runNextEligibleTask(domain);
        if (wantsHtml(request)) return reply.redirect('/');
        return result;
      }
      return reply.code(400).send({ error: 'Unknown operator action.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operator command failed.';
      const code = message.includes('not configured') || message.includes('disabled') ? 403 : 409;
      return reply.code(code).send({ error: message });
    }
  });
}
