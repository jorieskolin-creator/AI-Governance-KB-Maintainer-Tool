function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const record = asObject(value);
  if (!record) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
    sorted[key] = sortKeysDeep(record[key]);
  }
  return sorted;
}

export function serializeManifest(manifest: Record<string, unknown>): string {
  return `${JSON.stringify(sortKeysDeep(manifest))}\n`;
}
