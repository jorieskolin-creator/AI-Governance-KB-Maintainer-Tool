# Input, document, and storage contracts

These are implementation requirements for the new Creator path. Field names below are proposed v1 contracts, not claims that a schema or API already exists. Implement and validate each Creator-owned schema in the DC task that first uses it (profile and input-set contracts in DC-01). Preserve the supplied schemas and historical examples; do not use their approval fields as new Creator requirements. Examples containing `EXAMPLE` or angle brackets are illustrative and must be rejected as production input.

## 1. KB profile and input set

A profile describes one solution's knowledge-document requirements. A run pins an input set and an output plan to that profile version. It must not read a moving `latest` file halfway through a run.

| Profile field | Required meaning |
| --- | --- |
| `profile_id`, `profile_version`, `kb_id`, `kb_title` | Stable profile and KB identity; namespace all object IDs by KB. |
| `language` | Output language; preserve original-language source locators and quotes where used. |
| `input_refs` | Explicitly selected read-only file/object references for taxonomy/criteria, cognitive model, Source Register, Tactic Playbook, schemas, and the Golden Reference pair. Each has kind, ID, version where available, store/path, verified SHA-256, media type, and provenance. |
| `owner_input_decisions` | Explicit, scoped owner decisions bound to input versions/hashes. Includes use of the supplied final SAE Tactic Playbook despite older incomplete-approval wording; never a global override for unrelated inputs. |
| `output_spec` | Requested document types; required sections and applicability; primary format `markdown`; optional PDF flag; paired work-unit policy. |
| `source_policy` | Permitted input roots/prefixes and source-publication hosts, usage boundaries, extraction limits, and model-egress constraints. |
| `model_config_ref` | Reference to deployed author/reviewer configuration; never API keys. |
| `storage_ref` | Supported destination connection ID, selected location, allowed output/operations scope, and secret references for remote access; no credentials or signed URLs in documents. |
| `limits` | Maximum objects per run, provider concurrency, request timeout, token/cost budget, repair iterations, and extraction bounds. |

Input resolution reads the selected files and produces `input_set_id`, resolved versions/hashes, readiness findings, a coverage matrix, and the selected owner decisions. A hash establishes byte identity, not semantic correctness. The owner’s confirmed final SAE playbook status is already an input decision: record its application to the supplied file/version without asking for the same approval again. Keep original document wording and effective owner-confirmed usage status separately traceable.

### Input precedence and disagreement

- Taxonomy owns object IDs, domain membership, pair membership, and criterion identities.
- The cognitive model owns intended reasoning distinctions and interpretation boundaries.
- The Source Register identifies permitted sources and source-use conditions; actual source material supports substantive claims.
- The Tactic Playbook owns tactic identity, supplied tactic content, and declared mapping scope/status.
- Document schemas specify required structure and field constraints.
- Golden Samples demonstrate quality; they do not silently override any of the above.

If two inputs contradict each other, produce a concrete conflict report. These responsibilities are not a rule for silently choosing one version of contradictory domain content. Keep draft work available but block final delivery of affected documents until the conflict is resolved or an explicit, scoped input decision is recorded.

## 2. Accepted input forms

Inspect the owner-supplied SAE samples before fixing input serialization. The samples demonstrate the actual schema files, Source Register, cognitive model, taxonomy/criteria, linked playbook, and Golden Reference pair. Implement adapters for their actual formats (for example JSON, Markdown, PDF, or static HTML), then document the reusable contracts. Do not require the owner to rewrite all input materials into a new JSON-only format. Internal normalized data may use JSON, independently of original file format. The explicit local SAE profile selects the pinned inventory paths. Production resolves its explicitly configured inputs, not these local test files by default.

Prefer deterministic parsing and schema validation using the structures established from the supplied samples, including PDF/HTML/Markdown inputs. Do not require repeated confirmation for unambiguous fields read by a validated adapter. If extraction requires a model to interpret ambiguous identity or relationship meaning, show the proposed interpretation with source locators for confirmation before using it. A model cannot silently establish the governing taxonomy. Unsupported/scanned content is reported as partial or unreadable; add OCR only where the supplied inputs actually require it and verify the extracted meaning.

The Creator needs only the input-format adapters demonstrated by the supplied reference set. If a required sample is Excel, implement that bounded input adapter; otherwise defer it. Broad-format ingestion of arbitrary manually added KB documents belongs to the separate Master Table Creator and Knowledge Hub.

