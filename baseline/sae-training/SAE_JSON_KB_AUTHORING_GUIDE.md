# Solution Assurance Engine — JSON Knowledge Base Authoring & Vercel Guide (`schema_version: "2.1.0"`)

This guide defines the **exact files, schemas, registers, tactics, ID rules, compilation commands, and Vercel Blob steps** required so your manually authored JSON Knowledge Base documents work directly with **Solution Assurance Engine** (`jorieskolin-creator/AI-Governance-Engine`).

---

## 1. Exact Authoritative Files to Use (Single Source of Truth)

Use **only** the files in the table below when authoring the 30 capability/anti-pattern pairs (`A1..F5` and `AP-A1..AP-F5`):

| Purpose | Exact File Path in This Repository | Role & Rules |
| --- | --- | --- |
| **JSON Schemas (`2.1.0` — Authoritative Engine Schemas)** | `baseline/sae-training/knowledge-base/drafts/schemas/capability.schema.json`<br>`baseline/sae-training/knowledge-base/drafts/schemas/antipattern.schema.json`<br>`baseline/sae-training/knowledge-base/drafts/schemas/shared-definitions.schema.json`<br>`baseline/sae-training/knowledge-base/drafts/schemas/tactic-catalog.schema.json`<br>`baseline/sae-training/knowledge-base/drafts/schemas/normative-source-register.schema.json` | Byte-identical copies of `AI-Governance-Engine/knowledge-authoring/schemas/*.schema.json`. Every JSON file in `knowledge-base/drafts/` must pass these Draft 2020-12 schemas (`additionalProperties: false`). *(Note: `kb:validate` automatically skips the `schemas/` subfolder when scanning `drafts/`.)* |
| **180 Primary Questions & Runtime Fields** | `baseline/sae-training/criteria/assessment-instrument-1.0.0-sae.1.json` | Copy `primary_questions` (`id`, `dimension`, exact `question` text), `runtime_applicability`, `runtime_authority`, `runtime_severity`, `runtime_signals`, `lifecycle_stages`, `human_decision_authority`, and `capability_indicators` / `antipattern_indicators` from here (`requirements[]`, `controls[]`, `antipatterns[]`). |
| **Criteria & Anti-Pattern Definitions** | `baseline/sae-training/criteria/AI_Governance_Categories_and_Anti-Patterns_v1.1.pdf` | Authoritative scope, definition, indicator, and authoring intent for all 30 pairs. |
| **Cognitive Interpretation Rules (`3.1.0`)** | `baseline/sae-training/cognitive/Solution_Assurance_Engine_Thinking_Flow.html` | Authoritative interpretation boundaries, evidence ceilings, `UNKNOWN` handling, non-inverse pair rules, and human authority boundaries. |
| **Normative Source Register (`2.1.0` Engine format)** | `baseline/sae-training/knowledge-base/drafts/registers/AI_Governance_Normative_Source_Register_v1.5.0.json` | Engine-ready `NORMATIVE_SOURCE_REGISTER` (`2.1.0`) containing all 45 approved Global Source Register v`1.5.0` entries (`SRC-*`) plus the 4 Engine Intake/internal sources. *(Consult root `AI_Governance_Global_Source_Register_v1.5.0.json` for full publisher licensing notes and domain coverage.)* |
| **Tactic Playbook (`2.1.0` Engine format)** | `baseline/sae-training/knowledge-base/drafts/registers/AI_Governance_Tactic_Playbook_v1.0.0.json` | Exact byte-identical copy (`sha256: 98ba7390...`) of `baseline/AI_Governance_Tactic_Playbook_v1.0.0.json` (119 approved tactics, 216 explicit object links). Keep inside `drafts/registers/` so `kb:validate` and `kb:compile` resolve all tactic references automatically. |
| **Working JSON Authoring Root** | `baseline/sae-training/knowledge-base/drafts/` | Place all capability JSONs in `drafts/<Domain>/capabilities/<ID>_v<semver>.json` and anti-pattern JSONs in `drafts/<Domain>/antipatterns/AP-<ID>_v<semver>.json` (`A`–`F`). Includes `A1`/`AP-A1` and `A2`/`AP-A2` (`1.0.1`). Keep one version of each object in `drafts/`. The previous A1/AP-A1 Engine JSON calibration copies are preserved under [Samples/Engine-JSON/A](Samples/Engine-JSON/A/). |
| **Vercel URL Map Template** | `baseline/sae-training/blob-urls.template.json` | Copy outside `drafts/` and fill with the 6 immutable Vercel Blob URLs before generating `runtime-manifest.json`. |

