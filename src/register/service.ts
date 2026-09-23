import { loadSourceRegister, serializeRegister, sha256Hex, SOURCE_REGISTER_FILENAME, type SourceRecord, type SourceRegister } from '../assets/load.js';
import { validateRegister, type Finding } from '../assets/validate.js';
import { getDbPool } from '../db/client.js';
import { findSourceRegisterManifestEntry } from './drift.js';
import { driveAuthoritiesFolderId } from './drive.js';
import { sortKeysDeep } from './manifest-format.js';
import type { DriveClient, GitHubClient } from './ports.js';

export { serializeManifest, sortKeysDeep } from './manifest-format.js';

export type RegisterImpact = {
  changedSourceIds: string[];
  affectedPairIds: string[];
};

export type DraftResult =
  | { ok: true; findings: Finding[]; impact: RegisterImpact; register: SourceRegister }
  | { ok: false; findings: Finding[]; impact: RegisterImpact; register?: undefined };

export type RevisionStatus = 'COMMITTED' | 'SYNCED' | 'SYNC_FAILED';

export type ApproveResult = {
  ok: boolean;
  status: RevisionStatus;
  version: string;
  sha256: string;
  gitCommitSha: string | null;
  driveFileId: string | null;
  revisionId: string;
  findings: Finding[];
  error?: string;
};

export type RegisterSnapshot = {
  register: SourceRegister;
  version: string;
  sha256: string;
};

type PendingApproval = {
  register: SourceRegister;
  content: string;
  sha256: string;
  version: string;
  message: string;
};

type RevisionRow = {
  id: string;
  version: string;
  sha256: string;
  git_commit_sha: string | null;
  drive_file_id: string | null;
  status: RevisionStatus;
};

function cloneRegister(register: SourceRegister): SourceRegister {
  return JSON.parse(JSON.stringify(register)) as SourceRegister;
}

function asSourceRecord(value: unknown): SourceRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  return {
    id: record.id,
    last_verified_date: typeof record.last_verified_date === 'string' ? record.last_verified_date : '',
    effective_status: typeof record.effective_status === 'string' ? record.effective_status : '',
    supersedes_source_id:
      typeof record.supersedes_source_id === 'string' || record.supersedes_source_id === null
        ? (record.supersedes_source_id as string | null)
        : null,
    ...record
  };
}

export function sourcesOf(register: SourceRegister): SourceRecord[] {
  return register.sources.map((source) => asSourceRecord(source)).filter((source): source is SourceRecord => Boolean(source));
}

export function affectedPairsForSources(_sourceIds: string[]): string[] {
  // Phase 1 has no published pairs yet. The path exists and is tested.
  return [];
}

export function computeImpact(before: SourceRegister, after: SourceRegister): RegisterImpact {
  const previous = new Map(sourcesOf(before).map((source) => [source.id, source]));
  const next = sourcesOf(after);
  const changed = new Set<string>();

  for (const source of next) {
    const prior = previous.get(source.id);
    if (!prior) {
      changed.add(source.id);
      if (source.supersedes_source_id) changed.add(source.supersedes_source_id);
      continue;
    }
    if (
      prior.last_verified_date !== source.last_verified_date ||
      prior.effective_status !== source.effective_status
    ) {
      changed.add(source.id);
    }
    if (prior.supersedes_source_id !== source.supersedes_source_id) {
      changed.add(source.id);
      if (source.supersedes_source_id) changed.add(source.supersedes_source_id);
      if (prior.supersedes_source_id) changed.add(prior.supersedes_source_id);
    }
  }

  for (const id of previous.keys()) {
    if (!next.some((source) => source.id === id)) changed.add(id);
  }

  const changedSourceIds = [...changed];
  return {
    changedSourceIds,
    affectedPairIds: affectedPairsForSources(changedSourceIds)
  };
}

function bumpKind(before: SourceRegister, after: SourceRegister): 'patch' | 'minor' {
  const beforeIds = new Set(sourcesOf(before).map((source) => source.id));
  const afterSources = sourcesOf(after);
  if (afterSources.some((source) => !beforeIds.has(source.id))) return 'minor';
  if ([...beforeIds].some((id) => !afterSources.some((source) => source.id === id))) return 'minor';
  for (const source of afterSources) {
    const prior = sourcesOf(before).find((item) => item.id === source.id);
    if (!prior) continue;
    if (prior.supersedes_source_id !== source.supersedes_source_id) return 'minor';
  }
  return 'patch';
}

