# Cursor Task Brief — Phase 2A Fix: Golden-Parity A1 Recordings (P2A-FIX)

**Brief ID:** P2A-FIX
**Author:** Kimi (reviewer / task-director)
**Date:** 2026-09-22
**Repo:** `jorieskolin-creator/AI-Governance-KB-Maintainer-Tool` · base branch `main`
**Branch:** `phase2-golden-parity-recordings` · **Commits:** `phase2: <what> (P2A-FIX)`
**Rule reminder:** one task = one branch = one PR. AGENTS.md is binding; on conflict, stop and ask.

## 1. Purpose

Discharge the open P2A acceptance debt: PR #26 merged with acceptance checks 1–2 failing (`npm run verify` red, golden-parity red) because `tests/pipeline/recordings/A1/` was never populated. PR #27 then added CI, so `main` now has a permanently red gate. This brief restores `verify` to green on `main` — honestly, without synthesizing model semantics, editing golden fixtures, or weakening the test.

## 2. Verified facts (2026-09-22, verified against `main` by Kimi)

- `tests/pipeline/golden-parity.test.ts` calls `authorOfflineA1()`, which requires seven files under `tests/pipeline/recordings/A1/`: `SOURCE_CONTEXT.json`, `PAIR_FRAME.json`, `EVIDENCE_AND_SAFETY.json`, `MAPPINGS.json`, `PAIR_COHERENCE_REVIEW.json`, plus compiler inputs `authoring-plan.json` and `snapshot.json`. None exist.
- No A1 recordings exist in the old world: `src/compiler/sir-compile-fixture.ts` is pair A2, and the `run-*-check.ts` embedded fixtures are not recorded A1 model task outputs (confirmed in both #26 and #27 PR evidence).
- The golden fixtures `golden/fixtures/A1_v1.0.0.json` and `AP-A1_v1.0.0.json` are schema_version **2.0.0** calibration exemplars (`golden/golden-reference.manifest.json`, `normative: false`); the active production schema family is 2.1.0.
- Live model calls are **not** a solution here: P2A rules forbid provider calls in this slice, fresh model output would not deep-equal the manual-era golden fixtures, and the first live pair is P3's job.

## 3. Task

Produce the seven A1 recording files by **deterministic derivation from approved artifacts** — never by hand-inventing semantics and never by model calls:

1. **Write a derivation script** `tests/pipeline/derive-a1-recordings.ts` (plus an npm script `recordings:derive`) that reads `golden/fixtures/A1_v1.0.0.json`, `golden/fixtures/AP-A1_v1.0.0.json`, and the input contract of the unmodified `src/compiler/sir-compiler.ts`, and emits the seven recording files under `tests/pipeline/recordings/A1/`. The script must be deterministic: re-running it produces byte-identical files. It must not import from `src/pipeline/` validators (no validate-then-fix loops against the thing under test).
2. **Run it and commit the outputs.** Each task recording must pass its module's RELEASE validator as-is. The compiler, fed `authoring-plan.json` + `snapshot.json`, must deep-equal the golden fixtures.
3. **Provenance record:** add `tests/pipeline/recordings/A1/README.md` stating plainly: these files were deterministically derived from the approved golden fixtures on 2026-09-22 via `recordings:derive` — they are **not** captured model runs. State what the parity test proves after this change (compiler + validators + plumbing regression anchor) and what it does **not** prove (semantic parity with live model output — that proof obligation belongs to P3's first live pair).
4. **AGENTS.md staleness fix (explicitly allowed, only this):** update the "Current phase boundary (Phases 0–1)" section to reflect that Phase 2 is underway and `npm run verify` exists and must be green. No other AGENTS.md edits.

## 4. Stop-and-report conditions (findings, not workarounds)

Stop and report in the PR — do not force a match — if any of these occur:

- A faithfully derived recording is rejected by a RELEASE validator (indicates a kernel-contract vs. golden-artifact mismatch → finding for Kimi).
- `authoring-plan.json` / `snapshot.json` fields required by `compileSirPair` cannot be recovered from the golden fixtures and old-world A1 artifacts (report exactly which fields are unrecoverable — do not invent values).
- The schema 2.0.0 (fixtures) vs. 2.1.0 (production) gap makes deep-equality structurally impossible without editing golden fixtures or the compiler (both forbidden). In that case the correct output of this brief is a **finding + proposed test-contract change**, not a rigged pass.

## 5. Binding constraints

- Do not modify: `golden/`, `baseline/`, `schemas/`, `migrations/`, `src/compiler/`, `src/pipeline/` modules, the old-pipeline directories, the register kernel. (If a `src/pipeline/` change seems necessary, that is a stop-and-report.)
- No provider/network calls; no secrets; tests must pass without credentials.
- Do not skip, mute, or weaken `golden-parity.test.ts` or any other test.
- The diff may touch only: `tests/pipeline/derive-a1-recordings.ts`, `tests/pipeline/recordings/A1/**` (seven files + README), `package.json` (the `recordings:derive` script), and the one AGENTS.md section. Justify any other line.

## 6. Acceptance checks (definition of done)

1. `npm run recordings:derive` re-run produces byte-identical recording files (show before/after hashes).
2. `npm run verify` green locally — full chain: typecheck, vitest (including golden-parity), build, golden regression.
3. CI green on this PR — paste the Actions run link.
4. Provenance README present and accurate per §3.3.
5. Zero-AI grep on the new script clean; no network/provider usage.
6. Any §4 condition encountered is reported as a finding with exact field/task names — never worked around.

## 7. Reporting

PR body: what was derived and from which exact inputs, the hash evidence for §6.1, the verify/CI evidence, the honest statement of parity strength (§3.3), and explicit listing of anything not done. Missing evidence stays missing — absence proves nothing.

## 8. Process

This PR goes to Kimi for review **before** merge. The owner merges after that review. (Note for the record: #25, #26, and #27 were all merged without that review — #26 and #27 with `verify` red. This brief exists partly to make `main` green again so the CI gate means something.)
