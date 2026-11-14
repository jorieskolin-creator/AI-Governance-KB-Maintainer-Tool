# Document Creator implementation plan

## 1. Outcome and boundary

Document Creator turns an explicitly selected input baseline into reviewed, source-supported knowledge documents and delivers those documents to a configured destination. An operator selects a KB profile, confirms inputs and requested outputs, reviews the result, fixes defects, and delivers a version.

The first real KB is the owner’s Solution Assessment Engine reference case (SAE); supplied materials may retain the Solution Assurance Engine name. Use the actual IDs and titles from the owner’s input set. A small second profile should prove reuse without copying the application. Reusability comes from configurable taxonomy, document requirements, and storage, not a universal workflow designer.

### In scope

- Read and validate the owner-prepared Vercel input set; expose missing files, contradictory versions, and coverage gaps before starting generation.
- Prepare source passages from the configured Vercel source-content files or registered source-publication locations.
- Create a deterministic output checklist from taxonomy and requested scope.
- Author capability, anti-pattern, and optionally tactic documents.
- Check structure and references deterministically; review meaning against available source content.
- Let the user read, edit, and request targeted corrections while preserving attribution.
- Render Markdown, show a sanitized HTML preview, and later optionally export PDF.
- Deliver immutable document versions and a small completion receipt to one agreed destination.
- Generate a revised version on explicit request using a newly confirmed input baseline.

### Outside this product

- Creating, approving, or routinely maintaining Source Registers, taxonomies, cognitive models, or playbooks.
- Creating, enriching, editing, or publishing Master Table JSON.
- Search/MCP endpoints or knowledge Packages for analysis solutions.
- Monitoring all published KB content or synchronizing multiple masters.
- Customer assessment, scoring, finding lock, risk acceptance, or remediation execution.
- Google Drive input/output, mirroring, or synchronization; repository-bundled production input defaults.
- Creating, reorganizing, or populating the owner’s input folders automatically.
- Automatic modification of a Knowledge Hub's statuses or catalog.

Creator reads source inputs, schemas, and the Golden Reference from Vercel without modifying them. Report a concrete input problem and, if useful, export a proposed correction for the owner; the owner supplies a replacement version. Never silently repair an input authority. Honor the owner’s already-confirmed final SAE playbook decision; do not repeatedly request approval because of older labels.

## 2. Current code and the practical starting point

The baseline reviewed on 14 November is `b02a4bc9ad8507295505134cad42d20dc592fa69`. Reinspect HEAD before implementation and describe changes since this commit.

| Observation | Repository evidence | Consequence |
| --- | --- | --- |
| Live UI still calls the 14-task sequence | `src/operator/commands.ts`; `src/orchestration/pipeline.ts` | Do not bolt more authoring modes onto this sequence. |
| Consolidated task modules exist | `src/pipeline/` | Reuse useful contracts and prompts after reviewing their assumptions. |
| Offline authoring validates packets but compiles a separately loaded snapshot | `src/pipeline/author-offline.ts` | Implement and test actual transformation of fresh task outputs. |
| Default source context uses metadata-only policy and no supplied locators | `src/orchestration/source-context-acquisition.ts`; calls in `src/operator/commands.ts` | Source content acquisition must precede new authoring. |
| Domains and slots are fixed in several layers | `src/orchestration/pipeline.ts`; `src/operator/commands.ts`; `schemas/` | Move Creator identity and domain enumeration into the selected profile. |
| Change-impact lookup is a placeholder | `src/register/service.ts`, `affectedPairsForSources()` | Do not present it as implemented maintenance capability; maintenance is out of scope. |
| Immutable storage operations already exist | `src/storage/artifact-store.ts`; `src/storage/vercel-blob.ts` | Adapt rather than replace sound idempotency and integrity logic. |

These are code-migration observations, not assertions about the documentation the owner will supply. DC-00 establishes a fresh complete test baseline with disposable Postgres. Design production input adapters from the owner’s supplied samples and Vercel files, not from assumptions about old repository assets.

## 3. Output-format decision

| Candidate | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| Markdown | Human-readable source; stable headings; easy diff, editing, and extraction; simple templates | Complex visual layouts and wide tables need restraint | Primary format for the first release |
| HTML | Good browser reading and navigation | Requires sanitization; scripts/styles and layout can confuse extraction; another source copy can diverge | UI preview only |
| PDF | Familiar portable review artifact with fixed pages | More rendering/extraction work; page layout can split rules and tables | Optional later rendition of the same document version |

Generate Markdown from one validated internal document model. Do not independently ask a model to write Markdown, HTML, and PDF versions. The HTML preview and PDF, when enabled, must derive from that same reviewed model/Markdown. A PDF has a separate byte hash but the same logical document ID and version. Its rendition relationship prevents duplicate indexing by later tools.

Content correctness and clear structure take priority over visual styling. Use short sections, explicit headings, simple tables, and text explanations for relationships. No essential meaning should depend on an image, color, hover text, or browser execution.

