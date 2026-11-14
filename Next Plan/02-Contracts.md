# Input, document, and storage contracts

These are implementation requirements for the new Creator path. Field names below are proposed v1 contracts, not claims that a schema or API already exists. Implement and validate the schemas in DC-01 before using them. Examples containing `EXAMPLE` or angle brackets are illustrative and must be rejected as production input.

## 1. KB profile and input set

A profile describes one solution's knowledge-document requirements. A run pins an input set and an output plan to that profile version. It must not read a moving `latest` file halfway through a run.

| Profile field | Required meaning |
| --- | --- |
| `profile_id`, `profile_version`, `kb_id`, `kb_title` | Stable profile and KB identity; namespace all object IDs by KB. |
| `language` | Output language; preserve original-language source locators and quotes where used. |
| `input_refs` | References for taxonomy, cognitive model, source register, tactic playbook, document schemas, Golden Samples. Each has kind, ID, version, URI/path, content SHA-256, media type, and declared approval/provenance. |
| `output_spec` | Requested document types; required sections and applicability; primary format `markdown`; optional PDF flag; paired work-unit policy. |
| `source_policy` | Permitted sources/hosts, upload policy, usage boundaries, extraction limits, and model-egress constraints. |
| `model_config_ref` | Reference to deployed author/reviewer configuration; never API keys. |
| `storage_ref` | Named connection and approved root prefix; no credentials or signed URLs embedded in documents. |
| `limits` | Maximum objects per run, provider concurrency, request timeout, token/cost budget, repair iterations, and extraction bounds. |

Input resolution produces `input_set_id`, resolved versions/hashes, validation findings, a coverage matrix, and explicit operator confirmation of the set. A hash establishes identity, not approval or correctness. Store declared approval separately from verification of the bytes.

### Input precedence and disagreement

- Taxonomy owns object IDs, domain membership, pair membership, and criterion identities.
- The cognitive model owns intended reasoning distinctions and interpretation boundaries.
- The Source Register identifies permitted sources and source-use conditions; actual source material supports substantive claims.
- The Tactic Playbook owns tactic identity, supplied tactic content, and declared mapping scope/status.
- Document schemas specify required structure and field constraints.
- Golden Samples demonstrate quality; they do not silently override any of the above.

If two inputs contradict each other, produce a concrete conflict report. These responsibilities are not a rule for silently choosing one version of contradictory domain content. Keep draft work available but block final delivery of affected documents until the conflict is resolved or an explicit, scoped input decision is recorded.

## 2. Accepted input forms

MVP structured profiles, taxonomy, register, and playbook use JSON conforming to versioned contracts. Markdown is the preferred cognitive-model and Golden-document input; supplied PDF and static HTML can also be extracted. Existing legacy JSON Golden fixtures are read through an adapter and never mutated.

When an authority is supplied only as PDF/HTML/Markdown, extract a proposed structured interpretation with source locators, show it for confirmation, and pin that confirmation before it controls identities or relationships. A model may suggest extraction; it cannot silently establish the governing taxonomy. Unsupported/scanned content is reported as partial or unreadable. OCR is a later optional capability or an explicit manually verified extraction path; do not fabricate readable text.

Excel input parsing is not a first-release requirement for Creator. The separate Master Table Creator and Knowledge Hub own broad-format ingestion of manually added KB documents. A later explicit Creator input need may add a reviewed Excel adapter.

### 2.1 Taxonomy, criteria, capabilities, and anti-patterns

Require domain ID/title, object ID/type/title, pair relationships where present, criterion IDs and descriptions, applicability, and controlled vocabulary references. Permit arbitrary profile-defined domain names and object counts. A–F and five pairs are Solution Assurance data, not Creator code constants.

Validate duplicate IDs, orphan criteria, ambiguous pair membership, circular containment, and unknown domain references. Cross-domain related-object links may be valid and must not be confused with containment cycles. An anti-pattern may be related to a capability without being its logical negation.

