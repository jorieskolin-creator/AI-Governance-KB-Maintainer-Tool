---
document_id: "solution-assurance-engine:A2"
kb_id: "solution-assurance-engine"
object_id: "A2"
object_type: "capability"
document_version: "1.0.0"
title: "AI suitability, proportionality and value hypothesis"
domain_id: "A"
domain_title: "Purpose, value, context, roles and classification"
pair_id: "PAIR-A2"
paired_object_id: "AP-A2"
language: "en"
schema_version: "1.0.0"
input_set_id: "d00823f467a916cb140bedb7c7c1ab4688ce2a7ceefd447b80c7b23b439effec"
creation_review_state: "READY_TO_DELIVER"
hub_approval_status: "NOT_GRANTED_BY_CREATOR"
is_synthetic: false
---

# A2 — AI suitability, proportionality and value hypothesis

| Metadata Field | Value |
| --- | --- |
| Document ID | `solution-assurance-engine:A2` |
| Object Type | `capability` |
| Document Version | `1.0.0` |
| Knowledge Base | Solution Assurance Engine Knowledge Base (`solution-assurance-engine`) |
| Domain | `A` — Purpose, value, context, roles and classification |
| Pair / Paired Object | `PAIR-A2` / `AP-A2` |
| Creation Review State | `READY_TO_DELIVER` *(Creation review state only; Knowledge Hub approval is `NOT_GRANTED_BY_CREATOR`)* |
| Criteria Baseline Locator | `PDF page 10 (A2 / AP-A2)` |
| Thinking Flow Baseline | `cognitive-model#A2 (A2-Q1, A2-Q2, A2-Q3)` (v3.1.0) |
| Pinned Input Set ID | `d00823f467a916cb140bedb7c7c1ab4688ce2a7ceefd447b80c7b23b439effec` |

## A2.DEF — Identity, definition, purpose, and scope

A2 (AI suitability, proportionality and value hypothesis) ensures the organization defines the business problem, affected process, and current-state non-AI baseline independently of AI, and demonstrates through a falsifiable value hypothesis that an AI mechanism is proportionate to expected benefits, total cost, operational burden, human impact, and risk. Within Domain A, A2 owns suitability, proportionality, and value justification, whereas A1 owns intended purpose and use boundaries, A3 owns value-chain role and accountability allocation, A4 owns legal and risk classification, and A5 owns lifecycle stage transition gating.

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

Requires attributable evidence across the assurance ladder: (1) a technology-neutral problem, baseline, and falsifiable value hypothesis specification (DECLARED); (2) a comparative alternatives and total-cost/risk trade-off analysis covering viable non-AI options (IMPLEMENTED / FORMALLY_APPROVED); and (3) representative trial and operational evaluation records demonstrating net value against pre-declared continuation and stop thresholds (TESTED / OPERATIONALLY_OBSERVED).

- Business cases or vendor proposals establish DECLARED intent only and never satisfy TESTED or OPERATIONALLY_OBSERVED assurance.
- Model benchmark accuracy or prompt/usage volume never substitutes for realized business, user, or risk-adjusted outcome evidence.

*Source citations: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]*

### Evidence Sufficiency Ceilings

- Problem and value-hypothesis statements establish DECLARED assurance only.
- Alternatives matrices and cost models establish IMPLEMENTED design analysis, not TESTED effectiveness.
- Executed representative trials establish TESTED assurance only for the evaluated system version and operating context.

## A2.INT — Interpretation rules, unknown/conflict handling, false-positive guards, and prohibited inferences

Where baseline measurements, non-AI alternative comparisons, or representative trial results are missing, incomplete, or contradictory, the affected A2 conclusion remains UNKNOWN (or NOT_SATISFIED where verified evidence demonstrates a material gap). Conflicting executive value claims and trial records are preserved for human governance adjudication rather than smoothed.

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

Applies across all seven canonical lifecycle stages: QUALIFICATION_AND_REGISTRATION (DECLARED / HUMAN_VALIDATED problem and baseline), DESIGN_AND_DEVELOPMENT (IMPLEMENTED / HUMAN_VALIDATED alternatives and trade-off analysis), VERIFICATION_AND_VALIDATION (TESTED / HUMAN_VALIDATED representative trial evidence), DEPLOYMENT (TESTED / FORMALLY_APPROVED continuation decision), OPERATION_AND_MONITORING (OPERATIONALLY_OBSERVED / HUMAN_VALIDATED sustained value monitoring), REVIEW_AND_EVALUATION (OPERATIONALLY_OBSERVED reassessment), and RETIREMENT (IMPLEMENTED / FORMALLY_APPROVED disengagement or decommissioning when value or proportionality fails).

