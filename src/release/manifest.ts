import { createHash } from 'node:crypto';

export interface ReleaseBaselineIdentity {
  baseline_snapshot_id: string;
  baseline_sha256: string;
  production_contract_version: string;
  production_contract_sha256: string;
  schema_version: string;
  source_register_version: string;
  source_register_sha256: string;
  tactic_catalog_version: string | null;
  tactic_catalog_sha256: string | null;
  golden_reference_id: string;
  golden_reference_version: string;
  golden_reference_sha256: string;
}

export interface ReleaseApprovalIdentity {
  approval_reference: string;
  approved_by_role: string;
  approved_on: string;
  effective_from: string;
}

export interface ManifestArtifact {
  artifact_type: string;
  object_id: string | null;
  version: string | null;
  path: string;
  url: string;
  sha256: string;
  content_type: string;
}

export interface PairManifestEntry {
  pair_id: string;
  capability_id: string;
  capability_version: string;
  antipattern_id: string;
  antipattern_version: string;
  artifacts: ManifestArtifact[];
}

export interface DomainReleaseManifest {
  manifest_version: '1.0.0';
  domain: string;
  domain_release_version: string;
  baseline: ReleaseBaselineIdentity;
  external_approval: ReleaseApprovalIdentity;
  pairs: PairManifestEntry[];
  created_at: string;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}

export function serializeReleaseManifest(manifest: DomainReleaseManifest): string {
  return stable(manifest);
}

export function manifestSha256(manifest: DomainReleaseManifest): string {
  return createHash('sha256').update(serializeReleaseManifest(manifest)).digest('hex');
}

export function releaseBasePath(domain: string, domainReleaseVersion: string): string {
  const root = (process.env.ARTIFACT_STORE_BASE_PATH ?? 'ai-governance-kb').replace(/^\/+|\/+$/g, '');
  return `${root}/${domain}/releases/${domainReleaseVersion}`;
}

export function pairBasePath(input: {
  domain: string;
  capabilityId: string;
  capabilityVersion: string;
  antipatternId: string;
  antipatternVersion: string;
}): string {
  const root = (process.env.ARTIFACT_STORE_BASE_PATH ?? 'ai-governance-kb').replace(/^\/+|\/+$/g, '');
  const pair = `${input.capabilityId}_${input.antipatternId}`;
  const versions = `${input.capabilityId}-v${input.capabilityVersion}__${input.antipatternId}-v${input.antipatternVersion}`;
  return `${root}/${input.domain}/${pair}/${versions}`;
}

export function validateReleaseManifest(manifest: DomainReleaseManifest): void {
  if (!/^[A-F]$/.test(manifest.domain)) throw new Error(`Invalid release domain ${manifest.domain}.`);
  if (!manifest.domain_release_version.trim()) throw new Error('Domain release version is required.');
  if (!manifest.external_approval.approval_reference.trim()) {
    throw new Error('External approval reference is required before publication.');
  }
  if (manifest.pairs.length === 0) throw new Error('A domain release must contain at least one pair.');

  const pairIds = new Set<string>();
  const artifactPaths = new Set<string>();
  for (const pair of manifest.pairs) {
    if (pair.antipattern_id !== `AP-${pair.capability_id}`) {
      throw new Error(`Invalid pair identity ${pair.capability_id}/${pair.antipattern_id}.`);
    }
    if (pair.capability_id.slice(0, 1) !== manifest.domain) {
      throw new Error(`${pair.capability_id} does not belong to domain ${manifest.domain}.`);
    }
    if (pairIds.has(pair.pair_id)) throw new Error(`Duplicate pair ${pair.pair_id} in release manifest.`);
    pairIds.add(pair.pair_id);
    if (pair.artifacts.length === 0) throw new Error(`${pair.pair_id} has no release artifacts.`);
    for (const artifact of pair.artifacts) {
      if (artifactPaths.has(artifact.path)) throw new Error(`Duplicate release artifact path ${artifact.path}.`);
      artifactPaths.add(artifact.path);
      if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
        throw new Error(`Invalid SHA-256 for ${artifact.path}.`);
      }
    }
  }
}
