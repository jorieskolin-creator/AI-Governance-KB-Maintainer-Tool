import { buildAuthoringPlan, type AuthoringPlanInput } from '../authoring/authoring-plan.js';
import {
  buildSirApFailureModelContract,
  buildSirApplicabilityContract,
  buildSirPairBoundaryContract,
  buildSirPrimaryQuestionsContract,
  type SirApFailureModelOutput,
  type SirApplicabilityOutput,
  type SirPairBoundaryOutput,
  type SirPrimaryQuestionsOutput
} from '../cognitive/sir-initial-contracts.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { validateSirInitialCompletion } from '../validation/sir-initial-completion.js';

const planInput: AuthoringPlanInput = {
  identity: {
    capabilityId: 'A2',
    antipatternId: 'AP-A2',
    pairId: 'A2_AP-A2',
    domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'Sample capability',
    antipatternTitle: 'Sample anti-pattern'
  },
  targetVersion: '1.0.0',
  schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-test',
    baselineSha256: 'a'.repeat(64),
    productionContractVersion: '1.1.0',
    productionContractSha256: 'b'.repeat(64),
    capabilitySchemaVersion: '2.1.0',
    capabilitySchemaSha256: 'c'.repeat(64),
    antipatternSchemaVersion: '2.1.0',
    antipatternSchemaSha256: 'd'.repeat(64),
    sharedDefinitionsVersion: '2.1.0',
    sharedDefinitionsSha256: 'e'.repeat(64),
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: 'f'.repeat(64),
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1',
    goldenReferenceVersion: '1.0.0',
    goldenReferenceSha256: '1'.repeat(64)
  },
  questionDimensions: [
    'DEFINITION_AND_INTENT',
    'IMPLEMENTATION_AND_OPERATION',
    'EVIDENCE_AND_EFFECTIVENESS'
  ],
  vocabulary: {
    technicalAssurance: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE'],
    antipatternConclusionStates: ['CONFIRMED_PRESENT', 'PARTIALLY_PRESENT', 'TESTED_ABSENT', 'UNKNOWN', 'NOT_APPLICABLE'],
    hardGateEffects: ['NONE', 'WARN', 'BLOCK', 'CONSTRAIN'],
    lifecycleStages: [
      'QUALIFICATION_AND_REGISTRATION',
      'DESIGN_AND_DEVELOPMENT',
      'VERIFICATION_AND_VALIDATION',
      'DEPLOYMENT',
      'OPERATION_AND_MONITORING',
      'REVIEW_AND_EVALUATION',
      'RETIREMENT'
    ]
  },
  allowedSources: [],
  allowedTactics: [],
  adjacentCriteria: [
    { criterionHandle: 'criterion_001', criterionId: 'A1', boundarySummary: 'Neighboring A1 boundary.' },
    { criterionHandle: 'criterion_002', criterionId: 'A3', boundarySummary: 'Neighboring A3 boundary.' }
  ]
};

const plan = buildAuthoringPlan(planInput);
const categoryBaseline = { criterion: 'A2 sample baseline' };
const goldenReference = { reference_id: 'A1_AP-A1', normative: false };

const boundary: SirPairBoundaryOutput = {
  capability: {
    canonicalDefinition: 'A sufficiently bounded semantic definition for the sample capability.',
    governancePurpose: 'A sufficiently bounded governance purpose for the sample capability.',
    distinctClaim: 'A sufficiently distinct semantic claim for the sample capability.',
    ownedTopics: ['Sample owned topic'],
    excludedTopics: [
      { criterionHandle: 'criterion_001', ownershipBoundary: 'This topic is owned by the adjacent criterion instead.' }
    ]
  },
  antipattern: {
    canonicalDefinition: 'A sufficiently bounded semantic definition for the paired anti-pattern.',
    pairedRelationship: 'The anti-pattern expresses the governed failure mode of the paired capability.'
  },
  boundaryRationale: 'The pair boundary is separated from adjacent criteria by semantic ownership.'
};

const failure: SirApFailureModelOutput = {
  failureMechanism: 'The governed capability fails through a concrete and observable semantic mechanism.',
  triggeringConditions: ['A material triggering condition exists.'],
  observableFailureSurfaces: ['A material operational failure surface exists.'],
  nonExamples: ['A superficial gap that does not constitute this anti-pattern.'],
  distinctionFromCapabilityGap: 'The anti-pattern requires a failure mechanism, not merely incomplete maturity.'
};

