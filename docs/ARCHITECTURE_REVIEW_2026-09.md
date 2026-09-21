# Architecture Review: AI-Governance-KB-Maintainer-Tool

**Review date:** 2026-09-21
**Reviewer role:** Solution Architect assessment (codebase: `main`, as uploaded)
**Scope:** Full codebase — 212 files, ~41,000 LOC TypeScript (`src/`, 130 files), 19 subsystems, 7 DB migrations (17 tables), 3 JSON schemas, Source Register v1.5.0, baselines, golden fixtures.
**Build status:** `npm install` + `tsc --noEmit` passes cleanly. The code compiles; the problem is not code hygiene.

---

## 1. Your intended process vs. what the code implements

Your description (condensed): **(1)** author content per capability/anti-pattern pair per domain A–F, sourced only from the Source Register, per standardized schema and Golden Standard → **(2)** compile a machine-readable document per standardized schema → **(3)** deterministic quality check → **(4)** fix only the defective area if defects → **(5)** store machine-readable docs to Vercel, the rest to Google Drive → repeat. Plus a UI where documents can be read/validated/fixed/updated, with **focused re-verification of only the changed area** after each UI change.

### Conformance map

| Your requirement | Status | Evidence in codebase |
| --- | --- | --- |
| 1. Content per pair, per domain, from Source Register | ⚠️ Partially | 14-task SIR cognitive sequence per pair exists and is elaborate. Source Register is loaded as a frozen baseline, but real source acquisition (`SOURCE_CONTEXT`) is incomplete — README itself expects `SOURCE_GAPS_PRESENT` and "zero-locator packets" in first runs. |
| 1b. Domains **A–F** (5 pairs each) | ✅ Consistent | **Confirmed by owner 2026-09-21: scope is A–F.** Code, `baseline/categories-baseline.json`, schemas, and the Drive structure (domain folders A–F) all agree. |
| 1c. Standardized schema + Golden Standard | ✅ Yes | `schemas/` (capability/antipattern/shared-definitions), `golden/fixtures/` A1/AP-A1 with regression harness. This is the strongest part of the repo. |
| 2. Machine-readable document from content | ✅ Yes | `src/compiler/` (typed SIR compiler → canonical candidate + compile report). Well-conceived. |
| 3. Deterministic quality check | ✅✅ Over-delivered | 10 validation layers (`docs/ARCHITECTURE.md`), deterministic gates everywhere. |
| 4. Fix only defective area | ✅ Designed | `src/repair/` — Impact Resolver → path-scoped patches → revalidate affected dependencies. Conceptually exactly what you asked for. |
| 5a. Machine-readable docs → Vercel | ✅ Yes | `src/storage/vercel-blob.ts`, idempotent put-if-absent-or-verify-hash publisher. |
| 5b. Other documents → **Google Drive** | ❌ Missing | **Zero Google Drive code or config anywhere** (no mention in `src/`, `.env.example`, docs). A stated core requirement is simply absent. |
| UI: read/validate/fix/update documents | ⚠️ Partially | Server-rendered HTML operator UI (`src/operator/`, 8.7k LOC) with board, candidate documents, pair/domain review, approval review. |
| UI: **focused** re-verification of only the change | ⚠️ Partially | "Focused check" exists for maintainer fixes, but every edit also creates a new immutable revision that invalidates downstream gates and rebuilds coherence packets — the ceremony is much heavier than "only the change is verified." |
| Repeat / production-proven | ❌ Not yet | README: *"Treat it as almost ready: run it… Remaining work is test-runs."* The pipeline has never completed a live end-to-end domain run. |

**Net:** the conceptual match to your description is real — this is not the wrong architecture. The problem is the *cost structure* of the implementation, plus one outright gap (Google Drive delivery).

---

## 2. Root causes of the fragility you feel

### Root cause 1 — Contract fan-out: every logical contract is expressed 4–6 times

Each of the **14 SIR cognitive tasks** per pair requires, in lockstep:

1. Output TS types + contract builder (`src/cognitive/sir-*-contract.ts`)
2. A materializer assigning SIR handles (`src/sir/*-materializer.ts`)
3. A completion validator (`src/validation/sir-*-completion.ts`)
4. An orchestration resolver + artifact verifier (`src/orchestration/*-resolver/verifier.ts`)
5. A bespoke `run-*-check.ts` harness script
6. DB persistence rows, state transitions, and UI surface handling

There is **no single source of truth per task** — the same logical contract is re-expressed as TypeScript types in four different directories with subtly different strictness. Changing one field in one task's output touches 6–8 files across 4 subsystems. Measured coupling: `CognitiveTaskType` is imported by **51 files**, `ValidationFinding` by 29, `pairId` appears in **117 files**; **659 exported types/functions** across 130 source files. This is exactly the "contracts between steps are too difficult to follow" symptom you described — the contracts exist, but they are *distributed and duplicated* rather than *declared once*.

### Root cause 2 — 26% of the codebase is bespoke verification scripts