## A2.REL — Related capability and anti-pattern links

A2 is paired with anti-pattern AP-A2 (AI-first solutionism or value theatre) under strict non-inverse assessment semantics, and connects to A1 (purpose boundary), A4 (classification), A5 (lifecycle gates), C2 (model/provider suitability), D2 (functional quality), and F4 (decision rights and authorization).

**Paired Object Independence Rule:** Not satisfying capability A2 does not establish presence of anti-pattern AP-A2; AP-A2 presence and tested absence are assessed independently.

| Target Object | Relationship | Assessment Independence & Meaning |
| --- | --- | --- |
| `AP-A2` | `PAIRED_ANTIPATTERN` | Paired anti-pattern assessed independently; an A2 gap does not automatically establish AP-A2 presence. |
| `A1` | `RELATED_TAXONOMY_OBJECT` | A1 defines the bounded intended purpose and use envelope that A2 evaluates for suitability, proportionality, and value. |
| `A5` | `RELATED_TAXONOMY_OBJECT` | A2 continuation and stop determinations feed lifecycle transition gating in A5. |

## A2.TAC — Associated tactics and non-activation boundary

Associated Tactic Playbook v1.0.0 entries (TAC-PURPOSE-A2-01, TAC-PURPOSE-A2-02, TAC-PURPOSE-A2-03) are object-level candidate remediation workstreams confirmed for the SAE reference case. Tactic selection or completion generates new evidence for reassessment only and confers zero automatic finding closure or customer activation authority in Creator.

| Tactic ID | Title | Version | Effective Status | Playbook Provenance | Completion Effect | Activation Authority | Scope & Boundary |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `TAC-PURPOSE-A2-01` | Establish a Technology-Neutral Problem, Baseline and Value Hypothesis | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Advisory tactic to establish a technology-neutral problem, baseline, and falsifiable value hypothesis; completion requires reassessment and never closes findings. |
| `TAC-PURPOSE-A2-02` | Conduct a Technology-Neutral Alternatives and Proportionality Assessment | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Advisory tactic to conduct a technology-neutral alternatives and proportionality assessment; completion requires reassessment and never closes findings. |
| `TAC-PURPOSE-A2-03` | Execute Representative Value Validation and Apply Governed Continuation/Stop Criteria | `1.0.0` | `OBJECT_LINK_ASSOCIATED` | `release=APPROVED; activation=PENDING_KB_FINDING_MAPPING` | `NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED` | `NONE_IN_CREATOR` | Advisory tactic to execute representative value validation and apply governed continuation/stop criteria; completion requires reassessment and never closes findings. |

## A2.SRC — Source-supported claims vs methodology interpretation

Distinguishes external registered source support (NIST AI RMF 1.0 MAP 1.3, MAP 1.4, MAP 3.1, MAP 3.2, MANAGE 1.1, MANAGE 2.1, MANAGE 2.2, MANAGE 2.4; Finnish Administrative Procedure Act 434/2003; OECD AI Principles 2024) from Solution Assurance Engine cognitive-model interpretations. ISO standards (SRC-ISO-42001-2023, SRC-ISO-23894-2023, SRC-ISO-42005-2025) are retained as metadata-and-locator-only boundaries without reproducing protected standard text, and EUR-Lex client-rendered shells without local PDF bindings remain explicitly outside passage-level claim support.

*Source citations: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]; [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]; [SRC-FI-ADMIN-LAW-434-2003 (434/2003, as amended) @ https://www.finlex.fi/fi/lainsaadanto/2003/434 :: Preamble]; [SRC-OECD-AI-PRINCIPLES-2024 (OECD/LEGAL/0449, amended 3 May 2024) @ https://legalinstruments.oecd.org/en/instruments/OECD-LEGAL-0449 :: Document body]*

### Sourced Claims (External Registered Publications)

- **`A2-CLM-001` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MAP 1.3 and MAP 1.4 establish that the organization's mission, relevant AI goals, and the business value or context of business use must be clearly defined or re-evaluated when assessing existing AI systems.
  - Applicability: Voluntary risk-management framework guidance (TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE); supports governance criteria without establishing binding legal compliance.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31]