### 2.1 Taxonomy, criteria, capabilities, and anti-patterns

Require domain ID/title, object ID/type/title, pair relationships where present, criterion IDs and descriptions, applicability, and controlled vocabulary references. Permit arbitrary profile-defined domain names and object counts. A–F and five pairs are Solution Assurance data, not Creator code constants.

Validate duplicate IDs, orphan criteria, ambiguous pair membership, circular containment, and unknown domain references. Cross-domain related-object links may be valid and must not be confused with containment cycles. An anti-pattern may be related to a capability without being its logical negation.

For SAE, the taxonomy and ID register own object identities and pairing; the pinned instrument owns exact primary question IDs, dimensions, and wording, corroborated by the Thinking Flow. Older examples with different question wording never override the instrument. Trace each question to its parent object and applicable cognitive rules. Empty atomic tests, subcriteria, finding definitions, or evidence rules are not approved content; where required, author source-supported proposals for review, not new governing inputs.

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

For each supplied relationship, preserve the mapping identifier where present, target capability/anti-pattern/criterion, relationship type, scope, version, and original status text. Normalize only what is demonstrated by the actual samples. Do not impose an invented finding-level mapping schema if the supplied playbook defines object-level links. Record owner-confirmed effective usage separately when historical status wording differs.

The owner has confirmed that the supplied SAE Tactic Playbook is final and usable for this reference case, even if it contains older incomplete-approval wording. Apply that decision to the selected version/hash; do not block generation, suppress its explicit links, or require a new approval exercise solely because of that wording. Preserve the original text for traceability, but do not propagate an obsolete status as an unresolved defect in generated documents. Validate that the actual linked IDs exist and preserve the relationship meaning. A genuinely missing/ambiguous link remains a data issue: final document status does not invent a relationship. Customer-specific tactic activation is outside Creator’s scope.

Do not infer links from names, embedding similarity, or a shared domain. A source-grounded draft mapping may be proposed outside final content for upstream review, never auto-approved. Completing a tactic cannot be represented as changing a customer finding.

### 2.5 Schemas and Golden Samples

Use separate versioned contracts for profile, input set, internal document, source unit, review result, and delivery receipt. Implement only contracts actually used. Prefer JSON Schema and existing validation tooling; do not make a schema framework.

The document contract has common metadata and type-specific required sections. Different profiles can require different evidence dimensions without changing the engine. Mandatory missing sections produce findings; optional sections may be omitted with explicit template rules.

The minimum Golden Reference is exactly one owner-supplied capability document and its paired anti-pattern document in the selected input set. Record their IDs, versions where present, pair relationship, compatible templates, paths, hashes, and provenance. Use this pair for structure and content-quality expectations. Do not require additional Golden roles or samples to start production. For SAE, validate the pair with the complete pinned schema family in `baseline/sae-training/schemas/`. Resolve `$ref`s only against explicitly loaded, pinned schemas with unique IDs; do not substitute the same-version root shared definitions or fetch schemas from the network. New Markdown uses a Creator-owned content contract that distinguishes methodology interpretation from sourced claims and requires exact passage attribution and applicability boundaries; do not inherit legacy release approvals, historical tactic activation references, or machine-only fields by default. Optional synthetic negative tests belong in the test suite, not the owner’s required input folders. Golden Reference files are excluded from generated KB source inventory unless separately admitted by the Hub. Preserve historical repository fixtures independently; they do not substitute for the supplied Vercel reference.

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

Acquire metadata first, then permitted bytes. Read only explicitly selected local files or configured remote objects, plus registered source-publication locations when enabled by policy. Apply time/size/type limits, restrict redirects, and reject local-network/metadata-service destinations for server-side URL fetches. Never execute macros, document scripts, or embedded instructions. Apply access control to source reads and prepared excerpts.

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

The SAE pilot explicitly selects a local filesystem reader and writer. The allowed output root is `baseline/sae-training/knowledge-base/`. Later, a user supplies a location and access for a supported remote connection; Vercel Blob is a candidate, not a prerequisite. Google Drive is excluded, with no mirror or synchronization job. Never fall back silently to local inputs or output in production. Input roots are read-only; output and operations rights are checked separately from input access.

Connection settings: named connection ID, provider, credential-secret reference, expected store/account identity, access class, allowed root prefix, and path policy. A pasted link does not grant write access. Connection validation checks identity and access without enumerating unrelated stores. A write probe, if needed, uses a documented disposable prefix, confirms its exact path, and cleans up.

