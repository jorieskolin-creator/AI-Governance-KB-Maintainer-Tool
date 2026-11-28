---
document_id: "solution-assurance-engine:A2"
kb_id: "solution-assurance-engine"
object_id: "A2"
object_type: "capability"
document_version: "1.0.1"
title: "AI suitability, proportionality and value hypothesis"
domain_id: "A"
domain_title: "Purpose, value, context, roles and classification"
pair_id: "PAIR-A2"
paired_object_id: "AP-A2"
language: "en"
schema_version: "1.0.0"
input_set_id: "d00823f467a916cb140bedb7c7c1ab4688ce2a7ceefd447b80c7b23b439effec"
creation_review_state: "DRAFT_UNREVIEWED"
hub_approval_status: "NOT_GRANTED_BY_CREATOR"
is_synthetic: false
---

# A2 — AI suitability, proportionality and value hypothesis

| Metadata Field | Value |
| --- | --- |
| Document ID | `solution-assurance-engine:A2` |
| Object Type | `capability` |
| Document Version | `1.0.1` |
| Knowledge Base | Solution Assurance Engine Knowledge Base (`solution-assurance-engine`) |
| Domain | `A` — Purpose, value, context, roles and classification |
| Pair / Paired Object | `PAIR-A2` / `AP-A2` |
| Creation Review State | `DRAFT_UNREVIEWED` *(Creation review state only; Knowledge Hub approval is `NOT_GRANTED_BY_CREATOR`)* |
| Criteria Baseline Locator | `PDF page 10 (A2 / AP-A2)` |
| Thinking Flow Baseline | `cognitive-model#A2 (A2-Q1, A2-Q2, A2-Q3)` (v3.1.0) |
| Pinned Input Set ID | `d00823f467a916cb140bedb7c7c1ab4688ce2a7ceefd447b80c7b23b439effec` |

## A2.DEF — Identity, definition, purpose, and scope

A2 evaluates whether AI is suitable and proportionate for a defined problem. Record the current process, the affected users, and a measurable improvement over a non-AI baseline before committing to an AI approach. Compare the expected benefit with total cost, operating effort, human impact, and risk.

- Define the business problem, desired outcome, and non-AI baseline independently of model selection (A2-Q1).
- Compare the proposed AI mechanism against viable non-AI, rule-based, and lower-complexity alternatives across benefit, cost, risk, and operational burden (A2-Q2).
- Validate expected value through representative trials with pre-defined continuation and stop/disengagement criteria (A2-Q3).

*Questions: `A2-Q1`, `A2-Q2`, `A2-Q3` · Source citations: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]*

## A2.APP — Applicability and exclusions

Applies to all proposed and materially changed AI uses (instrument applicability: ALWAYS; human authority: GOVERNANCE). Assessment depth scales with autonomy, affected-person exposure, cost, operational dependency, and reversibility. Reassessment is triggered whenever business-case assumptions, baseline comparisons, cost/risk thresholds, or continuation/stop criteria materially change.

- No blanket exemption applies merely because an AI feature is embedded, pre-licensed, low-cost, or labeled experimental.
- ISOLATED_SANDBOX and CONTROLLED_PILOT are operating-boundary environments, not lifecycle stages; progression from pilot to production requires evidenced value and proportionality verification.

## A2.CRI — Criteria, primary questions, and interpretation dimensions

Evaluates A2 across the three Solution Assurance Engine evidence dimensions: Definition and Intent (A2-Q1), Implementation and Operation (A2-Q2), and Evidence and Effectiveness (A2-Q3), grounded in Categories and Anti-Patterns v1.1 (PDF page 10) and Thinking Flow v3.1.0.

- Capability indicators from PDF page 10: Non-AI baseline exists; Value metrics and owners are named; Cost and operational consequences are considered; Continuation and stop criteria are enforced.

*Questions: `A2-Q1`, `A2-Q2`, `A2-Q3`*

### Primary Assessment Questions