The target Knowledge Hub must support Markdown before it can retrieve these documents directly; verify the actual target during integration. This is an external integration dependency, not permission to build Hub functionality here. Verify it with an exported sample. If the target Hub cannot yet ingest Markdown, retain the documents and use a reviewed derived PDF or arrange the separate Hub change; do not report successful Hub integration without a test.

## 4. Product workflow

### 4.1 Select and confirm inputs

Select the configured Vercel connection and a named KB input set. Before generation, check the owner-prepared prefixes, permissions, schemas, Source Register, taxonomy/criteria, cognitive model, playbook, and Golden Reference pair. The UI displays the resolved versions and output destination. A missing input leaves the workspace available with an exact readiness finding, but no model authoring starts. Pin the loaded versions and hashes for the run; show technical details in a secondary panel. See `06-Storage-and-Sample-Onboarding.md`.

Validate identities and relationships first. Build a coverage matrix linking each requested object to taxonomy criteria, relevant cognitive requirements, supporting registered sources, sample roles, and tactic links. Missing source coverage is an authoring gap, not an invitation to invent a source.

The Source Register is prepared upstream based on the taxonomy and assessment needs. The Creator checks its coverage and uses it; it does not autonomously create or expand it.

### 4.2 Plan the requested documents

The user selects one pair, a domain, or an explicit list. Code derives required outputs, stable IDs, applicable templates, and destination paths. Show the checklist before running models.

Default: a capability and its paired anti-pattern are authored in one work unit but stored as two independently readable documents. Preserve their independent assessment meanings. A capability gap does not establish anti-pattern presence.

Optional tactic rendering creates one document per requested tactic. It preserves supplied content and approved relationships; it does not invent new tactics or grant activation rights. Supporting overview or methodology documents are generated only when named in the output specification. Do not create a Source Register, taxonomy, or Master Table as a side effect.

### 4.3 Prepare the source material

Read the input documents and available source-content files from the configured Vercel locations. If the Source Register points to external normative publications, acquire permitted content from those registered locations through a bounded adapter; this does not make external locations alternative stores for the Creator’s input baseline or generated documents. Preserve original source version, exact locator, extraction result, and usage policy. Provide source context from the beginning of authoring, not only during a later mapping task.

A source title, URL, or `VERIFIED` register flag does not prove a claim. A metadata-only source can identify a reference, but it cannot supply unseen substantive requirements. If usable source material is unavailable, show the gap and keep affected claims unresolved. Human-supplied verified excerpts are an explicit alternative with provenance.

Treat all source documents as untrusted content. They may supply knowledge, not instructions to change tools, reveal secrets, approve outputs, or contact other locations.

### 4.4 Author, validate, and review

Start with one authoring call per pair and a separate semantic review call. Split authoring into a small number of sections only if measured quality, context size, or provider limits justify it. No fourteen-task chain and no fixed number of calls as a proxy for quality.

Code owns identity, versions, locators, paths, state, hashes, and delivery. The model writes content and selects only supplied reference handles. New semantics must be attributed to source support or explicitly labeled methodology interpretation grounded in the selected cognitive model.

Deterministic validation covers schema, required sections, vocabulary, identity/reference existence, mapping status, source version bindings, and output completeness. Semantic review examines interpretation, unsupported claims, contradictions, false-positive guards, and whether source passages actually support the text. Hash checks cannot prove semantic truth.

Golden Samples guide specificity, structure, and quality. They are neither universal wording requirements nor sources of new normative claims. Use the supplied Golden Reference pair to learn expected structure and depth without forcing every domain to copy its counts or domain-specific content.

### 4.5 Correct and deliver

Show a readable document with source references, unresolved items, and a diff from the prior draft. A correction targets document sections and their dependencies, not an entire domain. Any change to reviewed content invalidates its review; byte-identical delivery retries do not.

Defaults: one proposed targeted repair pass, then review; further passes require an explicit continuation. Apply request timeouts and configurable token/cost limits; expose partial work after interruptions. A retry must not become an unlimited autonomous repair loop.

The user confirms the final document set and destination. Store the exact reviewed bytes as immutable versions. Store a completion receipt last after verifying every expected file. Failed or partial delivery stays visible and resumable. It never appears as complete or as Hub-approved.

## 5. UI

Use five views with one primary action per stage:

| View | User sees | Primary action |
| --- | --- | --- |
| Inputs | Baseline versions, missing material, taxonomy/source coverage, connection status | Validate inputs |
| Document plan | Requested objects, output count, templates, destination paths | Create drafts |
| Documents | Markdown preview, references, gaps, review findings, targeted diffs | Review / correct |
| Delivery | Exact versions, review state, file list, storage connection | Deliver documents |
| History | Completed and interrupted runs, input versions, delivery receipts | Open or resume |

Do not expose SIR handles, fourteen task tiles, domain gate ledgers, or provider-routing internals as the ordinary workflow. Keep diagnostics available in a details view. The UI must support keyboard use, clear text statuses, cancellation, and explicit retry. Server-side authorization protects model calls, source import, destination changes, and writes; a hidden button is not access control.