const applicability: SirApplicabilityOutput = {
  capability: {
    statement: 'The capability applies under the governed system and context conditions.',
    conditions: ['A relevant system-context condition is present.'],
    exclusions: ['A bounded exclusion applies only when the stated condition is absent.'],
    reassessmentTriggers: ['A material context or use change occurs.']
  },
  antipattern: {
    statement: 'The anti-pattern is assessed within the same governed scope but through failure evidence.',
    conditions: ['The paired failure mechanism is meaningfully assessable.'],
    exclusions: ['The mechanism is outside scope only under an evidenced boundary exclusion.'],
    reassessmentTriggers: ['A material context or failure-surface change occurs.']
  },
  consistencyNotes: ['Capability and anti-pattern applicability remain paired but independently assessable.']
};

const questions: SirPrimaryQuestionsOutput = {
  capabilityQuestions: [
    { slot: 1, question: 'Is the capability definition and intent sufficiently specific and bounded?' },
    { slot: 2, question: 'Is the capability implemented and operated consistently with that intent?' },
    { slot: 3, question: 'Does current evidence demonstrate the intended capability and effectiveness?' }
  ],
  antipatternQuestions: [
    { slot: 1, question: 'Is the anti-pattern failure mechanism clearly defined and distinguishable?' },
    { slot: 2, question: 'Does implementation or operation exhibit the defined failure mechanism?' },
    { slot: 3, question: 'Does current evidence establish presence, uncertainty or tested absence?' }
  ],
  coverageRationale: 'The three slots cover definition, implementation and evidence without model-owned dimensions or IDs.'
};

const boundaryContract = buildSirPairBoundaryContract({ authoringPlan: plan, categoryBaseline, goldenReference });
const failureContract = buildSirApFailureModelContract({ authoringPlan: plan, pairBoundary: boundary, categoryBaseline, goldenReference });
const applicabilityContract = buildSirApplicabilityContract({ authoringPlan: plan, pairBoundary: boundary, apFailureModel: failure, categoryBaseline, goldenReference });
const questionsContract = buildSirPrimaryQuestionsContract({ authoringPlan: plan, pairBoundary: boundary, apFailureModel: failure, applicability, categoryBaseline, goldenReference });

function assertPass(contract: Parameters<typeof validateSirInitialCompletion>[0], completed: ReadonlySet<CognitiveTaskType>, output: unknown): void {
  const report = validateSirInitialCompletion(contract, completed, output, { runId: 'sir-regression', authoringPlan: plan });
  if (!report.passed) throw new Error(`${contract.taskType} valid SIR failed: ${report.findings.map((item) => item.checkId).join(', ')}`);
}

function assertFail(contract: Parameters<typeof validateSirInitialCompletion>[0], completed: ReadonlySet<CognitiveTaskType>, output: unknown, expectedCheck: string): void {
  const report = validateSirInitialCompletion(contract, completed, output, { runId: 'sir-regression', authoringPlan: plan });
  if (report.passed || !report.findings.some((item) => item.checkId === expectedCheck)) {
    throw new Error(`${contract.taskType} mutation did not trigger ${expectedCheck}.`);
  }
}

assertPass(boundaryContract, new Set<CognitiveTaskType>(), boundary);
assertPass(failureContract, new Set<CognitiveTaskType>(['PAIR_BOUNDARY']), failure);
assertPass(applicabilityContract, new Set<CognitiveTaskType>(['PAIR_BOUNDARY', 'AP_FAILURE_MODEL']), applicability);
assertPass(questionsContract, new Set<CognitiveTaskType>(['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY']), questions);

assertFail(
  boundaryContract,
  new Set<CognitiveTaskType>(),
  { ...boundary, capabilityId: 'A2' },
  'SIR_OUTPUT_CONTRACT'
);

assertFail(
  boundaryContract,
  new Set<CognitiveTaskType>(),
  {
    ...boundary,
    capability: {
      ...boundary.capability,
      excludedTopics: [{ criterionHandle: 'criterion_999', ownershipBoundary: 'Unknown adjacent criterion handle.' }]
    }
  },
  'SIR_ADJACENT_HANDLE_RESOLVES'
);

assertFail(
  questionsContract,
  new Set<CognitiveTaskType>(['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY']),
  {
    ...questions,
    capabilityQuestions: [questions.capabilityQuestions[1], questions.capabilityQuestions[0], questions.capabilityQuestions[2]]
  },
  'SIR_QUESTION_SLOT_ORDER'
);

assertFail(
  questionsContract,
  new Set<CognitiveTaskType>(['PAIR_BOUNDARY', 'AP_FAILURE_MODEL']),
  questions,
  'SIR_PREREQUISITE_MISSING'
);

console.log(JSON.stringify({ initialSirContracts: 'PASS', canonicalIdentityFromModel: 'PROHIBITED', adjacentHandleResolution: 'PASS', fixedQuestionSlots: 'PASS', prerequisiteGates: 'PASS' }, null, 2));
