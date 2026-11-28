---
document_id: "solution-assurance-engine:AP-A2"
kb_id: "solution-assurance-engine"
object_id: "AP-A2"
object_type: "antipattern"
document_version: "1.0.1"
title: "AI-first solutionism or value theatre"
domain_id: "A"
domain_title: "Purpose, value, context, roles and classification"
pair_id: "PAIR-A2"
paired_object_id: "A2"
language: "en"
schema_version: "1.0.0"
input_set_id: "d00823f467a916cb140bedb7c7c1ab4688ce2a7ceefd447b80c7b23b439effec"
creation_review_state: "DRAFT_UNREVIEWED"
hub_approval_status: "NOT_GRANTED_BY_CREATOR"
is_synthetic: false
---

# AP-A2 — AI-first solutionism or value theatre

| Metadata Field | Value |
| --- | --- |
| Document ID | `solution-assurance-engine:AP-A2` |
| Object Type | `antipattern` |
| Document Version | `1.0.1` |
| Knowledge Base | Solution Assurance Engine Knowledge Base (`solution-assurance-engine`) |
| Domain | `A` — Purpose, value, context, roles and classification |
| Pair / Paired Object | `PAIR-A2` / `A2` |
| Creation Review State | `DRAFT_UNREVIEWED` *(Creation review state only; Knowledge Hub approval is `NOT_GRANTED_BY_CREATOR`)* |
| Criteria Baseline Locator | `PDF page 10 (A2 / AP-A2)` |
| Thinking Flow Baseline | `cognitive-model#A2 (AP-A2-Q1, AP-A2-Q2, AP-A2-Q3)` (v3.1.0) |
| Pinned Input Set ID | `d00823f467a916cb140bedb7c7c1ab4688ce2a7ceefd447b80c7b23b439effec` |

## AP-A2.DEF — Identity, definition, failure mechanism, and scope

AP-A2 examines whether a commitment to AI preceded a defined problem, whether viable alternatives were bypassed, and whether adoption or activity metrics were used in place of outcome evidence. It also covers continued progression after recorded results fail the agreed conditions.

- Detects pre-committed AI selection ahead of technology-neutral problem and baseline framing (AP-A2-Q1).
- Detects missing non-AI comparison or vanity activity metrics substituting for value (AP-A2-Q2).
- Tests presence of continued progression despite poor outcome evidence or verifies a current scoped absence test (AP-A2-Q3).

*Questions: `AP-A2-Q1`, `AP-A2-Q2`, `AP-A2-Q3` · Source citations: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]*

## AP-A2.IND — Observable indicators, triggering conditions, non-examples, and false-positive guards

Check the sequence of decisions and the measures used to justify them. Dated purchasing or delivery commitments, an alternatives review, and actual gate decisions are stronger evidence than retrospective descriptions.

- The use case starts with a predetermined AI solution
- No baseline or alternative comparison
- Activity metrics substitute for value
- Progress continues despite poor outcome evidence

**Failure mechanism:** Solution-first AI selection and activity-based value theatre bypass comparative alternatives analysis and conceal negative value, cost, or risk signals across lifecycle gates.

### Observable Indicators

- The use case starts with a predetermined AI solution
- No baseline or alternative comparison
- Activity metrics substitute for value
- Progress continues despite poor outcome evidence

### Non-Examples

- A time-boxed feasibility exercise starts with a candidate AI tool while leaving adoption undecided. Its charter defines the baseline, comparison, and stopping conditions, and those conditions govern the next decision.

### False-Positive Guards

- Do not classify a bounded, time-boxed technical feasibility spike as AP-A2 when it operates inside an isolated sandbox with explicit non-AI comparison and stop criteria.

## AP-A2.CRI — Criteria, primary questions, and evidence requirements

Assesses AP-A2 across AP-A2-Q1 (Definition and Intent), AP-A2-Q2 (Implementation and Operation), and AP-A2-Q3 (Evidence and Effectiveness).

*Questions: `AP-A2-Q1`, `AP-A2-Q2`, `AP-A2-Q3`*

### Primary Assessment Questions

| Question ID | Dimension | Primary Question | Assessment Guidance |
| --- | --- | --- | --- |
| `AP-A2-Q1` | `DEFINITION_AND_INTENT` | Does the case exhibit AI-first solutionism or value theatre: AI is adopted for novelty, availability or signalling without evidence that it is the best proportionate mechanism. | Inspect charter, intake, and procurement chronology to determine whether an AI solution was mandated before defining the problem, baseline, and measurable value hypothesis. |
| `AP-A2-Q2` | `IMPLEMENTATION_AND_OPERATION` | Do implemented workflows, data paths or operations show a predetermined AI solution, missing baseline comparison, or activity metrics substituting for value? | Inspect workflows, KPIs, and architecture records for missing non-AI comparisons or adoption/prompt counts used in place of outcome and risk metrics. |
| `AP-A2-Q3` | `EVIDENCE_AND_EFFECTIVENESS` | Does current evidence test presence or scoped absence of AI-first solutionism or value theatre, or does it remain unknown? | Inspect trial and gate records to determine whether progression continued after failed value thresholds, or verify a complete, current scoped absence test. |

## AP-A2.ABS — Presence interpretation, tested-absence requirements, and unknown handling

To establish TESTED_ABSENT, review dated decision and procurement records, the non-AI comparison, the outcome metrics, and the continuation decision for the same version and operating context. Record the evidence reviewed, date, scope, reviewer, and outcome. Keep a question UNKNOWN if that review cannot resolve it.

### Tested-Absence Requirements

- Reconcile decision chronology confirming problem and non-AI baseline preceded AI selection.
- Verify executed comparative analysis of viable non-AI/simpler alternatives (NIST AI RMF MANAGE 2.1).
- Verify complete disclosure of representative trial outcomes and enforced continuation/stop determinations (NIST AI RMF MANAGE 1.1 and MANAGE 2.4).

