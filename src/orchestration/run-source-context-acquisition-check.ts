import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { previewRepoBaselineManifest } from '../baseline/repo-artifacts.js';
import { buildPairAuthoringPlan } from '../operator/authoring-context.js';
import {
  PAIR_CANDIDATE_HASH_TASKS,
  PAIR_TASK_SEQUENCE,
  PAIR_TASKS_BEFORE_SOURCE_MAPPING
} from './pipeline.js';
import { acquireSourceContext, sourceContextAcquisitionContract } from './source-context-acquisition.js';
import { evaluatePairGates, evaluateSourceAcquisition } from './named-gates.js';
import {
  sourceContextLocatorCount,
  type AuthoringSourceRegisterRecord,
  type SourceLocatorContextInput
} from './source-context-packet.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(fn: () => unknown, expected: string): void {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) {
      throw new Error(`Expected error containing "${expected}", received: ${message}`);
    }
    return;
  }
  throw new Error(`Expected error containing "${expected}" but no error was thrown.`);
}

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
    antipatternConclusionStates: [
      'CONFIRMED_PRESENT',
      'PARTIALLY_PRESENT',
      'TESTED_ABSENT',
      'UNKNOWN',
      'NOT_APPLICABLE'
    ],
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
      sourceId: 'SRC-ISO-42001-2023',
      versionOrDate: '2023',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-08-18'
    }
  ],
  allowedTactics: [],
  adjacentCriteria: []
});

const records: AuthoringSourceRegisterRecord[] = [
  {
    sourceId: 'SRC-EU-AIA',
    versionOrDate: '2024-07-12',
    verificationStatus: 'VERIFIED',
    lastVerifiedDate: '2026-08-18',
    effectiveStatus: 'IN_FORCE',
    authorityTier: 'PRIMARY_BINDING_AUTHORITY',
    authorityType: 'LEGISLATION',
    officialLocation: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
    applicabilityBoundary:
      'Apply article-by-article according to role, system classification, jurisdiction, use and applicable transition date.',
    licensingBoundary: 'Official legislation may be used within bounded source-context rules.',
    domainCoverage: ['A'],
    modelContextPolicy: 'METADATA_LOCATOR_ONLY',
    usageRightsReference: null
  },
  {
    sourceId: 'SRC-ISO-42001-2023',
    versionOrDate: '2023',
    verificationStatus: 'VERIFIED',
    lastVerifiedDate: '2026-08-18',
    effectiveStatus: 'PUBLISHED',
    authorityTier: 'VOLUNTARY_STANDARD',
    authorityType: 'PUBLISHED_STANDARD',
    officialLocation: 'https://www.iso.org/standard/42001',
    applicabilityBoundary:
      'Voluntary organizational AI management system requirements and guidance; organizational scope must be determined separately.',
    licensingBoundary:
      'Metadata and locator only unless explicit usage rights permit storage or model transmission of protected text.',
    domainCoverage: ['A'],
    modelContextPolicy: 'METADATA_LOCATOR_ONLY',
    usageRightsReference: null
  }
];

assert(PAIR_TASK_SEQUENCE.length === 14, 'operator board must stay at 14 SIR tasks');
assert(
  !PAIR_TASK_SEQUENCE.includes('SOURCE_CONTEXT'),
  'SOURCE_CONTEXT is a deterministic stage, not a model SIR task'
);
assert(
  PAIR_TASKS_BEFORE_SOURCE_MAPPING.length === 8,
  'eight authoring tasks precede SOURCE_MAPPING'
);
assert(
  PAIR_TASKS_BEFORE_SOURCE_MAPPING[0] === 'PAIR_BOUNDARY' &&
    PAIR_TASKS_BEFORE_SOURCE_MAPPING[7] === 'AP_ABSENCE_CONTRACT',
  'pre-SOURCE_MAPPING authoring window drifted'
);
assert(
  PAIR_CANDIDATE_HASH_TASKS[0] === 'SOURCE_CONTEXT',
  'candidate hash must include SOURCE_CONTEXT when present'
);

const consumedAuthoringTasks: string[] = [];
const zeroLocatorPacket = acquireSourceContext({
  authoringPlan: plan,
  registerRecords: records,
  locatorInputs: []
});
const earlyGate = evaluateSourceAcquisition(zeroLocatorPacket);

assert(sourceContextLocatorCount(zeroLocatorPacket) === 0, 'zero-locator packet unexpectedly contains locators');
assert(zeroLocatorPacket.mappingContextAvailable === false, 'zero-locator packet must mark mapping context unavailable');
assert(
  zeroLocatorPacket.missingContextSourceHandles.length === 2,
  'zero-locator packet must record every allowed source as missing context'
);
assert(earlyGate.outcome === 'SOURCE_GAPS_PRESENT', 'zero-locator packet must report SOURCE_GAPS_PRESENT');
assert(
  earlyGate.findings.some(
    (item) =>
      item.checkId === 'SOURCE_CONTEXT_ZERO_LOCATORS' &&
      item.severity === 'BLOCKING' &&
      item.kind === 'SOURCE'
  ),
  'zero-locator packet must emit a BLOCKING SOURCE_CONTEXT_ZERO_LOCATORS finding'
);
assert(
  earlyGate.findings.every((item) => item.recommendedAction?.includes('not waivable')),
  'BLOCKING source findings must be non-waivable by default'
);
assert(consumedAuthoringTasks.length === 0, 'source acquisition consumed authoring tasks');
assert(
  PAIR_TASKS_BEFORE_SOURCE_MAPPING.every((taskType) => !consumedAuthoringTasks.includes(taskType)),
  'SOURCE_GAPS_PRESENT arrived after pre-SOURCE_MAPPING authoring tasks'
);

