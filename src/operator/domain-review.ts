import type { DomainId } from '../authoring/authoring-plan.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { DomainCoherencePacket } from '../orchestration/domain-coherence-packet.js';
import { canTransition, domainTransitions, expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  currentDomainCandidateHash,
  getBaselineSnapshotById,
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getPairRuns,
  getParkedFindings,
  latestDomainCandidateRevisionId,
  loadFindingDispositions,
  persistDomainCandidateForHostPair,
  persistFindingDispositions,
  persistPairCandidate,
  replaceCompletedTaskOutput,
  updateDomainState
} from '../orchestration/store.js';
import { domainMayReadyForApproval, staleRevisionIssues } from '../orchestration/named-gates.js';
import { unresolvedParkedApprovalBlock } from './eligibility.js';
import {
  applySnapshotPatches,
  patchedSnapshotRoots,
  pathIsAllowed,
  readSnapshotPath,
  reviewFromUnknown,
  snapshotSlice,
  SNAPSHOT_ROOT_TASK
} from '../repair/qc-repair.js';
import type { RepairPatch } from '../repair/local-repair.js';
import {
  blockingOpenDefects,
  deletedFindingFormIssues,
  dispositionForFinding,
  openDefects,
  parseFindingDispositionDrafts,
  reviewForNamedGates,
  validateFindingDispositions,
  type FindingDispositionDraft,
  type FindingDispositionOrOpen
} from '../repair/finding-dispositions.js';
import {
  bindDomainCoherenceReviewContract,
  bindPairCoherenceReviewContract,
  compileAndRecordCurrentPair,
  currentPairPacketBindings,
  domainPacketInputHash,
  pairPacketInputHash,
  rebuildDomainPacketFromCurrentPairs,
  rebuildPairCoherencePacket,
  rematerializeDomainReviewForCurrentPacket,
  rematerializePairReviewForCurrentPacket,
  reviewNotesFromReview,
  staleDomainPairSnapshotIssues
} from '../repair/revision-aware-repair.js';
import { buildPairAuthoringPlan } from './authoring-context.js';
import type { MaterializedDomainCoherenceDefect, MaterializedDomainCoherenceReview } from '../sir/domain-coherence-materializer.js';
import { operatorCommandsEnabled } from './commands.js';
import { isOpenDomainState } from './eligibility.js';
import { operatorLog } from './log.js';
import { loadPairCoherenceSnapshot } from './qc-repair-command.js';
import { schemaGate } from './schema-gate.js';
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
  disposition: FindingDispositionOrOpen;
  rationale: string;
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
  candidateHash?: string;
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
  dispositions: readonly FindingDispositionDraft[]
): MaterializedDomainCoherenceDefect[] {
  return openDefects(review.defects, dispositions);
}

