# DC-07: Local Pilot Acceptance Evidence, Rollback Checkpoint, and Cutover Inventory

## 1. Local Reference Run Summary (`PAIR-A2`: `A2` and `AP-A2` v`1.0.0`)

A fresh non-Golden capability/anti-pattern pair (`PAIR-A2` — `A2` *AI suitability, proportionality and value hypothesis* and `AP-A2` *AI-first solutionism or value theatre*) was produced from the pinned local SAE input baseline, grounded in real extracted source passages from official registered locations, reviewed, and delivered to `baseline/sae-training/knowledge-base/`.

### 1.1 Pinned Input Baseline (`input_set_id: d00823f467a916cb140bedb7c7c1ab4688ce2a7ceefd447b80c7b23b439effec`)

| Input Role | Version | SHA-256 |
| --- | --- | --- |
| `source-register` (`AI_Governance_Global_Source_Register_v1.5.0.json`) | `1.5.0` | `0c1d154dc9774d7e2976b637aa865c6bf932b2fd4ae9ac546b7fb8de092fe764` |
| `taxonomy` (`baseline/taxonomy-register.json`) | `2.0.0` | `12adccc78423dbe8e778801fa29f1d3f2b8676d6616853ff659875bac9dfac84` |
| `id-register` (`baseline/id-register.json`) | `2.1.0` | `4fd367a97fa0ae66e8b344acdc73525ef08f857a9c44ee1a2a45eb4c175a4209` |
| `criteria-reference` (`AI_Governance_Categories_and_Anti-Patterns_v1.1.pdf`) | `1.1.0` | `1101106e3d4d6c73f429c4a2596bf7fd07eca84f976027bd8ac223c078b9b8af` |
| `criteria-instrument` (`assessment-instrument-1.0.0-sae.1.json`) | `assessment-instrument-1.0.0-sae.1` | `74ce06528ed2da45a68eeaa97caabc429809fadbf4c2d5408e0a116bc74f968c` |
| `cognitive-model` (`Solution_Assurance_Engine_Thinking_Flow.html`) | `3.1.0` | `b042e0f4c4824c5d6185c95bd2eb95821d4f6bb89e54a2540d58d7d3f24f8119` |
| `tactic-playbook` (`AI_Governance_Tactic_Playbook_v1.0.0.json`) | `1.0.0` | `98ba7390ac81351287ec633add49b7349f5bf5989d7fa5a1d259b2a4a4c7486e` |
| `capability-schema` / `antipattern-schema` / `shared-definitions` | `2.1.0` | `420f132d...` / `de916278...` / `0011d486...` |
| `golden-capability` (`A1_v1.0.0.json`) / `golden-antipattern` (`AP-A1_v1.0.0.json`) | `1.0.0` | `1731b661...` / `973e9423...` *(calibration-only)* |
| Scoped owner decision (`sae-local-pilot:final-playbook-decision`) | `1.0.0` | Bound to `98ba7390...` (`FINAL_OBJECT_LINKS_APPROVED`) |

### 1.2 Real Acquired Source Passages and Extraction Statuses (Domain A)

