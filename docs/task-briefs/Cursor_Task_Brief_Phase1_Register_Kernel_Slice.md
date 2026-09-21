# Task Brief — Phase 1: Source Register Maintenance Kernel Slice

**Brief ID:** P1 | **Phase:** 1 | **Estimated effort:** ~1 week
**Branch:** `phase1-register-kernel` | **One PR** (split into two only if it exceeds ~1,500 LOC).
**Authority:** `docs/MAINTAINER_IMPLEMENTATION_PLAN.md` §4 Phase 1; rules in `AGENTS.md`.
**Prerequisite:** Phase 0 PR merged; `GITHUB_TOKEN` and Drive credentials set in env;
Postgres available in the dev/cloud environment.

## Purpose

Prove the entire Maintainer skeleton with **zero AI**: a Source Register change flows
UI → deterministic schema validation → operator approval → GitHub commit → Drive sync →
hash-verified drift check. Everything in later phases reuses this skeleton.

## Hard constraints

- **No model/provider calls.** Do not import or touch anything under `src/ai/`,
  `src/cognitive/`, `src/sir/`, or `src/orchestration/`.
- **Fail closed.** A schema-invalid register can never be approved or committed.
  A failed Drive sync leaves Git intact and records a FAILED sync event — never silent.
- **DRAFT-tier simplicity:** whole-document AJV validation against
  `schemas/source-register.schema.json` is the only gate. No hash ceremony beyond
  recording sha256 of content.

## Files to CREATE

### Asset loading + validation

- `src/assets/load.ts` — at server boot, read the source register JSON **from repo root**
  (`AI_Governance_Global_Source_Register_v1.5.0.json`) and `schemas/source-register.schema.json`;
  expose `{ register, version, sha256 }`. Fail boot with a clear error if either file is
  missing or the register fails validation.
- `src/assets/validate.ts` — AJV 2020-12 (`ajv/dist/2020` + `ajv-formats`, `strict: false`).
  `validateRegister(candidate)` → `{ ok: boolean, findings: Finding[] }` where
  `Finding = { code: string, path: string, message: string }` mapped from AJV errors.

### Register service (with injectable ports)

- `src/register/ports.ts` — interfaces:
  ```typescript
  export interface GitHubClient {
    getFileSha(path: string): Promise<string | null>;
    commitFile(path: string, content: string, message: string, sha: string | null): Promise<{ commitSha: string }>;
  }
  export interface DriveClient {
    uploadVersionedFile(folderId: string, name: string, content: string): Promise<{ fileId: string }>;
    readManifest(): Promise<Record<string, unknown>>;
    writeManifest(manifest: Record<string, unknown>): Promise<void>;
  }
  ```
- `src/register/service.ts` — draft edit → validate → impact flags → approve orchestration.
  Impact flagging: list source IDs whose `last_verified_date`/`effective_status` changed or
  that were added/superseded; Phase 1 has no published pairs yet, so the impact list is
  computed and stored but will be empty — the code path must exist and be tested.
- `src/register/github.ts` — real `GitHubClient` using the Contents API
  (`GET/PUT /repos/{owner}/{repo}/contents/{path}`). Env: `GITHUB_TOKEN`, `GITHUB_REPO`
  (`owner/repo`). Commit message: `register: source register v<version> (approved YYYY-MM-DD)`.
- `src/register/drive.ts` — real `DriveClient`. Env: `DRIVE_CREDENTIALS_JSON` (or OAuth
  equivalent), `DRIVE_AUTHORITIES_FOLDER_ID`, `DRIVE_MANIFEST_FILE_ID`. Upload as new
  versioned file `AI_Governance_Global_Source_Register_v<version>.json`; then update
  `knowledge-base-manifest.json` (version + sha256). Idempotent: re-running with identical
  content must verify the existing file's hash instead of duplicating it.
- `src/register/routes.ts` — Fastify routes (below).
- `src/register/drift.ts` — compare current Git content sha256 vs manifest-recorded sha256;
  run on boot and expose via endpoint.

### Database (one new migration: `migrations/0008_register_maintenance.sql` + drizzle schema in `src/db/schema.ts`)

- `register_revisions`: `id`, `version`, `sha256`, `approved_at`, `git_commit_sha`,
  `drive_file_id`, `status` (`COMMITTED | SYNCED | SYNC_FAILED`)
- `sync_events`: `id`, `revision_id`, `destination` (`GITHUB | DRIVE`), `status`,
  `attempted_at`, `detail`

Never edit migrations 0001–0007; this is a new, additive migration.

### Operator UI (follow the existing `src/operator/` server-rendered patterns, e.g. `render-home.ts`)

- Register page: list sources; per-entry edit form (add source / update
  `last_verified_date` / mark superseded via `supersedes_source_id`).
- Validation findings rendered inline on save attempt (fail-closed, HTTP 422 + findings).
- Approve button enabled only when validation is clean; on approve, version bump
  (patch: date-only changes; minor: add/supersede) then GitHub commit → Drive sync.
- Drift banner on operator home when Git hash ≠ Drive manifest hash.

### Tests (vitest, `tests/register/`)

1. Valid edit passes validation; invalid edit returns precise findings (path + message).
2. Approve with fake `GitHubClient`/`DriveClient` → commit called with correct message;
   revision row written; Drive upload called with versioned filename.
3. Drive failure → revision `SYNC_FAILED`, sync event FAILED; retry succeeds and flips
   to `SYNCED`. Git commit is never rolled back or duplicated.
4. Drift check: matching hashes → clear; mismatched → reported.
5. Boot fails loudly when register JSON violates the schema (temp fixture).

## Endpoints

| Method | Path | Behavior |
|---|---|---|
| GET | `/operator/register` | Current register + version + sha256 |
| POST | `/operator/register/draft` | Validate edit; 200 + findings summary or 422 + findings |
| GET | `/operator/register/impact` | Changed source IDs + affected pairs (empty list OK) |
| POST | `/operator/register/approve` | Clean-validation gate → GitHub commit → Drive sync → revision record |
| GET | `/operator/register/drift` | Git vs Drive hash comparison |

## DO NOT TOUCH

- `src/ai/`, `src/cognitive/`, `src/sir/`, `src/orchestration/`, `src/validation/`,
  `src/release/`, `src/compiler/`, `golden/`, `schemas/`, `baseline/`, the root-level
  register JSON (the tool writes the register to Git **via the GitHub API only** — never by
  mutating the local file), migrations 0001–0007, `run-*-check.ts`.
- No refactoring of existing code. Observations go in the PR description.

## Acceptance checks (all must pass; report output in the PR)

1. `npm run typecheck` — green.
2. `npx vitest run` — green, including the 5 new register tests.
3. `grep -rE "src/ai|cognitive|orchestration" src/register src/assets` — no hits.
4. Manual e2e in the deployed environment (owner + agent together): real register edit →
   UI → validation → approval → visible GitHub commit → new versioned file in Drive
   `02 Authorities/` → manifest sha256 updated → drift endpoint reports match.
5. Negative e2e: deliberately broken edit rejected with precise findings; forced Drive
   failure (bad folder id) leaves Git commit intact and retries cleanly.
