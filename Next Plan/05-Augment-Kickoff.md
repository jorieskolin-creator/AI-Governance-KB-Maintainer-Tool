# Augment Code kickoff prompt

Copy the following prompt into Augment Code after opening this repository. It starts implementation; it is not evidence that any phase has already been completed.

---

Refine this existing AI-Governance-KB-Maintainer-Tool repository into **Document Creator**, following the owner's new plan in `Next Plan/`.

Read root `AGENTS.md`, then `Next Plan/README.md`, `01-Implementation-Plan.md`, `02-Contracts.md`, `03-Augment-Tasks.md`, `04-Validation-and-Acceptance.md`, and `06-Storage-and-Sample-Onboarding.md`. The revised Document Creator scope replaces the old Maintainer lifecycle-control scope for this work. Keep the applicable safety, provenance, testing, and historical-data invariants.

Begin with **DC-00 only**. Inspect the actual current repository; compare it to the reviewed baseline commit named in the plan. Establish a fresh verification baseline with a disposable Postgres test database. Report the active runtime path, any intervening changes, actual missing input materials, and proposed file changes. Offline fixture parity does not establish fresh live generation from the prepared Vercel input set.

The first reference case is the owner’s Solution Assessment Engine KB, using supplied SAE materials (which may retain Solution Assurance Engine titles). The owner will share samples and prepare Vercel folders containing Source Register, taxonomy/criteria, cognitive model, final linked Tactic Playbook, schemas, and one Golden Reference capability/anti-pattern pair. Inspect those samples to define parsing/adapters and reusable standardized input contracts. At runtime, read the corresponding input files from Vercel before generation and write generated documents to the configured Vercel output structure. Google Drive is not used. Do not treat local development samples or older repository assets as production inputs.

Markdown is the primary document output. HTML is preview only. PDF is optional and derived from the same reviewed content. Internal JSON contracts and operational receipts are allowed; canonical JSON KB publication is not a requirement.

Do not implement Master Table Creator or Knowledge Hub here. Do not build consumer retrieval APIs, Source Register maintenance, automatic catalog approval, or a new fourteen-stage control plane. Document Creator must be independently usable. The separate Master Table Creator reads the resulting document collection and generates Master Table JSON; the separate Knowledge Hub imports and maintains that table and supplies Packages to the consuming solution.

Use one task per branch/PR. Make the smallest end-to-end implementation that meets the current DC brief and its acceptance checks. Preserve historical Golden fixtures and applied migrations. Reuse valuable existing functions, but do not require the new authoring path to compile a prebuilt legacy SIR snapshot. No source passage means no substantive source-grounding claim. The owner has confirmed the supplied SAE Tactic Playbook is final despite older incomplete-approval wording. Honor that decision for its selected version/hash without asking again, preserve its explicit links, and report only actual missing or incompatible relationships. Do not infer the status of the supplied documentation from older repository copies.

After DC-00, present its evidence and the next task's scope. Continue through later tasks when instructed, using the task boundaries in `03-Augment-Tasks.md`. Ask only for actual missing materials, credentials, permissions, or decisions that block dependent work. Never fabricate a passing test, source locator, source permission, mapping approval, or completed deployment.

---

## Expected DC-00 response

- Current commit and comparison with the reviewed baseline.
- Verification results, including database setup and any limitations.
- Sample-to-contract mapping for the owner’s supplied reference materials.
- Vercel readiness checklist: exact input/schema/Golden pair paths, read permissions, and allowed output prefixes; missing runtime files distinguished from development samples received.
- Legacy side effects to isolate from document mode.
- DC-01 implementation scope and files to add/change.
- No application cutover or production data changes yet.
