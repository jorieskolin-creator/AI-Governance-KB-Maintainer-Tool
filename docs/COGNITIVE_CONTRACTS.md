# Cognitive Contracts

## Principle

A cognitive task is the smallest AI reasoning unit. It is not a pair, domain batch or approval unit.

Every task is fail-closed and has one objective, a versioned contract, explicit upstream dependencies, immutable locked inputs, allowed references, DO-NOT boundaries, strict JSON output, deterministic completion checks and declared downstream dependency paths.

The model conversation is never pipeline state. Validated persisted task artifacts are the only admissible upstream cognitive inputs.

## Pair task sequence

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
12. `REFERENCE_MAPPING`
13. `PAIR_COHERENCE_REVIEW`

A completed domain batch is reviewed separately with `DOMAIN_COHERENCE_REVIEW` before it can become ready for external approval.

## Cognitive isolation rules

- `ATOMIC_DECOMPOSITION` describes evidence needs but does not create evidence IDs.
- `EVIDENCE_ARCHITECTURE` owns evidence objects, deterministic evidence IDs and exact atomic bindings.
- `EVIDENCE_SAFETY` owns ceilings, false-positive guards, prohibited inferences, contradiction handling and freshness rules.
- `AP_ABSENCE_CONTRACT` is isolated so silence or missing evidence can never become tested absence.
- `SOURCE_MAPPING` can use only the deterministic allowed-source packet created from the sealed Source Register baseline.
- `PAIR_COHERENCE_REVIEW` and `DOMAIN_COHERENCE_REVIEW` are critic-only; they return localized defects, never replacement production content.
- Tactic references remain empty unless an exact approved reciprocal catalog mapping can be deterministically verified.

## Model roles

Cognitive services request a role, not a provider directly:

- `WORKHORSE`
- `REASONER`
- `QUALITY_CHECKER`

Each role has an explicit primary provider/model and fallback provider/model. Provider choice is therefore configuration, while cognitive responsibility remains stable.

## Execution contract

`src/orchestration/task-runner.ts` executes the bounded task as follows:

1. load the task contract and validated prerequisite state;
2. persist the task as `STARTED` with deterministic input hash;
3. build the provider-neutral prompt packet;
4. execute the role's primary provider/model;
5. run deterministic task completion;
6. persist `COMPLETED` only when the output passes;
7. if the primary execution or completion fails, execute the configured fallback;
8. require the fallback to pass the same deterministic gate;
9. persist model-call metadata for every attempt;
10. persist failure findings and leave the task failed when neither route passes.

A model never overrides a deterministic gate.

## Local repair

Validation findings resolve through the deterministic Impact Resolver. `LOCAL_REPAIR` receives the frozen object, exact allowed target paths, relevant dependencies and validators to rerun. It returns path/value patches only; a complete rewritten object is prohibited.

This implements:

`DETECT -> LOCALIZE -> RESOLVE IMPACT -> PATCH ONLY TARGET PATHS -> REVALIDATE AFFECTED DEPENDENCIES`

## Golden Standard

A1/AP-A1 is the regression anchor. The mutation harness checks whether known corruptions are detected, including duplicate atomic IDs, broken evidence references, incomplete anti-pattern absence testing, missing lifecycle target coverage and removed evidence-safety rules.

The exact approved canonical A1/AP-A1 JSON fixtures must be committed byte-for-byte under `golden/fixtures/`. Historical approved fixtures retain their historical schema version and approval record; they are not silently migrated to the current authoring schema.