| Question ID | Dimension | Primary Question | Assessment Guidance |
| --- | --- | --- | --- |
| `A2-Q1` | `DEFINITION_AND_INTENT` | Is the problem, desired outcome and measurable value hypothesis defined independently of the AI solution? | Verify that the business problem, target outcome, non-AI baseline, and falsifiable value hypothesis with named owners and thresholds are documented independently of AI model selection. |
| `A2-Q2` | `IMPLEMENTATION_AND_OPERATION` | Has the chosen AI approach been compared with simpler alternatives and implemented with explicit cost-risk trade-offs? | Verify that viable non-AI, rule-based, and simpler alternatives were compared on consistent benefit, total-cost, human-impact, reversibility, and risk criteria. |
| `A2-Q3` | `EVIDENCE_AND_EFFECTIVENESS` | Do representative trials show sufficient value and feasibility to justify progression, with stop criteria applied? | Verify that representative trials and operating records demonstrate sufficient net value and feasibility, and that explicit continuation/stop criteria are enforced by accountable governance authority. |

## A2.EVI — Evidence requirements and sufficiency boundaries

A dated problem statement, baseline, named owner, and measurable value hypothesis document the proposal. A comparison using like-for-like volume, quality, costs, and operating conditions demonstrates that alternatives were evaluated. Representative trials can establish measured value for the version and scope evaluated. Retain the baseline, trial results, thresholds, and the record of how the decision owner applied them.

- Compare outcomes on the same scope and workload. For example, measure median handling time for the existing workflow and the AI-assisted workflow while tracking correction effort and error rates for both.
- A business case supports declared intent. A comparison table documents design analysis. Measured outcomes require attributable results from an executed evaluation.

*Source citations: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]*

### Evidence Sufficiency Ceilings

- Problem and value-hypothesis statements establish DECLARED assurance only.
- Alternatives matrices and cost models establish IMPLEMENTED design analysis, not TESTED effectiveness.
- Executed representative trials establish TESTED assurance only for the evaluated system version and operating context.

## A2.INT — Interpretation rules, unknown/conflict handling, false-positive guards, and prohibited inferences

Record UNKNOWN for the affected question when the baseline, alternatives analysis, or outcome evidence is missing or materially contradictory. Record NOT_SATISFIED where verified evidence establishes a shortfall. For example, a failed continuation threshold and a traceable decision to stop can support the operation of the stop control while leaving the value hypothesis unvalidated.

*Questions: `A2-Q1`, `A2-Q2`, `A2-Q3`*

### Unknown Handling

- Missing baseline data, uncompared non-AI alternatives, or unexecuted trials keep A2 UNKNOWN rather than SATISFIED, without automatically implying AP-A2 is CONFIRMED_PRESENT.

### Contradiction Handling

- Conflicting business-case projections and negative trial or operational cost/risk records keep A2 UNKNOWN until human governance adjudication.

### False-Positive Guards

- Do not treat model benchmark scores, token/query volume, or slide-deck ROI projections as evidence of realized value or proportionality.
- Do not treat a comparison solely between different LLM vendors as a technology-neutral alternatives assessment.

### Prohibited Inferences

- Do not infer AP-A2 presence solely because A2 is NOT_SATISFIED or UNKNOWN.
- Do not infer legal or regulatory compliance from satisfying A2.
- Do not infer production value from an unconstrained prototype demo.

### Human Decision Boundaries

- Accountable GOVERNANCE and business/risk owners retain authority to approve value thresholds, adjudicate conflicting trial evidence, accept residual risk, and authorize progression or stop/retirement.

## A2.LIF — Lifecycle assurance expectations

At qualification, capture the problem, baseline, owner, and expected outcome. At design, compare feasible AI and non-AI approaches. At verification, run a representative evaluation against pre-agreed thresholds. At deployment, record the accountable decision. In operation and review, remeasure value, burden, and harm. At retirement, retain the evidence and decision to withdraw the solution.

## A2.REL — Related capability and anti-pattern links

A1 defines the intended use. A2 evaluates whether the intervention is justified within that boundary. A5 governs the transition decision informed by the A2 evidence. Evaluate the paired AP-A2 independently.

**Paired Object Independence Rule:** Not satisfying capability A2 does not establish presence of anti-pattern AP-A2; AP-A2 presence and tested absence are assessed independently.