The output plan enumerates exact expected object IDs. Titles never serve as identities. Changes to published identity require an explicit upstream migration; ordinary title edits do not change IDs.

### 2.2 Source Register aligned with taxonomy

Require source ID, title, publisher/authority, version/date, official location or verified upload reference, effective status, verification provenance/date, scope/applicability, licensing/model-use policy, and domain/object/criterion coverage references. Where coverage currently exists only at domain level, identify that as coarse coverage and require actual claim support during authoring.

Do not require every registered source to support every document. Report sources unused by the selected scope and requested criteria with no available support. The tool does not search for and approve new authorities automatically.

Separate source-register approval, source accessibility, source version identity, and semantic support. A previously approved entry can be inaccessible, superseded, or unsuitable for the selected scope.

### 2.3 Cognitive model

Require model ID/version plus an explicit mapping to the document content requirements: definitions, assessment dimensions, admissible evidence, uncertainty/unknown handling, applicability, contradictions, false-positive guards, prohibited inferences, and human decision boundaries. Lifecycle/scoring concepts are included only when the selected profile requires them.

The Creator documents these rules. It does not execute a customer assessment or infer implementation from an authoritative publication. A profile-specific reviewer checks that cognitive-model meaning survives into the output.

### 2.4 Tactic Playbook and links

Require tactic ID/version/title, purpose, supplied activities/outputs, prerequisites, limitations, verification/acceptance content, and explicit capability/anti-pattern relationships. Preserve source support and ownership information when supplied.

For each relationship, retain `mapping_id`, target object/criterion, relationship type, scope (`OBJECT_ASSOCIATION` or `FINDING_ACTIVATION`), mapping version, and status (`APPROVED`, `PENDING`, `REJECTED`, `RETIRED`), or equivalent faithfully imported values.

Object-level association is not finding-level activation permission. The existing playbook's pending activation mappings must remain pending. An object document may disclose a pending association in an unresolved-mappings section when the profile permits it, but must never call that tactic allowed or activated. Pending-only associations are excluded from approved actionable mapping sections. If an output requires an approved mapping, its absence blocks that output's readiness; if not, the explicit omission is acceptable.

Do not infer links from names, embedding similarity, or a shared domain. A source-grounded draft mapping may be proposed outside final content for upstream review, never auto-approved. Completing a tactic cannot be represented as changing a customer finding.

### 2.5 Schemas and Golden Samples

Use separate versioned contracts for profile, input set, internal document, source unit, review result, and delivery receipt. Implement only contracts actually used. Prefer JSON Schema and existing validation tooling; do not make a schema framework.

The document contract has common metadata and type-specific required sections. Different profiles can require different evidence dimensions without changing the engine. Mandatory missing sections produce findings; optional sections may be omitted with explicit template rules.

Each Golden Sample has ID, version, role, compatible template/profile, location, hash, and provenance. Roles are `STRUCTURE_EXAMPLE`, `CONTENT_QUALITY_EXAMPLE`, or `NEGATIVE_TEST`. Samples must not become assessable KB documents accidentally. Legacy A1/AP-A1 remain unchanged; new sample versions live in a separate profile-owned location.

## 3. Source-unit contract

Prepared source units need stable identity and auditable attribution:

| Field | Meaning |
| --- | --- |
| `source_unit_id` | Code-owned identifier scoped to source version and locator. |
| `source_id`, `source_version` | Exact register identity and edition. |
| `original_sha256` | Verified original bytes when available; absence explicitly recorded. |
| `locator` | PDF page/section, Markdown heading/lines, HTML section, or JSON path; preserve extraction coordinates. |
| `text` or approved bounded representation | Actual usable content, subject to source policy. |
| `extraction_status`, `limitations` | Complete/partial/failed and reasons; source-level completeness differs from selected excerpt completeness. |
| `usage_policy`, `model_eligible` | Whether and how the content may enter provider requests. |
| `retrieved_at`, `extractor_version`, `text_sha256` | Acquisition and transformation provenance. |

