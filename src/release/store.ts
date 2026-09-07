import { getDbPool } from '../db/client.js';
import type { DomainReleaseManifest, ManifestArtifact } from './manifest.js';

export async function persistRelease(input: {
  domainRunId: string;
  releaseVersion: string;
  manifest: DomainReleaseManifest;
  manifestSha256: string;
  manifestArtifact: ManifestArtifact;
}): Promise<string> {
  const db = getDbPool();
  const client = await db.connect();
  try {
    await client.query('begin');
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
          artifact.url,
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
