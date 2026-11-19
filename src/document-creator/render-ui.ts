import type { DocumentPlan, KbProfile, ResolvedInputSet } from './contracts.js';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderStageNav(activeStage: 'inputs' | 'plan'): string {
  const stages: ReadonlyArray<{ id: string; label: string; href?: string; status: string }> = [
    { id: 'inputs', label: '1. Inputs', href: '/creator', status: activeStage === 'inputs' ? 'Current' : 'Available' },
    { id: 'plan', label: '2. Document plan', href: '/creator/plan', status: activeStage === 'plan' ? 'Current' : 'Available' },
    { id: 'documents', label: '3. Documents', status: 'Pending DC-03/04' },
    { id: 'delivery', label: '4. Delivery', status: 'Pending DC-05' },
    { id: 'history', label: '5. History', status: 'Pending DC-04/05' }
  ];

  return `<nav aria-label="Creator workflow stages">
    <ol class="stages">
      ${stages
        .map((stage) => {
          const currentAttr = stage.id === activeStage ? ' aria-current="step"' : '';
          const labelHtml = stage.href
            ? `<a href="${escapeHtml(stage.href)}">${escapeHtml(stage.label)}</a>`
            : `<span>${escapeHtml(stage.label)}</span>`;
          return `<li${currentAttr}>${labelHtml} <small>(${escapeHtml(stage.status)})</small></li>`;
        })
        .join('')}
    </ol>
  </nav>`;
}

