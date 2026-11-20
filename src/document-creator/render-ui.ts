import type { AuthoredPairResult } from './author.js';
import type {
  DocumentPlan,
  KbProfile,
  ResolvedInputSet,
  SourcePreparationBundle
} from './contracts.js';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

type CreatorUiStage = 'inputs' | 'plan' | 'sources' | 'documents';

function renderStageNav(activeStage: CreatorUiStage): string {
  const stages: ReadonlyArray<{ id: string; label: string; href?: string; status: string }> = [
    { id: 'inputs', label: '1. Inputs', href: '/creator', status: activeStage === 'inputs' ? 'Current' : 'Available' },
    { id: 'plan', label: '2. Document plan', href: '/creator/plan', status: activeStage === 'plan' ? 'Current' : 'Available' },
    { id: 'sources', label: '2b. Source inspection', href: '/creator/sources', status: activeStage === 'sources' ? 'Current' : 'Available' },
    { id: 'documents', label: '3. Documents', href: '/creator/documents', status: activeStage === 'documents' ? 'Current' : 'Available' },
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

function pageLayout(title: string, activeStage: CreatorUiStage, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — KB Document Creator</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.45; margin: 0 auto; max-width: 1120px; padding: 1.25rem; color: #111827; background: #f9fafb; }
    header, section { background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
    article.creator-doc-preview { background: #ffffff; border: 1px solid #9ca3af; border-radius: 6px; padding: 1rem 1.25rem; margin-top: 1rem; }
    .stages { display: flex; flex-wrap: wrap; gap: 0.75rem; list-style: none; padding: 0; margin: 0.5rem 0 0; }
    .stages li { border: 1px solid #d1d5db; border-radius: 4px; padding: 0.35rem 0.65rem; background: #f3f4f6; }
    .stages li[aria-current="step"] { border-color: #1d4ed8; background: #eff6ff; font-weight: 600; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; border: 1px solid #6b7280; font-size: 0.85rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.75rem; font-size: 0.92rem; }
    th, td { border: 1px solid #e5e7eb; padding: 0.45rem 0.6rem; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    form.controls { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; margin-bottom: 0.75rem; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-weight: 600; font-size: 0.9rem; }
    select, input, button { font: inherit; padding: 0.4rem 0.6rem; border: 1px solid #9ca3af; border-radius: 4px; }
    button.primary { background: #1d4ed8; color: #ffffff; border-color: #1e40af; font-weight: 600; cursor: pointer; }
    code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.88em; }
    pre.markdown-source { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; padding: 0.75rem; overflow-x: auto; white-space: pre-wrap; font-size: 0.85rem; }
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

export function renderSourcePreparationViewHtml(options: {
  profiles: ReadonlyArray<Pick<KbProfile, 'profile_id' | 'kb_id' | 'kb_title' | 'is_synthetic'>>;
  selectedProfileId: string;
  availablePairs: ReadonlyArray<{ pair_id: string; domain_id: string; title: string }>;
  selectedPairId: string;
  bundle: SourcePreparationBundle | null;
  errorMessage?: string;
}): string {
  const { profiles, selectedProfileId, availablePairs, selectedPairId, bundle, errorMessage } = options;

  const baselinesHtml = !bundle
    ? `<p role="alert">${escapeHtml(errorMessage ?? 'Source preparation unavailable until required inputs pass readiness.')}</p>`
    : bundle.pair_baselines
        .map((pb) => {
          const pdf = pb.criteria_from_pdf;
          const tf = pb.thinking_flow_baseline;
          return `<article>
            <h3>${escapeHtml(pb.pair_id)} (Domain ${escapeHtml(pb.domain_id)})</h3>
            ${
              pdf
                ? `<p>Criteria locator: <code>${escapeHtml(pdf.locator)}</code> · Applicability: ${escapeHtml(pdf.applicability)}</p>
                   <p><strong>${escapeHtml(pdf.capability_id)} — ${escapeHtml(pdf.capability_title)}:</strong> ${escapeHtml(pdf.capability_definition)}</p>
                   <p>Capability indicators: ${escapeHtml(pdf.capability_indicators.join(' · '))}</p>
                   <p><strong>${escapeHtml(pdf.antipattern_id)} — ${escapeHtml(pdf.antipattern_title)}:</strong> ${escapeHtml(pdf.antipattern_definition)}</p>
                   <p>Anti-pattern indicators: ${escapeHtml(pdf.antipattern_indicators.join(' · '))}</p>`
                : '<p role="alert">Missing PDF criteria section for this pair.</p>'
            }
            <p>Thinking Flow v${escapeHtml(tf.cognitive_model_version)} questions: <code>${escapeHtml([...tf.capability_questions, ...tf.antipattern_questions].map((q) => q.id).join(', '))}</code></p>
          </article>`;
        })
        .join('');

  const supportHtml = !bundle
    ? ''
    : `<table>
        <thead>
          <tr>
            <th>Object</th>
            <th>Criteria Locator</th>
            <th>Questions</th>
            <th>Support Status</th>
            <th>Model-Eligible Passages</th>
            <th>Metadata-Only Sources</th>
            <th>Unavailable / Blocked</th>
          </tr>
        </thead>
        <tbody>
          ${bundle.criterion_support
            .map(
              (cs) =>
                `<tr>
                  <td><code>${escapeHtml(cs.object_id)}</code> (${escapeHtml(cs.object_type)})</td>
                  <td>${cs.criteria_locator ? `<code>${escapeHtml(cs.criteria_locator)}</code>` : 'Missing'}</td>
                  <td><code>${escapeHtml(cs.question_ids.join(', '))}</code></td>
                  <td><strong>${escapeHtml(cs.support_status)}</strong></td>
                  <td>${String(cs.usable_source_unit_ids.length)}</td>
                  <td>${cs.metadata_only_source_ids.length > 0 ? escapeHtml(cs.metadata_only_source_ids.join(', ')) : '0'}</td>
                  <td>${cs.unavailable_source_ids.length > 0 ? escapeHtml(cs.unavailable_source_ids.join(', ')) : '0'}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

  const unitsHtml = !bundle
    ? ''
    : `<table>
        <thead>
          <tr>
            <th>Source ID / Edition</th>
            <th>Origin</th>
            <th>Locator</th>
            <th>Status</th>
            <th>Model Eligible</th>
            <th>Warnings / Excerpt Preview</th>
          </tr>
        </thead>
        <tbody>
          ${bundle.source_units
            .map((u) => {
              const maxPreviewChars = 200;
              const preview = u.text
                ? `${u.text.slice(0, maxPreviewChars)}${u.text.length > maxPreviewChars ? '…' : ''}`
                : 'No passage text';
              const warnings = [...u.limitations, ...u.untrusted_content_flags].join('; ');
              return `<tr>
                <td><code>${escapeHtml(u.source_id)}</code> (${escapeHtml(u.source_version)})</td>
                <td>${escapeHtml(u.origin_kind)}</td>
                <td><code>${escapeHtml(u.locator.label)}</code></td>
                <td><code>${escapeHtml(u.extraction_status)}</code></td>
                <td>${u.model_eligible ? 'Yes' : 'No'}</td>
                <td>${warnings ? `<div><em>${escapeHtml(warnings)}</em></div>` : ''}<div>${escapeHtml(preview)}</div></td>
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>`;

  const body = `
    <section aria-labelledby="source-inspect-heading">
      <h2 id="source-inspect-heading">Source preparation &amp; criterion support</h2>
      <form class="controls" method="get" action="/creator/sources">
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
          Pair ID
          <select name="pairId">
            ${availablePairs
              .map(
                (pair) =>
                  `<option value="${escapeHtml(pair.pair_id)}"${pair.pair_id === selectedPairId ? ' selected' : ''}>${escapeHtml(pair.pair_id)} (${escapeHtml(pair.domain_id)} — ${escapeHtml(pair.title)})</option>`
              )
              .join('')}
          </select>
        </label>
        <button class="primary" type="submit">Inspect prepared sources</button>
      </form>
      ${
        bundle
          ? `<p>Criteria &amp; questions ready: <strong>${bundle.readiness.criteria_and_questions_ready ? 'YES' : 'NO'}</strong> · Substantive passages ready: <strong>${bundle.readiness.substantive_source_passages_ready ? 'YES' : 'GAPS_PRESENT'}</strong> · Model-eligible passages in packet: <strong>${String(bundle.model_ready_packet.eligible_passages.length)}</strong></p>`
          : ''
      }
    </section>

    <section aria-labelledby="pair-criteria-heading">
      <h2 id="pair-criteria-heading">Extracted pair criteria &amp; Thinking Flow baseline</h2>
      ${baselinesHtml}
    </section>

    <section aria-labelledby="criterion-support-heading">
      <h2 id="criterion-support-heading">Criterion support matrix</h2>
      ${supportHtml}
    </section>

    <section aria-labelledby="source-units-heading">
      <h2 id="source-units-heading">Prepared source units</h2>
      ${unitsHtml}
    </section>
  `;

  return pageLayout('Source Inspection', 'sources', body);
}

export function renderDocumentsPreviewViewHtml(options: {
  profiles: ReadonlyArray<Pick<KbProfile, 'profile_id' | 'kb_id' | 'kb_title' | 'is_synthetic'>>;
  selectedProfileId: string;
  availablePairs: ReadonlyArray<{ pair_id: string; domain_id: string; title: string }>;
  selectedPairId: string;
  isSynthetic: boolean;
  authoredPair: AuthoredPairResult | null;
  errorMessage?: string;
}): string {
  const {
    profiles,
    selectedProfileId,
    availablePairs,
    selectedPairId,
    isSynthetic,
    authoredPair,
    errorMessage
  } = options;

  const allFindings = authoredPair
    ? [
        ...authoredPair.validation.pair_findings.map((f) => ({ scope: 'PAIR', ...f })),
        ...authoredPair.validation.capability.findings.map((f) => ({
          scope: authoredPair.capability.object_id,
          ...f
        })),
        ...authoredPair.validation.antipattern.findings.map((f) => ({
          scope: authoredPair.antipattern.object_id,
          ...f
        }))
      ]
    : [];

  const findingsHtml = !authoredPair
    ? ''
    : allFindings.length === 0
      ? '<p>No deterministic validation findings.</p>'
      : `<table>
          <thead><tr><th>Object</th><th>Severity</th><th>Tier</th><th>Code</th><th>Path</th><th>Message</th></tr></thead>
          <tbody>
            ${allFindings
              .map(
                (f) =>
                  `<tr><td><code>${escapeHtml(f.scope)}</code></td><td>${escapeHtml(f.severity)}</td><td>${escapeHtml(f.tier)}</td><td><code>${escapeHtml(f.code)}</code></td><td><code>${escapeHtml(f.path)}</code></td><td>${escapeHtml(f.message)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>`;

  const previewHtml = !authoredPair
    ? `<p role="status">${escapeHtml(errorMessage ?? 'No draft authored in this session for the selected pair yet. Submit "Create pair drafts" or POST /api/creator/documents/author.')}</p>`
    : `${errorMessage ? `<p role="alert">${escapeHtml(errorMessage)}</p>` : ''}
      <p>
        Work unit: <code>${escapeHtml(authoredPair.work_unit_id)}</code> ·
        Draft valid: <strong>${authoredPair.validation.draft_valid ? 'YES' : 'BLOCKED'}</strong> ·
        Delivery readiness (pre-review): <strong>${authoredPair.validation.delivery_ready ? 'READY_FOR_REVIEW' : 'UNRESOLVED_GAPS_PRESENT'}</strong> ·
        Provider: <code>${escapeHtml(authoredPair.call_telemetry.provider)}/${escapeHtml(authoredPair.call_telemetry.model)}</code>
      </p>
      <p><small>Creation review states (<code>${escapeHtml(authoredPair.capability.creation_review_state)}</code> / <code>${escapeHtml(authoredPair.antipattern.creation_review_state)}</code>) never grant Knowledge Hub approval, legal assurance, or tactic activation.</small></p>
      <h3>Deterministic validation findings</h3>
      ${findingsHtml}
      <h3>Sanitized HTML Preview (Capability &amp; Paired Anti-Pattern)</h3>
      ${authoredPair.rendered.capability.html_preview_fragment}
      <details>
        <summary><strong>Inspect standalone Markdown — ${escapeHtml(authoredPair.capability.object_id)}</strong> (SHA-256: <code>${escapeHtml(authoredPair.rendered.capability.markdown_sha256)}</code>)</summary>
        <pre class="markdown-source"><code>${escapeHtml(authoredPair.rendered.capability.markdown)}</code></pre>
      </details>
      ${authoredPair.rendered.antipattern.html_preview_fragment}
      <details>
        <summary><strong>Inspect standalone Markdown — ${escapeHtml(authoredPair.antipattern.object_id)}</strong> (SHA-256: <code>${escapeHtml(authoredPair.rendered.antipattern.markdown_sha256)}</code>)</summary>
        <pre class="markdown-source"><code>${escapeHtml(authoredPair.rendered.antipattern.markdown)}</code></pre>
      </details>`;

  const body = `
    <section aria-labelledby="docs-controls-heading">
      <h2 id="docs-controls-heading">3. Documents — Draft authoring &amp; sanitized preview</h2>
      ${isSynthetic ? '<p role="status" class="badge">SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE</p>' : ''}
      <form class="controls" method="get" action="/creator/documents">
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
          Pair ID
          <select name="pairId">
            ${availablePairs
              .map(
                (pair) =>
                  `<option value="${escapeHtml(pair.pair_id)}"${pair.pair_id === selectedPairId ? ' selected' : ''}>${escapeHtml(pair.pair_id)} (${escapeHtml(pair.domain_id)} — ${escapeHtml(pair.title)})</option>`
              )
              .join('')}
          </select>
        </label>
        <button type="submit">Inspect selected pair</button>
      </form>
      <form class="controls" method="post" action="/creator/documents/author">
        <input type="hidden" name="profileId" value="${escapeHtml(selectedProfileId)}" />
        <input type="hidden" name="pairId" value="${escapeHtml(selectedPairId)}" />
        <button class="primary" type="submit">Create pair drafts</button>
      </form>
    </section>

    <section aria-labelledby="docs-preview-heading">
      <h2 id="docs-preview-heading">Draft documents &amp; references</h2>
      ${previewHtml}
    </section>
  `;

  return pageLayout('Documents Preview', 'documents', body);
}
