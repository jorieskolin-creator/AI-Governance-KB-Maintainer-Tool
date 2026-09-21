# Maintainer Implementation Plan

**Date:** 2026-09-21
**Status:** Proposed, based on confirmed decisions D1–D7 (see `Maintainer_Discussion_Summary_2026-09-21.md`)
**Companion documents:** `AI-Governance-KB-Maintainer-Tool_Architecture_Review.md`, `Google_Drive_Knowledge_Base_Evaluation.md`

---

## 1. Goal

Make the Maintainer a working, simple, trustworthy tool that:

1. **Maintains governed assets through the UI** — starting with the Source Register: edit → deterministic schema validation → approve → commit to GitHub → sync approved version to Google Drive, hash-verified.
2. **Authors pair documents** (capability + anti-pattern, domains A–F) from the Source Register only, per the active schemas and the Golden Standard.
3. **Compiles canonical machine-readable JSON** and checks it deterministically.
4. **Fixes only defective areas** (path-scoped repair, focused re-verification).
5. **Publishes**: canonical JSON → Vercel Blob (machine consumption); human-readable documents + reports → Google Drive (human consumption). One release, one manifest, both destinations.
6. Repeats per pair, per domain — with documents readable, fixable, and updatable from the UI at all times.

## 2. Guiding principles (from the review — these are the fix for the fragility)

1. **Kernel first, then growth.** Prove the smallest end-to-end slice live before building breadth. Never again design the whole thing up front.
2. **One source of truth per contract.** Each pipeline task owns its schema + types + validator + prompt builder in one module. No 4-directory re-expression.
3. **Graduated strictness.** DRAFT tier: cheap edits, schema + reference validation only. RELEASE tier: full hash-bound ceremony at the promotion boundary. Accuracy demand lives at release time.
4. **One master per fact.** Git is the machine master; Drive holds approved mirrors and human-readable outputs; Vercel holds machine-consumable releases. One-way flow Git → Drive.
5. **Models author semantics; code owns IDs, hashes, state, and publication.** Unchanged — the best invariant in the existing repo.
6. **Deletion is a deliverable.** Each phase names what it removes. Target end state: roughly half the current LOC.

## 3. Target shape (end state)

```javascript
src/
├── assets/          # loaders + validators for governed assets (source register, schemas, taxonomy, golden)
├── register/        # Source Register maintenance: UI edit, schema gate, version bump, impact flagging
├── pipeline/        # 4 consolidated cognitive tasks + deterministic QC + focused repair
├── compiler/        # SIR → canonical JSON (kept from current code, trimmed)
├── release/         # approval + dual publish (Vercel Blob + Google Drive) + manifest
├── operator/        # server-rendered UI: board, register editor, pair review/fix, approval
└── server.ts        # fastify app
```

- **DB: ~8 tables** (runs, revisions, gate ledger, findings, approvals, releases, sync state, model calls) — down from 17.
- **Tests: vitest** with shared fixture loaders — the 51 `run-*-check.ts` scripts are deleted.
- **Verification command:** `npm run verify` = typecheck + tests + golden regression. One command, full picture.

## 4. Phases

### Phase 0 — Foundations (2–3 days, mostly decisions and housekeeping)

**Scope:**

- Execute the Drive restructure per the evaluation document: create `99 Archive/`, move old manual-pipeline outputs, delete true duplicates and legacy Python tooling, update `knowledge-base-manifest.json` to reality.
- Reconcile the **Tactic Playbook** (D7 — resolved 2026-09-21): `AI_Governance_Tactic_Playbook_v1.0.0.json` exists — 119 tactics, APPROVED 2026-08-26, covering all 60 capability/anti-pattern objects. The playbook **is** the Tactic Catalog, and it is the authority; three artifacts must catch up to it:
  1. Write `tactic-playbook.schema.json` describing the playbook **as it is** (the Drive `tactic-catalog.schema.json` v2.1.0 describes an older, richer tactic shape — owners, activities, artifacts, acceptance criteria, verification, eligibility, duplicate fingerprints, `GOV-XXX-000` IDs — that nobody produces; archive it).
  2. Revise the id-register tactic-ID pattern to the playbook format (`TAC-<THEME>-<OBJECT>-<NN>`); the frozen `^GOV-[A-Z]{3}-[0-9]{3}$` pattern matches **0 of 119** approved tactic IDs.
  3. Fix `knowledge-base-manifest.json`: replace the phantom "Tactic Catalog v1.8.0 APPROVED" entry with the real playbook file + sha256 (`98ba7390…c7486e`).
  Place the playbook master in Git (`baseline/`), approved mirror in Drive `02 Authorities/tactic-catalog/`, per the storage operating model.
