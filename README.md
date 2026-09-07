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
- Railway deployment, `/health/ready` database-backed health gate, a read-only operator home at `/`, and Slice 2 run commands (`start domain run`, `continue domain until ready`) gated by `OPERATOR_COMMANDS_ENABLED`. Start or continue runs remaining pair SIR tasks without per-step approval. After five pairs actually pass Pair Coherence, DRAFT documents are assembled from persisted pair artifacts and Continue runs `DOMAIN_COHERENCE_REVIEW` and stops. Remaining HIGH pair blockers are reviewed at `/review/:domain/:pairId`. Remaining HIGH domain blockers after `DOMAIN_COHERENCE_REVIEW` are reviewed at `/review/:domain`. Deleting a blocker or editing its content and clicking Approve and save is human approval of that change. After that, complete section schemas, handles, identity, and the reference graph are checked; empty sections cannot be saved. Empty or explanation-only Domain Coherence QUALITY_CHECKER JSON cannot pass. Alias coercion still applies to messy-but-real defect lists. This does not grant domain `APPROVED` or publish a release.

## Still deliberately pending

- local repair from the operator UI, and closed external-approval intake;
- exact model/provider assignments in Railway role variables;
- field-level authoring of content that is not a remaining HIGH blocker;
- exact approved canonical A1/AP-A1 JSON files in `golden/fixtures/`;
- production canonical compile and publication after external APPROVED;
- final Vercel Blob artifact adapter and release manifest writer;
- external-approval intake.

The application is a Knowledge Base production tool. It does not grant governance approval, legal applicability, residual-risk acceptance or AI-system lifecycle authorization.
