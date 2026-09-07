import type { DomainId } from '../authoring/authoring-plan.js';
import { loadCategoriesBaseline, categoryDomain, categoryPair } from '../baseline/categories.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { PairCoherencePacket } from '../orchestration/pair-coherence-packet.js';
import { canTransition, pairTransitions } from '../orchestration/pipeline.js';
import {
  getBaselineSnapshotById,
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
  snapshotSlice
} from '../repair/qc-repair.js';
import type { RepairPatch } from '../repair/local-repair.js';
import {
  materializePairCoherenceReview,
  type MaterializedPairCoherenceDefect,
  type MaterializedPairCoherenceReview
} from '../sir/pair-coherence-materializer.js';
import type { SirPairCoherenceDefectDraft } from '../cognitive/sir-pair-coherence-contract.js';
import { artifactsFromLoaded, compileProductionCandidate } from '../compiler/production-candidate.js';
import { baselineIdentityFromSnapshot } from './authoring-context.js';
import { isOpenDomainState } from './eligibility.js';
import { operatorLog } from './log.js';
import { loadPairCoherenceSnapshot } from './qc-repair-command.js';
import type { PairState } from '../domain/states.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';

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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#39;');
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
      ? ` Human review ${input.savedAt}: deleted ${deleted.join(', ')}. Machine-readability gate passed.`
      : ` Human review ${input.savedAt}: semantic patches saved. Machine-readability gate passed.`;
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

async function sealedSnapshot(run: { baselineSnapshotId: string }): Promise<BaselineSnapshot> {
  const sealed = await getBaselineSnapshotById(run.baselineSnapshotId);
  if (!sealed) throw new Error('Sealed baseline snapshot is missing.');
  return {
    id: sealed.id,
    sha256: sealed.sha256,
    manifest: sealed.manifest as BaselineSnapshot['manifest']
  };
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

function parseDeletedIds(body: Record<string, unknown>): string[] {
  const ids: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith('delete:')) continue;
    if (value === 'on' || value === 'true' || value === true) {
      ids.push(key.slice('delete:'.length));
    }
  }
  const listed = body.deletedDefectIds;
  if (typeof listed === 'string' && listed.trim()) {
    ids.push(...listed.split(',').map((item) => item.trim()).filter(Boolean));
  }
  if (Array.isArray(listed)) {
    ids.push(...listed.filter((item): item is string => typeof item === 'string'));
  }
  return [...new Set(ids)];
}