- Consolidate duplicate masters: `taxonomy-register.json` and `id-register.json` become Git-repo files (the machine master); Drive keeps approved mirrors only.
- Set up GitHub write-back credentials for the deployed tool (PAT with `repo` scope now; GitHub App later if wanted).
- Set up Google Drive service credentials for the tool (OAuth client or service account with access to the `Knowledge Base` folder).

**Exit criteria:** Drive matches the 6-folder structure; manifest is truthful; repo contains all machine masters; both write credentials work from a deployed environment.

### Phase 1 — Kernel slice: Source Register maintenance through the UI (~1 week)

The first vertical slice, deliberately **without any AI** — it proves the entire skeleton that everything else reuses.

**Build:**

- `assets/` loader: read Source Register + `source-register.schema.json` from the repo at boot; expose current version + hash.
- Register editor UI: view register, edit an entry (add source / update verification date / mark superseded), save attempt.
- Deterministic gate: validate edited register against `source-register.schema.json` — fail-closed, exact findings shown in UI.
- Impact flagging: list which published pairs reference changed source IDs (flag for revalidation; no auto-rewrite).
- Approval + write-back: on approve, commit the new register version to GitHub (Contents API, structured commit message), then sync to Drive `02 Authorities/` as a new versioned file + update manifest sha256.
- Drift check: scheduled or on-boot comparison of Git hash vs Drive hash; surface mismatch on the operator home page.

**Delete/defer:** none of the old pipeline is touched yet; this phase adds, doesn't remove.

**Exit criteria:** a real Source Register change goes UI → validation → approval → Git commit → Drive sync → hash-verified, end to end, in the deployed environment. A deliberately broken edit is rejected with precise findings. A forced Drive-sync failure retries cleanly with Git intact.

### Phase 2 — Engine consolidation (~1.5–2 weeks)

Rebuild the authoring core around the proven kernel. This is where the complexity findings get fixed.

**Build:**

- **Consolidate 14 SIR tasks → 4:**
- `PAIR_FRAME` — boundary + AP failure model + applicability + primary questions
- `EVIDENCE_AND_SAFETY` — atomic decomposition + evidence architecture + safety + absence contract
- `MAPPINGS` — source mapping + findings + control boundary + lifecycle + references
- `PAIR_COHERENCE_REVIEW` — critic-only, unchanged in role
- Plus the deterministic, code-owned `SOURCE_CONTEXT` acquisition step (not a model task).
- **One module per task**: exports JSON Schema, TS types (zod-derived), validator, prompt builder. The four-directory fan-out (`cognitive/`, `sir/`, `validation/`, `orchestration/` per-task files) collapses into `pipeline/`.
- **Two-tier strictness:** DRAFT tier (schema + reference graph; cheap edits; no hash ceremony) and RELEASE tier (immutable revision, hash-bound gates, approval bundle, parity) applied at promotion.
- **State model:** merge the four overlapping concepts into two — candidate revision (content hash) + append-only gate ledger; derive all statuses from the ledger.
- **Test migration:** move the assertions of the 51 `run-*-check.ts` scripts into vitest with shared fixtures; keep golden A1/AP-A1 regression as the anchor.

**Delete:** `src/cognitive/`, `src/sir/`, most of `src/orchestration/`, `src/validation/` per-task files, all `run-*-check.ts` scripts, ~9 DB tables. Expected: −50–60% LOC.

**Exit criteria:** one pair authored offline against recorded model responses compiles to schema-valid canonical JSON; golden regression passes; `npm run verify` is green; every remaining contract has exactly one definition and one test.

### Phase 3 — First live pair end-to-end (~1 week)

