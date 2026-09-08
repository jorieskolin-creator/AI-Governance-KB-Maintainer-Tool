import {
  manifestSha256,
  proposedManifestSha256,
  validateReleaseManifest,
  type DomainReleaseManifest,
  type ReleaseApprovalIdentity
} from './manifest.js';
import {
  approvalBundleSha256,
  APPROVAL_BUNDLE_KIND,
  type ApprovalBundle,
  type ApprovalBundlePayload
} from './approval-bundle.js';
import { renderCanonicalObject } from './canonical-render.js';

export const OPERATOR_APPROVAL_ROLE = 'OPERATOR' as const;

export interface RecordOperatorApprovalInput {
  domainCandidateHash: string;
  approvalBundleSha256: string;
  proposedManifestSha256: string;
  approvalReference: string;
  effectiveFrom: string;
  approvedOn: string;
}

export interface RecordedOperatorApproval {
  domainCandidateHash: string;
  approvalBundleSha256: string;
  proposedManifestSha256: string;
  releaseManifest: DomainReleaseManifest;
  releaseManifestSha256: string;
  releasePayloads: Record<string, ApprovalBundlePayload>;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function sha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function date(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new Error(`${label} must be an ISO date (YYYY-MM-DD).`);
  }
  return value;
}

function timestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error('approvedOn must be an ISO timestamp.');
  }
  return new Date(value).toISOString();
}

function approvalIdentity(input: RecordOperatorApprovalInput): ReleaseApprovalIdentity {
  const approvedOn = timestamp(input.approvedOn);
  return {
    approval_reference: required(input.approvalReference, 'Approval reference'),
    approved_by_role: OPERATOR_APPROVAL_ROLE,
    approved_on: approvedOn.slice(0, 10),
    effective_from: date(input.effectiveFrom, 'Effective-from date')
  };
}

function approvalRecord(input: {
  object: Record<string, unknown>;
  approval: ReleaseApprovalIdentity;
  domain: string;
  approvalBundleSha256: string;
}): Record<string, unknown> {
  const version = required(String(input.object.version ?? ''), 'Canonical object version');
  const objectId = required(String(input.object.id ?? ''), 'Canonical object id');
  return {
    approval_status: 'APPROVED',
    approval_scope: `Domain ${input.domain} release for ${objectId}`,
    approved_by_role: input.approval.approved_by_role,
    approved_on: input.approval.approved_on,
    effective_from: input.approval.effective_from,
    review_due_on: null,
    release_version: version,
    supersedes: null,
    authority_statement: `Standalone operator approval recorded against immutable approval bundle ${input.approvalBundleSha256}.`,
    change_control: 'Publication is permitted only from the approved immutable manifest and exact rendered artifact hashes.'
  };
}

