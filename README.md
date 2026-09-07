# AI Governance KB Maintainer Tool

Implementation foundation for the AI Governance Knowledge Authoring & Publishing Service.

## Working branch

Current development is isolated on `feature/initial-authoring-skeleton` and reviewed through Draft PR #1 before merge to `main`.

## Current implementation status

The branch now includes:

- bounded cognitive contracts from pair boundary through pair/domain coherence review;
- deterministic completion and cross-artifact validation;
- explicit WORKHORSE / REASONER / QUALITY_CHECKER provider+model routing with primary/fallback targets;
- OpenAI/Grok/Kimi/Meta provider-neutral execution boundary;
- PostgreSQL migrations, readiness, persisted domain/pair/task/model-call state;
- immutable baseline snapshot hashing;
- path-scoped local repair contracts;
- A1/AP-A1 Golden Standard regression and mutation harness;
- repository-held capability, anti-pattern and shared-definition schemas;
- Railway deployment, `/health/ready` database-backed health gate, a read-only operator home at `/`, and Slice 2 run commands (`start domain run`, `continue domain until ready`) gated by `OPERATOR_COMMANDS_ENABLED`. Start or continue runs remaining pair SIR tasks without per-step approval; after five pairs are VALIDATED, DRAFT documents are assembled from persisted pair artifacts and Continue runs `DOMAIN_COHERENCE_REVIEW` and stops. External approval and published release stay closed;

## Still deliberately pending

- local repair from the operator UI, and closed external-approval intake;
- exact model/provider assignments in Railway role variables;
- exact approved canonical A1/AP-A1 JSON files in `golden/fixtures/`;
- production canonical compile and publication after external APPROVED;
- final Vercel Blob artifact adapter and release manifest writer;
- field-level authoring inspection and external-approval intake.

The application is a Knowledge Base production tool. It does not grant governance approval, legal applicability, residual-risk acceptance or AI-system lifecycle authorization.
