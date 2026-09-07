import type { DomainId } from '../authoring/authoring-plan.js';
import { compileGateResult, compileSirPair } from '../compiler/sir-compiler.js';
import { loadCategoriesBaseline, categoryDomain, categoryPair } from '../baseline/categories.js';
import { expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  getBaselineSnapshotById,
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getLatestTaskArtifactWithOutput,
  getPairRuns,
  recordPairNamedGates
} from '../orchestration/store.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { SNAPSHOT_ROOT_TASK } from '../repair/qc-repair.js';
import { buildPairAuthoringPlan } from './authoring-context.js';

async function loadPersistedSirSnapshot(pairRunId: string): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const [root, taskType] of Object.entries(SNAPSHOT_ROOT_TASK)) {
    const artifact = await getLatestCompletedTaskArtifact(pairRunId, taskType);
    if (artifact) snapshot[root] = artifact.output;
  }
  return snapshot;
}

function reviewNotes(output: unknown): string[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const record = output as Record<string, unknown>;
  const notes: string[] = [];
  if (typeof record.coherenceSummary === 'string' && record.coherenceSummary.trim()) {
    notes.push(record.coherenceSummary.trim());
  }
  if (Array.isArray(record.defects) && record.defects.length > 0) {
    notes.push(`Pair coherence recorded ${String(record.defects.length)} remaining finding(s) in candidate metadata.`);
  }
  return notes;
}

export interface CandidateDocumentItem {
  pairId: string;
  objectId: string;
  objectType: 'CAPABILITY' | 'ANTIPATTERN';
  title: string;
  status: 'COMPILED' | 'FAILED';
  href: string;
  htmlHref: string;
  jsonHref: string;
  error?: string;
  notes: string[];
}

export interface CandidatePairResult {
  pairId: string;
  status: 'COMPILED' | 'FAILED';
  error?: string;
  notes: string[];
  capability?: Record<string, unknown>;
  antipattern?: Record<string, unknown>;
}

export interface DomainCandidateBundle {
  documentKind: 'DOMAIN_PRODUCTION_CANDIDATE_BUNDLE';
  domain: DomainId;
  domainTitle: string;
  domainState: string;
  domainCoherence: 'PENDING' | 'PASSED' | 'FAILED' | 'NONE';
  releaseStatus: 'DRAFT';
  approval: 'NOT_GRANTED';
  pairs: CandidatePairResult[];
  documents: CandidateDocumentItem[];
}

function domainReviewPassed(output: unknown): boolean | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const passed = (output as { passed?: unknown }).passed;
  return typeof passed === 'boolean' ? passed : undefined;
}

