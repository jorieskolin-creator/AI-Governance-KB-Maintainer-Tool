# SAE training & JSON Knowledge Base baseline

> **Direct JSON Authoring for Solution Assurance Engine (`Option A` — Active):**
> Follow **[`SAE_JSON_KB_AUTHORING_GUIDE.md`](SAE_JSON_KB_AUTHORING_GUIDE.md)** for the authoritative `Solution Assurance Engine` `2.1.0` JSON schemas (`knowledge-base/drafts/schemas/*.schema.json`), Engine-ready registers (`knowledge-base/drafts/registers/`), JSON pair workspace (`knowledge-base/drafts/A`..`F`), ID/enum rules, compilation into the 6 runtime collections + `runtime-manifest.json` (`1.1.0`), and manual Vercel Blob verification with `Solution Assurance Engine`.

This inventory pins the materials for the Solution Assurance Engine (SAE) baseline. It covers source selection, all 180 primary questions, the cognitive model, tactic selection, the self-contained Engine `2.1.0` JSON authoring workspace (`knowledge-base/drafts/`), and the hash-pinned Document Creator pilot baseline ([input-inventory.json](input-inventory.json)).

## Authoritative JSON Knowledge Base Workspace (`knowledge-base/drafts/`)

[`knowledge-base/drafts/`](knowledge-base/drafts/) is configured as a self-contained `Solution Assurance Engine` `2.1.0` JSON authoring workspace ready for `pnpm run kb:validate` and `pnpm run kb:compile`:

- [`knowledge-base/drafts/schemas/`](knowledge-base/drafts/schemas/) — Byte-identical copies of all five `Solution Assurance Engine` `2.1.0` JSON Schemas (`shared-definitions.schema.json`, `capability.schema.json`, `antipattern.schema.json`, `tactic-catalog.schema.json`, and `normative-source-register.schema.json`).
- [`knowledge-base/drafts/registers/AI_Governance_Normative_Source_Register_v1.5.0.json`](knowledge-base/drafts/registers/AI_Governance_Normative_Source_Register_v1.5.0.json) — Engine `2.1.0` Normative Source Register (`APPROVED`, all 45 Global Source Register v`1.5.0` entries + 4 Engine Intake/internal sources = 49 sources).
- [`knowledge-base/drafts/registers/AI_Governance_Tactic_Playbook_v1.0.0.json`](knowledge-base/drafts/registers/AI_Governance_Tactic_Playbook_v1.0.0.json) — Byte-identical copy of the approved 119-tactic Playbook (`tactic-catalog:2.1.0`).
- [`knowledge-base/drafts/A/capabilities/A1_v1.0.0.json`](knowledge-base/drafts/A/capabilities/A1_v1.0.0.json) & [`knowledge-base/drafts/A/antipatterns/AP-A1_v1.0.0.json`](knowledge-base/drafts/A/antipatterns/AP-A1_v1.0.0.json) — Complete Golden pair (`APPROVED`) in strict Engine `2.1.0` JSON.
- [`knowledge-base/drafts/A/capabilities/A2_v1.0.1.json`](knowledge-base/drafts/A/capabilities/A2_v1.0.1.json) & [`knowledge-base/drafts/A/antipatterns/AP-A2_v1.0.1.json`](knowledge-base/drafts/A/antipatterns/AP-A2_v1.0.1.json) — Complete `A2` / `AP-A2` v`1.0.1` pair (`DRAFT`) in strict Engine `2.1.0` JSON.
- `knowledge-base/drafts/B`..`F/{capabilities,antipatterns}/` — Domain folders ready for authoring the remaining pairs (`A3..A5`, `B1..F5`).
- [`blob-urls.template.json`](blob-urls.template.json) — URL map template (kept outside `drafts/`) for generating `runtime-manifest.json` (`1.1.0`) after uploading the 6 compiled JSON collections to Vercel Blob.

See **[`SAE_JSON_KB_AUTHORING_GUIDE.md`](SAE_JSON_KB_AUTHORING_GUIDE.md)** for the complete authoring rules, validation/compilation commands, and Vercel verification steps.

## Shared Upstream Reference Inputs

| Role | File and verification |
| --- | --- |
| Source Register | [Global Source Register v1.5.0 JSON](../../AI_Governance_Global_Source_Register_v1.5.0.json) registers 45 sources across six domains (`A`–`F`), matched by the [reference PDF](references/AI_Governance_Global_Source_Register_v1.5.0.pdf). Use `knowledge-base/drafts/registers/AI_Governance_Normative_Source_Register_v1.5.0.json` as the Engine `2.1.0` compilation input. |
| Taxonomy and criteria | [Taxonomy v2.0.0](../taxonomy-register.json) and [ID Register](../id-register.json) match upstream definitions. The [Categories and Anti-Patterns v1.1 PDF](criteria/AI_Governance_Categories_and_Anti-Patterns_v1.1.pdf) describes all 30 pairs, capability questions, anti-pattern indicators, and authoring rules. The [local assessment instrument](criteria/assessment-instrument-1.0.0-sae.1.json) contains all 180 primary questions plus deterministic `applicability`, `authority`, `severity`, `signals`, and `indicators` for all 30 capabilities and 30 anti-patterns. |
| Cognitive model | The [Thinking Flow](cognitive/Solution_Assurance_Engine_Thinking_Flow.html) defines cognitive contract `3.1.0` and `ReadinessPackageV2` `2.6.0` from `jorieskolin-creator/AI-Governance-Engine` (`docs/thinking-flow.html`). |
| Tactic Playbook | The [approved v1.0.0 catalog](../AI_Governance_Tactic_Playbook_v1.0.0.json) contains 119 tactics and 216 explicit object links across all 60 taxonomy objects (`tactic-catalog:2.1.0`). |
| Document Creator Pinned Baseline *(Legacy until Creator refinement)* | `schemas/` and `Samples/` (`Golden/`, `A/`, `B/`, `D/`) remain hash-pinned to [input-inventory.json](input-inventory.json) for the Document Creator test suite (`dc01`–`dc08`), alongside `knowledge-base/A/capabilities/A2/1.0.0/document.md`, `knowledge-base/A/antipatterns/AP-A2/1.0.0/document.md`, and `knowledge-base/_operations/run-sae-pilot-pair-a2-v1/completion-receipt.json`. When authoring JSON directly for `Solution Assurance Engine`, use `knowledge-base/drafts/schemas/` and the templates in `knowledge-base/drafts/A/` rather than `schemas/` or `Samples/`. |