### Files NOT to Copy JSON Field Shapes From
- **Do NOT use `baseline/sae-training/schemas/*.schema.json` or root `schemas/*.schema.json`** — `baseline/sae-training/schemas/` remains hash-pinned to the current Document Creator test suite until Document Creator is updated after Engine testing, and root `schemas/` belongs to the legacy Maintainer pipeline. Always validate against **`baseline/sae-training/knowledge-base/drafts/schemas/*.schema.json`**.
- **Do NOT copy raw JSON keys or question strings directly from `Samples/A/`, `Samples/B/`, `Samples/D/`, or `Samples/Golden/`** — those calibration artifacts omit `paired_object_id` and `runtime_*` fields, use `BLOCKING` instead of `CRITICAL`, and use retired `GOV-*` tactic IDs. Always use **`knowledge-base/drafts/A/capabilities/A1_v1.0.1.json`**, **`knowledge-base/drafts/A/antipatterns/AP-A1_v1.0.1.json`**, **`knowledge-base/drafts/A/capabilities/A2_v1.0.1.json`**, and **`knowledge-base/drafts/A/antipatterns/AP-A2_v1.0.1.json`** as your structural JSON templates.

---

## 2. Mandatory Schema `2.1.0` Rules for Every Pair (`X1..X5` & `AP-X1..AP-X5`)

1. **Reciprocal Pair Identity:**
   - Every capability `[A-F][1-5]` (`object_type: "CAPABILITY"`) **must** have its paired anti-pattern `AP-[A-F][1-5]` (`object_type: "ANTIPATTERN"`) present in `drafts/`, with reciprocal `paired_object_id` (`"AP-A2"` <-> `"A2"`).
2. **Strict Owner-Prefixed Stable IDs (Globally Unique):**
   - Primary questions (exactly 3 in order `DEFINITION_AND_INTENT`, `IMPLEMENTATION_AND_OPERATION`, `EVIDENCE_AND_EFFECTIVENESS`): `<ID>-Q1`, `<ID>-Q2`, `<ID>-Q3` (e.g., `A2-Q1..Q3`, `AP-A2-Q1..Q3`).
   - Capability atomic subcriteria: `^[A-F][1-5]-SC-[0-9]{3}$` (e.g., `A2-SC-001`). Every `question_id` and `required_evidence_ids[]` entry must resolve inside the same object.
   - Anti-pattern atomic tests: `^AP-[A-F][1-5]-AT-[0-9]{3}$` (e.g., `AP-A2-AT-001`).
   - Required evidence items: `^EVD-(?:AP-)?[A-F][1-5]-[0-9]{3}$` (e.g., `EVD-A2-001`, `EVD-AP-A2-001`).
   - Finding definitions: `^FND-(?:AP-)?[A-F][1-5]-[0-9]{3}$` (e.g., `FND-A2-001`, `FND-AP-A2-001`), with `assessment_object_id` equal to the owning object ID.
3. **Allowed Enum Values (Strict Engine Contract):**
   - `runtime_applicability`: `"ALWAYS" | "EU" | "USES_DATA" | "PERSONAL_DATA" | "THIRD_PARTY_COMPONENTS" | "USES_AGENTS" | "PRODUCTION_OR_EXTERNAL" | "AFFECTS_PEOPLE" | "INTERACTS_WITH_PEOPLE"`
   - `runtime_authority` *(capability only)*: `"BINDING_LAW" | "REGULATORY_GUIDANCE" | "GOVERNMENT_GUIDANCE" | "INTERNAL_PROCESS" | "STANDARD" | "VOLUNTARY_FRAMEWORK" | "COMMUNITY_PRACTICE" | "INDUSTRY_GUIDANCE" | "CONTRACTUAL_REQUIREMENT" | "MIXED"`
   - `runtime_severity` & `finding_definitions[].severity`: `"LOW" | "MEDIUM" | "HIGH" | "CRITICAL"` *(never `"BLOCKING"` or `"INFORMATIONAL"`)*
   - `minimum_technical_assurance`: `"DECLARED" | "IMPLEMENTED" | "TESTED" | "OPERATIONALLY_OBSERVED"` *(never `"UNKNOWN"` or `"NOT_APPLICABLE"`)*
   - `required_human_assurance`: `"NOT_REQUIRED" | "HUMAN_VALIDATED" | "FORMALLY_APPROVED"` *(never `"PENDING"`)*
   - `lifecycle_stages` & `target_assurance_by_lifecycle_stage[].lifecycle_stage`: `"QUALIFICATION_AND_REGISTRATION" | "DESIGN_AND_DEVELOPMENT" | "VERIFICATION_AND_VALIDATION" | "DEPLOYMENT" | "OPERATION_AND_MONITORING" | "REVIEW_AND_EVALUATION" | "RETIREMENT"`
4. **Source Mappings (`normative_source_mappings[]`):**
   - At least 1 entry per object: `{ "source_id": "SRC-...", "relevant_locator": "...", "mapping_rationale": "...", "last_verified_on": "YYYY-MM-DD" }`.
   - Every `source_id` must exist in `drafts/registers/AI_Governance_Normative_Source_Register_v1.5.0.json`. Never reproduce protected ISO standard text; keep ISO sources as locator/rationale metadata only.
