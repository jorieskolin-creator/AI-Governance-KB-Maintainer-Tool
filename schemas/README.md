# Schema Baseline

Production validation is based on the approved schema family selected by the frozen authoring baseline.

Repository baseline files:

- `capability.schema.json`
- `antipattern.schema.json`
- `shared-definitions.schema.json`

## Capability and anti-pattern schemas

The capability and anti-pattern schemas are the supplied version 2.1.0 examples and are retained as the baseline rather than redesigned unnecessarily.

## Shared definitions

`shared-definitions.schema.json` resolves the common `$ref` contracts used by both supplied schemas. It is derived from the structures and controlled values demonstrated by the supplied A1/AP-A1 canonical JSON examples and the authoring baseline.

The shared schema is deliberately strict for stable structures such as:

- A-F and pair ID formats;
- semantic versioning;
- question dimensions;
- evidence-assurance states;
- human-assurance states;
- lifecycle-stage vocabulary;
- approval-record structure;
- applicability structure;
- evidence rules;
- findings;
- runtime decision boundaries.

It deliberately avoids inventing narrow source/legal taxonomies where the supplied examples do not establish a closed vocabulary. Those constraints belong in the Global Source Register and deterministic source validators.

## Runtime validation boundary

The application must store the selected schema version and SHA-256 hashes in the baseline snapshot. A newly produced object's `schema_version` must match the schema baseline selected for that run.

JSON Schema validates object structure. Cross-object graph integrity remains deterministic application logic, including:

- finding -> atomic item -> evidence resolution;
- pair-ID coherence;
- source-register ID and locator resolution;
- reciprocal tactic mappings;
- version and release integrity;
- approved-content/publication parity.
