# AGENTS.md — AI Governance KB Maintainer

Instructions for AI coding agents (Cursor and others) working in this repository.
These rules are binding. If a task conflicts with them, stop and ask the owner.

## What this project is

The Maintainer is the **lifecycle control plane** for the AI Governance Knowledge Base:
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
