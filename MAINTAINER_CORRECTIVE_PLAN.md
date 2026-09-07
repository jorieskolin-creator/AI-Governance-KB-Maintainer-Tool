# Maintainer Corrective Plan

## Objective

Complete the existing architecture as one trustworthy pipeline:

`source support → SIR authoring → typed compilation → revision-bound review and repair → rendering → standalone operator approval → publication`

The first acceptance vehicle is one offline capability/anti-pattern pair. It must prove both a successful non-production release rehearsal and recovery from a real injected defect. Production-shaped release acceptance then requires one complete five-pair domain because the domain remains the approval and release unit.

## Non-negotiable invariants

- Models author semantic content; deterministic code owns canonical IDs, hashes, references, state, and publication.
- Uninterpretable review output never becomes a pass.
- Every validation, review, repair, human decision, and approval is bound to an immutable candidate revision hash.
- Any edit creates a new revision and invalidates affected downstream gates.
- A source claim is supported only by an allowed exact locator and governed context. Human acceptance cannot manufacture source support.
- Draft visibility is independent of publication readiness.
- Operator approval and publication remain two internal operations even if the UI uses one button. No enterprise authorization layer is required now.
- Publication is idempotent, resumable, and bound to the exact approved manifest hash.

## Delivery plan

### 0. Freeze contracts and establish the acceptance harness

- Define typed contracts for candidate revisions, gate results, finding dispositions, approval bundles, and release manifests.
- Select one representative offline fixture pair with source locators, SIR artifacts, defects, and repairs.
- Add recorded model responses and a database-backed integration harness.
- Align architecture documentation with the implemented task sequence.
- Keep live domain runs observational until fail-closed QC and compilation gates exist.

Acceptance: the fixture replays deterministically without live providers or production infrastructure.

### 1. Close false-success paths

- Reject empty, unknown-key, null-defect, and explanation-only Domain Coherence responses.
- Require an explicit schema-valid zero-defect review before deriving a clean result.
- Restrict normalization to allowlisted, meaning-preserving aliases and record every coercion.
- Replace the human `schemaGate()` with complete section-schema and reference-graph validation.
- Apply the same fail-closed rule to equivalent normalization paths. Pair Coherence has no alias coerce; keep its strict schema.

Acceptance:

- `{}` and `{"passed":false,"explanation":"..."}` cannot advance Domain Coherence.
- Empty required sections cannot be saved.
- Execution failure, incomplete review, valid review with defects, and clean review remain distinct outcomes.

### 2. Introduce immutable revisions and named gates

- Stop replacing completed task outputs in place.
- Persist immutable artifact revisions and aggregate candidate revisions with exact input/output hashes.
- Record supersession lineage and use optimistic concurrency for human saves.
- Persist immutable gate results with candidate hash, validator version, outcome, findings, and timestamp.
- Derive lifecycle state from current gate results instead of overloading `passed` or `VALIDATED`.

Required gate outcomes include:

- `SIR_VALID`
- `SOURCE_COVERAGE_COMPLETE` or `SOURCE_GAPS_PRESENT`
- `CANONICAL_COMPILE_VALID` or `COMPILE_FAILED`
- `QC_COMPLETE` or `QC_INCOMPLETE`
- `COHERENCE_CLEAN` or `DEFECTS_OPEN`
- `RENDER_PARITY_VALID`
- `READY_FOR_APPROVAL`
- `APPROVED`
- `PUBLISHED` or `PUBLICATION_FAILED`

Acceptance: stale reviews, edits, and approvals cannot advance a newer revision.

### 3. Build the typed SIR compiler

Implement:

`Authoring Plan + persisted SIR revision → Canonical Candidate + Compile Report`

The compiler must:

- assign all canonical pair, object, question, atomic, evidence, finding, and mapping IDs;
- resolve every SIR handle and invert SIR relationships into canonical bindings;
- convert current source and reference collections without unsafe TypeScript casts;
- validate complete schemas and the reference graph;
- return a precise defect collection rather than stopping at the first mismatch;
- retain visible source gaps and review findings in non-release candidate metadata.

A structurally valid draft may render with visible unresolved issues. A release candidate must satisfy publication policy. Structurally incomplete output must not be described as canonical.

Acceptance: one validator-passed fixture pair compiles to schema-valid capability and anti-pattern JSON plus DRAFT HTML without missing identities.

### 4. Acquire real source support before substantive drafting

Add a deterministic `SOURCE_CONTEXT` stage that:

- resolves only sources allowed by the sealed Authoring Plan;
- retrieves governed exact locators and bounded passages where rights allow;
- records provenance, context policy, and content hashes;
- persists explicit missing-context results before substantive authoring.

Use two source gates:

1. Early acquisition and feasibility before claim-heavy authoring.
2. Final claim-to-locator mapping and coverage validation after claim-bearing content exists.

Do not invent locators. Unsupported claims remain visible in drafts and must be supported, qualified, removed, or handled under an explicit publication-waiver policy. `BLOCKING` findings should be non-waivable by default.

Acceptance: a zero-locator packet reports `SOURCE_GAPS_PRESENT` before eight authoring tasks are consumed.

### 5. Make repair and human editing revision-aware