export function rematerializeHumanDomainReview(input: {
  review: MaterializedDomainCoherenceReview;
  packet: DomainCoherencePacket;
  dispositions: readonly FindingDispositionDraft[];
  savedAt: string;
}): MaterializedDomainCoherenceReview {
  return rematerializeDomainReviewForCurrentPacket(input);
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
    if (value === 'on' || value === 'true' || value === true) ids.push(key.slice('delete:'.length));
  }
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
  const parsedDispositions = parseFindingDispositionDrafts(body, 'OPERATOR');
  return {
    deletedIds: [...new Set(ids)],
    patches,
    expectedCandidateHash,
    dispositions: parsedDispositions.drafts,
    dispositionIssues: parsedDispositions.issues
  };
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
  const candidateId = await latestDomainCandidateRevisionId(run.id);
  const dispositions = candidateId ? await loadFindingDispositions(candidateId, 'DOMAIN') : [];
  const stalePairIssues = staleDomainPairSnapshotIssues(
    lockedDomainPacket(artifact.taskContract, domain),
    await currentPairPacketBindings(pairRuns)
  );
  const blocking = blockingOpenDefects(review.defects, dispositions);
  const defects: DomainReviewDefectView[] = review.defects.map((item) => {
    const domainPath = item.recommendedRepairPaths[0] ?? item.affectedPaths[0] ?? '';
    const mapped = domainPath ? snapshotPathFromDomainPath(domainPath) : undefined;
    const snapshot = mapped ? snapshots.get(mapped.pairId) : undefined;
    const currentValue = mapped && snapshot ? readSnapshotPath(snapshot, mapped.snapshotPath) : undefined;
    const recorded = dispositionForFinding(dispositions, item.defectId);
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
      valueJson: currentValue === undefined ? '' : JSON.stringify(currentValue, null, 2),
      disposition: recorded?.disposition ?? 'OPEN',
      rationale: recorded?.rationale ?? ''
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
    gateIssues: stalePairIssues,
    candidateHash: await currentDomainCandidateHash(domain, pairRuns, artifact.outputHash)
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
  const currentHash = await currentDomainCandidateHash(input.domain, pairRuns, artifact.outputHash);
  const formIssues = [
    ...staleRevisionIssues(currentHash, parsed.expectedCandidateHash),
    ...deletedFindingFormIssues(parsed.deletedIds),
    ...parsed.dispositionIssues,
    ...validateFindingDispositions(review.defects, parsed.dispositions),
    ...staleDomainPairSnapshotIssues(packet, await currentPairPacketBindings(pairRuns))
  ];
  if (formIssues.length) {
    return {
      domain: input.domain,
      persisted: false,
      humanApproved: false,
      passed: false,
      deleted: parsed.deletedIds,
      patchCount: parsed.patches.length,
      gateIssues: formIssues
    };
  }
  const sealed = await getBaselineSnapshotById(run.baselineSnapshotId);
  if (!sealed) throw new Error('Sealed baseline snapshot is missing.');
  const baseline: BaselineSnapshot = {
    id: sealed.id,
    sha256: sealed.sha256,
    manifest: sealed.manifest as BaselineSnapshot['manifest']
  };
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
    const pairArtifact = await getLatestCompletedTaskArtifact(pairRun.id, 'PAIR_COHERENCE_REVIEW');
    if (!pairArtifact) {
      return {
        domain: input.domain,
        persisted: false,
        humanApproved: false,
        passed: false,
        deleted: parsed.deletedIds,
        patchCount: parsed.patches.length,
        gateIssues: [`Domain review cannot use a stale pair snapshot: ${pairRun.pairId} has no Pair Coherence review.`]
      };
    }
    const pairReview = reviewFromUnknown(pairRun.pairId, pairArtifact.output);
    if (!pairReview) {
      return {
        domain: input.domain,
        persisted: false,
        humanApproved: false,
        passed: false,
        deleted: parsed.deletedIds,
        patchCount: parsed.patches.length,
        gateIssues: [`Domain review cannot use a stale pair snapshot: ${pairRun.pairId} Pair Coherence review cannot be read.`]
      };
    }
    const plan = buildPairAuthoringPlan({
      domain: input.domain,
      pairId: pairRun.pairId,
      snapshot: baseline,
      targetVersion: pairRun.targetVersion
    });
    const pairPacket = rebuildPairCoherencePacket({ snapshot: patched, authoringPlan: plan });
    const rematerializedPair = rematerializePairReviewForCurrentPacket({
      review: pairReview,
      packet: pairPacket,
      dispositions: [],
      savedAt: new Date().toISOString()
    });
    const nextPairContract = bindPairCoherenceReviewContract(pairArtifact.taskContract, pairPacket);
    await replaceCompletedTaskOutput({
      pairRunId: pairRun.id,
      taskType: 'PAIR_COHERENCE_REVIEW',
      output: rematerializedPair,
      outputHash: canonicalArtifactHash(rematerializedPair),
      taskContract: nextPairContract,
      inputHash: pairPacketInputHash(nextPairContract, pairPacket)
    });
    await persistPairCandidate(pairRun.id, rematerializedPair);
    await compileAndRecordCurrentPair({
      pairRunId: pairRun.id,
      pairId: pairRun.pairId,
      domain: input.domain,
      snapshot: patched,
      baseline,
      targetVersion: pairRun.targetVersion,
      reviewNotes: reviewNotesFromReview(rematerializedPair)
    });
  }

  let currentPacket: DomainCoherencePacket;
  try {
    currentPacket = await rebuildDomainPacketFromCurrentPairs({
      domain: input.domain,
      pairRuns,
      baseline
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      domain: input.domain,
      persisted: false,
      humanApproved: false,
      passed: false,
      deleted: parsed.deletedIds,
      patchCount: parsed.patches.length,
      gateIssues: [message]
    };
  }
  const rematerialized = rematerializeHumanDomainReview({
    review,
    packet: currentPacket,
    dispositions: parsed.dispositions,
    savedAt: new Date().toISOString()
  });
  const nextDomainContract = bindDomainCoherenceReviewContract(artifact.taskContract, currentPacket);
  await replaceCompletedTaskOutput({
    pairRunId: hostPair.id,
    taskType: 'DOMAIN_COHERENCE_REVIEW',
    output: rematerialized,
    outputHash: canonicalArtifactHash(rematerialized),
    taskContract: nextDomainContract,
    inputHash: domainPacketInputHash(nextDomainContract, currentPacket)
  });
  const outcomes = await persistDomainCandidateForHostPair(
    hostPair.id,
    reviewForNamedGates(rematerialized, parsed.dispositions)
  );
  const domainCandidateId = await latestDomainCandidateRevisionId(run.id);
  if (domainCandidateId) {
    await persistFindingDispositions(domainCandidateId, 'DOMAIN', parsed.dispositions);
  }
  if (domainMayReadyForApproval(outcomes)) {
    const parked = await getParkedFindings(run.id);
    if (!unresolvedParkedApprovalBlock(parked.length)) {
      await markDomainReady(run.id, run.state);
    }
  }
  operatorLog('operator.domain_review.human_approved', {
    domain: input.domain,
    dispositions: parsed.dispositions.map((item) => `${item.findingId}=${item.disposition}`),
    patchCount: parsed.patches.length,
    passed: rematerialized.passed,
    domainCoherencePacketSha256: currentPacket.packetSha256
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
      ? 'No open HIGH/BLOCKING domain defects remain. Approve and save still checks complete section schemas, handles, identity, and the reference graph. Empty sections cannot be saved. Findings stay listed; closing them requires an explicit disposition.'
      : `${String(page.blockingCount)} open HIGH/BLOCKING domain defect(s). Edit semantic content and record RESOLVED, WAIVED, ACCEPTED_RISK, or REJECTED with rationale. Deleting a finding from the form does not close it. After you approve, the next check is complete section schemas, handles, identity, and the reference graph. Empty sections cannot be saved.`;
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
    label.field { display:block; margin:.8rem 0; color:var(--ink); }
    select, textarea { width:100%; background:#16130f; color:var(--ink); border:1px solid var(--line); border-radius:8px; padding:.7rem; font: 13px/1.4 ui-monospace, Menlo, monospace; }
    textarea { min-height:9rem; }
    textarea.rationale { min-height:4.5rem; }
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
      <input type="hidden" name="expectedCandidateHash" value="${escapeHtml(page.candidateHash ?? '')}">
      ${
        page.defects.length
          ? page.defects
              .map((item) => {
                const waivable = item.severity !== 'BLOCKING';
                return `<article class="defect">
        <p class="kicker">${escapeHtml(item.severity)} · ${escapeHtml(item.defectId)} · ${escapeHtml(item.pairId)} · ${escapeHtml(item.coherenceDimension)}</p>
        <p>${escapeHtml(item.issue)}</p>
        <p class="meta">${escapeHtml(item.coherenceExpectation)}</p>
        <p class="meta">Path <code>${escapeHtml(item.domainPath || 'none')}</code></p>
        <label class="field">Disposition for this revision
          <select data-disposition-finding="${escapeHtml(item.defectId)}" name="disposition:${escapeHtml(item.defectId)}">
            <option value="OPEN"${item.disposition === 'OPEN' ? ' selected' : ''}>OPEN — still a finding on this revision</option>
            <option value="RESOLVED"${item.disposition === 'RESOLVED' ? ' selected' : ''}>RESOLVED</option>
            ${
              waivable
                ? `<option value="WAIVED"${item.disposition === 'WAIVED' ? ' selected' : ''}>WAIVED</option>
            <option value="ACCEPTED_RISK"${item.disposition === 'ACCEPTED_RISK' ? ' selected' : ''}>ACCEPTED_RISK</option>`
                : ''
            }
            <option value="REJECTED"${item.disposition === 'REJECTED' ? ' selected' : ''}>REJECTED — remains open</option>
          </select>
        </label>
        <label class="field">Disposition rationale (required unless OPEN)
          <textarea class="rationale" data-rationale-finding="${escapeHtml(item.defectId)}" name="rationale:${escapeHtml(item.defectId)}">${escapeHtml(item.rationale)}</textarea>
        </label>
        ${
          item.snapshotPath
            ? `<label class="field">Semantic value at path (JSON)<textarea data-pair-id="${escapeHtml(item.pairId)}" data-path="${escapeHtml(item.snapshotPath)}" name="content:${escapeHtml(item.defectId)}">${escapeHtml(item.valueJson)}</textarea></label>`
            : ''
        }
      </article>`;
              })
              .join('')
          : '<p class="banner">No domain-coherence findings are listed on this revision. Approve and save still checks complete section schemas and the reference graph. Empty sections cannot be saved.</p>'
      }
      <div class="actions">
        <button type="submit">Approve and save</button>
        <span class="meta">Human approval of these domain edits and dispositions. Next check is complete section schemas, handles, identity, and the reference graph.</span>
      </div>
    </form>
  </main>
  <script>
  (function () {
    var form = document.getElementById('domain-review-form');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var dispositions = [];
      form.querySelectorAll('select[data-disposition-finding]').forEach(function (select) {
        var findingId = select.getAttribute('data-disposition-finding');
        var disposition = select.value;
        if (!findingId || disposition === 'OPEN') return;
        var rationaleArea = form.querySelector('textarea[data-rationale-finding="' + findingId + '"]');
        dispositions.push({
          findingId: findingId,
          disposition: disposition,
          authority: 'OPERATOR',
          rationale: rationaleArea ? String(rationaleArea.value || '') : ''
        });
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
        expectedCandidateHash: form.querySelector('[name="expectedCandidateHash"]').value,
        findingDispositions: dispositions,
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
            ? 'Human approved. Section schema and reference-graph gate passed. Recorded dispositions are bound to this candidate revision. Domain Coherence now passes.'
            : 'Human approved the saved edits. Section schema and reference-graph gate passed. Open HIGH domain blockers still remain.';
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
