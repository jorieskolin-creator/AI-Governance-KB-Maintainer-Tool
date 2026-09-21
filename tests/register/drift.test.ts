import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/assets/load.js';
import { checkRegisterDrift, sha256FromManifest } from '../../src/register/drift.js';
import type { DriveClient, GitHubClient } from '../../src/register/ports.js';
import { serializeManifest, sortKeysDeep, upsertSourceRegisterManifest } from '../../src/register/service.js';

const REGISTER_SHA = '0c1d154dc9774d7e2976b637aa865c6bf932b2fd4ae9ac546b7fb8de092fe764';

function sourceRegisterEntry(logicalPath: string): Record<string, unknown> {
  return {
    canonical_identity: 'AI-GOV-SOURCE-REGISTER',
    logical_path: logicalPath,
    release_status: 'APPROVED',
    role: 'SOURCE_REGISTER',
    schema_version: '2.1.0',
    sha256: REGISTER_SHA,
    version: '1.5.0'
  };
}

function fixtureManifest(
  logicalPath = '04 Global Registers/AI_Governance_Global_Source_Register_v1.5.0.json'
): Record<string, unknown> {
  return {
    manifest_version: '2.0.0',
    golden_standard: { id: 'GOLDEN', version: '1.0.0' },
    machine_authority: [
      {
        canonical_identity: 'AI-GOV-PLAYBOOK',
        logical_path: '04 Global Registers/playbook.json',
        role: 'TACTIC_PLAYBOOK',
        sha256: 'a'.repeat(64),
        version: '1.0.0'
      },
      sourceRegisterEntry(logicalPath),
      {
        canonical_identity: 'AI-GOV-VALIDATION-REPORT',
        logical_path: '04 Global Registers/validation.json',
        role: 'VALIDATION_REPORT',
        sha256: 'b'.repeat(64),
        version: '1.0.0'
      }
    ]
  };
}

class FakeGitHub implements GitHubClient {
  content = '';
  throwOnRead = false;

  async getFileSha(): Promise<string | null> {
    return 'blob-sha';
  }

  async readFileContent(_path: string): Promise<string> {
    if (this.throwOnRead) throw new Error('forced GitHub failure');
    return this.content;
  }

  async commitFile(): Promise<{ commitSha: string }> {
    return { commitSha: 'commit-sha' };
  }
}

function fakeDrive(manifest: Record<string, unknown>): DriveClient {
  return {
    async uploadVersionedFile() {
      return { fileId: 'x' };
    },
    async readManifest() {
      return JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
    },
    async writeManifest() {}
  };
}

