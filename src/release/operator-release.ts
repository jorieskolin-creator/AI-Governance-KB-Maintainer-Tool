import type { DomainId } from '../authoring/authoring-plan.js';
import {
  beginPublicationJob,
  completePublicationJob,
  currentDomainCandidateHash,
  failPublicationJob,
  getDomainRunById,
  getLatestCompletedTaskArtifact,
  getPairRuns,
  loadDomainApprovalForCandidate,
  loadFrozenApprovalBundle,
  recordDomainNamedGates,
  persistDomainApproval
} from '../orchestration/store.js';
import {
  GATE_VALIDATOR_VERSION,
  STALE_REVISION_ISSUE,
  type NamedGateResult
} from '../orchestration/named-gates.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import {
  assembleDomainApprovalBundle,
  isApprovalBundlePayloadMap,
  parseFrozenApprovalBundle,
  verifyFrozenApprovalBundlePayloads
} from './assemble-approval-bundle.js';
import { publishFrozenRelease, type PublishedFrozenRelease } from './frozen-publisher.js';
import { recordOperatorApproval } from './operator-approval.js';
import { loadStoredRelease } from './store.js';

export interface RecordApprovalCommand {
  domain: DomainId;
  domainCandidateHash: string;
  approvalBundleSha256: string;
  proposedManifestSha256: string;
  approvalReference: string;
  effectiveFrom: string;
}

export interface RecordedApprovalResult {
  domainRunId: string;
  domainCandidateHash: string;
  releaseManifestSha256: string;
  approvalReference: string;
  approvedOn: string;
  idempotent: boolean;
}

export interface PublishApprovedReleaseCommand {
  domain: DomainId;
  domainCandidateHash: string;
  approvalBundleSha256: string;
  releaseManifestSha256: string;
  artifactStore?: ArtifactStore;
}

async function assertCurrentDomainCandidate(input: {
  domain: DomainId;
  domainRunId: string;
  expectedDomainCandidateHash: string;
}): Promise<void> {
  const run = await getDomainRunById(input.domainRunId);
  if (!run || run.domain !== input.domain) {
    throw new Error('Approved domain run is no longer available for this domain.');
  }
  const pairRuns = await getPairRuns(run.id);
  const host = pairRuns.find((pair) => pair.pairId === `${input.domain}1_AP-${input.domain}1`);
  const review = host
    ? await getLatestCompletedTaskArtifact(host.id, 'DOMAIN_COHERENCE_REVIEW')
    : undefined;
  if (!review?.outputHash) {
    throw new Error(STALE_REVISION_ISSUE);
  }
  const current = await currentDomainCandidateHash(input.domain, pairRuns, review.outputHash);
  if (current !== input.expectedDomainCandidateHash) {
    throw new Error(STALE_REVISION_ISSUE);
  }
}

function approvalGate(): NamedGateResult {
  return {
    gateName: 'APPROVAL',
    outcome: 'APPROVED',
    validatorVersion: GATE_VALIDATOR_VERSION,
    findings: []
  };
}

function publicationGate(): NamedGateResult {
  return {
    gateName: 'PUBLICATION',
    outcome: 'PUBLISHED',
    validatorVersion: GATE_VALIDATOR_VERSION,
    findings: []
  };
}

