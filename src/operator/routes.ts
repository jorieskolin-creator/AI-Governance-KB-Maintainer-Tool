import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OperatorStatus } from './board.js';
import { parseDomainId, runDomainPipeline, startDomainRun, runNextEligibleTask } from './commands.js';
import { operatorLog } from './log.js';
import { renderOperatorHome } from './render-home.js';

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function noticeRedirect(reply: FastifyReply, notice: string) {
  return reply.redirect(`/?notice=${encodeURIComponent(notice)}`);
}

function queueDomainPipeline(domain: ReturnType<typeof parseDomainId>, request: FastifyRequest): void {
  operatorLog('operator.pipeline.queued', { domain });
  setImmediate(() => {
    runDomainPipeline(domain)
      .then((result) => {
        operatorLog('operator.pipeline.finished', {
          domain,
          status: result.status,
          completedCount: result.completed.length,
          last: result.completed.at(-1),
          reason: result.reason
        });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        operatorLog('operator.pipeline.failed', { domain, error: message });
        request.log.error(error);
      });
  });
}

export function registerOperatorRoutes(
  app: FastifyInstance,
  loadStatus: () => OperatorStatus | Promise<OperatorStatus>
): void {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    const params = new URLSearchParams(String(body));
    done(null, Object.fromEntries(params.entries()));
  });

  app.get('/', async (request, reply) => {
    const status = await loadStatus();
    const query = request.query as { notice?: unknown };
    const notice = typeof query.notice === 'string' ? query.notice : '';
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(renderOperatorHome(status, notice));
  });

  app.get('/api/operator/status', async (_request, reply) => {
    const status = await loadStatus();
    return reply.header('cache-control', 'no-store').send(status);
  });

  app.post('/api/operator/commands', async (request, reply) => {
    const body = (request.body ?? {}) as { domain?: unknown; action?: unknown };
    const action = String(body.action ?? '').trim();
    operatorLog('operator.command.received', {
      action,
      domain: body.domain,
      contentType: request.headers['content-type'] ?? '',
      bodyKeys: Object.keys(body)
    });
    try {
      const domain = parseDomainId(body.domain);
      if (action === 'start-domain-run') {
        const result = await startDomainRun(domain);
        operatorLog('operator.run.started', { domain, domainRunId: result.domainRunId });
        if (wantsHtml(request)) {
          queueDomainPipeline(domain, request);
          return noticeRedirect(
            reply,
            `Started domain ${domain}. Pipeline is running pair SIR tasks until the domain is ready.`
          );
        }
        return result;
      }
      if (action === 'run-next-task') {
        if (wantsHtml(request)) {
          queueDomainPipeline(domain, request);
          return noticeRedirect(
            reply,
            `Domain ${domain} pipeline is running. It stops when the domain is ready or a task fails.`
          );
        }
        const result = await runNextEligibleTask(domain);
        operatorLog('operator.task.finished', {
          domain,
          pairId: result.next.pairId,
          taskType: result.next.taskType,
          usedFallback: result.usedFallback
        });
        return result;
      }
      operatorLog('operator.command.rejected', { action, domain: body.domain, reason: 'unknown-action' });
      if (wantsHtml(request)) return noticeRedirect(reply, 'Command was missing action. Retry from the board.');
      return reply.code(400).send({ error: 'Unknown operator action.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operator command failed.';
      operatorLog('operator.command.rejected', { action, error: message });
      const code = message.includes('not configured') || message.includes('disabled') ? 403 : 409;
      if (wantsHtml(request)) return noticeRedirect(reply, message);
      return reply.code(code).send({ error: message });
    }
  });
}
