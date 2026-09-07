import type { TaskContract } from '../domain/task-contract.js';

export interface PairBoundarySeed {
  pairId: string;
  capabilityId: string;
  antipatternId: string;
  categoryBaseline: Record<string, unknown>;
  adjacentCriteria: Record<string, unknown>[];
  goldenStandardBoundaryRules: Record<string, unknown>;
}

export interface PairBoundaryOutput {
  pairId: string;
  capabilityId: string;
  antipatternId: string;
  capability: {
    canonicalDefinition: string;
    governancePurpose: string;
    distinctClaim: string;
    ownedTopics: string[];
    excludedTopics: Array<{ criterionId: string; ownershipBoundary: string }>;
  };
  antipattern: {
    canonicalDefinition: string;
    pairedRelationship: string;
  };
  boundaryRationale: string;
}

export interface ApFailureModelSeed {
  pairBoundary: PairBoundaryOutput;
  categoryBaseline: Record<string, unknown>;
  goldenStandardFailureRules: Record<string, unknown>;
}

export interface ApFailureModelOutput {
  antipatternId: string;
  failureMechanism: string;
  triggeringConditions: string[];
  observableFailureSurfaces: string[];
  nonExamples: string[];
  distinctionFromCapabilityGap: string;
}

export interface ApplicabilitySeed {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  categoryBaseline: Record<string, unknown>;
  goldenStandardApplicabilityRules: Record<string, unknown>;
}

export interface ApplicabilityOutput {
  capabilityId: string;
  antipatternId: string;
  capability: {
    statement: string;
    conditions: string[];
    exclusions: string[];
    reassessmentTriggers: string[];
  };
  antipattern: {
    statement: string;
    conditions: string[];
    exclusions: string[];
    reassessmentTriggers: string[];
  };
  consistencyNotes: string[];
}

const CONTRACT_VERSION = '1.0.0';

export function buildPairBoundaryContract(seed: PairBoundarySeed): TaskContract<PairBoundaryOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairId}:PAIR_BOUNDARY`,
    taskType: 'PAIR_BOUNDARY',
    targetObjectId: seed.pairId,
    objective:
      'Define the semantic ownership boundary of the capability and its paired anti-pattern. Establish what the capability uniquely owns, what adjacent criteria own, and the paired anti-pattern relationship. Do not author evidence, findings, sources, tactics or lifecycle consequences.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [],
    lockedInputs: {
      pair_id: seed.pairId,
      capability_id: seed.capabilityId,
      antipattern_id: seed.antipatternId,
      category_baseline: seed.categoryBaseline,
      adjacent_criteria: seed.adjacentCriteria,
      golden_standard_boundary_rules: seed.goldenStandardBoundaryRules
    },
    allowedReferences: ['CATEGORY_BASELINE', 'ADJACENT_CRITERIA', 'GOLDEN_STANDARD'],
    doNot: [
      'Do not create or change source mappings.',
      'Do not create evidence requirements or assurance levels.',
      'Do not create atomic criteria, atomic tests or findings.',
      'Do not create tactic mappings.',
      'Do not make legal-applicability, compliance, approval or authorization conclusions.',
      'Do not redefine adjacent criteria; describe only the boundary against them.',
      'Do not change the supplied capability or anti-pattern IDs.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'PairBoundaryOutput',
      requiredFields: [
        'pairId',
        'capabilityId',
        'antipatternId',
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
      'PAIR_ID_MATCH',
      'CAPABILITY_ID_MATCH',
      'ANTIPATTERN_ID_MATCH',
      'NONEMPTY_SEMANTIC_BOUNDARY',
      'ADJACENT_OWNERSHIP_EXPLICIT',
      'NO_OUT_OF_SCOPE_SECTIONS'
    ],
    dependencyPaths: [
      'capability.canonical_definition',
      'capability.governance_purpose',
      'capability.distinct_claim',
      'antipattern.canonical_definition'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildApFailureModelContract(seed: ApFailureModelSeed): TaskContract<ApFailureModelOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:AP_FAILURE_MODEL`,
    taskType: 'AP_FAILURE_MODEL',
    targetObjectId: seed.pairBoundary.antipatternId,
    objective:
      'Define the anti-pattern failure mechanism only. Explain how the paired capability can fail in practice, what conditions create the mechanism, where the mechanism becomes observable, and which superficially similar situations are not the anti-pattern.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY'],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      category_baseline: seed.categoryBaseline,
      golden_standard_failure_rules: seed.goldenStandardFailureRules
    },
    allowedReferences: ['VALIDATED_PAIR_BOUNDARY', 'CATEGORY_BASELINE', 'GOLDEN_STANDARD'],
    doNot: [
      'Do not redefine the capability boundary.',
      'Do not change the anti-pattern canonical definition unless a validation defect explicitly requires it.',
      'Do not author evidence, atomic tests, findings, source mappings or tactics.',
      'Do not infer anti-pattern presence or absence for any real system.',
      'Do not make legal non-compliance conclusions from the anti-pattern.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'ApFailureModelOutput',
      requiredFields: [
        'antipatternId',
        'failureMechanism',
        'triggeringConditions',
        'observableFailureSurfaces',
        'nonExamples',
        'distinctionFromCapabilityGap'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'ANTIPATTERN_ID_MATCH',
      'FAILURE_MECHANISM_NONEMPTY',
      'FAILURE_MECHANISM_PAIRED_TO_BOUNDARY',
      'NONEXAMPLES_PRESENT',
      'NO_EVIDENCE_OR_FINDING_CONTENT'
    ],
    dependencyPaths: ['antipattern.failure_mechanism'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildApplicabilityContract(seed: ApplicabilitySeed): TaskContract<ApplicabilityOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:APPLICABILITY`,
    taskType: 'APPLICABILITY',
    targetObjectId: seed.pairBoundary.pairId,
    objective:
      'Define applicability for the capability and anti-pattern as separate but coherent objects: general applicability statement, scoped conditions, valid exclusions and material-change reassessment triggers. Preserve the validated semantic boundary and failure mechanism.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL'],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      category_baseline: seed.categoryBaseline,
      golden_standard_applicability_rules: seed.goldenStandardApplicabilityRules
    },
    allowedReferences: [
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_AP_FAILURE_MODEL',
      'CATEGORY_BASELINE',
      'GOLDEN_STANDARD'
    ],
    doNot: [
      'Do not redefine the capability distinct claim or anti-pattern failure mechanism.',
      'Do not create blanket exclusions unsupported by the category baseline.',
      'Do not determine legal applicability for a real assessed system.',
      'Do not author primary questions, evidence, findings, source mappings, tactics or lifecycle consequences.',
      'Do not change supplied IDs.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'ApplicabilityOutput',
      requiredFields: [
        'capabilityId',
        'antipatternId',
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
      'CAPABILITY_ID_MATCH',
      'ANTIPATTERN_ID_MATCH',
      'APPLICABILITY_NONEMPTY',
      'EXCLUSIONS_EXPLICIT',
      'REASSESSMENT_TRIGGERS_PRESENT',
      'PAIR_APPLICABILITY_COHERENCE',
      'NO_REAL_SYSTEM_APPLICABILITY_DECISION'
    ],
    dependencyPaths: ['capability.applicability', 'antipattern.applicability'],
    failureMode: 'FAIL_CLOSED'
  };
}
