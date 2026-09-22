# Cursor Task Brief — Phase 1.6: Manifest Byte Format on the Write Path (P1.6)

**Brief ID:** P1.6
**Phase:** 1 (hardening follow-up to PR #25; closes retrospective finding R1)
**Branch:** `phase1-manifest-write-format` (from `main`)
**Commit / PR title:** `phase1: manifest byte format on write path (P1.6)`
**Estimated size:** tiny (1 source file + 1 test file; one optional cleanup)
**Gate:** must merge **before** the live e2e run on Railway — the first real approve must not upload pretty-printed manifest bytes.

## 1. Purpose

PR #25 fixed *which* manifest entry is written, and implemented `serializeManifest` (compact JSON, deep-sorted keys, exactly one trailing newline). But the function that actually writes to Drive — `src/register/drive.ts` `writeManifest` — still serializes with `JSON.stringify(manifest, null, 2) + '\n'` (pretty-printed). The P1.5 brief required the compact byte format so Drive version history stays a minimal diff on every approve. This brief closes that gap. (Root cause was a scope omission in the P1.5 brief, not an implementation error; Cursor disclosed it correctly.)

## 2. Ground rules (binding)

- AGENTS.md applies. Fail closed; no silent fallbacks; no secrets in code or tests.
- One task = one branch = one PR. Touch only what §3 lists.
- Do not modify: `golden/`, `baseline/`, `schemas/`, `migrations/`, the old-pipeline directories, `src/pipeline/`, `tests/pipeline/`, the root register file.

## 3. Scope

**In:** `src/register/drive.ts` (only `writeManifest`), `tests/register/` (one test for the write-path serialization).
**Optional (in, if trivial):** remove the now-unused optional `gitSha256` parameter from `checkRegisterDrift` in `src/register/drift.ts` (retrospective finding R2). If any caller still passes it, leave the parameter and say so in the PR.
**Out:** everything else — including the upload path, token handling, and any refactor.

## 4. Required change

1. `writeManifest` must upload exactly `serializeManifest(manifest)` bytes — compact JSON, deep lexicographically sorted keys, exactly one trailing `\n`. Import `serializeManifest` from `src/register/service.ts` (it is already exported). If that import creates a cycle, say so in the PR and instead move `serializeManifest`/`sortKeysDeep` into a small shared module (e.g. `src/register/manifest-format.ts`) used by both — that is the only structural change allowed.
2. The ordering contract is unchanged: `upsertSourceRegisterManifest` decides *content*, `serializeManifest` decides *bytes*, `writeManifest` must not reformat.
3. No behavior change to `readManifest`, `uploadVersionedFile`, or auth.

## 5. Tests (`tests/register/`, vitest)

1. **Write-path byte test:** a fake/stub around the Drive write (or a refactor seam you introduce minimally) proves that the bytes passed to the Drive update call equal `serializeManifest(manifest)` — assert: compact (no `": "` / no newline-indentation), keys deep-sorted, exactly one trailing `\n`. Prefer capturing the body at the `fetch` boundary with a stubbed `fetch`; do not hit the network.
2. Regression: existing `tests/register/drift.test.ts` serialization test stays green unchanged.

## 6. Acceptance checks

1. `npm run typecheck` green.
2. `npx vitest run tests/register` green, including the new byte-level test.
3. Diff touches only the files listed in §3.
4. PR body shows the exact bytes assertion and states explicitly: live e2e not run (owner runs it on Railway after merge).
5. Note: repo-wide `npm run verify` remains red until P2A-FIX lands (missing A1 recordings — separate brief, in flight). That known failure does not block this PR; state it in the PR body rather than "fixing" it here.

## 7. Reporting

Verified facts with commands only. Anything not run is "not run". If §4.1 reveals an import cycle or any conflict with the code as found, stop and report instead of improvising.

## 8. Process

This PR goes to Kimi for review **before** merge. The owner merges after that review.
