import type { OperatorDomainCard, OperatorStatus } from './board.js';
import { flowLabel, OPERATOR_DOMAINS, taskDisplayStatus, taskLabel, workOrderLabel } from './board.js';
import { operatorTaskBoundaryWording } from '../orchestration/task-boundaries.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function activityTone(state: OperatorStatus['pipelineActivity']['state']): string {
  if (state === 'RUNNING') return 'warn';
  if (state === 'BLOCKED' || state === 'NOT_READY') return 'fail';
  return 'pass';
}

function healthTone(ready: boolean): string {
  return ready ? 'pass' : 'warn';
}

function domainSwitcher(status: OperatorStatus, selected: string): string {
  return OPERATOR_DOMAINS.map((domain) => {
    const card = status.domains.find((entry) => entry.domain === domain);
    const title = card?.title ?? `Domain ${domain}`;
    const checked = domain === selected ? ' checked' : '';
    return `<label class="domain-tab">
      <input type="radio" name="board-domain" value="${domain}"${checked}>
      <span class="domain-tab-id">${domain}</span>
      <span class="domain-tab-title">${escapeHtml(title)}</span>
    </label>`;
  }).join('');
}

function pairGrid(card: OperatorDomainCard): string {
  const head = card.pairs
    .map(
      (pair) => `<th scope="col">
        <span class="pair-id">${escapeHtml(pair.pairId)}</span>
        <span class="pair-state">${escapeHtml(pair.state.replaceAll('_', ' '))}</span>
      </th>`
    )
    .join('');

  const first = card.pairs[0];
  if (!first) throw new Error(`Domain ${card.domain} is missing pair columns.`);

  const rows = first.tasks
    .map((task, taskIndex) => {
      const cells = card.pairs
        .map((pair) => {
          const cell = pair.tasks[taskIndex];
          if (!cell) throw new Error(`Missing ${task.taskType} for ${pair.pairId}.`);
          return `<td><span class="cell ${escapeHtml(cell.status.toLowerCase())}" title="${escapeHtml(cell.taskType)}">${escapeHtml(taskDisplayStatus(cell.status))}</span></td>`;
        })
        .join('');
      return `<tr>
        <th scope="row">
          <span class="task-label">${escapeHtml(taskLabel(task.taskType))}</span>
          <span class="task-id">${escapeHtml(task.taskType)}</span>
        </th>
        ${cells}
      </tr>`;
    })
    .join('');

  return `<table class="pair-grid">
    <thead>
      <tr>
        <th scope="col">SIR task</th>
        ${head}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function uniqueFindings(
  findings: OperatorStatus['findings']
): OperatorStatus['findings'] {
  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.objectId}|${item.checkId}|${item.issue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function startedTasks(card: OperatorDomainCard): Array<{ pairId: string; taskType: string }> {
  return card.pairs.flatMap((pair) =>
    pair.tasks.filter((task) => task.status === 'STARTED').map((task) => ({ pairId: pair.pairId, taskType: task.taskType }))
  );
}

function failedTasks(card: OperatorDomainCard): Array<{ pairId: string; taskType: string }> {
  return card.pairs.flatMap((pair) =>
    pair.tasks.filter((task) => task.status === 'FAILED').map((task) => ({ pairId: pair.pairId, taskType: task.taskType }))
  );
}

function runActivity(card: OperatorDomainCard): string {
  const started = startedTasks(card)[0];
  if (started) {
    return `<p class="activity running">Pipeline IN_PROGRESS: <code>${escapeHtml(started.pairId)}</code> ${escapeHtml(started.taskType)}. Remaining pair SIR tasks continue automatically. Work order stays OPEN. Domain B stays closed.</p>`;
  }
  const failed = failedTasks(card)[0];
  if (failed && card.commands.runNextTask.enabled) {
    return `<p class="activity failed">Pipeline BLOCKED. Current task ${escapeHtml(failed.taskType)} FAILED. No document was produced. Retry the same task; the domain pipeline then continues. Approval is not requested per step.</p>`;
  }
  const repair = card.pairs.find((pair) => pair.state === 'REPAIR_REQUIRED');
  if (repair) {
    return `<p class="activity">Pipeline WAITING. <code>${escapeHtml(repair.pairId)}</code> is REPAIR_REQUIRED. QC defects are listed below. Continue repairs those recommended paths, then re-checks pair coherence. Approval is not requested.</p>`;
  }
  if (!card.runId) {
    return `<p class="activity">Work order NONE. Start freezes the baseline and runs pair SIR tasks until the domain is ready.</p>`;
  }
  if (card.documents.available) {
    if (card.review.available && card.review.kind === 'DOMAIN') {
      return `<p class="activity">Work order OPEN. Five pairs are VALIDATED, but Domain Coherence listed HIGH defects. Review remaining domain blockers. Record an explicit disposition with authority and rationale. Deleting a finding does not close it. Continue stays closed until no HIGH domain defects remain.</p>`;
    }
    if (card.review.available) {
      return `<p class="activity">Work order OPEN. Pair artifacts exist, but ${escapeHtml(card.review.pairId)} Pair Coherence did not pass. Review remaining HIGH blockers. Record an explicit disposition with authority and rationale. Deleting a finding does not close it. Domain Coherence stays closed until every pair actually passed.</p>`;
    }
    if (card.documents.approvalAvailable) {
      return `<p class="activity">Work order OPEN. Domain coherence passed. The hash-bound approval bundle is the exact bytes publication would release. Record operator approval against those hashes. Publication stays a separate operation.</p>`;
    }
      return `<p class="activity">Work order OPEN. Five pairs are VALIDATED. DRAFT documents are assembled from those artifacts and still show unresolved issues. Continue runs DOMAIN_COHERENCE_REVIEW and then stops. Operator approval and published release stay closed.</p>`;
  }
  return `<p class="activity">Work order OPEN. Pipeline WAITING. Continue runs remaining pair SIR tasks without asking approval after each step. Stops when the domain is ready or a task fails.</p>`;
}

function machineStrip(card: OperatorDomainCard): string {
  const started = startedTasks(card)[0];
  const failed = failedTasks(card)[0];
  const workOrder = workOrderLabel(card.state, card.runId);
  const currentTask = started
    ? `${started.taskType} IN_PROGRESS`
    : failed
      ? `${failed.taskType} FAILED`
      : 'NONE';
  const pipeline = started ? 'IN_PROGRESS' : failed ? 'BLOCKED' : card.runId ? 'WAITING' : 'IDLE';
  return `<dl class="machines">
      <div><dt>Work order</dt><dd>${escapeHtml(workOrder)}</dd></div>
      <div><dt>Current task</dt><dd>${escapeHtml(currentTask)}</dd></div>
      <div><dt>Pipeline</dt><dd>${escapeHtml(pipeline)}</dd></div>
    </dl>`;
}

function commandButton(action: string, domain: string, command: { enabled: boolean; reason: string }, label: string): string {
  const disabled = command.enabled ? '' : ' disabled';
  return `<form class="command-form" method="post" action="/api/operator/commands">
      <input type="hidden" name="domain" value="${escapeHtml(domain)}">
      <input type="hidden" name="action" value="${escapeHtml(action)}">
      <button type="submit"${disabled} title="${escapeHtml(command.reason)}">${escapeHtml(label)}</button>
    </form>`;
}

function reviewButton(card: OperatorDomainCard): string {
  if (!card.review.available) return '';
  return `<a class="review-link" href="${escapeHtml(card.review.href)}" title="${escapeHtml(card.review.reason)}">Review remaining HIGH blockers</a>`;
}

function continueLabel(card: OperatorDomainCard): string {
  const failed = failedTasks(card)[0];
  if (failed) return `Retry ${failed.pairId} ${failed.taskType} and continue domain`;
  if (card.commands.runNextTask.next?.taskType === 'LOCAL_REPAIR') {
    return `Repair ${card.commands.runNextTask.next.pairId} QC defects and re-check pair coherence`;
  }
  if (card.commands.runNextTask.next?.taskType === 'DOMAIN_COHERENCE_REVIEW') {
    return `Run domain ${card.domain} DOMAIN_COHERENCE_REVIEW`;
  }
  if (card.commands.runNextTask.next) return `Continue domain ${card.domain} until ready`;
  return 'Continue domain until ready';
}

function parkedList(card: OperatorDomainCard): string {
  const items = card.parkedFindings ?? [];
  if (!items.length) return '';
  return `<section class="defects parked">
      <p class="kicker">Parked for later review</p>
      <p class="meta">Items parked via Park HIGH blockers or Save &amp; Finalize Later. They do not stop remaining pairs, but the domain stays fail-closed for approval until they are resolved. Close removes an item from this queue; schema and IDs stay code-owned.</p>
      <ul>${items
        .map(
          (item) =>
            `<li><strong>${escapeHtml(item.severity)}</strong> <code>${escapeHtml(item.objectId)}</code> ${escapeHtml(item.checkId)}${item.objectPath ? ` · <code>${escapeHtml(item.objectPath)}</code>` : ''}${item.parkOwner ? ` · owner <code>${escapeHtml(item.parkOwner)}</code>` : ''}<br>${escapeHtml(item.issue)}${item.parkReason ? `<br><span class="meta">Reason: ${escapeHtml(item.parkReason)}</span>` : ''}
            <form class="command-form" method="post" action="/api/operator/commands">
              <input type="hidden" name="domain" value="${escapeHtml(card.domain)}">
              <input type="hidden" name="action" value="close-parked-defect">
              <input type="hidden" name="findingId" value="${escapeHtml(item.id)}">
              <button type="submit">Close this parked item</button>
            </form></li>`
        )
        .join('')}</ul>
    </section>`;
}

function documentList(card: OperatorDomainCard): string {
  if (!card.documents.available && !card.documents.approvalAvailable) return '';
  const draft = card.documents.available
    ? `<p><a href="${escapeHtml(card.documents.indexHref)}">Open domain ${escapeHtml(card.domain)} DRAFT documents</a>
        · <a href="${escapeHtml(card.documents.bundleHref)}">DRAFT JSON</a></p>`
    : '';
  const approval = `<p><a href="${escapeHtml(card.documents.approvalHref)}">${
    card.documents.approvalAvailable
      ? `Open domain ${escapeHtml(card.domain)} hash-bound approval bundle`
      : `Approval bundle stays closed until READY_FOR_APPROVAL`
  }</a></p>`;
  return `<section class="defects documents">
      <p class="kicker">DRAFT production candidates</p>
      <p class="meta">DRAFT documents stay visible with unresolved issues. The approval bundle binds the reviewed candidate and proposed manifest. Recording operator approval finalizes immutable APPROVED bytes; publication remains a separate operation.</p>
      ${draft}
      ${approval}
    </section>`;
}

function defectList(card: OperatorDomainCard): string {
  const items = uniqueFindings(card.findings ?? []);
  if (!items.length) return '';
  const reviewLink = card.review.available
    ? `<p><a href="${escapeHtml(card.review.href)}">Open defected object: Fix, Maintainer fix, or Park</a></p>`
    : '';
  return `<section class="defects">
      <p class="kicker">QC defects</p>
      <p class="meta">Open the defected object to Fix the touched section, ask the Maintainer to fix it, or Park that pair. QC save records dispositions on the current candidate revision. It is not domain APPROVED and does not publish.</p>
      <ul>${items
        .map(
          (item) =>
            `<li><strong>${escapeHtml(item.severity)}</strong> <code>${escapeHtml(item.objectId)}</code> ${escapeHtml(item.checkId)}${item.objectPath ? ` · <code>${escapeHtml(item.objectPath)}</code>` : ''}<br>${escapeHtml(item.issue)}</li>`
        )
        .join('')}</ul>
      ${reviewLink}
    </section>`;
}

function domainPanel(card: OperatorDomainCard): string {
  return `<article class="domain-panel" data-domain="${card.domain}">
    <header class="domain-head">
      <p class="kicker">Domain ${escapeHtml(card.domain)}</p>
      <h2>${escapeHtml(card.title)}</h2>
      <p class="meta">${escapeHtml(workOrderLabel(card.state, card.runId))} work order · ${String(card.pairs.length)} pairs · ${String(card.pairs[0]?.tasks.length ?? 0)} SIR tasks each</p>
      ${card.runId ? `<p class="meta">Run <code>${escapeHtml(card.runId)}</code></p>` : ''}
      ${card.baselineSha256 ? `<p class="meta">Baseline <code>${escapeHtml(card.baselineSha256.slice(0, 12))}…</code></p>` : ''}
      ${
        card.lastModelCall
          ? `<p class="meta">Last model call <code>${escapeHtml(card.lastModelCall.role)}</code> ${escapeHtml(card.lastModelCall.provider)}/${escapeHtml(card.lastModelCall.model)}${card.lastModelCall.isFallback ? ' fallback' : ''} · ${escapeHtml(card.lastModelCall.status)}</p>`
          : ''
      }
    </header>
    ${machineStrip(card)}
    <div class="commands">
      ${commandButton('start-domain-run', card.domain, card.commands.startDomainRun, 'Start domain run')}
      ${commandButton('run-next-task', card.domain, card.commands.runNextTask, continueLabel(card))}
      ${commandButton('dismiss-blocking-defects', card.domain, card.commands.dismissBlockers, 'Park HIGH blockers for later review')}
      ${reviewButton(card)}
      <p class="command-reason">${escapeHtml(card.review.available ? card.review.reason : card.commands.startDomainRun.enabled ? card.commands.startDomainRun.reason : card.commands.dismissBlockers.enabled ? card.commands.dismissBlockers.reason : card.commands.runNextTask.reason)}</p>
    </div>
    ${runActivity(card)}
    ${documentList(card)}
    ${defectList(card)}
    ${parkedList(card)}
    ${pairGrid(card)}
    <ol class="domain-unit">
      <li><span>Domain coherence</span><strong>${
        card.commands.runNextTask.next?.taskType === 'DOMAIN_COHERENCE_REVIEW'
          ? 'eligible · Continue runs the five-pair review'
          : card.state === 'READY_FOR_APPROVAL'
            ? 'passed · hash-bound approval bundle ready for review · not APPROVED'
            : card.state === 'REPAIR_REQUIRED' && card.pairs.every((pair) => pair.state === 'VALIDATED' || pair.state === 'DEFERRED')
              ? 'HIGH defects listed'
              : 'after five pairs are VALIDATED'
      }</strong></li>
      <li><span>Operator approval</span><strong>${card.commands.recordApproval.enabled ? 'current hash-bound bundle may be approved' : 'after READY_FOR_APPROVAL'}</strong></li>
      <li><span>Production candidates</span><strong>${
        card.documents.available ? 'DRAFT documents available · unresolved issues remain visible · not APPROVED' : 'after five pairs are VALIDATED'
      }</strong></li>
      <li><span>Approval bundle</span><strong>${
        card.documents.approvalAvailable
          ? 'hash-bound candidate and proposed manifest'
          : 'after READY_FOR_APPROVAL'
      }</strong></li>
      <li><span>Canonical compile</span><strong>release bytes finalize only after APPROVED</strong></li>
      <li><span>Versioned release</span><strong>separate idempotent operation after APPROVED</strong></li>
    </ol>
  </article>`;
}

export function renderOperatorHome(status: OperatorStatus, notice = '', selectedDomain = 'A'): string {
  const dbReady = status.health.database.connected && status.health.database.schemaReady;
  const flow = status.pipeline.domainFlow
    .map((step) => `<li><span>${escapeHtml(flowLabel(step))}</span></li>`)
    .join('');
  const selected = (OPERATOR_DOMAINS as readonly string[]).includes(selectedDomain) ? selectedDomain : 'A';
  const panels = status.domains.map((card) => domainPanel(card)).join('');
  const running = status.domains.some((card) => startedTasks(card).length > 0);
  const waitingForStart = !running && notice.toLowerCase().includes('running');
  const refreshMs = running ? 8000 : waitingForStart ? 2000 : 0;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI Governance KB Maintainer</title>
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
      --pending: #6f675c;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: var(--ink); color: var(--paper); }
    body {
      font-family: "Source Sans 3", "Segoe UI", sans-serif;
      letter-spacing: 0.01em;
    }
    h1, h2 {
      font-family: "Iowan Old Style", Palatino, Georgia, serif;
      font-weight: 500;
      letter-spacing: -0.03em;
      margin: 0;
    }
    a { color: var(--brass); }
    .wrap { width: min(1180px, calc(100% - 2rem)); margin: 0 auto; padding: 2rem 0 4rem; }
    header.hero { display: grid; gap: 1rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--line); }
    .kicker {
      margin: 0;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.7rem;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
    }
    h1 { font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.05; max-width: 14ch; }
    .lede { margin: 0; max-width: 42rem; color: var(--muted); line-height: 1.55; }
    .status {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
      margin: 1.25rem 0 0;
    }
    .status article, .flow, .board, .note {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
    }
    .status article { padding: 0.9rem 1rem; }
    .status strong { display: block; margin-top: 0.35rem; font-size: 0.95rem; }
    .pass { color: var(--pass); }
    .warn { color: var(--warn); }
    .fail { color: #d9896f; }
    .status { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .notice {
      margin: 1rem 0 0;
      padding: 0.75rem 1rem;
      border: 1px solid var(--brass);
      border-radius: 10px;
      color: var(--brass);
    }
    .flow { margin: 1.25rem 0; padding: 1rem 1.1rem 0.4rem; }
    .flow ol {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.6rem;
      padding: 0;
      margin: 0.8rem 0 1rem;
      list-style: none;
    }
    .flow li {
      min-height: 3.4rem;
      padding: 0.7rem 0.75rem;
      border: 1px solid var(--line);
      border-radius: 10px;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .board { padding: 1rem; }
    .tabs {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 0.5rem;
      margin: 0.9rem 0 1rem;
    }
    .domain-tab {
      display: grid;
      gap: 0.2rem;
      padding: 0.7rem 0.65rem;
      border: 1px solid var(--line);
      border-radius: 10px;
      cursor: pointer;
    }
    .domain-tab input { position: absolute; opacity: 0; pointer-events: none; }
    .domain-tab-id {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      color: var(--brass);
      font-size: 0.8rem;
    }
    .domain-tab-title { color: var(--muted); font-size: 0.72rem; line-height: 1.35; }
    .domain-tab:has(input:checked) {
      background: #2a241c;
      border-color: var(--brass);
    }
    .domain-panel { display: none; }
    body:has(input[name="board-domain"][value="A"]:checked) .domain-panel[data-domain="A"],
    body:has(input[name="board-domain"][value="B"]:checked) .domain-panel[data-domain="B"],
    body:has(input[name="board-domain"][value="C"]:checked) .domain-panel[data-domain="C"],
    body:has(input[name="board-domain"][value="D"]:checked) .domain-panel[data-domain="D"],
    body:has(input[name="board-domain"][value="E"]:checked) .domain-panel[data-domain="E"],
    body:has(input[name="board-domain"][value="F"]:checked) .domain-panel[data-domain="F"] {
      display: block;
    }
    .domain-head { margin-bottom: 0.9rem; }
    .domain-head h2 { font-size: 1.65rem; margin-top: 0.2rem; }
    .meta { color: var(--subtle); font-size: 0.85rem; }
    .defects {
      margin: 0.8rem 0 1rem;
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #241e18;
    }
    .defects ul { margin: 0.4rem 0 0; padding-left: 1.1rem; }
    .defects li { margin: 0.45rem 0; color: var(--muted); line-height: 1.4; }
    .defects strong { color: #d9896f; margin-right: 0.35rem; }
    .defects.parked strong { color: var(--brass); }
    .defects.parked button { margin-top: 0.4rem; }
    .defects.documents a { color: var(--brass); }
    .pair-grid { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    .pair-grid th, .pair-grid td {
      border-bottom: 1px solid var(--line);
      padding: 0.45rem 0.4rem;
      text-align: left;
      vertical-align: top;
    }
    .pair-id, .task-id {
      display: block;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.68rem;
      color: var(--brass);
    }
    .pair-state, .task-label { display: block; }
    .task-label { color: var(--paper); }
    .task-id { color: var(--subtle); margin-top: 0.1rem; }
    .cell {
      display: inline-block;
      padding: 0.15rem 0.4rem;
      border-radius: 999px;
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.62rem;
      letter-spacing: 0.08em;
    }
    .pending { color: var(--pending); background: rgba(111, 103, 92, 0.16); }
    .completed { color: var(--pass); background: rgba(143, 179, 122, 0.16); }
    .failed { color: #d9896f; background: rgba(217, 137, 111, 0.16); }
    .started { color: var(--warn); background: rgba(212, 160, 23, 0.16); }
    .commands { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin: 0 0 1rem; }
    .commands button {
      appearance: none;
      border: 1px solid var(--brass);
      background: #2a241c;
      color: var(--paper);
      border-radius: 999px;
      padding: 0.45rem 0.9rem;
      cursor: pointer;
      font: inherit;
    }
    .commands button:disabled { opacity: 0.45; cursor: not-allowed; border-color: var(--line); }
    .review-link {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--brass);
      background: #2a241c;
      color: var(--paper);
      border-radius: 999px;
      padding: 0.45rem 0.9rem;
      text-decoration: none;
    }
    .command-reason { margin: 0; color: var(--subtle); font-size: 0.8rem; flex: 1 1 16rem; }
    .machines {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.6rem;
      margin: 0 0 1rem;
    }
    .machines div {
      padding: 0.7rem 0.75rem;
      border: 1px solid var(--line);
      border-radius: 10px;
    }
    .machines dt {
      font-size: 0.68rem;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--subtle);
    }
    .machines dd { margin: 0.25rem 0 0; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
    .activity { margin: 0 0 1rem; color: var(--muted); font-size: 0.88rem; line-height: 1.45; }
    .activity.running { color: var(--warn); }
    .activity.failed { color: #d9896f; }
    .domain-unit {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.6rem;
      list-style: none;
      padding: 0;
      margin: 1rem 0 0;
    }
    .domain-unit li {
      padding: 0.75rem 0.8rem;
      border: 1px solid var(--line);
      border-radius: 10px;
    }
    .domain-unit span { display: block; color: var(--subtle); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; }
    .domain-unit strong { display: block; margin-top: 0.3rem; font-weight: 500; color: var(--muted); }
    .note { margin-top: 1.25rem; padding: 1rem 1.1rem; color: var(--muted); line-height: 1.55; }
    .note code { color: var(--brass); }
    @media (max-width: 900px) {
      .status, .flow ol, .tabs, .domain-unit, .machines { grid-template-columns: 1fr 1fr; }
      .pair-grid { display: block; overflow-x: auto; }
    }
    @media (max-width: 640px) {
      .status, .flow ol, .tabs, .domain-unit, .machines { grid-template-columns: 1fr; }
      h1 { max-width: none; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <header class="hero">
      <p class="kicker">Knowledge production control plane · ${escapeHtml(status.slice)} · ${escapeHtml(status.mode)}</p>
      <h1>AI Governance KB Maintainer</h1>
      <p class="lede">Models author semantic content only. Code owns structure, IDs, canonical references, validation and persistence identity. Remaining HIGH blockers are a human review/fix loop on the same page: Fix the touched section, ask the Maintainer to fix it, or Park that pair. Focused checks cover the section you touched plus its handles and references. VALIDATED, READY_FOR_APPROVAL, and publication still require complete section schemas, locked vocabulary, identity, and no unresolved parked items. After five pairs actually pass Pair Coherence, DRAFT documents stay visible with unresolved issues and Continue runs DOMAIN_COHERENCE_REVIEW. When the domain is READY_FOR_APPROVAL, the approval bundle binds the candidate and proposed manifest hashes. Operator approval finalizes immutable APPROVED bytes; publication is a separate hash-verified operation.</p>
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ''}
      <section class="status" aria-label="Service health">
        <article><p class="kicker">Live</p><strong class="pass">${escapeHtml(status.health.live)}</strong></article>
        <article><p class="kicker">Ready</p><strong class="${healthTone(status.health.ready === 'ready')}">${escapeHtml(status.health.ready)}</strong></article>
        <article><p class="kicker">Database</p><strong class="${healthTone(dbReady)}">${dbReady ? 'connected · schema ready' : 'not ready'}</strong></article>
        <article><p class="kicker">Pipeline</p><strong class="${activityTone(status.pipelineActivity.state)}">${escapeHtml(status.pipelineActivity.state === 'RUNNING' ? 'IN_PROGRESS' : status.pipelineActivity.state)}</strong><p class="meta">${escapeHtml(status.pipelineActivity.detail)}</p></article>
      </section>
    </header>
    <section class="flow">
      <p class="kicker">Domain flow</p>
      <ol>${flow}</ol>
    </section>
    <section class="flow">
      <p class="kicker">Task boundaries</p>
      <p class="lede">${escapeHtml(operatorTaskBoundaryWording())}</p>
    </section>
    <section class="board">
      <p class="kicker">Domain board</p>
      <div class="tabs" role="tablist">${domainSwitcher(status, selected)}</div>
      ${panels}
    </section>
    <section class="note">
      <p>This board shows only the latest run for the selected domain. Status: <a href="/api/operator/status"><code>/api/operator/status</code></a>.</p>
    </section>
  </main>
  <script>
  (function () {
    var inflight = false;
    var refreshMs = ${String(refreshMs)};
    function selectedDomain() {
      var checked = document.querySelector('input[name="board-domain"]:checked');
      return checked ? checked.value : ${JSON.stringify(selected)};
    }
    function withDomain(path) {
      return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'domain=' + encodeURIComponent(selectedDomain());
    }
    document.querySelectorAll('.command-form').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (inflight) return;
        var button = form.querySelector('button');
        if (!button || button.disabled) return;
        inflight = true;
        button.disabled = true;
        var body = new URLSearchParams(new FormData(form));
        fetch('/api/operator/commands', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'text/html' },
          body: body,
          redirect: 'manual'
        }).then(function () {
          var domain = body.get('domain') || selectedDomain();
          var action = body.get('action') || '';
          var notice = 'Domain ' + domain + ' pipeline is running. It stops when the domain is ready or a task fails.';
          if (action === 'dismiss-blocking-defects') {
            notice = 'Parked HIGH blockers for later review. Remaining pairs can continue.';
          } else if (action === 'close-parked-defect') {
            notice = 'Closed a parked item.';
          }
          window.location.assign(withDomain('/?notice=' + encodeURIComponent(notice)));
        }).catch(function () {
          inflight = false;
          button.disabled = false;
        });
      });
    });
    if (refreshMs > 0) {
      setTimeout(function () {
        if (inflight) return;
        window.location.replace(withDomain('/'));
      }, refreshMs);
    }
  })();
  </script>
</body>
</html>`;
}
