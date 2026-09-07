import type { DomainId } from '../authoring/authoring-plan.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { PairCoherencePacket } from '../orchestration/pair-coherence-packet.js';
import { canTransition, pairTransitions } from '../orchestration/pipeline.js';
import {
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getPairRuns,
  replaceCompletedTaskOutput,
  updatePairState,
  type PairRunRecord
} from '../orchestration/store.js';
import {
  applySnapshotPatches,
  blockingQcDefects,
  pathIsAllowed,
  patchedSnapshotRoots,
  readSnapshotPath,
  repairPathsFromDefects,
  reviewFromUnknown,
  snapshotSlice,
  SNAPSHOT_ROOT_TASK
} from '../repair/qc-repair.js';
import type { RepairPatch } from '../repair/local-repair.js';
import {
  materializePairCoherenceReview,
  type MaterializedPairCoherenceDefect,
  type MaterializedPairCoherenceReview
} from '../sir/pair-coherence-materializer.js';
import type { SirPairCoherenceDefectDraft } from '../cognitive/sir-pair-coherence-contract.js';
import { isOpenDomainState } from './eligibility.js';
import { operatorCommandsEnabled } from './commands.js';
import { operatorLog } from './log.js';
import { loadPairCoherenceSnapshot } from './qc-repair-command.js';
import type { PairState } from '../domain/states.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';

export interface ReviewDefectView {
  defectId: string;
  severity: string;
  coherenceDimension: string;
  issue: string;
  coherenceExpectation: string;
  path: string;
  currentValue: unknown;
  valueJson: string;
}

export interface PairReviewPage {
  domain: DomainId;
  pairId: string;
  pairState: string;
  passed: boolean;
  coherenceSummary: string;
  defects: ReviewDefectView[];
  blockingCount: number;
  notice?: string;
  gateIssues: string[];
}

export interface PairReviewSaveResult {
  domain: DomainId;
  pairId: string;
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

function capabilityIdOf(pairId: string): string {
  return pairId.split('_')[0] ?? pairId;
}

function collectIdentityIssues(pairId: string, value: unknown, path = ''): string[] {
  const capabilityId = capabilityIdOf(pairId);
  const antipatternId = `AP-${capabilityId}`;
  const issues: string[] = [];
  if (!value || typeof value !== 'object') return issues;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      issues.push(...collectIdentityIssues(pairId, item, `${path}[${String(index)}]`));
    });
    return issues;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.pairId === 'string' && record.pairId !== pairId) {
    issues.push(`${path || '/'}.pairId drifted to ${record.pairId}.`);
  }
  if (typeof record.capabilityId === 'string' && record.capabilityId !== capabilityId) {
    issues.push(`${path || '/'}.capabilityId drifted to ${record.capabilityId}.`);
  }
  if (typeof record.antipatternId === 'string' && record.antipatternId !== antipatternId) {
    issues.push(`${path || '/'}.antipatternId drifted to ${record.antipatternId}.`);
  }
  for (const [key, child] of Object.entries(record)) {
    if (child && typeof child === 'object') {
      issues.push(...collectIdentityIssues(pairId, child, path ? `${path}.${key}` : key));
    }
  }
  return issues;
}

function collectHandleIssues(value: unknown, path = ''): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== 'object') return issues;
  if (Array.isArray(value)) {
    const seen = new Map<string, number>();
    value.forEach((item, index) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const handle = (item as { handle?: unknown }).handle;
        if (typeof handle === 'string') {
          if (!handle.trim()) {
            issues.push(`${path}[${String(index)}].handle is empty.`);
          } else if (seen.has(handle)) {
            issues.push(`${path} has duplicate handle ${handle}.`);
          } else {
            seen.set(handle, index);
          }
        }
      }
      issues.push(...collectHandleIssues(item, `${path}[${String(index)}]`));
    });
    return issues;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child && typeof child === 'object') {
      issues.push(...collectHandleIssues(child, path ? `${path}.${key}` : key));
    }
  }
  return issues;
}

export function schemaGate(pairId: string, snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return ['Pair snapshot is missing required sections.'];
  }
  const record = snapshot as Record<string, unknown>;
  const issues: string[] = [];
  for (const root of Object.keys(SNAPSHOT_ROOT_TASK)) {
    if (record[root] === undefined || record[root] === null) {
      issues.push(`Required section ${root} is missing.`);
    }
  }
  issues.push(...collectIdentityIssues(pairId, snapshot));
  issues.push(...collectHandleIssues(snapshot));
  return issues;
}

