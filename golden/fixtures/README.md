# Golden Standard fixtures

This directory is reserved for the exact approved canonical A1/AP-A1 JSON objects used as the Golden Standard regression anchor.

Required files:

- `A1_v1.0.0.json`
- `AP-A1_v1.0.0.json`

Rules:

1. Commit the approved canonical JSON byte-for-byte from the authoritative source. Do not reconstruct it from PDF/DOCX or a truncated viewer.
2. Preserve the historical `schema_version` and approval metadata exactly as published. These fixtures are historical approved artifacts, not objects to migrate silently to the current schema.
3. Once committed, treat these fixture files as immutable. A successor Golden Standard must use new versioned file names and explicit regression configuration.
4. The regression harness must fail closed when either canonical fixture is missing.
5. Generated publications may be used for parity checks, but the canonical JSON fixtures remain the semantic regression authority.

The current connected Drive Golden Standard folder contains the approved PDF/DOCX publication but does not expose the two canonical JSON files. Until the exact JSON files are available, the fixture import is intentionally incomplete rather than reconstructed.
