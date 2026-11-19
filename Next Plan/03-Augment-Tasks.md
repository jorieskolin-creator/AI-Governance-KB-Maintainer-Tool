# Augment Code implementation tasks

Execute one task per branch/PR. Use branch names `phase<N>-dc-<short-slug>` and include the DC task ID in commit messages. Record files changed, validation results, remaining gaps, and rollback instructions in each PR. Do not mark a phase complete from compilation alone.

Implement DC-00 through DC-07 in order for the local pilot. Do not access Vercel. Remote destination validation and production cutover are separate, explicitly authorized follow-ups. DC-08 (PDF) is optional. Only ask the owner for actual missing content, credentials, source-use decisions, or product decisions that block the current task. Routine implementation details follow this plan. Do not request approval repeatedly for the already selected three-tool architecture.

## DC-00 — Establish the new baseline and scope

**Purpose:** prevent implementation from continuing the legacy lifecycle-control plan by accident.

**Read:** root `AGENTS.md`, this folder, `package.json`, `.github/workflows/verify.yml`, `src/server.ts`, `src/operator/commands.ts`, `src/orchestration/pipeline.ts`, `src/pipeline/author-offline.ts`, and the Golden-recordings README.

**Work:**

- Compare current HEAD to reviewed commit `b02a4bc9ad8507295505134cad42d20dc592fa69`; inventory intervening changes.
- Run the existing verification command with a disposable Postgres database equivalent to CI. Never run test cleanup against production.
- Record the actual current baseline, including environment failures and tests not executed.
- Identify deployment/startup side effects, active routes, database migrations, and writes that must be isolated from document mode.
- Inspect the owner-supplied SAE samples and map their actual structures, fields, identifiers, and relationships. Prepare the sample-to-contract matrix in `06-Storage-and-Sample-Onboarding.md`. Verify the exact pinned files and the selected local output root. Distinguish active inputs, historical references, and missing source content. Do not inspect remote storage.
- Create a short transition decision record and map useful assertions to their future tests. Preserve existing behavior at this stage.

**Allowed changes:** planning/decision documentation and test-environment setup needed to run the existing checks. No baseline edits, deletes, or application cutover.

**Acceptance:** baseline reported honestly; three-tool boundary and Markdown decision recorded; exact missing inputs listed; no production data changed.

## DC-01 — Implement profiles, input contracts, and the output plan

**Purpose:** make scope data-driven before adding models.

**Work:**

- Implement the minimal profile/input schemas from `02-Contracts.md` in a new Creator-owned schema namespace. Do not edit legacy schemas in place.
- Add an explicit local SAE profile that loads the pinned inventory roles, verifies read permissions, versions and hashes, and checks the configured local output path without writing. No production or bundled-input fallback. Defer remote loaders to a separately approved task.
- Build the first profile from the owner-supplied SAE samples: Source Register, taxonomy/criteria, cognitive model, final linked Tactic Playbook, schemas, and one Golden Reference capability/anti-pattern pair. Preserve actual formats and IDs. Bind the already-confirmed final-playbook decision to its selected version/hash without requesting approval again.
- Implement conflict reporting, source-coverage matrix, tactic association versus activation distinction, and deterministic requested-document enumeration.
- Build a small synthetic second profile with non-A–F domain IDs and non-five object counts for tests. Clearly label its content synthetic; do not pass it off as approved domain knowledge.
- Add Input and Document Plan operations. Display precise missing-input findings. Any routes registered at this stage must be isolated and authorized from first exposure; do not start the legacy app just to exercise the Creator planner.

**Allowed changes:** `src/document-creator/` profile/input/plan/UI modules, new schema/profile fixtures, tests; narrowly scoped server registration for isolated Creator routes. No model calls or production delivery.

**Acceptance:** exact output IDs and folder paths derive from profiles; duplicate/orphan IDs fail; the final SAE playbook and explicit links are accepted despite obsolete approval wording, while genuinely missing links are reported; changing one input version invalidates the input-set identity; no domain constants leaked into generic code.

## DC-02 — Make source preparation real

**Purpose:** eliminate metadata-only authoring disguised as source grounding.

**Work:**