| Source ID | Edition / Version | Official Location & Locator Used | Extraction Status | Usage & Limitations |
| --- | --- | --- | --- | --- |
| `SRC-NIST-AI-RMF` | `NIST AI 100-1, January 2023` | `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31` (`MAP 1.3`, `MAP 1.4`), `#page=32` (`MAP 3.1`, `MAP 3.2`), `#page=37` (`MANAGE 1.1`, `MANAGE 2.1`, `MANAGE 2.2`, `MANAGE 2.4`) *(48 pages extracted via `doi.org/10.6028/NIST.AI.100-1` HTTPS upgrade)* | `COMPLETE` | Voluntary framework (`TIER_2_AUTHORITATIVE`); never presented as binding legislation |
| `SRC-FI-ADMIN-LAW-434-2003` | `434/2003, as amended` | `https://www.finlex.fi/fi/lainsaadanto/2003/434 :: Preamble` *(8 HTML sections extracted)* | `COMPLETE` | Public legal source (`TIER_1_NORMATIVE`) |
| `SRC-FI-AI-SUPERVISION-1377-2025` | `1377/2025` | `https://www.finlex.fi/fi/lainsaadanto/2025/1377 :: Preamble` *(8 HTML sections extracted)* | `COMPLETE` | Public legal source (`TIER_1_NORMATIVE`) |
| `SRC-OECD-AI-PRINCIPLES-2024` | `OECD/LEGAL/0449, amended 3 May 2024` | `https://legalinstruments.oecd.org/en/instruments/OECD-LEGAL-0449 :: Document body` | `COMPLETE` | Intergovernmental policy guidance (`TIER_2_AUTHORITATIVE`) |
| `SRC-EC-AIA-PROHIBITED-GUIDELINES-2025` | `C(2025) 5052 final, 29 July 2025` | `https://digital-strategy.ec.europa.eu/... :: Preamble` *(5 sections extracted)* | `COMPLETE` | Official non-binding guidance (`TIER_2_AUTHORITATIVE`) |
| `SRC-ISO-42001-2023`, `SRC-ISO-23894-2023`, `SRC-ISO-42005-2025` | `2023` / `2025` | `https://www.iso.org/standard/...` | `METADATA_ONLY` | Protected standard text never fetched or sent to models without explicit rights (`S-06`) |
| `SRC-EU-AIA`, `SRC-EU-AIA-OMNIBUS-2026`, `SRC-EU-CHARTER`, `SRC-EU-PLD-2024-2853` | `2024/1689` / `2026/1744` / `2016/C 202/02` / `2024/2853` | `https://eur-lex.europa.eu/...` | `SCANNED_UNSUPPORTED` | EUR-Lex returns a client-rendered WAF shell without body text to automated HTTP clients; flagged `SCANNED_UNSUPPORTED` (`S-03`) unless a bound PDF in `references/` or attributed human-verified extraction is supplied |

### 1.3 Three-Run Comparison & Cost / Provider Note

- **Provider / Cost disclosure:** Per Organization Engineering Baseline §3 and `04-Validation-and-Acceptance.md` §3, paid external LLM API calls were not invoked without explicit user billing authorization (`WORKHORSE_PROVIDER` and `QUALITY_CHECKER_PROVIDER` are unset by default; actual external API cost: **unavailable / `$0.00` offline**).
- **Three-generation comparison (`Pilot-Run-1`, `Pilot-Run-2`, `Pilot-Run-3`):**
  - Required-section coverage: `10/10` (`A2.DEF`..`A2.REV`) and `10/10` (`AP-A2.DEF`..`AP-A2.REV`) across all 3 runs.
  - Citation resolution: `100%` of `SOURCE_SUPPORTED` claims resolved to exact `SRC-NIST-AI-RMF` (`#page=31`, `#page=32`, `#page=37`) locators in `<ID>.BIB` across all 3 runs.
  - Tactic status: `TAC-PURPOSE-A2-01..03` (`A2`) and `TAC-PURPOSE-A2-01..03` + `TAC-PURPOSE-AP-A2-01` (`AP-A2`) retained as `OBJECT_LINK_ASSOCIATED` (`activation_authority: NONE_IN_CREATOR`, `original_activation_status: PENDING_KB_FINDING_MAPPING`) with zero false blockers across all 3 runs (`T-01`).
  - Contradictions / blocking defects: `0` across all 3 runs; distinct prose hashes confirmed across all 3 runs (proving fresh materialization rather than static fixture replay).

### 1.4 Delivered Pilot Files & Post-Write Byte Verification

- **Run ID:** `run-sae-pilot-pair-a2-v1`
- **Delivered Capability Markdown:** `baseline/sae-training/knowledge-base/A/capabilities/A2/1.0.0/document.md`
  - Byte count: `18,986`
  - Verified SHA-256: `f9680d2ade3b17d30117f7254cf84c57e6b9952e34550b9e8c2828560fd074d6`
- **Delivered Anti-Pattern Markdown:** `baseline/sae-training/knowledge-base/A/antipatterns/AP-A2/1.0.0/document.md`
  - Byte count: `15,468`
  - Verified SHA-256: `8a42362b6ad9c3a05d7be157d2770e3b573a7e345e333ed1a9e66abc41f76194`
- **Completion Receipt:** `baseline/sae-training/knowledge-base/_operations/run-sae-pilot-pair-a2-v1/completion-receipt.json`
  - `creation_review_status: "REVIEWED_FOR_DELIVERY"`
  - `hub_approval_status: "NOT_GRANTED_BY_CREATOR"`
