import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { SourceRegister } from '../assets/load.js';
import type { Finding } from '../assets/validate.js';
import { checkRegisterDrift, type DriftReport } from './drift.js';
import { createDriveClient } from './drive.js';
import { createGitHubClient } from './github.js';
import {
  createRegisterService,
  type RegisterImpact,
  type RegisterService,
  type RegisterSnapshot
} from './service.js';

function wantsHtml(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? '';
  return accept.includes('text/html') && !accept.includes('application/json');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function splitList(value: unknown): string[] {
  return asString(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function applyFormEdit(current: SourceRegister, body: Record<string, unknown>): SourceRegister {
  const next = JSON.parse(JSON.stringify(current)) as SourceRegister;
  const action = asString(body.action);
  if (action === 'update_verified') {
    const id = asString(body.source_id);
    const source = next.sources.find((entry) => entry.id === id);
    if (!source) throw new Error(`Unknown source id ${id}.`);
    source.last_verified_date = asString(body.last_verified_date);
    return next;
  }
  if (action === 'mark_superseded') {
    const id = asString(body.source_id);
    const source = next.sources.find((entry) => entry.id === id);
    if (!source) throw new Error(`Unknown source id ${id}.`);
    const superseded = asString(body.supersedes_source_id);
    source.supersedes_source_id = superseded.length > 0 ? superseded : null;
    return next;
  }
  if (action === 'add_source') {
    next.sources.push({
      id: asString(body.id),
      title: asString(body.title),
      authority_tier: asString(body.authority_tier),
      authority_type: asString(body.authority_type),
      jurisdictions: splitList(body.jurisdictions),
      roles_or_applicability_conditions: splitList(body.roles_or_applicability_conditions),
      version_or_date: asString(body.version_or_date),
      official_location: asString(body.official_location),
      effective_status: asString(body.effective_status),
      verification_status: 'VERIFIED',
      last_verified_date: asString(body.last_verified_date),
      licensing_storage_boundary: asString(body.licensing_storage_boundary),
      domain_coverage: splitList(body.domain_coverage),
      supersedes_source_id: asString(body.supersedes_source_id) || null
    });
    return next;
  }
  throw new Error('Unknown register form action.');
}

function candidateFromBody(current: SourceRegister, body: unknown): SourceRegister {
  const record = asRecord(body);
  if (record.register && typeof record.register === 'object') {
    return record.register as SourceRegister;
  }
  return applyFormEdit(current, record);
}

let sharedService: RegisterService | undefined;

export function getSharedRegisterService(): RegisterService {
  if (!sharedService) {
    sharedService = createRegisterService({
      github: createGitHubClient(),
      drive: createDriveClient()
    });
  }
  return sharedService;
}

function renderFindings(findings: Finding[]): string {
  if (!findings.length) return '';
  return `<section class="findings" data-register-findings="${String(findings.length)}">
    <p class="kicker">Validation findings</p>
    <ul>${findings
      .map(
        (finding) =>
          `<li><code>${escapeHtml(finding.code)}</code> <code>${escapeHtml(finding.path)}</code> ${escapeHtml(finding.message)}</li>`
      )
      .join('')}</ul>
  </section>`;
}

function renderDrift(drift: DriftReport | null): string {
  if (!drift || drift.match) return '';
  return `<section class="notice" data-register-drift="mismatch">
    <p class="kicker">Source register drift</p>
    <p>Git sha256 <code>${escapeHtml(drift.gitSha256 || 'unavailable')}</code> does not match Drive manifest sha256 <code>${escapeHtml(drift.manifestSha256 ?? 'unavailable')}</code>. ${escapeHtml(drift.detail)}</p>
  </section>`;
}

function renderRegisterPage(input: {
  snapshot: RegisterSnapshot;
  draft: SourceRegister | null;
  findings: Finding[];
  impact: RegisterImpact;
  draftClean: boolean;
  drift: DriftReport | null;
  notice: string;
}): string {
  const register = input.draft ?? input.snapshot.register;
  const sources = register.sources;
  const rows = sources
    .map((source) => {
      const title = typeof source.title === 'string' ? source.title : '';
      const status = source.effective_status;
      const superseded = source.supersedes_source_id ?? '';
      return `<article class="source">
        <header>
          <p class="kicker">${escapeHtml(source.id)}</p>
          <h2>${escapeHtml(title)}</h2>
          <p class="meta">${escapeHtml(status)} · verified ${escapeHtml(source.last_verified_date)}</p>
        </header>
        <form method="post" action="/operator/register/draft">
          <input type="hidden" name="action" value="update_verified">
          <input type="hidden" name="source_id" value="${escapeHtml(source.id)}">
          <label>last_verified_date
            <input type="date" name="last_verified_date" value="${escapeHtml(source.last_verified_date)}" required>
          </label>
          <button type="submit">Save date</button>
        </form>
        <form method="post" action="/operator/register/draft">
          <input type="hidden" name="action" value="mark_superseded">
          <input type="hidden" name="source_id" value="${escapeHtml(source.id)}">
          <label>supersedes_source_id
            <input name="supersedes_source_id" value="${escapeHtml(typeof superseded === 'string' ? superseded : '')}" placeholder="SRC-…">
          </label>
          <button type="submit">Mark superseded</button>
        </form>
      </article>`;
    })
    .join('');

  const approveDisabled = input.draftClean ? '' : ' disabled';
  const impact =
    input.impact.changedSourceIds.length > 0
      ? `<p class="meta">Changed source IDs: ${input.impact.changedSourceIds.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}. Affected pairs: none in Phase 1.</p>`
      : `<p class="meta">No impact flags yet. Affected pairs stay empty until pairs are published.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Source Register</title>
  <style>
    :root {
      --ink: #16130f;
      --paper: #f3eee4;
      --panel: #1f1b16;
      --line: rgba(243, 238, 228, 0.12);
      --muted: #b7aa98;
      --subtle: #8a7d6d;
      --brass: #c4a574;
      --pass: #8fb37a;
      --warn: #d4a017;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--ink); color: var(--paper); }
    body { font-family: "Source Sans 3", "Segoe UI", sans-serif; }
    a { color: var(--brass); }
    .wrap { width: min(1100px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 4rem; }
    .kicker { margin: 0; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
    h1, h2 { font-family: "Iowan Old Style", Palatino, Georgia, serif; font-weight: 500; margin: 0; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); }
    .lede, .meta { color: var(--muted); }
    .notice, .findings, .source, .add, .approve {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 1rem 1.1rem;
      margin: 1rem 0;
    }
    .notice { border-color: var(--brass); color: var(--brass); }
    .findings { border-color: #d9896f; }
    .findings li { margin: 0.35rem 0; }
    form { display: grid; gap: 0.5rem; margin: 0.75rem 0 0; }
    label { display: grid; gap: 0.25rem; color: var(--subtle); font-size: 0.8rem; }
    input, textarea, select, button {
      font: inherit;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #2a241c;
      color: var(--paper);
      padding: 0.45rem 0.6rem;
    }
    button {
      width: fit-content;
      background: var(--brass);
      color: var(--ink);
      border: 0;
      cursor: pointer;
      padding: 0.5rem 0.9rem;
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .grid { display: grid; gap: 0.75rem; }
    code { color: var(--brass); }
  </style>
</head>
<body>
  <main class="wrap">
    <p class="kicker"><a href="/">Operator home</a> · Source Register</p>
    <h1>Source Register</h1>
    <p class="lede">DRAFT-tier schema validation only. Invalid documents cannot be approved. Git is the operational master; Drive is the approved mirror.</p>
    <p class="meta">Committed version <code>${escapeHtml(input.snapshot.version)}</code> · sha256 <code>${escapeHtml(input.snapshot.sha256)}</code></p>
    ${input.notice ? `<p class="notice">${escapeHtml(input.notice)}</p>` : ''}
    ${renderDrift(input.drift)}
    ${renderFindings(input.findings)}
    ${impact}
    <form method="post" action="/operator/register/approve">
      <button type="submit"${approveDisabled} title="${input.draftClean ? 'Approve, commit to GitHub, then sync Drive' : 'Approve stays closed until validation is clean'}">Approve</button>
    </form>
    <section class="grid">${rows}</section>
    <section class="add">
      <p class="kicker">Add source</p>
      <form method="post" action="/operator/register/draft">
        <input type="hidden" name="action" value="add_source">
        <label>id <input name="id" required placeholder="SRC-EXAMPLE-2026"></label>
        <label>title <input name="title" required minlength="3"></label>
        <label>authority_tier
          <select name="authority_tier">
            <option>TIER_1_NORMATIVE</option>
            <option>TIER_2_AUTHORITATIVE</option>
            <option>TIER_3_SUPPORTING</option>
          </select>
        </label>
        <label>authority_type
          <select name="authority_type">
            <option>LEGISLATION</option>
            <option>PRIMARY_RIGHTS_SOURCE</option>
            <option>INTERNATIONAL_TREATY</option>
            <option>OFFICIAL_NON_BINDING_GUIDANCE</option>
            <option>GOVERNMENT_GUIDANCE</option>
            <option>GOVERNMENT_VOLUNTARY_GUIDANCE</option>
            <option>MULTI_AGENCY_GOVERNMENT_GUIDANCE</option>
            <option>EU_AGENCY_GUIDANCE</option>
            <option>INTERGOVERNMENTAL_POLICY_GUIDANCE</option>
            <option>PUBLISHED_STANDARD</option>
            <option>COMMUNITY_TECHNICAL_GUIDANCE</option>
          </select>
        </label>
        <label>jurisdictions <input name="jurisdictions" required placeholder="EU, FI"></label>
        <label>roles_or_applicability_conditions <textarea name="roles_or_applicability_conditions" required minlength="5"></textarea></label>
        <label>version_or_date <input name="version_or_date" required></label>
        <label>official_location <input name="official_location" type="url" required></label>
        <label>effective_status
          <select name="effective_status">
            <option>IN_FORCE</option>
            <option>PUBLISHED</option>
          </select>
        </label>
        <label>last_verified_date <input name="last_verified_date" type="date" required></label>
        <label>licensing_storage_boundary <input name="licensing_storage_boundary" required></label>
        <label>domain_coverage <input name="domain_coverage" required placeholder="A, F"></label>
        <label>supersedes_source_id <input name="supersedes_source_id" placeholder="optional SRC-…"></label>
        <button type="submit">Add source</button>
      </form>
    </section>
  </main>
</body>
</html>`;
}

async function driftFor(snapshot: RegisterSnapshot, drive = createDriveClient()): Promise<DriftReport> {
  return checkRegisterDrift({ gitSha256: snapshot.sha256, drive });
}

export function registerRegisterRoutes(app: FastifyInstance, service: RegisterService = getSharedRegisterService()): void {
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      const params = new URLSearchParams(String(body));
      done(null, Object.fromEntries(params.entries()));
    });
  }
  const page = async (
    request: FastifyRequest,
    reply: import('fastify').FastifyReply,
    extra?: { findings?: Finding[]; notice?: string; code?: number }
  ) => {
    const snapshot = service.snapshot();
    const findings = extra?.findings ?? service.findings();
    const payload = {
      register: service.pendingDraft() ?? snapshot.register,
      version: snapshot.version,
      sha256: snapshot.sha256,
      findings,
      impact: service.impact(),
      draftClean: service.draftClean()
    };
    if (wantsHtml(request)) {
      const drift = await driftFor(snapshot);
      return reply
        .code(extra?.code ?? 200)
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-store')
        .send(
          renderRegisterPage({
            snapshot,
            draft: service.pendingDraft(),
            findings,
            impact: service.impact(),
            draftClean: service.draftClean(),
            drift,
            notice: extra?.notice ?? ''
          })
        );
    }
    return reply.code(extra?.code ?? 200).header('cache-control', 'no-store').send(payload);
  };

  app.get('/operator/register', async (request, reply) => page(request, reply));

  app.post('/operator/register/draft', async (request, reply) => {
    try {
      const current = service.pendingDraft() ?? service.snapshot().register;
      const candidate = candidateFromBody(current, request.body);
      const result = service.saveDraft(candidate);
      if (!result.ok) {
        if (wantsHtml(request)) {
          return page(request, reply, {
            findings: result.findings,
            notice: 'Draft rejected. Approve stays closed.',
            code: 422
          });
        }
        return reply.code(422).send({ ok: false, findings: result.findings, impact: result.impact });
      }
      if (wantsHtml(request)) {
        return page(request, reply, { notice: 'Draft validated. Approve is enabled.' });
      }
      return reply.send({
        ok: true,
        findings: result.findings,
        impact: result.impact,
        version: result.register.version
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const findings = [{ code: 'DRAFT', path: '/', message }];
      if (wantsHtml(request)) return page(request, reply, { findings, notice: message, code: 422 });
      return reply.code(422).send({ ok: false, findings });
    }
  });

  app.get('/operator/register/impact', async (_request, reply) => {
    return reply.header('cache-control', 'no-store').send(service.impact());
  });

  app.post('/operator/register/approve', async (request, reply) => {
    const result = await service.approve();
    if (result.findings.length && result.status !== 'SYNC_FAILED') {
      const code = result.findings.some((finding) => finding.code === 'GITHUB') ? 503 : 422;
      if (wantsHtml(request)) {
        return page(request, reply, {
          findings: result.findings,
          notice: code === 503 ? result.error ?? 'GitHub commit failed.' : 'Approve blocked. Validation is not clean.',
          code
        });
      }
      return reply.code(code).send({ ok: false, findings: result.findings, error: result.error });
    }
    if (result.status === 'SYNC_FAILED') {
      if (wantsHtml(request)) {
        return page(request, reply, {
          notice: `Git commit intact. Drive sync failed: ${result.error ?? 'unknown error'}. Retry Approve.`,
          code: 502
        });
      }
      return reply.code(502).send(result);
    }
    if (wantsHtml(request)) {
      return page(request, reply, { notice: `Approved ${result.version}. Git ${result.gitCommitSha ?? ''} Drive ${result.driveFileId ?? ''}.` });
    }
    return reply.send(result);
  });

  app.get('/operator/register/drift', async (_request, reply) => {
    const snapshot = service.snapshot();
    const report = await checkRegisterDrift({
      gitSha256: snapshot.sha256,
      drive: createDriveClient()
    });
    return reply.header('cache-control', 'no-store').send(report);
  });
}