const contract = sourceContextAcquisitionContract(plan);
assert(contract.taskType === 'SOURCE_CONTEXT', 'acquisition contract task type drifted');
assert(contract.contractVersion === 'source-context/v1', 'acquisition must not use SIR v2 completion');
assert(contract.doNot.includes('INVENT_LOCATORS'), 'acquisition contract must forbid invented locators');

const earlyPairGates = evaluatePairGates({
  snapshotComplete: false,
  schemaIssues: ['snapshot incomplete'],
  sourceMappings: undefined,
  sourceContextPacket: zeroLocatorPacket,
  review: undefined
});
assert(
  earlyPairGates.some((item) => item.outcome === 'SOURCE_GAPS_PRESENT') &&
    !earlyPairGates.some((item) => item.outcome === 'SIR_VALID') &&
    !earlyPairGates.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE'),
  'early acquisition gate records SOURCE_GAPS_PRESENT before SIR_VALID'
);

expectThrows(
  () =>
    acquireSourceContext({
      authoringPlan: plan,
      registerRecords: records,
      locatorInputs: [{ sourceId: 'SRC-NOT-ALLOWED', locator: 'Section 1' }]
    }),
  'outside the Authoring Plan source universe'
);

const stripped = acquireSourceContext({
  authoringPlan: plan,
  registerRecords: records,
  locatorInputs: [
    {
      sourceId: 'SRC-EU-AIA',
      locator: 'Article 9(2)',
      contextText: 'Invented passage text must not enter a metadata-only packet.'
    }
  ]
});
assert(
  stripped.sources[0]?.locatorContexts[0]?.contextText === null,
  'metadata-only policy must strip model-visible passage text'
);
assert(
  evaluateSourceAcquisition(stripped).outcome === 'SOURCE_GAPS_PRESENT',
  'locators without claim mappings must not report SOURCE_COVERAGE_COMPLETE'
);
assert(
  evaluateSourceAcquisition(stripped).findings.some((item) => item.checkId === 'SOURCE_CONTEXT_MISSING_PASSAGES'),
  'partial locator coverage must remain SOURCE_GAPS_PRESENT'
);

const rightsRecords: AuthoringSourceRegisterRecord[] = [
  { ...records[0]!, modelContextPolicy: 'BOUNDED_SNIPPET_ALLOWED', usageRightsReference: 'usage-rights-001' },
  records[1]!
];
const rightsLocators: SourceLocatorContextInput[] = [
  {
    sourceId: 'SRC-EU-AIA',
    locator: 'Article 9(2)',
    locatorLabel: 'Risk management system requirements',
    contextText: 'The risk management system shall be a continuous iterative process.'
  },
  { sourceId: 'SRC-ISO-42001-2023', locator: 'Clause 6.1' }
];
const rightsPacket = acquireSourceContext({
  authoringPlan: plan,
  registerRecords: rightsRecords,
  locatorInputs: rightsLocators
});
assert(
  rightsPacket.sources[0]?.locatorContexts[0]?.contextText ===
    'The risk management system shall be a continuous iterative process.',
  'bounded snippets must remain only where usage rights allow'
);
assert(
  rightsPacket.sources[1]?.locatorContexts[0]?.contextText === null,
  'published-standard metadata-only locators must not carry protected text'
);
assert(
  evaluateSourceAcquisition(rightsPacket).findings.some(
    (item) => item.checkId === 'SOURCE_CONTEXT_MAPPINGS_PENDING'
  ),
  'complete locator context still waits for SOURCE_MAPPING before SOURCE_COVERAGE_COMPLETE'
);

const covered = evaluatePairGates({
  snapshotComplete: true,
  schemaIssues: [],
  sourceMappings: {
    capability: [{ sourceHandle: 'source_001' }],
    antipattern: [{ sourceHandle: 'source_001' }],
    unmappedClaims: []
  },
  sourceContextPacket: zeroLocatorPacket,
  review: undefined
});
assert(
  covered.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE'),
  'final claim-to-locator mapping gate takes precedence once SOURCE_MAPPING exists'
);

const snapshot: BaselineSnapshot = {
  id: 'baseline-source-acquisition',
  sha256: 'a'.repeat(64),
  manifest: previewRepoBaselineManifest()
};
const sealedPlan = buildPairAuthoringPlan({ domain: 'A', pairId: 'A2_AP-A2', snapshot });
const sealedPacket = acquireSourceContext({ authoringPlan: sealedPlan });
assert(
  sourceContextLocatorCount(sealedPacket) === 0,
  'sealed register has no locator catalog; production acquisition must not invent locators'
);
assert(
  evaluateSourceAcquisition(sealedPacket).findings.some((item) => item.checkId === 'SOURCE_CONTEXT_ZERO_LOCATORS'),
  'sealed-register zero-locator packet must report SOURCE_CONTEXT_ZERO_LOCATORS'
);

console.log(
  JSON.stringify(
    {
      sourceContextAcquisition: 'PASS',
      zeroLocatorSourceGapsPresent: 'PASS',
      beforeEightAuthoringTasks: 'PASS',
      blockingNonWaivable: 'PASS',
      outOfUniverseLocator: 'REJECTED',
      metadataOnlySnippetStrip: 'PASS',
      mappingsPendingNotComplete: 'PASS',
      finalMappingGatePrecedence: 'PASS',
      sealedRegisterDoesNotInventLocators: 'PASS',
      sourceContextNotBoardSirTask: 'PASS'
    },
    null,
    2
  )
);
