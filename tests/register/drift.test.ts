import { describe, expect, it } from 'vitest';
import { compareRegisterHashes } from '../../src/register/drift.js';
import type { DriveClient } from '../../src/register/ports.js';
import { checkRegisterDrift } from '../../src/register/drift.js';

describe('register drift', () => {
  it('reports clear when hashes match and mismatch when they differ', async () => {
    const git = 'a'.repeat(64);
    const match = compareRegisterHashes(git, git);
    expect(match.match).toBe(true);
    expect(match.detail).toMatch(/match/i);

    const mismatch = compareRegisterHashes(git, 'b'.repeat(64));
    expect(mismatch.match).toBe(false);
    expect(mismatch.gitSha256).toBe(git);
    expect(mismatch.manifestSha256).toBe('b'.repeat(64));
    expect(mismatch.detail).toMatch(/does not match/i);

    const drive: DriveClient = {
      async uploadVersionedFile() {
        return { fileId: 'x' };
      },
      async readManifest() {
        return { source_register: { sha256: git } };
      },
      async writeManifest() {}
    };
    const fromDrive = await checkRegisterDrift({ gitSha256: git, drive });
    expect(fromDrive.match).toBe(true);

    const drifted: DriveClient = {
      ...drive,
      async readManifest() {
        return { source_register: { sha256: 'c'.repeat(64) } };
      }
    };
    const reported = await checkRegisterDrift({ gitSha256: git, drive: drifted });
    expect(reported.match).toBe(false);
  });
});
