import {
  canonicalArtifactHash,
  canonicalArtifactValue,
  sha256Utf8,
  utf8Bytes
} from '../orchestration/artifact-hash.js';
import { evaluateRenderParity, type NamedGateResult } from '../orchestration/named-gates.js';
import type { ValidationFinding } from '../validation/contracts.js';

export const CANONICAL_JSON_CONTENT_TYPE = 'application/json';
export const CANONICAL_HTML_CONTENT_TYPE = 'text/html; charset=utf-8';

export type CanonicalObjectType = 'CAPABILITY' | 'ANTIPATTERN';
export type CanonicalRenderFormat = 'JSON' | 'HTML';

export interface CanonicalSemanticFingerprint {
  id: string;
  object_type: CanonicalObjectType;
  version: string;
  schema_version: string;
  domain: string;
  domain_title: string;
  title: string;
  canonical_definition: string;
  release_status: string;
  questions: Array<{ id: string; question: string }>;
  atomics: Array<{ id: string; statement: string }>;
  evidence: Array<{ id: string; title: string; claim_supported: string }>;
  findings: Array<{ id: string; title: string }>;
  mappings: Array<{ mapping_id: string; source_id: string; exact_locator: string }>;
  related_criteria: string[];
  jsonSha256: string;
}

export interface CanonicalRenderedBytes {
  objectId: string;
  objectType: CanonicalObjectType;
  format: CanonicalRenderFormat;
  contentType: string;
  utf8: string;
  bytes: Uint8Array;
  sha256: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&' + 'amp;')
    .replaceAll('<', '&' + 'lt;')
    .replaceAll('>', '&' + 'gt;')
    .replaceAll('"', '&' + 'quot;')
    .replaceAll("'", '&#39;');
}

export function unescapeHtml(value: string): string {
  return value
    .replaceAll('&#39;', "'")
    .replaceAll('&' + 'quot;', '"')
    .replaceAll('&' + 'gt;', '>')
    .replaceAll('&' + 'lt;', '<')
    .replaceAll('&' + 'amp;', '&');
}

