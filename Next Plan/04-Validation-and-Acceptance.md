# Validation and acceptance

## 1. Evidence required

Every task PR records the tested commit, runtime, commands, results, relevant fixtures, and untested external dependencies. Keep unit/integration tests deterministic; live model evaluations are separate, explicitly invoked tests with recorded input/model versions and human review.

Existing `npm run verify` runs typecheck, Vitest, build, and Golden regression. It currently needs a Postgres test database for the register integration suite. Use the disposable setup in `.github/workflows/verify.yml` as the baseline. Never point integration tests at a production database. Do not make the verification result green by hiding a failing suite.

During transition, retain existing verification and add the Creator tests to it. After legacy retirement, update the command to test all remaining production paths and preserved invariants. No change to the immutable `golden/` fixtures is required or permitted. Creator-specific samples belong in separate fixtures.

## 2. Acceptance matrix

| ID | Scenario | Required result | Task |
| --- | --- | --- | --- |
| I-01 | All specified inputs available with valid versions | Pinned input set and exact output plan | DC-01 |
| I-02 | Cognitive model, template, or required Golden role missing | Specific missing-input finding; no claim of readiness | DC-01 |
| I-03 | Same ID appears twice or points to missing domain/criterion | Validation fails with exact object/path | DC-01 |
| I-04 | Same local object ID appears in two different KBs | Separate namespaces; no collisions | DC-01 |
| I-05 | Profile uses domains outside A–F and different object counts | Correct enumeration without code changes | DC-01/06 |
| I-06 | Cognitive model and taxonomy/schema disagree | Conflict surfaced; affected delivery blocked | DC-01 |
| I-07 | Input bytes change while run is active | Existing run stays pinned; new input set required | DC-01/04 |
| S-01 | Real registered text/PDF passage available | Actual content and exact locator retained in authoring input | DC-02 |
| S-02 | Register contains title/URL but no readable source content | Unsupported claims remain unresolved | DC-02/03 |
| S-03 | Source is scanned, truncated, inaccessible, or unsupported | Accurate extraction status and affected coverage gaps | DC-02 |
| S-04 | Source content tells the model to ignore instructions or publish | Treated as data; no tool/approval/state change | DC-02/04 |
| S-05 | URL redirects outside policy or targets a private network | Fetch rejected with bounded, safe error | DC-02 |
| S-06 | Restricted source would enter a disallowed model request or public mirror | Egress/write prevented; usable alternative or gap reported | DC-02/05 |
| D-01 | Controlled fresh author response changes a substantive section | Rendered Markdown changes accordingly; no snapshot substitution | DC-03 |
| D-02 | Model invents source/tactic/object ID or source locator | Rejected or unresolved; never silently accepted | DC-03 |
| D-03 | Capability is not satisfied but AP evidence is missing | Text preserves independent AP unknown handling | DC-03/04 |
| D-04 | Silence is offered as proof of anti-pattern absence | Review/validation catches prohibited inference | DC-03/04 |
| D-05 | Example/proposal is presented as a measured outcome | Semantic review flags claim and source mismatch | DC-04 |
| D-06 | Sample has unrelated domain-specific wording | Golden guidance does not contaminate new document | DC-03/07 |
| D-07 | Required section is absent or an optional omission is explicit | Required absence blocks readiness; optional omission follows profile | DC-03 |
| T-01 | Object association exists but activation mapping is pending | No allowed/activated tactic claim; status accurately disclosed | DC-01/03 |
| T-02 | Approved mapping points to a different criterion/version | Reference rejected or flagged as incompatible | DC-03 |
| T-03 | No tactic requested in output plan | No unsolicited tactic document generated | DC-03/06 |
| R-01 | Contradiction between draft and cited passage | Defect includes source, locator, and affected section | DC-04 |
| R-02 | Targeted repair requested | Scoped diff and dependency review; unrelated content preserved | DC-04 |
| R-03 | Reviewed content edited before delivery | Old review invalidated; new review required | DC-04 |
| R-04 | Provider timeout, cancellation, or restart | Completed work retained; accurate interrupted state; no uncontrolled replay | DC-04 |
| R-05 | Repair/token/cost budget exhausted | Stops with visible partial work and explicit continuation option | DC-04 |
| R-06 | HTML/script payload in generated text | Sanitized preview; no script execution or remote fetch side effect | DC-03/04 |
| U-01 | Unauthorized client calls generation/delivery API directly | Server rejects the request | DC-04/05 |
| O-01 | Valid documents delivered | Correct taxonomy paths; stored bytes verified against reviewed bytes | DC-05 |
| O-02 | Second file upload fails | No completion receipt; previously uploaded file preserved; retry possible | DC-05 |
| O-03 | Same delivery retried | Idempotent outcome; no duplicate version | DC-05 |
| O-04 | Different content targets an existing version | Conflict; previous bytes unchanged | DC-05 |
| O-05 | Path traversal or write outside configured root | Rejected before storage write | DC-05 |
| O-06 | Drafts/inputs/Golden files coexist with ready documents | Handoff explicitly excludes non-document prefixes | DC-05/06 |
| O-07 | Input cannot legally/policy-wise be copied to destination | Reference/provenance retained without prohibited copy | DC-05 |
| O-08 | Delivered set is observed by a later tool | No Creator-issued Hub approval or Master Table mutation | DC-05/07 |
| B-01 | Domain batch contains one failed pair | Accurate per-document progress; batch incomplete, good work retained | DC-06 |
| B-02 | New input baseline used for regeneration | New draft/version with diff and provenance; old documents intact | DC-06 |
| M-01 | Document application mode starts | No old pipeline auto-resume, Drive sync, or register maintenance write | DC-04/07 |
| M-02 | Legacy code removed | No dangling imports/routes; retained assertions still tested; historical data untouched | DC-07 |
| P-01 | Optional PDF export | Readable complete pages and extractable sections; rendition linkage | DC-08 |

