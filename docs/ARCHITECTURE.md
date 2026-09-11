# Architecture Skeleton

## Purpose

This service creates, validates, versions and publishes production-ready AI Governance Knowledge Base category-pair documents and their canonical JSON representations after hash-bound operator approval.

It is **not** an AI-system lifecycle workflow engine and does not grant governance approval, legal applicability, residual-risk acceptance or lifecycle authorization.

## Unit boundaries

- **Cognitive task**: one bounded AI objective with an explicit input/output contract.
- **Pair**: one capability and its paired anti-pattern; authoring/validation unit.
- **Domain batch**: five validated pairs; domain-coherence and operator-approval unit.
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

Deterministic `SOURCE_CONTEXT` is acquired before `SOURCE_MAPPING`. It is code-owned source acquisition, not a model SIR task, and must not be merged into unconstrained authoring.

1. `PAIR_BOUNDARY`
2. `AP_FAILURE_MODEL`
3. `APPLICABILITY`
4. `PRIMARY_QUESTIONS`
5. `ATOMIC_DECOMPOSITION`
6. `EVIDENCE_ARCHITECTURE`
7. `EVIDENCE_SAFETY`
8. `AP_ABSENCE_CONTRACT`
9. `SOURCE_MAPPING`
10. `FINDING_ARCHITECTURE`
11. `CONTROL_BOUNDARY`
12. `LIFECYCLE_ASSURANCE`
13. `REFERENCE_MAPPING`
14. `PAIR_COHERENCE_REVIEW`

Each task receives only the validated dependencies it requires. The application owns memory through persisted artifacts; model chat history is not the pipeline state. Contract `upstreamTaskTypes` are the completion-validator prerequisites. The resolver still loads every prior pair SIR task in sequence; `REFERENCE_MAPPING` is the documented subset exception (`PAIR_BOUNDARY`, `FINDING_ARCHITECTURE`, `LIFECYCLE_ASSURANCE`). `SOURCE_MAPPING` also requires the sealed Source Context Packet. Shared validator routes (the first four tasks use `SIR_INITIAL`) are not task merges. Consolidation stays `KEEP_SEPARATE_UNTIL_MEASURED`; merge remains closed.

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

OpenAI, Grok, Kimi and Meta (Muse Spark) are configured behind provider adapters and can be changed without changing orchestration logic.

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

The service may determine `READY_FOR_APPROVAL` based on completed quality gates. `APPROVED` is a standalone operator decision bound to the candidate and proposed-manifest hashes. After approval, semantic content is frozen. Canonical JSON compilation and production-document rendering are deterministic publication operations.

Operator Continue after five pairs that actually passed Pair Coherence runs `DOMAIN_COHERENCE_REVIEW` and stops at `READY_FOR_APPROVAL`. Pair-complete DRAFT documents are assembled deterministically from persisted SIR artifacts without granting `APPROVED` or publishing a versioned release. Remaining HIGH pair-coherence blockers are a human approval step: the operator may edit semantic values at recommended paths and must record an explicit finding disposition (`RESOLVED`, `WAIVED`, `ACCEPTED_RISK`, or `REJECTED`) with authority and rationale. Deleting a finding from the form does not close it. BLOCKING findings are not waivable. That save is human approval of those changes against a new candidate revision; it rebuilds coherence packets from current snapshot hashes and re-runs schema, compile, and coherence gates. It is not domain `APPROVED` and does not publish.

When a domain candidate is `READY_FOR_APPROVAL`, the operator approval review presents an immutable approval bundle bound to that candidate hash. The bundle contains candidate, source, baseline, render, gate-result, and proposed-manifest hashes, plus the exact canonical JSON and HTML bytes publication would release. Semantic parity between canonical JSON and each rendered format is fail-closed. DRAFT documents remain available and continue to identify unresolved issues. The QC “Approve and save” action and the approval-bundle preview do not grant domain `APPROVED` and do not publish.

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