function sortedCriteria(value: unknown): string[] {
  return asArray(value)
    .map((item) => text(item))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

export function canonicalJsonUtf8(object: Record<string, unknown>): string {
  return canonicalArtifactValue(object);
}

export function hashCanonicalJson(object: Record<string, unknown>): string {
  const utf8 = canonicalJsonUtf8(object);
  const hash = sha256Utf8(utf8);
  if (hash !== canonicalArtifactHash(object)) {
    throw new Error(`Canonical JSON byte hash drifted from canonicalArtifactHash for ${text(object.id)}.`);
  }
  return hash;
}

export function fingerprintCanonicalObject(object: Record<string, unknown>): CanonicalSemanticFingerprint {
  const objectType = text(object.object_type);
  if (objectType !== 'CAPABILITY' && objectType !== 'ANTIPATTERN') {
    throw new Error(`Canonical object ${text(object.id)} is missing object_type.`);
  }
  const jsonSha256 = hashCanonicalJson(object);
  const atomics = objectType === 'ANTIPATTERN' ? asArray(object.atomic_tests) : asArray(object.atomic_subcriteria);
  return {
    id: text(object.id),
    object_type: objectType,
    version: text(object.version),
    schema_version: text(object.schema_version),
    domain: text(object.domain),
    domain_title: text(object.domain_title),
    title: text(object.title),
    canonical_definition: text(object.canonical_definition),
    release_status: text(object.release_status),
    questions: asArray(object.primary_questions).map((item) => {
      const rec = asRecord(item);
      return { id: text(rec.id), question: text(rec.question) };
    }),
    atomics: atomics.map((item) => {
      const rec = asRecord(item);
      return { id: text(rec.id), statement: text(rec.criterion ?? rec.test) };
    }),
    evidence: asArray(object.required_evidence).map((item) => {
      const rec = asRecord(item);
      return { id: text(rec.id), title: text(rec.title), claim_supported: text(rec.claim_supported) };
    }),
    findings: asArray(object.finding_definitions).map((item) => {
      const rec = asRecord(item);
      return { id: text(rec.id), title: text(rec.title) };
    }),
    mappings: asArray(object.normative_source_mappings).map((item) => {
      const rec = asRecord(item);
      return {
        mapping_id: text(rec.mapping_id),
        source_id: text(rec.source_id),
        exact_locator: text(rec.exact_locator)
      };
    }),
    related_criteria: sortedCriteria(object.related_criteria),
    jsonSha256
  };
}

function attr(name: string, value: string): string {
  return `${name}="${escapeHtml(value)}"`;
}

function items(listName: string, entries: Array<{ id: string; attrs: Array<[string, string]>; body: string }>): string {
  if (entries.length === 0) return `<p class="empty" data-canonical-list="${escapeHtml(listName)}">None.</p>`;
  return `<ol data-canonical-list="${escapeHtml(listName)}">${entries
    .map((entry) => {
      const extra = entry.attrs.map(([key, value]) => attr(key, value)).join(' ');
      return `<li data-canonical-item="${escapeHtml(listName)}" data-id="${escapeHtml(entry.id)}" ${extra}>${entry.body}</li>`;
    })
    .join('')}</ol>`;
}

export function renderCanonicalObjectHtml(object: Record<string, unknown>): string {
  const fingerprint = fingerprintCanonicalObject(object);
  const applicability = asRecord(object.applicability);
  const atomicLabel = fingerprint.object_type === 'ANTIPATTERN' ? 'Atomic tests' : 'Atomic subcriteria';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(fingerprint.title)}</title>
</head>
<body>
  <article class="canonical-object"
    ${attr('data-canonical-id', fingerprint.id)}
    ${attr('data-object-type', fingerprint.object_type)}
    ${attr('data-version', fingerprint.version)}
    ${attr('data-schema-version', fingerprint.schema_version)}
    ${attr('data-domain', fingerprint.domain)}
    ${attr('data-domain-title', fingerprint.domain_title)}
    ${attr('data-title', fingerprint.title)}
    ${attr('data-canonical-definition', fingerprint.canonical_definition)}
    ${attr('data-release-status', fingerprint.release_status)}
    ${attr('data-json-sha256', fingerprint.jsonSha256)}>
    <p class="kicker">${escapeHtml(fingerprint.object_type)} · ${escapeHtml(fingerprint.id)} · v${escapeHtml(fingerprint.version)}</p>
    <h1>${escapeHtml(fingerprint.title)}</h1>
    <p class="meta">schema ${escapeHtml(fingerprint.schema_version)} · domain ${escapeHtml(fingerprint.domain)} · ${escapeHtml(fingerprint.release_status)}</p>
    <h2>Canonical definition</h2>
    <p>${escapeHtml(fingerprint.canonical_definition)}</p>
    <h2>Applicability</h2>
    <p>${escapeHtml(text(applicability.statement))}</p>
    <h2>Primary questions</h2>
    ${items(
      'primary_questions',
      fingerprint.questions.map((item) => ({
        id: item.id,
        attrs: [['data-text', item.question]],
        body: `<span class="mono">${escapeHtml(item.id)}</span> ${escapeHtml(item.question)}`
      }))
    )}
    <h2>${atomicLabel}</h2>
    ${items(
      'atomics',
      fingerprint.atomics.map((item) => ({
        id: item.id,
        attrs: [['data-text', item.statement]],
        body: `<span class="mono">${escapeHtml(item.id)}</span> ${escapeHtml(item.statement)}`
      }))
    )}
    <h2>Required evidence</h2>
    ${items(
      'required_evidence',
      fingerprint.evidence.map((item) => ({
        id: item.id,
        attrs: [
          ['data-text', item.title],
          ['data-claim', item.claim_supported]
        ],
        body: `<span class="mono">${escapeHtml(item.id)}</span> ${escapeHtml(item.title)}`
      }))
    )}
    <h2>Finding definitions</h2>
    ${items(
      'finding_definitions',
      fingerprint.findings.map((item) => ({
        id: item.id,
        attrs: [['data-text', item.title]],
        body: `<span class="mono">${escapeHtml(item.id)}</span> ${escapeHtml(item.title)}`
      }))
    )}
    <h2>Source mappings</h2>
    ${items(
      'normative_source_mappings',
      fingerprint.mappings.map((item) => ({
        id: item.mapping_id,
        attrs: [
          ['data-source-id', item.source_id],
          ['data-exact-locator', item.exact_locator]
        ],
        body: `<span class="mono">${escapeHtml(item.mapping_id)}</span> ${escapeHtml(item.source_id)} · ${escapeHtml(item.exact_locator)}`
      }))
    )}
    <h2>Related criteria</h2>
    ${items(
      'related_criteria',
      fingerprint.related_criteria.map((item) => ({
        id: item,
        attrs: [['data-text', item]],
        body: escapeHtml(item)
      }))
    )}
  </article>
</body>
</html>`;
}

function attributeMap(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([:@A-Za-z0-9_-]+)="([^"]*)"/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1];
    const value = match[2];
    if (!name || value === undefined) continue;
    attrs[name] = unescapeHtml(value);
  }
  return attrs;
}

function firstTag(html: string, needle: string): string {
  const start = html.indexOf(needle);
  if (start < 0) return '';
  const end = html.indexOf('>', start);
  if (end < 0) return '';
  return html.slice(start, end + 1);
}

function collectItems(html: string, listName: string): Record<string, string>[] {
  const itemsFound: Record<string, string>[] = [];
  const pattern = new RegExp(`<li\\b[^>]*data-canonical-item="${listName}"[^>]*>`, 'g');
  for (const match of html.matchAll(pattern)) {
    itemsFound.push(attributeMap(match[0] ?? ''));
  }
  return itemsFound;
}

export function fingerprintRenderedHtml(html: string): CanonicalSemanticFingerprint {
  const article = attributeMap(firstTag(html, '<article'));
  const objectType = article['data-object-type'];
  if (objectType !== 'CAPABILITY' && objectType !== 'ANTIPATTERN') {
    throw new Error('Rendered HTML is missing canonical object_type.');
  }
  return {
    id: article['data-canonical-id'] ?? '',
    object_type: objectType,
    version: article['data-version'] ?? '',
    schema_version: article['data-schema-version'] ?? '',
    domain: article['data-domain'] ?? '',
    domain_title: article['data-domain-title'] ?? '',
    title: article['data-title'] ?? '',
    canonical_definition: article['data-canonical-definition'] ?? '',
    release_status: article['data-release-status'] ?? '',
    questions: collectItems(html, 'primary_questions').map((item) => ({
      id: item['data-id'] ?? '',
      question: item['data-text'] ?? ''
    })),
    atomics: collectItems(html, 'atomics').map((item) => ({
      id: item['data-id'] ?? '',
      statement: item['data-text'] ?? ''
    })),
    evidence: collectItems(html, 'required_evidence').map((item) => ({
      id: item['data-id'] ?? '',
      title: item['data-text'] ?? '',
      claim_supported: item['data-claim'] ?? ''
    })),
    findings: collectItems(html, 'finding_definitions').map((item) => ({
      id: item['data-id'] ?? '',
      title: item['data-text'] ?? ''
    })),
    mappings: collectItems(html, 'normative_source_mappings').map((item) => ({
      mapping_id: item['data-id'] ?? '',
      source_id: item['data-source-id'] ?? '',
      exact_locator: item['data-exact-locator'] ?? ''
    })),
    related_criteria: collectItems(html, 'related_criteria')
      .map((item) => item['data-id'] ?? '')
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right)),
    jsonSha256: article['data-json-sha256'] ?? ''
  };
}

function parityFinding(objectId: string, objectPath: string, issue: string): ValidationFinding {
  return {
    checkId: 'RENDER_PARITY',
    kind: 'PUBLICATION_PARITY',
    severity: 'BLOCKING',
    objectId,
    objectPath,
    issue,
    dependencyScope: [],
    recommendedAction: 'Re-render from the canonical candidate revision. Do not edit publication HTML independently of canonical JSON.'
  };
}

export function compareCanonicalSemantics(
  canonical: CanonicalSemanticFingerprint,
  rendered: CanonicalSemanticFingerprint
): ValidationFinding[] {
  const defects: ValidationFinding[] = [];
  const objectId = canonical.id || rendered.id || 'UNKNOWN';
  const fields: Array<keyof Omit<CanonicalSemanticFingerprint, 'questions' | 'atomics' | 'evidence' | 'findings' | 'mappings' | 'related_criteria'>> = [
    'id',
    'object_type',
    'version',
    'schema_version',
    'domain',
    'domain_title',
    'title',
    'canonical_definition',
    'release_status',
    'jsonSha256'
  ];
  for (const field of fields) {
    if (canonical[field] !== rendered[field]) {
      defects.push(
        parityFinding(objectId, `/${field}`, `Rendered ${field} diverged from canonical JSON.`)
      );
    }
  }
  const listFields = ['questions', 'atomics', 'evidence', 'findings', 'mappings', 'related_criteria'] as const;
  for (const field of listFields) {
    const left = canonicalArtifactHash(canonical[field]);
    const right = canonicalArtifactHash(rendered[field]);
    if (left !== right) {
      defects.push(
        parityFinding(objectId, `/${field}`, `Rendered ${field} identities diverged from canonical JSON.`)
      );
    }
  }
  return defects;
}

export function renderCanonicalObject(object: Record<string, unknown>): {
  json: CanonicalRenderedBytes;
  html: CanonicalRenderedBytes;
  fingerprint: CanonicalSemanticFingerprint;
  parityDefects: ValidationFinding[];
} {
  const fingerprint = fingerprintCanonicalObject(object);
  const jsonUtf8 = canonicalJsonUtf8(object);
  const jsonBytes = utf8Bytes(jsonUtf8);
  const jsonSha256 = sha256Utf8(jsonUtf8);
  if (jsonSha256 !== fingerprint.jsonSha256) {
    throw new Error(`JSON render hash mismatch for ${fingerprint.id}.`);
  }
  const htmlUtf8 = renderCanonicalObjectHtml(object);
  const htmlSha256 = sha256Utf8(htmlUtf8);
  const htmlFingerprint = fingerprintRenderedHtml(htmlUtf8);
  const parityDefects = compareCanonicalSemantics(fingerprint, htmlFingerprint);
  if (htmlUtf8.includes('undefined')) {
    parityDefects.push(parityFinding(fingerprint.id, '/', 'Rendered HTML contains undefined identities.'));
  }
  const objectType = fingerprint.object_type;
  return {
    json: {
      objectId: fingerprint.id,
      objectType,
      format: 'JSON',
      contentType: CANONICAL_JSON_CONTENT_TYPE,
      utf8: jsonUtf8,
      bytes: jsonBytes,
      sha256: jsonSha256
    },
    html: {
      objectId: fingerprint.id,
      objectType,
      format: 'HTML',
      contentType: CANONICAL_HTML_CONTENT_TYPE,
      utf8: htmlUtf8,
      bytes: utf8Bytes(htmlUtf8),
      sha256: htmlSha256
    },
    fingerprint,
    parityDefects
  };
}

export function renderParityGate(defects: readonly ValidationFinding[]): NamedGateResult {
  return evaluateRenderParity(defects);
}