- **`A2-CLM-002` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MAP 3, MAP 3.1, and MAP 3.2 require examining and documenting potential benefits of intended AI functionality alongside potential monetary and non-monetary costs resulting from expected or realized AI errors and trustworthiness limits compared against appropriate benchmarks.
  - Applicability: Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds comparative benefit, cost, and benchmark evaluation for A2-Q2.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32]
- **`A2-CLM-003` [SOURCE_SUPPORTED · AUTHORITATIVE_STANDARD_OR_GUIDANCE]:** NIST AI RMF 1.0 MANAGE 1.1, MANAGE 2.1, MANAGE 2.2, and MANAGE 2.4 address determining whether an AI system achieves its intended purposes and stated objectives and whether development or deployment should proceed, taking viable non-AI alternative systems, approaches, or methods into account, sustaining deployed value, and superseding, disengaging, or deactivating systems whose outcomes are inconsistent with intended use.
  - Applicability: Voluntary risk-management guidance (TIER_2_AUTHORITATIVE); grounds A2-Q2 non-AI alternatives comparison and A2-Q3 continuation/stop and disengagement gates.
  - Attribution: [SRC-NIST-AI-RMF (NIST AI 100-1, January 2023) @ https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37]

### Methodology Interpretations (Cognitive Model & Criteria Baseline)

- **`A2-MTH-001` [METHODOLOGY_INTERPRETATION]:** Under the Solution Assurance Engine cognitive model (v3.1.0), unverified value hypotheses cannot exceed DECLARED technical assurance, and missing trial or baseline evidence resolves to UNKNOWN rather than being averaged or assumed satisfied. *(Cognitive rules: `evidence_admissibility_and_ceilings`, `unknown_is_valid_non_compliant_result`, `human_authority_remains_outside_engine`; Questions: `A2-Q1`, `A2-Q2`, `A2-Q3`)*

## A2.REV — Unresolved items and creation-review metadata

Reviewed local SAE pilot reference document for A2 (v1.0.0). Creation review authorizes storage delivery of the reviewed Markdown bytes only; Knowledge Hub approval remains NOT_GRANTED_BY_CREATOR.

### Unresolved Items

- None recorded.

## A2.BIB — Source Bibliography and Usage Boundaries

| Source ID | Title | Edition / Version | Authority | Origin & Exact Locator | Extraction Status | Usage Policy, Applicability & Limitations |
| --- | --- | --- | --- | --- | --- | --- |
| `SRC-OECD-AI-PRINCIPLES-2024` | OECD AI Principles (updated 2024) | `OECD/LEGAL/0449, amended 3 May 2024` | `TIER_2_AUTHORITATIVE / INTERGOVERNMENTAL_POLICY_GUIDANCE` | `registered_url` — `https://legalinstruments.oecd.org/en/instruments/OECD-LEGAL-0449 :: Document body` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: OECD_ADHERENTS, GLOBAL_REFERENCE; Intergovernmental policy principles for trustworthy AI; use as voluntary policy guidance and do not represent them as legislation, certification criteria or proof of compliance.; None recorded |
| `SRC-FI-ADMIN-LAW-434-2003` | Hallintolaki (434/2003) — Administrative Procedure Act (esp. Chapter 8b) | `434/2003, as amended` | `TIER_1_NORMATIVE / LEGISLATION` | `registered_url` — `https://www.finlex.fi/fi/lainsaadanto/2003/434 :: Preamble` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: FI; Regulates automated administrative decision-making in Finland; relevant to lifecycle stage, purpose boundaries and role allocation for public-sector AI.; None recorded |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=32` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=31` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
| `SRC-NIST-AI-RMF` | Artificial Intelligence Risk Management Framework (AI RMF 1.0) | `NIST AI 100-1, January 2023` | `TIER_2_AUTHORITATIVE / GOVERNMENT_VOLUNTARY_GUIDANCE` | `registered_url` — `https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf#page=37` | `COMPLETE` | `PERMITTED_ATTRIBUTED_EXCERPT` — Jurisdictions: GLOBAL_REFERENCE; Voluntary risk-management guidance organized around GOVERN, MAP, MEASURE and MANAGE; it does not establish legal compliance or certification.; None recorded |
