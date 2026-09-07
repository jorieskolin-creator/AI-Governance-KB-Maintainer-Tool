import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OperatorStatus } from './board.js';
import { parseDomainId, runDomainPipeline, startDomainRun, runNextEligibleTask, dismissBlockingDefects, closeParkedDefect } from './commands.js';
import { operatorLog } from './log.js';
import { renderOperatorHome } from './render-home.js';
import {
  assembleDomainCandidateBundle,
  findCompiledObject,
  renderCandidateIndexHtml,
  renderCandidateObjectHtml
} from './candidate-documents.js';
import { loadPairReviewPage, renderPairReviewHtml, savePairReview } from './pair-review.js';
import { loadDomainReviewPage, renderDomainReviewHtml, saveDomainReview } from './domain-review.js';

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function noticeRedirect(reply: FastifyReply, notice: string, domain?: string) {
  const params = new URLSearchParams();
  params.set('notice', notice);
  if (domain) params.set('domain', domain);
  return reply.redirect(`/?${params.toString()}`);
}

function parseObjectId(value: unknown): string {
  const raw = String(value ?? '').trim().replace(/\.json$/i, '');
  if (!/^(AP-)?[A-F][1-5]$/.test(raw)) {
    throw new Error('Object id must be a capability or anti-pattern id such as A1 or AP-A1.');
  }
  return raw;
}