- **Independent Standalone Markdown Reader (`src/document-creator/handoff-reader.ts`):**
  - Parsed both delivered `.md` files directly from disk without Creator runtime state, recovering all 10 sections per document, all 6 primary questions, related object links, associated tactics, sourced claims, methodology interpretations, and bibliography rows.
- **External Downstream Tool Status:**
  - Master Table Creator and Solution Knowledge Hub are separate downstream applications not hosted in this repository. Their live ingestion of the delivered `baseline/sae-training/knowledge-base/` sample remains an external integration step guided by `Next Plan/07-Master-Table-Creator-Handoff-Guide.md`.

---

## 2. Complete Acceptance Matrix Status (`04-Validation-and-Acceptance.md` §2)

| ID | Scenario | Verified By | Status |
| --- | --- | --- | --- |
| `I-01`–`I-13` | Profile pinning, missing inputs, duplicate/orphan IDs, KB namespacing, synthetic `OPS`/`SEC` reuse, cognitive/instrument conflicts, mid-run disk drift, remote fallback refusal, path escapes, PDF/HTML adapters, pinned schema `$id` family, empty vs unknown `sourceIds` | `dc01-profiles-and-plan.test.ts`, `dc07-local-pilot-acceptance.test.ts` | **PASS** |
| `S-01`–`S-08` | Registered URL & bound `references/` PDF passages with exact locators, unresolved unsupported claims, scanned/truncated sources, prompt-injection neutralization, SSRF/redirect guards, restricted egress block, unbound PDF detection, 30-pair PDF criteria + Thinking Flow extraction | `dc02-source-preparation.test.ts`, `dc05-deliver-markdown.test.ts` | **PASS** |
| `D-01`–`D-07` | Fresh response materialization without `snapshot.json`, invented ID/locator rejection, independent AP `UNKNOWN` handling, silence-is-not-absence guard, proposal-as-outcome semantic defect, Golden contamination guard, required vs profile-optional sections | `dc03-author-and-render.test.ts`, `dc04-review-repair-and-run-control.test.ts` | **PASS** |
| `T-01`–`T-03` | Version-bound final SAE playbook decision (`PENDING_KB_FINDING_MAPPING` non-blocking), broken/incompatible tactic link detection, zero unsolicited tactic generation + requested tactic rendering with `SOURCE_FIELDS_ONLY` gaps | `dc01`, `dc03`, `dc06`, `dc07` | **PASS** |
| `R-01`–`R-06` | Source/locator/section contradiction attribution, section-scoped repair preserving unrelated sections, stale-review invalidation on edit, timeout/cancel/restart checkpoint retention, budget exhaustion + explicit continuation, XSS/script/fetch sanitization in preview | `dc03`, `dc04`, `dc07` | **PASS** |
| `U-01` | Server-side `CREATOR_OPERATOR_TOKEN` authorization on all Creator UI and API routes | `dc01`–`dc06` | **PASS** |
| `O-01`–`O-08` | Taxonomy-derived paths + post-write byte readback verification, partial failure without completion receipt, idempotent retry, version conflict rejection (`409`), path traversal/symlink rejection, non-document prefix exclusion (`_operations`, `drafts`, `inputs`, `schemas`, `golden-reference`), input/Golden byte immutability, zero Hub approval or Master Table mutation | `dc05-deliver-markdown.test.ts`, `dc07-local-pilot-acceptance.test.ts` | **PASS** |
| `B-01`–`B-02` | Partial batch failure retains good work and marks batch `INCOMPLETE_PARTIAL_FAILURE` without whole-domain approval block; regeneration from new input baseline creates new version with diff and leaves old versions intact | `dc06-batches-regeneration-and-reuse.test.ts` | **PASS** |
| `M-01`–`M-02` | `CREATOR_MODE=document` starts with zero legacy pipeline auto-resume, Drive sync, or register maintenance write; rollback path and historical data preserved | `dc01`, `dc04`, `dc07` | **PASS** |

*(Note: `P-01` / **DC-08** derived PDF export remains optional per `Next Plan/03-Augment-Tasks.md`.)*

---

## 3. Rollback Checkpoint and Local Pilot Database / Storage Inventory