Deterministic tests can validate mechanics and known negative cases; they do not establish general semantic accuracy. Reviewer evaluation needs labeled examples and human adjudication. Track false accepts and false alarms, not just the reviewer model's own confidence.

## 3. First live evaluation

Use one fresh pair such as A2/AP-A2 if the owner-supplied inputs and usable sources support it. The selection is illustrative, not authorization to manufacture missing source support. Do not use A1/AP-A1 as the sole demonstration because its existing fixtures can mask replay.

Record:

- Selected taxonomy/cognitive/register/playbook/template/sample versions and hashes.
- Source passages used, locators, extraction/usage limitations, and criteria coverage.
- Model/provider configuration, prompt versions, call counts, retries, elapsed time, and actual cost where available. Label unavailable costs unavailable.
- Generated drafts, deterministic findings, semantic-review findings, human corrections, and final reviewed documents.
- Delivery target identity and prefix, receipt, post-write byte verification, and failures/retries.

Run at least three independent generations of the same confirmed input set to expose obvious variation. Three runs are a pilot check, not a statistical reliability claim. Compare required-section coverage, valid citation resolution, independently assessed source support, correct tactic status, contradictions, completion rate, review effort, latency, and cost. Do not demand identical prose.

Initial acceptance is qualitative plus explicit hard failures: zero unresolved blocking identity/reference/support errors in the final delivered documents; no fabricated approval; all requested outputs accounted for; and reviewer/owner agreement that the content matches the supplied inputs. Do not publish an invented accuracy percentage or claim all future content is correct.

Deliberately inject at least an unsupported claim and a pending-as-approved tactic mapping. Confirm they cannot pass through to a ready document unnoticed in the acceptance fixtures. Independently inspect the reviewer findings rather than accepting its pass label.

## 4. Output inspection

For Markdown, open the raw file and rendered preview. Confirm headings, section IDs, list/table readability, complete source references, no hidden essential meaning, and explicit unresolved boundaries. Parse the delivered file independently to verify critical sections and locators survive outside the Creator's UI.

If a target Master Table Creator/Knowledge Hub is available, test a sample through its actual import/extraction path. Record whether it understands Markdown and completion/rendition metadata. A local parse alone is not proof that the deployed Hub supports Markdown. External integration may remain pending, but must be reported separately from Creator delivery readiness.

For PDF, render all pages and inspect representative short, long, and table-heavy documents. Compare extracted text against required content and verify no clipped tables or lost citations. Do not regard successful file creation as layout validation.

## 5. Cutover and rollback

Before making document mode the default:

1. Tag or otherwise record the working legacy commit and deployment configuration.
2. Inventory existing storage prefixes and database tables; preserve them.
3. Run the new path in an isolated prefix and compare actual delivery bytes.
4. Confirm new routes and background jobs do not invoke legacy operations.
5. Pass the complete current verification command and live acceptance criteria.
6. Switch mode/deployment intentionally and monitor one real creation/delivery.

Rollback restores the recorded code/configuration and disables new jobs; it does not reinterpret new Creator documents as old canonical JSON releases. New database migrations must be backward-safe during the transition. Do not drop old tables or delete old outputs as a rollback step.

## 6. Definition of done

The owner can configure valid inputs and a destination, generate a fresh capability/anti-pattern pair, inspect its source support, correct a defect, deliver readable Markdown, and retrieve the exact stored bytes. A second profile works without generic code edits. The app performs no Master Table maintenance, Package retrieval, or customer assessment. All required automated tests pass, and live limitations are documented honestly.