### Independent Unknown Handling

- When capability A2 is NOT_SATISFIED but AP-A2 chronology and trial evidence are missing, AP-A2 remains UNKNOWN rather than CONFIRMED_PRESENT or TESTED_ABSENT.

## AP-A2.CON — Contradictions, applicability/exclusions, and prohibited inferences

Trace each value claim to its metric and decision record. If a status report calls the initiative successful because usage grew while the evaluation missed its agreed outcome threshold, preserve both records and verify what the decision owner did. Evidence of continuation despite a verified shortfall supports the corresponding AP-A2 indicator.

### Contradiction Handling

- Where executive status reports claim value success but trial logs show unachieved thresholds, preserve the contradiction and evaluate the broader failure surface.

### Evidence Sufficiency Ceilings

- TESTED_ABSENT requires a complete, current, executed, and independently reviewed absence test; policy statements alone never establish TESTED_ABSENT.

### Prohibited Inferences

- Do not infer AP-A2 absence from silence, zero reported incidents, or lack of stakeholder complaints.
- Do not infer AP-A2 presence solely from an A2 capability documentation gap.

### Human Decision Boundaries

- The accountable governance owner adjudicates unresolved conflicts and decides whether to stop, contain, or requalify the initiative.

## AP-A2.REL — Paired capability relationship (non-inverse semantics)

Paired with capability A2 without automatic inverse assessment: failing A2 does not prove AP-A2 presence, and AP-A2 UNKNOWN does not satisfy A2.

**Paired Object Independence Rule:** Capability A2 being NOT_SATISFIED does not establish AP-A2 presence, and AP-A2 UNKNOWN does not satisfy A2.

| Target Object | Relationship | Assessment Independence & Meaning |
| --- | --- | --- |
| `A2` | `PAIRED_CAPABILITY` | Paired capability assessed independently; A2 NOT_SATISFIED never automatically implies AP-A2 presence. |

## AP-A2.LIF — Lifecycle assurance expectations

Review intent and selection chronology during qualification and design. At verification and deployment, compare recorded results with the thresholds and inspect the decision. Recheck the conclusion during operation, review, or retirement when changes affect the evidence or the decision.

## AP-A2.TAC — Associated tactics and non-activation boundary

The associated Playbook tactics include a decision reset where governing records show a solution-first commitment. Their outputs feed reassessment. Governance owners retain decision authority.

| Tactic ID | Title | Version | Effective Status | Playbook Provenance | Completion Effect | Activation Authority | Scope & Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TAC-PURPOSE-A2-01` | Establish a Technology-Neutral Problem, Baseline and Value Hypothesis | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Candidate object-level association from the selected Tactic Playbook; tactic selection or completion produces new evidence for reassessment only and never activates remediation or closes findings. |
| `TAC-PURPOSE-A2-02` | Conduct a Technology-Neutral Alternatives and Proportionality Assessment | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Candidate object-level association from the selected Tactic Playbook; tactic selection or completion produces new evidence for reassessment only and never activates remediation or closes findings. |
| `TAC-PURPOSE-A2-03` | Execute Representative Value Validation and Apply Governed Continuation/Stop Criteria | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Candidate object-level association from the selected Tactic Playbook; tactic selection or completion produces new evidence for reassessment only and never activates remediation or closes findings. |
| `TAC-PURPOSE-AP-A2-01` | Reset a Solution-First or Value-Theatre Decision and Requalify Progression | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Corrective decision reset tactic; completion yields new evidence for reassessment without automatic finding closure. |

## AP-A2.SRC — Source support, methodology interpretation, and unresolved items

Grounds anti-pattern evaluation in NIST AI RMF 1.0 MAP 1.4, MAP 3.1, MAP 3.2, MANAGE 1.1, MANAGE 2.1, and MANAGE 2.4 alongside Solution Assurance Engine tested-absence and contradiction rules.

*Source citations: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]*

### Sourced Claims (External Registered Publications)

- **`AP-A2-CLM-001` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MANAGE 1.1 calls for reviewing whether intended objectives are achieved and whether work should proceed. MANAGE 2.1 includes viable non-AI alternatives in risk management. MANAGE 2.4 addresses disengagement or deactivation when outcomes are inconsistent with intended use.
  - Applicability: Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds testing for solution-first progression and missing disengagement gates in AP-A2.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]
- **`AP-A2-CLM-002` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MAP 1.4 calls for defining or re-evaluating business value or use context. MAP 3.1 and MAP 3.2 call for examining potential benefits and costs, including non-monetary costs, while MAP 3 calls for appropriate benchmarks.
  - Applicability: Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds detection of missing baseline benchmarks and unexamined error/trustworthiness costs.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]

### Methodology Interpretations (Cognitive Model & Criteria Baseline)

- **`AP-A2-MTH-001` [METHODOLOGY_INTERPRETATION]:** Under Solution Assurance Engine tested-absence rules (cognitive contract v3.1.0), silence, missing complaints, or unexecuted discovery always resolves to UNKNOWN and never satisfies TESTED_ABSENT. *(Cognitive rules: `antipattern_tested_absence_required`, `false_positive_guards_and_prohibited_inferences`; Questions: `AP-A2-Q3`)*

## AP-A2.REV — Creation-review and version metadata

Assess against the selected criteria and source edition. Review for delivery is pending.

### Unresolved Items

- None recorded.

## AP-A2.BIB — Source Bibliography and Usage Boundaries

| Source ID | Title | Edition / Version | Authority | Origin & Exact Locator | Extraction Status | Usage Policy, Applicability & Limitations |
| --- | --- | --- | --- | --- | --- | --- |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
