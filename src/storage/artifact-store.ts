export interface ReleaseArtifact {
  path: string;
  contentType: string;
  bytes: Uint8Array;
  sha256: string;
}

export interface StoredArtifact {
  path: string;
  immutableUrl: string;
  sha256: string;
}

export interface ArtifactStore {
  putImmutable(artifact: ReleaseArtifact): Promise<StoredArtifact>;
  readImmutable(path: string): Promise<StoredArtifact | undefined>;
}

/**
 * Writes a content-addressed artifact exactly once. A retry never overwrites an
 * existing path: it accepts an existing object only after verifying its digest.
 */
export async function putImmutableOrVerify(
  store: ArtifactStore,
  artifact: ReleaseArtifact
): Promise<StoredArtifact> {
  const existing = await store.readImmutable(artifact.path);
  if (existing) {
    if (existing.sha256 !== artifact.sha256) {
      throw new Error(`Immutable artifact path ${artifact.path} already exists with a different SHA-256.`);
    }
    return existing;
  }

  try {
    const stored = await store.putImmutable(artifact);
    if (stored.path !== artifact.path || stored.sha256 !== artifact.sha256) {
      throw new Error(`Immutable artifact store returned a different path or SHA-256 for ${artifact.path}.`);
    }
    return stored;
  } catch (error) {
    const afterConflict = await store.readImmutable(artifact.path);
    if (afterConflict?.sha256 === artifact.sha256) return afterConflict;
    if (afterConflict) {
      throw new Error(`Immutable artifact path ${artifact.path} already exists with a different SHA-256.`);
    }
    throw error;
  }
}