describe('register manifest contract', () => {
  it('updates only version, sha256, and logical_path of the source-register entry', () => {
    const before = fixtureManifest();
    const nextSha = 'd'.repeat(64);
    const after = upsertSourceRegisterManifest(before, { version: '1.5.1', sha256: nextSha });

    expect(after.machine_authority).toHaveLength(3);
    expect(after.manifest_version).toEqual(before.manifest_version);
    expect(after.golden_standard).toEqual(before.golden_standard);

    const authorities = after.machine_authority as Record<string, unknown>[];
    const original = (before.machine_authority as Record<string, unknown>[])[0];
    const other = (before.machine_authority as Record<string, unknown>[])[2];
    expect(authorities[0]).toEqual(sortKeysDeep(original));
    expect(authorities[2]).toEqual(sortKeysDeep(other));

    const updated = authorities[1];
    expect(updated?.canonical_identity).toBe('AI-GOV-SOURCE-REGISTER');
    expect(updated?.version).toBe('1.5.1');
    expect(updated?.sha256).toBe(nextSha);
    expect(updated?.logical_path).toBe('04 Global Registers/AI_Governance_Global_Source_Register_v1.5.1.json');
    expect(updated?.release_status).toBe('APPROVED');
    expect(updated?.role).toBe('SOURCE_REGISTER');
    expect(updated?.schema_version).toBe('2.1.0');
  });

  it('derives logical_path prefix from the existing entry', () => {
    const fromGlobal = upsertSourceRegisterManifest(
      fixtureManifest('04 Global Registers/AI_Governance_Global_Source_Register_v1.5.0.json'),
      { version: '1.6.0', sha256: 'e'.repeat(64) }
    );
    const fromAuthorities = upsertSourceRegisterManifest(
      fixtureManifest('02 Authorities/AI_Governance_Global_Source_Register_v1.5.0.json'),
      { version: '1.6.0', sha256: 'e'.repeat(64) }
    );
    const globalEntry = (fromGlobal.machine_authority as Record<string, unknown>[])[1];
    const authoritiesEntry = (fromAuthorities.machine_authority as Record<string, unknown>[])[1];
    expect(globalEntry?.logical_path).toBe('04 Global Registers/AI_Governance_Global_Source_Register_v1.6.0.json');
    expect(authoritiesEntry?.logical_path).toBe('02 Authorities/AI_Governance_Global_Source_Register_v1.6.0.json');
  });

  it('removes a shadow source_register key and never creates one', () => {
    const withShadow = { ...fixtureManifest(), source_register: { version: '1.5.0', sha256: REGISTER_SHA } };
    const cleaned = upsertSourceRegisterManifest(withShadow, { version: '1.5.1', sha256: 'f'.repeat(64) });
    expect(Object.prototype.hasOwnProperty.call(cleaned, 'source_register')).toBe(false);

    const without = fixtureManifest();
    expect(Object.prototype.hasOwnProperty.call(without, 'source_register')).toBe(false);
    const after = upsertSourceRegisterManifest(without, { version: '1.5.1', sha256: 'f'.repeat(64) });
    expect(Object.prototype.hasOwnProperty.call(after, 'source_register')).toBe(false);
  });

  it('serializes the manifest as compact JSON with deep-sorted keys and one trailing newline', () => {
    const after = upsertSourceRegisterManifest(fixtureManifest(), { version: '1.5.1', sha256: 'c'.repeat(64) });
    const serialized = serializeManifest(after);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.endsWith('\n\n')).toBe(false);
    expect(serialized.includes('\n ')).toBe(false);
    expect(serialized).toContain('":"');
    expect(serialized).not.toContain('": "');

    function assertSorted(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(assertSorted);
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      const keys = Object.keys(value);
      expect(keys).toEqual([...keys].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)));
      Object.values(value as Record<string, unknown>).forEach(assertSorted);
    }
    assertSorted(JSON.parse(serialized));
    expect(serialized).toBe(`${JSON.stringify(sortKeysDeep(after))}\n`);
  });

  it('reports IN_SYNC, MISMATCH with both hashes, and UNKNOWN when GitHub throws', async () => {
    const content = '{"register":true}\n';
    const gitSha = sha256Hex(content);
    const manifest = fixtureManifest();
    (manifest.machine_authority as Record<string, unknown>[])[1]!.sha256 = gitSha;

    const github = new FakeGitHub();
    github.content = content;
    const inSync = await checkRegisterDrift({ github, drive: fakeDrive(manifest) });
    expect(inSync.state).toBe('IN_SYNC');
    expect(inSync.match).toBe(true);
    expect(inSync.gitSha256).toBe(gitSha);
    expect(inSync.manifestSha256).toBe(gitSha);

    const drifted = fixtureManifest();
    const mismatch = await checkRegisterDrift({ github, drive: fakeDrive(drifted) });
    expect(mismatch.state).toBe('MISMATCH');
    expect(mismatch.gitSha256).toBe(gitSha);
    expect(mismatch.manifestSha256).toBe(REGISTER_SHA);
    expect(mismatch.detail).toMatch(/does not match/i);

    github.throwOnRead = true;
    const unknown = await checkRegisterDrift({ github, drive: fakeDrive(manifest) });
    expect(unknown.state).toBe('UNKNOWN');
    expect(unknown.match).toBe(false);
    expect(unknown.detail).toMatch(/forced GitHub failure/);

    github.throwOnRead = false;
    const failingDrive: DriveClient = {
      ...fakeDrive(manifest),
      async readManifest() {
        throw new Error('forced Drive failure');
      }
    };
    const unknownDrive = await checkRegisterDrift({ github, drive: failingDrive });
    expect(unknownDrive.state).toBe('UNKNOWN');
    expect(unknownDrive.gitSha256).toBe(gitSha);
    expect(unknownDrive.detail).toMatch(/forced Drive failure/);
  });

  it('fails closed when the manifest entry is missing, with no fallback', () => {
    const empty = { manifest_version: '2.0.0', golden_standard: {}, machine_authority: [] };
    expect(() => upsertSourceRegisterManifest(empty, { version: '1.5.1', sha256: 'a'.repeat(64) })).toThrow(
      /manifest entry not found/
    );
    expect(() => sha256FromManifest({ sha256: 'a'.repeat(64), source_register: { sha256: 'b'.repeat(64) } })).toThrow(
      /manifest entry not found/
    );
    expect(() => sha256FromManifest({ assets: [{ kind: 'source_register', sha256: 'c'.repeat(64) }] })).toThrow(
      /manifest entry not found/
    );
  });
});
