# SAE training baseline

This inventory pins the materials found for the Solution Assurance Engine (SAE) authoring exercise. It covers source selection, all 180 primary questions, the cognitive model, tactic selection, and a Golden Reference pair. [Input inventory](input-inventory.json) records the exact files, their SHA-256 hashes, and where they came from. The first pilot explicitly selects this inventory as its local baseline. Production must use an explicitly configured input set; this folder is not a fallback. [Creator input contract](../../Next%20Plan/02-Contracts.md#5-storage-contract-and-taxonomy-based-structure)

## Inputs and references

| Role | File and verification |
| --- | --- |
| Source Register | [Global Source Register v1.5.0 JSON](../../AI_Governance_Global_Source_Register_v1.5.0.json) is byte-identical to Drive and registers 45 sources across six domains. The [PDF](references/AI_Governance_Global_Source_Register_v1.5.0.pdf) matches the upload and Drive. Check allowed source content and exact locators when authoring. |
| Taxonomy and criteria | [Taxonomy v2.0.0](../taxonomy-register.json) and [ID Register](../id-register.json) match Drive byte for byte. The [attached Categories and Anti-Patterns v1.1 PDF](criteria/AI_Governance_Categories_and_Anti-Patterns_v1.1.pdf) describes all 30 pairs, capability questions, anti-pattern indicators, and authoring rules. Drive has a 43-page rendering under the same name. This inventory uses the 44-page upload. Use the PDF as the criteria and indicator baseline, not as the new tool's release procedure. The [local assessment instrument](criteria/assessment-instrument-1.0.0-sae.1.json) contains 180 primary questions for 30 capabilities and 30 anti-patterns. Each question ID and text matches the cognitive model HTML. This revision drops a retired source link from the requirement records; no question or criterion changed. |
| Cognitive model | The [Thinking Flow](cognitive/Solution_Assurance_Engine_Thinking_Flow.html) describes cognitive contract 3.1.0 and ReadinessPackageV2 2.6.0. The HTML here is the published source from the [assessment engine repository](https://github.com/jorieskolin-creator/AI-Governance-Engine/blob/30772ccfc77cecc28e42790363536deccb7b3f49/docs/thinking-flow.html). Two Approved Knowledge Hub HTML entries report the same versions. The two Library copies independently match the Hub source hashes. The public engine copy has wording differences in its description, introduction, and footer. |
| Tactic Playbook | The [approved v1.0.0 catalog](../AI_Governance_Tactic_Playbook_v1.0.0.json) matches Drive byte for byte. Its 119 tactics have 216 explicit object links, all of which resolve to the 60 taxonomy objects. The [attached August 20 PDF](references/AI_Governance_Tactic_Playbook_Current_Candidate_Snapshot_2026-08-20.pdf) is the catalog's hash-matching source snapshot and retains its original candidate wording. The owner's final-use decision applies to the supplied playbook for this training case. Exact finding-level mappings remain pending in the catalog. |
| Schemas | The [Drive schema copies](schemas/) preserve the exact manifest-pinned capability, anti-pattern, and shared definitions files. The first two are JSON-equivalent to the repository copies. The Drive shared definitions differ from the same-version repository copy. The [Source Register](../../schemas/source-register.schema.json), [playbook](../../schemas/tactic-playbook.schema.json), and [validation report](../../schemas/validation-report.schema.json) schemas match Drive byte for byte. |
| Golden Reference | Drive's [A1](Samples/Golden/A1_v1.0.0.json), [AP-A1](Samples/Golden/AP-A1_v1.0.0.json) and [combined PDF](Samples/Golden/AI_Governance_KB_A1_AP-A1_v1.0.0.pdf) match the [Drive Golden manifest](Samples/Golden/golden-standard-manifest.json). Both JSON documents validate against the Drive schema family and cite registered source IDs. They use schema 2.1.0. All 11 finding-level tactic references resolve exactly against the recovered [historical catalog v1.8.0](Samples/Golden/historical/AI_Governance_Global_Tactic_Catalog_v1.8.0.json). The [historical Git fixtures](../../golden/fixtures/) use 2.0.0. Use the Drive pair to calibrate structure and depth, and select a different pair for the first generation exercise. |

## Samples

[Samples](Samples/) contains eight recovered capability and anti-pattern pairs for calibration. File versions and approval fields record the original releases and are retained for provenance only.

| Pairs | Sample files |
| --- | --- |
| A1 / AP-A1 | [Golden Reference](Samples/Golden/) |
| A2, A3, A4, A5 and their anti-patterns | [Domain A samples](Samples/A/) and the [historical coverage report](Samples/A/AI_Governance_Domain_A_Coverage_Report_v1.0.0.json) |
| B1, B2 and their anti-patterns | [Domain B samples](Samples/B/) |
| D3 / AP-D3 | [Domain D samples](Samples/D/) and the catalog used for the archived D3 release |

## Knowledge Base test-run output

[knowledge-base](knowledge-base/) starts with empty output folders for [A](knowledge-base/A/), [B](knowledge-base/B/), [C](knowledge-base/C/), [D](knowledge-base/D/), [E](knowledge-base/E/) and [F](knowledge-base/F/). The `.gitkeep` files preserve the directory structure in Git.

Start with one fresh non-Golden pair. After it passes local review and delivery, expand toward all 30 pairs, including those with prior samples. Put reviewed Markdown under the relevant domain directory; keep receipts under `_operations/`. Automated tests use temporary directories. Do not use Vercel for this pilot.

## Gaps that affect use

- **Catalog versions.** The Golden pair uses `GOV-PUR-001` through `GOV-PUR-004`. The recovered [release manifest](Samples/Golden/historical/A1_AP-A1_release_manifest_v1.0.0.json) pins the original catalog v1.8.0 and Source Register v1.4.0 bytes, and all 11 Golden tactic references are reciprocal in that catalog. For new documents use the selected v1.0.0 playbook and its explicit object links. Any request to carry forward exact historical finding-level links would need a verified crosswalk to the selected catalog.
- **Shared schema.** The Drive Golden pair passes the Drive schema set. The current root shared definitions reject each document with six errors covering missing `supported_claim`, `applicability_conditions`, and `exclusions` in source mappings. Use the pinned Drive family for this calibration exercise.
- **Criteria and source support.** The criteria are in the supplied PDF; the Thinking Flow supplies the questions and interpretation rules. The instrument's empty arrays for atomic subcriteria/tests and evidence rules are not missing inputs. Creator drafts those details where the template requires them. Empty `sourceIds` mean no preselected mappings; choose relevant publications from the Source Register and use their actual passages.
- **Registered publication content.** For the pilot, follow the register's official links to permitted content and record edition and locators. File-based sources must be PDFs already present in `references/` and explicitly bound to a selected register entry, edition and hash. The existing register and playbook PDFs are companion inputs, not publication evidence. See the [onboarding and review notes](../../Next%20Plan/06-Storage-and-Sample-Onboarding.md).

The [historical Golden dependencies](Samples/Golden/historical/) and current playbook serve separate release contexts. The [six-tactic D3 catalog](Samples/D/Governance_Tactic_Catalog_v1.1.0.json) is scoped to the archived D3 release.
