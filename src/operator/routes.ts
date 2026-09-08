import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OperatorStatus } from './board.js';
import {
  closeParkedDefect,
  dismissBlockingDefects,
  operatorCommandsEnabled,
  parseDomainId,
  runDomainPipeline,
  runNextEligibleTask,
  startDomainRun
} from './commands.js';
import { operatorLog } from './log.js';
import { renderOperatorHome } from './render-home.js';
import {
  assembleDomainCandidateBundle,
  findCompiledObject,
  renderCandidateIndexHtml,
  renderCandidateObjectHtml
} from './candidate-documents.js';
import { approvalBytesResponse, renderApprovalReviewHtml } from './approval-review.js';
import {
  assembleDomainApprovalBundle,
  parseFrozenApprovalBundle
} from '../release/assemble-approval-bundle.js';
import {
  loadDomainApprovalForCandidate,
  loadLatestDomainApprovalForDomain,
  loadFrozenApprovalBundle
} from '../orchestration/store.js';
import {
  publishApprovedRelease,
  recordApproval
} from '../release/operator-release.js';
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

function parseSha256(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(raw)) {
    throw new Error('Artifact digest must be a 64-character SHA-256 hex string.');
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

  app.get('/approval/:domain', async (request, reply) => {
    try {
      const domain = parseDomainId((request.params as { domain?: unknown }).domain);
      const expected = (request.query as { candidate?: unknown }).candidate;
      const candidate = typeof expected === 'string' ? expected : undefined;
      const result = await assembleDomainApprovalBundle({
        domain,
        expectedDomainCandidateHash: candidate
      });
      let recordedApproval:
        | { approvalReference: string; effectiveFrom: string; releaseManifestSha256: string }
        | undefined;
      let bundle = result.ok ? result.bundle : undefined;
      let bundleSha256 = result.ok ? result.bundleSha256 : undefined;
      if (!result.ok) {
        const approval = candidate
          ? await loadDomainApprovalForCandidate({ domain, domainCandidateHash: candidate })
          : await loadLatestDomainApprovalForDomain(domain);
        const frozen = approval ? await loadFrozenApprovalBundle(approval.domainCandidateHash) : undefined;
        const frozenBundle = frozen ? parseFrozenApprovalBundle(frozen.bundle) : undefined;
        if (approval && frozen && frozenBundle && frozen.bundleSha256 === approval.approvalBundleSha256) {
          bundle = frozenBundle;
          bundleSha256 = frozen.bundleSha256;
          recordedApproval = {
            approvalReference: approval.approvalReference,
            effectiveFrom: approval.effectiveFrom,
            releaseManifestSha256: approval.releaseManifestSha256
          };
        }
      }
      const html = renderApprovalReviewHtml({
        domain,
        domainCandidateHash: result.domainCandidateHash ?? candidate,
        issues: result.ok || recordedApproval ? [] : result.issues,
        bundle,
        bundleSha256,
        commandsEnabled: operatorCommandsEnabled(),
        recordedApproval
      });
      return reply
        .code(result.ok || recordedApproval ? 200 : 409)
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(html);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval bundle assembly failed.';
      return noticeRedirect(reply, message, String((request.params as { domain?: unknown }).domain ?? ''));
    }
  });

  app.get('/api/operator/approval/:domain', async (request, reply) => {
    try {
      const domain = parseDomainId((request.params as { domain?: unknown }).domain);
      const expected = (request.query as { candidate?: unknown }).candidate;
      const result = await assembleDomainApprovalBundle({
        domain,
        expectedDomainCandidateHash: typeof expected === 'string' ? expected : undefined
      });
      if (!result.ok) {
        return reply.code(409).send({ error: result.issues.join(' '), ...result });
      }
      return reply.header('cache-control', 'no-store').send({
        documentKind: result.bundle.documentKind,
        domainCandidateHash: result.domainCandidateHash,
        bundleSha256: result.bundleSha256,
        bundle: result.bundle,
        approval: result.bundle.approval,
        releaseStatus: result.bundle.releaseStatus
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval bundle assembly failed.';
      return reply.code(409).send({ error: message });
    }
  });

  app.get('/api/operator/approval/:domain/bytes/:sha256', async (request, reply) => {
    try {
      const domain = parseDomainId((request.params as { domain?: unknown }).domain);
      const digest = parseSha256((request.params as { sha256?: unknown }).sha256);
      const expected = (request.query as { candidate?: unknown }).candidate;
      const result = await assembleDomainApprovalBundle({
        domain,
        expectedDomainCandidateHash: typeof expected === 'string' ? expected : undefined
      });
      if (!result.ok) {
        return reply.code(409).send({ error: result.issues.join(' ') });
      }
      const payload = approvalBytesResponse(result.payloads, digest);
      if (!payload) {
        return reply.code(409).send({ error: 'Requested bytes are not in the current approval bundle.' });
      }
      return reply
        .type(payload.contentType)
        .header('cache-control', 'no-store')
        .header('x-canonical-sha256', digest)
        .send(payload.utf8);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval bytes lookup failed.';
      return reply.code(409).send({ error: message });
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
    const body = (request.body ?? {}) as {
      domain?: unknown;
      action?: unknown;
      findingId?: unknown;
      pairId?: unknown;
      domainCandidateHash?: unknown;
      approvalBundleSha256?: unknown;
      proposedManifestSha256?: unknown;
      releaseManifestSha256?: unknown;
      approvalReference?: unknown;
      effectiveFrom?: unknown;
    };
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
      if (action === 'record-approval') {
        if (!operatorCommandsEnabled()) {
          throw new Error('Operator commands are disabled on this deployment.');
        }
        const result = await recordApproval({
          domain,
          domainCandidateHash: parseSha256(body.domainCandidateHash),
          approvalBundleSha256: parseSha256(body.approvalBundleSha256),
          proposedManifestSha256: parseSha256(body.proposedManifestSha256),
          approvalReference: String(body.approvalReference ?? ''),
          effectiveFrom: String(body.effectiveFrom ?? '')
        });
        operatorLog('operator.approval.recorded', {
          domain,
          domainRunId: result.domainRunId,
          domainCandidateHash: result.domainCandidateHash,
          releaseManifestSha256: result.releaseManifestSha256,
          idempotent: result.idempotent
        });
        if (wantsHtml(request)) {
          return reply.redirect(
            `/approval/${domain}?candidate=${encodeURIComponent(result.domainCandidateHash)}`
          );
        }
        return result;
      }
      if (action === 'publish-approved-release') {
        if (!operatorCommandsEnabled()) {
          throw new Error('Operator commands are disabled on this deployment.');
        }
        const result = await publishApprovedRelease({
          domain,
          domainCandidateHash: parseSha256(body.domainCandidateHash),
          approvalBundleSha256: parseSha256(body.approvalBundleSha256),
          releaseManifestSha256: parseSha256(body.releaseManifestSha256)
        });
        operatorLog('operator.release.published', {
          domain,
          releaseId: result.releaseId,
          manifestSha256: result.manifestSha256,
          idempotent: result.idempotent
        });
        if (wantsHtml(request)) {
          return noticeRedirect(
            reply,
            `Published immutable release ${result.manifest.domain_release_version} with manifest ${result.manifestSha256}.`,
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
