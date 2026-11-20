import type {
  CreatorBibliographyEntry,
  CreatorDocument
} from './contracts.js';
import { computeSha256 } from './inputs.js';
import { escapeHtml } from './render-ui.js';

export interface RenderedDocumentArtifact {
  document_id: string;
  object_id: string;
  object_type: 'capability' | 'antipattern';
  destination_path_template: string;
  markdown: string;
  markdown_sha256: string;
  html_preview_fragment: string;
}

export interface RenderedPairArtifacts {
  capability: RenderedDocumentArtifact;
  antipattern: RenderedDocumentArtifact;
  standalone_html_preview: string;
}

function safeYamlScalar(value: string | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  // Strip C0 control chars and strip YAML tag prefixes if present; JSON double-quoted string
  // is a plain YAML 1.2 string scalar with zero executable tag semantics.
  const cleaned = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/^!+/g, '');
  return JSON.stringify(cleaned);
}

/**
 * Neutralizes embedded raw HTML tags, remote Markdown image fetches, and executable URL schemes
 * (`javascript:`, `data:`, `vbscript:`) inside model/source-authored Markdown text while keeping
 * human-readable prose intact.
 */
export function sanitizeMarkdownProse(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    // Neutralize inline event handler attributes inside any raw angle-bracket HTML fragment first.
    .replace(/<[^>]*>/g, (tag) =>
      tag.replace(/\bon([a-z]{2,24})\s*=/gi, '[blocked-event-attr-$1]=')
    )
    // Neutralize Markdown image syntax `![alt](target)` so Markdown viewers never auto-fetch remote beacons.
    .replace(/!\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g, '[image-embed-blocked: $1]')
    // Neutralize dangerous schemes inside Markdown links `[label](javascript:...)` / `data:` / `vbscript:`.
    .replace(
      /\[([^\]]+)\]\(\s*(?:javascript|data|vbscript)\s*:(?:[^()]|\([^()]*\))*\)/gi,
      '$1 [unsafe-url-scheme-blocked]'
    )
    // Neutralize bare `javascript:`, `vbscript:`, or `data:text/html` URI tokens.
    .replace(/\b(?:javascript|vbscript)\s*:/gi, '[unsafe-scheme-blocked]:')
    .replace(
      /\bdata\s*:\s*(?:text\/html|application\/javascript|image\/svg\+xml)/gi,
      '[unsafe-data-uri-blocked]'
    )
    // Escape raw angle brackets so `<script>`, `<img ...>`, `<iframe>` never parse as raw HTML in Markdown.
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function sanitizeMarkdownTableCell(raw: string): string {
  return sanitizeMarkdownProse(raw)
    .replaceAll('|', '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

export function sanitizePreviewText(raw: string): string {
  const neutralized = raw
    .replace(/<[^>]*>/g, (tag) =>
      tag.replace(/\bon([a-z]{2,24})\s*=/gi, '[blocked-event-attr-$1]=')
    )
    .replace(/!\[([^\]]*)\]\((?:[^()\s]|\([^()]*\))*\)/g, '[image-embed-blocked: $1]')
    .replace(/\b(?:javascript|vbscript)\s*:/gi, '[unsafe-scheme-blocked]:')
    .replace(
      /\bdata\s*:\s*(?:text\/html|application\/javascript|image\/svg\+xml)/gi,
      '[unsafe-data-uri-blocked]'
    );
  return escapeHtml(neutralized);
}

function safeHtmlDomId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '-');
}

function formatCitationBadge(
  unitIds: readonly string[],
  bibByUnitId: ReadonlyMap<string, CreatorBibliographyEntry>
): string {
  if (unitIds.length === 0) return 'None';
  return unitIds
    .map((id) => {
      const entry = bibByUnitId.get(id);
      return entry
        ? `[${entry.source_id} (${entry.edition_version}) @ ${entry.locator_label}]`
        : `[unresolved:${id.slice(0, 12)}]`;
    })
    .join('; ');
}