- Prepare exact permitted source passages for the chosen pair from explicitly selected local files or attributed human-verified excerpts. Test any registered-URL acquisition logic with mocks; do not reach remote services during the local pilot. No runtime upload workflow for authoritative inputs is required.
- Preserve versions, locators, hashes, extraction warnings, and model-use boundaries.
- Add the source-unit contract and cache/checkpoint policy scoped to a run/input set.
- Reject unsupported/scanned sources explicitly or accept a separately attributed human-verified extraction.
- Make source content inspectable before generation, including missing support per requested criterion.
- Add host/redirect/size/time constraints, untrusted-content handling, and server-side authorization for acquisition.

**Allowed changes:** new source modules, selected extraction dependencies with reviewed versions/licenses, input/source UI, tests. No automatic expansion of the Source Register.

**Acceptance:** a real permitted passage reaches the model-ready packet with its locator; metadata-only or inaccessible sources do not support substantive claims; malicious embedded instructions do not change tool behavior; source truncation is visible; acquisition errors do not erase completed work.

## DC-03 — Author and render one fresh pair

**Purpose:** prove new outputs are created from actual current inputs.

**Work:**

- Define one internal document content model and deterministic renderer.
- Implement one bounded pair-authoring operation using source units, confirmed taxonomy/cognitive requirements, templates, and relevant Golden guidance.
- Reuse provider transport and useful existing prompt sections where they fit. Do not reuse the old fourteen-stage execution graph.
- Materialize provider output into the document model and Markdown directly. No preloaded `snapshot.json` or hidden Golden-content substitution.
- Add deterministic validation of structure, references, source bindings, tactic status, output identity, and required sections.
- Generate two readable files and a sanitized HTML preview from the same content.

**Allowed changes:** Creator document/author/render/validate modules, provider adapter modifications required for this path, tests. Extract legacy helpers only when their dependency boundary is small.

**Acceptance:** a controlled non-Golden test response changes actual rendered output; missing support remains unresolved; IDs and storage paths cannot be set by model output; capability and anti-pattern are independent documents; preview cannot execute injected HTML/scripts.

## DC-04 — Review, focused corrections, and durable run control

**Purpose:** make the Creator usable without recreating a control plane.

**Work:**

- Add semantic reviewer output consisting of attributed defects, affected sections, and rationale. Reviewer cannot approve delivery or silently rewrite content.
- Add human review, direct edits, section-scoped repair proposals, before/after diff, and invalidation of stale review.
- Add limits and cancellation, explicit retry, job progress, durable checkpoints, and resume after interruption.
- Use a single authoritative run state and document revision identifiers; keep audit information proportionate to the task.
- Integrate Creator routes and views behind the explicit application mode. Disable legacy boot/resume/drift side effects in document mode.
- Protect state-changing routes with server-side authorization and safe request handling; keep secrets server-side.

**Allowed changes:** Creator review/repair/store/routes/UI modules, additive DB migrations, small mode-aware changes to `src/server.ts`; no edits to applied migrations.

**Acceptance:** a contradictory claim is flagged with its source/section; a correction changes only intended content plus declared dependencies; editing reviewed content prevents stale delivery; provider timeout and server restart retain completed work; document mode invokes no old domain pipeline or register sync.

## DC-05 — Deliver reviewed Markdown to storage

**Purpose:** complete the actual product outcome before expanding breadth.

**Work:**

- Implement connection configuration using secret references and destination identity/prefix checks.
- Implement the local filesystem adapter for immutable Markdown delivery. Run automated write tests against temporary directories, and reserve `knowledge-base/` for the reviewed SAE pilot. Defer remote writes.
- Generate taxonomy-derived paths, immutable version reservations, write/readback verification, and completion receipts.
- Support partial failure and idempotent retry. Store operations metadata outside KB documents.
- Add Delivery and History UI. Make creation review and Hub approval visibly distinct.
- Verify input/schema/Golden references remain read-only and unmodified. Write reviewed documents and receipts only within the selected local output/operations scope. Do not introduce Google Drive credentials, mirrors, or sync jobs.

**Allowed changes:** `src/storage/` where appropriate, Creator delivery modules/UI/tests, additive persistence fields if required.

