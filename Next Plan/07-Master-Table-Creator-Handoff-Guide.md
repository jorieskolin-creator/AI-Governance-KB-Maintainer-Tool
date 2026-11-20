# Read-Only Handoff Guide for Master Table Creator

## 1. Three-Tool Boundary

KB Document Creator, Master Table Creator, and Solution Knowledge Hub are independent tools with explicit storage handoffs:

| Tool | Responsibility | Storage Access |
| --- | --- | --- |
| **KB Document Creator** *(this repository)* | Validates pinned inputs, acquires permitted source passages, authors/reviews/repairs Markdown knowledge documents, and delivers immutable versions + completion receipts to storage | Scoped read on inputs; scoped write on `<output_root>` and `<operations_root>` |
| **Master Table Creator** *(separate downstream tool)* | Reads completed, receipted Markdown documents and provenance from storage and proposes a Master Table JSON | **Read-only** access to `<output_root>` and `<operations_root>`; never reads Creator's internal database |
| **Solution Knowledge Hub** *(separate downstream tool)* | Imports and governs Master Table JSON, manages Hub approval status, and serves retrieval Packages to consuming analysis engines | Owns Hub eligibility and approval; Creator never sets Hub status to `Approved` |

KB Document Creator never generates a Master Table, never computes discovery rankings or keyword/theme enrichments, and never calls Master Table Creator or Knowledge Hub automatically.

---

## 2. Storage Prefixes and Exclusion Rules

Within a configured output root (for the local SAE pilot, `baseline/sae-training/knowledge-base/`):

### 2.1 Candidate Document Prefixes (Admissible Only When Receipted)

- `<domain-folder-token>/capabilities/<object-id>/<version>/document.md`
- `<domain-folder-token>/antipatterns/<object-id>/<version>/document.md`
- `<domain-folder-token>/tactics/<tactic-id>/<version>/document.md`
  - Cross-domain tactics use the configured single partition (default `shared/tactics/<tactic-id>/<version>/document.md`) and list all related domains in document metadata so the same tactic is never duplicated across domain folders.
- Optional derived PDF renditions (when enabled in DC-08) live alongside the Markdown source at `<domain-folder-token>/<type>/<object-id>/<version>/document.pdf`.

`<domain-folder-token>` is profile-defined (`A`..`F` for SAE, or custom tokens such as `operations-continuity` / `security-mesh` in other profiles). Downstream readers must not hardcode `A`–`F` or infer object identity from folder names alone.

### 2.2 Excluded Non-Document Prefixes (Never Ingest as KB Source Documents)

Master Table Creator must **exclude** the following prefixes and files:

- `_operations/` and `operations/` — operational completion receipts and run diagnostics
- `drafts/` — private working drafts
- `inputs/` and `references/` — upstream registers, criteria PDFs, cognitive models, playbooks, and bound reference PDFs
- `schemas/` — JSON Schemas
- `golden-reference/`, `golden/`, `Samples/`, `samples/` — calibration and regression fixtures
- `.gitkeep` marker files
- Any file under `<output_root>` that is **not** listed in a verified `completion-receipt.json` (e.g., a partial upload from an interrupted delivery)

---

## 3. Completion Receipts and Admission Rule

Every completed delivery writes an immutable receipt last under `<operations_root>`:

- Primary receipt path for a run: `<operations_root>/<run-id>/completion-receipt.json`
- Successor version receipt path (when the same run delivers a newer version): `<operations_root>/<run-id>/<version>/completion-receipt.json`

### 3.1 Receipt Verification Rule for Downstream Tools

Before admitting any delivered set, Master Table Creator must:

1. Parse `completion-receipt.json` and verify `receipt_schema_version === "1.0.0"`.
2. Confirm every ID in `expected_document_ids` has a corresponding entry in `files[]`.
3. For each entry in `files[]`, read the stored file at `<output_root>/<file.path>` and verify both `byte_count` and `sha256` match the receipt.
4. Treat `creation_review_status: "REVIEWED_FOR_DELIVERY"` and `hub_approval_status: "NOT_GRANTED_BY_CREATOR"` as creation-handoff metadata only — downstream Hub ingestion still imports documents as pending Hub review according to its own governance process.