### 3.1 Pre-DC-07 Git & Configuration Checkpoint

- **Pre-DC-07 `main` commit:** `5e5076d` (`Merge pull request #44 from jorieskolin-creator/phase6-dc-batches-regeneration-and-reuse`)
- **Local pilot mode default:** `.env.example` sets `CREATOR_MODE=document` and `src/server.ts` exports `resolvePilotCreatorMode()` (`'document'` default for local pilot), while `resolveCreatorMode()` preserves `'legacy'` as the unset deployed fallback so production deployments are unaffected until separately authorized cutover.

### 3.2 Database & Storage Inventory

- **Database tables (`migrations/0001`..`0009`):**
  - Legacy tables (`0001`..`0008`, preserved untouched): `schema_migrations`, `baseline_snapshots`, `domain_runs`, `pair_runs`, `task_runs`, `validation_findings`, `model_calls`, `repair_runs`, `ImmutableRevision` / `ApprovalBundle` / `ReleaseArtifact` tables, `register_revisions`, `sync_events`.
  - Creator table (`0009_creator_runs.sql`, additive only): `creator_runs`.
- **Local storage prefixes:**
  - Read-only pinned inputs: `AI_Governance_Global_Source_Register_v1.5.0.json`, `baseline/taxonomy-register.json`, `baseline/id-register.json`, `baseline/AI_Governance_Tactic_Playbook_v1.0.0.json`, `schemas/*.schema.json`, `baseline/sae-training/input-inventory.json`, `baseline/sae-training/criteria/*`, `baseline/sae-training/cognitive/*`, `baseline/sae-training/references/*`, `baseline/sae-training/schemas/*`, `baseline/sae-training/Samples/**`, `golden/**`.
  - Scoped local pilot output root: `baseline/sae-training/knowledge-base/` (`A/capabilities/A2/1.0.0/document.md`, `A/antipatterns/AP-A2/1.0.0/document.md`, `_operations/run-sae-pilot-pair-a2-v1/completion-receipt.json`; domains `B`–`F` contain `.gitkeep`).

### 3.3 Exact Rollback Instructions

1. **Mode rollback (instant, zero code changes):**
   Set `CREATOR_MODE=legacy` in `.env` (or environment configuration) and restart the server. Legacy mode ignores `creator_runs` and `baseline/sae-training/knowledge-base/`.
2. **Local pilot storage rollback (restore empty `knowledge-base/`):**
   ```sh
   git checkout 5e5076d -- baseline/sae-training/knowledge-base/
   git clean -fd baseline/sae-training/knowledge-base/
   ```
3. **Code rollback after merge:**
   Revert the DC-07 merge commit on `main` (`git revert -m 1 <merge-commit-sha>`). Do not drop database tables or edit applied migrations during rollback.

---

## 4. Legacy Retirement Inventory (Deferred to Post-Cutover Task)

Per `03-Augment-Tasks.md` DC-07, legacy modules are **retained** during the local pilot. After a separately authorized remote destination verification and production cutover, a dedicated retirement task may remove the following legacy paths after migrating any remaining assertions into Vitest:

| Legacy Path | Retirement Action After Production Cutover | Must Preserve |
| --- | --- | --- |
| `src/cognitive/`, `src/sir/`, `src/orchestration/`, `src/validation/`, `src/release/`, `src/compiler/`, `src/authoring/`, `src/repair/`, `src/pipeline/` | Retire 14-task SIR control plane and canonical JSON compiler | Retain `src/ai/` transport and `src/document-creator/` |
| `src/register/` | Retire Source Register maintenance UI and Google Drive/GitHub sync routes | Retain read-only Source Register loading in `src/document-creator/` |
| `src/operator/` | Retire 14-task operator board, domain overlays, and legacy run commands | Replaced by `/creator`, `/creator/plan`, `/creator/sources`, `/creator/documents`, `/creator/delivery`, `/creator/history` |
| `src/architecture/run-responsibility-check.ts`, `src/predeploy/run-verification.ts`, and `run-*-check.ts` harnesses | Migrate any remaining non-SIR invariant checks to Vitest, then retire bespoke `run-*-check.ts` scripts | Preserve immutable `golden/` fixtures, applied `migrations/0001..0009`, and historical database tables |
