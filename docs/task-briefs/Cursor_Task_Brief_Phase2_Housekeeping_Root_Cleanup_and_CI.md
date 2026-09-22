# Cursor Task Brief — Phase 2 Housekeeping: Root Cleanup + CI (P2-HK)

**Brief ID:** P2-HK
**Author:** Kimi (reviewer / task-director)
**Date:** 2026-09-22
**Repo:** `jorieskolin-creator/AI-Governance-KB-Maintainer-Tool` · base branch `main`
**Branch:** `phase2-housekeeping-ci` · **Commits:** `phase2: <what> (P2-HK)`
**Rule reminder:** one task = one branch = one PR. AGENTS.md is binding; if anything here conflicts with it, stop and ask.

## Why this task exists (context)

P2B (state model merge) is gated behind the live end-to-end run on Railway and Kimi's retrospective review of PRs #25/#26. This brief is deliberately scoped work that is safe to do in the meantime: it removes confirmed-duplicate files from the repo root and adds CI so every future PR runs `npm run verify` automatically. **Do not start any P2B/P2C work under this brief.**

## Scope — what to do

### 1. Delete the duplicate Tactic Playbook JSON at repo root

- File: `/AI_Governance_Tactic_Playbook_v1.0.0.json` (214,389 B).
- The governed copy lives at `baseline/AI_Governance_Tactic_Playbook_v1.0.0.json` and is the one referenced by tests and tooling.
- **Precondition (verify before deleting, show output in the PR):**
  - `sha256` of the root copy **and** of `baseline/AI_Governance_Tactic_Playbook_v1.0.0.json` must both equal `98ba7390ac81351287ec633add49b7349f5bf5989d7fa5a1d259b2a4a4c7486e`.
  - If either hash differs, **stop** — do not delete; report the mismatch in the PR and wait.
- After deletion, grep the repo for `AI_Governance_Tactic_Playbook_v1.0.0` and confirm every remaining reference points to `baseline/…`.

### 2. Delete the superseded playbook candidate snapshot PDF at repo root

- File: `/AI_Governance_Tactic_Playbook_Current_Candidate_Snapshot_2026-08-20.pdf` (~999 KB).
- Status: superseded by approved Tactic Playbook v1.0.0; code search shows zero references to this filename in code, tests, or docs. Git history retains it, so provenance is recoverable.
- After deletion, grep for `Candidate_Snapshot` and confirm no live reference remains (text mentions inside the playbook JSONs are fine and must not be edited).

### 3. Add CI: `.github/workflows/verify.yml`

- No `.github/` directory exists today; create it.
- Triggers: `push` to `main`, and `pull_request` targeting `main`.
- Runner: `ubuntu-latest`; Node **20** (the `engines` floor), with npm cache.
- Steps: checkout → setup-node → `npm ci` → `npm run verify`.
- `npm run verify` = typecheck + vitest + build + golden regression. If any test requires environment variables or a database to run in CI, supply non-secret stubs/services in the workflow (e.g. a Postgres service container) as minimally as possible — **no real secrets, ever**. If a test cannot run in CI honestly, do not skip it silently; report it in the PR instead.
- Paste the green CI run link in the PR description.

### 4. Node engines alignment (small, bounded)

- `package.json` currently declares `"engines": { "node": ">=20" }`.
- Confirm which Node version Railway actually deploys (check repo config such as `railway.toml`/`nixpacks.toml`/Dockerfile if present; otherwise state in the PR that the deployed version could not be determined from the repo).
- If determinable: set `engines` to match the deployed major (e.g. `>=20 <23` or the exact line Railway uses) and use that same version in the CI workflow. If not determinable: keep `>=20`, use Node 20 in CI, and record the assumption in the PR description.

## Explicitly OUT OF SCOPE — do not touch

- **`/AI_Governance_Global_Source_Register_v1.5.0.json` (repo root) — DO NOT move, rename, or delete.** Verified 2026-09-22: `src/assets/load.ts` loads this exact filename from the repo root at boot (`SOURCE_REGISTER_FILENAME`); it is the runtime operational master. It is also referenced by `src/baseline/repo-artifacts.ts`, `src/operator/board.ts`, and multiple tests. Relocating it is a P2B/P2C-era decision, not housekeeping.
- **`/MAINTAINER_CORRECTIVE_PLAN.md`** — declared superseded in AGENTS.md and kept for reference; AGENTS.md references it by this path. Leave it.
- `golden/`, `baseline/` (other than reading it for the hash check), `schemas/`, `migrations/` — governed assets; changed only via governed flows.
- `src/cognitive/`, `src/sir/`, `src/orchestration/`, `src/validation/`, `src/release/`, `src/compiler/` — old pipeline; consolidation happens in P2C, not here.
- `run-*-check.ts` scripts — deleted in P2C, not here.
- No refactoring of adjacent code. If you notice something wrong outside this scope, record it in the PR description as an observation — do not fix it.

## Acceptance checks (definition of done)

1. Hash precondition output for both playbook copies shown in the PR, both matching `98ba7390…7486e` (else the PR must not delete anything).
2. Root playbook JSON and candidate-snapshot PDF deleted; grep evidence in the PR that no live references remain.
3. `.github/workflows/verify.yml` added; CI run on this PR is green; link included.
4. `engines` decision recorded per §4 (aligned value or documented assumption).
5. `npm run typecheck` and `npm run verify` green locally.
6. The diff touches **only**: the two deletions, `.github/workflows/verify.yml`, and (if §4 applies) `package.json`/`package-lock.json` engines lines. Anything else in the diff must be justified line-by-line in the PR.

## Reporting

In the PR description: what was done, the hash/grep evidence, the CI link, the engines decision, any acceptance check you could **not** satisfy (state it explicitly — never mark complete with failing or skipped checks), and any out-of-scope observations.

## Process note

Per the corrected workflow, this PR is reviewed by Kimi **before** merge. Do not merge on your own approval; the owner merges after Kimi's review.