## 6. Technical shape

Retain TypeScript ESM, Fastify, the current validation tools, and the deployed database unless measurement shows a reason to replace them. Avoid a framework rewrite alongside the product rewrite.

Create a self-contained `src/document-creator/` entry path with these logical modules. Combine files where separation adds no value:

| Module | Responsibility |
| --- | --- |
| `profile` and `inputs` | Sample-derived adapters, Vercel reads, readiness validation, pinned input set |
| `sources` | Permitted acquisition, extraction, source units and locators |
| `plan` | Deterministic document list and coverage matrix |
| `author` | Bounded provider call using prepared content |
| `document` and `validate` | One internal content contract and deterministic checks |
| `review` and `repair` | Semantic findings, user review, focused corrections |
| `render` | Markdown and safe preview; optional PDF later |
| `delivery` | Paths, storage adapter, byte verification, completion receipt |
| `store` and `routes` | Durable run state and server API |

A single JSON Schema per contract is authoritative; derive types or test type/schema agreement. Avoid duplicating a contract across cognitive, materializer, verifier, resolver, and UI definitions. The internal model should be only as rich as required to render and validate the documents. It is not a new universal SIR framework.

Suggested API operations: validate an input set, preview a document plan, start/resume/cancel a run, get/edit a draft, request targeted repair, record review, and deliver a reviewed set. Actual route names are chosen in DC-01/DC-04. There is no consumer retrieval API.

Use durable jobs with bounded concurrency. MVP default is one active pair per run. Persist a checkpoint after source preparation and after each draft/review result. On restart, mark an interrupted provider request accurately; do not assume a missing response means no billing occurred or silently replay a completed write.

Use one authoritative run record with per-document revision and findings, plus delivery records. Derive progress from these records. Do not recreate four overlapping state machines. A proposed run vocabulary is `INPUTS_REQUIRED`, `READY`, `GENERATING`, `REVIEW_REQUIRED`, `READY_TO_DELIVER`, `DELIVERING`, `DELIVERED`, `FAILED`, `CANCELLED`. These are creation states, not Hub publication states.

Keep existing tables and applied migrations intact during migration. Add new tables only for durable Creator state that cannot sensibly reuse existing infrastructure. Do not drop historical data as part of code cleanup.

## 7. Component migration

| Existing area | Action | Boundary |
| --- | --- | --- |
| `baseline/`, root Source Register, `schemas/`, `golden/` | Development/history references only; preserve existing regression fixtures | Production uses the owner-selected Vercel versions; no bundled-input fallback. |
| `src/assets/` | Reuse validation/loading concepts | Remove hardcoded default file dependence from the new path. |
| `src/pipeline/` | Selectively reuse prompts and checks | Avoid inheriting the offline snapshot dependency. |
| `src/compiler/` | Extract small identity/reference utilities if useful | New output must not require full legacy SIR compilation. |
| `src/ai/` | Reuse provider transport where suitable | Simple configurable author/reviewer roles; optional fallback, no unnecessary provider expansion. |
| `src/storage/` | Reuse immutable write semantics | Add content-type support, scoped destinations, post-write readback, and completion receipts. |
| `src/register/` | Remove from Creator routes and startup | Input register editing/mirroring is outside the product; archive only after cutover. |
| `src/operator/` | Replace user-facing journey | Preserve legacy access during staged migration, then disconnect. |
| `src/cognitive/`, `src/sir/`, old orchestration/release/validation | Retire after new-path proof | Delete only after call-site inventory and replacement tests; preserve retained shared helpers. |
| Bespoke `run-*-check.ts` scripts | Migrate useful assertions | Delete redundant harnesses only after replacement coverage exists. |
| Old database tables and stored releases | Preserve | Separate future data-retention decision, not this migration. |

Use `CREATOR_MODE=legacy|document` (or an equivalently explicit configuration) during migration. Do not allow both modes to write the same logical output version. Keep new storage paths separate. In document mode, legacy pipeline resume, register drift, and mandatory Drive sync must not start. Disabling legacy boot side effects is part of integration, not merely a navigation change.

After DC-07 passes, use document mode as the default. Archive old code after a documented rollback checkpoint. Using Vercel as input and output storage does not require moving the running backend to Vercel; retain the existing suitable hosting arrangement.

## 8. Completion and handoff

The MVP is complete when a fresh non-Golden pair is created from real permitted source material, reviewed, corrected, delivered, and read back from the destination with matching bytes; an independent reader can recover its meaning and source references from the Markdown alone. A second, small non-A–F profile proves configurable identity and folders without generating a full second KB.

Document Creator hands off a completed document set, not a catalog. Master Table Creator may later inspect the documents using read-only storage access. Knowledge Hub decides what is approved and retrievable. Neither is called automatically by Document Creator.

The authoritative implementation sequence is [03-Augment-Tasks.md](03-Augment-Tasks.md); acceptance evidence is specified in [04-Validation-and-Acceptance.md](04-Validation-and-Acceptance.md).