export function remainingDefects(
  review: MaterializedPairCoherenceReview,
  deletedIds: readonly string[]
): MaterializedPairCoherenceDefect[] {
  const deleted = new Set(deletedIds);
  return review.defects.filter((item) => !deleted.has(item.defectId));
}

export function semanticDefectsFrom(reviewDefects: MaterializedPairCoherenceDefect[]): SirPairCoherenceDefectDraft[] {
  return reviewDefects.map((item) => ({
    severity: item.severity,
    coherenceDimension: item.coherenceDimension,
    affectedPathHandles: [...item.affectedPathHandles],
    issue: item.issue,
    coherenceExpectation: item.coherenceExpectation,
    recommendedRepairPathHandles: [...item.recommendedRepairPathHandles]
  }));
}

export function rematerializeHumanReview(input: {
  review: MaterializedPairCoherenceReview;
  packet: PairCoherencePacket;
  deletedIds: readonly string[];
  savedAt: string;
}): MaterializedPairCoherenceReview {
  const remaining = remainingDefects(input.review, input.deletedIds);
  const deleted = input.deletedIds.filter((id) => input.review.defects.some((item) => item.defectId === id));
  const note =
    deleted.length > 0
      ? ` Human approved ${input.savedAt}: deleted ${deleted.join(', ')}. Schema/ID gate passed.`
      : ` Human approved ${input.savedAt}: semantic edits saved. Schema/ID gate passed.`;
  const summary = `${input.review.coherenceSummary.trim()}${note}`.trim();
  return materializePairCoherenceReview(
    {
      defects: semanticDefectsFrom(remaining),
      coherenceSummary: summary
    },
    input.packet
  );
}

function lockedPacket(contract: { lockedInputs: Record<string, unknown> }, pairId: string): PairCoherencePacket {
  const raw = contract.lockedInputs.pair_coherence_packet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`PAIR_COHERENCE_REVIEW for ${pairId} has no locked Pair Coherence Packet.`);
  }
  return raw as PairCoherencePacket;
}

export function parseReviewSaveBody(body: Record<string, unknown>): { deletedIds: string[]; patches: RepairPatch[] } {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith('delete:') && key !== 'deleteDefect') continue;
    if (value === 'on' || value === 'true' || value === true) {
      ids.push(key.slice('delete:'.length));
    }
    if (typeof value === 'string' && key === 'deleteDefect') ids.push(value);
    if (Array.isArray(value) && key === 'deleteDefect') {
      ids.push(...value.filter((item): item is string => typeof item === 'string'));
    }
  }
  const listed = body.deletedDefectIds;
  if (typeof listed === 'string' && listed.trim()) {
    ids.push(...listed.split(',').map((item) => item.trim()).filter(Boolean));
  }
  if (Array.isArray(listed)) {
    ids.push(...listed.filter((item): item is string => typeof item === 'string'));
  }

  const patches: RepairPatch[] = [];
  const rawPatches = body.patches;
  if (Array.isArray(rawPatches)) {
    for (const item of rawPatches) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const rec = item as { path?: unknown; value?: unknown };
      if (typeof rec.path !== 'string' || !rec.path.trim()) continue;
      patches.push({ path: rec.path, value: rec.value });
    }
  }
  for (const [key, raw] of Object.entries(body)) {
    if (!key.startsWith('patch:')) continue;
    const path = key.slice('patch:'.length);
    if (!path || typeof raw !== 'string' || !raw.trim()) continue;
    try {
      patches.push({ path, value: JSON.parse(raw) as unknown });
    } catch {
      throw new Error(`Content at ${path} is not valid JSON. Human approval requires machine-readable form.`);
    }
  }
  return { deletedIds: [...new Set(ids)], patches };
}

