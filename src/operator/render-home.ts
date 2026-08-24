import type { OperatorDomainCard, OperatorStatus } from './board.js';
import { flowLabel, OPERATOR_DOMAINS, taskLabel } from './board.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#39;');
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
          return `<td><span class="cell pending" title="${escapeHtml(cell.taskType)}">${escapeHtml(cell.status)}</span></td>`;
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

function domainPanel(card: OperatorDomainCard): string {
  return `<article class="domain-panel" data-domain="${card.domain}">
    <header class="domain-head">
      <p class="kicker">Domain ${escapeHtml(card.domain)}</p>
      <h2>${escapeHtml(card.title)}</h2>
      <p class="meta">${escapeHtml(card.state.replaceAll('_', ' '))} · ${String(card.pairs.length)} pairs · ${String(card.pairs[0]?.tasks.length ?? 0)} SIR tasks each</p>
    </header>
    ${pairGrid(card)}
    <ol class="domain-unit">
      <li><span>Domain coherence</span><strong>locked until five pairs are VALIDATED</strong></li>
      <li><span>External approval</span><strong>human process · not granted here</strong></li>
      <li><span>Canonical compile</span><strong>pending compiler</strong></li>
      <li><span>Versioned release</span><strong>pending publication</strong></li>
    </ol>
  </article>`;
}

export function renderOperatorHome(status: OperatorStatus): string {
  const dbReady = status.health.database.connected && status.health.database.schemaReady;
  const flow = status.pipeline.domainFlow
    .map((step) => `<li><span>${escapeHtml(flowLabel(step))}</span></li>`)
    .join('');
  const panels = status.domains.map((card) => domainPanel(card)).join('');

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
      .status, .flow ol, .tabs, .domain-unit { grid-template-columns: 1fr 1fr; }
      .pair-grid { display: block; overflow-x: auto; }
    }
    @media (max-width: 640px) {
      .status, .flow ol, .tabs, .domain-unit { grid-template-columns: 1fr; }
      h1 { max-width: none; }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <header class="hero">
      <p class="kicker">Knowledge production control plane · ${escapeHtml(status.slice)} · ${escapeHtml(status.mode)}</p>
      <h1>AI Governance KB Maintainer</h1>
      <p class="lede">Models author semantic content only. Code owns structure, IDs, canonical references, validation and persistence identity. This page visualizes the production flow. It does not chat, approve, compile or start a run.</p>
      <section class="status" aria-label="Service health">
        <article><p class="kicker">Live</p><strong class="pass">${escapeHtml(status.health.live)}</strong></article>
        <article><p class="kicker">Ready</p><strong class="${healthTone(status.health.ready === 'ready')}">${escapeHtml(status.health.ready)}</strong></article>
        <article><p class="kicker">Database</p><strong class="${healthTone(dbReady)}">${dbReady ? 'connected · schema ready' : 'not ready'}</strong></article>
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
      <p>No domain run is active. Pair IDs are derived as <code>A1_AP-A1</code> through <code>F5_AP-F5</code>. Start-run, repair and approval commands remain closed. Machine-readable status: <a href="/api/operator/status"><code>/api/operator/status</code></a>. Health: <a href="/health/live"><code>/health/live</code></a> · <a href="/health/ready"><code>/health/ready</code></a>.</p>
    </section>
  </main>
</body>
</html>`;
}
