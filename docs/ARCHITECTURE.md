# Architecture Skeleton

## Purpose

This service creates, validates, versions and publishes production-ready AI Governance Knowledge Base category-pair documents and their canonical JSON representations after external human approval.

It is **not** an AI-system lifecycle workflow engine and does not grant governance approval, legal applicability, residual-risk acceptance or lifecycle authorization.

## Unit boundaries

- **Cognitive task**: one bounded AI objective with an explicit input/output contract.
- **Pair**: one capability and its paired anti-pattern; authoring/validation unit.
- **Domain batch**: five validated pairs; domain-coherence and external-approval unit.
- **Release**: approved immutable artifacts and manifest.

A domain batch is never a single model call.

## Domain flow

```text
SELECT DOMAIN BATCH
  -> FREEZE AUTHORING BASELINE
  -> FOR EACH CATEGORY PAIR
       -> BOUNDED PAIR TASK SEQUENCE
       -> PAIR VALIDATION
       -> LOCAL REPAIR WHEN REQUIRED
       -> VALIDATED PAIR
  -> DOMAIN COHERENCE VALIDATION
  -> LOCAL REPAIR WHEN REQUIRED
  -> DOMAIN PRODUCTION CANDIDATE
  -> EXTERNAL HUMAN APPROVAL
  -> DETERMINISTIC CANONICAL JSON COMPILATION
  -> FINAL DETERMINISTIC VALIDATION
  -> GENERATE HUMAN-READABLE PRODUCTION DOCUMENTS
  -> STORE VERSIONED RELEASE
```

## Pair cognitive sequence

1. `PAIR_BOUNDARY`
2. `AP_FAILURE_MODEL`
3. `APPLICABILITY`
4. `PRIMARY_QUESTIONS`
5. `ATOMIC_DECOMPOSITION`
6. `EVIDENCE_ARCHITECTURE`
7. `EVIDENCE_SAFETY`
8. `SOURCE_MAPPING`
9. `FINDING_ARCHITECTURE`
10. `CONTROL_BOUNDARY`
11. `REFERENCE_MAPPING`
12. `PAIR_COHERENCE_REVIEW`

Each task receives only the validated dependencies it requires. The application owns memory through persisted artifacts; model chat history is not the pipeline state.

## Cognitive isolation contract

Every model call must specify:

- target object/path;
- one primary objective;
- model role;
- locked inputs;
- permitted references;
- explicit `DO NOT` constraints;
- structured output contract;
- validators to run after completion;
- dependency paths affected by the result.

Generation, criticism, factual verification and repair are separate operations.

## Model roles

The application requests roles, not providers directly:

- `REASONER`: high-dependency semantic reasoning and repair.
- `WORKHORSE`: bounded structured authoring.
- `QUALITY_CHECKER`: independent adversarial semantic/factual review.

OpenAI, Grok and Kimi are configured behind provider adapters and can be changed without changing orchestration logic.

## Validation layers

1. deterministic schema validation;
2. deterministic identifier/reference graph validation;
3. source-register and locator validation;
4. tactic reciprocal-reference validation when applicable;
5. semantic quality review;
6. factual/source support review;
7. Golden Standard validation;
8. pair coherence;
9. domain coherence;
10. final JSON/publication parity and release-integrity validation.

No model may override a deterministic gate.

## Repair model

Validation findings identify an exact object path and dependency scope. The deterministic Impact Resolver selects the repair target and validators to rerun. AI may edit only the affected content; unrelated content must remain frozen.

```text
DETECT -> LOCALIZE -> RESOLVE IMPACT -> LOCAL REPAIR -> REVALIDATE AFFECTED DEPENDENCIES
```

A full pair/domain regeneration is a last-resort explicit action, not normal failure handling.

## Approval boundary

The service may determine `READY_FOR_APPROVAL` based on completed quality gates. `APPROVED` is supplied by the external human process. After approval, semantic content is frozen. Canonical JSON compilation and production-document rendering are deterministic publication operations.

## Persistence

PostgreSQL is the control plane for:

- baseline snapshots;
- domain/pair/task state;
- cognitive task contracts and outputs;
- validation findings;
- repair state;
- model-call metadata;
- approvals;
- versions/releases;
- artifact hashes and locations.

Final immutable release artifacts are stored in the configured Vercel-backed artifact store.

## Initial implementation rule

Start with the orchestration contracts, persistence model, validators and A1/AP-A1 Golden Standard regression path before enabling broad A-F generation.
