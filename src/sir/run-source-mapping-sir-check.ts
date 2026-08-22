import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import { buildSirSourceMappingContract } from '../cognitive/sir-source-mapping-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { buildSourceContextPacket } from '../orchestration/source-context-packet.js';
import { validateSirSourceMappingCompletion } from '../validation/sir-source-mapping-completion.js';

const plan = buildAuthoringPlan({
  identity: {
    capabilityId: 'A2',
    antipatternId: 'AP-A2',
    pairId: 'A2_AP-A2',
    domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'AI suitability, proportionality and value hypothesis',
    antipatternTitle: 'AI-first solutionism or value theatre'
  },
  targetVersion: '1.0.0',
  schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-001',
    baselineSha256: 'baseline-hash',
    productionContractVersion: '1.0.0',
    productionContractSha256: 'production-contract-hash',
    capabilitySchemaVersion: '2.1.0',
    capabilitySchemaSha256: 'capability-schema-hash',
    antipatternSchemaVersion: '2.1.0',
    antipatternSchemaSha256: 'antipattern-schema-hash',
    sharedDefinitionsVersion: '2.1.0',
    sharedDefinitionsSha256: 'shared-schema-hash',
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: 'source-register-hash',
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1',
    goldenReferenceVersion: '1.0.0',
    goldenReferenceSha256: 'golden-hash'
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
  allowedSources: [
    {
      sourceHandle: 'source_001',
      sourceId: 'SRC-EU-AIA',
      versionOrDate: '2024-07-12',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-08-18'
    },
    {
      sourceHandle: 'source_002',
      sourceId: 'SRC-NIST-AI-RMF',
      versionOrDate: '1.0',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-08-18'
    }
  ],
  allowedTactics: [],
  adjacentCriteria: []
});

const sourceContextPacket = buildSourceContextPacket({
  authoringPlan: plan,
  sealedSourceRegisterVersion: '1.5.0',
  sealedSourceRegisterSha256: 'source-register-hash',
  registerRecords: [
    {
      sourceId: 'SRC-EU-AIA',
      versionOrDate: '2024-07-12',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-08-18',
      effectiveStatus: 'IN_FORCE',
      authorityTier: 'PRIMARY_BINDING_AUTHORITY',
      authorityType: 'LEGISLATION',
      officialLocation: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
      applicabilityBoundary: 'Apply article-by-article according to role, system classification, jurisdiction, use and applicable transition date.',
      licensingBoundary: 'Official legislation may be used within bounded source-context rules.',
      domainCoverage: ['A'],
      modelContextPolicy: 'BOUNDED_SNIPPET_ALLOWED',
      usageRightsReference: null
    },
    {
      sourceId: 'SRC-NIST-AI-RMF',
      versionOrDate: '1.0',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-08-18',
      effectiveStatus: 'PUBLISHED',
      authorityTier: 'GOVERNMENT_VOLUNTARY_GUIDANCE',
      authorityType: 'GOVERNMENT_VOLUNTARY_GUIDANCE',
      officialLocation: 'https://doi.org/10.6028/NIST.AI.100-1',
      applicabilityBoundary: 'Voluntary risk-management guidance; it does not establish legal compliance or certification.',
      licensingBoundary: 'Public government guidance may be used within bounded source-context rules.',
      domainCoverage: ['A'],
      modelContextPolicy: 'BOUNDED_SNIPPET_ALLOWED',
      usageRightsReference: null
    }
  ],
  locatorContexts: [
    {
      sourceId: 'SRC-EU-AIA',
      locator: 'Article 9(2)',
      locatorLabel: 'Risk management process',
      contextText: 'The risk management system is a continuous iterative process planned and run throughout the lifecycle.'
    },
    {
      sourceId: 'SRC-NIST-AI-RMF',
      locator: 'MAP 1.1',
      locatorLabel: 'Intended purposes and context',
      contextText: 'Intended purposes, potentially beneficial uses, context-specific laws, norms, expectations and prospective settings are understood and documented.'
    }
  ]
});