export async function assembleDomainCandidateBundle(domain: DomainId): Promise<DomainCandidateBundle> {
  const run = await getLatestDomainRun(domain);
  if (!run) {
    throw new Error(`No domain ${domain} run exists.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const categories = loadCategoriesBaseline();
  const domainRecord = categoryDomain(categories, domain);
  const sealed = await getBaselineSnapshotById(run.baselineSnapshotId);
  if (!sealed) throw new Error('Sealed baseline snapshot is missing.');
  const snapshot: BaselineSnapshot = {
    id: sealed.id,
    sha256: sealed.sha256,
    manifest: sealed.manifest as BaselineSnapshot['manifest']
  };
  const hostPairId = expectedDomainPairIds(domain)[0];
  const host = pairRuns.find((item) => item.pairId === hostPairId);
  const domainArtifact = host
    ? await getLatestTaskArtifactWithOutput<{ passed?: boolean }>(host.id, 'DOMAIN_COHERENCE_REVIEW')
    : undefined;
  const passed = domainReviewPassed(domainArtifact?.output);
  const domainCoherence: DomainCandidateBundle['domainCoherence'] = !domainArtifact
    ? 'PENDING'
    : passed === true
      ? 'PASSED'
      : 'FAILED';

  const pairs: CandidatePairResult[] = [];
  const documents: CandidateDocumentItem[] = [];

  for (const pairId of expectedDomainPairIds(domain)) {
    const pairRun = pairRuns.find((item) => item.pairId === pairId);
    const identity = categoryPair(categories, pairId);
    const jsonCap = `/api/operator/documents/${domain}/${identity.capabilityId}.json`;
    const jsonAp = `/api/operator/documents/${domain}/${identity.antipatternId}.json`;
    const htmlCap = `/documents/${domain}/${identity.capabilityId}`;
    const htmlAp = `/documents/${domain}/${identity.antipatternId}`;
    if (!pairRun || pairRun.state !== 'VALIDATED') {
      const error = `${pairId} is ${pairRun?.state ?? 'missing'}; DRAFT compile requires VALIDATED.`;
      pairs.push({ pairId, status: 'FAILED', error, notes: [] });
      documents.push(
        {
          pairId,
          objectId: identity.capabilityId,
          objectType: 'CAPABILITY',
          title: identity.capabilityTitle,
          status: 'FAILED',
          href: htmlCap,
          htmlHref: htmlCap,
          jsonHref: jsonCap,
          error,
          notes: []
        },
        {
          pairId,
          objectId: identity.antipatternId,
          objectType: 'ANTIPATTERN',
          title: identity.antipatternTitle,
          status: 'FAILED',
          href: htmlAp,
          htmlHref: htmlAp,
          jsonHref: jsonAp,
          error,
          notes: []
        }
      );
      continue;
    }
    try {
      const persisted = await loadPersistedSirSnapshot(pairRun.id);
      const review = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
      const compiled = await compileSirPair({
        authoringPlan: buildPairAuthoringPlan({
          domain,
          pairId,
          snapshot,
          categories,
          targetVersion: pairRun.targetVersion
        }),
        snapshot: persisted,
        mode: 'DRAFT',
        reviewNotes: reviewNotes(review?.output)
      });
      await recordPairNamedGates(pairRun.id, [compileGateResult(compiled)]);
      if (!compiled.ok || !compiled.capability || !compiled.antipattern) {
        const error =
          compiled.defects.map((item) => item.issue).join(' ') || `${pairId} compiled with missing identities.`;
        pairs.push({ pairId, status: 'FAILED', error, notes: compiled.notes });
        documents.push(
          {
            pairId,
            objectId: identity.capabilityId,
            objectType: 'CAPABILITY',
            title: identity.capabilityTitle,
            status: 'FAILED',
            href: htmlCap,
            htmlHref: htmlCap,
            jsonHref: jsonCap,
            error,
            notes: compiled.notes
          },
          {
            pairId,
            objectId: identity.antipatternId,
            objectType: 'ANTIPATTERN',
            title: identity.antipatternTitle,
            status: 'FAILED',
            href: htmlAp,
            htmlHref: htmlAp,
            jsonHref: jsonAp,
            error,
            notes: compiled.notes
          }
        );
        continue;
      }
      pairs.push({
        pairId,
        status: 'COMPILED',
        notes: compiled.notes,
        capability: compiled.capability,
        antipattern: compiled.antipattern
      });
      documents.push(
        {
          pairId,
          objectId: identity.capabilityId,
          objectType: 'CAPABILITY',
          title: identity.capabilityTitle,
          status: 'COMPILED',
          href: htmlCap,
          htmlHref: htmlCap,
          jsonHref: jsonCap,
          notes: compiled.notes
        },
        {
          pairId,
          objectId: identity.antipatternId,
          objectType: 'ANTIPATTERN',
          title: identity.antipatternTitle,
          status: 'COMPILED',
          href: htmlAp,
          htmlHref: htmlAp,
          jsonHref: jsonAp,
          notes: compiled.notes
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pairs.push({ pairId, status: 'FAILED', error: message, notes: [] });
      documents.push(
        {
          pairId,
          objectId: identity.capabilityId,
          objectType: 'CAPABILITY',
          title: identity.capabilityTitle,
          status: 'FAILED',
          href: htmlCap,
          htmlHref: htmlCap,
          jsonHref: jsonCap,
          error: message,
          notes: []
        },
        {
          pairId,
          objectId: identity.antipatternId,
          objectType: 'ANTIPATTERN',
          title: identity.antipatternTitle,
          status: 'FAILED',
          href: htmlAp,
          htmlHref: htmlAp,
          jsonHref: jsonAp,
          error: message,
          notes: []
        }
      );
    }
  }

  return {
    documentKind: 'DOMAIN_PRODUCTION_CANDIDATE_BUNDLE',
    domain,
    domainTitle: domainRecord.title,
    domainState: run.state,
    domainCoherence,
    releaseStatus: 'DRAFT',
    approval: 'NOT_GRANTED',
    pairs,
    documents
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#39;');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function renderList(items: string[]): string {
  if (!items.length) return '<p class="empty">None.</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function questions(value: unknown): string {
  if (!Array.isArray(value)) return '<p class="empty">None.</p>';
  return `<ol>${value
    .map((item) => {
      const rec = asRecord(item);
      return `<li><span class="mono">${escapeHtml(String(rec.id ?? ''))}</span> ${escapeHtml(String(rec.question ?? ''))}</li>`;
    })
    .join('')}</ol>`;
}

function findings(value: unknown): string {
  if (!Array.isArray(value)) return '<p class="empty">None.</p>';
  return value
    .map((item) => {
      const rec = asRecord(item);
      return `<article class="finding">
        <h3>${escapeHtml(String(rec.title ?? rec.id ?? 'Finding'))}</h3>
        <p class="meta">${escapeHtml(String(rec.id ?? ''))} · ${escapeHtml(String(rec.default_severity ?? ''))}</p>
        <p>${escapeHtml(String(rec.lifecycle_consequence ?? ''))}</p>
      </article>`;
    })
    .join('');
}

function evidence(value: unknown): string {
  if (!Array.isArray(value)) return '<p class="empty">None.</p>';
  return value
    .map((item) => {
      const rec = asRecord(item);
      return `<article class="finding">
        <h3>${escapeHtml(String(rec.title ?? rec.id ?? 'Evidence'))}</h3>
        <p class="meta">${escapeHtml(String(rec.id ?? ''))} · ${escapeHtml(String(rec.evidence_class ?? ''))}</p>
        <p>${escapeHtml(String(rec.claim_supported ?? ''))}</p>
      </article>`;
    })
    .join('');
}

function atomics(value: unknown, statementKey: 'criterion' | 'test'): string {
  if (!Array.isArray(value)) return '<p class="empty">None.</p>';
  return `<ul>${value
    .map((item) => {
      const rec = asRecord(item);
      return `<li><span class="mono">${escapeHtml(String(rec.id ?? ''))}</span> ${escapeHtml(String(rec[statementKey] ?? ''))}</li>`;
    })
    .join('')}</ul>`;
}

function mappings(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return '<p class="empty">None.</p>';
  return `<ul>${value
    .map((item) => {
      const rec = asRecord(item);
      return `<li><span class="mono">${escapeHtml(String(rec.mapping_id ?? ''))}</span> ${escapeHtml(String(rec.source_id ?? ''))} · ${escapeHtml(String(rec.exact_locator ?? ''))}</li>`;
    })
    .join('')}</ul>`;
}

export function renderCandidateObjectHtml(input: {
  domain: DomainId;
  bundle: DomainCandidateBundle;
  objectId: string;
}): string {
  const pair = input.bundle.pairs.find((item) => {
    const cap = asRecord(item.capability);
    const ap = asRecord(item.antipattern);
    return cap.id === input.objectId || ap.id === input.objectId;
  });
  const document = input.bundle.documents.find((item) => item.objectId === input.objectId);
  const object =
    asRecord(pair?.capability).id === input.objectId
      ? asRecord(pair?.capability)
      : asRecord(pair?.antipattern).id === input.objectId
        ? asRecord(pair?.antipattern)
        : undefined;
  const failed = !object || pair?.status === 'FAILED';
  const applicability = asRecord(object?.applicability);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(String(object?.title ?? input.objectId))} · DRAFT</title>
  <style>
    :root { --ink:#16130f; --paper:#f3eee4; --muted:#5d5348; --brass:#8a6a3b; --line:rgba(22,19,15,.12); }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font: 18px/1.5 "Iowan Old Style", Palatino, Georgia, serif; }
    main { width:min(760px, calc(100% - 2rem)); margin:0 auto; padding:2.5rem 0 5rem; }
    .kicker { font: 700 0.72rem/1 ui-monospace, Menlo, monospace; letter-spacing:.16em; text-transform:uppercase; color:var(--brass); }
    h1 { font-weight:500; font-size:2.2rem; line-height:1.15; margin:.35rem 0 1rem; }
    h2 { font-size:1.2rem; margin:2rem 0 .6rem; }
    h3 { font-size:1rem; margin:0 0 .25rem; }
    p, li { color:var(--ink); }
    .meta, .empty { color:var(--muted); font-size:.95rem; }
    .banner { padding:.8rem 1rem; border:1px solid var(--line); background:#fff8ea; margin:0 0 1.5rem; }
    a { color:var(--brass); }
    .mono { font-family: ui-monospace, Menlo, monospace; font-size:.82rem; color:var(--brass); }
    ul, ol { padding-left:1.2rem; }
    .finding { padding: .8rem 0; border-top:1px solid var(--line); }
  </style>
</head>
<body>
  <main>
    <p class="kicker">DRAFT production candidate · not APPROVED · domain ${escapeHtml(input.domain)}</p>
    <h1>${escapeHtml(String(object?.title ?? document?.title ?? input.objectId))}</h1>
    <p class="banner">${
      failed
        ? escapeHtml(pair?.error ?? document?.error ?? 'This pair could not be compiled into a DRAFT document.')
        : 'Assembled deterministically from persisted pair SIR artifacts. External approval and versioned release stay closed.'
    }</p>
    ${
      !failed && pair?.notes.length
        ? `<p class="banner">${pair.notes.map((note) => escapeHtml(note)).join('<br>')}</p>`
        : ''
    }
    <p class="meta"><a href="/documents/${escapeHtml(input.domain)}">Domain ${escapeHtml(input.domain)} documents</a>
      · <a href="/api/operator/documents/${escapeHtml(input.domain)}/${escapeHtml(input.objectId)}.json">JSON</a>
      · <a href="/?domain=${escapeHtml(input.domain)}">Operator board</a></p>
    ${
      failed
        ? ''
        : `<section>
      <h2>Canonical definition</h2>
      <p>${escapeHtml(String(object?.canonical_definition ?? ''))}</p>
      <h2>Applicability</h2>
      <p>${escapeHtml(String(applicability.statement ?? ''))}</p>
      <h3>Conditions</h3>${renderList(list(applicability.conditions))}
      <h3>Exclusions</h3>${renderList(list(applicability.exclusions))}
      <h2>Primary questions</h2>${questions(object?.primary_questions)}
      <h2>${object?.object_type === 'ANTIPATTERN' ? 'Atomic tests' : 'Atomic subcriteria'}</h2>${atomics(
        object?.object_type === 'ANTIPATTERN' ? object?.atomic_tests : object?.atomic_subcriteria,
        object?.object_type === 'ANTIPATTERN' ? 'test' : 'criterion'
      )}
      <h2>Required evidence</h2>${evidence(object?.required_evidence)}
      <h2>Finding definitions</h2>${findings(object?.finding_definitions)}
      <h2>Source mappings</h2>${mappings(object?.normative_source_mappings)}
      <h2>Related criteria</h2>${renderList(list(object?.related_criteria))}
    </section>`
    }
  </main>
</body>
</html>`;
}

export function renderCandidateIndexHtml(bundle: DomainCandidateBundle): string {
  const compiled = bundle.documents.filter((item) => item.status === 'COMPILED').length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Domain ${escapeHtml(bundle.domain)} DRAFT documents</title>
  <style>
    :root { --ink:#16130f; --paper:#f3eee4; --muted:#5d5348; --brass:#8a6a3b; --line:rgba(22,19,15,.12); }
    body { margin:0; background:var(--paper); color:var(--ink); font: 18px/1.5 "Iowan Old Style", Palatino, Georgia, serif; }
    main { width:min(760px, calc(100% - 2rem)); margin:0 auto; padding:2.5rem 0 5rem; }
    .kicker { font: 700 0.72rem/1 ui-monospace, Menlo, monospace; letter-spacing:.16em; text-transform:uppercase; color:var(--brass); }
    h1 { font-weight:500; font-size:2.2rem; margin:.35rem 0 1rem; }
    .banner { padding:.8rem 1rem; border:1px solid var(--line); background:#fff8ea; margin:0 0 1.5rem; }
    a { color:var(--brass); }
    li { margin:.45rem 0; }
    .fail { color:#8a3b2a; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">DRAFT production candidates · approval not granted</p>
    <h1>${escapeHtml(bundle.domainTitle)}</h1>
    <p class="banner">${String(compiled)} of ${String(bundle.documents.length)} objects compiled as DRAFT.
      Domain coherence: ${escapeHtml(bundle.domainCoherence)}. Versioned release stays closed until external APPROVED.</p>
    <p><a href="/?domain=${escapeHtml(bundle.domain)}">Operator board</a> · <a href="/api/operator/documents/${escapeHtml(bundle.domain)}">JSON bundle</a></p>
    <ol>${bundle.documents
      .map(
        (item) =>
          `<li><a href="${escapeHtml(item.htmlHref)}">${escapeHtml(item.objectId)} · ${escapeHtml(item.title)}</a>
            · <a href="${escapeHtml(item.jsonHref)}">JSON</a>
            ${item.status === 'FAILED' ? `<div class="fail">${escapeHtml(item.error ?? 'Compile failed.')}</div>` : ''}</li>`
      )
      .join('')}</ol>
  </main>
</body>
</html>`;
}

export function findCompiledObject(
  bundle: DomainCandidateBundle,
  objectId: string
): Record<string, unknown> | undefined {
  for (const pair of bundle.pairs) {
    const capability = pair.capability;
    const antipattern = pair.antipattern;
    if (capability && capability.id === objectId) return capability;
    if (antipattern && antipattern.id === objectId) return antipattern;
  }
  return undefined;
}
