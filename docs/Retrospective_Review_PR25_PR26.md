# Retrospective Review — PR #25 (P1.5) and PR #26 (P2A)

**Reviewer:** Kimi · **Date:** 2026-09-22 · **Scope:** diffs vs. briefs, acceptance checks, AGENTS.md invariants
**Trigger:** both PRs were merged without Kimi review (#26 also with disclosed red acceptance checks). Findings here become fix-briefs per the operating model.

---

## PR #25 — `phase1: register manifest contract fix (P1.5)`

### Verdict: faithful implementation of the brief. One HIGH residual — disclosed by Cursor, caused by a gap in my own brief — must be fixed before the first live approve.

### What checks out (verified against the diff, not just the PR body)

- **§5.1** `upsertSourceRegisterManifest` now finds the `machine_authority[]` entry by `canonical_identity === "AI-GOV-SOURCE-REGISTER"`, throws if absent, updates only `version`/`sha256`/`logical_path`, derives the `logical_path` prefix from the existing entry (never hardcodes a folder), removes a shadow top-level `source_register` key, and deep-sorts. ✅
- **§5.2** `sha256FromManifest` reads the same entry and returns `{ sha256, version }`; the old fallback chain (`source_register` / top-level `sha256` / `assets[]`) is deleted — the test proves all three legacy shapes now throw `manifest entry not found`. ✅
- **§5.3** `GitHubClient.readFileContent` does a Contents API GET with `ref=<GITHUB_BRANCH>` and base64-decodes; `checkRegisterDrift` hashes **Git content**, never the filesystem; Git or Drive failure → drift state `UNKNOWN`, boot stays warn-only. ✅
- **§5.4** Home banner and register page consume the same service-computed `DriftReport`; the home renderer's independent disk read is gone; a thrown check renders as `UNKNOWN`, not silent in-sync. ✅
- **Tests (§6):** all six required cases present and meaningful (field-precise upsert, both path prefixes, shadow-key removal, compact/sorted/one-newline serialization, IN_SYNC/MISMATCH/UNKNOWN tri-state, fail-closed missing entry). ✅
- **Diff scope (§7.4):** exactly the eight files listed in §4. ✅
- **Honesty (§7.5):** PR body explicitly states live e2e was not run. ✅

### Findings

**R1 — HIGH — `writeManifest` still pretty-prints; the byte-format contract is not applied on the real write path.**
Brief §5.1.5 requires the manifest serialized compact, deep-sorted, one trailing newline, so Drive version history stays a minimal diff. Cursor implemented and tested `serializeManifest` — but `src/register/drive.ts` `writeManifest` still does `JSON.stringify(manifest, null, 2) + '\n'`. **The first live approve on Railway would upload pretty-printed bytes.** Cursor disclosed this correctly in the PR ("Changing the Drive writer is outside brief §4") — and it was right to stop: my P1.5 brief demanded a serialization contract in §5 while excluding `drive.ts`, the only file that performs the serialization, from scope in §4. That is a brief-authoring error (mine), not an implementation error. **Fix-brief P1.6 issued; must merge before the live e2e run.**

**R2 — LOW — dead parameter.** `checkRegisterDrift` still accepts an optional `gitSha256` that is now never used. Cosmetic; cleanup folded into P1.6 as optional.

**R3 — observation, no action.** A missing manifest entry surfaces as `MISMATCH` with detail `manifest entry not found` rather than `UNKNOWN`. Defensible (the manifest read succeeded; the register is provably not verifiable as in-sync) and explicitly surfaced — recorded so the live e2e expects this state.

---

## PR #26 — `phase2: pipeline contract kernel (P2A)`

### Verdict: high-quality kernel; AGENTS.md invariants held. Acceptance checks 1–2 were red at merge (disclosed) — fix already dispatched as P2A-FIX. Three disclosed gaps must become explicit requirements in the P3 brief.

### What checks out (verified against the full diff — 17 files: `package.json` + 10 `src/pipeline/` modules + 6 test files)

- **Acceptance 3 (zero-AI / import boundary):** `src/pipeline/` imports are Node stdlib, `ajv`/`ajv-formats`, `src/compiler/`, and itself. No AI SDKs, no `fetch`/network, no old-world imports. ✅ (Tests intentionally import old-world builders for parity comparison — by design; P2C must migrate these when the old world is deleted.)
- **Acceptance 4 (forbidden trees):** no changes under `golden/`, `baseline/`, `schemas/`, `migrations/`, `src/compiler/`, or the old pipeline dirs. ✅
- **Acceptance 5 (no provider calls):** consistent with the diff. ✅
- **Two-tier strictness (§4.2):** `applyTier` — DRAFT: schema fatal, contract findings become warnings; RELEASE: everything fatal. Matches the brief and AGENTS.md tier model. ✅
- **Tactic fail-safe:** `assertReferenceMappingTacticMode` throws when a sealed tactic catalog is present — enforces the AGENTS.md invariant "tactic references stay empty until an approved reciprocal mapping exists." ✅
- **Identity stripping:** model-facing prompts strip all canonical identity fields; models return semantics only. ✅
- **Source-context determinism:** packet assembly sorts by handle, assigns locator handles post-sort, hashes per-locator context and the whole packet; the test proves byte-identical output under input reordering and deep-equality with the legacy builder. ✅
- **Prompt fidelity evidence:** pair-frame and source-context tests assert the new prompts contain/byte-equal the old contract packets. ✅

### Findings

**R4 — HIGH (process, already dispatched) — merged with acceptance checks 1–2 red.** `tests/pipeline/recordings/A1/` was never populated; `npm run verify` and golden parity fail closed. Disclosed prominently in the PR body; root cause is that no A1 recordings exist anywhere in the old world. Fix in flight: **P2A-FIX** (deterministic derivation from golden fixtures, with the schema 2.0.0-vs-2.1.0 stop condition).

**R5 — MEDIUM (carry into P3 brief) — RELEASE validation is weaker than the old world.** #26 discloses that `src/validation/sir-*-completion.ts` is not fully ported: RELEASE checks beyond JSON Schema are only the listed cross-field findings (slot order, slot coverage, lifecycle target counts, duplicate handles, packet hash checks), not every old completion-profile rule. Before the first live pair (P3), either port the remaining completion checks or record an explicit owner-accepted gap. **Must be a P3 brief requirement.**

**R6 — MEDIUM (carry into P3 brief) — prompt parity proven for only 2 of 5 task groups.** Pair-frame and source-context prompts are asserted against the old builders; evidence-and-safety, mappings, and pair-coherence prompts are only byte-stable for a fixed seed, not compared to the old world. P3 should extend the parity assertions before those prompts drive a live model run.

**R7 — MEDIUM (carry into P3 brief) — plan-binding checks run in the builder, not in `validate()`.** Pair/plan hash binding is enforced when a packet is *built*, but a bare packet passed to `validateSourceContext` is not re-checked against the plan. Acceptable for the offline slice; the live path (P3) must establish where plan binding is re-verified on resume/replay.

**R8 — LOW — dual expression of output shapes.** Each task module owns its JSON Schema, but `prompt.ts` mirrors the shapes as prose in `OUTPUT_SHAPES`. Drift risk between the two; consider generating the prose from the schemas (or vice versa) in a later hardening pass. No action now.

**R9 — observation.** AGENTS.md still says "Current phase boundary (Phases 0–1)" while Phase 2 is underway and `npm run verify` exists. Cursor flagged it in #27; the one-section update is already authorized inside P2A-FIX.

---

## Summary of actions

| # | Severity | Action |
|---|---|---|
| R1 | HIGH | **Fix-brief P1.6** (writeManifest byte format) — gate for live e2e |
| R2 | LOW | Optional cleanup inside P1.6 |
| R4 | HIGH | **P2A-FIX** already dispatched |
| R5, R6, R7 | MEDIUM | Become explicit requirements in the **P3 brief** (Kimi authors; tracked here so they are not lost) |
| R8, R9 | LOW/obs | R8 later hardening; R9 covered by P2A-FIX |

**Process note for the record:** #25 and #26 were merged without review; #26 and #27 merged with `verify` red. This review plus P1.6 + P2A-FIX close the resulting debt. From here: Kimi reviews each PR before merge.
