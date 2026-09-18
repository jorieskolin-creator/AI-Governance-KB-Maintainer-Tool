import type { DomainId } from '../authoring/authoring-plan.js';
import { compileGateResult, compileSirPair } from '../compiler/sir-compiler.js';
import { SNAPSHOT_ROOT_TASK } from '../repair/qc-repair.js';
import { loadCategoriesBaseline } from '../baseline/categories.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { expectedDomainPairIds } from '../orchestration/pipeline.js';
import { isSourceContextPacket } from '../orchestration/source-context-packet.js';
import {
  currentDomainCandidateHash,
  currentPairCandidateHash,
  getBaselineSnapshotById,
  getCandidateRevisionIdByHash,
  getLatestCompletedTaskArtifact,
  getLatestDomainRun,
  getPairRuns,
  loadFrozenApprovalBundle,
  loadNamedGateResults,
  persistFrozenApprovalBundle,
  recordPairNamedGates,
  getParkedFindings,
  type PairRunRecord
} from '../orchestration/store.js';
import { sha256Utf8 } from '../orchestration/artifact-hash.js';
import { STALE_REVISION_ISSUE } from '../orchestration/named-gates.js';
import { unresolvedParkedApprovalBlock } from '../operator/eligibility.js';
import { buildPairAuthoringPlan } from '../operator/authoring-context.js';
import {
  APPROVAL_BUNDLE_KIND,
  approvalBundleSha256,
  assertCurrentApprovalCandidate,
  buildApprovalBundle,
  releaseBaselineFromPlan,
  type ApprovalBundle,
  type ApprovalBundlePayload,
  type BuiltApprovalBundle
} from './approval-bundle.js';

export interface ApprovalBundleView {
  ok: true;
  current: true;
  domainRunId: string;
  domainCandidateHash: string;
  bundle: ApprovalBundle;
  bundleSha256: string;
  payloads: Record<string, ApprovalBundlePayload>;
}

export interface ApprovalBundleFailure {
  ok: false;
  current: boolean;
  domainCandidateHash?: string;
  issues: string[];
}

async function loadPersistedSirSnapshot(pairRunId: string): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  for (const [root, taskType] of Object.entries(SNAPSHOT_ROOT_TASK)) {
    const artifact = await getLatestCompletedTaskArtifact(pairRunId, taskType);
    if (artifact) snapshot[root] = artifact.output;
  }
  return snapshot;
}

export function isApprovalBundlePayloadMap(value: unknown): value is Record<string, ApprovalBundlePayload> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const rec = item as Record<string, unknown>;
    return typeof rec.contentType === 'string' && typeof rec.utf8 === 'string';
  });
}

export function parseFrozenApprovalBundle(value: unknown): ApprovalBundle | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const rec = value as ApprovalBundle;
  if (rec.documentKind !== APPROVAL_BUNDLE_KIND) return undefined;
  if (rec.approval !== 'NOT_GRANTED' || rec.releaseStatus !== 'DRAFT') return undefined;
  if (typeof rec.domainCandidateHash !== 'string' || typeof rec.proposedManifestSha256 !== 'string') {
    return undefined;
  }
  return rec;
}

export function verifyFrozenApprovalBundlePayloads(
  bundle: ApprovalBundle,
  payloads: Record<string, ApprovalBundlePayload>
): string[] {
  const issues: string[] = [];
  for (const render of bundle.renders) {
    const payload = payloads[render.sha256];
    if (!payload) {
      issues.push(`Frozen payload missing for ${render.path}.`);
      continue;
    }
    if (payload.contentType !== render.contentType) {
      issues.push(`Frozen content type drifted for ${render.path}.`);
    }
    if (sha256Utf8(payload.utf8) !== render.sha256) {
      issues.push(`Frozen bytes do not match render sha256 for ${render.path}.`);
    }
  }
  return issues;
}

async function sourcePacketHash(pairRunId: string): Promise<string | null> {
  const artifact = await getLatestCompletedTaskArtifact(pairRunId, 'SOURCE_CONTEXT');
  if (!isSourceContextPacket(artifact?.output)) return null;
  return artifact.output.packetSha256;
}

