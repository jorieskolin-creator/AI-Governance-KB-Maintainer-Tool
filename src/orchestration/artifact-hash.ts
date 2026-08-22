import { createHash } from 'node:crypto';

export function canonicalArtifactValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? 'undefined' : serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalArtifactValue).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalArtifactValue(object[key])}`)
    .join(',')}}`;
}

export function canonicalArtifactHash(value: unknown): string {
  return createHash('sha256').update(canonicalArtifactValue(value)).digest('hex');
}
