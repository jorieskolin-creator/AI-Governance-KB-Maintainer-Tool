# A1 recordings — not emitted (P2A-FIX, 2026-09-22)

`npm run recordings:derive` (`tests/pipeline/derive-a1-recordings.ts`) reads `golden/fixtures/A1_v1.0.0.json`, `golden/fixtures/AP-A1_v1.0.0.json`, and the unmodified `compileSirPair` contract. It writes none of the seven recording files. These files are not captured model runs, and they were not derived, because a faithful derivation cannot pass the parity test.

## What the parity test asks for

`tests/pipeline/golden-parity.test.ts` calls `authorOfflineA1()`, which RELEASE-validates five task recordings and then calls `compileSirPair` with `mode: 'RELEASE'`. It expects `compile.ok === true` and deep equality with the two golden fixtures.

## Why derivation stopped

1. `compileSirPair` in RELEASE mode always records defect `APPROVAL_RECORD` at `/approval_record` and returns `capability` / `antipattern` only when `defects.length === 0`. Clearing `sourceMappings.unmappedClaims` on the complete A2 control snapshot removes the fixture-specific `SOURCE_UNMAPPED_CLAIM` defect. `APPROVAL_RECORD`, `CANONICAL_SCHEMA`, and `APPROVAL_VERSION_MATCH` remain, and both documents are still omitted. `compile.ok` cannot be true.
2. Even a DRAFT compile cannot deep-equal the fixtures. The compiler sets `schema_version` from the plan (active family 2.1.0; fixtures are historical schema 2.0.0), hardcodes `release_status` to `DRAFT` (fixtures are `APPROVED`), omits `approval_record`, and hardcodes `candidate_tactic_refs` to `[]` (A1 has five APPROVED tactic mappings; AP-A1 has six).
3. Source-mapping ids cannot match. `sourceMappingId` emits `SRCMAP-<objectId>-<ordinal>` (`SRCMAP-A1-001`). The fixtures use `SRCMAP-A1-EU-AIA-001`, `SRCMAP-A1-NIST-AI-RMF-002`, `SRCMAP-AP-A1-EU-AIA-001`, and `SRCMAP-AP-A1-NIST-AI-RMF-002`.
4. Compiler inputs are missing from both fixtures, so they cannot be recovered: `supportedClaim`, `applicabilityConditions`, and `exclusions` on capability and anti-pattern source mappings. The compiler emits those as `supported_claim`, `applicability_conditions`, and `exclusions`. The fixtures' `normative_source_mappings` objects do not contain those keys. Inventing them would synthesize semantics.

## What this does not prove

Semantic parity with live model output remains P3's first live pair. This directory does not provide a compiler + validator regression anchor, because no recording was honest to emit.

## Proposed test-contract change

Do not edit `golden-parity.test.ts`, `src/compiler/`, or `golden/` to force a pass. A follow-up brief should replace deep equality against the schema 2.0.0 APPROVED bytes with a DRAFT-mode regression against a 2.1.0 image the unmodified compiler can emit, and keep these fixtures as the semantic calibration reference.