- Preserve rejected candidates and exact deterministic findings.
- Apply automatic and human patches to new revisions only.
- Validate every touched section and its reference graph.
- Recompute dependency closure and rerun affected SIR, compile, and coherence gates.
- Rebuild Pair and Domain Coherence packets from current revision hashes.
- Store finding dispositions such as `RESOLVED`, `WAIVED`, `ACCEPTED_RISK`, or `REJECTED` with authority and rationale.
- Never infer resolution because a finding was deleted from a form.

Acceptance:

- Invalid repaired content cannot reach coherence review.
- Empty-section saves fail.
- Domain review cannot use a stale pair snapshot.
- The review interface displays precise findings for the newly saved revision.

### 6. Separate provider fallback from content correction

- Use provider fallback for execution, transport, timeout, quota, or provider availability failures.
- For validation failures, persist the candidate and issue a bounded correction request containing rejected JSON, exact findings, applicable schema, contract identity, and allowed repair paths.
- Validate the correction and surface still-invalid content through human review.
- Use provider-native structured schemas where supported, while retaining local deterministic validation as authority.

Acceptance: a known invalid response is corrected from its defect packet rather than by replaying the original prompt to another provider.

### 7. Render and prepare an immutable approval bundle

- Render required formats from the canonical candidate revision.
- Verify semantic parity between canonical JSON and every rendered format.
- Build an immutable approval bundle containing candidate, source, baseline, render, gate-result, and proposed manifest hashes.
- Keep draft rendering available with unresolved issues clearly identified.

Acceptance: approval review presents exactly the bytes and hashes that publication would release.

### 8. Separate operator approval from publication

The Maintainer is a standalone operator tool. Standalone operator approval bound to artifact hashes is enough. Do not add enterprise authentication, SSO, or a separate approver identity now.

Keep two internal operations even if the operator UI uses one button:

1. `recordApproval()`
   - records the operator decision against the exact candidate hash and proposed manifest hash;
   - rejects stale or mismatched approval bundles.
2. `publishApprovedRelease()`
   - performs `APPROVED → PUBLISHING → PUBLISHED | PUBLICATION_FAILED`;
   - uses deterministic paths and put-if-absent-or-verify-same-hash behavior;
   - uploads artifacts before publishing the manifest;
   - persists a resumable publication job and verifies final destinations and hashes.

The QC “Approve and save” action repairs or accepts listed defects. It must never grant domain `APPROVED` or publish a release.

Acceptance:

- Duplicate approval and publication requests are idempotent.
- A partial upload retries to one release.
- Published bytes match the approved manifest.
- No approval can apply to a newer revision.

### 9. Prove vertical slices before expansion

First, run one pair through a non-production release rehearsal:

- source acquisition;
- SIR validation;
- canonical compilation;
- visible draft;
- injected defect;
- revision-aware repair or human edit;
- approval-bundle creation;
- simulated approval and publication;
- partial-failure recovery.

Then run one complete five-pair domain through hash-bound operator approval and immutable publication.

Only after both paths pass should generation expand across all six domains.

### 10. Optimize task boundaries from evidence

Measure validation failures, retries, repairs, source gaps, semantic contradictions, latency, tokens, cost, and revision count by task.

Consolidate cognitive tasks only where measured completion quality and repair cost improve without weakening ownership, source attribution, independent QC, or repair localization. Never merge source acquisition into unconstrained authoring or QC into authoring.

## Pull request sequence

1. Fail-closed QC and deep schema gates.
2. Revision and gate-result model.
3. Typed SIR compiler.
4. Source acquisition and coverage.
5. Revision-aware repair and correction requests.
6. Rendering and approval bundle.
7. Standalone hash-bound operator approval.
8. Idempotent publisher and recovery.
9. Full vertical-slice acceptance suite.
10. Optional task-boundary optimization.

Each pull request must include migrations where needed, rollback behavior, invariant-focused tests, operator wording updates, and evidence from the offline fixture.

## Environment strategy

Do not redesign the architecture. One Railway environment is enough: Postgres, Vercel Blob, provider credentials, and the operator UI in the same application. Isolation is by run IDs, versions, and test namespaces — not by a second Railway project or an enterprise auth layer.

1. **Offline / Cloud Agent development**
   - local or environment PostgreSQL;
   - recorded or stubbed model executor by default;
   - deterministic build and predeployment checks;
   - no live publication as part of ordinary predeployment.
2. **Single Railway environment**
   - one database, one blob namespace, one operator process;
   - operator commands gated by `OPERATOR_COMMANDS_ENABLED`;
   - publication remains a separate internal operation bound to an approved manifest hash;
   - secrets stay in the environment secret store, not in the repository.

`drizzle-orm` advisory upgrades and `.cursor/environment.json` port-schema hygiene are outside this flow. Do not mix them into the main pipeline pull requests.

Repository-managed Cloud Agent setup should remain deterministic and secret-free. Live-provider smoke tests and publication tests are explicit jobs, not part of every offline predeployment run.

## Definition of trustworthy

The Maintainer is trustworthy when one complete domain proves:

1. Source context is sealed and hashed before substantive drafting.
2. SIR validates without model-authored canonical IDs.
3. The typed compiler emits schema-valid canonical candidates.
4. Drafts remain inspectable with open issues clearly visible.
5. Empty or uninterpretable QC cannot pass.
6. Empty or structurally invalid human edits cannot save.
7. Every decision is bound to an immutable revision.
8. Operator approval is hash-bound to the exact candidate and manifest.
9. Publication is idempotent and recovers from partial failure.
10. One end-to-end test covers both successful release and repaired-defect release.
