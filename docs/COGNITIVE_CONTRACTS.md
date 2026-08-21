# Cognitive Contracts

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

## 1. PAIR_BOUNDARY

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

## 2. AP_FAILURE_MODEL

Prerequisite: validated `PAIR_BOUNDARY`.

Purpose: define the anti-pattern failure mechanism independently from evidence or findings.

Produces only:

- failure mechanism;
- triggering conditions;
- observable failure surfaces;
- non-examples;
- distinction between the anti-pattern mechanism and an ordinary bounded capability gap.

It must not redefine the capability boundary or infer anti-pattern presence/absence for any real system.

Model role: `REASONER`.

## 3. APPLICABILITY

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

## 4. PRIMARY_QUESTIONS

Prerequisites:

- validated `PAIR_BOUNDARY`;
- validated `AP_FAILURE_MODEL`;
- validated `APPLICABILITY`.

Purpose: author exactly three primary questions for the capability and exactly three for the anti-pattern using the fixed dimensions:

1. `DEFINITION_AND_INTENT`
2. `IMPLEMENTATION_AND_OPERATION`
3. `EVIDENCE_AND_EFFECTIVENESS`

The orchestrator fixes IDs as `<capability>-Q1..Q3` and `<anti-pattern>-Q1..Q3`. The model cannot change their identity or order.

This step must not create atomic items, evidence, findings, source mappings, tactics or lifecycle consequences.

Model role: `REASONER`.

## 5. ATOMIC_DECOMPOSITION

Prerequisites: all validated artifacts through `PRIMARY_QUESTIONS`.

Purpose: decompose each primary question into independently assessable capability subcriteria and independently executable anti-pattern tests.

Important sequencing rule: this task describes each atomic item's **evidence need semantically**, but it does not create final evidence objects or evidence IDs. Evidence IDs belong to the next task.

Capability atomic IDs are deterministic: `<capability>-SC-001..n`.
Anti-pattern atomic IDs are deterministic: `<anti-pattern>-AT-001..n`.

Completion checks require:

- sequential deterministic IDs;
- every atomic item references exactly one current primary question;
- all three primary questions are covered for both objects;
- no evidence IDs are invented at this stage.

Model role: `REASONER`.

## 6. EVIDENCE_ARCHITECTURE

Prerequisites: all validated artifacts through `ATOMIC_DECOMPOSITION`.

Purpose: define evidence objects and bind them to the validated atomic items.

Each evidence object owns:

- evidence ID;
- title;
- supported claim;
- evidence class;
- minimum technical assurance;
- required human assurance;
- acceptance conditions;
- limitations.

Capability evidence IDs are deterministic: `EVD-<capability>-001..n`.
Anti-pattern evidence IDs are deterministic: `EVD-<anti-pattern>-001..n`.

The task also creates explicit atomic-to-evidence bindings. Deterministic validation rejects unresolved evidence IDs, unused evidence objects, duplicate atomic binding objects and unknown atomic references. A separate cross-artifact gate compares the bindings against the actual validated `ATOMIC_DECOMPOSITION` artifact so no atomic item can disappear between steps.

This task does not author evidence ceilings, false-positive guards, prohibited inferences, contradiction rules, freshness rules, findings, source mappings or tactics.

Model role: `WORKHORSE`.

## 7. EVIDENCE_SAFETY

Prerequisites: all validated artifacts through `EVIDENCE_ARCHITECTURE`.

Purpose: define how evidence may and may not be interpreted.

Produces separate capability and anti-pattern rule families for:

- evidence ceilings;
- false-positive guards;
- prohibited inferences;
- contradiction handling;
- freshness rules.

The task must protect against unsupported assurance inflation, treating policy/document presence as implementation, inferring legal compliance, and especially inferring anti-pattern absence from silence or lack of discovered incidents.

The formal anti-pattern absence-test contract is **not** authored here; this step defines interpretation safeguards only.

Model role: `REASONER`.

## Deterministic completion rule

A task can be persisted as `COMPLETED` only when:

1. every required upstream task is already validated;
2. output satisfies the strict task-specific shape;
3. target IDs match orchestrator-supplied IDs;
4. capability and anti-pattern IDs form the exact pair;
5. deterministic identity/reference invariants for the task pass;
6. no undeclared output sections are returned.

For cross-artifact dependencies, deterministic graph checks compare the new artifact against the validated upstream artifact rather than relying on ID patterns alone.

If a completion schema has not yet been implemented for a task type, the gate fails closed.

## Prompt assembly

`src/cognitive/prompt-builder.ts` converts a Task Contract into a provider-neutral prompt packet. Provider adapters receive the same cognitive contract regardless of whether OpenAI, Grok or Kimi is selected by the model router.

This keeps provider choice separate from reasoning architecture.

## Implemented sequence

```text
PAIR_BOUNDARY
  -> AP_FAILURE_MODEL
  -> APPLICABILITY
  -> PRIMARY_QUESTIONS
  -> ATOMIC_DECOMPOSITION
  -> EVIDENCE_ARCHITECTURE
  -> EVIDENCE_SAFETY
```

## Next sequence

The next cognitive layer should continue in dependency order:

1. `SOURCE_MAPPING`
2. `FINDING_ARCHITECTURE`
3. `CONTROL_BOUNDARY`
4. `REFERENCE_MAPPING`
5. `PAIR_COHERENCE_REVIEW`

Source mapping must remain separate from evidence authoring: the evidence architecture defines **what evidence is required**, while source mapping defines **which approved normative sources support the governance knowledge claims and at which exact locators**.
