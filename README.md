# KB Document Creator

KB Document Creator is being refined to create reviewed Markdown knowledge
documents from selected inputs and deliver them to an explicitly configured
location. Start with [Next Plan](Next%20Plan/README.md) and [AGENTS.md](AGENTS.md).
The first SAE pilot uses local inputs and the explicitly selected
[`knowledge-base`](baseline/sae-training/knowledge-base/) folder; no Vercel access
is needed. This plan does not mean the Creator workflow is already implemented.

## Legacy application reference

The rest of this README describes the existing legacy 14-task application, not
instructions or readiness claims for the new Creator workflow. Its historical
plan is `docs/MAINTAINER_IMPLEMENTATION_PLAN.md`.

Standalone operator tool that authors, validates, versions, and publishes AI Governance Knowledge Base category-pair documents.

It is a Knowledge Base production tool. It does not grant governance approval, legal applicability, residual-risk acceptance, or AI-system lifecycle authorization.

## Status

The following status and validation notes describe the legacy pipeline only.

Offline predeploy verification is in place. Remaining work is test-runs, then focused fixes from findings. Cleaning of code, data, and storage comes after those runs hold.

Active line: `main`.

## What the KB Document Creator does

`source support → SIR authoring → typed compilation → revision-bound review and repair → rendering → hash-bound operator approval → publication`

- Models author semantic content only. Code owns IDs, hashes, references, state, and publication.
- A domain (five pairs) is the approval and release unit.
- Operator approval and publication are two internal operations, even if the UI uses one button.
- QC “Approve and save” records dispositions on the current candidate. It does not grant domain `APPROVED` and does not publish.
- Drafts stay visible with unresolved issues. Publication stays bound to the exact approved manifest hash.

Operator home is `GET /`. Commands (`start domain run`, `continue domain until ready`, hash-bound approval, publication) are gated by `OPERATOR_COMMANDS_ENABLED`. Default is fail-closed.

## Validation posture

Start testing now. Record findings. Change only what a run proves is wrong.

1. **Boot and board.** Database, migrations, `/health/ready`, operator home. Commands stay off until the environment is the intended test namespace.
2. **One observational pair.** Enable commands. Start domain A. Let SIR run. Expect a zero-locator `SOURCE_CONTEXT` packet and `SOURCE_GAPS_PRESENT` until a sealed locator input exists. That is a finding to record, not a reason to stop the campaign.
3. **Draft and repair.** Confirm DRAFT documents appear, HIGH defects go through review, empty saves fail, and stale hashes cannot advance a newer revision.
4. **Approval bundle.** When the domain is `READY_FOR_APPROVAL`, open the hash-bound bundle. If the board says ready but the bundle refuses because source coverage is incomplete, that mismatch is the finding. Do not invent locators to make it pass. Either supply a sealed locator fixture from allowed sources, or keep the run as a gappy draft.
5. **Publication rehearsal.** After a bundle that actually satisfies release policy, `recordApproval` then `publishApprovedRelease` to the test Blob prefix. Confirm idempotent retry and partial-upload recovery on real Postgres and Blob. Isolate artifacts by run ID and path prefix. Do not overwrite historical objects.
6. **Five-pair domain.** Repeat for a complete domain A unit only after the one-pair path is understood. Expand to B–F only after that domain’s findings are closed or explicitly accepted.

Do not merge the 14 SIR tasks during this phase. Do not backfill fake revision hashes onto old `task_runs`. Do not rewrite golden A1/AP-A1 fixtures.

## Storage during validation

- **Golden fixtures** in `golden/fixtures/` are historical regression anchors. Leave them immutable.
- **Postgres rows from earlier runs** are drafts. Inspect them. Do not approve or publish them. Start a new run for a candidate that can enter the approval bundle.
- **Vercel Blob objects** stay. Publication is put-if-absent-or-verify-same-hash. New test releases use versioned paths under the test prefix.
- Clean or reset storage only after a successful campaign, and only in the test namespace.

## Local verification

On Node 22.12+ (Node 22 in CI), run `npm ci`, then `npm run verify` with `DATABASE_URL` pointing to a disposable Postgres 16 database. Never use a production database. `npm run verify:build` is a narrower legacy predeploy check, not the Creator acceptance suite.