5. **Tactic References (`candidate_tactic_refs[]`):**
   - Use only `TAC-*` IDs from `AI_Governance_Tactic_Playbook_v1.0.0.json` whose `assessment_mappings.capabilities` or `assessment_mappings.antipatterns` explicitly list this object ID (or leave `candidate_tactic_refs: []`, as the Playbook's `primary_object_mappings` is the source of truth).
   - `relationship`: `"REMEDIATES_CAPABILITY_GAP"` or `"REMEDIATES_ANTIPATTERN"`; `mapping_status`: `"APPROVED"` (or `"DRAFT"` while unapproved).
6. **`DRAFT` vs. `APPROVED` Object Status:**
   - While authoring/testing in pilot mode: `"release_status": "DRAFT"`, `"approval_record": null`.
   - For final production compilation (`--release-status APPROVED`): set `"release_status": "APPROVED"` and provide `"approval_record"` with `"approved_version"` matching `"version"`:
     ```json
     "approval_record": {
       "approved_by_role": "AI_GOVERNANCE_OWNER",
       "approved_on": "2026-11-28",
       "approval_scope": "SAE_KNOWLEDGE_BASE_RELEASE_1_0",
       "approved_version": "1.0.1",
       "supersedes_version": null
     }
     ```

---

## 3. Validate, Compile, and Upload to Vercel Blob

Run these commands from a local checkout of **`AI-Governance-Engine`** (`jorieskolin-creator/AI-Governance-Engine`), pointing `--input` at this folder's `baseline/sae-training/knowledge-base/drafts`:

### Step 1 — Validate JSON Schemas & Cross-References
```bash
pnpm run kb:validate -- --input "/path/to/AI-Governance-KB-Maintainer-Tool/baseline/sae-training/knowledge-base/drafts"
```
- Confirm `"status": "PASS"` and `"errorCount": 0`.
- *(While fewer than all 60 objects exist in `drafts/`, `TACTIC_OBJECTS_NOT_LOADED` appears as a `WARNING` only.)*

### Step 2 — Compile the 6 Runtime JSON Collections
- **For Pilot / Partial Testing (before all 30 pairs are marked `APPROVED`):**
  ```bash
  pnpm run kb:compile -- \
    --input "/path/to/AI-Governance-KB-Maintainer-Tool/baseline/sae-training/knowledge-base/drafts" \
    --out "/tmp/sae-kb-runtime" \
    --version "sae-kb-0.1.0-pilot" \
    --release-status PILOT \
    --allow-unapproved-objects
  ```
- **For Full 30-Pair Approved Release (all 60 objects `APPROVED`):**
  ```bash
  pnpm run kb:compile -- \
    --input "/path/to/AI-Governance-KB-Maintainer-Tool/baseline/sae-training/knowledge-base/drafts" \
    --out "/tmp/sae-kb-runtime" \
    --version "sae-kb-1.0.0" \
    --release-status APPROVED
  ```

This writes **6 collection files** into `/tmp/sae-kb-runtime/`:
1. `normativeSources.json`
2. `requirements.json`
3. `controls.json`
4. `antipatterns.json`
5. `tactics.json`
6. `intakeQuestionnaire.json`
*(plus `compilation-report.json` containing each file's exact `sha256`)*

### Step 3 — Upload the 6 Collection JSONs to Vercel Blob & Generate `runtime-manifest.json`
1. Upload the 6 JSON files (`normativeSources.json`, `requirements.json`, `controls.json`, `antipatterns.json`, `tactics.json`, `intakeQuestionnaire.json`) unchanged to your Vercel Blob store.
2. Copy `baseline/sae-training/blob-urls.template.json` to `/tmp/blob-urls.json` (outside `drafts/`) and paste the exact immutable `https://...` Vercel Blob URL for each of the 6 uploaded files.
3. Generate `runtime-manifest.json` (`schemaVersion: "1.1.0"`):
   ```bash
   pnpm run kb:manifest -- \
     --input "/tmp/sae-kb-runtime" \
     --urls "/tmp/blob-urls.json" \
     --version "sae-kb-0.1.0-pilot" \
     --release-status PILOT
   ```
   *(Use `--version "sae-kb-1.0.0" --release-status APPROVED` for a full approved release.)*
4. Upload `/tmp/sae-kb-runtime/runtime-manifest.json` to Vercel Blob and copy its exact `https://...` URL.

### Step 4 — Connect & Verify in `Solution Assurance Engine`
1. In your `Solution Assurance Engine` environment (local `.env` or Railway service variables):
   - Set `VERCEL_KB_MANIFEST_URL=<exact https URL of runtime-manifest.json>`
   - If your Vercel Blob store is private, also set `BLOB_READ_WRITE_TOKEN=<read token>`; for public immutable Blob URLs, no token is needed.
2. Restart/redeploy `Solution Assurance Engine` (startup is fail-closed: if the URL, JSON, or any SHA-256 hash is wrong, startup fails immediately rather than falling back silently).
3. Verify the active Knowledge Base via HTTP:
   - `GET /health` -> HTTP `200`
   - `GET /api/knowledge` -> confirm `"source": "VERCEL_BLOB"`, `"version"` matches your manifest version, `"manifestHash"` is populated, and `"counts"` matches your uploaded collections (`normativeSources: 49`, `tactics: 119`, plus your compiled `controls`/`antipatterns`/`requirements`).
   - `GET /api/knowledge/diagnostics` -> confirm `"errorCount": 0` and every `documentChecks[]` item reports `"status": "HASH_VERIFIED"`.
