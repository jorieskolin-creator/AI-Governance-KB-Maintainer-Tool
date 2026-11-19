# Storage readiness and SAE sample onboarding

## 1. Owner decisions

- The first **Solution Assurance Engine (SAE)** pilot uses pre-staged local inputs and a local output folder. Select the [pinned inventory](../baseline/sae-training/input-inventory.json) explicitly and write reviewed Markdown only to [knowledge-base](../baseline/sae-training/knowledge-base/). The explicit pilot may read official Source Register URLs; do not use Vercel or Google Drive.
- For remote delivery later, the user supplies a location and access to a supported storage connection. Configure credentials server-side and constrain the writable scope; never infer permission from a link. There is no silent local fallback for remote runs.
- Use the A1 and AP-A1 Golden Reference pair for quality and structure only. Treat other recovered documents and historical catalog versions as calibration, not new-generation authorities.
- The owner has confirmed the selected SAE Tactic Playbook is final despite candidate wording in its source PDF. Bind the decision to the inventory's exact playbook version and hash. It covers explicit object links, not missing finding-level activation mappings.

## 2. Responsibility split

| Owner prepares | Augment implements | KB Document Creator does at runtime |
| --- | --- | --- |
| Selected local folder for the pilot; location and authorization for later remote use | Explicit local profile and scoped storage adapter | Checks the selected input paths and output scope |
| Schemas and document requirements | Schema readers and internal validation | Loads the selected schemas; reports missing or incompatible inputs |
| Source Register and taxonomy/criteria | Readers preserving source and criterion identities | Loads and cross-checks coverage and relationships |
| Cognitive model | Reader preserving reasoning/evidence distinctions | Uses it as document requirements, not a customer-analysis pipeline |
| Final Tactic Playbook and explicit links | Reader for actual sample shape plus scoped owner-decision handling | Uses the supplied links; detects missing targets without inventing them |
| Golden Reference capability/anti-pattern pair | Sample adapters and quality evaluation | Loads both files and uses them as references |
| Output/operations boundaries and, for remote use, credentials through secret configuration | Scoped writer, path validation, retry and receipt logic | Writes reviewed documents and operational records only |

The Creator does not upload or reorganize the input corpus, create a Source Register, create a Master Table, or change Hub approval status. A missing file is shown with its expected role/path so the owner can supply it.

## 3. Sample-to-contract matrix for Augment

The inventory records exact file paths, versions, and SHA-256 hashes for these roles. Use explicit role selection; do not scan the corpus for a substitute.

| Inventory roles | Supplied sample and verification | Required adapter result |
| --- | --- | --- |
| `source-register` + `source-register-schema` | v1.5.0 JSON has 45 unique source records with official HTTPS locations. The companion PDF is the register, not the publications. | Preserve edition/date, authority, usage restrictions and coverage. Read permitted passages at official registered locations, or use an explicitly bound PDF from `references/`. |
| `criteria-reference` | The Categories and Anti-Patterns v1.1 PDF defines the criteria for all 30 pairs. For example, page 10 defines A2 applicability, capability indicators and AP-A2 indicators. | Extract the selected pair's criteria with page/section locators. Do not implement the PDF's legacy release process or use its embedded source list as the active register. |
| `taxonomy` + `id-register` + `criteria-instrument` | Taxonomy v2.0.0, ID Register v2.1.0 and local instrument revision `1.0.0-sae.1` contain 6 domains, 30 pairs and 180 unique primary questions. `CTRL-*` and `REQ-*` are instrument IDs, not document IDs. | Map controls via `authoringObjectId`, anti-patterns via their own `id`, and preserve `pairedObjectId`, question IDs, dimensions and exact question text. Empty `sourceIds` specify no preset mapping. |
| `cognitive-model` | Thinking Flow HTML (contract 3.1.0) corroborates all 180 question IDs and texts. It describes definition vs implementation vs evidence, unknown and contradiction handling, tested absence, and human decision boundaries. | Read supplied static content inertly, preserving locators. Extract document requirements only; do not execute the assessment workflow. |
| `tactic-playbook` + `tactic-playbook-schema` | v1.0.0 JSON validates. Its 119 tactics declare 216 explicit links covering all 60 objects; the two representations of object links agree. No eligible finding IDs are assigned. The companion PDF matches the referenced source snapshot. | Normalize and validate exact object links and scope, preserving provenance and the owner decision. Keep activation out of Creator. |
| `capability-schema` + `antipattern-schema` + `shared-definitions` | AJV resolves the complete supplied v2.1.0 family and accepts both Golden objects. Substituting root shared definitions rejects both (six missing mapping-field errors each). | Pin `$id` and hash, load one consistent family offline, and distinguish calibration validation from the new Markdown content contract. |
| `golden-capability` + `golden-antipattern` | A1/AP-A1 v1.0.0 JSON and combined PDF. Both JSON samples validate; their exact citation locators and anti-pattern absence structure are examples, not new normative support. Four of their six question texts differ from the current instrument. | Calibrate detail, shape, and evidence boundaries; never copy old wording, approval or historical practice into current outputs. |