const pairBoundary = {
  capability: {
    canonicalDefinition: 'The organization demonstrates that AI is a proportionate mechanism for a defined problem and measurable value hypothesis.',
    governancePurpose: 'Prevent AI adoption from becoming detached from a measurable problem, alternatives and value evidence.',
    distinctClaim: 'AI selection is proportionate to the problem, alternatives, expected value, cost and risk.',
    ownedTopics: ['problem framing', 'AI suitability', 'value hypothesis', 'alternative comparison'],
    excludedTopics: []
  },
  antipattern: {
    canonicalDefinition: 'AI is adopted for novelty, availability or signalling without proportionate evidence.',
    pairedRelationship: 'The anti-pattern captures failure of evidence-based AI suitability and value justification.'
  },
  boundaryRationale: 'A2 owns the decision whether AI is a proportionate mechanism, not general purpose definition or legal classification.'
};

const atomics = {
  capability: [
    { handle: 'atomic_001' as const, questionSlot: 1 as const, statement: 'A measurable non-AI problem and outcome baseline is defined.', evidenceNeed: 'Problem and baseline evidence.' }
  ],
  antipattern: [
    { handle: 'atomic_001' as const, questionSlot: 1 as const, statement: 'The proposed use begins from a predetermined AI solution rather than an independently defined problem.', evidenceNeed: 'Decision framing and alternative comparison evidence.' }
  ]
};

const evidence = {
  capability: [
    {
      handle: 'evidence_001' as const,
      title: 'Problem and alternatives record',
      claimSupported: 'The problem, non-AI baseline and evaluated alternatives are explicitly documented.',
      evidenceClass: 'DOCUMENTED_ANALYSIS',
      minimumTechnicalAssurance: 'DECLARED',
      requiredHumanAssurance: 'HUMAN_VALIDATED',
      acceptanceConditions: ['The record identifies the problem independently of the selected AI mechanism.'],
      limitations: ['A planning document alone does not establish realized value.'],
      supportsAtomicHandles: ['atomic_001' as const]
    }
  ],
  antipattern: [
    {
      handle: 'evidence_001' as const,
      title: 'Solution-selection decision trail',
      claimSupported: 'The decision trail shows whether AI was predetermined before alternatives were evaluated.',
      evidenceClass: 'DECISION_RECORD',
      minimumTechnicalAssurance: 'DECLARED',
      requiredHumanAssurance: 'HUMAN_VALIDATED',
      acceptanceConditions: ['The chronology of problem framing and solution selection is attributable.'],
      limitations: ['A retrospective narrative may not prove the original decision sequence.'],
      supportsAtomicHandles: ['atomic_001' as const]
    }
  ]
};

const evidenceSafety = {
  capabilityRules: {
    evidenceCeilings: ['A value hypothesis does not establish realized operational value.'],
    falsePositiveGuards: ['Require an explicit alternative baseline before concluding AI suitability was evaluated.'],
    prohibitedInferences: ['Do not infer proportionality from executive sponsorship or budget approval.'],
    contradictionHandling: ['Conflicting cost, value or trial evidence keeps suitability unresolved.'],
    freshnessRules: ['Material changes to solution scope or cost require reassessment.']
  },
  antipatternRules: {
    evidenceCeilings: ['Use of AI alone does not establish AI-first solutionism.'],
    falsePositiveGuards: ['Distinguish an evidence-based AI decision from novelty-driven selection.'],
    prohibitedInferences: ['Do not infer absence from a later-created business case alone.'],
    contradictionHandling: ['Conflicting decision records prevent a definitive presence or absence conclusion.'],
    freshnessRules: ['Decision evidence must correspond to the current materially changed solution.']
  },
  crossPairSafetyNotes: ['Capability satisfaction and anti-pattern absence remain independently established.']
};