There are **51 hand-written `run-*-check.ts` files totaling ~10,900 LOC** — more code than `compiler + repair + release` combined. Each check is a custom script with its own fixture assembly and assertion style, not a test framework. Worse, `package.json` only wires a handful of them into `verify:build`; most must be run individually by remembering they exist. Consequences:

- Every contract change requires updating its check twin → double maintenance.
- Coverage is unknowable; the "deterministic quality check" infrastructure itself is fragile.
- These scripts verify *contracts between your own modules* — a symptom that the module boundaries are so numerous that they need bespoke proof of fitting together.

### Root cause 3 — Release-grade strictness applied at authoring time (the "too strict rules" you feel)

The design applies the same guarantees everywhere: immutable revisions, hash-bound gates, optimistic concurrency, fail-closed validation, approval-bundle parity. These are excellent rules — **for the publication boundary**. But they also govern early drafts and routine UI fixes:

- Any human edit → new candidate revision → downstream gate invalidation → coherence packet rebuild → schema/compile/coherence re-runs.
- Drafts with known gaps must still satisfy the full revision/hash machinery.
- BLOCKING/WAIVED/ACCEPTED_RISK dispositions with authority + rationale for every finding.

A sensible rule ("high accuracy demand") was implemented as *uniform maximum ceremony across the entire lifecycle*, instead of *graduated strictness*: light during drafting, absolute at the release boundary. That is why routine operations feel heavy and brittle.

### Root cause 4 — Four overlapping state concepts that must be manually kept consistent

- `PairState` / `DomainState` machines (`DRAFT → AUTHORING → VALIDATING → …`)
- Immutable `candidate_revisions` + `artifact_revisions` with hash lineage
- `gate_results` (9 named gate outcomes)
- `finding_dispositions` (`RESOLVED`/`WAIVED`/`ACCEPTED_RISK`/`REJECTED`)

The corrective plan (item 2: *"Derive lifecycle state from current gate results instead of overloading passed/VALIDATED"*) shows these drifted apart once already. When four state models overlap, every transition is a distributed transaction across concepts — the classic source of "it works until one edge case desynchronizes them."

### Root cause 5 — Complexity budget spent on the wrong things first

The repo contains: a 17-table Postgres control plane, a 4-provider model router with role/fallback matrix (OpenAI/Grok/Kimi/Meta), idempotent hash-verified publication with resumable jobs, approval bundles with byte-exact parity… while **Google Drive delivery (a stated requirement) is absent** and **no live end-to-end run has ever completed**. This is Big Design Up Front: the hardest infrastructure was built and hardened before the simplest vertical slice was proven with real model calls. Everything downstream of "run one pair with real providers" is unvalidated hypothesis.

### Root cause 6 — The identity layer is brittle by construction

The A–F / pair-ID format is embedded in JSON Schemas, regexes, DB data, and golden fixtures alike. (Scope itself is confirmed A–F — no mismatch there.) But because identity formats are duplicated across so many layers (root cause 1), *any* future identity-level change — a new domain, a 6th pair slot, a version bump — becomes a multi-file coordinated migration instead of a config change. The brittleness is structural, not a scope bug.

---

## 3. What is genuinely good (keep regardless of path)

1. **The normative assets**: `schemas/`, `AI_Governance_Global_Source_Register_v1.5.0.json`, `baseline/` (categories + production contract), `golden/fixtures/` — these encode your domain expertise and are independent of the machinery. Treat them as the product.
2. **The conceptual pipeline**: source support → SIR → typed compilation → revision-bound review/repair → rendering → hash-bound approval → publication is a sound architecture for high-accuracy AI-authored content.
3. **The repair model** (detect → localize → impact-resolve → patch paths only → revalidate affected) is exactly right and worth preserving.
4. **"Models author semantics; code owns IDs/hashes/state/publication"** — the single best invariant in the repo.
5. It compiles cleanly and the docs honestly state what is unproven.

---

## 4. Proposal

**Recommendation: do not start from zero. Salvage the assets, rebuild the engine around them — a "simplify-in-place rewrite" of the orchestration core, not the domain assets.** A pure restart would throw away the schemas, register, golden fixtures, and compiler design — the parts that are actually correct. But incremental patching of the current 19-subsystem structure would take longer than a targeted rebuild, because the fragility is *structural* (contract fan-out), not *local* (bugs).

### Phase 0 — Re-baseline scope (0.5 day, decision only)

- ~~Confirm domains A–H vs A–F~~ — **resolved: A–F, 5 pairs per domain.** Code, baseline, schemas, and Drive structure all agree; no action needed.
- Confirm Google Drive is still the destination for human-readable documents (currently unimplemented). The target folder structure already exists on Drive (`Knowledge Base/` with `01 Instructions` … `09 Change History`, domain folders A–F, `Releases/`, `knowledge-base-manifest.json`), so the sink module can map directly onto it.

### Phase 1 — Collapse the cognitive task graph (the big win)

