# Augment Code kickoff prompt

Copy the following prompt into Augment Code after opening this repository. It starts implementation; it is not evidence that any phase has already been completed.

---

Refine this existing AI-Governance-KB-Maintainer-Tool repository into **Document Creator**, following the owner's new plan in `Next Plan/`.

Read root `AGENTS.md`, then `Next Plan/README.md`, `01-Implementation-Plan.md`, `02-Contracts.md`, `03-Augment-Tasks.md`, and `04-Validation-and-Acceptance.md`. The revised Document Creator scope replaces the old Maintainer lifecycle-control scope for this work. Keep the applicable safety, provenance, testing, and historical-data invariants.

Begin with **DC-00 only**. Inspect the actual current repository; compare it to the reviewed baseline commit named in the plan. Establish a fresh verification baseline with a disposable Postgres test database. Report the active runtime path, any intervening changes, actual missing input materials, and proposed file changes. Do not confuse existing Golden-derived offline parity with a fresh live generation.

The product has one job: create reviewed, source-supported human-readable documents from the supplied Source Register, taxonomy/criteria/capabilities/anti-patterns, cognitive model, linked Tactic Playbook, schemas, and Golden Samples, then deliver the documents to the agreed storage structure.

Markdown is the primary document output. HTML is preview only. PDF is optional and derived from the same reviewed content. Internal JSON contracts and operational receipts are allowed; canonical JSON KB publication is not a requirement.

Do not implement Master Table Creator or Knowledge Hub here. Do not build consumer retrieval APIs, Source Register maintenance, automatic catalog approval, or a new fourteen-stage control plane. Document Creator must be independently usable. The separate Master Table Creator reads the resulting document collection and generates Master Table JSON; the separate Knowledge Hub imports and maintains that table and supplies Packages to the consuming solution.

Use one task per branch/PR. Make the smallest end-to-end implementation that meets the current DC brief and its acceptance checks. Preserve historical Golden fixtures and applied migrations. Reuse valuable existing functions, but do not require the new authoring path to compile a prebuilt legacy SIR snapshot. No source passage means no substantive source-grounding claim. Pending tactic mappings remain pending.

After DC-00, present its evidence and the next task's scope. Continue through later tasks when instructed, using the task boundaries in `03-Augment-Tasks.md`. Ask only for actual missing materials, credentials, permissions, or decisions that block dependent work. Never fabricate a passing test, source locator, source permission, mapping approval, or completed deployment.

---

## Expected DC-00 response

- Current commit and comparison with the reviewed baseline.
- Verification results, including database setup and any limitations.
- Inputs found and exact missing inputs, especially the cognitive model and storage connection.
- Legacy side effects to isolate from document mode.
- DC-01 implementation scope and files to add/change.
- No application cutover or production data changes yet.