export function bumpVersion(version: string, kind: 'patch' | 'minor'): string {
  const parts = version.split('.');
  const major = Number(parts[0] ?? '0');
  const minor = Number(parts[1] ?? '0');
  const patch = Number(parts[2] ?? '0');
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function isoDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function bumpAndSeal(base: SourceRegister, draft: SourceRegister, today: string): SourceRegister {
  const next = cloneRegister(draft);
  const kind = bumpKind(base, draft);
  const nextVersion = bumpVersion(String(base.version), kind);
  next.version = nextVersion;
  const approval =
    next.approval_record && typeof next.approval_record === 'object'
      ? { ...next.approval_record }
      : {};
  approval.release_version = nextVersion;
  approval.approved_on = today;
  approval.effective_from = today;
  approval.supersedes = `AI_Governance_Global_Source_Register_v${base.version}`;
  next.approval_record = approval;
  return next;
}

function deriveRegisterLogicalPath(existingPath: string, version: string): string {
  if (typeof existingPath !== 'string' || existingPath.length === 0) {
    throw new Error('manifest entry not found');
  }
  const filename = `AI_Governance_Global_Source_Register_v${version}.json`;
  const slash = existingPath.lastIndexOf('/');
  if (slash === -1) return filename;
  return `${existingPath.slice(0, slash + 1)}${filename}`;
}

export function upsertSourceRegisterManifest(
  manifest: Record<string, unknown>,
  entry: { version: string; sha256: string }
): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  const current = findSourceRegisterManifestEntry(next);
  const logicalPath = typeof current.logical_path === 'string' ? current.logical_path : '';
  current.version = entry.version;
  current.sha256 = entry.sha256.toLowerCase();
  current.logical_path = deriveRegisterLogicalPath(logicalPath, entry.version);
  delete next.source_register;
  return sortKeysDeep(next) as Record<string, unknown>;
}

async function insertRevision(row: {
  version: string;
  sha256: string;
  gitCommitSha: string | null;
  driveFileId: string | null;
  status: RevisionStatus;
}): Promise<RevisionRow> {
  const db = getDbPool();
  const result = await db.query<RevisionRow>(
    `insert into register_revisions (version, sha256, git_commit_sha, drive_file_id, status)
     values ($1, $2, $3, $4, $5)
     returning id, version, sha256, git_commit_sha, drive_file_id, status`,
    [row.version, row.sha256, row.gitCommitSha, row.driveFileId, row.status]
  );
  const created = result.rows[0];
  if (!created) throw new Error('Failed to write register_revisions row.');
  return created;
}

async function updateRevision(
  id: string,
  patch: { status: RevisionStatus; driveFileId?: string | null }
): Promise<void> {
  const db = getDbPool();
  await db.query(
    `update register_revisions
        set status = $2,
            drive_file_id = coalesce($3, drive_file_id)
      where id = $1`,
    [id, patch.status, patch.driveFileId ?? null]
  );
}

async function insertSyncEvent(row: {
  revisionId: string;
  destination: 'GITHUB' | 'DRIVE';
  status: string;
  detail: string | null;
}): Promise<void> {
  const db = getDbPool();
  await db.query(
    `insert into sync_events (revision_id, destination, status, detail)
     values ($1, $2, $3, $4)`,
    [row.revisionId, row.destination, row.status, row.detail]
  );
}

async function findRevisionBySha256(sha256: string): Promise<RevisionRow | null> {
  const db = getDbPool();
  const result = await db.query<RevisionRow>(
    `select id, version, sha256, git_commit_sha, drive_file_id, status
       from register_revisions
      where sha256 = $1
      order by approved_at desc
      limit 1`,
    [sha256]
  );
  return result.rows[0] ?? null;
}

export type RegisterService = {
  snapshot(): RegisterSnapshot;
  saveDraft(candidate: unknown): DraftResult;
  impact(): RegisterImpact;
  draftClean(): boolean;
  pendingDraft(): SourceRegister | null;
  findings(): Finding[];
  approve(): Promise<ApproveResult>;
};

