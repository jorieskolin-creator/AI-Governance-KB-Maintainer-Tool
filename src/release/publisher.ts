import { createHash } from 'node:crypto';
import type { ArtifactStore, ReleaseArtifact } from '../storage/artifact-store.js';
import { createArtifactStore } from '../storage/vercel-blob.js';
import {
  manifestSha256,
  pairBasePath,
  releaseBasePath,
  serializeReleaseManifest,
  validateReleaseManifest,
  type DomainReleaseManifest,
  type ManifestArtifact,
  type PairManifestEntry,
  type ReleaseApprovalIdentity,
  type ReleaseBaselineIdentity
} from './manifest.js';
import { persistRelease } from './store.js';

export interface PreparedReleaseArtifact {
  artifactType: string;
  objectId: string | null;
  version: string | null;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface PreparedPairRelease {
  pairId: string;
  capabilityId: string;
  capabilityVersion: string;
  antipatternId: string;
  antipatternVersion: string;
  artifacts: PreparedReleaseArtifact[];
}

export interface PublishDomainReleaseInput {
  domainRunId: string;
  domain: string;
  domainReleaseVersion: string;
  baseline: ReleaseBaselineIdentity;
  externalApproval: ReleaseApprovalIdentity;
  pairs: PreparedPairRelease[];
  createdAt: string;
  artifactStore?: ArtifactStore;
}

export interface PublishedDomainRelease {
  releaseId: string;
  manifest: DomainReleaseManifest;
  manifestSha256: string;
  manifestUrl: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeFilename(filename: string): string {
  const normalized = filename.replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('\\')) {
    throw new Error(`Unsafe release artifact filename: ${filename}`);
  }
  return normalized;
}

async function publishPair(
  store: ArtifactStore,
  domain: string,
  pair: PreparedPairRelease
): Promise<PairManifestEntry> {
  if (pair.antipatternId !== `AP-${pair.capabilityId}`) {
    throw new Error(`Invalid prepared pair identity ${pair.capabilityId}/${pair.antipatternId}.`);
  }
  if (pair.capabilityId.slice(0, 1) !== domain) {
    throw new Error(`${pair.capabilityId} does not belong to domain ${domain}.`);
  }
  if (pair.artifacts.length === 0) throw new Error(`${pair.pairId} has no prepared release artifacts.`);

  const base = pairBasePath({
    domain,
    capabilityId: pair.capabilityId,
    capabilityVersion: pair.capabilityVersion,
    antipatternId: pair.antipatternId,
    antipatternVersion: pair.antipatternVersion
  });
  const manifestArtifacts: ManifestArtifact[] = [];
  const filenames = new Set<string>();

  for (const prepared of pair.artifacts) {
    const filename = safeFilename(prepared.filename);
    if (filenames.has(filename)) throw new Error(`Duplicate filename ${filename} in ${pair.pairId}.`);
    filenames.add(filename);
    const path = `${base}/${filename}`;
    const hash = sha256(prepared.bytes);
    const artifact: ReleaseArtifact = {
      path,
      contentType: prepared.contentType,
      bytes: prepared.bytes,
      sha256: hash
    };
    const stored = await store.putImmutable(artifact);
    manifestArtifacts.push({
      artifact_type: prepared.artifactType,
      object_id: prepared.objectId,
      version: prepared.version,
      path: stored.path,
      url: stored.immutableUrl,
      sha256: stored.sha256,
      content_type: prepared.contentType
    });
  }

  return {
    pair_id: pair.pairId,
    capability_id: pair.capabilityId,
    capability_version: pair.capabilityVersion,
    antipattern_id: pair.antipatternId,
    antipattern_version: pair.antipatternVersion,
    artifacts: manifestArtifacts.sort((a, b) => a.path.localeCompare(b.path))
  };
}

export async function publishDomainRelease(
  input: PublishDomainReleaseInput
): Promise<PublishedDomainRelease> {
  if (!input.externalApproval.approval_reference.trim()) {
    throw new Error('External approval reference is required before publication.');
  }
  const store = input.artifactStore ?? createArtifactStore();
  const pairs: PairManifestEntry[] = [];
  for (const pair of input.pairs) pairs.push(await publishPair(store, input.domain, pair));

  const manifest: DomainReleaseManifest = {
    manifest_version: '1.0.0',
    domain: input.domain,
    domain_release_version: input.domainReleaseVersion,
    baseline: input.baseline,
    external_approval: input.externalApproval,
    pairs: pairs.sort((a, b) => a.pair_id.localeCompare(b.pair_id)),
    created_at: input.createdAt
  };
  validateReleaseManifest(manifest);

  const manifestText = serializeReleaseManifest(manifest);
  const manifestBytes = new TextEncoder().encode(manifestText);
  const manifestHash = manifestSha256(manifest);
  if (sha256(manifestBytes) !== manifestHash) {
    throw new Error('Release manifest serializer/hash mismatch.');
  }

  const manifestPath = `${releaseBasePath(input.domain, input.domainReleaseVersion)}/release_manifest.json`;
  const storedManifest = await store.putImmutable({
    path: manifestPath,
    contentType: 'application/json',
    bytes: manifestBytes,
    sha256: manifestHash
  });
  const manifestArtifact: ManifestArtifact = {
    artifact_type: 'RELEASE_MANIFEST',
    object_id: null,
    version: input.domainReleaseVersion,
    path: storedManifest.path,
    url: storedManifest.immutableUrl,
    sha256: storedManifest.sha256,
    content_type: 'application/json'
  };

  const releaseId = await persistRelease({
    domainRunId: input.domainRunId,
    releaseVersion: input.domainReleaseVersion,
    manifest,
    manifestSha256: manifestHash,
    manifestArtifact
  });

  return {
    releaseId,
    manifest,
    manifestSha256: manifestHash,
    manifestUrl: storedManifest.immutableUrl
  };
}
