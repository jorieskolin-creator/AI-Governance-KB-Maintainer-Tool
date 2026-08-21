# Initial Cognitive Contracts

## Principle

A cognitive task is the smallest AI reasoning unit. It is not a pair, domain batch or approval unit.

Every task is fail-closed and has:

- one objective;
- versioned contract;
- explicit upstream task dependencies;
- immutable locked inputs;
- allowed references;
- explicit DO-NOT boundaries;
- strict JSON output contract;
- deterministic completion checks;
- declared downstream dependency paths.

The model conversation is never the pipeline state. Validated task artifacts are persisted and become the only admissible upstream inputs for later tasks.

## Implemented task 1: PAIR_BOUNDARY

Purpose: establish semantic ownership before any detailed authoring begins.

Produces only:

- capability canonical definition;
- governance purpose;
- distinct claim;
- explicitly owned topics;
- boundaries against adjacent criteria;
- paired anti-pattern canonical definition and relationship;
- boundary rationale.

It must not create evidence, atomic criteria/tests, findings, sources, tactics or governance decisions.

Model role: `REASONER`.

Completion gate checks output shape, expected pair/capability/anti-pattern IDs and exact capability-to-anti-pattern pairing.

## Implemented task 2: AP_FAILURE_MODEL

Prerequisite: validated `PAIR_BOUNDARY`.

Purpose: define the failure mechanism independently from evidence or findings.

Produces only:

- failure mechanism;
- triggering conditions;
- observable failure surfaces;
- non-examples;
- distinction between the anti-pattern mechanism and an ordinary bounded capability gap.

It must not redefine the capability boundary or infer anti-pattern presence/absence for any real system.

Model role: `REASONER`.

## Implemented task 3: APPLICABILITY

Prerequisites:

- validated `PAIR_BOUNDARY`;
- validated `AP_FAILURE_MODEL`.

Purpose: define capability and anti-pattern applicability as separate but coherent objects.

Produces only:

- applicability statement;
- conditions;
- exclusions;
- reassessment triggers;
- pair consistency notes.

It does not determine legal applicability for a real system and does not create questions, evidence, findings, sources or tactics.

Model role: `WORKHORSE`.

## Deterministic completion rule

A task can be persisted as `COMPLETED` only when:

1. every required upstream task is already validated;
2. output satisfies the strict task-specific shape;
3. target IDs match the orchestrator-supplied IDs;
4. capability and anti-pattern IDs form the exact pair;
5. no undeclared output sections are returned.

If a completion schema has not yet been implemented for a task type, the gate fails closed.

## Prompt assembly

`src/cognitive/prompt-builder.ts` converts a Task Contract into a provider-neutral prompt packet. Provider adapters receive the same cognitive contract regardless of whether OpenAI, Grok or Kimi is selected by the model router.

This keeps provider choice separate from reasoning architecture.

## Next tasks

The next cognitive contracts should follow in sequence only after these first contracts are tested with representative category inputs:

1. `PRIMARY_QUESTIONS`
2. `ATOMIC_DECOMPOSITION`
3. `EVIDENCE_ARCHITECTURE`
4. `EVIDENCE_SAFETY`

The same pattern then continues through source mapping, findings, control boundaries, pair coherence and domain coherence.
