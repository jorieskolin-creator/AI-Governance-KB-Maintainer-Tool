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
}

// The first production adapter is expected to target the existing Vercel-backed
// artifact location. The interface deliberately keeps storage out of authoring logic.