Acquire metadata first, then permitted bytes. Fetch only registered locations or explicitly confirmed uploads. Apply time/size/type limits, restrict redirects, and reject local-network/metadata-service destinations for server-side URL fetches. Never execute macros, document scripts, or embedded instructions. Apply access control to uploads and prepared excerpts.

Source ingestion may be incomplete. Show truncation and the exact affected claims; a truncated page must not be labeled complete. Hashing the selected excerpt does not prove completeness of the original. Retain only permitted source material under a configurable retention policy; output documents contain permitted citations and necessary text, not entire licensed publications by default.

## 4. Internal document and human-readable output

The internal model contains content sections and reference selections needed for validation and rendering. It may be stored as JSON internally. It is not a machine-consumed KB release and must not be placed in the Hub's source-document folder.

### Common metadata

- Logical `document_id`, namespaced `kb_id`/`object_id`, document type, document version.
- Title, domain ID/title, language, template/schema version.
- Input-set ID and resolved baseline versions; provenance reference.
- Creation-review state; explicitly not Hub approval status.
- Section IDs, source references, related object references, declared tactic mapping references.

Code assigns metadata and section identities from the selected profile/output plan. Models select allowed handles. Human-readable section headings include stable identifiers, for example `## A2.DEF — Definition and purpose`. Preserve IDs when wording changes. Source references resolve to a bibliography containing edition, location, and source-use limitations; URL alone is insufficient.

Use compact YAML front matter for identity/version fields if chosen in DC-01, with safe parsing and no executable tags. The readable title and metadata panel are rendered from the same values, never independently authored. All essential content remains understandable in plain Markdown without front-matter tooling.

### Required capability sections

1. Identity, definition, purpose, and scope.
2. Applicability and exclusions.
3. Criteria/questions and required interpretation dimensions.
4. Evidence requirements and evidence sufficiency boundaries.
5. Interpretation rules, unknown/conflict handling, false-positive guards, prohibited inferences.
6. Lifecycle/assurance expectations where the profile requires them.
7. Related capability/anti-pattern links and their meaning.
8. Approved tactic associations, if any, with scope/conditions; no activation implication.
9. Source-supported claims, precise citations, and methodology interpretations distinguished.
10. Unresolved items and creation-review/version information.

### Required anti-pattern sections

1. Identity, definition, failure mechanism, and scope.
2. Observable indicators, triggering conditions, non-examples, and false-positive guards.
3. Criteria/questions and evidence requirements.
4. Presence interpretation, tested-absence requirements, and unknown handling.
5. Contradictions, applicability/exclusions, and prohibited inferences.
6. Paired capability relationship without implying automatic inverse assessment.
7. Lifecycle/assurance expectations where required.
8. Approved tactic associations and their boundaries, if any.
9. Source support, methodology interpretation, and unresolved items.
10. Creation-review/version information.

### Optional tactic sections

Identity/version, intended outcome, related capability/anti-pattern IDs, exact mapping scope/status, prerequisites and do-not-use conditions, activities, outputs, accountable roles, verification/acceptance, reassessment boundary, source support, and unresolved mappings. Preserve the supplied playbook's meaning; absence of a field is a gap, not authority to invent the field.

### Content rules

- Separate sourced requirements from the selected method's interpretation and examples.
- Do not convert examples or proposals into established requirements or measured outcomes.
- Distinguish guidance/standards from legislation according to the supplied authority metadata; the Creator does not determine legal applicability on its own.
- Do not include customer-case evidence as reusable normative knowledge.
- Unknown is an acceptable explicit draft result, not a failure to fill with plausible content.
- Final delivery requires all mandatory content and blocking issues resolved. Optional omissions remain explicit. An incomplete draft can be downloaded locally or saved outside the ready-documents area, clearly labeled; it is not a completed handoff.
- Preserve quotations and paraphrases within the permitted source-use boundary. Do not include credentials, private tokens, or temporary signed URLs.

## 5. Storage contract and taxonomy-based structure