function parseCanonicalPayload(
  payloads: Record<string, ApprovalBundlePayload>,
  sha: string,
  path: string
): Record<string, unknown> {
  const payload = payloads[sha];
  if (!payload || payload.contentType !== 'application/json') {
    throw new Error(`Approval bundle has no canonical JSON payload for ${path}.`);
  }
  try {
    const parsed: unknown = JSON.parse(payload.utf8);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Approval bundle canonical JSON is invalid for ${path}.`);
  }
}

function renderedArtifact(input: {
  artifact: DomainReleaseManifest['pairs'][number]['artifacts'][number];
  object: Record<string, unknown>;
}): {
  artifact: DomainReleaseManifest['pairs'][number]['artifacts'][number];
  payload: ApprovalBundlePayload;
} {
  const rendered = renderCanonicalObject(input.object);
  const target = input.artifact.content_type === 'application/json' ? rendered.json : rendered.html;
  if (input.artifact.object_id !== target.objectId || target.contentType !== input.artifact.content_type) {
    throw new Error(`Approved render identity or content type drifted for ${input.artifact.path}.`);
  }
  if (rendered.parityDefects.length > 0) {
    throw new Error(`Approved render parity failed for ${target.objectId}.`);
  }
  return {
    artifact: {
      ...input.artifact,
      version: String(input.object.version ?? ''),
      sha256: target.sha256
    },
    payload: { contentType: target.contentType, utf8: target.utf8 }
  };
}

export function recordOperatorApproval(
  bundle: ApprovalBundle,
  frozenPayloads: Record<string, ApprovalBundlePayload>,
  input: RecordOperatorApprovalInput
): RecordedOperatorApproval {
  if (bundle.documentKind !== APPROVAL_BUNDLE_KIND) {
    throw new Error('Approval record requires an APPROVAL_BUNDLE document.');
  }
  if (bundle.approval !== 'NOT_GRANTED' || bundle.releaseStatus !== 'DRAFT') {
    throw new Error('Approval record requires an unapproved DRAFT approval bundle.');
  }

  const domainCandidateHash = sha256(input.domainCandidateHash, 'Domain candidate hash');
  const bundleHash = sha256(input.approvalBundleSha256, 'Approval bundle hash');
  const proposedHash = sha256(input.proposedManifestSha256, 'Proposed manifest hash');
  if (bundle.domainCandidateHash !== domainCandidateHash) {
    throw new Error('Approval candidate hash does not match the frozen approval bundle.');
  }
  if (approvalBundleSha256(bundle) !== bundleHash) {
    throw new Error('Approval bundle hash does not match the frozen approval bundle.');
  }
  if (bundle.proposedManifestSha256 !== proposedHash) {
    throw new Error('Proposed manifest hash does not match the frozen approval bundle.');
  }
  if (proposedManifestSha256(bundle.proposedManifest) !== proposedHash) {
    throw new Error('Proposed manifest hash does not match the frozen proposed manifest.');
  }

  const approval = approvalIdentity(input);
  const releasePayloads: Record<string, ApprovalBundlePayload> = {};
  const pairs = bundle.proposedManifest.pairs.map((pair) => {
    const canonicalObjects = new Map<string, Record<string, unknown>>();
    for (const artifact of pair.artifacts.filter((item) => item.content_type === 'application/json')) {
      const source = parseCanonicalPayload(frozenPayloads, artifact.sha256, artifact.path);
      const approved: Record<string, unknown> = {
        ...source,
        release_status: 'APPROVED',
        approval_record: approvalRecord({
          object: source,
          approval,
          domain: bundle.domain,
          approvalBundleSha256: bundleHash
        })
      };
      canonicalObjects.set(String(approved.id ?? ''), approved);
    }
    const artifacts = pair.artifacts.map((artifact) => {
      const object = canonicalObjects.get(String(artifact.object_id ?? ''));
      if (!object) throw new Error(`Approval bundle is missing canonical JSON for ${artifact.path}.`);
      const rendered = renderedArtifact({ artifact, object });
      const existing = releasePayloads[rendered.artifact.sha256];
      if (existing && existing.utf8 !== rendered.payload.utf8) {
        throw new Error(`SHA-256 collision while preparing ${rendered.artifact.path}.`);
      }
      releasePayloads[rendered.artifact.sha256] = rendered.payload;
      return rendered.artifact;
    });
    return { ...pair, artifacts };
  });
  const releaseManifest: DomainReleaseManifest = {
    manifest_version: bundle.proposedManifest.manifest_version,
    domain: bundle.proposedManifest.domain,
    domain_release_version: bundle.proposedManifest.domain_release_version,
    baseline: bundle.proposedManifest.baseline,
    external_approval: approval,
    pairs,
    created_at: timestamp(input.approvedOn)
  };
  validateReleaseManifest(releaseManifest);

  return {
    domainCandidateHash,
    approvalBundleSha256: bundleHash,
    proposedManifestSha256: proposedHash,
    releaseManifest,
    releaseManifestSha256: manifestSha256(releaseManifest),
    releasePayloads
  };
}