Recommended logical layout, mapped to the owner’s actual prepared prefixes rather than imposed or automatically reorganized. Each row is a path template:

| Prefix | Content | Eligible as generated KB source? |
| --- | --- | --- |
| `<root>/<kb-id>/inputs/<input-set-id>/` | Owner-prepared Source Register, taxonomy/criteria, cognitive model, playbook, and input manifest | No, unless separately admitted by Hub |
| `<root>/<kb-id>/schemas/<schema-id>/<version>/` | Owner-prepared schemas used for the run; read-only to Creator | No |
| `<root>/<kb-id>/golden-reference/<pair-id>/<version>/` | Owner-prepared capability + anti-pattern Golden Reference pair; read-only to Creator | No |
| `<root>/<kb-id>/drafts/<run-id>/` | Optional incomplete drafts; private working storage | No |
| `<root>/<kb-id>/documents/<domain-id>/<type>/<object-id>/<version>/document.md` | Reviewed human-readable object | Candidate for later catalog review |
| Same object/version path, `document.pdf` | Optional derived rendition | Same logical document, not independent evidence |
| `<root>/<kb-id>/operations/<run-id>/` | Validation report, provenance, file receipt | No |

Here `<type>` is `capabilities`, `antipatterns`, or `tactics`. Cross-domain tactics have one declared owning domain (or configured `shared` partition) and explicit related-domain metadata; do not duplicate the same tactic into multiple authoritative files. Taxonomy profile maps IDs to safe folder tokens. Do not hardcode A–F or infer identity from folder labels.

For the explicit SAE local pilot, the already-selected `knowledge-base/` folder serves as the document root: `<domain-id>/<type>/<object-id>/<version>/document.md`. Put receipts in `knowledge-base/_operations/<run-id>/`. Do not write drafts or test fixtures as reviewed documents. Automated tests use temporary roots; the reviewed pilot alone uses the selected repository output folder. Reject path escapes, including local symlinks escaping their configured root.

Input materials, schemas, and the Golden Reference pair must be present at the configured locations before generation begins. They are primary runtime inputs, not optional mirrors. The input manifest/configuration resolves their exact object paths. Do not populate, overwrite, rename, or synchronize these inputs automatically. External source-publication URLs in the Source Register may be followed under source policy; missing licensed content is reported without inventing it or copying it into public storage. Blob “folders” are logical prefixes: validate actual input objects and output path permissions, not the existence of an empty directory object.

Path handling rejects traversal, absolute paths, unexpected separators, unsafe tokens, collisions, and writing outside the configured prefix. Unicode titles are content; normalized safe IDs drive paths. Reserve destination versions before writing to avoid concurrent collisions.

### Delivery receipt, not Master Table

A small operational JSON receipt may contain: `receipt_schema_version`, `run_id`, `kb_id`, `input_set_id`, `reviewed_by`, `reviewed_at`, `delivered_at`, expected document IDs, and each file's logical ID/version, rendition, path, media type, byte count, SHA-256, and stored-object identity. It must contain no discovery summaries, theme/keyword enrichment, ranking, Hub approval state, or tactic activation decisions.

Write immutable files, read them back, verify SHA-256, then write the final receipt. Before the final receipt exists, a set is incomplete even if some files are visible. Downstream tools should admit only documents in a completed handoff; manually added documents use their own explicit ingestion process. This is an interface requirement, not an implementation of downstream tools.

Retries with identical bytes at the same path succeed idempotently. Different bytes at an existing version conflict; require a new version. A failed delivery never overwrites an older successful version. A model-content change requires review again; a pure network retry of the already reviewed bytes does not.

Delivery review is separate from Knowledge Hub eligibility. Hub imports new documents as pending review according to its own process; Creator never sets them Approved. Later Master Table Creator reads documents and provenance through authorized read-only access, not Creator's internal DB.

## 6. Examples and limits of examples

For an SAE pair, two illustrative target paths are (use the owner’s selected KB identifier and folder mappings):

- `kb/solution-assurance/documents/A/capabilities/A2/1.0.0/document.md`
- `kb/solution-assurance/documents/A/antipatterns/AP-A2/1.0.0/document.md`

An explicit tactic output might be:

- `kb/solution-assurance/documents/A/tactics/<registered-tactic-id>/1.0.0/document.md`

These paths illustrate the contract. They are not authorization to create a release named `1.0.0`, a mapping, or an existing store. Resolve actual versions, taxonomy, credentials, and destination through the input configuration.
