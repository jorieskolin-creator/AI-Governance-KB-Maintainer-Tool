import type { OperatorDomainCard, OperatorStatus } from './board.js';
import { flowLabel, OPERATOR_DOMAINS, taskDisplayStatus, taskLabel, workOrderLabel } from './board.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
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

function domainSwitcher(status: OperatorStatus): string {
  return OPERATOR_DOMAINS.map((domain, index) => {
    const card = status.domains.find((entry) => entry.domain === domain);
    const title = card?.title ?? `Domain ${domain}`;
    const checked = index === 0 ? ' checked' : '';
    return `<label class="domain-tab">
      <input type="radio" name="domain" value="${domain}"${checked}>
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
    return `<p class="activity running">Pipeline IN_PROGRESS: <code>${escapeHtml(started.pairId)}</code> ${escapeHtml(started.taskType)}. Work order stays OPEN. Do not click again.</p>`;
  }
  const failed = failedTasks(card)[0];
  if (failed && card.commands.runNextTask.enabled) {
    return `<p class="activity failed">Pipeline BLOCKED. Current task ${escapeHtml(failed.taskType)} FAILED. No document was produced. Work order stays OPEN so the same task can be retried.</p>`;
  }
  if (!card.runId) {
    return `<p class="activity">Work order NONE. Start opens a new empty PENDING grid.</p>`;
  }
  return `<p class="activity">Work order OPEN. Pipeline WAITING. Nothing is IN_PROGRESS.</p>`;
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

function domainPanel(card: OperatorDomainCard): string {
  return `<article class="domain-panel" data-domain="${card.domain}">
    <header class="domain-head">
      <p class="kicker">Domain ${escapeHtml(card.domain)}</p>
      <h2>${escapeHtml(card.title)}</h2>
      <p class="meta">${escapeHtml(workOrderLabel(card.state, card.runId))} work order · ${String(card.pairs.length)} pairs · ${String(card.pairs[0]?.tasks.length ?? 0)} SIR tasks each</p>
      ${card.runId ? `<p class="meta">Run <code>${escapeHtml(card.runId)}</code></p>` : ''}
      ${card.baselineSha256 ? `<p class="meta">Baseline <code>${escapeHtml(card.baselineSha256.slice(0, 12))}…</code></p>` : ''}
    </header>
    ${machineStrip(card)}
    <div class="commands">
      ${commandButton('start-domain-run', card.domain, card.commands.startDomainRun, 'Start domain run')}
      ${commandButton('run-next-task', card.domain, card.commands.runNextTask, card.commands.runNextTask.next ? `Run ${card.commands.runNextTask.next.pairId} ${card.commands.runNextTask.next.taskType}` : 'Run next eligible task')}
      <p class="command-reason">${escapeHtml(card.commands.startDomainRun.enabled ? card.commands.startDomainRun.reason : card.commands.runNextTask.reason)}</p>
    </div>
    ${runActivity(card)}
    ${pairGrid(card)}
    <ol class="domain-unit">
      <li><span>Domain coherence</span><strong>locked until five pairs are VALIDATED</strong></li>
      <li><span>External approval</span><strong>human process · not granted here</strong></li>
      <li><span>Canonical compile</span><strong>pending compiler</strong></li>
      <li><span>Versioned release</span><strong>pending publication</strong></li>
    </ol>
  </article>`;
}

export function renderOperatorHome(status: OperatorStatus, notice = ''): string {
  const dbReady = status.health.database.connected && status.health.database.schemaReady;
  const flow = status.pipeline.domainFlow
    .map((step) => `<li><span>${escapeHtml(flowLabel(step))}</span></li>`)
    .join('');
  const panels = status.domains.map((card) => domainPanel(card)).join('');
  const refresh =
    status.domains.some((card) => startedTasks(card).length > 0) || notice.toLowerCase().includes('queued');
  const findings = uniqueFindings(status.findings);
  const lastCall = status.modelCalls[0];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refresh ? '<meta http-equiv="refresh" content="8">' : ''}
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
    body:has(input[name="domain"][value="A"]:checked) .domain-panel[data-domain="A"],
    body:has(input[name="domain"][value="B"]:checked) .domain-panel[data-domain="B"],
    body:has(input[name="domain"][value="C"]:checked) .domain-panel[data-domain="C"],
    body:has(input[name="domain"][value="D"]:checked) .domain-panel[data-domain="D"],
    body:has(input[name="domain"][value="E"]:checked) .domain-panel[data-domain="E"],
    body:has(input[name="domain"][value="F"]:checked) .domain-panel[data-domain="F"] {
      display: block;
    }
    .domain-head { margin-bottom: 0.9rem; }
    .domain-head h2 { font-size: 1.65rem; margin-top: 0.2rem; }
    .meta { color: var(--subtle); font-size: 0.85rem; }
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
      <p class="lede">Models author semantic content only. Code owns structure, IDs, canonical references, validation and persistence identity. Slice 2 can freeze a baseline, start a domain run and advance only the next eligible SIR task. Approval and compile stay closed.</p>
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
    <section class="board">
      <p class="kicker">Domain board</p>
      <div class="tabs" role="tablist">${domainSwitcher(status)}</div>
      ${panels}
    </section>
    <section class="note">
      <p>This board shows only the latest run for the selected domain. Start is a new baseline freeze and an empty PENDING grid. While a run is open, retry the next eligible SIR task — do not start a second run. Pair IDs stay derived as <code>A1_AP-A1</code> through <code>F5_AP-F5</code>. Commands cannot skip a SIR stage, infer tactics, or grant approval. Status: <a href="/api/operator/status"><code>/api/operator/status</code></a>.</p>
      ${
        lastCall
          ? `<p>Last model call: <code>${escapeHtml(lastCall.role)}</code> ${escapeHtml(lastCall.provider)}/${escapeHtml(lastCall.model)}${lastCall.isFallback ? ' fallback' : ''} · ${escapeHtml(lastCall.status)}</p>`
          : ''
      }
      ${
        findings.length
          ? `<ul>${findings
              .slice(0, 8)
              .map(
                (item) =>
                  `<li><code>${escapeHtml(item.objectId)}</code> ${escapeHtml(item.checkId)} · ${escapeHtml(item.severity)} — ${escapeHtml(item.issue)}</li>`
              )
              .join('')}</ul>`
          : ''
      }
    </section>
  </main>
</body>
</html>`;
}
