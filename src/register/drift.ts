import type { FastifyBaseLogger } from 'fastify';
import { loadSourceRegister } from '../assets/load.js';
import { createDriveClient } from './drive.js';
import type { DriveClient } from './ports.js';

export type DriftReport = {
  match: boolean;
  gitSha256: string;
  manifestSha256: string | null;
  detail: string;
};

export function sha256FromManifest(manifest: Record<string, unknown>): string | null {
  const nested = manifest.source_register;
  if (nested && typeof nested === 'object') {
    const sha = (nested as { sha256?: unknown }).sha256;
    if (typeof sha === 'string' && /^[a-f0-9]{64}$/i.test(sha)) return sha.toLowerCase();
  }
  if (typeof manifest.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    return manifest.sha256.toLowerCase();
  }
  const assets = manifest.assets;
  if (Array.isArray(assets)) {
    for (const asset of assets) {
      if (!asset || typeof asset !== 'object') continue;
      const record = asset as { kind?: unknown; name?: unknown; sha256?: unknown };
      const name = typeof record.name === 'string' ? record.name : '';
      const kind = typeof record.kind === 'string' ? record.kind : '';
      if (
        (kind === 'source_register' || name.includes('Source_Register') || name.includes('source-register')) &&
        typeof record.sha256 === 'string' &&
        /^[a-f0-9]{64}$/i.test(record.sha256)
      ) {
        return record.sha256.toLowerCase();
      }
    }
  }
  return null;
}

export function compareRegisterHashes(gitSha256: string, manifestSha256: string | null): DriftReport {
  if (!manifestSha256) {
    return {
      match: false,
      gitSha256,
      manifestSha256,
      detail: 'Drive manifest sha256 is unavailable.'
    };
  }
  if (gitSha256 === manifestSha256) {
    return {
      match: true,
      gitSha256,
      manifestSha256,
      detail: 'Git and Drive manifest hashes match.'
    };
  }
  return {
    match: false,
    gitSha256,
    manifestSha256,
    detail: 'Git sha256 does not match Drive manifest sha256.'
  };
}

export async function checkRegisterDrift(input: {
  gitSha256: string;
  drive: DriveClient;
}): Promise<DriftReport> {
  try {
    const manifest = await input.drive.readManifest();
    return compareRegisterHashes(input.gitSha256, sha256FromManifest(manifest));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      match: false,
      gitSha256: input.gitSha256,
      manifestSha256: null,
      detail: `Drive manifest could not be read: ${message}`
    };
  }
}

export async function loadHomeDrift(): Promise<DriftReport> {
  const loaded = loadSourceRegister();
  return checkRegisterDrift({
    gitSha256: loaded.sha256,
    drive: createDriveClient()
  });
}

export async function checkRegisterDriftOnBoot(logger: FastifyBaseLogger): Promise<DriftReport> {
  try {
    const report = await loadHomeDrift();
    if (report.match) logger.info(report, 'source register drift check');
    else logger.warn(report, 'source register drift check');
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const report: DriftReport = {
      match: false,
      gitSha256: '',
      manifestSha256: null,
      detail: message
    };
    logger.warn(report, 'source register drift check failed');
    return report;
  }
}