function parsePatches(
  body: Record<string, unknown>,
  allowedPaths: readonly string[],
  originals: Map<string, string>
): RepairPatch[] {
  const patches: RepairPatch[] = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!key.startsWith('patch:')) continue;
    const path = key.slice('patch:'.length);
    if (!path || typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const original = originals.get(path);
    if (original !== undefined && original.trim() === trimmed) continue;
    if (!pathIsAllowed(path, allowedPaths.length ? allowedPaths : [path])) {
      throw new Error(`Save attempted undeclared path ${path}.`);
    }
    try {
      patches.push({ path, value: JSON.parse(trimmed) as unknown });
    } catch {
      throw new Error(`Patch at ${path} is not valid JSON.`);
    }
  }
  return patches;
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
}): Promise<{ domain: DomainId; pairId: string; passed: boolean; gateIssues: string[] }> {
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
  const deletedIds = parseDeletedIds(input.body);
  const remaining = remainingDefects(review, deletedIds);
  const blockingRemaining = remaining.filter((item) => item.severity === 'HIGH' || item.severity === 'BLOCKING');
  const allowedPaths = repairPathsFromDefects(review.defects);
  const originals = new Map<string, string>();
  for (const path of allowedPaths) {
    const current = readSnapshotPath(snapshot, path);
    if (current !== undefined) originals.set(path, JSON.stringify(current, null, 2));
  }
  const patches = parsePatches(input.body, allowedPaths, originals);
  const patched = patches.length ? applySnapshotPatches(snapshot, patches) : snapshot;
  const identityIssues = collectIdentityIssues(input.pairId, patched);
  if (identityIssues.length) {
    throw new Error(`Quality gate failed. IDs and metadata must stay machine-readable: ${identityIssues.join(' ')}`);
  }

  const rematerialized = rematerializeHumanReview({
    review,
    packet,
    deletedIds,
    savedAt: new Date().toISOString()
  });
  if (rematerialized.passed === true && blockingRemaining.length > 0) {
    throw new Error('Quality gate failed. HIGH/BLOCKING defects still remain after Save.');
  }

  if (rematerialized.passed === true) {
    const categories = loadCategoriesBaseline();
    const identity = categoryPair(categories, input.pairId);
    const domainRecord = categoryDomain(categories, input.domain);
    const sealed = await sealedSnapshot(run);
    try {
      const compiled = compileProductionCandidate({
        metadata: {
          schemaVersion: baselineIdentityFromSnapshot(sealed).capabilitySchemaVersion,
          domainTitle: domainRecord.title,
          capabilityTitle: identity.capabilityTitle,
          antipatternTitle: identity.antipatternTitle,
          capabilityVersion: pairRun.targetVersion,
          antipatternVersion: pairRun.targetVersion
        },
        artifacts: artifactsFromLoaded(input.pairId, {
          pairBoundary: patched.pairBoundary as never,
          apFailureModel: patched.apFailureModel as never,
          applicability: patched.applicability as never,
          primaryQuestions: patched.primaryQuestions as never,
          atomicDecomposition: patched.atomics as never,
          evidenceArchitecture: patched.evidence as never,
          evidenceSafety: patched.evidenceSafety as never,
          apAbsenceContract: patched.apAbsence as never,
          sourceMapping: patched.sourceMappings as never,
          findingArchitecture: patched.findings as never,
          controlBoundary: patched.controlBoundary as never,
          lifecycleAssurance: patched.lifecycleTargets as never,
          referenceMapping: patched.referenceMappings as never,
          pairCoherenceReview: rematerialized
        })
      });
      if (!compiled.capability.id || !compiled.antipattern.id) {
        throw new Error('Compiled DRAFT objects are missing canonical ids.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Quality gate failed. Machine-readable compile rejected the saved artifacts: ${message}`);
    }
  }

  const current = await reopenForHumanReview(pairRun);
  const touched = patches.length ? patchedSnapshotRoots(patches.map((item) => item.path)) : [];
  for (const taskType of touched) {
    const nextOutput = snapshotSlice(patched, taskType);
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
  operatorLog('operator.review.saved', {
    domain: input.domain,
    pairId: input.pairId,
    deleted: deletedIds,
    patchCount: patches.length,
    passed: rematerialized.passed
  });
  return {
    domain: input.domain,
    pairId: input.pairId,
    passed: rematerialized.passed,
    gateIssues: []
  };
}

export function renderPairReviewHtml(page: PairReviewPage): string {
  const blockingLabel =
    page.blockingCount === 0
      ? 'No HIGH/BLOCKING defects remain. Save still re-runs the machine-readability quality gate.'
      : `${String(page.blockingCount)} HIGH/BLOCKING defect(s). Delete a blocker only after you have judged it, or edit the semantic value at its path. Save always re-checks IDs and metadata.`;
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
    <p class="kicker">Pair review · domain ${escapeHtml(page.domain)} · ${escapeHtml(page.pairState)}</p>
    <h1>${escapeHtml(page.pairId)}</h1>
    <p class="banner">${escapeHtml(blockingLabel)} This is not domain APPROVED and not a versioned Knowledge Base release.</p>
    ${page.notice ? `<p class="banner">${escapeHtml(page.notice)}</p>` : ''}
    ${page.gateIssues.length ? `<p class="fail">${escapeHtml(page.gateIssues.join(' '))}</p>` : ''}
    <p class="meta">${escapeHtml(page.coherenceSummary)}</p>
    <p><a href="/?domain=${escapeHtml(page.domain)}">Operator board</a>
      · <a href="/documents/${escapeHtml(page.domain)}">DRAFT documents</a></p>
    <form method="post" action="/api/operator/commands">
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
        <label class="delete"><input type="checkbox" name="delete:${escapeHtml(item.defectId)}"> Delete this blocker. Save will re-check IDs and metadata before the pair can pass.</label>
        ${
          item.path
            ? `<label>Semantic value at path (JSON)<textarea name="patch:${escapeHtml(item.path)}">${escapeHtml(item.valueJson)}</textarea></label>`
            : ''
        }
      </article>`
              )
              .join('')
          : '<p class="banner">No remaining pair-coherence defects are listed.</p>'
      }
      <div class="actions">
        <button type="submit">Save and run quality gate</button>
        <span class="meta">Code owns IDs, handles and hashes. Save is rejected if those drift.</span>
      </div>
    </form>
  </main>
</body>
</html>`;
}
