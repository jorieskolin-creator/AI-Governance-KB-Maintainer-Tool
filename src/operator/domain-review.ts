import type { DomainId } from '../authoring/authoring-plan.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { DomainCoherencePacket } from '../orchestration/domain-coherence-packet.js';
import { canTransition, domainTransitions, expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getPairRuns,
  replaceCompletedTaskOutput,
  updateDomainState
} from '../orchestration/store.js';
import {
  applySnapshotPatches,
  patchedSnapshotRoots,
  pathIsAllowed,
  readSnapshotPath,
  snapshotSlice,
  SNAPSHOT_ROOT_TASK
} from '../repair/qc-repair.js';
import type { RepairPatch } from '../repair/local-repair.js';
import {
  materializeDomainCoherenceReview,
  type MaterializedDomainCoherenceDefect,
  type MaterializedDomainCoherenceReview
} from '../sir/domain-coherence-materializer.js';
import type { SirDomainCoherenceDefectDraft } from '../cognitive/sir-domain-coherence-contract.js';
import { operatorCommandsEnabled } from './commands.js';
import { isOpenDomainState } from './eligibility.js';
import { operatorLog } from './log.js';
import { loadPairCoherenceSnapshot } from './qc-repair-command.js';
import { schemaGate } from './pair-review.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';

const DOMAIN_PATH_TO_SNAPSHOT: Record<string, string> = {
  'capability.boundary': 'pairBoundary.capability',
  'antipattern.boundary': 'pairBoundary.antipattern',
  'capability.ownedTopics': 'pairBoundary.capability.ownedTopics',
  'capability.excludedTopics': 'pairBoundary.capability.excludedTopics',
  'capability.relatedCriteria': 'referenceMappings.capabilityRelatedCriteria',
  'antipattern.relatedCriteria': 'referenceMappings.antipatternRelatedCriteria',
  'capability.findings': 'findings.capability',
  'antipattern.findings': 'findings.antipattern',
  'capability.sources': 'sourceMappings.capability',
  'antipattern.sources': 'sourceMappings.antipattern'
};

export interface DomainReviewDefectView {
  defectId: string;
  severity: string;
  coherenceDimension: string;
  issue: string;
  coherenceExpectation: string;
  pairId: string;
  domainPath: string;
  snapshotPath: string;
  currentValue: unknown;
  valueJson: string;
}

export interface DomainReviewPage {
  domain: DomainId;
  domainState: string;
  passed: boolean;
  coherenceSummary: string;
  defects: DomainReviewDefectView[];
  blockingCount: number;
  notice?: string;
  gateIssues: string[];
}

export interface DomainReviewSaveResult {
  domain: DomainId;
  persisted: boolean;
  humanApproved: boolean;
  passed: boolean;
  deleted: string[];
  patchCount: number;
  gateIssues: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;')
    .replace(/'/g, '&#39;');
}

export function snapshotPathFromDomainPath(
  path: string
): { pairId: string; snapshotPath: string } | undefined {
  const match = path.match(/^pairs\[([A-F][1-5]_AP-[A-F][1-5])\]\.(.+)$/);
  if (!match) return undefined;
  const pairId = match[1];
  const suffix = match[2];
  if (!pairId || !suffix) return undefined;
  const snapshotPath = DOMAIN_PATH_TO_SNAPSHOT[suffix];
  if (!snapshotPath) return undefined;
  return { pairId, snapshotPath };
}

export function domainReviewFromUnknown(output: unknown): MaterializedDomainCoherenceReview | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as Partial<MaterializedDomainCoherenceReview>;
  if (typeof record.domain !== 'string' || typeof record.passed !== 'boolean') return undefined;
  if (!Array.isArray(record.defects) || typeof record.coherenceSummary !== 'string') return undefined;
  return record as MaterializedDomainCoherenceReview;
}

export function remainingDomainDefects(
  review: MaterializedDomainCoherenceReview,
  deletedIds: readonly string[]
): MaterializedDomainCoherenceDefect[] {
  const deleted = new Set(deletedIds);
  return review.defects.filter((item) => !deleted.has(item.defectId));
}

