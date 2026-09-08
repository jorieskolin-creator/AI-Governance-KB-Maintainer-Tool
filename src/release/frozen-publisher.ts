import {
  putImmutableOrVerify,
  type ArtifactStore,
  type ReleaseArtifact,
  type StoredArtifact
} from '../storage/artifact-store.js';
import { createArtifactStore } from '../storage/vercel-blob.js';
import { sha256Utf8, utf8Bytes } from '../orchestration/artifact-hash.js';
import {
  manifestSha256,
  releaseBasePath,
  serializeReleaseManifest,
  validateReleaseManifest,
  type DomainReleaseManifest,
  type ManifestArtifact
} from './manifest.js';
import { persistRelease, type PersistReleaseInput } from './store.js';

export interface FrozenReleasePayload {
  contentType: string;
  utf8: string;
}

export interface PublishFrozenReleaseInput {
  domainRunId: string;
  manifest: DomainReleaseManifest;
  manifestSha256: string;
  payloads: Record<string, FrozenReleasePayload>;
  artifactStore?: ArtifactStore;
  persist?: (input: PersistReleaseInput) => Promise<string>;
}

export interface PublishedFrozenRelease {
  releaseId: string;
  manifest: DomainReleaseManifest;
  manifestSha256: string;
  manifestUrl: string;
  artifactStorageUris: Record<string, string>;
}

function releaseArtifact(
  path: string,
  contentType: string,
  utf8: string,
  expectedSha256: string
): ReleaseArtifact {
  const bytes = utf8Bytes(utf8);
  const actual = sha256Utf8(utf8);
  if (actual !== expectedSha256) {
    throw new Error(`Frozen payload hash mismatch for ${path}.`);
  }
  return { path, contentType, bytes, sha256: actual };
}

function payloadFor(
  payloads: Record<string, FrozenReleasePayload>,
  artifact: ManifestArtifact
): FrozenReleasePayload {
  const payload = payloads[artifact.sha256];
  if (!payload) throw new Error(`Frozen payload is missing for ${artifact.path}.`);
  if (payload.contentType !== artifact.content_type) {
    throw new Error(`Frozen payload content type drifted for ${artifact.path}.`);
  }
  return payload;
}

function assertApprovedCanonicalPayload(
  payload: FrozenReleasePayload,
  artifact: ManifestArtifact,
  manifest: DomainReleaseManifest
): void {
  if (artifact.content_type !== 'application/json') return;
  try {
    const parsed: unknown = JSON.parse(payload.utf8);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const object = parsed as Record<string, unknown>;
    const approval = object.approval_record as Record<string, unknown> | undefined;
    if (
      object.id !== artifact.object_id ||
      object.release_status !== 'APPROVED' ||
      !approval ||
      approval.approval_status !== 'APPROVED' ||
      approval.approved_by_role !== manifest.external_approval.approved_by_role ||
      approval.approved_on !== manifest.external_approval.approved_on ||
      approval.effective_from !== manifest.external_approval.effective_from
    ) {
      throw new Error('approval binding drifted');
    }
  } catch (error) {
    const reason = error instanceof Error && error.message !== 'not an object'
      ? error.message
      : 'not valid approved canonical JSON';
    throw new Error(`Approved canonical payload validation failed for ${artifact.path}: ${reason}.`);
  }
}

async function putAndReadBack(
  store: ArtifactStore,
  artifact: ReleaseArtifact
): Promise<StoredArtifact> {
  const stored = await putImmutableOrVerify(store, artifact);
  const readBack = await store.readImmutable(artifact.path);
  if (!readBack || readBack.path !== artifact.path || readBack.sha256 !== artifact.sha256) {
    throw new Error(`Immutable artifact store could not verify ${artifact.path} after publication.`);
  }
  return stored;
}

export async function publishFrozenRelease(
  input: PublishFrozenReleaseInput
): Promise<PublishedFrozenRelease> {
  validateReleaseManifest(input.manifest);
  const expectedManifestSha = manifestSha256(input.manifest);
  if (input.manifestSha256 !== expectedManifestSha) {
    throw new Error('Release manifest hash does not match the approved manifest.');
  }

  const store = input.artifactStore ?? createArtifactStore();
  const artifactStorageUris: Record<string, string> = {};
  for (const pair of input.manifest.pairs) {
    for (const artifact of pair.artifacts) {
      if (artifact.url !== artifact.path) {
        throw new Error(`Approved release manifest must bind pending URL to path for ${artifact.path}.`);
      }
      const payload = payloadFor(input.payloads, artifact);
      assertApprovedCanonicalPayload(payload, artifact, input.manifest);
      const stored = await putAndReadBack(
        store,
        releaseArtifact(artifact.path, artifact.content_type, payload.utf8, artifact.sha256)
      );
      artifactStorageUris[artifact.path] = stored.immutableUrl;
    }
  }

  const manifestText = serializeReleaseManifest(input.manifest);
  const manifestPath = `${releaseBasePath(
    input.manifest.domain,
    input.manifest.domain_release_version
  )}/release_manifest.json`;
  const storedManifest = await putAndReadBack(
    store,
    releaseArtifact(manifestPath, 'application/json', manifestText, input.manifestSha256)
  );
  artifactStorageUris[manifestPath] = storedManifest.immutableUrl;
  const manifestArtifact: ManifestArtifact = {
    artifact_type: 'RELEASE_MANIFEST',
    object_id: null,
    version: input.manifest.domain_release_version,
    path: manifestPath,
    url: manifestPath,
    sha256: input.manifestSha256,
    content_type: 'application/json'
  };
  const releaseId = await (input.persist ?? persistRelease)({
    domainRunId: input.domainRunId,
    releaseVersion: input.manifest.domain_release_version,
    manifest: input.manifest,
    manifestSha256: input.manifestSha256,
    manifestArtifact,
    artifactStorageUris
  });

  return {
    releaseId,
    manifest: input.manifest,
    manifestSha256: input.manifestSha256,
    manifestUrl: storedManifest.immutableUrl,
    artifactStorageUris
  };
}
