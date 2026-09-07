import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';

export interface SirPairBoundaryOutput {
  capability: {
    canonicalDefinition: string;
    governancePurpose: string;
    distinctClaim: string;
    ownedTopics: string[];
    excludedTopics: Array<{ criterionHandle: string; ownershipBoundary: string }>;
  };
  antipattern: {
    canonicalDefinition: string;
    pairedRelationship: string;
  };
  boundaryRationale: string;
}

export interface SirApFailureModelOutput {
  failureMechanism: string;
  triggeringConditions: string[];
  observableFailureSurfaces: string[];
  nonExamples: string[];
  distinctionFromCapabilityGap: string;
}

export interface SirApplicabilityItem {
  statement: string;
  conditions: string[];
  exclusions: string[];
  reassessmentTriggers: string[];
}

export interface SirApplicabilityOutput {
  capability: SirApplicabilityItem;
  antipattern: SirApplicabilityItem;
  consistencyNotes: string[];
}

export interface SirQuestionContent {
  slot: 1 | 2 | 3;
  question: string;
}

export interface SirPrimaryQuestionsOutput {
  capabilityQuestions: [SirQuestionContent, SirQuestionContent, SirQuestionContent];
  antipatternQuestions: [SirQuestionContent, SirQuestionContent, SirQuestionContent];
  coverageRationale: string;
}

