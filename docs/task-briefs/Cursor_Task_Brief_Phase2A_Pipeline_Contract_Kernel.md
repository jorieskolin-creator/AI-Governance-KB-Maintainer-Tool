# Cursor Task Brief — Phase 2A: Pipeline Contract Kernel (P2A)

**Brief ID:** P2A
**Phase:** 2 (slice A of 3 — B: state model, C: test migration + deletions)
**Branch:** `phase2-pipeline-kernel` (from `main`)
**Commit / PR title:** `phase2: pipeline contract kernel (P2A)`
**Estimated size:** large (new `src/pipeline/` module tree + tests)

## 1. Purpose

Build the consolidated authoring-pipeline core that will replace the `cognitive/ + sir/ + validation/ + orchestration/` fan-out: five modules under `src/pipeline/`, each owning exactly one contract (schema + types + validator + prompt builder), plus a deterministic source-context stage — and **prove the kernel offline against the golden A1/AP-A1 pair before anything old is deleted**.

## 2. Context

- Plan §4 Phase 2 consolidates 14 SIR tasks into 4 model tasks + 1 deterministic stage:

| New task | Owns | Consolidates (old world) |
|---|---|---|
| `PAIR_FRAME` | boundary + AP failure model + applicability + primary questions | `sir-initial-*` |
| `EVIDENCE_AND_SAFETY` | atomic decomposition + evidence architecture + safety + absence contract | `sir-atomic-*`, `sir-evidence-*`, `sir-evidence-safety-*`, `sir-ap-absence-*` |
| `MAPPINGS` | source mapping + findings + control boundary + lifecycle + reference mapping | `sir-source-mapping-*`, `sir-finding-*`, `sir-control-*`, `sir-lifecycle-*`, `sir-reference-mapping-*` |
| `PAIR_COHERENCE_REVIEW` | pair-level coherence gate | `sir-pair-coherence-*` |
| `SOURCE_CONTEXT` | source context packet assembly + verification — deterministic, code-owned, **no model** | `orchestration/source-context-acquisition`, `source-context-packet`, `source-context-verifier`, `source-packet` |

- Domain coherence is **not** part of Phase 2 (domain level, Phase 4).
- This slice delivers the kernel + offline parity. The state-model merge (candidate revision + append-only gate ledger) is P2B; migration of the 51 `run-*-check` assertions to vitest and all deletions are P2C.
- Models author semantics; code owns IDs/hashes/state/publication. Golden fixtures are immutable.

## 3. Ground rules (binding)

- `AGENTS.md` and `docs/MAINTAINER_IMPLEMENTATION_PLAN.md` §4 Phase 2 govern. Where this brief and the code disagree, stop and report.
- **No provider calls in this slice.** The kernel runs offline against recorded task outputs. `src/pipeline/` must contain zero AI SDK imports.
- `src/pipeline/` may import only: Node stdlib, package dependencies, `src/domain/`, `src/compiler/`, `src/assets/`, and itself. It must NOT import from `src/ai/`, `src/cognitive/`, `src/sir/`, `src/orchestration/`, or `src/validation/` — those remain the old world and are deleted in P2C.
- Do not modify: `golden/`, `baseline/`, `schemas/`, `migrations/`, `src/compiler/` (used as-is), the old pipeline directories, the register kernel (`src/register/`, `src/assets/`).
- One task = one branch = one PR. Incremental commits on the branch are encouraged (one per module).

## 4. Implementation

### 4.1 `src/pipeline/` — one module per task
For each of the five tasks in §2, create one module exporting:
- the **JSON Schema** (draft 2020-12) for its task output,
- the **TS types** (single source — generated from, or exactly mirroring, the schema),
- an **AJV validator** following the `src/assets/validate.ts` pattern (Ajv2020 + ajv-formats, `allErrors`, `Finding = { code, path, message }`),
- a **prompt builder** (pure function: inputs → prompt string). Absorb the relevant contract content from the old `src/cognitive/*-contract*` files — the prompt text defines the task contract, so port it faithfully; do not "improve" it,
- a `validate(output, tier)` entry point (see 4.2).

`source-context.ts` additionally owns packet assembly and verification (absorbing the old source-context acquisition/packet/verifier logic) and is deterministic: same inputs → byte-identical packet.

### 4.2 Two-tier strictness
Every validator accepts `tier: "DRAFT" | "RELEASE"` (default `RELEASE`):
- **DRAFT:** schema-structure validation only; contract violations collected as warnings.
- **RELEASE:** full contract checks; any failure is fatal (fail closed).

### 4.3 Offline authoring runner — `src/pipeline/author-offline.ts`
- Runs the five stages in order for pair A1/AP-A1 using **recorded task outputs only**.
- Recordings: start with `src/compiler/sir-compile-fixture.ts` and the fixtures embedded in the old `run-*-check.ts` scripts. Extract per-task outputs as data files under `tests/pipeline/recordings/`. If a required recording does not exist, **stop and report which task lacks one — never synthesize model semantics**.
- Feed the resulting per-task packets into the existing `src/compiler/sir-compiler.ts` (unmodified) to produce the canonical pair JSON.

### 4.4 Golden parity — `tests/pipeline/golden-parity.test.ts`
- The new kernel's packet for each task deep-equals the recorded packet for that task.
- The compiler output from those packets deep-equals `golden/fixtures/A1_v1.0.0.json` and `golden/fixtures/AP-A1_v1.0.0.json` (canonical JSON comparison).
- On any mismatch: identify the exact task/packet/field that differs and report it in the PR. Do **not** edit golden fixtures or the compiler to force a match.

### 4.5 `npm run verify`
Add a root script chaining (use the actual script names in `package.json`): typecheck + `vitest run` + golden regression. `AGENTS.md` requires it green from Phase 2 onward.

### 4.6 Unit tests — `tests/pipeline/`
Per module: schema negative cases (malformed outputs rejected with precise findings), tier behavior (DRAFT warns / RELEASE fails), prompt-builder snapshot (byte-stable for fixed inputs), source-context determinism.

## 5. Acceptance checks

1. `npm run verify` green.
2. Golden parity test green.
3. Zero-AI grep on `src/pipeline` clean; no imports from old-world directories into `src/pipeline` (show grep evidence).
4. `golden/`, `baseline/`, `schemas/`, `migrations/`, `src/compiler/`, old pipeline dirs: no changes in the diff.
5. No provider/network calls in the new code path — tests must pass without credentials.

## 6. PR requirements

- Branch `phase2-pipeline-kernel` from latest `main`; commits `phase2: <module or step> (P2A)`; PR title `phase2: pipeline contract kernel (P2A)`.
- PR body: module map (old files → new module), evidence for every §5 check, the parity result, and an explicit list of anything not done or not verifiable.

## 7. Reporting

Report only verified facts with commands. Missing recordings, contract conflicts, or parity mismatches are reported as findings — they do not authorize workarounds, fixture edits, or compiler edits.