First production adapter: Vercel Blob, reusing current code where suitable. Local filesystem adapter supports development/tests. Add other production destinations only on an actual need. Storage is independent of backend hosting.

Connection settings: named connection ID, provider, credential-secret reference, expected store/account identity, access class, allowed root prefix, and path policy. A pasted link does not grant write access. Connection validation checks identity and access without enumerating unrelated stores. A write probe, if needed, uses a documented disposable prefix, confirms its exact path, and cleans up.

Recommended layout, where each row is a path template:

| Prefix | Content | Eligible as generated KB source? |
| --- | --- | --- |
| `<root>/<kb-id>/inputs/<input-set-id>/` | Permitted pinned input files and input manifest | No, unless separately admitted by Hub |
| `<root>/<kb-id>/schemas/<schema-id>/<version>/` | Document/profile contract copies used for the run | No |
| `<root>/<kb-id>/golden-samples/<sample-id>/<version>/` | Permitted quality examples and negative examples | No |
| `<root>/<kb-id>/drafts/<run-id>/` | Optional incomplete drafts; private working storage | No |
| `<root>/<kb-id>/documents/<domain-id>/<type>/<object-id>/<version>/document.md` | Reviewed human-readable object | Candidate for later catalog review |
| Same object/version path, `document.pdf` | Optional derived rendition | Same logical document, not independent evidence |
| `<root>/<kb-id>/operations/<run-id>/` | Validation report, provenance, file receipt | No |

Here `<type>` is `capabilities`, `antipatterns`, or `tactics`. Cross-domain tactics have one declared owning domain (or configured `shared` partition) and explicit related-domain metadata; do not duplicate the same tactic into multiple authoritative files. Taxonomy profile maps IDs to safe folder tokens. Do not hardcode A–F or infer identity from folder labels.

Input manifests may reference externally hosted inputs when copying is not permitted. Preserve provenance and verified hashes where possible; report the limitation. Never copy private/limited-use source inputs into a public storage area. Input/schemas/Golden folders are optional physical mirrors according to policy, but their logical references are required in the input set.

Path handling rejects traversal, absolute paths, unexpected separators, unsafe tokens, collisions, and writing outside the configured prefix. Unicode titles are content; normalized safe IDs drive paths. Reserve destination versions before writing to avoid concurrent collisions.

### Delivery receipt, not Master Table

A small operational JSON receipt may contain: `receipt_schema_version`, `run_id`, `kb_id`, `input_set_id`, `reviewed_by`, `reviewed_at`, `delivered_at`, expected document IDs, and each file's logical ID/version, rendition, path, media type, byte count, SHA-256, and stored-object identity. It must contain no discovery summaries, theme/keyword enrichment, ranking, Hub approval state, or tactic activation decisions.

Write immutable files, read them back, verify SHA-256, then write the final receipt. Before the final receipt exists, a set is incomplete even if some files are visible. Downstream tools should admit only documents in a completed handoff; manually added documents use their own explicit ingestion process. This is an interface requirement, not an implementation of downstream tools.

Retries with identical bytes at the same path succeed idempotently. Different bytes at an existing version conflict; require a new version. A failed delivery never overwrites an older successful version. A model-content change requires review again; a pure network retry of the already reviewed bytes does not.

Delivery review is separate from Knowledge Hub eligibility. Hub imports new documents as pending review according to its own process; Creator never sets them Approved. Later Master Table Creator reads documents and provenance through authorized read-only access, not Creator's internal DB.

## 6. Examples and limits of examples

For a Solution Assurance A2 pair, two illustrative target paths are:

- `kb/solution-assurance/documents/A/capabilities/A2/1.0.0/document.md`
- `kb/solution-assurance/documents/A/antipatterns/AP-A2/1.0.0/document.md`

An explicit tactic output might be:

- `kb/solution-assurance/documents/A/tactics/<registered-tactic-id>/1.0.0/document.md`

These paths illustrate the contract. They are not authorization to create a release named `1.0.0`, a mapping, or an existing store. Resolve actual versions, taxonomy, credentials, and destination through the input configuration.
