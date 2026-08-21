import { createHash } from 'node:crypto';
import { getDbPool } from '../db/client.js';

export interface BaselineArtifact {
  artifactType:
    | 'CATEGORIES_BASELINE'
    | 'CAPABILITY_SCHEMA'
    | 'ANTIPATTERN_SCHEMA'
    | 'SHARED_DEFINITIONS_SCHEMA'
    | 'SOURCE_REGISTER'
    | 'TACTIC_CATALOG'
    | 'GOLDEN_STANDARD'
    | 'PROMPT_CONFIGURATION';
  id: string;
  version: string;
  content: unknown;
}

export interface BaselineManifestEntry {
  artifactType: BaselineArtifact['artifactType'];
  id: string;
  version: string;
  sha256: string;
}

export interface BaselineSnapshot {
  id: string;
  sha256: string;
  manifest: BaselineManifestEntry[];
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

const REQUIRED_BASELINE_TYPES: BaselineArtifact['artifactType'][] = [
  'CATEGORIES_BASELINE',
  'CAPABILITY_SCHEMA',
  'ANTIPATTERN_SCHEMA',
  'SHARED_DEFINITIONS_SCHEMA',
  'SOURCE_REGISTER',
  'GOLDEN_STANDARD'
];

export function buildBaselineManifest(artifacts: BaselineArtifact[]): BaselineManifestEntry[] {
  const types = new Set(artifacts.map((artifact) => artifact.artifactType));
  const missing = REQUIRED_BASELINE_TYPES.filter((type) => !types.has(type));
  if (missing.length) {
    throw new Error(`Baseline is incomplete; missing ${missing.join(', ')}`);
  }

  const duplicateKey = new Set<string>();
  const manifest = artifacts.map((artifact) => {
    const key = `${artifact.artifactType}:${artifact.id}:${artifact.version}`;
    if (duplicateKey.has(key)) throw new Error(`Duplicate baseline artifact ${key}`);
    duplicateKey.add(key);
    return {
      artifactType: artifact.artifactType,
      id: artifact.id,
      version: artifact.version,
      sha256: hash(artifact.content)
    };
  });

  return manifest.sort((a, b) =>
    `${a.artifactType}:${a.id}:${a.version}`.localeCompare(`${b.artifactType}:${b.id}:${b.version}`)
  );
}

export async function sealBaselineSnapshot(artifacts: BaselineArtifact[]): Promise<BaselineSnapshot> {
  const manifest = buildBaselineManifest(artifacts);
  const sha256 = hash(manifest);
  const db = getDbPool();
  const result = await db.query<{ id: string; sha256: string; manifest: BaselineManifestEntry[] }>(
    `insert into baseline_snapshots(sha256, manifest)
     values ($1, $2::jsonb)
     on conflict (sha256) do update set sha256 = excluded.sha256
     returning id, sha256, manifest`,
    [sha256, JSON.stringify(manifest)]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Failed to seal baseline snapshot.');
  return row;
}