- Reduce **14 SIR tasks → 3–4**: e.g. `PAIR_FRAME` (boundary + failure model + applicability + primary questions), `EVIDENCE_AND_SAFETY` (atomic decomposition + evidence architecture + safety + absence contract), `MAPPINGS` (source mapping + findings + control boundary + lifecycle + references), plus the existing critic-only `PAIR_COHERENCE_REVIEW`. Your own docs already flag consolidation as desirable ("KEEP_SEPARATE_UNTIL_MEASURED") — the measurement phase is now, and 41k LOC for zero completed live runs is the measurement.
- Make **one module per consolidated task the single source of truth**: it exports the JSON Schema, the TS types (derived via zod), the validator, and the prompt builder. Kill the four-directory re-expression.

### Phase 2 — Graduate the strictness

- Two tiers: **DRAFT tier** — schema validation + reference-graph validation only; edits are cheap; no hash ceremony. **RELEASE tier** — full immutable revisions, hash-bound gates, approval bundle, parity checks, applied at the promotion boundary (`READY_FOR_APPROVAL`). This directly fixes the "rules too strict" feeling without weakening the accuracy guarantee, which lives at release time anyway.

### Phase 3 — Standardize verification

- Delete the 51 `run-*-check.ts` scripts; move their assertions into **vitest** with shared fixture loaders. Keep `verify:build` as: typecheck + tests + golden regression. Expected effect: ~10k LOC removed, coverage visible, every contract change has exactly one test to update.

### Phase 4 — Simplify the control plane

- Merge the four state concepts into **two**: candidate revision (with content hash) and gate ledger (append-only results per revision). Derive pair/domain status from the ledger — one direction of truth.
- Evaluate Postgres → SQLite for a single-operator tool (optional; Postgres is fine if already deployed, but the 17-table schema should shrink to ~8).

### Phase 5 — Prove one vertical slice, then add what's missing

- One pair (A1/AP-A1), real provider calls, through: source context → author → compile → QC → inject defect → focused fix in UI → approve → publish JSON to Vercel + HTML/PDF to **Google Drive** (new, small sink module — one OAuth client, one folder convention).
- Only then scale: 5 pairs → one domain → all domains.

### Effort estimate

| Path | Effort | Risk |
| --- | --- | --- |
| Patch current structure incrementally | High (every change crosses 4 subsystems; 26% test-script overhead persists) | Fragility persists; morale cost |
| Full rewrite from zero | Medium-high | Loses correct assets; repeats BDUF mistake |
| **Simplify-in-place (recommended)** | **~3–5 focused weeks** | Preserves assets + sound concepts; removes ~50–60% of LOC |

### What survives either way

`schemas/`, Source Register, `baseline/`, `golden/fixtures/`, the compiler's canonical-ID/handle model, the repair/impact-resolver concept, the Vercel publisher, and the core invariant ("models author semantics, code owns identity and publication"). The rewrite target is almost exclusively `src/cognitive`, `src/sir`, `src/orchestration`, `src/validation`, `src/operator` — i.e., the machinery, not the knowledge.

---

## 5. Decisions confirmed after this review (2026-09-21)

These were decided in the follow-up discussion and are now fixed inputs to the plan:

1. **Scope: A–F, 5 pairs per domain, 30 pairs.** Code, baselines, schemas, and Drive structure agree.
2. **Storage operating model:**
   - **Git repo = operational master.** Governed assets (Source Register, schemas, taxonomy, ID register, golden fixtures) are changed and versioned in Git; the tool reads them from the repo at runtime.
   - **Google Drive = approved mirror + human layer.** Approved asset versions sync to `02 Authorities/`; human-readable pair content publishes to `04 Knowledge Base/A–F/`; reports/manifests go to `05 Operations/`.
   - **Vercel Blob = machine-consumable published content** (canonical JSON, immutable, content-addressed).
   - Operating rules: one-way flow Git → Drive; the tool is the only writer on Drive; append-only versions; hash-bound sync with drift detection; release = dual-write with one manifest; the tool never reads Drive at runtime.
3. **The Maintainer is the control plane for the whole knowledge base lifecycle** — not just pair authoring. This includes maintaining the **Source Register through the UI** (edit → validate against `source-register.schema.json` → approve → commit to GitHub → sync to Drive). Frozen assets (schemas, ID register, taxonomy) stay Git-PR-only; the Source Register and pair documents are UI-maintainable because they genuinely evolve.
4. **GitHub write-back is easy by design:** one API call per file commit (Contents API), token or GitHub App stored as a deployment secret. The commit history doubles as change history.
5. **The Source-Register-maintenance slice is the first vertical slice** — it proves the whole skeleton (UI edit → deterministic validation → approval → Git commit → Drive sync → hash verification) with zero AI involvement, before the authoring pipeline is rebuilt on the same bones.

The detailed implementation plan lives in the companion document: `Maintainer_Implementation_Plan.md`.

---

## 6. Bottom line

Your instinct is correct on both counts: the idea is simple, and the implementation became too complex — not because the architecture is wrong, but because **each good idea was implemented with maximum ceremony, four times over, before a single live run validated the whole**. The fix is consolidation and graduated strictness, not abandonment. Keep the knowledge assets and the pipeline shape; halve the machinery; build the Google Drive sink and the GitHub write-back; execute the phases in the companion plan.