**Acceptance:** file bytes read from the actual agreed destination match reviewed bytes; a failed second upload produces no complete receipt; retry finishes without duplicate versions; conflicting bytes cannot overwrite an existing version; unrelated paths cannot be written; no Master Table is generated or Hub state changed.

## DC-06 — Batches, explicit regeneration, and reuse

**Purpose:** scale the proven pair flow without multiplying contracts.

**Work:**

- Add explicit pair/domain/document selection and configurable bounded batch execution.
- Track success and failure per object; do not label a partial batch complete.
- Add explicit regenerate-from-new-inputs action producing a new draft/version and content/provenance diff.
- Render requested tactic documents preserving playbook semantics and mapping statuses.
- Verify a second profile works without editing generic application code.
- Add a read-only handoff guide for Master Table Creator describing source prefixes, document metadata, stable section IDs, completion receipts, and rendition relationships. Do not implement the downstream application.

**Allowed changes:** Creator plan/run/render/delivery/UI, profile fixtures, acceptance tests, handoff documentation.

**Acceptance:** deterministic requested count matches outputs; one failure does not lose others; input change produces new versions rather than mutation; second-profile identities/folders work; no whole-domain approval dependency prevents delivery of a valid selected pair.

## DC-07 — Prove the complete local path and prepare cutover

**Purpose:** demonstrate the coherent Creator workflow locally and preserve rollback before any separately authorized production cutover.

**Work:**

- Run the full acceptance matrix and live evaluation in `04-Validation-and-Acceptance.md`.
- Produce a fresh pair different from the owner-supplied Golden Reference pair, using the pinned local input set and real permitted source content. Have the content reviewed against source passages.
- Test deliberate missing support, a genuinely invalid link, interrupted generation, partial delivery, and absent/unreadable required selected inputs. Also test that obsolete approval wording does not block the owner-confirmed final playbook.
- Verify standalone Markdown can be inspected/extracted by an independent reader. Where available, test a sample with the actual separate Master Table Creator/Hub. Document external Markdown support gaps honestly.
- Capture a rollback point and inventory the local pilot database and storage. Make document mode the pilot default only after local success; do not change the deployed default or remove the rollback path.
- Record what can be retired after a separately authorized remote acceptance test and cutover. At retirement, migrate valuable legacy assertions before deleting redundant harnesses and preserve immutable Golden files, historical migrations, and data.

**Allowed changes:** Creator integration, local mode configuration, tests and rollback documentation. Do not remove legacy modules, historical data, migrations, or the existing rollback path as part of the local pilot. A later retirement task must define its deletion scope after dependency and coverage verification.

**Acceptance:** full verification green; local reference-run evidence attached; document mode is the pilot default and has no runtime dependency on legacy control-plane execution; storage/DB rollback documented; no false claim that fixture parity proves fresh authoring; untested remote integration listed.

## DC-08 — Optional PDF rendition

**Purpose:** support a portable human review format after Markdown is proven.

**Work:**

- Choose a renderer after checking maintained primary documentation and deployment compatibility at implementation time.
- Render from the same reviewed document, not a separate model generation.
- Include stable section IDs, readable references, repeated table headers where necessary, page numbers, and sensible page breaks.
- Record logical document/rendition linkage and separate content hashes.
- Test text extraction and visually inspect all pages of representative short/long/table-heavy outputs.

**Acceptance:** no clipped content or missing citations; all required sections survive extraction; the receipt identifies PDF as a rendition; PDF failure does not invalidate a successfully requested Markdown-only run. If PDF was explicitly required in the selected output plan, its failure leaves that delivery incomplete.

## Stop and report conditions

Stop dependent work and report precise missing information when the cognitive-model input is absent, the taxonomy conflicts with supplied schemas, source-use permissions prevent necessary grounding, the destination cannot be authorized, or a live test cannot be performed safely. Continue unrelated local work where possible. Do not invent credentials, approvals, source clauses, mapping permissions, or test results.

Unresolved infrastructure access is a limitation, not a reason to weaken validators or remove tests. A task can be documented as partially implemented; it must not be marked complete with unmet acceptance criteria.
