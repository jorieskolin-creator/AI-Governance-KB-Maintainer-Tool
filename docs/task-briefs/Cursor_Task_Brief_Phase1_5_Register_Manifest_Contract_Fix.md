# Cursor Task Brief — Phase 1.5: Register Manifest Contract Fix (P1.5)

**Brief ID:** P1.5
**Phase:** 1 (hardening follow-up to PR #24)
**Branch:** `phase1-register-manifest-fix` (from `main`)
**Commit / PR title:** `phase1: register manifest contract fix (P1.5)`
**Estimated size:** small (2–4 source files + tests)

## 1. Purpose

PR #24 delivered the register maintenance kernel. Post-merge review found that its manifest integration targets a manifest structure that does not exist in the real authority file, and that its drift check hashes the local working copy instead of the current Git content. This task fixes both **before the first live approve is ever executed**.

## 2. Context

- The real Drive manifest (`knowledge-base-manifest.json`, env `DRIVE_MANIFEST_FILE_ID`) stores the source register as **one entry in the top-level `machine_authority` array**. There is no top-level `source_register` key and no `assets[]` array. Do not introduce them.
- Current entry as found in the live manifest (v2.0.0; the pending v2.1.0 update changes only this entry's `logical_path` prefix to `02 Authorities/` — code must not depend on the prefix):

```json
{
  "canonical_identity": "AI-GOV-SOURCE-REGISTER",
  "logical_path": "04 Global Registers/AI_Governance_Global_Source_Register_v1.5.0.json",
  "release_status": "APPROVED",
  "role": "SOURCE_REGISTER",
  "schema_version": "2.1.0",
  "sha256": "0c1d154dc9774d7e2976b637aa865c6bf932b2fd4ae9ac546b7fb8de092fe764",
  "version": "1.5.0"
}
```

- The manifest is serialized as **compact JSON with deep lexicographically sorted keys and a single trailing newline**. Preserve this byte format so Drive version history stays a minimal diff on every approve.
- Root-cause note: the Phase 1 brief did not specify where in the manifest the register is recorded; the implementation guessed. This brief pins the contract exactly. Do not redesign beyond it.

## 3. Ground rules (binding, from AGENTS.md)

- Fail closed. No silent fallbacks. If the manifest entry is missing, that is an explicit error state — never invent a location.
- Git is the operational master; Drive is the approved mirror. Drift compares **Git content** against the **manifest record** — nothing else.
- One task = one branch = one PR. Touch only what this brief lists.
- Secrets stay in env. No credentials in code, tests, fixtures, or PR text.
- Do not modify: `golden/`, `baseline/`, `schemas/`, `migrations/`, `src/cognitive/`, `src/sir/`, `src/orchestration/`, `src/validation/`, any `run-*-check.ts`, the root register file `AI_Governance_Global_Source_Register_v1.5.0.json`.

## 4. Scope

**In:** `src/register/drift.ts`, `src/register/service.ts` (only `upsertSourceRegisterManifest`), `src/register/ports.ts` (one added method), `src/register/github.ts` (its implementation), `src/operator/render-home.ts` + `src/operator/routes.ts` (only to consume the fixed drift result), `tests/register/`.

**Out:** everything else — including the version-bump logic, the Drive upload path, the DB schema, and any unrelated refactor.

## 5. Required changes

### 5.1 `upsertSourceRegisterManifest` — write to the real entry
1. Find the `manifest.machine_authority[]` entry with `canonical_identity === "AI-GOV-SOURCE-REGISTER"`. If absent → throw (fail closed).
2. Update **in place, and only**:
   - `version` ← the new register version,
   - `sha256` ← sha256 (lowercase hex) of the exact serialized register bytes committed to Git,
   - `logical_path` ← `<prefix of the existing logical_path>/AI_Governance_Global_Source_Register_v<newVersion>.json` — derive the prefix from the existing entry, never hardcode a folder name.
3. Preserve all other keys of the entry and all other entries/keys of the manifest.
4. If a top-level `source_register` key exists (written by the Phase 1 implementation), remove it.
5. Serialize the manifest with deep-sorted keys, compact separators, and exactly one trailing newline. No pretty-printing.

### 5.2 `sha256FromManifest` — read from the real entry
- Same lookup (`machine_authority` + `canonical_identity`). Return the entry's `sha256` and `version`.
- Delete the current fallback chain (top-level `source_register` key / top-level `sha256` / `assets[]`). An absent entry is an explicit "manifest entry not found" state surfaced to the caller — not a silent null.

### 5.3 Drift compares Git content, not local disk
- Add `readFileContent(path): Promise<string>` to the `GitHubClient` port (Contents API GET on `GITHUB_BRANCH`, base64-decoded).
- `checkRegisterDrift` and the home drift view compute sha256 of the **current Git content** of the register file at repo root, and compare it with the manifest entry from 5.2. **No filesystem reads anywhere in the drift path.**
- The boot-time drift check stays warn-only; if the Git fetch or the manifest read fails, report drift state `UNKNOWN` — never silently "in sync", never crash boot.

### 5.4 One drift source for all UI
- The home banner and the register page must render the same service-computed drift result (5.3). Remove the independent disk read from the home renderer so the two pages cannot disagree.

## 6. Tests (`tests/register/`, vitest)

Fixture manifest: a structural miniature containing `manifest_version`, `golden_standard`, and 3 `machine_authority` entries, one being the source-register entry from §2. Cover:

1. Upsert updates exactly `version` / `sha256` / `logical_path` of the right entry; everything else deep-equal before/after; entry count unchanged.
2. `logical_path` prefix is derived from the existing entry (test with both `04 Global Registers/` and `02 Authorities/` prefixes).
3. A shadow top-level `source_register` key is removed if present and never created if absent.
4. Serialized manifest is compact, keys deep-sorted, ends with exactly one `\n`.
5. Drift: FakeGitHub content matching the entry → `IN_SYNC`; differing content → `MISMATCH` with both hashes shown; FakeGitHub throwing → `UNKNOWN` (no exception escapes).
6. Missing manifest entry → explicit failure, no fallback.

## 7. Acceptance checks

1. Typecheck green (repo's existing script).
2. `npx vitest run` green, including the new tests.
3. `grep -riE "anthropic|openai|@ai-sdk|ai-sdk" src/register src/assets` → no hits.
4. The diff touches only the files listed in §4.
5. Live e2e is **not** part of this PR — the owner runs it on Railway after merge. The PR body must state this explicitly.

## 8. PR requirements

- Branch `phase1-register-manifest-fix` from latest `main`; single commit `phase1: register manifest contract fix (P1.5)`.
- PR body: what was wrong (one paragraph), what changed (bullets mapped to §5), evidence (commands + output summaries), and the explicit statement that live e2e was not run.

## 9. Reporting

Report only what you verified, with commands. Anything not run is "not run" — never implied. If any part of §5 conflicts with the code as found, stop and report the conflict instead of improvising.