function semanticDomainDefects(defects: MaterializedDomainCoherenceDefect[]): SirDomainCoherenceDefectDraft[] {
  return defects.map((item) => ({
    severity: item.severity,
    coherenceDimension: item.coherenceDimension,
    affectedPairHandles: [...item.affectedPairHandles],
    affectedPathHandles: [...item.affectedPathHandles],
    issue: item.issue,
    coherenceExpectation: item.coherenceExpectation,
    recommendedRepairPairHandles: [...item.recommendedRepairPairHandles],
    recommendedRepairPathHandles: [...item.recommendedRepairPathHandles]
  }));
}

export function rematerializeHumanDomainReview(input: {
  review: MaterializedDomainCoherenceReview;
  packet: DomainCoherencePacket;
  deletedIds: readonly string[];
  savedAt: string;
}): MaterializedDomainCoherenceReview {
  const remaining = remainingDomainDefects(input.review, input.deletedIds);
  const deleted = input.deletedIds.filter((id) => input.review.defects.some((item) => item.defectId === id));
  const note =
    deleted.length > 0
      ? ` Human approved ${input.savedAt}: deleted ${deleted.join(', ')}. Section schema and reference-graph gate passed.`
      : ` Human approved ${input.savedAt}: semantic edits saved. Section schema and reference-graph gate passed.`;
  return materializeDomainCoherenceReview(
    {
      defects: semanticDomainDefects(remaining),
      coherenceSummary: `${input.review.coherenceSummary.trim()}${note}`.trim()
    },
    input.packet
  );
}

function lockedDomainPacket(contract: { lockedInputs: Record<string, unknown> }, domain: DomainId): DomainCoherencePacket {
  const raw = contract.lockedInputs.domain_coherence_packet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`DOMAIN_COHERENCE_REVIEW for domain ${domain} has no locked Domain Coherence Packet.`);
  }
  return raw as DomainCoherencePacket;
}

export function parseDomainSaveBody(body: Record<string, unknown>): {
  deletedIds: string[];
  patches: Array<RepairPatch & { pairId: string }>;
} {
  const ids: string[] = [];
  const listed = body.deletedDefectIds;
  if (typeof listed === 'string' && listed.trim()) {
    ids.push(...listed.split(',').map((item) => item.trim()).filter(Boolean));
  }
  if (Array.isArray(listed)) {
    ids.push(...listed.filter((item): item is string => typeof item === 'string'));
  }
  const patches: Array<RepairPatch & { pairId: string }> = [];
  if (Array.isArray(body.patches)) {
    for (const item of body.patches) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as { pairId?: unknown; path?: unknown; value?: unknown };
      if (typeof rec.pairId !== 'string' || typeof rec.path !== 'string' || !rec.path.trim()) continue;
      patches.push({ pairId: rec.pairId, path: rec.path, value: rec.value });
    }
  }
  return { deletedIds: [...new Set(ids)], patches };
}

