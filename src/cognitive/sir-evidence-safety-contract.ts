import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from './sir-initial-contracts.js';

export interface SirEvidenceRulesContent {
  evidenceCeilings: string[];
  falsePositiveGuards: string[];
  prohibitedInferences: string[];
  contradictionHandling: string[];
  freshnessRules: string[];
}

export interface SirEvidenceSafetyOutput {
  capabilityRules: SirEvidenceRulesContent;
  antipatternRules: SirEvidenceRulesContent;
  crossPairSafetyNotes: string[];
}

export interface SirEvidenceSafetySeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
  primaryQuestions: SirPrimaryQuestionsOutput;
  atomics: MaterializedSirAtomics;
  evidence: MaterializedSirEvidence;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirEvidenceSafetyContract(
  seed: SirEvidenceSafetySeed
): TaskContract<SirEvidenceSafetyOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:EVIDENCE_SAFETY:SIR`,
    taskType: 'EVIDENCE_SAFETY',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define semantic evidence-interpretation safeguards for the validated capability and anti-pattern evidence graph: evidence ceilings, false-positive guards, prohibited inferences, contradiction handling and freshness rules. Return rule content only; identity and canonical placement remain deterministic.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'AP_FAILURE_MODEL',
      'APPLICABILITY',
      'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION',
      'EVIDENCE_ARCHITECTURE'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      primary_questions: seed.primaryQuestions,
      capability_atomics: seed.atomics.capability,
      antipattern_atomics: seed.atomics.antipattern,
      capability_evidence: seed.evidence.capability,
      antipattern_evidence: seed.evidence.antipattern,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_SIR_PAIR_BOUNDARY',
      'VALIDATED_SIR_AP_FAILURE_MODEL',
      'VALIDATED_SIR_APPLICABILITY',
      'VALIDATED_SIR_PRIMARY_QUESTIONS',
      'VALIDATED_MATERIALIZED_SIR_ATOMICS',
      'VALIDATED_MATERIALIZED_SIR_EVIDENCE',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not create or rewrite evidence objects, atomic items or primary questions.',
      'Do not create canonical IDs, local handles or canonical references.',
      'Do not raise assurance beyond what an evidence item can establish.',
      'Do not treat policy or document presence alone as proof of implementation, testing or operational effectiveness.',
      'Do not treat missing incidents, complaints or discovered evidence as proof that the anti-pattern is absent.',
      'Do not infer legal compliance, legal applicability, residual-risk acceptance or lifecycle authorization.',
      'Do not define the formal TESTED_ABSENT contract here; AP_ABSENCE_CONTRACT owns that semantic decision.',
      'Do not create findings, source mappings, tactic mappings or lifecycle consequences.',
      'Do not copy rule counts or wording from the Golden reference unless independently justified by this category.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirEvidenceSafetyOutput',
      requiredFields: [
        'capabilityRules.evidenceCeilings',
        'capabilityRules.falsePositiveGuards',
        'capabilityRules.prohibitedInferences',
        'capabilityRules.contradictionHandling',
        'capabilityRules.freshnessRules',
        'antipatternRules.evidenceCeilings',
        'antipatternRules.falsePositiveGuards',
        'antipatternRules.prohibitedInferences',
        'antipatternRules.contradictionHandling',
        'antipatternRules.freshnessRules',
        'crossPairSafetyNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'ALL_EVIDENCE_RULE_FAMILIES_PRESENT',
      'NO_EMPTY_RULE_FAMILIES',
      'ANTI_PATTERN_ABSENCE_NOT_INFERRED_FROM_SILENCE',
      'NO_DOCUMENT_PRESENCE_EQUALS_IMPLEMENTATION',
      'NO_LEGAL_OR_LIFECYCLE_AUTHORIZATION_INFERENCE',
      'NO_CANONICAL_IDENTITY_FIELDS'
    ],
    dependencyPaths: ['sir.capability.evidenceRules', 'sir.antipattern.evidenceRules'],
    failureMode: 'FAIL_CLOSED'
  };
}
