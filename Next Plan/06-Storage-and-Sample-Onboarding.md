# Vercel readiness and sample onboarding

## 1. Owner decisions

- The owner prepares the Vercel storage layout and places input materials there before KB Document Creator starts generation.
- Vercel holds both the runtime inputs and generated documents. Google Drive has no role in this implementation.
- The first real KB is the owner's Solution Assessment Engine reference case. Supplied materials may use the name Solution Assurance Engine; preserve their actual names, object IDs, and relationships in the configured SAE profile.
- The owner will share representative materials with Augment Code. Those samples establish the expected input structure and reading behavior. They are development references; the operational application reads the selected Vercel objects.
- The Golden Reference consists of one capability and its paired anti-pattern. It establishes the expected quality and structure without prescribing identical wording or counts for other objects.
- The owner has confirmed the supplied SAE Tactic Playbook is final even if older incomplete-approval wording appears inside it. That wording alone is not a creation blocker or a reason to seek approval again.

This plan does not inventory or judge previously created documentation. Inspect the actual supplied samples and configured Vercel input set when implementing the readers.

## 2. Responsibility split

| Owner prepares | Augment implements | KB Document Creator does at runtime |
| --- | --- | --- |
| Vercel store, access policy, and logical folder/prefix layout | Named connection configuration and scoped adapters | Checks the configured store identity and access |
| Schemas and document requirements | Schema readers and internal validation | Loads the selected schemas; reports missing or incompatible inputs |
| Source Register and taxonomy/criteria | Readers preserving source and criterion identities | Loads and cross-checks coverage and relationships |
| Cognitive model | Reader preserving reasoning/evidence distinctions | Uses it as document requirements, not a customer-analysis pipeline |
| Final Tactic Playbook and explicit links | Reader for actual sample shape plus scoped owner-decision handling | Uses the supplied links; detects missing targets without inventing them |
| Golden Reference capability/anti-pattern pair | Sample adapters and quality evaluation | Loads both files and uses them as references |
| Output/operations prefixes and credentials through secret configuration | Scoped writer, path validation, retry and receipt logic | Writes reviewed documents and operational records only |

The Creator does not upload or reorganize the input corpus, create a Source Register, create a Master Table, or change Hub approval status. A missing file is shown with its expected role/path so the owner can supply it.

## 3. Sample-to-contract matrix for Augment

During DC-00/DC-01, complete this matrix from the supplied examples. Do not prefill facts from older repository versions.

| Input role | Record from actual sample | Required adapter result |
| --- | --- | --- |
| Source Register | File format, source IDs, editions, publisher/location, scope/coverage, usage metadata | Normalized source identities and registered source-content locations |
| Taxonomy and per-object criteria | Domain/object IDs, capability/AP pairing, questions/criteria, cross-links | Exact requested object set and relationship graph |
| Cognitive model | Sections, evidence dimensions, unknown handling, interpretation boundaries | Traceable document-content requirements |
| Tactic Playbook | Tactic IDs, linked capabilities/APs, relationship scope, activities and conditions | Faithful tactic content and links, with applicable owner decision |
| Schemas | Format, versions, required fields/sections, reference dependencies | Validated templates and content checks |
| Golden capability | File format, headings, citation style, evidence detail | Structure/depth reference for capability outputs |
| Golden anti-pattern | Pair ID, failure/absence logic, headings, reference style | Structure/depth reference for AP outputs |

For each row, also record its Vercel object path, content hash, extraction method, and any normalization rules. Write adapters only for observed formats needed by the reference case. JSON is suitable for internal normalized contracts but is not a requirement to rewrite all source inputs. If a sample contains a visual table or diagram with essential meaning, explicitly verify its extraction rather than assuming text extraction captured it.

Test fixtures should exercise these actual shapes without publishing restricted owner materials to a public repository. Use permitted examples or faithful synthetic fixtures where required. Preserve the distinction between synthetic parser tests and live source-supported creation.

## 4. Runtime configuration and readiness

The deployment needs a named Vercel connection, credential secret reference, configured input-set manifest/configuration path, and allowed output/operations prefixes. The owner prepares the manifest or supplies equivalent paths through configuration; neither is a Master Table.

Before generation:

1. Resolve the expected store identity and authorized root/prefix map.
2. Read the selected input manifest/configuration from Vercel and resolve every required role to an exact object, including both Golden Reference documents.
3. Read and hash the actual bytes; validate format and required schema dependencies. Do not trust a reported hash without comparing it to the bytes.
4. Parse using the sample-derived adapters. Cross-check taxonomy, criteria, source coverage, and playbook link targets.
5. Apply recorded owner decisions to their exact inputs. For the supplied final SAE playbook, preserve original wording as provenance and use the owner-confirmed effective status. This does not invent missing links, legal applicability, or customer-specific activation.
6. Validate the configured write destination and taxonomy-to-prefix mapping. Do not require a literal empty folder object: Blob folders are logical prefixes. Do not create or rearrange the owner's input structure.
7. Show a concise ready/not-ready result and exact gaps. Model authoring starts only when required inputs and destination readiness pass.

An unavailable input leaves the application usable for configuration and diagnostics but blocks the dependent run. Never fall back to bundled repository documents, old cached versions, or local development samples without an explicitly selected matching input set. A cache may serve only verified bytes for the pinned version/hash under the configured policy.

Pin the complete resolved input set before generation. If storage files change later, continue only with the already captured verified bytes; if those bytes are unavailable, pause rather than mix editions. A new input version starts a new input set.

## 5. Access and writes

Read access applies to inputs, schemas, and Golden Reference prefixes. Write access is required only for generated documents, optional private drafts, and operational receipts in the agreed areas. Enforce these scopes in application code even where a credential technically permits broader access. Do not require unrelated repository write or Google Drive credentials.

Any connectivity write probe belongs in an explicitly configured disposable output prefix and must be cleaned up. Never test writes by altering an input file. Do not expose secrets or expiring signed URLs in generated documents.

External source-publication URLs in the Source Register remain usable under acquisition policy. This is source research for grounding, not an alternative production input store. The prepared register/cognitive model/taxonomy/playbook/schemas/Golden pair still come from Vercel.

## 6. First reference-case demonstration

Use the owner-prepared SAE input set to generate a pair different from the Golden Reference pair. Demonstrate that the documents follow the supplied schemas, cognitive distinctions, criterion meanings, source support, and actual tactic relationships. Verify that the original Vercel input files remain byte-identical after generation and delivery.

Only then expand to the rest of the SAE taxonomy. A small second test profile demonstrates reuse; building a second real KB is not a prerequisite for proving this reference case.