export async function loadDomainReviewPage(domain: DomainId, notice?: string): Promise<DomainReviewPage> {
  const run = await getLatestDomainRun(domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const hostPairId = expectedDomainPairIds(domain)[0];
  const hostPair = pairRuns.find((item) => item.pairId === hostPairId);
  if (!hostPair) throw new Error(`Host pair for domain ${domain} is missing.`);
  const artifact = await getLatestCompletedTaskArtifact(hostPair.id, 'DOMAIN_COHERENCE_REVIEW');
  if (!artifact) {
    throw new Error(`Domain ${domain} has no completed DOMAIN_COHERENCE_REVIEW to review.`);
  }
  const review = domainReviewFromUnknown(artifact.output);
  if (!review) {
    throw new Error(`Domain ${domain} DOMAIN_COHERENCE_REVIEW cannot be read.`);
  }
  const snapshots = new Map<string, PairCoherenceSnapshot>();
  for (const pairRun of pairRuns) {
    snapshots.set(pairRun.pairId, await loadPairCoherenceSnapshot(pairRun.id));
  }
  const blocking = review.defects.filter((item) => item.severity === 'HIGH' || item.severity === 'BLOCKING');
  const defects: DomainReviewDefectView[] = review.defects.map((item) => {
    const domainPath = item.recommendedRepairPaths[0] ?? item.affectedPaths[0] ?? '';
    const mapped = domainPath ? snapshotPathFromDomainPath(domainPath) : undefined;
    const snapshot = mapped ? snapshots.get(mapped.pairId) : undefined;
    const currentValue = mapped && snapshot ? readSnapshotPath(snapshot, mapped.snapshotPath) : undefined;
    return {
      defectId: item.defectId,
      severity: item.severity,
      coherenceDimension: item.coherenceDimension,
      issue: item.issue,
      coherenceExpectation: item.coherenceExpectation,
      pairId: mapped?.pairId ?? item.affectedPairIds[0] ?? '',
      domainPath,
      snapshotPath: mapped?.snapshotPath ?? '',
      currentValue,
      valueJson: currentValue === undefined ? '' : JSON.stringify(currentValue, null, 2)
    };
  });
  return {
    domain,
    domainState: run.state,
    passed: review.passed === true,
    coherenceSummary: review.coherenceSummary,
    defects,
    blockingCount: blocking.length,
    notice,
    gateIssues: []
  };
}

async function markDomainReady(domainRunId: string, current: string): Promise<void> {
  let state = current;
  if (state === 'REPAIR_REQUIRED') {
    if (!canTransition(domainTransitions, 'REPAIR_REQUIRED', 'DOMAIN_VALIDATING')) {
      throw new Error('Illegal domain transition REPAIR_REQUIRED → DOMAIN_VALIDATING.');
    }
    await updateDomainState(domainRunId, 'DOMAIN_VALIDATING');
    state = 'DOMAIN_VALIDATING';
  }
  if (state !== 'DOMAIN_VALIDATING') {
    throw new Error(`Illegal domain transition ${state} → READY_FOR_APPROVAL.`);
  }
  if (!canTransition(domainTransitions, 'DOMAIN_VALIDATING', 'READY_FOR_APPROVAL')) {
    throw new Error('Illegal domain transition DOMAIN_VALIDATING → READY_FOR_APPROVAL.');
  }
  await updateDomainState(domainRunId, 'READY_FOR_APPROVAL');
}

export async function saveDomainReview(input: {
  domain: DomainId;
  body: Record<string, unknown>;
}): Promise<DomainReviewSaveResult> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  const run = await getLatestDomainRun(input.domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${input.domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const hostPairId = expectedDomainPairIds(input.domain)[0];
  const hostPair = pairRuns.find((item) => item.pairId === hostPairId);
  if (!hostPair) throw new Error(`Host pair for domain ${input.domain} is missing.`);
  const artifact = await getLatestCompletedTaskArtifact(hostPair.id, 'DOMAIN_COHERENCE_REVIEW');
  if (!artifact) {
    throw new Error(`Domain ${input.domain} has no completed DOMAIN_COHERENCE_REVIEW to save.`);
  }
  const review = domainReviewFromUnknown(artifact.output);
  if (!review) {
    throw new Error(`Domain ${input.domain} DOMAIN_COHERENCE_REVIEW cannot be read.`);
  }
  const packet = lockedDomainPacket(artifact.taskContract, input.domain);
  const parsed = parseDomainSaveBody(input.body);
  const allowedSnapshotPaths = review.defects
    .flatMap((item) => [item.recommendedRepairPaths[0], item.affectedPaths[0]])
    .map((path) => (path ? snapshotPathFromDomainPath(path)?.snapshotPath : undefined))
    .filter((path): path is string => Boolean(path));
  const gateIssues: string[] = [];
  const patchesByPair = new Map<string, RepairPatch[]>();
  for (const patch of parsed.patches) {
    if (allowedSnapshotPaths.length && !pathIsAllowed(patch.path, allowedSnapshotPaths)) {
      throw new Error(`Save attempted undeclared path ${patch.path}.`);
    }
    const list = patchesByPair.get(patch.pairId) ?? [];
    list.push({ path: patch.path, value: patch.value });
    patchesByPair.set(patch.pairId, list);
  }

  const patchedByPair = new Map<string, PairCoherenceSnapshot>();
  for (const pairRun of pairRuns) {
    const snapshot = await loadPairCoherenceSnapshot(pairRun.id);
    const patches = patchesByPair.get(pairRun.pairId) ?? [];
    const patched = patches.length ? applySnapshotPatches(snapshot, patches) : snapshot;
    gateIssues.push(...schemaGate(pairRun.pairId, patched).map((item) => `${pairRun.pairId}: ${item}`));
    if (patches.length) patchedByPair.set(pairRun.pairId, patched);
  }
  if (gateIssues.length) {
    return {
      domain: input.domain,
      persisted: false,
      humanApproved: false,
      passed: false,
      deleted: parsed.deletedIds,
      patchCount: parsed.patches.length,
      gateIssues
    };
  }

  const rematerialized = rematerializeHumanDomainReview({
    review,
    packet,
    deletedIds: parsed.deletedIds,
    savedAt: new Date().toISOString()
  });

  for (const pairRun of pairRuns) {
    const patched = patchedByPair.get(pairRun.pairId);
    if (!patched) continue;
    const patches = patchesByPair.get(pairRun.pairId) ?? [];
    const touched = patchedSnapshotRoots(patches.map((item) => item.path));
    for (const taskType of touched) {
      if (!(Object.values(SNAPSHOT_ROOT_TASK) as string[]).includes(taskType)) continue;
      const nextOutput = snapshotSlice(patched, taskType);
      await replaceCompletedTaskOutput({
        pairRunId: pairRun.id,
        taskType,
        output: nextOutput,
        outputHash: canonicalArtifactHash(nextOutput)
      });
    }
  }
  await replaceCompletedTaskOutput({
    pairRunId: hostPair.id,
    taskType: 'DOMAIN_COHERENCE_REVIEW',
    output: rematerialized,
    outputHash: canonicalArtifactHash(rematerialized)
  });
  if (rematerialized.passed === true) {
    await markDomainReady(run.id, run.state);
  }
  operatorLog('operator.domain_review.human_approved', {
    domain: input.domain,
    deleted: parsed.deletedIds,
    patchCount: parsed.patches.length,
    passed: rematerialized.passed
  });
  return {
    domain: input.domain,
    persisted: true,
    humanApproved: true,
    passed: rematerialized.passed,
    deleted: parsed.deletedIds,
    patchCount: parsed.patches.length,
    gateIssues: []
  };
}

export function renderDomainReviewHtml(page: DomainReviewPage): string {
  const blockingLabel =
    page.blockingCount === 0
      ? 'No HIGH/BLOCKING domain defects remain. Approve and save still checks complete section schemas, handles, identity, and the reference graph. Empty sections cannot be saved.'
      : `${String(page.blockingCount)} HIGH/BLOCKING domain defect(s). Deleting a blocker or editing its content is human approval of that change. After you approve, the next check is complete section schemas, handles, identity, and the reference graph. Empty sections cannot be saved.`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Review domain ${escapeHtml(page.domain)}</title>
  <style>
    :root { --ink:#f3eee4; --panel:#1f1b16; --line:rgba(243,238,228,.12); --muted:#b7aa98; --subtle:#8a7d6d; --brass:#c4a574; --fail:#d9896f; }
    * { box-sizing: border-box; }
    body { margin:0; background:#16130f; color:var(--ink); font: 16px/1.45 "Iowan Old Style", Palatino, Georgia, serif; }
    main { width:min(920px, calc(100% - 2rem)); margin:0 auto; padding:2rem 0 4rem; }
    .kicker { font: 700 0.72rem/1 ui-monospace, Menlo, monospace; letter-spacing:.16em; text-transform:uppercase; color:var(--brass); }
    h1 { font-weight:500; font-size:2rem; margin:.35rem 0 1rem; }
    a { color:var(--brass); }
    .banner, .defect { border:1px solid var(--line); border-radius:12px; padding:1rem 1.1rem; margin:0 0 1rem; background:var(--panel); }
    .meta, p { color:var(--muted); }
    label.delete { display:flex; gap:.6rem; align-items:flex-start; margin:.8rem 0; color:var(--ink); }
    textarea { width:100%; min-height:9rem; background:#16130f; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:.7rem; font: 13px/1.4 ui-monospace, Menlo, monospace; }
    button {
      appearance:none; border:1px solid var(--brass); background:#2a241c; color:var(--ink);
      border-radius:999px; padding:.5rem 1.1rem; font: inherit; cursor:pointer;
    }
    .fail { color:var(--fail); }
    .actions { display:flex; gap:.8rem; align-items:center; flex-wrap:wrap; margin-top:1rem; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Human domain approval · domain ${escapeHtml(page.domain)} · ${escapeHtml(page.domainState)}</p>
    <h1>Domain ${escapeHtml(page.domain)} coherence</h1>
    <p class="banner">${escapeHtml(blockingLabel)} This is not domain APPROVED and not a versioned Knowledge Base release.</p>
    ${page.notice ? `<p class="banner">${escapeHtml(page.notice)}</p>` : ''}
    ${page.gateIssues.length ? `<p class="fail">${page.gateIssues.map((item) => escapeHtml(item)).join('<br>')}</p>` : ''}
    <p class="meta">${escapeHtml(page.coherenceSummary)}</p>
    <p><a href="/?domain=${escapeHtml(page.domain)}">Operator board</a>
      · <a href="/documents/${escapeHtml(page.domain)}">DRAFT documents</a></p>
    <form id="domain-review-form" method="post" action="/api/operator/commands">
      <input type="hidden" name="domain" value="${escapeHtml(page.domain)}">
      <input type="hidden" name="action" value="save-domain-review">
      ${
        page.defects.length
          ? page.defects
              .map(
                (item) => `<article class="defect">
        <p class="kicker">${escapeHtml(item.severity)} · ${escapeHtml(item.defectId)} · ${escapeHtml(item.pairId)} · ${escapeHtml(item.coherenceDimension)}</p>
        <p>${escapeHtml(item.issue)}</p>
        <p class="meta">${escapeHtml(item.coherenceExpectation)}</p>
        <p class="meta">Path <code>${escapeHtml(item.domainPath || 'none')}</code></p>
        <label class="delete"><input type="checkbox" data-defect-id="${escapeHtml(item.defectId)}" name="delete:${escapeHtml(item.defectId)}"> Delete this blocker. Checking it and saving is human approval that it is no longer a domain blocker.</label>
        ${
          item.snapshotPath
            ? `<label>Semantic value at path (JSON)<textarea data-pair-id="${escapeHtml(item.pairId)}" data-path="${escapeHtml(item.snapshotPath)}" name="content:${escapeHtml(item.defectId)}">${escapeHtml(item.valueJson)}</textarea></label>`
            : ''
        }
      </article>`
              )
              .join('')
          : '<p class="banner">No remaining domain-coherence defects are listed. Approve and save still checks complete section schemas and the reference graph. Empty sections cannot be saved.</p>'
      }
      <div class="actions">
        <button type="submit">Approve and save</button>
        <span class="meta">Human approval of these domain edits. Next check is complete section schemas, handles, identity, and the reference graph.</span>
      </div>
    </form>
  </main>
  <script>
  (function () {
    var form = document.getElementById('domain-review-form');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var deleted = [];
      form.querySelectorAll('input[data-defect-id]').forEach(function (input) {
        if (input.checked) deleted.push(input.getAttribute('data-defect-id'));
      });
      var patches = [];
      var invalid = '';
      form.querySelectorAll('textarea[data-path]').forEach(function (area) {
        var path = area.getAttribute('data-path');
        var pairId = area.getAttribute('data-pair-id');
        if (!path || !pairId) return;
        var raw = String(area.value || '').trim();
        if (!raw) return;
        try {
          patches.push({ pairId: pairId, path: path, value: JSON.parse(raw) });
        } catch (error) {
          invalid = 'Content at ' + path + ' is not valid JSON. Keep IDs and sections machine-readable.';
        }
      });
      if (invalid) {
        window.alert(invalid);
        return;
      }
      var body = {
        domain: form.querySelector('[name="domain"]').value,
        action: 'save-domain-review',
        deletedDefectIds: deleted,
        patches: patches
      };
      fetch('/api/operator/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (payload) {
          var issues = payload.gateIssues || [];
          if (!res.ok || payload.persisted === false) {
            var message = issues.length ? issues.join('\\n') : (payload.error || 'Schema gate rejected the save.');
            window.alert(message);
            return;
          }
          var notice = payload.passed
            ? 'Human approved. Section schema and reference-graph gate passed. Deleted domain blockers are gone. Domain Coherence now passes.'
            : 'Human approved the saved edits. Section schema and reference-graph gate passed. HIGH domain blockers still remain.';
          window.location.assign('/review/' + encodeURIComponent(body.domain) + '?notice=' + encodeURIComponent(notice));
        });
      }).catch(function () {
        window.alert('Save failed. Retry Approve and save.');
      });
    });
  })();
  </script>
</body>
</html>`;
}
