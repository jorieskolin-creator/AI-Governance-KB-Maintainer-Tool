import type { DomainId } from '../authoring/authoring-plan.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { PairCoherencePacket } from '../orchestration/pair-coherence-packet.js';
import { canTransition, pairTransitions, PAIR_TASK_SEQUENCE } from '../orchestration/pipeline.js';
import {
  currentPairCandidateHash,
  getBaselineSnapshotById,
  getCompletedTaskTypes,
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getPairRuns,
  getParkedFindings,
  latestPairCandidateRevisionId,
  loadFindingDispositions,
  persistFindingDispositions,
  persistPairCandidate,
  replaceCompletedTaskOutput,
  updatePairState,
  type PairRunRecord
} from '../orchestration/store.js';
import { pairMayValidate, staleRevisionIssues } from '../orchestration/named-gates.js';
import { reviewSaveMayValidatePair } from './eligibility.js';
import { buildPairAuthoringPlan } from './authoring-context.js';
import {
  blockingOpenDefects,
  deletedFindingFormIssues,
  dispositionForFinding,
  dispositionsForReviewFix,
  isClosingDisposition,
  openDefects,
  parseFindingDispositionDrafts,
  reviewForNamedGates,
  validateFindingDispositions,
  type FindingDispositionDraft,
  type FindingDispositionOrOpen
} from '../repair/finding-dispositions.js';
import {
  bindPairCoherenceReviewContract,
  compileAndRecordCurrentPair,
  pairPacketInputHash,
  rebuildPairCoherencePacket,
  rematerializePairReviewForCurrentPacket,
  reviewNotesFromReview
} from '../repair/revision-aware-repair.js';
import {
  applySnapshotPatches,
  pathIsAllowed,
  patchedSnapshotRoots,
  readSnapshotPath,
  repairPathsFromDefects,
  reviewFromUnknown,
  snapshotSlice
} from '../repair/qc-repair.js';
import type { RepairPatch } from '../repair/local-repair.js';
import type { MaterializedPairCoherenceDefect, MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import type { SirPairCoherenceDefectDraft } from '../cognitive/sir-pair-coherence-contract.js';
import { isOpenDomainState } from './eligibility.js';
import { operatorCommandsEnabled } from './commands.js';
import { operatorLog } from './log.js';
import { loadPairCoherenceSnapshot } from './qc-repair-command.js';
import type { PairState } from '../domain/states.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';
import { schemaGate, schemaGateFocused } from './schema-gate.js';
import {
  DEFAULT_PARK_OWNER,
  DEFAULT_PARK_REASON,
  findingActionStatus,
  renderFindingActionButtons,
  renderFindingStatus,
  renderReviewClientScript,
  reviewPageSharedStyles,
  type FindingActionStatus
} from './review-fix-ui.js';
export { schemaGate, schemaGateFocused };

export interface ReviewDefectView {
  defectId: string;
  severity: string;
  coherenceDimension: string;
  issue: string;
  coherenceExpectation: string;
  path: string;
  currentValue: unknown;
  valueJson: string;
  disposition: FindingDispositionOrOpen;
  rationale: string;
  actionStatus?: FindingActionStatus;
  parkReason?: string;
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
  candidateHash?: string;
  hasCoherenceReview?: boolean;
  regenerableSections?: string[];
  reworkAvailable?: boolean;
  commandsEnabled?: boolean;
}

export interface PairReviewSaveResult {
  domain: DomainId;
  pairId: string;
  persisted: boolean;
  humanApproved: boolean;
  passed: boolean;
  pairValidated: boolean;
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

export function remainingDefects(
  review: MaterializedPairCoherenceReview,
  dispositions: readonly FindingDispositionDraft[]
): MaterializedPairCoherenceDefect[] {
  return openDefects(review.defects, dispositions);
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
  dispositions: readonly FindingDispositionDraft[];
  savedAt: string;
}): MaterializedPairCoherenceReview {
  return rematerializePairReviewForCurrentPacket(input);
}

export function parseReviewSaveBody(body: Record<string, unknown>): {
  deletedIds: string[];
  patches: RepairPatch[];
  expectedCandidateHash?: string;
  dispositions: FindingDispositionDraft[];
  dispositionIssues: string[];
} {
  const expectedCandidateHash =
    typeof body.expectedCandidateHash === 'string' && body.expectedCandidateHash.trim()
      ? body.expectedCandidateHash.trim()
      : undefined;
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
  const parsedDispositions = parseFindingDispositionDrafts(body, 'OPERATOR');
  return {
    deletedIds: [...new Set(ids)],
    patches,
    expectedCandidateHash,
    dispositions: parsedDispositions.drafts,
    dispositionIssues: parsedDispositions.issues
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
  const completedTypes = await getCompletedTaskTypes(pairRun.id);
  const regenerableSections = PAIR_TASK_SEQUENCE.filter(
    (taskType) => taskType !== 'PAIR_COHERENCE_REVIEW' && completedTypes.has(taskType)
  );
  const artifact = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
  const review = artifact ? reviewFromUnknown(pairId, artifact.output) : undefined;
  if (!review) {
    // The pair is defected before Pair Coherence produced a readable review (an earlier
    // SIR task failed, or the pair has not reached coherence yet). It still needs a
    // reachable editing surface: regenerate a section, or Save & Finalize Later.
    return {
      domain,
      pairId,
      pairState: pairRun.state,
      passed: false,
      coherenceSummary: artifact
        ? `${pairId} has a Pair Coherence review that cannot be read; regenerate a section or finalize later.`
        : `${pairId} has no completed Pair Coherence review yet. Regenerate a defected section, or Save & Finalize Later while it waits on an external dependency.`,
      defects: [],
      blockingCount: 0,
      notice,
      gateIssues: [],
      hasCoherenceReview: false,
      regenerableSections,
      reworkAvailable: false,
      commandsEnabled: operatorCommandsEnabled()
    };
  }
  const snapshot = await loadPairCoherenceSnapshot(pairRun.id);
  const candidateId = await latestPairCandidateRevisionId(pairRun.id);
  const dispositions = candidateId ? await loadFindingDispositions(candidateId, 'PAIR') : [];
  const parked = (await getParkedFindings(run.id)).filter((item) => item.pairRunId === pairRun.id);
  const pairParked = pairRun.state === 'DEFERRED' || parked.length > 0;
  const parkReason =
    parked.find((item) => item.checkId === 'FINALIZE_LATER')?.parkReason ??
    parked[0]?.parkReason ??
    parked[0]?.issue ??
    DEFAULT_PARK_REASON;
  const blocking = blockingOpenDefects(review.defects, dispositions);
  const paths = repairPathsFromDefects(blocking.length ? blocking : review.defects);
  const defects: ReviewDefectView[] = review.defects.map((item) => {
    const path = item.recommendedRepairPaths[0] ?? item.affectedPaths[0] ?? paths[0] ?? '';
    const currentValue = path ? readSnapshotPath(snapshot, path) : undefined;
    const recorded = dispositionForFinding(dispositions, item.defectId);
    const disposition = recorded?.disposition ?? 'OPEN';
    return {
      defectId: item.defectId,
      severity: item.severity,
      coherenceDimension: item.coherenceDimension,
      issue: item.issue,
      coherenceExpectation: item.coherenceExpectation,
      path,
      currentValue,
      valueJson: currentValue === undefined ? '' : JSON.stringify(currentValue, null, 2),
      disposition,
      rationale: recorded?.rationale ?? '',
      actionStatus: findingActionStatus({ pairParked, disposition }),
      parkReason: pairParked ? parkReason : undefined
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
    gateIssues: [],
    candidateHash: await currentPairCandidateHash(pairRun.id, pairId),
    hasCoherenceReview: true,
    regenerableSections,
    reworkAvailable: blocking.length > 0,
    commandsEnabled: operatorCommandsEnabled()
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
  const snapshot = await loadPairCoherenceSnapshot(pairRun.id);
  const parsed = parseReviewSaveBody(input.body);
  const pathFor = (findingId: string): string => {
    const defect = review.defects.find((item) => item.defectId === findingId);
    return defect?.recommendedRepairPaths[0] ?? defect?.affectedPaths[0] ?? '';
  };
  const existingCandidateId = await latestPairCandidateRevisionId(pairRun.id);
  const existing = existingCandidateId ? await loadFindingDispositions(existingCandidateId, 'PAIR') : [];
  parsed.dispositions = dispositionsForReviewFix({
    body: input.body,
    defects: review.defects,
    pathFor,
    patches: parsed.patches,
    existing
  });
  parsed.dispositionIssues = [];
  const focusFindingId =
    typeof input.body.findingId === 'string' && input.body.findingId.trim()
      ? input.body.findingId.trim()
      : undefined;
  if (focusFindingId) {
    const defect = review.defects.find((item) => item.defectId === focusFindingId);
    if (!defect) {
      return {
        domain: input.domain,
        pairId: input.pairId,
        persisted: false,
        humanApproved: false,
        passed: false,
        pairValidated: false,
        deleted: parsed.deletedIds,
        patchCount: parsed.patches.length,
        gateIssues: [`Disposition refers to unknown finding ${focusFindingId}.`]
      };
    }
    const allowed = defect.recommendedRepairPaths[0] ?? defect.affectedPaths[0] ?? '';
    parsed.patches = parsed.patches.filter((item) => !allowed || item.path === allowed || pathIsAllowed(item.path, [allowed]));
  }
  const currentHash = await currentPairCandidateHash(pairRun.id, input.pairId);
  const stale = staleRevisionIssues(currentHash, parsed.expectedCandidateHash);
  const formIssues = [
    ...stale,
    ...deletedFindingFormIssues(parsed.deletedIds),
    ...parsed.dispositionIssues,
    ...validateFindingDispositions(review.defects, parsed.dispositions)
  ];
  if (formIssues.length) {
    return {
      domain: input.domain,
      pairId: input.pairId,
      persisted: false,
      humanApproved: false,
      passed: false,
      pairValidated: false,
      deleted: parsed.deletedIds,
      patchCount: parsed.patches.length,
      gateIssues: formIssues
    };
  }
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
  const closingPaths = parsed.dispositions
    .filter((item) => isClosingDisposition(item.disposition))
    .flatMap((item) => {
      const defect = review.defects.find((entry) => entry.defectId === item.findingId);
      const path = defect?.recommendedRepairPaths[0] ?? defect?.affectedPaths[0] ?? '';
      return path ? [path] : [];
    });
  const focusedPaths = [...parsed.patches.map((item) => item.path), ...closingPaths];
  const gateIssues = focusedPaths.length ? schemaGateFocused(input.pairId, patched, focusedPaths) : [];
  if (gateIssues.length) {
    return {
      domain: input.domain,
      pairId: input.pairId,
      persisted: false,
      humanApproved: false,
      passed: false,
      pairValidated: false,
      deleted: parsed.deletedIds,
      patchCount: parsed.patches.length,
      gateIssues
    };
  }

  const sealed = await getBaselineSnapshotById(run.baselineSnapshotId);
  if (!sealed) throw new Error('Sealed baseline snapshot is missing.');
  const baseline: BaselineSnapshot = {
    id: sealed.id,
    sha256: sealed.sha256,
    manifest: sealed.manifest as BaselineSnapshot['manifest']
  };
  const plan = buildPairAuthoringPlan({
    domain: input.domain,
    pairId: input.pairId,
    snapshot: baseline,
    targetVersion: pairRun.targetVersion
  });
  const currentPacket = rebuildPairCoherencePacket({
    snapshot: patched as PairCoherenceSnapshot,
    authoringPlan: plan
  });
  const rematerialized = rematerializeHumanReview({
    review,
    packet: currentPacket,
    dispositions: parsed.dispositions,
    savedAt: new Date().toISOString()
  });
  const nextContract = bindPairCoherenceReviewContract(artifact.taskContract, currentPacket);

  const originalState = pairRun.state;
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
    outputHash: canonicalArtifactHash(rematerialized),
    taskContract: nextContract,
    inputHash: pairPacketInputHash(nextContract, currentPacket)
  });
  const outcomes = await persistPairCandidate(
    pairRun.id,
    reviewForNamedGates(rematerialized, parsed.dispositions)
  );
  const candidateId = await latestPairCandidateRevisionId(pairRun.id);
  if (candidateId) {
    await persistFindingDispositions(candidateId, 'PAIR', parsed.dispositions);
  }
  await compileAndRecordCurrentPair({
    pairRunId: pairRun.id,
    pairId: input.pairId,
    domain: input.domain,
    snapshot: patched,
    baseline,
    targetVersion: pairRun.targetVersion,
    reviewNotes: reviewNotesFromReview(rematerialized)
  });
  const parkedForPair = (await getParkedFindings(run.id)).filter((item) => item.pairRunId === pairRun.id);
  let pairValidated = false;
  if (reviewSaveMayValidatePair(pairMayValidate(outcomes), parkedForPair.length)) {
    await markValidated(pairRun.id, current);
    pairValidated = true;
  } else if (parkedForPair.length > 0 && originalState === 'DEFERRED' && current !== 'DEFERRED') {
    if (!canTransition(pairTransitions, current, 'DEFERRED')) {
      throw new Error(`Illegal pair transition ${current} → DEFERRED.`);
    }
    await updatePairState(pairRun.id, 'DEFERRED');
  }
  operatorLog('operator.review.human_approved', {
    domain: input.domain,
    pairId: input.pairId,
    dispositions: parsed.dispositions.map((item) => `${item.findingId}=${item.disposition}`),
    patchCount: parsed.patches.length,
    passed: rematerialized.passed,
    pairValidated,
    parkedOpen: parkedForPair.length,
    pairCoherencePacketSha256: currentPacket.packetSha256
  });
  return {
    domain: input.domain,
    pairId: input.pairId,
    persisted: true,
    humanApproved: true,
    passed: rematerialized.passed,
    pairValidated,
    deleted: parsed.deletedIds,
    patchCount: parsed.patches.length,
    gateIssues: []
  };
}

export function renderPairActions(page: PairReviewPage): string {
  const commandsEnabled = page.commandsEnabled !== false;
  const disabled = commandsEnabled ? '' : ' disabled';
  const sections = page.regenerableSections ?? [];
  const reworkForm = page.reworkAvailable
    ? `<form class="action-form" method="post" action="/api/operator/commands">
        <input type="hidden" name="domain" value="${escapeHtml(page.domain)}">
        <input type="hidden" name="pairId" value="${escapeHtml(page.pairId)}">
        <input type="hidden" name="action" value="rework-with-genai">
        <h3>Rework with GenAI</h3>
        <p class="meta">Run the bounded content-correction loop on the listed defects, then re-check Pair Coherence. Deterministic validation stays the authority; canonical IDs stay code-owned.</p>
        <button type="submit"${disabled}>Rework with GenAI</button>
      </form>`
    : '';
  const regenerateForm = sections.length
    ? `<form class="action-form" method="post" action="/api/operator/commands">
        <input type="hidden" name="domain" value="${escapeHtml(page.domain)}">
        <input type="hidden" name="pairId" value="${escapeHtml(page.pairId)}">
        <input type="hidden" name="action" value="regenerate-section">
        <h3>Regenerate a section</h3>
        <p class="meta">Discard one section's authored content and ask the Maintainer for a fresh attempt. A new revision is authored, then the gates re-run. The model never owns IDs, hashes, or references.</p>
        <label class="field">Section
          <select name="taskType">
            ${sections
              .map((section) => `<option value="${escapeHtml(section)}">${escapeHtml(section)}</option>`)
              .join('')}
          </select>
        </label>
        <button type="submit"${disabled}>Regenerate section fresh</button>
      </form>`
    : '';
  const finalizeForm = `<form class="action-form" method="post" action="/api/operator/commands">
      <input type="hidden" name="domain" value="${escapeHtml(page.domain)}">
      <input type="hidden" name="pairId" value="${escapeHtml(page.pairId)}">
      <input type="hidden" name="action" value="finalize-later">
      <h3>Save &amp; Finalize Later</h3>
      <p class="meta">Park this pair while it waits on an external dependency (for example new legislation or Legal review). Other pairs keep going; the domain stays fail-closed for approval until this is resolved. This defers, it does not waive — BLOCKING source gaps stay non-waivable.</p>
      <label class="field">Owner / category
        <input type="text" name="owner" value="${escapeHtml(DEFAULT_PARK_OWNER)}" required>
      </label>
      <label class="field">Why this pair is parked
        <textarea class="rationale" name="reason" required>${escapeHtml(DEFAULT_PARK_REASON)}</textarea>
      </label>
      <button type="submit"${disabled}>Save &amp; Finalize Later</button>
    </form>`;
  return `<section class="pair-actions">
    <p class="kicker">Actions for this defected object</p>
    ${reworkForm}
    ${regenerateForm}
    ${finalizeForm}
  </section>`;
}

export function renderPairReviewHtml(page: PairReviewPage): string {
  const blockingLabel =
    page.blockingCount === 0
      ? 'No open HIGH/BLOCKING defects remain. Fix, save and continue checks the section you touched plus its handles and references. VALIDATED, READY_FOR_APPROVAL, and publication still require complete schemas, locked vocabulary, and identity. Parked pairs do not block Continue or READY_FOR_APPROVAL.'
      : `${String(page.blockingCount)} open HIGH/BLOCKING defect(s). Use Fix, Maintainer, or Park. Park is the defer status, with a reason. A passing Fix closes the finding automatically. Parked pairs do not block Continue or READY_FOR_APPROVAL.`;
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
    label.field { display:block; margin:.8rem 0; color:var(--ink); }
    select, textarea, input[type="text"] { width:100%; background:#16130f; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:.7rem; font: 13px/1.4 ui-monospace, Menlo, monospace; }
    textarea { min-height:9rem; }
    textarea.rationale { min-height:4.5rem; }
    button {
      appearance:none; border:1px solid var(--brass); background:#2a241c; color:var(--ink);
      border-radius:999px; padding:.5rem 1.1rem; font: inherit; cursor:pointer;
    }
    .fail { color:var(--fail); }
    .actions { display:flex; gap:.8rem; align-items:center; flex-wrap:wrap; margin-top:1rem; }
    .pair-actions { margin-top:2rem; padding-top:1rem; border-top:1px solid var(--line); }
    .action-form { border:1px solid var(--line); border-radius:12px; padding:1rem 1.1rem; margin:0 0 1rem; background:var(--panel); }
    .action-form h3 { color:var(--ink); margin:0 0 .3rem; font-size:1.05rem; }
    .action-form button[disabled] { opacity:.5; cursor:not-allowed; }
    ${reviewPageSharedStyles()}
  </style>
</head>
<body>
  <main>
    <p class="kicker">Human pair approval · domain ${escapeHtml(page.domain)} · ${escapeHtml(page.pairState)}</p>
    <h1>${escapeHtml(page.pairId)}</h1>
    <p class="banner">${escapeHtml(blockingLabel)} This is not domain APPROVED and not a versioned Knowledge Base release.</p>
    ${page.notice ? `<p class="banner">${escapeHtml(page.notice)}</p>` : ''}
    <div id="review-issues" class="banner fail${page.gateIssues.length ? ' is-visible' : ''}"${page.gateIssues.length ? '' : ' hidden'}>${page.gateIssues.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div>
    <p class="meta">${escapeHtml(page.coherenceSummary)}</p>
    <p><a href="/?domain=${escapeHtml(page.domain)}">Operator board</a>
      · <a href="/documents/${escapeHtml(page.domain)}">DRAFT documents</a></p>
    <form id="pair-review-form" method="post" action="/api/operator/commands">
      <input type="hidden" name="domain" value="${escapeHtml(page.domain)}">
      <input type="hidden" name="pairId" value="${escapeHtml(page.pairId)}">
      <input type="hidden" name="action" value="save-pair-review">
      <input type="hidden" name="expectedCandidateHash" value="${escapeHtml(page.candidateHash ?? '')}">
      ${
        page.defects.length
          ? page.defects
              .map((item) => {
                const parkedClass = item.actionStatus === 'PARKED' ? ' is-parked' : '';
                return `<article class="defect${parkedClass}">
        <p class="kicker">${escapeHtml(item.severity)} · ${escapeHtml(item.defectId)} · ${escapeHtml(item.coherenceDimension)}</p>
        ${renderFindingStatus({ status: item.actionStatus ?? 'OPEN', parkReason: item.parkReason })}
        <p>${escapeHtml(item.issue)}</p>
        <p class="meta">${escapeHtml(item.coherenceExpectation)}</p>
        <p class="meta">Path <code>${escapeHtml(item.path || 'none')}</code></p>
        ${
          item.path
            ? `<label class="field">Semantic value at path (JSON)<textarea data-path="${escapeHtml(item.path)}" name="content:${escapeHtml(item.defectId)}">${escapeHtml(item.valueJson)}</textarea></label>`
            : ''
        }
        ${renderFindingActionButtons({
          defectId: item.defectId,
          pairId: page.pairId,
          commandsEnabled: page.commandsEnabled !== false,
          status: item.actionStatus ?? 'OPEN',
          parkReason: item.parkReason
        })}
      </article>`;
              })
              .join('')
          : '<p class="banner">No pair-coherence findings are listed on this revision. Saving still runs a focused check on any section you edit. Empty touched sections cannot be saved. Park remains available below.</p>'
      }
      <div class="actions">
        ${
          page.hasCoherenceReview === false
            ? '<span class="meta">No readable Pair Coherence review yet — edit and Approve is unavailable. Use Regenerate or Save &amp; Finalize Later below.</span>'
            : '<span class="meta">Fix a finding to close it after a focused check, or Park a pair that must wait. Publication still requires complete schemas.</span>'
        }
      </div>
    </form>
    ${renderPairActions(page)}
  </main>
  ${renderReviewClientScript('pair')}
</body>
</html>`;
}
