import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadSourceRegister, SOURCE_REGISTER_FILENAME, type SourceRegister } from '../../src/assets/load.js';
import { closeDatabase, getDbPool } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import type { DriveClient, GitHubClient } from '../../src/register/ports.js';
import { createRegisterService } from '../../src/register/service.js';

class FakeGitHub implements GitHubClient {
  commits: Array<{ path: string; content: string; message: string; sha: string | null }> = [];
  blobSha: string | null = 'blob-sha-0';

  async getFileSha(_path: string): Promise<string | null> {
    return this.blobSha;
  }

  async readFileContent(_path: string): Promise<string> {
    return this.commits.at(-1)?.content ?? '';
  }

  async commitFile(
    path: string,
    content: string,
    message: string,
    sha: string | null
  ): Promise<{ commitSha: string }> {
    this.commits.push({ path, content, message, sha });
    this.blobSha = `blob-sha-${this.commits.length}`;
    return { commitSha: `commit-sha-${this.commits.length}` };
  }
}

class FakeDrive implements DriveClient {
  failNextUpload = false;
  uploads: Array<{ folderId: string; name: string; content: string }> = [];
  manifest: Record<string, unknown> = {
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
      {
        canonical_identity: 'AI-GOV-SOURCE-REGISTER',
        logical_path: '04 Global Registers/AI_Governance_Global_Source_Register_v1.5.0.json',
        release_status: 'APPROVED',
        role: 'SOURCE_REGISTER',
        schema_version: '2.1.0',
        sha256: '0'.repeat(64),
        version: '1.5.0'
      },
      {
        canonical_identity: 'AI-GOV-VALIDATION-REPORT',
        logical_path: '04 Global Registers/validation.json',
        role: 'VALIDATION_REPORT',
        sha256: 'b'.repeat(64),
        version: '1.0.0'
      }
    ]
  };

  async uploadVersionedFile(folderId: string, name: string, content: string): Promise<{ fileId: string }> {
    if (this.failNextUpload) {
      this.failNextUpload = false;
      throw new Error('forced Drive failure');
    }
    this.uploads.push({ folderId, name, content });
    return { fileId: `drive-file-${this.uploads.length}` };
  }

  async readManifest(): Promise<Record<string, unknown>> {
    return JSON.parse(JSON.stringify(this.manifest)) as Record<string, unknown>;
  }

  async writeManifest(manifest: Record<string, unknown>): Promise<void> {
    this.manifest = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  }
}

function dateOnlyEdit(): SourceRegister {
  const register = JSON.parse(JSON.stringify(loadSourceRegister().register)) as SourceRegister;
  const first = register.sources[0];
  if (!first) throw new Error('fixture is missing sources');
  first.last_verified_date = '2026-09-21';
  return register;
}

describe('register approve', () => {
  beforeAll(async () => {
    await runMigrations();
  });

  beforeEach(async () => {
    const db = getDbPool();
    await db.query('delete from sync_events');
    await db.query('delete from register_revisions');
  });

  afterAll(async () => {
    const db = getDbPool();
    await db.query('delete from sync_events');
    await db.query('delete from register_revisions');
    await closeDatabase();
  });

  it('approves with fake GitHub and Drive clients, writes a revision, and uploads the versioned filename', async () => {
    const github = new FakeGitHub();
    const drive = new FakeDrive();
    const loaded = loadSourceRegister();
    const service = createRegisterService({
      github,
      drive,
      loadCurrent: () => loaded,
      authoritiesFolderId: 'authorities-folder',
      now: () => new Date('2026-09-21T12:00:00Z')
    });

    const draft = service.saveDraft(dateOnlyEdit());
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      expect(draft.impact.changedSourceIds.length).toBeGreaterThan(0);
      expect(draft.impact.affectedPairIds).toEqual([]);
    }

    const result = await service.approve();
    expect(result.ok).toBe(true);
    expect(result.status).toBe('SYNCED');
    expect(result.version).toBe('1.5.1');
    expect(github.commits).toHaveLength(1);
    expect(github.commits[0]?.path).toBe(SOURCE_REGISTER_FILENAME);
    expect(github.commits[0]?.message).toBe('register: source register v1.5.1 (approved 2026-09-21)');
    expect(drive.uploads).toHaveLength(1);
    expect(drive.uploads[0]?.name).toBe('AI_Governance_Global_Source_Register_v1.5.1.json');
    expect(drive.uploads[0]?.folderId).toBe('authorities-folder');

    const db = getDbPool();
    const revision = await db.query<{ status: string; version: string }>(
      'select status, version from register_revisions where sha256 = $1',
      [result.sha256]
    );
    expect(revision.rows[0]?.status).toBe('SYNCED');
    expect(revision.rows[0]?.version).toBe('1.5.1');
  });

  it('records SYNC_FAILED on Drive failure, keeps Git intact, and retries to SYNCED without a second commit', async () => {
    const github = new FakeGitHub();
    const drive = new FakeDrive();
    drive.failNextUpload = true;
    const loaded = loadSourceRegister();
    const service = createRegisterService({
      github,
      drive,
      loadCurrent: () => loaded,
      authoritiesFolderId: 'authorities-folder',
      now: () => new Date('2026-09-21T12:00:00Z')
    });

    expect(service.saveDraft(dateOnlyEdit()).ok).toBe(true);
    const failed = await service.approve();
    expect(failed.ok).toBe(false);
    expect(failed.status).toBe('SYNC_FAILED');
    expect(failed.gitCommitSha).toBe('commit-sha-1');
    expect(github.commits).toHaveLength(1);
    expect(drive.uploads).toHaveLength(0);

    const db = getDbPool();
    const afterFail = await db.query<{ status: string }>(
      'select status from register_revisions where id = $1',
      [failed.revisionId]
    );
    expect(afterFail.rows[0]?.status).toBe('SYNC_FAILED');
    const events = await db.query<{ destination: string; status: string }>(
      'select destination, status from sync_events where revision_id = $1 order by attempted_at',
      [failed.revisionId]
    );
    expect(events.rows).toEqual(
      expect.arrayContaining([
        { destination: 'GITHUB', status: 'SUCCESS' },
        { destination: 'DRIVE', status: 'FAILED' }
      ])
    );

    const retried = await service.approve();
    expect(retried.ok).toBe(true);
    expect(retried.status).toBe('SYNCED');
    expect(retried.revisionId).toBe(failed.revisionId);
    expect(github.commits).toHaveLength(1);
    expect(drive.uploads).toHaveLength(1);

    const afterRetry = await db.query<{ status: string }>(
      'select status from register_revisions where id = $1',
      [failed.revisionId]
    );
    expect(afterRetry.rows[0]?.status).toBe('SYNCED');
  });
});