export async function assembleDomainApprovalBundle(input: {
  domain: DomainId;
  expectedDomainCandidateHash?: string;
}): Promise<ApprovalBundleView | ApprovalBundleFailure> {
  const run = await getLatestDomainRun(input.domain);
  if (!run) {
    return { ok: false, current: false, issues: [`No domain ${input.domain} run exists.`] };
  }
  const parked = await getParkedFindings(run.id);
  const parkedBlock = unresolvedParkedApprovalBlock(parked.length);
  if (parkedBlock) {
    return { ok: false, current: true, issues: [parkedBlock] };
  }
  const pairRuns = await getPairRuns(run.id);
  const hostPairId = expectedDomainPairIds(input.domain)[0];
  const host = pairRuns.find((item) => item.pairId === hostPairId);
  const domainArtifact = host
    ? await getLatestCompletedTaskArtifact(host.id, 'DOMAIN_COHERENCE_REVIEW')
    : undefined;
  if (!host || !domainArtifact?.outputHash) {
    return {
      ok: false,
      current: false,
      issues: [`Domain ${input.domain} has no domain candidate revision. DOMAIN_COHERENCE_REVIEW must complete first.`]
    };
  }

  const domainCandidateHash = await currentDomainCandidateHash(
    input.domain,
    pairRuns,
    domainArtifact.outputHash
  );
  const stale = assertCurrentApprovalCandidate(domainCandidateHash, input.expectedDomainCandidateHash);
  if (stale.length > 0) {
    return { ok: false, current: false, domainCandidateHash, issues: stale };
  }
  if (run.state !== 'READY_FOR_APPROVAL') {
    return {
      ok: false,
      current: true,
      domainCandidateHash,
      issues: [
        `Domain ${input.domain} is ${run.state}, not READY_FOR_APPROVAL. The approval bundle stays closed.`
      ]
    };
  }

  const frozen = await loadFrozenApprovalBundle(domainCandidateHash);
  if (frozen) {
    const bundle = parseFrozenApprovalBundle(frozen.bundle);
    if (!bundle || !isApprovalBundlePayloadMap(frozen.payloads)) {
      return {
        ok: false,
        current: true,
        domainCandidateHash,
        issues: ['The stored approval bundle is not a valid APPROVAL_BUNDLE document.']
      };
    }
    if (bundle.domainCandidateHash !== domainCandidateHash) {
      return {
        ok: false,
        current: false,
        domainCandidateHash,
        issues: [STALE_REVISION_ISSUE]
      };
    }
    const recomputed = approvalBundleSha256(bundle);
    if (recomputed !== frozen.bundleSha256) {
      return {
        ok: false,
        current: true,
        domainCandidateHash,
        issues: ['Stored approval bundle hash does not match the frozen document.']
      };
    }
    const payloadIssues = verifyFrozenApprovalBundlePayloads(bundle, frozen.payloads);
    if (payloadIssues.length > 0) {
      return { ok: false, current: true, domainCandidateHash, issues: payloadIssues };
    }
    return {
      ok: true,
      current: true,
      domainRunId: run.id,
      domainCandidateHash,
      bundle,
      bundleSha256: frozen.bundleSha256,
      payloads: frozen.payloads
    };
  }

  const domainCandidateRevisionId = await getCandidateRevisionIdByHash({
    scope: 'DOMAIN',
    domainRunId: run.id,
    revisionHash: domainCandidateHash
  });
  if (!domainCandidateRevisionId) {
    return {
      ok: false,
      current: true,
      domainCandidateHash,
      issues: ['The current domain candidate revision has not been recorded.']
    };
  }
  const domainGates = await loadNamedGateResults(domainCandidateRevisionId);
  if (!domainGates.some((gate) => gate.outcome === 'READY_FOR_APPROVAL')) {
    return {
      ok: false,
      current: true,
      domainCandidateHash,
      issues: ['The current domain candidate is missing READY_FOR_APPROVAL.']
    };
  }

  const sealed = await getBaselineSnapshotById(run.baselineSnapshotId);
  if (!sealed) {
    return { ok: false, current: true, domainCandidateHash, issues: ['Sealed baseline snapshot is missing.'] };
  }
  const snapshot: BaselineSnapshot = {
    id: sealed.id,
    sha256: sealed.sha256,
    manifest: sealed.manifest as BaselineSnapshot['manifest']
  };
  const categories = loadCategoriesBaseline();
  const pairCandidates = [];
  const issues: string[] = [];
  let domainReleaseVersion: string | undefined;

  for (const pairId of expectedDomainPairIds(input.domain)) {
    const pairRun = pairRuns.find((item): item is PairRunRecord => item.pairId === pairId);
    if (!pairRun || pairRun.state !== 'VALIDATED') {
      issues.push(`${pairId} is ${pairRun?.state ?? 'missing'}; approval bundle requires VALIDATED.`);
      continue;
    }
    if (domainReleaseVersion && domainReleaseVersion !== pairRun.targetVersion) {
      issues.push(
        `Pair target versions diverge (${domainReleaseVersion} vs ${pairRun.targetVersion}); the proposed manifest cannot be hashed.`
      );
      continue;
    }
    domainReleaseVersion = pairRun.targetVersion;
    const persisted = await loadPersistedSirSnapshot(pairRun.id);
    const compiled = await compileSirPair({
      authoringPlan: buildPairAuthoringPlan({
        domain: input.domain,
        pairId,
        snapshot,
        categories,
        targetVersion: pairRun.targetVersion
      }),
      snapshot: persisted,
      mode: 'DRAFT'
    });
    const compileGate = compileGateResult(compiled);
    await recordPairNamedGates(pairRun.id, [compileGate]);
    if (!compiled.ok || !compiled.capability || !compiled.antipattern) {
      issues.push(
        compiled.defects.map((item) => item.issue).join(' ') || `${pairId} failed canonical compile.`
      );
      continue;
    }
    const pairCandidateHash = await currentPairCandidateHash(pairRun.id, pairId);
    const pairCandidateId = await getCandidateRevisionIdByHash({
      scope: 'PAIR',
      pairRunId: pairRun.id,
      revisionHash: pairCandidateHash
    });
    const existingGates = pairCandidateId ? await loadNamedGateResults(pairCandidateId) : [];
    pairCandidates.push({
      pairId,
      pairCandidateHash,
      sourceContextPacketSha256: await sourcePacketHash(pairRun.id),
      capability: compiled.capability,
      antipattern: compiled.antipattern,
      gates: existingGates.some((gate) => gate.gateName === 'CANONICAL_COMPILE')
        ? existingGates
        : [...existingGates, compileGate]
    });
  }

  if (issues.length > 0 || pairCandidates.length !== expectedDomainPairIds(input.domain).length) {
    return { ok: false, current: true, domainCandidateHash, issues };
  }
  if (!domainReleaseVersion) {
    return { ok: false, current: true, domainCandidateHash, issues: ['Domain release version is missing.'] };
  }

  const plan = buildPairAuthoringPlan({
    domain: input.domain,
    pairId: host.pairId,
    snapshot,
    categories,
    targetVersion: host.targetVersion
  });

  let built: BuiltApprovalBundle;
  try {
    built = buildApprovalBundle({
      domain: input.domain,
      domainCandidateHash,
      domainReleaseVersion,
      baseline: releaseBaselineFromPlan(plan),
      pairCandidates,
      domainGates,
      expectedDomainCandidateHash: domainCandidateHash
    });
  } catch (error) {
    return {
      ok: false,
      current: true,
      domainCandidateHash,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }

  for (const [index, pair] of pairCandidates.entries()) {
    const pairRun = pairRuns.find((item) => item.pairId === pair.pairId);
    const parity = built.pairParityGates[index];
    if (pairRun && parity) await recordPairNamedGates(pairRun.id, [parity]);
  }

  const stored = await persistFrozenApprovalBundle({
    domainRunId: run.id,
    domainCandidateRevisionId,
    domainCandidateHash,
    bundle: built.bundle,
    bundleSha256: built.bundleSha256,
    payloads: built.payloads
  });
  const storedBundle = parseFrozenApprovalBundle(stored.bundle);
  if (!storedBundle || !isApprovalBundlePayloadMap(stored.payloads) || stored.bundleSha256 !== built.bundleSha256) {
    return {
      ok: false,
      current: true,
      domainCandidateHash,
      issues: ['Persisted approval bundle could not be verified against the computed hash.']
    };
  }

  return {
    ok: true,
    current: true,
    domainRunId: run.id,
    domainCandidateHash,
    bundle: storedBundle,
    bundleSha256: stored.bundleSha256,
    payloads: stored.payloads
  };
}