const contract = buildSirSourceMappingContract({
  authoringPlan: plan,
  pairBoundary,
  apFailureModel: {
    failureMechanism: 'The organization begins with AI as the predetermined solution and substitutes novelty or activity signals for evidence of proportional value.',
    triggeringConditions: ['AI solution selected before problem and alternatives are defined.'],
    observableFailureSurfaces: ['No non-AI baseline or alternative comparison.'],
    nonExamples: ['AI selected after explicit comparison against simpler alternatives.'],
    distinctionFromCapabilityGap: 'The anti-pattern requires evidence of solution-first decision logic, not merely an incomplete value metric.'
  },
  applicability: {
    capability: {
      statement: 'Applies to proposed and materially changed AI uses.',
      conditions: ['An AI-enabled mechanism is proposed or materially changed.'],
      exclusions: [],
      reassessmentTriggers: ['Material change to problem, solution, cost, risk or expected value.']
    },
    antipattern: {
      statement: 'Applies when solution-selection rationale can be examined.',
      conditions: ['AI solution selection is within the decision scope.'],
      exclusions: [],
      reassessmentTriggers: ['Material change or replacement of the selected solution.']
    },
    consistencyNotes: ['Both objects apply to the same solution-selection decision boundary.']
  },
  primaryQuestions: {
    capabilityQuestions: [
      { slot: 1, question: 'Is the problem and measurable value hypothesis defined independently of AI?' },
      { slot: 2, question: 'Is the AI approach compared with simpler alternatives using explicit cost-risk trade-offs?' },
      { slot: 3, question: 'Do representative trials show sufficient value and feasibility with stop criteria applied?' }
    ],
    antipatternQuestions: [
      { slot: 1, question: 'Was AI predetermined before a bounded problem and alternatives were established?' },
      { slot: 2, question: 'Do implementation decisions substitute novelty or activity signals for proportionate justification?' },
      { slot: 3, question: 'Does current evidence show progression despite weak value or alternative evidence?' }
    ],
    coverageRationale: 'The three fixed dimensions cover intent, operation and evidence for both sides of the pair.'
  },
  atomics,
  evidence,
  evidenceSafety,
  apAbsence: {
    requiredArtifacts: ['Scoped solution-selection record', 'Executed alternative-comparison review', 'Independent verification record'],
    interpretationBoundary: 'Silence or absence of a visible business case cannot establish that AI-first solutionism was tested absent.'
  },
  sourceContextPacket,
  categoryBaseline: {},
  goldenReference: {}
});

const completed = new Set<CognitiveTaskType>(contract.upstreamTaskTypes);

const valid = {
  capabilityMappings: [
    {
      sourceHandle: 'source_001',
      locatorHandle: 'locator_001',
      relationship: 'BINDING_LAW_WHEN_APPLICABLE',
      supportedClaim: 'Risk-management obligations require a continuous lifecycle-oriented process when the relevant AI Act provisions apply.',
      categoryRationale: 'The locator supports lifecycle-oriented risk management relevant to testing whether AI selection remains proportionate to risk.',
      applicabilityConditions: ['Only when the mapped AI Act requirement applies to the relevant actor and system context.'],
      exclusions: ['Registration does not establish high-risk classification or legal applicability.']
    }
  ],
  antipatternMappings: [
    {
      sourceHandle: 'source_002',
      locatorHandle: 'locator_002',
      relationship: 'AUTHORITATIVE_VOLUNTARY_GUIDANCE',
      supportedClaim: 'Intended purpose and contextual expectations should be understood and documented as part of AI risk management.',
      categoryRationale: 'The locator supports disciplined context definition and helps distinguish evidence-based suitability from solution-first adoption.',
      applicabilityConditions: ['Use as voluntary risk-management guidance rather than binding law.'],
      exclusions: ['The mapping does not prove compliance, certification or absence of the anti-pattern.']
    }
  ],
  unmappedClaims: [],
  mappingNotes: ['All mappings remain candidates until separate factual/source support validation passes.']
};