function parsePairId(domain: ReturnType<typeof parseDomainId>, value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!new RegExp(`^${domain}[1-5]_AP-${domain}[1-5]$`).test(raw)) {
    throw new Error(`Pair id must belong to domain ${domain}, such as ${domain}2_AP-${domain}2.`);
  }
  return raw;
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
    const query = request.query as { notice?: unknown; domain?: unknown };
    const notice = typeof query.notice === 'string' ? query.notice : '';
    const domain = typeof query.domain === 'string' ? query.domain : 'A';
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(renderOperatorHome(status, notice, domain));
  });

  app.get('/api/operator/status', async (_request, reply) => {
    const status = await loadStatus();
    return reply.header('cache-control', 'no-store').send(status);
  });

  app.get('/api/operator/documents/:domain', async (request, reply) => {
    try {
      const domain = parseDomainId((request.params as { domain?: unknown }).domain);
      const bundle = await assembleDomainCandidateBundle(domain);
      return reply.header('cache-control', 'no-store').send(bundle);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Document assembly failed.';
      return reply.code(409).send({ error: message });
    }
  });

  app.get('/api/operator/documents/:domain/:objectId', async (request, reply) => {
    try {
      const params = request.params as { domain?: unknown; objectId?: unknown };
      const domain = parseDomainId(params.domain);
      const objectId = parseObjectId(params.objectId);
      const bundle = await assembleDomainCandidateBundle(domain);
      const object = findCompiledObject(bundle, objectId);
      if (!object) {
        const item = bundle.documents.find((entry) => entry.objectId === objectId);
        return reply.code(409).send({ error: item?.error ?? `${objectId} has no DRAFT document.` });
      }
      return reply.header('cache-control', 'no-store').send(object);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Document assembly failed.';
      return reply.code(409).send({ error: message });
    }
  });

  app.get('/documents/:domain', async (request, reply) => {
    try {
      const domain = parseDomainId((request.params as { domain?: unknown }).domain);
      const bundle = await assembleDomainCandidateBundle(domain);
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(renderCandidateIndexHtml(bundle));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Document assembly failed.';
      return noticeRedirect(reply, message, String((request.params as { domain?: unknown }).domain ?? ''));
    }
  });

  app.get('/documents/:domain/:objectId', async (request, reply) => {
    try {
      const params = request.params as { domain?: unknown; objectId?: unknown };
      const domain = parseDomainId(params.domain);
      const objectId = parseObjectId(params.objectId);
      const bundle = await assembleDomainCandidateBundle(domain);
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(renderCandidateObjectHtml({ domain, bundle, objectId }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Document assembly failed.';
      return noticeRedirect(reply, message, String((request.params as { domain?: unknown }).domain ?? ''));
    }
  });

  app.get('/review/:domain', async (request, reply) => {
    try {
      const params = request.params as { domain?: unknown };
      const query = request.query as { notice?: unknown };
      const domain = parseDomainId(params.domain);
      const notice = typeof query.notice === 'string' ? query.notice : '';
      const page = await loadDomainReviewPage(domain, notice);
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(renderDomainReviewHtml(page));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Domain review failed.';
      return noticeRedirect(reply, message, String((request.params as { domain?: unknown }).domain ?? ''));
    }
  });

  app.get('/review/:domain/:pairId', async (request, reply) => {
    try {
      const params = request.params as { domain?: unknown; pairId?: unknown };
      const query = request.query as { notice?: unknown };
      const domain = parseDomainId(params.domain);
      const pairId = parsePairId(domain, params.pairId);
      const notice = typeof query.notice === 'string' ? query.notice : '';
      const page = await loadPairReviewPage(domain, pairId, notice);
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(renderPairReviewHtml(page));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pair review failed.';
      return noticeRedirect(reply, message, String((request.params as { domain?: unknown }).domain ?? ''));
    }
  });

  app.post('/api/operator/commands', async (request, reply) => {
    const body = (request.body ?? {}) as { domain?: unknown; action?: unknown; findingId?: unknown; pairId?: unknown };
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
            `Started domain ${domain}. Pipeline is running pair SIR tasks until the domain is ready.`,
            domain
          );
        }
        return result;
      }
      if (action === 'run-next-task') {
        if (wantsHtml(request)) {
          queueDomainPipeline(domain, request);
          return noticeRedirect(
            reply,
            `Domain ${domain} pipeline is running. It stops when the domain is ready or a task fails.`,
            domain
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
      if (action === 'dismiss-blocking-defects') {
        const result = await dismissBlockingDefects(domain);
        operatorLog('operator.command.finished', {
          action,
          domain,
          pairId: result.pairId,
          parked: result.parked
        });
        if (wantsHtml(request)) {
          return noticeRedirect(
            reply,
            `Parked ${String(result.parked)} HIGH blocker(s) on ${result.pairId} for later review. Remaining pairs can continue.`,
            domain
          );
        }
        return result;
      }
      if (action === 'close-parked-defect') {
        const findingId = String(body.findingId ?? '').trim();
        if (!findingId) {
          throw new Error('Parked item id is missing.');
        }
        const result = await closeParkedDefect(domain, findingId);
        if (wantsHtml(request)) {
          return noticeRedirect(
            reply,
            result.pairValidated
              ? 'Closed the parked item. That pair is VALIDATED only because Pair Coherence actually passed.'
              : 'Closed the parked item. The pair stays deferred until Pair Coherence passes or remaining blockers are reviewed and Saved.',
            domain
          );
        }
        return result;
      }
      if (action === 'save-domain-review') {
        const result = await saveDomainReview({
          domain,
          body: body as Record<string, unknown>
        });
        operatorLog('operator.command.finished', {
          action,
          domain,
          persisted: result.persisted,
          humanApproved: result.humanApproved,
          passed: result.passed
        });
        if (!result.persisted) {
          const message = result.gateIssues.join(' ') || 'Schema gate rejected the save.';
          if (wantsHtml(request)) {
            const page = await loadDomainReviewPage(domain, message);
            page.gateIssues = result.gateIssues;
            return reply
              .code(409)
              .type('text/html; charset=utf-8')
              .header('cache-control', 'no-store')
              .send(renderDomainReviewHtml(page));
          }
          return reply.code(409).send({ error: message, ...result });
        }
        const notice = result.passed
          ? `Human approved domain ${domain}. Section schema and reference-graph gate passed. Recorded dispositions are bound to this candidate revision. Domain Coherence now passes.`
          : `Human approved domain ${domain} edits. Section schema and reference-graph gate passed. Open HIGH domain blockers still remain.`;
        if (wantsHtml(request)) {
          return reply.redirect(`/review/${domain}?notice=${encodeURIComponent(notice)}`);
        }
        return result;
      }
      if (action === 'save-pair-review') {
        const pairId = parsePairId(domain, body.pairId);
        const result = await savePairReview({
          domain,
          pairId,
          body: body as Record<string, unknown>
        });
        operatorLog('operator.command.finished', {
          action,
          domain,
          pairId: result.pairId,
          persisted: result.persisted,
          humanApproved: result.humanApproved,
          passed: result.passed
        });
        if (!result.persisted) {
          const message = result.gateIssues.join(' ') || 'Schema gate rejected the save.';
          if (wantsHtml(request)) {
            const page = await loadPairReviewPage(domain, pairId, message);
            page.gateIssues = result.gateIssues;
            return reply
              .code(409)
              .type('text/html; charset=utf-8')
              .header('cache-control', 'no-store')
              .send(renderPairReviewHtml(page));
          }
          return reply.code(409).send({ error: message, ...result });
        }
        const notice = result.passed
          ? `Human approved ${pairId}. Section schema and reference-graph gate passed. Recorded dispositions are bound to this candidate revision. Pair Coherence now passes.`
          : `Human approved ${pairId} edits. Section schema and reference-graph gate passed. Open HIGH blockers still remain.`;
        if (wantsHtml(request)) {
          return reply.redirect(
            `/review/${domain}/${pairId}?notice=${encodeURIComponent(notice)}`
          );
        }
        return result;
      }
      operatorLog('operator.command.rejected', { action, domain: body.domain, reason: 'unknown-action' });
      if (wantsHtml(request)) return noticeRedirect(reply, 'Command was missing action. Retry from the board.', String(body.domain ?? ''));
      return reply.code(400).send({ error: 'Unknown operator action.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operator command failed.';
      operatorLog('operator.command.rejected', { action, error: message });
      const code = message.includes('not configured') || message.includes('disabled') ? 403 : 409;
      if ((action === 'save-pair-review' || action === 'save-domain-review') && wantsHtml(request)) {
        try {
          const domain = parseDomainId(body.domain);
          if (action === 'save-domain-review') {
            const page = await loadDomainReviewPage(domain, message);
            page.gateIssues = [message];
            return reply
              .code(code)
              .type('text/html; charset=utf-8')
              .header('cache-control', 'no-store')
              .send(renderDomainReviewHtml(page));
          }
          const pairId = parsePairId(domain, body.pairId);
          const page = await loadPairReviewPage(domain, pairId, message);
          page.gateIssues = [message];
          return reply
            .code(code)
            .type('text/html; charset=utf-8')
            .header('cache-control', 'no-store')
            .send(renderPairReviewHtml(page));
        } catch {
          return noticeRedirect(reply, message, String(body.domain ?? ''));
        }
      }
      if (wantsHtml(request)) return noticeRedirect(reply, message, String(body.domain ?? ''));
      return reply.code(code).send({ error: message });
    }
  });
}
