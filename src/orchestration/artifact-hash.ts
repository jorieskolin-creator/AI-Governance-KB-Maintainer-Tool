import { createHash } from 'node:crypto';

function jsonStorageValue(value: unknown): unknown {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(
      `Artifact value is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (serialized === undefined) {
    throw new Error('Artifact value has no JSON representation and cannot be persisted safely.');
  }
  return JSON.parse(serialized) as unknown;
}

function canonicalJsonValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(object[key])}`)
    .join(',')}}`;
}

/**
 * Canonicalize the exact JSON representation that PostgreSQL JSONB receives.
 * JavaScript-only values are normalized exactly as JSON.stringify would normalize
 * them before storage, preventing write-time and resume-time hash drift.
 */
export function canonicalArtifactValue(value: unknown): string {
  return canonicalJsonValue(jsonStorageValue(value));
}

export function canonicalArtifactHash(value: unknown): string {
  return createHash('sha256').update(canonicalArtifactValue(value)).digest('hex');
}