export function renderCreatorDocumentMarkdown(
  doc: CreatorDocument,
  options: { includeFrontMatter?: boolean } = {}
): string {
  const includeFrontMatter = options.includeFrontMatter ?? true;
  const bibByUnitId = new Map(doc.bibliography.map((b) => [b.source_unit_id, b]));
  const lines: string[] = [];

  if (includeFrontMatter) {
    lines.push(
      '---',
      `document_id: ${safeYamlScalar(doc.document_id)}`,
      `kb_id: ${safeYamlScalar(doc.kb_id)}`,
      `object_id: ${safeYamlScalar(doc.object_id)}`,
      `object_type: ${safeYamlScalar(doc.object_type)}`,
      `document_version: ${safeYamlScalar(doc.document_version)}`,
      `title: ${safeYamlScalar(doc.title)}`,
      `domain_id: ${safeYamlScalar(doc.domain_id)}`,
      `domain_title: ${safeYamlScalar(doc.domain_title)}`,
      `pair_id: ${safeYamlScalar(doc.pair_id)}`,
      `paired_object_id: ${safeYamlScalar(doc.paired_object_id)}`,
      `language: ${safeYamlScalar(doc.language)}`,
      `schema_version: ${safeYamlScalar(doc.schema_version)}`,
      `input_set_id: ${safeYamlScalar(doc.input_set_id)}`,
      `creation_review_state: ${safeYamlScalar(doc.creation_review_state)}`,
      `hub_approval_status: ${safeYamlScalar(doc.hub_approval_status)}`,
      `is_synthetic: ${safeYamlScalar(doc.is_synthetic)}`,
      '---',
      ''
    );
  }

  if (doc.is_synthetic) {
    lines.push(
      '> **SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE**',
      ''
    );
  }

  lines.push(`# ${sanitizeMarkdownProse(doc.object_id)} — ${sanitizeMarkdownProse(doc.title)}`, '');

  lines.push(
    '| Metadata Field | Value |',
    '| --- | --- |',
    `| Document ID | \`${sanitizeMarkdownTableCell(doc.document_id)}\` |`,
    `| Object Type | \`${sanitizeMarkdownTableCell(doc.object_type)}\` |`,
    `| Document Version | \`${sanitizeMarkdownTableCell(doc.document_version)}\` |`,
    `| Knowledge Base | ${sanitizeMarkdownTableCell(doc.kb_title)} (\`${sanitizeMarkdownTableCell(doc.kb_id)}\`) |`,
    `| Domain | \`${sanitizeMarkdownTableCell(doc.domain_id)}\` — ${sanitizeMarkdownTableCell(doc.domain_title)} |`,
    `| Pair / Paired Object | \`${sanitizeMarkdownTableCell(doc.pair_id)}\` / \`${sanitizeMarkdownTableCell(doc.paired_object_id)}\` |`,
    `| Creation Review State | \`${sanitizeMarkdownTableCell(doc.creation_review_state)}\` *(Creation review state only; Knowledge Hub approval is \`${sanitizeMarkdownTableCell(doc.hub_approval_status)}\`)* |`,
    `| Criteria Baseline Locator | \`${sanitizeMarkdownTableCell(doc.provenance.criteria_locator ?? 'None')}\` |`,
    `| Thinking Flow Baseline | \`${sanitizeMarkdownTableCell(doc.provenance.thinking_flow_locator)}\` (v${sanitizeMarkdownTableCell(doc.provenance.cognitive_model_version)}) |`,
    `| Pinned Input Set ID | \`${sanitizeMarkdownTableCell(doc.input_set_id)}\` |`,
    ''
  );

  const ab = doc.assessment_boundaries;

  for (const sec of doc.sections) {
    lines.push(`## ${sanitizeMarkdownProse(sec.section_id)} — ${sanitizeMarkdownProse(sec.title)}`, '');

    if (sec.status === 'MISSING_REQUIRED' || sec.prose.trim().length === 0) {
      lines.push(
        '> **[MISSING REQUIRED SECTION]** Required prose was not supplied and blocks readiness.',
        ''
      );
    } else {
      lines.push(sanitizeMarkdownProse(sec.prose.trim()), '');
    }

    if (sec.bullets.length > 0) {
      for (const bullet of sec.bullets) {
        lines.push(`- ${sanitizeMarkdownProse(bullet)}`);
      }
      lines.push('');
    }

    if (sec.question_refs.length > 0 || sec.source_unit_refs.length > 0) {
      const metaParts: string[] = [];
      if (sec.question_refs.length > 0) {
        metaParts.push(`Questions: \`${sec.question_refs.map(sanitizeMarkdownProse).join('`, `')}\``);
      }
      if (sec.source_unit_refs.length > 0) {
        metaParts.push(
          `Source citations: ${sanitizeMarkdownProse(formatCitationBadge(sec.source_unit_refs, bibByUnitId))}`
        );
      }
      lines.push(`*${metaParts.join(' · ')}*`, '');
    }

    // Emit deterministic structured subsections at their governing section codes.
    if (sec.section_code === 'IND' && doc.object_type === 'antipattern') {
      if (ab.failure_mechanism) {
        lines.push(`**Failure mechanism:** ${sanitizeMarkdownProse(ab.failure_mechanism)}`, '');
      }
      if (ab.observable_indicators.length > 0) {
        lines.push('### Observable Indicators', '');
        for (const item of ab.observable_indicators) {
          lines.push(`- ${sanitizeMarkdownProse(item)}`);
        }
        lines.push('');
      }
      if (ab.non_examples.length > 0) {
        lines.push('### Non-Examples', '');
        for (const item of ab.non_examples) {
          lines.push(`- ${sanitizeMarkdownProse(item)}`);
        }
        lines.push('');
      }
      if (ab.false_positive_guards.length > 0) {
        lines.push('### False-Positive Guards', '');
        for (const item of ab.false_positive_guards) {
          lines.push(`- ${sanitizeMarkdownProse(item)}`);
        }
        lines.push('');
      }
    }

    if (sec.section_code === 'CRI') {
      lines.push(
        '### Primary Assessment Questions',
        '',
        '| Question ID | Dimension | Primary Question | Assessment Guidance |',
        '| --- | --- | --- | --- |'
      );
      for (const q of doc.questions) {
        lines.push(
          `| \`${sanitizeMarkdownTableCell(q.id)}\` | \`${sanitizeMarkdownTableCell(q.dimension)}\` | ${sanitizeMarkdownTableCell(q.question)} | ${sanitizeMarkdownTableCell(q.assessment_guidance)} |`
        );
      }
      lines.push('');
    }

    if (sec.section_code === 'EVI' && ab.evidence_ceilings.length > 0) {
      lines.push('### Evidence Sufficiency Ceilings', '');
      for (const item of ab.evidence_ceilings) {
        lines.push(`- ${sanitizeMarkdownProse(item)}`);
      }
      lines.push('');
    }

    if (sec.section_code === 'INT' && doc.object_type === 'capability') {
      const groups: ReadonlyArray<[string, readonly string[]]> = [
        ['Unknown Handling', ab.unknown_handling],
        ['Contradiction Handling', ab.contradiction_handling],
        ['False-Positive Guards', ab.false_positive_guards],
        ['Prohibited Inferences', ab.prohibited_inferences],
        ['Human Decision Boundaries', ab.human_decision_boundaries]
      ];
      for (const [heading, items] of groups) {
        if (items.length === 0) continue;
        lines.push(`### ${heading}`, '');
        for (const item of items) {
          lines.push(`- ${sanitizeMarkdownProse(item)}`);
        }
        lines.push('');
      }
    }

    if (sec.section_code === 'ABS' && doc.object_type === 'antipattern') {
      if (ab.tested_absence_requirements.length > 0) {
        lines.push('### Tested-Absence Requirements', '');
        for (const item of ab.tested_absence_requirements) {
          lines.push(`- ${sanitizeMarkdownProse(item)}`);
        }
        lines.push('');
      }
      if (ab.unknown_handling.length > 0) {
        lines.push('### Independent Unknown Handling', '');
        for (const item of ab.unknown_handling) {
          lines.push(`- ${sanitizeMarkdownProse(item)}`);
        }
        lines.push('');
      }
    }

    if (sec.section_code === 'CON' && doc.object_type === 'antipattern') {
      const groups: ReadonlyArray<[string, readonly string[]]> = [
        ['Contradiction Handling', ab.contradiction_handling],
        ['Evidence Sufficiency Ceilings', ab.evidence_ceilings],
        ['Prohibited Inferences', ab.prohibited_inferences],
        ['Human Decision Boundaries', ab.human_decision_boundaries]
      ];
      for (const [heading, items] of groups) {
        if (items.length === 0) continue;
        lines.push(`### ${heading}`, '');
        for (const item of items) {
          lines.push(`- ${sanitizeMarkdownProse(item)}`);
        }
        lines.push('');
      }
    }

    if (sec.section_code === 'REL') {
      lines.push(
        `**Paired Object Independence Rule:** ${sanitizeMarkdownProse(ab.paired_independence_rule)}`,
        '',
        '| Target Object | Relationship | Assessment Independence & Meaning |',
        '| --- | --- | --- |'
      );
      for (const rel of doc.related_object_links) {
        lines.push(
          `| \`${sanitizeMarkdownTableCell(rel.target_object_id)}\` | \`${sanitizeMarkdownTableCell(rel.relationship_kind)}\` | ${sanitizeMarkdownTableCell(rel.non_inverse_meaning)} |`
        );
      }
      lines.push('');
    }

    if (sec.section_code === 'TAC') {
      if (doc.tactic_associations.length === 0) {
        lines.push('*No associated tactics declared in the selected Tactic Playbook for this object.*', '');
      } else {
        lines.push(
          '| Tactic ID | Title | Version | Effective Status | Playbook Provenance | Completion Effect | Activation Authority | Scope & Boundary |',
          '| --- | --- | --- | --- | --- | --- | --- | --- |'
        );
        for (const tac of doc.tactic_associations) {
          lines.push(
            `| \`${sanitizeMarkdownTableCell(tac.tactic_id)}\` | ${sanitizeMarkdownTableCell(tac.title)} | \`${sanitizeMarkdownTableCell(tac.version)}\` | \`${sanitizeMarkdownTableCell(tac.effective_association_status)}\` | \`release=${sanitizeMarkdownTableCell(tac.original_release_status)}; activation=${sanitizeMarkdownTableCell(tac.original_activation_status)}\` | \`${sanitizeMarkdownTableCell(tac.completion_effect)}\` | \`${sanitizeMarkdownTableCell(tac.activation_authority)}\` | ${sanitizeMarkdownTableCell(tac.scope_and_boundary_note)} |`
          );
        }
        lines.push('');
      }
    }

    if (sec.section_code === 'SRC') {
      lines.push('### Sourced Claims (External Registered Publications)', '');
      if (doc.sourced_claims.length === 0) {
        lines.push('*No external publication claims recorded.*', '');
      } else {
        for (const claim of doc.sourced_claims) {
          const citationText =
            claim.support_state === 'SOURCE_SUPPORTED'
              ? formatCitationBadge(claim.source_unit_ids, bibByUnitId)
              : `UNRESOLVED (${claim.unresolved_reason ?? 'No usable passage in model_ready_packet'})`;
          lines.push(
            `- **\`${sanitizeMarkdownProse(claim.claim_id)}\` [${sanitizeMarkdownProse(claim.support_state)} · ${sanitizeMarkdownProse(claim.authority_distinction)}]:** ${sanitizeMarkdownProse(claim.statement)}`,
            `  - Applicability: ${sanitizeMarkdownProse(claim.applicability_note)}`,
            `  - Attribution: ${sanitizeMarkdownProse(citationText)}`
          );
        }
        lines.push('');
      }

      lines.push('### Methodology Interpretations (Cognitive Model & Criteria Baseline)', '');
      if (doc.methodology_interpretations.length === 0) {
        lines.push('*No methodology interpretations recorded.*', '');
      } else {
        for (const interp of doc.methodology_interpretations) {
          lines.push(
            `- **\`${sanitizeMarkdownProse(interp.interpretation_id)}\` [METHODOLOGY_INTERPRETATION]:** ${sanitizeMarkdownProse(interp.statement)} *(Cognitive rules: \`${interp.cognitive_rule_refs.map(sanitizeMarkdownProse).join('`, `') || 'baseline'}\`; Questions: \`${interp.question_ids.map(sanitizeMarkdownProse).join('`, `') || 'all'}\`)*`
          );
        }
        lines.push('');
      }
    }

    if (sec.section_code === 'REV') {
      if (doc.omitted_optional_sections.length > 0) {
        lines.push('### Explicitly Omitted Optional Sections', '');
        for (const om of doc.omitted_optional_sections) {
          lines.push(
            `- **\`${sanitizeMarkdownProse(om.section_id)}\` — ${sanitizeMarkdownProse(om.title)}:** ${sanitizeMarkdownProse(om.reason)}`
          );
        }
        lines.push('');
      }

      lines.push('### Unresolved Items', '');
      if (doc.unresolved_items.length === 0) {
        lines.push('- None recorded.', '');
      } else {
        for (const item of doc.unresolved_items) {
          lines.push(
            `- **\`${sanitizeMarkdownProse(item.item_id)}\` [${sanitizeMarkdownProse(item.category)}${item.blocks_delivery ? ' · BLOCKS_DELIVERY' : ''}]:** ${sanitizeMarkdownProse(item.summary)} *(Section \`${sanitizeMarkdownProse(item.section_id)}\`)*`
          );
        }
        lines.push('');
      }
    }
  }

  // Always emit explicit optional omissions even if a custom profile omitted REV itself.
  const hasRevSection = doc.sections.some((s) => s.section_code === 'REV');
  if (!hasRevSection && doc.omitted_optional_sections.length > 0) {
    lines.push(`## ${sanitizeMarkdownProse(doc.object_id)}.OMITTED — Explicitly Omitted Optional Sections`, '');
    for (const om of doc.omitted_optional_sections) {
      lines.push(
        `- **\`${sanitizeMarkdownProse(om.section_id)}\` — ${sanitizeMarkdownProse(om.title)}:** ${sanitizeMarkdownProse(om.reason)}`
      );
    }
    lines.push('');
  }

  lines.push(`## ${sanitizeMarkdownProse(doc.object_id)}.BIB — Source Bibliography and Usage Boundaries`, '');
  if (doc.bibliography.length === 0) {
    lines.push(
      '*No model-eligible substantive source passages cited in this draft. External source-backed claims remain explicitly UNRESOLVED.*',
      ''
    );
  } else {
    lines.push(
      '| Source ID | Title | Edition / Version | Authority | Origin & Exact Locator | Extraction Status | Usage Policy, Applicability & Limitations |',
      '| --- | --- | --- | --- | --- | --- | --- |'
    );
    for (const entry of doc.bibliography) {
      const boundaryDetails = [
        entry.jurisdictions && entry.jurisdictions.length > 0
          ? `Jurisdictions: ${entry.jurisdictions.join(', ')}`
          : '',
        ...(entry.roles_or_applicability_conditions ?? []),
        ...(entry.limitations.length > 0 ? entry.limitations : ['None recorded'])
      ]
        .filter(Boolean)
        .join('; ');
      lines.push(
        `| \`${sanitizeMarkdownTableCell(entry.source_id)}\` | ${sanitizeMarkdownTableCell(entry.source_title)} | \`${sanitizeMarkdownTableCell(entry.edition_version)}\` | \`${sanitizeMarkdownTableCell(entry.authority_tier)} / ${sanitizeMarkdownTableCell(entry.authority_type)}\` | \`${sanitizeMarkdownTableCell(entry.origin_kind)}\` — \`${sanitizeMarkdownTableCell(entry.locator_label)}\` | \`${sanitizeMarkdownTableCell(entry.extraction_status)}\` | \`${sanitizeMarkdownTableCell(entry.usage_policy)}\` — ${sanitizeMarkdownTableCell(boundaryDetails)} |`
      );
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Renders a sanitized HTML preview fragment from the exact same validated `CreatorDocument` model (`R-06`).
 * Never emits raw HTML, `<script>`, inline event handlers, `javascript:`/`data:` URLs, or remote fetch elements.
 */
export function renderCreatorDocumentHtmlPreviewFragment(doc: CreatorDocument): string {
  const bibByUnitId = new Map(doc.bibliography.map((b) => [b.source_unit_id, b]));
  const ab = doc.assessment_boundaries;

  const syntheticNoticeHtml = doc.is_synthetic
    ? `<p role="status" class="badge">SYNTHETIC TEST PROFILE — NOT APPROVED DOMAIN KNOWLEDGE</p>`
    : '';

  const renderStringList = (heading: string, items: readonly string[]): string => {
    if (items.length === 0) return '';
    return `<div class="subblock">
      <h4>${sanitizePreviewText(heading)}</h4>
      <ul>${items.map((item) => `<li>${sanitizePreviewText(item)}</li>`).join('')}</ul>
    </div>`;
  };

  const sectionsHtml = doc.sections
    .map((sec) => {
      const domId = safeHtmlDomId(`${doc.kb_id}-${sec.section_id}`);
      const proseHtml =
        sec.status === 'MISSING_REQUIRED' || sec.prose.trim().length === 0
          ? `<p role="alert"><strong>[MISSING REQUIRED SECTION]</strong> Required prose was not supplied and blocks readiness.</p>`
          : `<p>${sanitizePreviewText(sec.prose.trim())}</p>`;

      const bulletsHtml =
        sec.bullets.length > 0
          ? `<ul>${sec.bullets.map((b) => `<li>${sanitizePreviewText(b)}</li>`).join('')}</ul>`
          : '';

      const refsHtml =
        sec.question_refs.length > 0 || sec.source_unit_refs.length > 0
          ? `<p class="refs"><small>${[
              sec.question_refs.length > 0
                ? `Questions: <code>${sanitizePreviewText(sec.question_refs.join(', '))}</code>`
                : '',
              sec.source_unit_refs.length > 0
                ? `Citations: <code>${sanitizePreviewText(formatCitationBadge(sec.source_unit_refs, bibByUnitId))}</code>`
                : ''
            ]
              .filter(Boolean)
              .join(' · ')}</small></p>`
          : '';

      const extras: string[] = [];

      if (sec.section_code === 'IND' && doc.object_type === 'antipattern') {
        if (ab.failure_mechanism) {
          extras.push(
            `<p><strong>Failure mechanism:</strong> ${sanitizePreviewText(ab.failure_mechanism)}</p>`
          );
        }
        extras.push(
          renderStringList('Observable Indicators', ab.observable_indicators),
          renderStringList('Non-Examples', ab.non_examples),
          renderStringList('False-Positive Guards', ab.false_positive_guards)
        );
      }

      if (sec.section_code === 'CRI') {
        extras.push(`<table>
          <thead><tr><th>Question ID</th><th>Dimension</th><th>Primary Question</th><th>Assessment Guidance</th></tr></thead>
          <tbody>
            ${doc.questions
              .map(
                (q) =>
                  `<tr><td><code>${sanitizePreviewText(q.id)}</code></td><td><code>${sanitizePreviewText(q.dimension)}</code></td><td>${sanitizePreviewText(q.question)}</td><td>${sanitizePreviewText(q.assessment_guidance)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>`);
      }

      if (sec.section_code === 'EVI') {
        extras.push(renderStringList('Evidence Sufficiency Ceilings', ab.evidence_ceilings));
      }

      if (sec.section_code === 'INT' && doc.object_type === 'capability') {
        extras.push(
          renderStringList('Unknown Handling', ab.unknown_handling),
          renderStringList('Contradiction Handling', ab.contradiction_handling),
          renderStringList('False-Positive Guards', ab.false_positive_guards),
          renderStringList('Prohibited Inferences', ab.prohibited_inferences),
          renderStringList('Human Decision Boundaries', ab.human_decision_boundaries)
        );
      }

      if (sec.section_code === 'ABS' && doc.object_type === 'antipattern') {
        extras.push(
          renderStringList('Tested-Absence Requirements', ab.tested_absence_requirements),
          renderStringList('Independent Unknown Handling', ab.unknown_handling)
        );
      }

      if (sec.section_code === 'CON' && doc.object_type === 'antipattern') {
        extras.push(
          renderStringList('Contradiction Handling', ab.contradiction_handling),
          renderStringList('Evidence Sufficiency Ceilings', ab.evidence_ceilings),
          renderStringList('Prohibited Inferences', ab.prohibited_inferences),
          renderStringList('Human Decision Boundaries', ab.human_decision_boundaries)
        );
      }

      if (sec.section_code === 'REL') {
        extras.push(
          `<p><strong>Paired Object Independence Rule:</strong> ${sanitizePreviewText(ab.paired_independence_rule)}</p>`,
          `<table>
            <thead><tr><th>Target Object</th><th>Relationship</th><th>Assessment Independence &amp; Meaning</th></tr></thead>
            <tbody>
              ${doc.related_object_links
                .map(
                  (r) =>
                    `<tr><td><code>${sanitizePreviewText(r.target_object_id)}</code></td><td><code>${sanitizePreviewText(r.relationship_kind)}</code></td><td>${sanitizePreviewText(r.non_inverse_meaning)}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>`
        );
      }

      if (sec.section_code === 'TAC') {
        extras.push(
          doc.tactic_associations.length === 0
            ? `<p><em>No associated tactics declared in the selected Tactic Playbook for this object.</em></p>`
            : `<table>
                <thead><tr><th>Tactic ID</th><th>Title</th><th>Effective Status</th><th>Playbook Provenance</th><th>Activation Authority</th><th>Scope &amp; Boundary</th></tr></thead>
                <tbody>
                  ${doc.tactic_associations
                    .map(
                      (t) =>
                        `<tr><td><code>${sanitizePreviewText(t.tactic_id)}</code> (v${sanitizePreviewText(t.version)})</td><td>${sanitizePreviewText(t.title)}</td><td><code>${sanitizePreviewText(t.effective_association_status)}</code></td><td><code>release=${sanitizePreviewText(t.original_release_status)}; activation=${sanitizePreviewText(t.original_activation_status)}</code></td><td><code>${sanitizePreviewText(t.activation_authority)}</code></td><td>${sanitizePreviewText(t.scope_and_boundary_note)}</td></tr>`
                    )
                    .join('')}
                </tbody>
              </table>`
        );
      }

      if (sec.section_code === 'SRC') {
        const claimsHtml =
          doc.sourced_claims.length === 0
            ? `<p><em>No external publication claims recorded.</em></p>`
            : `<ul>${doc.sourced_claims
                .map((c) => {
                  const attr =
                    c.support_state === 'SOURCE_SUPPORTED'
                      ? formatCitationBadge(c.source_unit_ids, bibByUnitId)
                      : `UNRESOLVED (${c.unresolved_reason ?? 'No usable passage'})`;
                  return `<li><code>${sanitizePreviewText(c.claim_id)}</code> [<strong>${sanitizePreviewText(c.support_state)}</strong> · <code>${sanitizePreviewText(c.authority_distinction)}</code>]: ${sanitizePreviewText(c.statement)} — <em>Applicability:</em> ${sanitizePreviewText(c.applicability_note)} · <em>Attribution:</em> <code>${sanitizePreviewText(attr)}</code></li>`;
                })
                .join('')}</ul>`;

        const interpHtml =
          doc.methodology_interpretations.length === 0
            ? `<p><em>No methodology interpretations recorded.</em></p>`
            : `<ul>${doc.methodology_interpretations
                .map(
                  (m) =>
                    `<li><code>${sanitizePreviewText(m.interpretation_id)}</code> [<strong>METHODOLOGY_INTERPRETATION</strong>]: ${sanitizePreviewText(m.statement)} <em>(Rules: <code>${sanitizePreviewText(m.cognitive_rule_refs.join(', ') || 'baseline')}</code>; Questions: <code>${sanitizePreviewText(m.question_ids.join(', ') || 'all')}</code>)</em></li>`
                )
                .join('')}</ul>`;

        extras.push(
          `<h4>Sourced Claims (External Registered Publications)</h4>${claimsHtml}`,
          `<h4>Methodology Interpretations (Cognitive Model &amp; Criteria Baseline)</h4>${interpHtml}`
        );
      }

      if (sec.section_code === 'REV') {
        if (doc.omitted_optional_sections.length > 0) {
          extras.push(
            `<h4>Explicitly Omitted Optional Sections</h4><ul>${doc.omitted_optional_sections
              .map(
                (om) =>
                  `<li><code>${sanitizePreviewText(om.section_id)}</code> — ${sanitizePreviewText(om.title)}: ${sanitizePreviewText(om.reason)}</li>`
              )
              .join('')}</ul>`
          );
        }
        extras.push(
          `<h4>Unresolved Items</h4>${
            doc.unresolved_items.length === 0
              ? '<p>None recorded.</p>'
              : `<ul>${doc.unresolved_items
                  .map(
                    (u) =>
                      `<li><code>${sanitizePreviewText(u.item_id)}</code> [<strong>${sanitizePreviewText(u.category)}</strong>${u.blocks_delivery ? ' · BLOCKS_DELIVERY' : ''}]: ${sanitizePreviewText(u.summary)} (<code>${sanitizePreviewText(u.section_id)}</code>)</li>`
                  )
                  .join('')}</ul>`
          }`
        );
      }

      return `<section id="${domId}" data-section-id="${sanitizePreviewText(sec.section_id)}">
        <h3><code>${sanitizePreviewText(sec.section_id)}</code> — ${sanitizePreviewText(sec.title)}</h3>
        ${proseHtml}
        ${bulletsHtml}
        ${refsHtml}
        ${extras.join('\n')}
      </section>`;
    })
    .join('\n');

  const bibHtml =
    doc.bibliography.length === 0
      ? '<p><em>No model-eligible substantive source passages cited in this draft. External source-backed claims remain explicitly UNRESOLVED.</em></p>'
      : `<table>
          <thead><tr><th>Source ID</th><th>Title</th><th>Edition / Version</th><th>Authority</th><th>Origin &amp; Exact Locator</th><th>Status</th><th>Usage Policy, Applicability &amp; Limitations</th></tr></thead>
          <tbody>
            ${doc.bibliography
              .map((b) => {
                const boundaryDetails = [
                  b.jurisdictions && b.jurisdictions.length > 0
                    ? `Jurisdictions: ${b.jurisdictions.join(', ')}`
                    : '',
                  ...(b.roles_or_applicability_conditions ?? []),
                  ...(b.limitations.length > 0 ? b.limitations : ['None recorded'])
                ]
                  .filter(Boolean)
                  .join('; ');
                return `<tr><td><code>${sanitizePreviewText(b.source_id)}</code></td><td>${sanitizePreviewText(b.source_title)}</td><td><code>${sanitizePreviewText(b.edition_version)}</code></td><td><code>${sanitizePreviewText(b.authority_tier)} / ${sanitizePreviewText(b.authority_type)}</code></td><td><code>${sanitizePreviewText(b.origin_kind)}</code> — <code>${sanitizePreviewText(b.locator_label)}</code></td><td><code>${sanitizePreviewText(b.extraction_status)}</code></td><td><code>${sanitizePreviewText(b.usage_policy)}</code> — ${sanitizePreviewText(boundaryDetails)}</td></tr>`;
              })
              .join('')}
          </tbody>
        </table>`;

  return `<article class="creator-doc-preview" data-document-id="${sanitizePreviewText(doc.document_id)}" data-object-type="${sanitizePreviewText(doc.object_type)}">
    ${syntheticNoticeHtml}
    <h2><code>${sanitizePreviewText(doc.object_id)}</code> — ${sanitizePreviewText(doc.title)}</h2>
    <p class="doc-meta">
      Document ID: <code>${sanitizePreviewText(doc.document_id)}</code> ·
      Version: <code>${sanitizePreviewText(doc.document_version)}</code> ·
      Domain: <code>${sanitizePreviewText(doc.domain_id)}</code> (${sanitizePreviewText(doc.domain_title)}) ·
      Paired Object: <code>${sanitizePreviewText(doc.paired_object_id)}</code> ·
      Creation Review State: <strong>${sanitizePreviewText(doc.creation_review_state)}</strong>
      <em>(Hub approval: <code>${sanitizePreviewText(doc.hub_approval_status)}</code>)</em>
    </p>
    ${sectionsHtml}
    <section id="${safeHtmlDomId(`${doc.kb_id}-${doc.object_id}-BIB`)}" data-section-id="${sanitizePreviewText(`${doc.object_id}.BIB`)}">
      <h3><code>${sanitizePreviewText(`${doc.object_id}.BIB`)}</code> — Source Bibliography and Usage Boundaries</h3>
      ${bibHtml}
    </section>
  </article>`;
}

export function renderDocumentArtifact(
  doc: CreatorDocument,
  options: { includeFrontMatter?: boolean } = {}
): RenderedDocumentArtifact {
  const markdown = renderCreatorDocumentMarkdown(doc, options);
  const htmlPreviewFragment = renderCreatorDocumentHtmlPreviewFragment(doc);
  return {
    document_id: doc.document_id,
    object_id: doc.object_id,
    object_type: doc.object_type,
    destination_path_template: doc.destination_path_template,
    markdown,
    markdown_sha256: computeSha256(markdown),
    html_preview_fragment: htmlPreviewFragment
  };
}

export function renderPairArtifacts(options: {
  capability: CreatorDocument;
  antipattern: CreatorDocument;
  includeFrontMatter?: boolean;
}): RenderedPairArtifacts {
  const capArtifact = renderDocumentArtifact(options.capability, {
    includeFrontMatter: options.includeFrontMatter
  });
  const apArtifact = renderDocumentArtifact(options.antipattern, {
    includeFrontMatter: options.includeFrontMatter
  });

  const standaloneHtml = `<!doctype html>
<html lang="${sanitizePreviewText(options.capability.language)}">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${sanitizePreviewText(options.capability.pair_id)} Preview — KB Document Creator</title>
  <style>
    body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0 auto; max-width: 1120px; padding: 1.25rem; color: #111827; background: #f9fafb; }
    article.creator-doc-preview { background: #ffffff; border: 1px solid #d1d5db; border-radius: 6px; padding: 1.25rem; margin-bottom: 1.5rem; }
    section { border-top: 1px solid #e5e7eb; padding-top: 0.75rem; margin-top: 0.75rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.9rem; }
    th, td { border: 1px solid #e5e7eb; padding: 0.4rem 0.55rem; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.88em; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; border: 1px solid #6b7280; font-size: 0.85rem; }
  </style>
</head>
<body>
  <main>
    ${capArtifact.html_preview_fragment}
    ${apArtifact.html_preview_fragment}
  </main>
</body>
</html>`;

  return {
    capability: capArtifact,
    antipattern: apArtifact,
    standalone_html_preview: standaloneHtml
  };
}
