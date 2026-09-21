# Task Brief — Phase 0: Repo Foundations

**Brief ID:** P0 | **Phase:** 0 | **Estimated effort:** 1–2 days of agent work + owner credential tasks
**Branch:** `phase0-repo-foundations` | **One PR.**
**Authority:** `docs/MAINTAINER_IMPLEMENTATION_PLAN.md` §4 Phase 0; rules in `AGENTS.md`.

## Purpose

Make the repository the single operational master for all governed assets and make the
current plan authoritative inside the repo — before any code is touched. After this PR,
an agent reading only the repo understands what to build and what to ignore.

## Owner prerequisites (NOT agent tasks — human must do these)

- [ ] Create GitHub PAT with `repo` scope → store as `GITHUB_TOKEN` in Vercel env + local `.env`
- [ ] Create Google Drive credentials (service account or OAuth client) with access to the
  `Knowledge Base` folder → store as env secrets (never in repo)
- [ ] Confirm `BLOB_READ_WRITE_TOKEN` is set in Vercel env
- [ ] Download from Drive `04 Global Registers/` (2 clicks each):
  - `id-register.json` — file id `1f1hr8JbCkm-6-lGL3sWrFia3gTqZVrkF`
  - `taxonomy-register.json` — file id `1fIy-mndDw5HrRKKd7pgj63tdW7iSAqW3`
- [ ] Provide `AI_Governance_Tactic_Playbook_v1.0.0.json` (sha256 must be
  `98ba7390ac81351287ec633add49b7349f5bf5989d7fa5a1d259b2a4a4c7486e`)
- [ ] Drive folder restructure (decision D8) — executed separately by Kimi via Drive connection

## Agent tasks

### T0.1 — Install the instruction set

- Copy `AGENTS.md` (provided) to repo root, unmodified.
- Copy `Maintainer_Implementation_Plan.md` → `docs/MAINTAINER_IMPLEMENTATION_PLAN.md`.
- Copy `AI-Governance-KB-Maintainer-Tool_Architecture_Review.md` → `docs/ARCHITECTURE_REVIEW_2026-09.md`.
- Create `docs/task-briefs/` and place this brief + the `P1` brief there.
- The repo already has `.cursor/environment.json` + `.cursor/Dockerfile` for cloud agents:
  verify the environment also provides **Postgres** (Phase 1 tests need it); extend the
  Dockerfile if not. Do not change anything else in `.cursor/`.

### T0.2 — Import governed assets (Git becomes the master)

- `baseline/AI_Governance_Tactic_Playbook_v1.0.0.json` ← provided file; verify sha256 matches above; commit.
- `baseline/id-register.json` ← Drive download (unchanged, v2.0.0 for now).
- `baseline/taxonomy-register.json` ← Drive download (unchanged).
- `schemas/source-register.schema.json` ← provided (from Drive, verified).
- `schemas/validation-report.schema.json` ← provided (from Drive, verified).
- `schemas/tactic-playbook.schema.json` ← provided (new, authored against playbook v1.0.0;
  the playbook validates against it with zero errors).
- Do NOT modify existing files in `schemas/` (`capability.schema.json`, `antipattern.schema.json`,
  `shared-definitions.schema.json`).
- The source register JSON already exists **at repo root**
  (`AI_Governance_Global_Source_Register_v1.5.0.json`) — leave it where it is; existing code
  reads it from there. Relocating it to `baseline/` is a Phase 2 decision, not Phase 0.

### T0.3 — id-register v2.1.0 (owner approves via PR review)

In `baseline/id-register.json`, change exactly three things:

1. `"tactic": "^GOV-[A-Z]{3}-[0-9]{3}$"` →
   `"tactic": "^TAC-(PURPOSE|DATA|MODELS|ARCHITECTURE|HUMAN|ACCOUNTABILITY)-(AP-)?[A-F][1-5]-[0-9]{2}$"`