export interface SirInitialSeedBase {
  authoringPlan: AuthoringPlan;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export interface SirApFailureSeed extends SirInitialSeedBase {
  pairBoundary: SirPairBoundaryOutput;
}

export interface SirApplicabilitySeed extends SirInitialSeedBase {
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
}

export interface SirPrimaryQuestionsSeed extends SirInitialSeedBase {
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
}

const CONTRACT_VERSION = '2.0.0';

function governedInputs(plan: AuthoringPlan) {
  return {
    authoring_plan_id: plan.planId,
    authoring_plan_sha256: plan.planSha256,
    pair_identity: {
      pair_id: plan.identity.pairId,
      capability_id: plan.identity.capabilityId,
      antipattern_id: plan.identity.antipatternId,
      domain: plan.identity.domain
    }
  };
}

export function buildSirPairBoundaryContract(
  seed: SirInitialSeedBase
): TaskContract<SirPairBoundaryOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.authoringPlan.identity.pairId}:PAIR_BOUNDARY:SIR`,
    taskType: 'PAIR_BOUNDARY',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define only the semantic ownership boundary of the capability and paired anti-pattern. Return meaning, not canonical identity or canonical references.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [],
    lockedInputs: {
      ...governedInputs(seed.authoringPlan),
      adjacent_criteria: seed.authoringPlan.adjacentCriteria,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: ['AUTHORING_PLAN', 'CATEGORY_BASELINE', 'ADJACENT_CRITERIA', 'GOLDEN_REFERENCE'],
    doNot: [
      'Do not output pairId, capabilityId, antipatternId, domain, schema version, release status or any other canonical root metadata.',
      'Do not generate canonical criterion IDs. Refer to adjacent criteria only by the supplied criterionHandle.',
      'Do not create canonical question, atomic, evidence, finding, source-mapping or tactic-mapping IDs.',
      'Do not author evidence, findings, source mappings, tactics or lifecycle consequences.',
      'Do not make legal applicability, compliance, approval or authorization conclusions.',
      'Do not redefine adjacent criteria; describe only the semantic boundary against them.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirPairBoundaryOutput',
      requiredFields: [
        'capability.canonicalDefinition',
        'capability.governancePurpose',
        'capability.distinctClaim',
        'capability.ownedTopics',
        'capability.excludedTopics',
        'antipattern.canonicalDefinition',
        'antipattern.pairedRelationship',
        'boundaryRationale'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'NONEMPTY_SEMANTIC_BOUNDARY',
      'ADJACENT_HANDLES_RESOLVE',
      'NO_CANONICAL_IDENTITY_FIELDS',
      'NO_OUT_OF_SCOPE_SECTIONS'
    ],
    dependencyPaths: [
      'sir.capability.canonicalDefinition',
      'sir.capability.governancePurpose',
      'sir.capability.distinctClaim',
      'sir.antipattern.canonicalDefinition'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildSirApFailureModelContract(
  seed: SirApFailureSeed
): TaskContract<SirApFailureModelOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.authoringPlan.identity.pairId}:AP_FAILURE_MODEL:SIR`,
    taskType: 'AP_FAILURE_MODEL',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define only the semantic anti-pattern failure mechanism and its distinguishing characteristics. Canonical anti-pattern identity is owned by the Authoring Plan and compiler.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY'],
    lockedInputs: {
      ...governedInputs(seed.authoringPlan),
      pair_boundary: seed.pairBoundary,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: ['AUTHORING_PLAN', 'VALIDATED_SIR_PAIR_BOUNDARY', 'CATEGORY_BASELINE', 'GOLDEN_REFERENCE'],
    doNot: [
      'Do not output canonical IDs or canonical references.',
      'Do not redefine the validated capability boundary.',
      'Do not author evidence, atomic tests, findings, source mappings or tactics.',
      'Do not infer anti-pattern presence or absence for any real system.',
      'Do not make legal non-compliance conclusions.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirApFailureModelOutput',
      requiredFields: [
        'failureMechanism',
        'triggeringConditions',
        'observableFailureSurfaces',
        'nonExamples',
        'distinctionFromCapabilityGap'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'FAILURE_MECHANISM_NONEMPTY',
      'NONEXAMPLES_PRESENT',
      'NO_CANONICAL_IDENTITY_FIELDS',
      'NO_EVIDENCE_OR_FINDING_CONTENT'
    ],
    dependencyPaths: ['sir.antipattern.failureMechanism'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildSirApplicabilityContract(
  seed: SirApplicabilitySeed
): TaskContract<SirApplicabilityOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.authoringPlan.identity.pairId}:APPLICABILITY:SIR`,
    taskType: 'APPLICABILITY',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define semantic applicability for the capability and anti-pattern as separate but coherent content objects. Identity and canonical placement remain deterministic.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL'],
    lockedInputs: {
      ...governedInputs(seed.authoringPlan),
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_SIR_PAIR_BOUNDARY',
      'VALIDATED_SIR_AP_FAILURE_MODEL',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not output canonical IDs or canonical root metadata.',
      'Do not redefine the capability distinct claim or anti-pattern failure mechanism.',
      'Do not create blanket exclusions unsupported by the category baseline.',
      'Do not determine legal applicability for a real assessed system.',
      'Do not author primary questions, evidence, findings, source mappings, tactics or lifecycle consequences.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirApplicabilityOutput',
      requiredFields: [
        'capability.statement',
        'capability.conditions',
        'capability.exclusions',
        'capability.reassessmentTriggers',
        'antipattern.statement',
        'antipattern.conditions',
        'antipattern.exclusions',
        'antipattern.reassessmentTriggers',
        'consistencyNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'APPLICABILITY_NONEMPTY',
      'REASSESSMENT_TRIGGERS_PRESENT',
      'PAIR_APPLICABILITY_COHERENCE',
      'NO_CANONICAL_IDENTITY_FIELDS'
    ],
    dependencyPaths: ['sir.capability.applicability', 'sir.antipattern.applicability'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildSirPrimaryQuestionsContract(
  seed: SirPrimaryQuestionsSeed
): TaskContract<SirPrimaryQuestionsOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.authoringPlan.identity.pairId}:PRIMARY_QUESTIONS:SIR`,
    taskType: 'PRIMARY_QUESTIONS',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Author only the wording of the three governed primary-question slots for the capability and anti-pattern. Slot dimensions and future canonical question IDs are owned by the Authoring Plan and compiler.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY'],
    lockedInputs: {
      ...governedInputs(seed.authoringPlan),
      fixed_question_slots: seed.authoringPlan.fixedQuestionSlots,
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_SIR_PAIR_BOUNDARY',
      'VALIDATED_SIR_AP_FAILURE_MODEL',
      'VALIDATED_SIR_APPLICABILITY',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not output canonical question IDs.',
      'Do not output question dimensions; dimensions are fixed by the Authoring Plan.',
      'Do not change, omit or duplicate slots 1, 2 and 3.',
      'Do not create atomic criteria, evidence, findings, sources, tactics or lifecycle consequences.',
      'Do not make real-system compliance, applicability, approval or authorization conclusions.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirPrimaryQuestionsOutput',
      requiredFields: [
        'capabilityQuestions',
        'antipatternQuestions',
        'coverageRationale'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'EXACTLY_THREE_QUESTION_SLOTS_PER_OBJECT',
      'QUESTION_SLOTS_FIXED_AND_ORDERED',
      'QUESTION_TEXT_NONEMPTY',
      'NO_CANONICAL_IDENTITY_FIELDS',
      'NO_OUT_OF_SCOPE_SECTIONS'
    ],
    dependencyPaths: ['sir.capability.questions', 'sir.antipattern.questions'],
    failureMode: 'FAIL_CLOSED'
  };
}
