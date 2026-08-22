# Golden reference fixtures

This directory contains the approved canonical A1/AP-A1 JSON objects used as a regression and quality-calibration reference.

Required fixtures:

- `A1_v1.0.0.json`
- `AP-A1_v1.0.0.json`

## Authority boundary

The A1/AP-A1 pair is **not a normative rulebook for all future categories**. It is an approved reference exemplar showing the intended level of semantic depth, traceability, evidence discipline, human/machine boundary clarity and publication completeness.

Mandatory requirements come from the active governed baseline, especially:

1. the approved Knowledge Base Production Contract;
2. the active capability, anti-pattern and shared-definitions schemas;
3. the Categories and Anti-Patterns taxonomy/boundary baseline;
4. the approved Source Register;
5. the approved Tactic Catalog when exact mappings are available.

A future object must not copy an A1/AP-A1 property merely because it appears in these fixtures unless that property or invariant is required by one of those normative sources. For example, the exact number of atomic items, evidence objects, findings, sources, tactic mappings, wording, severities and assurance values in A1/AP-A1 are category-specific examples unless separately required by the normative baseline.

## Integrity model

JSON whitespace and pretty-printing are not governance semantics. Therefore the regression harness verifies each fixture using a deterministic canonical JSON serialization and a **semantic SHA-256**. The SHA-256 of the original uploaded file bytes is retained separately in `golden-reference.manifest.json` as provenance.

This avoids a false production failure caused only by indentation, line endings or trailing whitespace while still detecting any semantic change to a field, value, array order or object content.

## Fixture rules

1. Preserve the approved semantic content and historical identity of these fixtures. Do not rewrite them to the current schema version.
2. Their historical `schema_version` remains `2.0.0`; new production objects bind explicitly to the active schema baseline (currently the 2.1.0 family).
3. Treat the fixture objects as immutable. A semantic change requires new versioned fixture names and an explicit manifest update.
4. The regression harness fails closed if either fixture is missing or its deterministic semantic hash changes.
5. Use the fixtures for semantic regression, structural coverage examples and mutation tests, but derive pass/fail rules from the normative baseline rather than from incidental A1/AP-A1 content.
6. Generated PDF/HTML/DOCX publications may be used for parity/reference checks, but canonical JSON remains the machine-readable reference authority for this pair.