function validate(output: unknown, currentContract = contract) {
  return validateSirSourceMappingCompletion(
    currentContract,
    completed,
    output,
    { runId: 'source-mapping-regression', expectedPairId: 'A2_AP-A2' }
  );
}

if (!validate(valid).passed) throw new Error('Valid Source Mapping SIR failed regression.');

const wrongSourceLocator = structuredClone(valid);
wrongSourceLocator.capabilityMappings[0]!.sourceHandle = 'source_002';
if (!validate(wrongSourceLocator).findings.some((item) => item.checkId === 'SIR_LOCATOR_HANDLE_WRONG_SOURCE_OR_UNKNOWN')) {
  throw new Error('Cross-source locator reference was not rejected.');
}

const inventedLocator = structuredClone(valid);
inventedLocator.capabilityMappings[0]!.locatorHandle = 'locator_999';
if (!validate(inventedLocator).findings.some((item) => item.checkId === 'SIR_LOCATOR_HANDLE_WRONG_SOURCE_OR_UNKNOWN')) {
  throw new Error('Invented locator handle was not rejected.');
}

const freeformLocator = structuredClone(valid) as any;
freeformLocator.capabilityMappings[0].exactLocator = 'Article remembered by the model';
if (!validate(freeformLocator).findings.some((item) => item.checkId === 'SIR_SOURCE_MAPPING_OUTPUT_CONTRACT')) {
  throw new Error('Free-form exact locator in model output was not rejected.');
}

const hashDriftContract = {
  ...contract,
  lockedInputs: {
    ...contract.lockedInputs,
    source_context_packet_sha256: 'wrong-packet-hash'
  }
};
if (!validate(valid, hashDriftContract).findings.some((item) => item.checkId === 'SIR_SOURCE_CONTEXT_PACKET_HASH_BINDING')) {
  throw new Error('Source Context Packet hash drift was not rejected.');
}

const emptyResult = {
  capabilityMappings: [],
  antipatternMappings: [],
  unmappedClaims: [],
  mappingNotes: []
};
if (!validate(emptyResult).findings.some((item) => item.checkId === 'SIR_SOURCE_MAPPING_EMPTY_RESULT')) {
  throw new Error('Empty Source Mapping result without explicit insufficiency was not rejected.');
}

const insufficiencyOnly = {
  capabilityMappings: [],
  antipatternMappings: [],
  unmappedClaims: [
    {
      objectKind: 'CAPABILITY' as const,
      claim: 'No supplied locator context safely establishes a stronger category-specific source claim.',
      reason: 'INSUFFICIENT_SOURCE_CONTEXT' as const,
      consideredSourceHandles: ['source_001', 'source_002']
    }
  ],
  mappingNotes: ['Do not invent a locator or use model memory to close the source-context gap.']
};
if (!validate(insufficiencyOnly).passed) {
  throw new Error('Explicit insufficiency-only Source Mapping result should be a valid task completion.');
}

const unknownConsidered = structuredClone(insufficiencyOnly);
unknownConsidered.unmappedClaims[0]!.consideredSourceHandles = ['source_999'];
if (!validate(unknownConsidered).findings.some((item) => item.checkId === 'SIR_UNMAPPED_CLAIM_UNKNOWN_SOURCE_HANDLE')) {
  throw new Error('Unknown source handle in unmapped claim was not rejected.');
}

console.log(JSON.stringify({
  sourceMappingSir: 'PASS',
  sourceHandleResolution: 'PASS',
  locatorHandleResolution: 'PASS',
  crossSourceLocatorReference: 'REJECTED',
  freeformExactLocator: 'REJECTED',
  sourceContextHashBinding: 'PASS',
  explicitInsufficiencyCompletion: 'PASS',
  factualVerificationOwnedByDownstreamQa: true
}, null, 2));
