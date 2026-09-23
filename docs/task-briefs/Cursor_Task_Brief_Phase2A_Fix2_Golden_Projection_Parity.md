# Cursor Task Brief — Phase 2A Fix 2: Golden-Projection Parity Contract (P2A-FIX2)

**Brief ID:** P2A-FIX2
**Phase:** 2 (closes the P2A acceptance debt; supersedes the test-contract portion of P2A-FIX)
**Branch:** `phase2-golden-projection-parity` (from `main`, after PR #28 merges)
**Commit / PR title:** `phase2: golden-projection parity contract (P2A-FIX2)`
**Estimated size:** medium (derivation script completion + one test contract revision + docs)

## 1. Purpose

The P2A golden-parity test (brief §4.4) was specified against a wrong assumption — verified by Kimi on 2026-09-22 against `src/compiler/sir-compiler.ts`, `src/validation/sir-snapshot-schema.ts`, `schemas/capability.schema.json` (2.1.0), and the golden fixtures:

1. **RELEASE mode can never return `ok: true`** — `compileSirPair` unconditionally records the `APPROVAL_RECORD` defect in RELEASE mode (approval records are owned by the release finalizer, which does not exist until P3). The test's `compile.ok === true` expectation is unreachable with the unmodified compiler.
2. **Even DRAFT output cannot deep-equal the fixtures** — the compiler emits `schema_version` 2.1.0 (fixtures: 2.0.0), hardcodes `release_status: 'DRAFT'` (fixtures: `APPROVED`), never emits `approval_record` (fixtures have one), and hardcodes `candidate_tactic_refs: []` (fixtures carry 5+6 legacy-pattern mappings that per P0 matched 0 of 119 approved playbook tactic IDs).
3. **`mapping_id` formats differ** — compiler: positional `SRCMAP-<objectId>-<NNN>`; fixtures: source-slug form.
4. **One required snapshot field is unrecoverable** — `sir-snapshot-schema.ts` requires `supportedClaim` (min 10) on mapped source mappings; the 2.0.0 fixtures carry no such field, and no other legitimate source exists (the live Drive manifest v2.1.0 contains authorities and supporting documents only — there is no 2.1.0 A1 pair to derive from). Inventing it would synthesize model semantics. Never do that.

So the contract changes from *byte-identity with 2.0.0 APPROVED artifacts* to **golden-projection parity**: compile a DRAFT image from golden-derived recordings and prove it deep-equals the golden fixtures after an explicit, enumerated, self-guarded projection. The golden fixtures stay immutable and remain the semantic calibration reference. This restores `npm run verify` to green honestly.

## 2. Ground rules (binding)

- AGENTS.md applies. Fail closed; findings do not authorize workarounds.
- **Forbidden edits:** `golden/**`, `src/compiler/**`, `schemas/**`, `baseline/**`, old-pipeline directories. The compiler is used exactly as-is.
- **Explicitly authorized by this brief (and only this):** rewrite `tests/pipeline/golden-parity.test.ts` to the new contract; complete `tests/pipeline/derive-a1-recordings.ts` so it actually emits; rewrite `tests/pipeline/recordings/A1/README.md` accordingly. This supersedes P2A-FIX's "do not edit the test" rule.
- No provider/network calls; no secrets; no model-authored semantics. Every recording byte must trace to `golden/fixtures/A1_v1.0.0.json`, `golden/fixtures/AP-A1_v1.0.0.json`, or deterministic handle/ID assignment.

## 3. Implementation

### 3.1 Pre-flight check (do first, report result in the PR)
Run `compileSirPair` with the complete A2 control snapshot in **DRAFT** mode. If `ok` is not `true`, stop and report the exact defects — that would mean canonical draft validation itself fails for a complete snapshot, which is a different finding than this brief covers.

### 3.2 Derivation — extend `tests/pipeline/derive-a1-recordings.ts`
Emit all seven files under `tests/pipeline/recordings/A1/`, derived deterministically:

- **`authoring-plan.json`** — pair identity A1/AP-A1, `schemaVersion` 2.1.0, question-slot dimensions and lifecycle stage order taken from the golden fixtures' content (slot dimensions from `primary_questions[].dimension`; stage order from `target_assurance_by_lifecycle_stage[].lifecycle_stage`).
- **Five task recordings** — camelCase, handle-form (`atomic_NNN`, `evidence_NNN`, `criterion_NNN`, `source_NNN`, `locator_NNN`) model-task outputs whose semantics come verbatim from the golden fixtures (canonical definitions, applicability, questions, evidence, rules, findings, boundaries, lifecycle targets, absence contract). Each must pass its module's **RELEASE** validator unchanged.
- **`snapshot.json`** — the materialized pair-coherence snapshot consistent with the recordings.
- **Source mappings (the honest asymmetry):** the two golden mappings per object **cannot** enter the snapshot as mapped mappings — `supportedClaim` is required and unrecoverable. Represent each golden mapping as an `unmappedClaims` entry with `reason: 'INSUFFICIENT_SOURCE_CONTEXT'` and a claim string **deterministically composed from golden fields only** (e.g. `Golden-attested mapping without recorded supported claim: SRC-EU-AIA — <exact_locator verbatim>`). State this rule in the README. The MAPPINGS recording mirrors this (empty `capabilityMappings`/`antipatternMappings`, the unmapped claims, `mappingNotes` explaining the derivation). Do not invent claim semantics.
- Re-running the script must produce byte-identical files (hash evidence in the PR). Exit 0 on success.

### 3.3 The new test contract — `tests/pipeline/golden-parity.test.ts`
Keep the filename. Add a header comment naming this brief and the contract revision. The test:

1. Runs `authorOfflineA1()` (recordings RELEASE-validate — existing behavior).
2. Compiles in **DRAFT** mode. Assert `compile.ok === true` — the derived A1 image must pass canonical 2.1.0 validation in draft mode.
3. Asserts `deepEqual(stripNonAttested(compiledX), projectGolden(fixtureX))` for both objects, where:
   - **`projectGolden`** applies exactly these declared deltas, each implemented as a named, commented step:
     1. `schema_version` → plan value (2.1.0)
     2. `release_status` → `'DRAFT'`
     3. delete `approval_record` (owned by the release finalizer — P3)
     4. `candidate_tactic_refs` → `[]` (legacy GOV-PUR mappings are not approved playbook IDs; AGENTS.md tactic invariant)
     5. `normative_source_mappings` → `[]` (2.0.0 artifacts predate `supported_claim` semantics; see §3.2)
   - **`stripNonAttested`** removes nothing unless §3.2 changed — if the compiled output contains source mappings, stop: the snapshot should have produced none.
   - **Self-guard:** before projecting, assert the fixtures still hold the expected original values (`release_status === 'APPROVED'`, `approval_record` present, 5 / 6 tactic refs, slug-form mapping IDs). If golden is ever regenerated, this test must fail loudly and the contract must be revisited — not silently pass.
4. A **threading mutation test** for the fields golden cannot attest: modify a derived recording's source-mapping-related content (or add a minimal synthetic mapping to a copy of the snapshot with an explicit `supportedClaim` marked as synthetic) and assert the compiled output threads it into `normative_source_mappings[].supported_claim`. This covers what parity cannot.
5. Do not assert anything about RELEASE-mode `ok` — document in a comment that RELEASE compile requires the release finalizer (P3).

### 3.4 Provenance — rewrite `tests/pipeline/recordings/A1/README.md`
State: what the recordings are derived from and how (script + command + date); the unmappedClaims composition rule; what the parity test now proves (compiler + validators + field-threading regression anchor over golden-attested semantics in a DRAFT 2.1.0 image) and what it does not prove (release-tier fields, approval records, tactic mappings, source-mapping claim semantics, and live model parity — that remains P3's first live pair).

## 4. Stop-and-report conditions

Stop and report as findings (no workarounds) if:
- §3.1 fails (DRAFT compile of the complete A2 fixture not ok).
- The compiled DRAFT image differs from the projected golden at **any path outside the five declared deltas** — report the exact paths.
- Canonical draft validation rejects the derived image (report exact defects).
- Any recording cannot pass RELEASE validation without editing a validator (validator edits are forbidden here).

## 5. Acceptance checks (definition of done)

1. §3.1 pre-flight result reported.
2. `npm run recordings:derive` re-run → byte-identical files (before/after sha256 in the PR).
3. `npm run verify` **green** locally — the full chain, golden-parity included. This makes `main` green for the first time since CI was added.
4. CI green on this PR — paste the Actions run link.
5. README accurate per §3.4; test header comment per §3.3.
6. Diff touches only: `tests/pipeline/derive-a1-recordings.ts`, `tests/pipeline/golden-parity.test.ts`, `tests/pipeline/recordings/A1/**`, and (if needed) `package.json`. Nothing else.

## 6. Reporting

PR body: pre-flight result, the five declared deltas with justification, hash evidence, verify + CI evidence, and the explicit statement of what parity does and does not prove now. Anything not run is "not run".

## 7. Process

Kimi reviews this PR before merge; the owner merges after. Note: this brief revises a P2A acceptance gate — the owner's merge of this PR is also the recorded approval of that contract change.