**Scope:** run A1/AP-A1 (or a deliberately different pair to avoid echoing the golden fixture) with real provider calls:
source context → author (4 tasks) → deterministic QC → inject a real defect → focused fix via UI (only the changed area re-verified) → domain-of-one promotion → operator approval → publish canonical JSON to Vercel Blob + human-readable rendering to Drive `04 Knowledge Base/A/` + reports to `05 Operations/`.

**Build (the missing sinks):**

- Google Drive sink module: upload human-readable rendering + release manifest + validation report to the agreed folders; append-only; records file IDs and hashes in the release manifest.
- Dual-write release operation: Vercel + Drive as one release; partial failure = incomplete release with retry, never silent half-publish.
- Focused re-verification on UI edits: only the affected section + its reference graph re-validates; no full-document ceremony in DRAFT tier.

**Exit criteria:** one pair fully published live; published bytes match approved manifest on both destinations; defect-fix cycle demonstrated through the UI; Drive folders contain the expected artifacts where a human can read them.

### Phase 4 — Domain A, then rollout (~2–3 weeks)

- Complete domain A (5 pairs) with domain coherence review and hash-bound approval.
- Recover or regenerate the old pipeline's A2–A5/B1/B2 content decision: the old canonical JSONs are not in Drive (likely in Vercel Blob) — decide whether they are reference material or regenerated fresh by the new pipeline. Recommendation: **regenerate fresh**; the old content was produced by an unvalidated manual process.
- Roll out B → F, one domain at a time; each domain's findings close before the next starts.

### Phase 5 — Steady-state maintenance mode (ongoing)

- Routine Source Register upkeep via UI (Phase 1 capability, now exercised regularly).
- Pair document updates via UI with focused re-verification and re-publication (version bump, both sinks).
- Periodic drift check Git vs Drive; annual register review cadence per the taxonomy register's `review_due_on`.

## 5. Explicitly NOT in this plan

- No enterprise auth/SSO, no multi-user approval layer (per existing corrective plan — correct).
- No finding/question-level tactic activation mappings. The Tactic Playbook exists and is authoritative (D7 resolved — the playbook **is** the catalog), but its approval explicitly excludes exact KB finding/question mappings, and all 119 tactics carry `activation_mapping_status: PENDING_KB_FINDING_MAPPING`. KB pair documents keep tactic references empty until a separately approved mapping exists — matching the codebase's existing rule ("tactic references remain empty unless an exact approved reciprocal catalog mapping can be deterministically verified").
- No merging of QC into authoring, no merging source acquisition into authoring (existing invariants — correct).
- No second hosting environment, no Drive-as-runtime-input (tool reads Git + Vercel only).
- No new schemas beyond adopting the already-written `source-register.schema.json` and `validation-report.schema.json` (both exist on Drive unused — Phase 1 and 3 give them their jobs).

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Consolidating 14 tasks → 4 loses quality granularity | Golden regression + measured comparison on the first live pair; keep validators independent even where prompts merge (the existing docs already anticipate this) |
| Source acquisition (`SOURCE_CONTEXT`) returns zero locators | Known gap from the review: treat as `SOURCE_GAPS_PRESENT` finding, keep draft visible, do not invent locators — unchanged policy |
| Triple-write (Git + Drive + DB) inconsistency | Git commit is the atomic point of truth; Drive sync is idempotent retry; DB records both outcomes |
| GitHub/Drive credential failure in deployment | Fail-closed with explicit error state; sync retry queue; never silent |
| Scope creep back into ceremony | Every new gate must answer: "DRAFT or RELEASE tier?" — default DRAFT |

## 7. Effort overview

| Phase | Effort | Output |
| --- | --- | --- |
| 0 — Foundations | 2–3 days | Clean Drive, truthful manifest, credentials, single masters |
| 1 — Kernel slice (register maintenance) | ~1 week | Proven skeleton: UI → validate → approve → Git → Drive |
| 2 — Engine consolidation | ~1.5–2 weeks | −50–60% LOC, 4 tasks, two-tier strictness, vitest |
| 3 — First live pair | ~1 week | Dual-sink publication proven live |
| 4 — Domain A + rollout | ~2–3 weeks | All 6 domains published |
| 5 — Maintenance mode | ongoing | The tool's actual purpose, running |

**Total to a working Maintainer: roughly 5–7 focused weeks**, with the first genuinely useful capability (register maintenance) live after week 2.