export async function loadPairReviewPage(domain: DomainId, pairId: string, notice?: string): Promise<PairReviewPage> {
  const run = await getLatestDomainRun(domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const pairRun = pairRuns.find((item) => item.pairId === pairId);
  if (!pairRun) throw new Error(`Pair ${pairId} is missing from domain ${domain}.`);
  const artifact = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  if (!artifact) {
    throw new Error(`${pairId} has no completed PAIR_COHERENCE_REVIEW to review.`);
  }
  const review = reviewFromUnknown(pairId, artifact.output);
  if (!review) {
    throw new Error(`${pairId} PAIR_COHERENCE_REVIEW cannot be read.`);
  }
  const snapshot = await loadPairCoherenceSnapshot(pairRun.id);
  const blocking = blockingQcDefects(review);
  const paths = repairPathsFromDefects(blocking.length ? blocking : review.defects);
  const defects: ReviewDefectView[] = review.defects.map((item) => {
    const path = item.recommendedRepairPaths[0] ?? item.affectedPaths[0] ?? paths[0] ?? '';
    const currentValue = path ? readSnapshotPath(snapshot, path) : undefined;
    return {
      defectId: item.defectId,
      severity: item.severity,
      coherenceDimension: item.coherenceDimension,
      issue: item.issue,
      coherenceExpectation: item.coherenceExpectation,
      path,
      currentValue,
      valueJson: currentValue === undefined ? '' : JSON.stringify(currentValue, null, 2)
    };
  });
  return {
    domain,
    pairId,
    pairState: pairRun.state,
    passed: review.passed === true,
    coherenceSummary: review.coherenceSummary,
    defects,
    blockingCount: blocking.length,
    notice,
    gateIssues: []
  };
}

async function reopenForHumanReview(pairRun: PairRunRecord): Promise<PairState> {
  if (pairRun.state === 'REPAIR_REQUIRED' || pairRun.state === 'AUTHORING' || pairRun.state === 'VALIDATING') {
    return pairRun.state;
  }
  if (!canTransition(pairTransitions, pairRun.state, 'REPAIR_REQUIRED')) {
    throw new Error(`Illegal pair transition ${pairRun.state} → REPAIR_REQUIRED.`);
  }
  await updatePairState(pairRun.id, 'REPAIR_REQUIRED');
  return 'REPAIR_REQUIRED';
}

async function markValidated(pairRunId: string, current: PairState): Promise<void> {
  let state = current;
  if (state !== 'VALIDATING') {
    if (!canTransition(pairTransitions, state, 'VALIDATING')) {
      throw new Error(`Illegal pair transition ${state} → VALIDATING.`);
    }
    await updatePairState(pairRunId, 'VALIDATING');
    state = 'VALIDATING';
  }
  if (!canTransition(pairTransitions, state, 'VALIDATED')) {
    throw new Error(`Illegal pair transition ${state} → VALIDATED.`);
  }
  await updatePairState(pairRunId, 'VALIDATED');
}

export async function savePairReview(input: {
  domain: DomainId;
  pairId: string;
  body: Record<string, unknown>;
}): Promise<PairReviewSaveResult> {
  if (!operatorCommandsEnabled()) {
    throw new Error('Operator commands are disabled on this deployment.');
  }
  const run = await getLatestDomainRun(input.domain);
  if (!run || !isOpenDomainState(run.state)) {
    throw new Error(`No open domain ${input.domain} run.`);
  }
  const pairRuns = await getPairRuns(run.id);
  const pairRun = pairRuns.find((item) => item.pairId === input.pairId);
  if (!pairRun) throw new Error(`Pair ${input.pairId} is missing.`);
  const artifact = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  if (!artifact) {
    throw new Error(`${input.pairId} has no completed PAIR_COHERENCE_REVIEW to save.`);
  }
  const review = reviewFromUnknown(input.pairId, artifact.output);
  if (!review) {
    throw new Error(`${input.pairId} PAIR_COHERENCE_REVIEW cannot be read.`);
  }
  const packet = lockedPacket(artifact.taskContract, input.pairId);
  const snapshot = await loadPairCoherenceSnapshot(pairRun.id);
  const parsed = parseReviewSaveBody(input.body);
  const allowedPaths = repairPathsFromDefects(review.defects);
  const knownPaths = allowedPaths.length ? allowedPaths : parsed.patches.map((item) => item.path);
  for (const patch of parsed.patches) {
    if (knownPaths.length && !pathIsAllowed(patch.path, knownPaths)) {
      throw new Error(`Save attempted undeclared path ${patch.path}.`);
    }
  }
  const patched = parsed.patches.length
    ? applySnapshotPatches(snapshot, parsed.patches)
    : snapshot;
  const gateIssues = schemaGate(input.pairId, patched);
  if (gateIssues.length) {
    return {
      domain: input.domain,
      pairId: input.pairId,
      persisted: false,
      humanApproved: false,
      passed: false,
      deleted: parsed.deletedIds,
      patchCount: parsed.patches.length,
      gateIssues
    };
  }

  const rematerialized = rematerializeHumanReview({
    review,
    packet,
    deletedIds: parsed.deletedIds,
    savedAt: new Date().toISOString()
  });

  const current = await reopenForHumanReview(pairRun);
  const touched = parsed.patches.length ? patchedSnapshotRoots(parsed.patches.map((item) => item.path)) : [];
  for (const taskType of touched) {
    const nextOutput = snapshotSlice(patched as PairCoherenceSnapshot, taskType);
    await replaceCompletedTaskOutput({
      pairRunId: pairRun.id,
      taskType,
      output: nextOutput,
      outputHash: canonicalArtifactHash(nextOutput)
    });
  }
  await replaceCompletedTaskOutput({
    pairRunId: pairRun.id,
    taskType: 'PAIR_COHERENCE_REVIEW',
    output: rematerialized,
    outputHash: canonicalArtifactHash(rematerialized)
  });
  if (rematerialized.passed === true) {
    await markValidated(pairRun.id, current);
  }
  operatorLog('operator.review.human_approved', {
    domain: input.domain,
    pairId: input.pairId,
    deleted: parsed.deletedIds,
    patchCount: parsed.patches.length,
    passed: rematerialized.passed
  });
  return {
    domain: input.domain,
    pairId: input.pairId,
    persisted: true,
    humanApproved: true,
    passed: rematerialized.passed,
    deleted: parsed.deletedIds,
    patchCount: parsed.patches.length,
    gateIssues: []
  };
}

export function renderPairReviewHtml(page: PairReviewPage): string {
  const blockingLabel =
    page.blockingCount === 0
      ? 'No HIGH/BLOCKING defects remain. Approve and save still checks IDs and required sections.'
      : `${String(page.blockingCount)} HIGH/BLOCKING defect(s). Deleting a blocker or editing its content is human approval of that change. After you approve, the only check is schema: IDs, handles and required sections.`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Review ${escapeHtml(page.pairId)}</title>
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
    <p class="kicker">Human pair approval · domain ${escapeHtml(page.domain)} · ${escapeHtml(page.pairState)}</p>
    <h1>${escapeHtml(page.pairId)}</h1>
    <p class="banner">${escapeHtml(blockingLabel)} This is not domain APPROVED and not a versioned Knowledge Base release.</p>
    ${page.notice ? `<p class="banner">${escapeHtml(page.notice)}</p>` : ''}
    ${page.gateIssues.length ? `<p class="fail">${page.gateIssues.map((item) => escapeHtml(item)).join('<br>')}</p>` : ''}
    <p class="meta">${escapeHtml(page.coherenceSummary)}</p>
    <p><a href="/?domain=${escapeHtml(page.domain)}">Operator board</a>
      · <a href="/documents/${escapeHtml(page.domain)}">DRAFT documents</a></p>
    <form id="pair-review-form" method="post" action="/api/operator/commands">
      <input type="hidden" name="domain" value="${escapeHtml(page.domain)}">
      <input type="hidden" name="pairId" value="${escapeHtml(page.pairId)}">
      <input type="hidden" name="action" value="save-pair-review">
      ${
        page.defects.length
          ? page.defects
              .map(
                (item) => `<article class="defect">
        <p class="kicker">${escapeHtml(item.severity)} · ${escapeHtml(item.defectId)} · ${escapeHtml(item.coherenceDimension)}</p>
        <p>${escapeHtml(item.issue)}</p>
        <p class="meta">${escapeHtml(item.coherenceExpectation)}</p>
        <p class="meta">Path <code>${escapeHtml(item.path || 'none')}</code></p>
        <label class="delete"><input type="checkbox" data-defect-id="${escapeHtml(item.defectId)}" name="delete:${escapeHtml(item.defectId)}"> Delete this blocker. Checking it and saving is human approval that it is no longer a blocker.</label>
        ${
          item.path
            ? `<label>Semantic value at path (JSON)<textarea data-path="${escapeHtml(item.path)}" name="content:${escapeHtml(item.defectId)}">${escapeHtml(item.valueJson)}</textarea></label>`
            : ''
        }
      </article>`
              )
              .join('')
          : '<p class="banner">No remaining pair-coherence defects are listed. Approve and save still checks IDs and required sections.</p>'
      }
      <div class="actions">
        <button type="submit">Approve and save</button>
        <span class="meta">Human approval of these edits. Next check is schema only: IDs, handles, required sections.</span>
      </div>
    </form>
  </main>
  <script>
  (function () {
    var form = document.getElementById('pair-review-form');
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
        if (!path) return;
        var raw = String(area.value || '').trim();
        if (!raw) return;
        try {
          patches.push({ path: path, value: JSON.parse(raw) });
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
        pairId: form.querySelector('[name="pairId"]').value,
        action: 'save-pair-review',
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
            ? 'Human approved. Schema/ID gate passed. Deleted blockers are gone. Pair Coherence now passes.'
            : 'Human approved the saved edits. Schema/ID gate passed. HIGH blockers still remain.';
          window.location.assign('/review/' + encodeURIComponent(body.domain) + '/' + encodeURIComponent(body.pairId) + '?notice=' + encodeURIComponent(notice));
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
