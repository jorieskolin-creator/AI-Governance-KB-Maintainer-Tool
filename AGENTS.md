# AGENTS.md — KB Document Creator

Instructions for AI coding agents (Cursor and others) working in this repository.
These rules are binding. If a task conflicts with them, stop and ask the owner.

## KB Document Creator transition — owner direction, 14 November 2026

For work refining **KB Document Creator** to the document-only scope, start with
[`Next Plan/README.md`](Next%20Plan/README.md) and follow the DC task briefs in
that folder. This is the owner's revised scope: create reviewed PDF/Markdown
knowledge documents from supplied inputs and deliver them to agreed storage;
Master Table Creator and Knowledge Hub are separate tools. Markdown is the
primary output; PDF is an optional derived rendition, and HTML is preview only.

The owner prepares Vercel input/schema/Golden Reference and output prefixes.
Production reads the selected Vercel inputs and writes generated documents there;
Google Drive is excluded. The first profile uses the owner-supplied SAE materials
and one Golden Reference capability/anti-pattern pair. Develop adapters from those
samples, not assumptions about older repository documents. The owner has confirmed
the supplied SAE Tactic Playbook is final despite older incomplete-approval wording.
Record that decision against the selected version/hash; the legacy pending-mapping
statement below does not block this input set. Validate actual links without
inventing relationships or applying the override to unrelated input versions.

For these transition tasks, `Next Plan/` takes precedence over the legacy
product scope, September implementation-plan priority, old phase boundaries,
and mandatory Git/Drive/JSON publication obligations below. Each DC task states
which modules it may change. Retain the applicable invariants: no fabricated
source support or approval, no secrets in Git, immutable historical Golden
fixtures, no edits to applied migrations, and honest verification results.
Use one branch/PR per DC task. This note and the plan do not themselves implement
or deploy the new application. Unrelated legacy maintenance still follows the
instructions below.

---

## What this project is

The legacy implementation is the **lifecycle control plane** for the AI Governance Knowledge Base:
6 domains (A–F) × 5 capability/anti-pattern pairs = 30 pairs. It maintains governed
assets (starting with the Source Register) and authors, validates, repairs, approves,
and publishes pair documents.

- **Git (this repo) = operational master** for all governed assets. Runtime reads come from here.
- **Google Drive = approved mirror + human layer.** One-way flow Git → Drive. The tool is the
  only writer on Drive. The tool NEVER reads Drive at runtime.
- **Vercel Blob = machine-consumable published content** (canonical JSON, immutable).

## Authoritative documentation (in this order)

1. `docs/MAINTAINER_IMPLEMENTATION_PLAN.md` — the current plan (Phases 0–5). **Follow this.**
2. `docs/ARCHITECTURE_REVIEW_2026-09.md` — root-cause findings; explains what NOT to rebuild.
3. This file.

**Superseded documents — do NOT follow them:** `README.md` status section,
`docs/ARCHITECTURE.md`, `MAINTAINER_CORRECTIVE_PLAN.md`, `docs/COGNITIVE_CONTRACTS.md`.
They describe the old 14-task design and are kept for reference only. Each carries a
supersedes notice at the top.

## Non-negotiable invariants

- **Models author semantics; code owns IDs, hashes, state, and publication.** Never let model
  output assign IDs, hashes, revision numbers, or publication state.
- **Golden fixtures are immutable.** NEVER modify anything under `golden/` (A1/AP-A1 fixtures
  are the regression anchor).
- **NEVER backfill or fabricate revision hashes** for historical records.
- **Secrets live in environment secret stores only.** NEVER commit tokens, keys, or credentials
  (`GITHUB_TOKEN`, `BLOB_READ_WRITE_TOKEN`, Google Drive credentials, provider API keys).
- **Fail closed.** Validation failures block the flow with explicit findings. NO silent
  fallbacks, NO fabricated completeness, NO invented source locators.
- **Findings do not authorize action.** Analysis output never triggers publication without
  the deterministic gates and explicit operator approval.
- **Tactic references stay empty** in pair documents until an exact, approved, reciprocal
  mapping from the Tactic Playbook exists. (Playbook v1.0.0 approval excludes finding-level
  activation mappings; all tactics are `PENDING_KB_FINDING_MAPPING`.)

## Strictness tiers

- **DRAFT tier** (authoring/editing): schema validation + reference-graph checks only.
  Cheap edits, no hash ceremony.
- **RELEASE tier** (promotion/publication): immutable revisions, hash-bound gates, approval
  bundle, dual-write parity.
- Every new gate MUST declare its tier. Default: DRAFT.

## Current phase boundary (Phase 2 underway)

Work is executed from approved task briefs in `docs/task-briefs/`. Work on ONE brief at a time.

Phase 2 is underway. `npm run verify` exists and must be green: typecheck, vitest, build, and golden regression. A red verify result is a failed gate, not a skipped check.

**DO NOT touch unless the active task brief explicitly says so:**

- `src/cognitive/`, `src/sir/`, `src/orchestration/`, `src/validation/`, `src/release/`,
  `src/compiler/` — the old pipeline; consolidation happens in Phase 2, not before.
- `golden/`, `baseline/`, `schemas/` — governed assets; changed only via the governed flows.
- Existing migrations — never edit applied migrations; new schema changes are new migrations.
- `run-*-check.ts` scripts — do not extend them; they are deleted in Phase 2 after their
  assertions are migrated to vitest.

**Do not refactor adjacent code** outside your assigned task, even if it looks wrong.
Record the observation in the PR description instead.

## How to work

- One task = one branch = one PR. Branch naming: `phase<N>-<short-slug>`.
- Commit messages: `phase<N>: <what changed> (<brief-id>)`.
- **Definition of done:** the acceptance checks in the task brief pass, and
  `npm run typecheck` is green. Once `npm run verify` exists (Phase 2), it must be green.
- If you cannot satisfy an acceptance check, say so explicitly in the PR — NEVER mark
  work complete with failing or skipped checks.

## Code style

- TypeScript ESM, Node ≥ 20, Fastify, drizzle-orm, zod + AJV for validation.
- One contract = one home: each pipeline task owns its schema, types, validator, and prompt
  builder in a single module. Do not re-express the same contract in multiple directories.
- Small modules; no new abstractions without a second use case.
