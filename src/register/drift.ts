import type { FastifyBaseLogger } from 'fastify';
import { sha256Hex, SOURCE_REGISTER_FILENAME } from '../assets/load.js';
import { createDriveClient } from './drive.js';
import { createGitHubClient } from './github.js';
import type { DriveClient, GitHubClient } from './ports.js';

export const SOURCE_REGISTER_CANONICAL_IDENTITY = 'AI-GOV-SOURCE-REGISTER';

export type DriftState = 'IN_SYNC' | 'MISMATCH' | 'UNKNOWN';

export type DriftReport = {
  state: DriftState;
  match: boolean;
  gitSha256: string;
  manifestSha256: string | null;
  manifestVersion: string | null;
  detail: string;
};

export type ManifestRegisterRecord = {
  sha256: string;
  version: string;
};

const MANIFEST_ENTRY_NOT_FOUND = 'manifest entry not found';

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function findSourceRegisterManifestEntry(manifest: Record<string, unknown>): Record<string, unknown> {
  const authorities = manifest.machine_authority;
  if (!Array.isArray(authorities)) {
    throw new Error(MANIFEST_ENTRY_NOT_FOUND);
  }
  for (const item of authorities) {
    const record = asObject(item);
    if (record?.canonical_identity === SOURCE_REGISTER_CANONICAL_IDENTITY) return record;
  }
  throw new Error(MANIFEST_ENTRY_NOT_FOUND);
}

export function sha256FromManifest(manifest: Record<string, unknown>): ManifestRegisterRecord {
  const entry = findSourceRegisterManifestEntry(manifest);
  const sha256 = entry.sha256;
  const version = entry.version;
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error(MANIFEST_ENTRY_NOT_FOUND);
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(MANIFEST_ENTRY_NOT_FOUND);
  }
  return { sha256: sha256.toLowerCase(), version };
}

function driftReport(
  state: DriftState,
  gitSha256: string,
  manifestSha256: string | null,
  detail: string,
  manifestVersion: string | null = null
): DriftReport {
  return {
    state,
    match: state === 'IN_SYNC',
    gitSha256,
    manifestSha256,
    manifestVersion,
    detail
  };
}

export function compareRegisterHashes(
  gitSha256: string,
  manifestSha256: string | null,
  manifestVersion: string | null = null
): DriftReport {
  if (!manifestSha256) {
    return driftReport(
      'MISMATCH',
      gitSha256,
      manifestSha256,
      'Drive manifest sha256 is unavailable.',
      manifestVersion
    );
  }
  if (gitSha256 === manifestSha256) {
    return driftReport(
      'IN_SYNC',
      gitSha256,
      manifestSha256,
      'Git and Drive manifest hashes match.',
      manifestVersion
    );
  }
  return driftReport(
    'MISMATCH',
    gitSha256,
    manifestSha256,
    'Git sha256 does not match Drive manifest sha256.',
    manifestVersion
  );
}

export async function checkRegisterDrift(input: {
  drive: DriveClient;
  github?: GitHubClient;
  gitSha256?: string;
}): Promise<DriftReport> {
  const github = input.github ?? createGitHubClient();
  let gitSha256 = '';
  try {
    const content = await github.readFileContent(SOURCE_REGISTER_FILENAME);
    gitSha256 = sha256Hex(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return driftReport('UNKNOWN', '', null, `Git content could not be read: ${message}`);
  }

  try {
    const manifest = await input.drive.readManifest();
    try {
      const record = sha256FromManifest(manifest);
      return compareRegisterHashes(gitSha256, record.sha256, record.version);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return driftReport('MISMATCH', gitSha256, null, message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return driftReport('UNKNOWN', gitSha256, null, `Drive manifest could not be read: ${message}`);
  }
}

export async function loadHomeDrift(clients?: {
  github?: GitHubClient;
  drive?: DriveClient;
}): Promise<DriftReport> {
  return checkRegisterDrift({
    github: clients?.github ?? createGitHubClient(),
    drive: clients?.drive ?? createDriveClient()
  });
}

export async function checkRegisterDriftOnBoot(logger: FastifyBaseLogger): Promise<DriftReport> {
  try {
    const report = await loadHomeDrift();
    if (report.state === 'IN_SYNC') logger.info(report, 'source register drift check');
    else logger.warn(report, 'source register drift check');
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report = driftReport('UNKNOWN', '', null, message);
    logger.warn(report, 'source register drift check failed');
    return report;
  }
}