export function createRegisterService(options: {
  github: GitHubClient;
  drive: DriveClient;
  loadCurrent?: () => ReturnType<typeof loadSourceRegister>;
  authoritiesFolderId?: string;
  now?: () => Date;
}): RegisterService {
  const loadCurrent = options.loadCurrent ?? loadSourceRegister;
  let displayed: SourceRegister | null = null;
  let displayedSha256: string | null = null;
  let draft: SourceRegister | null = null;
  let draftFindings: Finding[] = [];
  let lastImpact: RegisterImpact = { changedSourceIds: [], affectedPairIds: [] };
  let pendingApproval: PendingApproval | null = null;

  function currentSnapshot(): RegisterSnapshot {
    if (displayed) {
      const content = serializeRegister(displayed);
      return {
        register: cloneRegister(displayed),
        version: displayed.version,
        sha256: displayedSha256 ?? sha256Hex(content)
      };
    }
    const loaded = loadCurrent();
    return {
      register: cloneRegister(loaded.register),
      version: loaded.version,
      sha256: loaded.sha256
    };
  }

  return {
    snapshot: currentSnapshot,

    saveDraft(candidate: unknown): DraftResult {
      const current = currentSnapshot();
      const validation = validateRegister(candidate);
      lastImpact =
        validation.ok && typeof candidate === 'object' && candidate !== null
          ? computeImpact(current.register, candidate as SourceRegister)
          : { changedSourceIds: [], affectedPairIds: [] };
      if (!validation.ok) {
        draft = null;
        draftFindings = validation.findings;
        pendingApproval = null;
        return { ok: false, findings: validation.findings, impact: lastImpact };
      }
      draft = cloneRegister(candidate as SourceRegister);
      draftFindings = [];
      pendingApproval = null;
      return { ok: true, findings: [], impact: lastImpact, register: cloneRegister(draft) };
    },

    impact() {
      return lastImpact;
    },

    draftClean() {
      return Boolean(draft) && draftFindings.length === 0;
    },

    pendingDraft() {
      return draft ? cloneRegister(draft) : null;
    },

    findings() {
      return draftFindings;
    },

    async approve(): Promise<ApproveResult> {
      const current = currentSnapshot();
      const today = isoDate(options.now ? options.now() : new Date());

      if (!pendingApproval) {
        if (!draft) {
          return {
            ok: false,
            status: 'COMMITTED',
            version: current.version,
            sha256: current.sha256,
            gitCommitSha: null,
            driveFileId: null,
            revisionId: '',
            findings: [{ code: 'NO_DRAFT', path: '/', message: 'No validated draft to approve.' }]
          };
        }
        const sealed = bumpAndSeal(current.register, draft, today);
        const validation = validateRegister(sealed);
        if (!validation.ok) {
          return {
            ok: false,
            status: 'COMMITTED',
            version: current.version,
            sha256: current.sha256,
            gitCommitSha: null,
            driveFileId: null,
            revisionId: '',
            findings: validation.findings
          };
        }
        const content = serializeRegister(sealed);
        pendingApproval = {
          register: sealed,
          content,
          sha256: sha256Hex(content),
          version: sealed.version,
          message: `register: source register v${sealed.version} (approved ${today})`
        };
      }

      const pending = pendingApproval;
      const existing = await findRevisionBySha256(pending.sha256);
      if (existing?.status === 'SYNCED') {
        displayed = pending.register;
        displayedSha256 = pending.sha256;
        draft = null;
        pendingApproval = null;
        return {
          ok: true,
          status: 'SYNCED',
          version: existing.version,
          sha256: existing.sha256,
          gitCommitSha: existing.git_commit_sha,
          driveFileId: existing.drive_file_id,
          revisionId: existing.id,
          findings: []
        };
      }

      let revision = existing;
      if (!revision) {
        try {
          const fileSha = await options.github.getFileSha(SOURCE_REGISTER_FILENAME);
          const committed = await options.github.commitFile(
            SOURCE_REGISTER_FILENAME,
            pending.content,
            pending.message,
            fileSha
          );
          revision = await insertRevision({
            version: pending.version,
            sha256: pending.sha256,
            gitCommitSha: committed.commitSha,
            driveFileId: null,
            status: 'COMMITTED'
          });
          await insertSyncEvent({
            revisionId: revision.id,
            destination: 'GITHUB',
            status: 'SUCCESS',
            detail: committed.commitSha
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            status: 'COMMITTED',
            version: pending.version,
            sha256: pending.sha256,
            gitCommitSha: null,
            driveFileId: null,
            revisionId: '',
            findings: [{ code: 'GITHUB', path: '/', message }],
            error: message
          };
        }
      }

      displayed = pending.register;
      displayedSha256 = pending.sha256;

      try {
        const folderId = options.authoritiesFolderId ?? driveAuthoritiesFolderId();
        const name = `AI_Governance_Global_Source_Register_v${pending.version}.json`;
        const uploaded = await options.drive.uploadVersionedFile(folderId, name, pending.content);
        const manifest = await options.drive.readManifest();
        await options.drive.writeManifest(
          upsertSourceRegisterManifest(manifest, {
            version: pending.version,
            sha256: pending.sha256
          })
        );
        await updateRevision(revision.id, { status: 'SYNCED', driveFileId: uploaded.fileId });
        await insertSyncEvent({
          revisionId: revision.id,
          destination: 'DRIVE',
          status: 'SUCCESS',
          detail: uploaded.fileId
        });
        draft = null;
        pendingApproval = null;
        return {
          ok: true,
          status: 'SYNCED',
          version: pending.version,
          sha256: pending.sha256,
          gitCommitSha: revision.git_commit_sha,
          driveFileId: uploaded.fileId,
          revisionId: revision.id,
          findings: []
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await updateRevision(revision.id, { status: 'SYNC_FAILED' });
        await insertSyncEvent({
          revisionId: revision.id,
          destination: 'DRIVE',
          status: 'FAILED',
          detail: message
        });
        return {
          ok: false,
          status: 'SYNC_FAILED',
          version: pending.version,
          sha256: pending.sha256,
          gitCommitSha: revision.git_commit_sha,
          driveFileId: revision.drive_file_id,
          revisionId: revision.id,
          findings: [],
          error: message
        };
      }
    }
  };
}
