import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';
import type { ArtifactStore, ReleaseArtifact, StoredArtifact } from './artifact-store.js';

export type BlobAccess = 'public' | 'private';

function requiredToken(): string {
  const value = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!value) throw new Error('BLOB_READ_WRITE_TOKEN is required for Vercel Blob publication.');
  return value;
}

function configuredAccess(): BlobAccess {
  const value = (process.env.ARTIFACT_STORE_ACCESS ?? 'public').trim().toLowerCase();
  if (value !== 'public' && value !== 'private') {
    throw new Error(`ARTIFACT_STORE_ACCESS must be public or private; received ${value}.`);
  }
  return value;
}

function actualSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export class VercelBlobArtifactStore implements ArtifactStore {
  async putImmutable(artifact: ReleaseArtifact): Promise<StoredArtifact> {
    const computed = actualSha256(artifact.bytes);
    if (computed !== artifact.sha256) {
      throw new Error(
        `Artifact ${artifact.path} SHA-256 mismatch before upload: declared ${artifact.sha256}, computed ${computed}.`
      );
    }

    const blob = await put(artifact.path, toArrayBuffer(artifact.bytes), {
      access: configuredAccess(),
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: artifact.contentType,
      token: requiredToken()
    });

    if (blob.pathname !== artifact.path) {
      throw new Error(
        `Vercel Blob pathname mismatch: requested ${artifact.path}, received ${blob.pathname}.`
      );
    }

    return {
      path: blob.pathname,
      immutableUrl: blob.url,
      sha256: artifact.sha256
    };
  }
}

export function createArtifactStore(): ArtifactStore {
  const provider = (process.env.ARTIFACT_STORE_PROVIDER ?? 'vercel').trim().toLowerCase();
  if (provider !== 'vercel') {
    throw new Error(`Unsupported ARTIFACT_STORE_PROVIDER: ${provider}.`);
  }
  return new VercelBlobArtifactStore();
}
