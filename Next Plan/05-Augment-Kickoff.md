# Augment Code kickoff prompt

Copy the following prompt into Augment Code after opening this repository. It starts implementation; it is not evidence that any phase has already been completed.

---

Refine **KB Document Creator** to its document-only scope, following the owner's new plan in `Next Plan/`.

Read root `AGENTS.md`, then `Next Plan/README.md`, `01-Implementation-Plan.md`, `02-Contracts.md`, `03-Augment-Tasks.md`, `04-Validation-and-Acceptance.md`, and `06-Storage-and-Sample-Onboarding.md`. The revised KB Document Creator scope replaces the legacy lifecycle-control scope for this work. Keep the applicable safety, provenance, testing, and historical-data invariants.

Begin with **DC-00 only**. Inspect the actual current repository; compare it to the reviewed baseline commit named in the plan. Establish a fresh verification baseline with a disposable Postgres test database. Report the active runtime path, any intervening changes, actual missing input materials, and proposed file changes. Offline fixture parity does not establish fresh generation from the pinned SAE input set.

The first reference case is the owner’s Solution Assurance Engine KB. Use the explicitly selected inventory at `baseline/sae-training/input-inventory.json`, pin its active input bytes, and use the identified Golden pair only to calibrate structure and depth. The first reviewed Markdown delivery goes to `baseline/sae-training/knowledge-base/`; automated tests write only to temporary roots. Do not use Vercel or Google Drive for the pilot. Any later storage connection requires a user-supplied location and access through a supported adapter; no production fallback to local fixtures.

Markdown is the primary document output. HTML is preview only. PDF is optional and derived from the same reviewed content. Internal JSON contracts and operational receipts are allowed; canonical JSON KB publication is not a requirement.

Do not implement Master Table Creator or Knowledge Hub here. Do not build consumer retrieval APIs, Source Register maintenance, automatic catalog approval, or a new fourteen-stage control plane. KB Document Creator must be independently usable. The separate Master Table Creator reads the resulting document collection and generates Master Table JSON; the separate Knowledge Hub imports and maintains that table and supplies Packages to the consuming solution.

Use one task per branch/PR. Make the smallest end-to-end implementation that meets the current DC brief and its acceptance checks. Preserve historical Golden fixtures and applied migrations. Reuse valuable existing functions, but do not require the new authoring path to compile a prebuilt legacy SIR snapshot. No source passage means no substantive source-grounding claim. The owner has confirmed the supplied SAE Tactic Playbook is final despite older incomplete-approval wording. Honor that decision for its selected version/hash without asking again, preserve its explicit links, and report only actual missing or incompatible relationships. Do not infer the status of the supplied documentation from older repository copies.

After DC-00, present its evidence and the next task's scope. Continue through later tasks when instructed, using the task boundaries in `03-Augment-Tasks.md`. Ask only for actual missing materials, credentials, permissions, or decisions that block dependent work. Never fabricate a passing test, source locator, source permission, mapping approval, or completed deployment.

---

## Expected DC-00 response

- Current commit and comparison with the reviewed baseline.
- Verification results, including database setup and any limitations.
- Sample-to-contract mapping for the owner’s supplied reference materials.
- Local readiness checklist: exact input/schema/Golden pair paths, read permissions, destination scope, and missing source-material dependencies.
- Legacy side effects to isolate from document mode.
- DC-01 implementation scope and files to add/change.
- No application cutover or production data changes yet.