function pageLayout(title: string, activeStage: 'inputs' | 'plan', bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — KB Document Creator</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.45; margin: 0 auto; max-width: 1120px; padding: 1.25rem; color: #111827; background: #f9fafb; }
    header, section { background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    .stages { display: flex; flex-wrap: wrap; gap: 0.75rem; list-style: none; padding: 0; margin: 0.5rem 0 0; }
    .stages li { border: 1px solid #d1d5db; border-radius: 4px; padding: 0.35rem 0.65rem; background: #f3f4f6; }
    .stages li[aria-current="step"] { border-color: #1d4ed8; background: #eff6ff; font-weight: 600; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; border: 1px solid #6b7280; font-size: 0.85rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.92rem; }
    th, td { border: 1px solid #e5e7eb; padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    form.controls { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-weight: 600; font-size: 0.9rem; }
    select, input, button { font: inherit; padding: 0.4rem 0.6rem; border: 1px solid #9ca3af; border-radius: 4px; }
    button.primary { background: #1d4ed8; color: #ffffff; border-color: #1e40af; font-weight: 600; cursor: pointer; }
    code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.88em; }
  </style>
</head>
<body>
  <header>
    <h1>KB Document Creator</h1>
    <p>Create reviewed Markdown knowledge documents from explicitly pinned inputs. Master Table Creator and Knowledge Hub remain separate tools.</p>
    ${renderStageNav(activeStage)}
  </header>
  <main>
    ${bodyHtml}
  </main>
</body>
</html>`;
}

export function renderInputsViewHtml(options: {
  profiles: ReadonlyArray<Pick<KbProfile, 'profile_id' | 'kb_id' | 'kb_title' | 'is_synthetic'>>;
  selectedProfileId: string;
  inputSet: ResolvedInputSet;
}): string {
  const { profiles, selectedProfileId, inputSet } = options;
  const syntheticBanner = inputSet.is_synthetic
    ? `<p role="status" class="badge">SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE</p>`
    : '';

  const findingsRows =
    inputSet.readiness.findings.length === 0
      ? '<p>No readiness findings.</p>'
      : `<table>
          <thead><tr><th>Severity</th><th>Tier</th><th>Code</th><th>Path</th><th>Message</th></tr></thead>
          <tbody>
            ${inputSet.readiness.findings
              .map(
                (f) =>
                  `<tr><td>${escapeHtml(f.severity)}</td><td>${escapeHtml(f.tier)}</td><td><code>${escapeHtml(f.code)}</code></td><td><code>${escapeHtml(f.path)}</code></td><td>${escapeHtml(f.message)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>`;

  const conflictsHtml =
    inputSet.conflicts.length === 0
      ? '<p>No cross-input conflicts detected.</p>'
      : `<table>
          <thead><tr><th>Conflict ID</th><th>Sources</th><th>Affected Objects</th><th>Blocks Delivery</th><th>Detail</th></tr></thead>
          <tbody>
            ${inputSet.conflicts
              .map(
                (c) =>
                  `<tr><td><code>${escapeHtml(c.conflict_id)}</code></td><td>${escapeHtml(c.sources.join(', '))}</td><td>${escapeHtml(c.affected_object_ids.join(', ') || 'global')}</td><td>${c.blocks_delivery ? 'Yes' : 'No'}</td><td>${escapeHtml(c.message)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>`;

  const decisionsHtml =
    inputSet.applied_owner_decisions.length === 0
      ? '<p>No scoped owner decisions applied.</p>'
      : `<ul>
          ${inputSet.applied_owner_decisions
            .map(
              (d) =>
                `<li><code>${escapeHtml(d.decision_id)}</code> (${escapeHtml(d.role)} v${escapeHtml(d.version)}) — Effective: <strong>${escapeHtml(d.effective_status)}</strong>; Original provenance retained: <code>${escapeHtml(d.original_status_text)}</code></li>`
            )
            .join('')}
        </ul>`;

  const body = `
    <section aria-labelledby="select-inputs-heading">
      <h2 id="select-inputs-heading">Inputs readiness</h2>
      ${syntheticBanner}
      <form class="controls" method="get" action="/creator">
        <label>
          KB Profile
          <select name="profileId">
            ${profiles
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.profile_id)}"${p.profile_id === selectedProfileId ? ' selected' : ''}>${escapeHtml(p.kb_title)} (${escapeHtml(p.profile_id)}${p.is_synthetic ? ' · synthetic' : ''})</option>`
              )
              .join('')}
          </select>
        </label>
        <button class="primary" type="submit">Validate inputs</button>
      </form>
      <p>
        Planning status: <strong>${inputSet.readiness.planning_ready ? 'READY' : 'INPUTS_REQUIRED'}</strong> ·
        Authoring status: <strong>${inputSet.readiness.authoring_ready ? 'READY' : 'AWAITING_SOURCE_PASSAGES'}</strong> ·
        Destination (${escapeHtml(inputSet.storage.provider)}: <code>${escapeHtml(inputSet.storage.output_root)}</code>): <strong>${inputSet.storage.destination_ready ? 'WRITABLE' : 'NOT_READY'}</strong>
      </p>
      <p>
        Coverage summary: <strong>${String(inputSet.coverage_matrix.length)}</strong> objects ·
        Registered sources: <strong>${String(inputSet.source_summary.registered_source_count)}</strong>
        (metadata-only: ${String(inputSet.source_summary.metadata_only_source_ids.length)}, unused by current scope: ${String(inputSet.source_summary.unused_registered_source_ids.length)})
      </p>
    </section>

    <section aria-labelledby="findings-heading">
      <h2 id="findings-heading">Readiness findings</h2>
      ${findingsRows}
      <h3>Cross-input conflicts</h3>
      ${conflictsHtml}
      <h3>Scoped owner input decisions</h3>
      ${decisionsHtml}
    </section>

    <section aria-labelledby="technical-details-heading">
      <details>
        <summary id="technical-details-heading"><strong>Secondary panel: Pinned input versions and SHA-256 hashes</strong> (<code>${escapeHtml(inputSet.input_set_id)}</code>)</summary>
        <table>
          <thead><tr><th>Role</th><th>Version</th><th>Path</th><th>Bytes</th><th>SHA-256</th></tr></thead>
          <tbody>
            ${inputSet.resolved_inputs
              .map(
                (item) =>
                  `<tr><td><code>${escapeHtml(item.role)}</code></td><td>${escapeHtml(item.version)}</td><td><code>${escapeHtml(item.path)}</code></td><td>${String(item.byte_length)}</td><td><code>${escapeHtml(item.sha256)}</code></td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </details>
    </section>
  `;

  return pageLayout('Inputs', 'inputs', body);
}

export function renderDocumentPlanViewHtml(options: {
  profiles: ReadonlyArray<Pick<KbProfile, 'profile_id' | 'kb_id' | 'kb_title' | 'is_synthetic'>>;
  selectedProfileId: string;
  availablePairs: ReadonlyArray<{ pair_id: string; domain_id: string; title: string }>;
  availableDomains: ReadonlyArray<string>;
  inputSet: ResolvedInputSet;
  plan: DocumentPlan | null;
  errorMessage?: string;
}): string {
  const { profiles, selectedProfileId, availablePairs, availableDomains, inputSet, plan, errorMessage } = options;
  const defaultPair = availablePairs[0]?.pair_id ?? '';

  const planTableHtml = !plan
    ? `<p role="alert">${escapeHtml(errorMessage ?? 'Plan unavailable until required inputs pass readiness.')}</p>`
    : `<p>
        Plan ID: <code>${escapeHtml(plan.plan_id)}</code> ·
        Work units: <strong>${String(plan.summary.work_unit_count)}</strong> ·
        Capabilities: <strong>${String(plan.summary.capability_count)}</strong> ·
        Anti-patterns: <strong>${String(plan.summary.antipattern_count)}</strong> ·
        Tactics: <strong>${String(plan.summary.tactic_count)}</strong> ·
        Primary format: <strong>Markdown (<code>.md</code>)</strong>
      </p>
      <table>
        <thead>
          <tr>
            <th>Document ID</th>
            <th>Type</th>
            <th>Title</th>
            <th>Paired Object</th>
            <th>Questions</th>
            <th>Associated Tactics (Non-Activation)</th>
            <th>Destination Path Template</th>
          </tr>
        </thead>
        <tbody>
          ${plan.documents
            .map(
              (doc) =>
                `<tr>
                  <td><code>${escapeHtml(doc.document_id)}</code></td>
                  <td>${escapeHtml(doc.object_type)}</td>
                  <td>${escapeHtml(doc.title)}</td>
                  <td>${doc.paired_object_id ? `<code>${escapeHtml(doc.paired_object_id)}</code>` : '—'}</td>
                  <td>${String(doc.questions.length)}</td>
                  <td>${doc.tactic_associations.length > 0 ? escapeHtml(doc.tactic_associations.map((t) => t.tactic_id).join(', ')) : 'None'}</td>
                  <td><code>${escapeHtml(doc.destination_path_template)}</code></td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

  const body = `
    <section aria-labelledby="plan-controls-heading">
      <h2 id="plan-controls-heading">Document plan checklist</h2>
      ${inputSet.is_synthetic ? '<p role="status" class="badge">SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE</p>' : ''}
      <form class="controls" method="get" action="/creator/plan">
        <label>
          KB Profile
          <select name="profileId">
            ${profiles
              .map(
                (p) =>
                  `<option value="${escapeHtml(p.profile_id)}"${p.profile_id === selectedProfileId ? ' selected' : ''}>${escapeHtml(p.kb_title)} (${escapeHtml(p.profile_id)})</option>`
              )
              .join('')}
          </select>
        </label>
        <label>
          Scope mode
          <select name="mode">
            <option value="pair"${plan?.selection.mode === 'pair' ? ' selected' : ''}>Single pair</option>
            <option value="domain"${plan?.selection.mode === 'domain' ? ' selected' : ''}>Domain</option>
            <option value="all"${plan?.selection.mode === 'all' ? ' selected' : ''}>All pairs</option>
          </select>
        </label>
        <label>
          Pair ID
          <select name="pairId">
            ${availablePairs
              .map(
                (pair) =>
                  `<option value="${escapeHtml(pair.pair_id)}"${(plan?.selection.pair_ids[0] ?? defaultPair) === pair.pair_id ? ' selected' : ''}>${escapeHtml(pair.pair_id)} (${escapeHtml(pair.domain_id)} — ${escapeHtml(pair.title)})</option>`
              )
              .join('')}
          </select>
        </label>
        <label>
          Domain ID
          <select name="domainId">
            ${availableDomains
              .map(
                (dom) =>
                  `<option value="${escapeHtml(dom)}"${plan?.selection.domain_ids[0] === dom ? ' selected' : ''}>${escapeHtml(dom)}</option>`
              )
              .join('')}
          </select>
        </label>
        <label>
          Include tactics
          <select name="includeTactics">
            <option value="false"${!plan?.selection.include_tactics ? ' selected' : ''}>No (default)</option>
            <option value="true"${plan?.selection.include_tactics ? ' selected' : ''}>Yes — associated tactics</option>
          </select>
        </label>
        <button class="primary" type="submit">Preview document plan</button>
      </form>
      <p><small>Note: Capability and paired anti-pattern are planned as one work unit where configured, but delivered as two independent Markdown documents. Associated tactics never confer customer finding activation.</small></p>
    </section>

    <section aria-labelledby="planned-outputs-heading">
      <h2 id="planned-outputs-heading">Planned outputs</h2>
      ${planTableHtml}
    </section>
  `;

  return pageLayout('Document Plan', 'plan', body);
}
