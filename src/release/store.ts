import { getDbPool } from '../db/client.js';
import { releaseBasePath, type DomainReleaseManifest, type ManifestArtifact } from './manifest.js';

export interface PersistReleaseInput {
  domainRunId: string;
  releaseVersion: string;
  manifest: DomainReleaseManifest;
  manifestSha256: string;
  manifestArtifact: ManifestArtifact;
  artifactStorageUris?: Record<string, string>;
}

export async function persistRelease(input: PersistReleaseInput): Promise<string> {
  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query('begin');
    const existing = await client.query<{ id: string; sha256: string }>(
      `select id, sha256 from releases
       where domain_run_id = $1 and release_version = $2
       for update`,
      [input.domainRunId, input.releaseVersion]
    );
    const existingRelease = existing.rows[0];
    if (existingRelease) {
      if (existingRelease.sha256 !== input.manifestSha256) {
        throw new Error(
          `Release ${input.releaseVersion} already exists for this domain run with a different manifest hash.`
        );
      }
      await client.query('commit');
      return existingRelease.id;
    }

    const releaseResult = await client.query<{ id: string }>(
      `insert into releases(domain_run_id, release_version, manifest, sha256)
       values ($1, $2, $3::jsonb, $4)
       returning id`,
      [
        input.domainRunId,
        input.releaseVersion,
        JSON.stringify(input.manifest),
        input.manifestSha256
      ]
    );
    const releaseId = releaseResult.rows[0]?.id;
    if (!releaseId) throw new Error('Failed to persist release.');

    const artifacts: ManifestArtifact[] = [
      ...input.manifest.pairs.flatMap((pair) => pair.artifacts),
      input.manifestArtifact
    ];
    for (const artifact of artifacts) {
      await client.query(
        `insert into artifacts(
          release_id, artifact_type, object_id, version, storage_uri, sha256
        ) values ($1,$2,$3,$4,$5,$6)`,
        [
          releaseId,
          artifact.artifact_type,
          artifact.object_id,
          artifact.version,
          input.artifactStorageUris?.[artifact.path] ?? artifact.url,
          artifact.sha256
        ]
      );
    }

    await client.query('commit');
    return releaseId;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function loadStoredRelease(input: {
  domainRunId: string;
  manifestSha256: string;
}): Promise<{
  releaseId: string;
  manifestUrl: string;
  artifactStorageUris: Record<string, string>;
} | undefined> {
  const db = getDbPool();
  const release = await db.query<{ id: string; manifest: DomainReleaseManifest }>(
    `select id, manifest from releases
     where domain_run_id = $1 and sha256 = $2`,
    [input.domainRunId, input.manifestSha256]
  );
  const row = release.rows[0];
  if (!row) return undefined;
  const artifacts = await db.query<{ storage_uri: string; artifact_type: string; sha256: string }>(
    `select storage_uri, artifact_type, sha256 from artifacts where release_id = $1`,
    [row.id]
  );
  const bySha = new Map(artifacts.rows.map((item) => [item.sha256, item.storage_uri]));
  const artifactStorageUris: Record<string, string> = {};
  for (const pair of row.manifest.pairs) {
    for (const artifact of pair.artifacts) {
      const url = bySha.get(artifact.sha256);
      if (url) artifactStorageUris[artifact.path] = url;
    }
  }
  const manifestUrl =
    artifacts.rows.find((item) => item.artifact_type === 'RELEASE_MANIFEST')?.storage_uri ?? '';
  if (manifestUrl) {
    artifactStorageUris[
      `${releaseBasePath(row.manifest.domain, row.manifest.domain_release_version)}/release_manifest.json`
    ] = manifestUrl;
  }
  return { releaseId: row.id, manifestUrl, artifactStorageUris };
}