2. `"mapping": "^MAP-(AP-)?[A-F][1-5]-GOV-[A-Z]{3}-[0-9]{3}-FND-(AP-)?[A-F][1-5]-[0-9]{3}$"` →
   `"mapping": "^MAP-(AP-)?[A-F][1-5]-TAC-(PURPOSE|DATA|MODELS|ARCHITECTURE|HUMAN|ACCOUNTABILITY)-(AP-)?[A-F][1-5]-[0-9]{2}-FND-(AP-)?[A-F][1-5]-[0-9]{3}$"`
   (the mapping pattern embeds the tactic ID format — it must change too)
3. `"version": "2.0.0"` → `"version": "2.1.0"`

Nothing else changes. PR description must carry the migration note:
"Tactic ID format aligned to approved Tactic Playbook v1.0.0 (TAC-<THEME>-<OBJECT>-<NN>).
The GOV-XXX-000 pattern matched 0 of 119 approved tactic IDs. No published tactic IDs are
reassigned — the playbook IDs are adopted as-is. Mapping pattern updated to match."

### T0.4 — Supersedes notices

Prepend this exact block to the top of `README.md`, `docs/ARCHITECTURE.md`,
`MAINTAINER_CORRECTIVE_PLAN.md` (repo root), and `docs/COGNITIVE_CONTRACTS.md`:

```
> **SUPERSEDED — 2026-09-21.** This document describes the original 14-task design and is
> kept for historical reference only. The current binding plan is
> `docs/MAINTAINER_IMPLEMENTATION_PLAN.md`; working rules are in `AGENTS.md`.
> Do not implement from this document.
```

### T0.5 — Secrets hygiene

- Verify `.env` and any credential files are in `.gitignore`; add if missing.
- Scan history for committed secrets (`npx gitleaks detect` or equivalent). Report findings
  in the PR; do NOT attempt history rewrites — found secrets are reported to the owner.

### T0.6 — Smoke tests (first test-framework tests in the repo)

Add `vitest` and `ajv-formats` as devDependencies. Create `tests/phase0/assets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function validator(schemaPath: string) {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  return ajv.compile(read(schemaPath));
}

describe("Phase 0 governed assets", () => {
  const playbook = read("baseline/AI_Governance_Tactic_Playbook_v1.0.0.json");
  const idRegister = read("baseline/id-register.json");

  it("playbook sha256 matches the approved fingerprint", () => {
    const raw = readFileSync("baseline/AI_Governance_Tactic_Playbook_v1.0.0.json");
    expect(createHash("sha256").update(raw).digest("hex")).toBe(
      "98ba7390ac81351287ec633add49b7349f5bf5989d7fa5a1d259b2a4a4c7486e"
    );
  });

  it("playbook validates against tactic-playbook.schema.json", () => {
    const validate = validator("schemas/tactic-playbook.schema.json");
    expect(validate(playbook), JSON.stringify(validate.errors)).toBe(true);
  });

  it("every tactic id matches the id-register tactic pattern", () => {
    const pattern = new RegExp(idRegister.patterns.tactic);
    for (const t of playbook.tactics) expect(pattern.test(t.id), t.id).toBe(true);
  });

  it("source register validates against source-register.schema.json", () => {
    const validate = validator("schemas/source-register.schema.json");
    const register = read("AI_Governance_Global_Source_Register_v1.5.0.json"); // repo root
    expect(validate(register), JSON.stringify(validate.errors)).toBe(true);
  });
});
```

## DO NOT TOUCH

- Everything under `src/` — Phase 0 changes no application code.
- `golden/`, existing `schemas/` files, existing `baseline/` files (except the T0.3 edit),
  the root-level source register JSON.
- Existing migrations, `run-*-check.ts` scripts, `package.json` scripts (except adding
  `"test": "vitest run"`).

## Acceptance checks (all must pass; report output in the PR)

1. `npm run typecheck` — green.
2. `npx vitest run` — 4/4 green (run from repo root).
3. `git diff --stat main` shows only the files listed in T0.1–T0.6.
4. Playbook sha256 verified (test 1 covers this).