| Target Object | Relationship | Assessment Independence & Meaning |
| --- | --- | --- |
| `AP-A2` | `PAIRED_ANTIPATTERN` | Paired anti-pattern assessed independently; an A2 gap does not automatically establish AP-A2 presence. |
| `A1` | `RELATED_TAXONOMY_OBJECT` | A1 defines the bounded intended purpose and use envelope that A2 evaluates for suitability, proportionality, and value. |
| `A5` | `RELATED_TAXONOMY_OBJECT` | A2 continuation and stop determinations feed lifecycle transition gating in A5. |

## A2.TAC — Associated tactics and non-activation boundary

The associated Playbook tactics address problem and baseline definition, comparison of alternatives, and value validation. Tactic completion produces evidence for reassessment. Governance owners retain decision authority.

| Tactic ID | Title | Version | Effective Status | Playbook Provenance | Completion Effect | Activation Authority | Scope & Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TAC-PURPOSE-A2-01` | Establish a Technology-Neutral Problem, Baseline and Value Hypothesis | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Advisory tactic to establish a technology-neutral problem, baseline, and falsifiable value hypothesis; completion requires reassessment and never closes findings. |
| `TAC-PURPOSE-A2-02` | Conduct a Technology-Neutral Alternatives and Proportionality Assessment | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Advisory tactic to conduct a technology-neutral alternatives and proportionality assessment; completion requires reassessment and never closes findings. |
| `TAC-PURPOSE-A2-03` | Execute Representative Value Validation and Apply Governed Continuation/Stop Criteria | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Advisory tactic to execute representative value validation and apply governed continuation/stop criteria; completion requires reassessment and never closes findings. |

## A2.SRC — Source-supported claims vs methodology interpretation

NIST AI RMF 1.0 provides voluntary guidance for documenting business value, comparing benefits and costs, and making continuation decisions. SAE interpretation and evidence ceilings follow the assessment criteria and Thinking Flow.

*Source citations: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]*

### Sourced Claims (External Registered Publications)

- **`A2-CLM-001` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MAP 1.3 and MAP 1.4 call for documenting organizational AI goals and defining the value or context of business use. For an existing system, the business value or use context is re-evaluated.
  - Applicability: Voluntary risk-management framework guidance (TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE); supports governance criteria without establishing binding legal compliance.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]
- **`A2-CLM-002` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MAP 3.1 and MAP 3.2 call for examining and documenting potential benefits and costs, including non-monetary costs linked to functionality, errors, and trustworthiness. MAP 3 places this work in the context of appropriate benchmarks.
  - Applicability: Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds comparative benefit, cost, and benchmark evaluation for A2-Q2.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]
- **`A2-CLM-003` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MANAGE 1.1, MANAGE 2.1, MANAGE 2.2, and MANAGE 2.4 address determining whether an AI system achieves its intended purposes and stated objectives and whether development or deployment should proceed, taking viable non-AI alternative systems, approaches, or methods into account, sustaining deployed value, and superseding, disengaging, or deactivating systems whose outcomes are inconsistent with intended use.
  - Applicability: Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds A2-Q2 non-AI alternatives comparison and A2-Q3 continuation/stop and disengagement gates.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]

### Methodology Interpretations (Cognitive Model & Criteria Baseline)

- **`A2-MTH-001` [METHODOLOGY_INTERPRETATION]:** Under the Solution Assurance Engine cognitive model (v3.1.0), unverified value hypotheses cannot exceed DECLARED technical assurance, and missing trial or baseline evidence resolves to UNKNOWN rather than being averaged or assumed satisfied. *(Cognitive rules: `evidence_admissibility_and_ceilings`, `unknown_is_valid_non_compliant_result`, `human_authority_remains_outside_engine`; Questions: `A2-Q1`, `A2-Q2`, `A2-Q3`)*

## A2.REV — Unresolved items and creation-review metadata

Assess against the selected criteria and source edition. Review for delivery is pending.

### Unresolved Items

- None recorded.

## A2.BIB — Source Bibliography and Usage Boundaries

| Source ID | Title | Edition / Version | Authority | Origin & Exact Locator | Extraction Status | Usage Policy, Applicability & Limitations |
| --- | --- | --- | --- | --- | --- | --- |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