export async function recordApproval(
  command: RecordApprovalCommand,
  now = () => new Date().toISOString()
): Promise<RecordedApprovalResult> {
  const previouslyRecorded = await loadDomainApprovalForCandidate({
    domain: command.domain,
    domainCandidateHash: command.domainCandidateHash
  });
  if (previouslyRecorded) {
    if (
      previouslyRecorded.approvalBundleSha256 !== command.approvalBundleSha256 ||
      previouslyRecorded.proposedManifestSha256 !== command.proposedManifestSha256 ||
      previouslyRecorded.approvalReference !== command.approvalReference ||
      previouslyRecorded.effectiveFrom !== command.effectiveFrom
    ) {
      throw new Error('Domain candidate already has a different recorded approval.');
    }
    return {
      domainRunId: previouslyRecorded.domainRunId,
      domainCandidateHash: previouslyRecorded.domainCandidateHash,
      releaseManifestSha256: previouslyRecorded.releaseManifestSha256,
      approvalReference: previouslyRecorded.approvalReference,
      approvedOn: previouslyRecorded.approvedOn,
      idempotent: true
    };
  }

  const view = await assembleDomainApprovalBundle({
    domain: command.domain,
    expectedDomainCandidateHash: command.domainCandidateHash
  });
  if (!view.ok) throw new Error(view.issues.join(' '));
  if (
    view.bundleSha256 !== command.approvalBundleSha256 ||
    view.bundle.proposedManifestSha256 !== command.proposedManifestSha256
  ) {
    throw new Error(STALE_REVISION_ISSUE);
  }

  const decision = recordOperatorApproval(view.bundle, view.payloads, {
    domainCandidateHash: command.domainCandidateHash,
    approvalBundleSha256: command.approvalBundleSha256,
    proposedManifestSha256: command.proposedManifestSha256,
    approvalReference: command.approvalReference,
    effectiveFrom: command.effectiveFrom,
    approvedOn: now()
  });
  const approval = await persistDomainApproval({
    domainRunId: view.domainRunId,
    domainCandidateHash: decision.domainCandidateHash,
    approvalBundleSha256: decision.approvalBundleSha256,
    proposedManifestSha256: decision.proposedManifestSha256,
    releaseManifest: decision.releaseManifest,
    releasePayloads: decision.releasePayloads,
    releaseManifestSha256: decision.releaseManifestSha256,
    approvalReference: decision.releaseManifest.external_approval.approval_reference,
    approvedByRole: decision.releaseManifest.external_approval.approved_by_role as 'OPERATOR',
    approvedOn: decision.releaseManifest.external_approval.approved_on,
    effectiveFrom: decision.releaseManifest.external_approval.effective_from
  });
  await recordDomainNamedGates(approval.domainRunId, approval.domainCandidateHash, [approvalGate()]);
  return {
    domainRunId: approval.domainRunId,
    domainCandidateHash: approval.domainCandidateHash,
    releaseManifestSha256: approval.releaseManifestSha256,
    approvalReference: approval.approvalReference,
    approvedOn: approval.approvedOn,
    idempotent: false
  };
}

export async function publishApprovedRelease(
  command: PublishApprovedReleaseCommand
): Promise<PublishedFrozenRelease & { idempotent: boolean }> {
  const approval = await loadDomainApprovalForCandidate({
    domain: command.domain,
    domainCandidateHash: command.domainCandidateHash
  });
  if (!approval) throw new Error('No recorded approval exists for this domain candidate.');
  if (
    approval.approvalBundleSha256 !== command.approvalBundleSha256 ||
    approval.releaseManifestSha256 !== command.releaseManifestSha256
  ) {
    throw new Error(STALE_REVISION_ISSUE);
  }
  await assertCurrentDomainCandidate({
    domain: command.domain,
    domainRunId: approval.domainRunId,
    expectedDomainCandidateHash: approval.domainCandidateHash
  });

  const frozen = await loadFrozenApprovalBundle(approval.domainCandidateHash);
  const bundle = frozen ? parseFrozenApprovalBundle(frozen.bundle) : undefined;
  if (
    !frozen ||
    !bundle ||
    !isApprovalBundlePayloadMap(frozen.payloads) ||
    frozen.bundleSha256 !== approval.approvalBundleSha256 ||
    bundle.proposedManifestSha256 !== approval.proposedManifestSha256
  ) {
    throw new Error('Recorded approval no longer has its verified frozen approval bundle.');
  }
  const payloadIssues = verifyFrozenApprovalBundlePayloads(bundle, frozen.payloads);
  if (payloadIssues.length > 0) throw new Error(payloadIssues.join(' '));

  const job = await beginPublicationJob({
    domainRunId: approval.domainRunId,
    domainApprovalId: approval.id,
    releaseManifestSha256: approval.releaseManifestSha256
  });
  if (job.state === 'PUBLISHED' && job.releaseId) {
    const stored = await loadStoredRelease({
      domainRunId: approval.domainRunId,
      manifestSha256: approval.releaseManifestSha256
    });
    return {
      releaseId: job.releaseId,
      manifest: approval.releaseManifest,
      manifestSha256: approval.releaseManifestSha256,
      manifestUrl: stored?.manifestUrl ?? '',
      artifactStorageUris: stored?.artifactStorageUris ?? {},
      idempotent: true
    };
  }

  let published: PublishedFrozenRelease;
  try {
    published = await publishFrozenRelease({
      domainRunId: approval.domainRunId,
      manifest: approval.releaseManifest,
      manifestSha256: approval.releaseManifestSha256,
      payloads: approval.releasePayloads,
      artifactStore: command.artifactStore
    });
    await completePublicationJob({
      jobId: job.id,
      domainRunId: approval.domainRunId,
      releaseManifestSha256: approval.releaseManifestSha256,
      releaseId: published.releaseId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failPublicationJob({ jobId: job.id, domainRunId: approval.domainRunId, error: message });
    throw new Error(`Publication failed for approved manifest ${approval.releaseManifestSha256}: ${message}`);
  }
  await recordDomainNamedGates(approval.domainRunId, approval.domainCandidateHash, [publicationGate()]);
  return { ...published, idempotent: false };
}
