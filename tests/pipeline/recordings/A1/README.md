# A1 recordings — golden-projection derivation (P2A-FIX2, 2026-09-23)

`npm run recordings:derive` (`tests/pipeline/derive-a1-recordings.ts`) reads `golden/fixtures/A1_v1.0.0.json` and `golden/fixtures/AP-A1_v1.0.0.json` and writes these seven files. Re-running the script overwrites them with byte-identical JSON. These files are not captured model runs. No model-authored content is added.

## What is copied verbatim

Canonical definitions, applicability, primary questions, evidence, evidence rules, findings, hard gates, runtime boundaries, lifecycle targets, related-criterion IDs, the anti-pattern failure mechanism, and the absence-contract required artifacts are copied from the golden fixtures. Handles (`atomic_NNN`, `evidence_NNN`, `finding_NNN`, `criterion_NNN`, `source_NNN`, `locator_NNN`) are assigned from golden ordinals and encounter order. Question-slot dimensions come from `primary_questions[].dimension`. Lifecycle stage order comes from `target_assurance_by_lifecycle_stage[].lifecycle_stage`.

## Slots the 2.0.0 fixtures do not attest

The pair-frame, failure-model, and note schemas require strings the fixtures do not carry as separate fields. Those slots are filled only as follows:

- `ownedTopics` is the golden capability title.
- `excludedTopics` is empty.
- `boundaryRationale` and `distinctionFromCapabilityGap` repeat the golden `distinct_claim`.
- `pairedRelationship` is the golden anti-pattern id and title: `AP-A1 is the paired anti-pattern of A1: <title>.`
- `triggeringConditions`, `observableFailureSurfaces`, and `nonExamples` each repeat the golden `failure_mechanism`. They are not new failure claims.
- `coverageRationale` is the three golden capability questions joined in slot order.
- `evidenceNeed` is the titles of the golden evidence items that atomic already cites.
- `interpretationBoundary` is the golden absence-contract `required_artifacts` joined with `; `.
- Related-criterion `boundarySummary` is `Golden-attested related criterion: <id>`.
- Schema-required note arrays that have no golden note say that the fixtures attest no separate note for that slot.

## unmappedClaims composition rule

`supportedClaim` is required on a mapped source mapping and is absent from both 2.0.0 fixtures. No other legitimate source exists, so the derivation does not invent one. Each golden mapping becomes an `unmappedClaims` entry:

- `reason`: `INSUFFICIENT_SOURCE_CONTEXT`
- `claim`: `Golden-attested mapping without recorded supported claim: <source_id> — <exact_locator verbatim>`

`MAPPINGS.json` therefore has empty `capabilityMappings` and `antipatternMappings`, those unmapped claims, and `mappingNotes` stating this rule. The snapshot `sourceMappings` mirror that. Compiled `normative_source_mappings` stay empty.

Source-context authority metadata (tier, type, official location, applicability boundary, licensing boundary, effective status) is joined from the sealed source register record for each golden `source_id`. Version, verification status, verification date, and exact locator stay the golden mapping values. Locator context is metadata only (`METADATA_LOCATOR_ONLY`, `contextText: null`) because the register record has no snippet-rights field. The live register version string and verification date have drifted from the golden attestation and are not substituted.

## What the parity test proves

`tests/pipeline/golden-parity.test.ts` (brief P2A-FIX2) RELEASE-validates the five task recordings through `authorOfflineA1()`, compiles the snapshot in **DRAFT** mode, and deep-equals the compiled objects to the golden fixtures after five declared projections: schema 2.1.0, `release_status: DRAFT`, no `approval_record`, empty `candidate_tactic_refs`, empty `normative_source_mappings`. A separate test threads a synthetic `supportedClaim` into `normative_source_mappings[].supported_claim`.

That is a compiler, validator, and field-threading regression anchor over golden-attested semantics in a DRAFT 2.1.0 image.

## What it does not prove

It does not prove release-tier fields, approval records, tactic mappings, source-mapping claim semantics, or live model parity. `compileSirPair` in RELEASE mode still requires the release finalizer (P3) and is not asserted. Live model parity remains P3's first live pair.