If a `completion-receipt.json` is absent or any listed file fails byte/SHA-256 verification, the delivery set is incomplete and must not be admitted.

---

## 4. Document Metadata, Front Matter, and Stable Section IDs

Each delivered `document.md` is standalone, human-readable UTF-8 Markdown containing:

### 4.1 Safe YAML Front Matter & Metadata Table

Both the compact YAML front matter (plain JSON-quoted string scalars, zero executable YAML tags) and the top-of-document Markdown metadata table carry identical code-assigned values:

- `document_id`: `<kb_id>:<object_id>` (e.g., `solution-assurance-engine:A2`)
- `kb_id`, `object_id`, `object_type` (`capability` | `antipattern` | `tactic`), `document_version`, `title`
- `domain_id`, `domain_title`, `pair_id` (`NONE` for standalone tactics), `paired_object_id` (`NONE` for standalone tactics)
- `language`, `schema_version` (`1.0.0`), `input_set_id` (64-char SHA-256 of pinned inputs and scoped owner decisions)
- `creation_review_state` (`READY_TO_DELIVER`) and `hub_approval_status` (`NOT_GRANTED_BY_CREATOR`)
- `is_synthetic` (`true` for synthetic test fixtures, `false` for production/pilot KBs)

### 4.2 Stable Section Heading Identifiers

Every level-2 section heading uses the deterministic format:

```markdown
## <OBJECT_ID>.<SECTION_CODE> — <Section Title>
```

Standard section codes by `object_type`:

| Object Type | Standard Section Codes (`<OBJECT_ID>.<CODE>`) |
| --- | --- |
| `capability` | `DEF`, `APP`, `CRI`, `EVI`, `INT`, `LIF` *(optional per profile)*, `REL`, `TAC`, `SRC`, `REV`, `BIB` |
| `antipattern` | `DEF`, `IND`, `CRI`, `ABS`, `CON`, `REL`, `LIF` *(optional per profile)*, `TAC`, `SRC`, `REV`, `BIB` |
| `tactic` | `ID`, `MAP`, `PRE`, `ACT`, `VER`, `REV`, `BIB` |

- Under `<OBJECT_ID>.SRC`:
  - `### Sourced Claims (External Registered Publications)` — each claim carries a stable `claim_id` (`<OBJECT_ID>-CLM-NNN`), `support_state` (`SOURCE_SUPPORTED` | `UNRESOLVED`), `authority_distinction` (`BINDING_LEGISLATION_WHEN_APPLICABLE` | `AUTHORITATIVE_STANDARD_OR_GUIDANCE` | `UNRESOLVED_SOURCE_BASIS`), applicability note, and exact citation badge (`[source_id (edition) @ locator]`).
  - `### Methodology Interpretations (Cognitive Model & Criteria Baseline)` — each interpretation carries `<OBJECT_ID>-MTH-NNN`, cognitive rule refs, and question IDs, explicitly separated from external publication claims.
- Under `<OBJECT_ID>.BIB`:
  - Full source bibliography table listing `Source ID`, `Title`, `Edition / Version`, `Authority` (`authority_tier / authority_type`), `Origin & Exact Locator`, `Extraction Status` (`COMPLETE` | `PARTIAL_TRUNCATED`), and `Usage Policy, Applicability & Limitations` (including jurisdictions and `roles_or_applicability_conditions`).

---

## 5. Rendition Relationships (`markdown` vs `pdf`)

- **Markdown (`rendition: "markdown"`, `document.md`)** is the primary authoritative knowledge document.
- **PDF (`rendition: "pdf"`, `document.pdf`, optional in DC-08)** is a derived human-review rendition generated from the exact same reviewed `CreatorDocument` version.
- In `completion-receipt.json`, a derived PDF shares the exact same `document_id`, `object_id`, and `version` as its `markdown` counterpart, with `rendition: "pdf"`, `media_type: "application/pdf"`, and its own `byte_count` and `sha256`.
- **De-duplication rule:** Master Table Creator and Knowledge Hub must treat `rendition: "pdf"` as an alternate rendition of the same logical `(document_id, version)` — never as a second independent knowledge object or separate piece of evidence.