JSON is the primary machine-readable input for the register, taxonomy, instrument, playbook, and Golden pair. The four PDFs are text-extractable in this checkout; extraction success alone does not prove table fidelity. DC-02 should verify extraction of the actual criteria for the first pair rather than treating the criteria PDF as a companion only.

Test fixtures should exercise these actual shapes without publishing restricted owner materials to a public repository. Use permitted examples or faithful synthetic fixtures where required. Preserve the distinction between synthetic parser tests and live source-supported creation.

## 4. Runtime configuration and readiness

The local pilot requires an explicit inventory path and output root. A later remote setup additionally needs a supported named connection, location, and credential secret reference. Neither setup is a Master Table.

Before generation:

1. Confirm the selected input reader and allowed output root; do not accept arbitrary filesystem paths from a web client.
2. Read the selected inventory and resolve every required role to an exact file, including both Golden Reference documents.
3. Read and hash the actual bytes; validate format and required schema dependencies. Do not trust a reported hash without comparing it to the bytes.
4. Parse using the sample-derived adapters. Cross-check taxonomy, criteria, source coverage, and playbook link targets.
5. Apply recorded owner decisions to their exact inputs. For the supplied final SAE playbook, preserve original wording as provenance and use the owner-confirmed effective status. This does not invent missing links, legal applicability, or customer-specific activation.
6. Validate the configured `knowledge-base/` destination and taxonomy-to-path mapping without writing or rearranging inputs.
7. Show planning readiness separately from authoring and delivery readiness. Missing passage support is not a reason to hide a valid plan or mark its documents ready.

An unavailable input leaves the application usable for configuration and diagnostics but blocks the dependent run. Never fall back to bundled repository documents, old cached versions, or local development samples without an explicitly selected matching input set. A cache may serve only verified bytes for the pinned version/hash under the configured policy.

Pin the complete resolved input set before generation. If storage files change later, continue only with the already captured verified bytes; if those bytes are unavailable, pause rather than mix editions. A new input version starts a new input set.

## 5. Access and writes

Read access applies to inputs, schemas, and Golden Reference prefixes. Write access is required only for generated documents, optional private drafts, and operational receipts in the agreed areas. Enforce these scopes in application code even where a credential technically permits broader access. Do not require unrelated repository write or Google Drive credentials.

Any connectivity write probe belongs in an explicitly configured disposable output prefix and must be cleaned up. Never test writes by altering an input file. Do not expose secrets or expiring signed URLs in generated documents.

For the first pilot, use an explicit acquisition run to read relevant, permitted content at official registered URLs. If a source is file-based, its PDF must already be under `references/` and explicitly bound to a registered source ID, edition, hash and use rights. The existing register and playbook PDFs are companion inputs, not registered source publications. Automated verification mocks acquisition. A later remote storage connectivity test must use a separately authorized disposable output scope.

## 6. First reference-case demonstration

Generate and review one non-Golden pair. Demonstrate current question fidelity, cognitive distinctions, source support, and correct object-level tactic associations. Compare all pinned bytes before and after delivery. Only then expand toward 30 pairs. A small synthetic second profile demonstrates reuse without a second real KB.

## DC-00 review

- Reviewed `b047f8a` (PR #34): supplied assets and the output skeleton were added since the branding commit; the legacy runtime is unchanged. Recomputed SHA-256 for all 43 inventory file entries and 11 historical dependency entries; all matched. No generated files were present in `knowledge-base/`.
- `npm run verify` passed on Node 22.23.1 and disposable Postgres 16.15 bound to a temporary Unix socket: typecheck, 33 tests, build, and Golden regression. This does not prove fresh authoring. No application startup, live model calls, or storage API calls were made.
- **Ready for DC-01 local planning.** Do not import legacy startup behavior: bundled register load, legacy operator/register routes, boot drift check, legacy resume and shutdown reclamation. The Golden projection remains a legacy regression check, not proof that a fresh response changes output.
- **Owner clarification resolved the retired-source dependency.** The new local instrument revision removes the obsolete link from all 30 requirement records, without changing the questions or assigning substitute sources. Candidate sources come from the selected register.
- **Ready to implement source preparation, not yet ready to deliver.** The primary criteria are supplied. Where required, Creator develops detailed tests, evidence rules and finding definitions from the criteria PDF, Thinking Flow and relevant registered passages for review. Actual passage retrieval, edition, rights and support still need to be verified for the first pair. Do not request playbook reapproval or a historical finding-level crosswalk.
