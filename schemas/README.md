# Schema Baseline

Production validation is based on the approved schema family selected by the frozen authoring baseline.

Expected baseline files:

- `capability.schema.json`
- `antipattern.schema.json`
- `shared-definitions.schema.json`

The supplied capability and anti-pattern schemas are version 2.1.0 and are intended to be retained rather than redesigned unnecessarily. The shared-definitions schema is required because both schemas reference it extensively.

The application must store the selected schema version and SHA-256 hashes in the baseline snapshot. Object `schema_version` must match the schema baseline selected for the run.

Cross-object graph integrity (for example finding -> atomic item -> evidence, source-register resolution and reciprocal tactic mappings) is enforced by deterministic validators outside JSON Schema.
