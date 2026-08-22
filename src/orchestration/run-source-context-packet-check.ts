import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import {
  buildSourceContextPacket,
  type AuthoringSourceRegisterRecord,
  type SourceLocatorContextInput
} from './source-context-packet.js';

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
    applicabilityBoundary: 'Apply article-by-article according to role, system classification, jurisdiction, use and applicable transition date.',
    licensingBoundary: 'Official legislation may be used within bounded source-context rules.',
    domainCoverage: ['A'],
    modelContextPolicy: 'BOUNDED_SNIPPET_ALLOWED',
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
    applicabilityBoundary: 'Voluntary organizational AI management system requirements and guidance; organizational scope must be determined separately.',
    licensingBoundary: 'Metadata and locator only unless explicit usage rights permit storage or model transmission of protected text.',
    domainCoverage: ['A'],
    modelContextPolicy: 'METADATA_LOCATOR_ONLY',
    usageRightsReference: null
  }
];

const contexts: SourceLocatorContextInput[] = [
  {
    sourceId: 'SRC-EU-AIA',
    locator: 'Article 9(2)',
    locatorLabel: 'Risk management system requirements',
    contextText: 'The risk management system shall be understood as a continuous iterative process planned and run throughout the entire lifecycle.'
  },
  {
    sourceId: 'SRC-ISO-42001-2023',
    locator: 'Clause 6.1',
    locatorLabel: 'Actions to address risks and opportunities'
  }
];

function build(overrides: Partial<Parameters<typeof buildSourceContextPacket>[0]> = {}) {
  return buildSourceContextPacket({
    authoringPlan: plan,
    sealedSourceRegisterVersion: '1.5.0',
    sealedSourceRegisterSha256: 'source-register-hash',
    registerRecords: records,
    locatorContexts: contexts,
    ...overrides
  });
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

const packet = build();
if (packet.pairId !== 'A2_AP-A2' || packet.authoringPlanSha256 !== plan.planSha256) {
  throw new Error('Source Context Packet lost pair or Authoring Plan binding.');
}
if (packet.sources[0]?.sourceHandle !== 'source_001' || packet.sources[1]?.sourceHandle !== 'source_002') {
  throw new Error('Source Context Packet did not preserve deterministic Authoring Plan handles.');
}
if (packet.sources[0]?.locatorContexts[0]?.locatorHandle !== 'locator_001') {
  throw new Error('First deterministic locator handle is not locator_001.');
}
if (packet.sources[1]?.locatorContexts[0]?.locatorHandle !== 'locator_002') {
  throw new Error('Second deterministic locator handle is not locator_002.');
}
if (packet.sources[1]?.locatorContexts[0]?.contextText !== null) {
  throw new Error('Metadata-only source unexpectedly contains model-visible protected text.');
}

const repeated = build();
if (repeated.packetSha256 !== packet.packetSha256) {
  throw new Error('Source Context Packet hash is not deterministic for identical inputs.');
}

expectThrows(
  () => build({ sealedSourceRegisterSha256: 'wrong-register-hash' }),
  'Source Register hash does not match'
);

const wrongVersion = structuredClone(records);
wrongVersion[0]!.versionOrDate = '2025';
expectThrows(
  () => build({ registerRecords: wrongVersion }),
  'does not match Authoring Plan'
);

expectThrows(
  () => build({
    locatorContexts: [
      ...contexts,
      { sourceId: 'SRC-NOT-ALLOWED', locator: 'Section 1' }
    ]
  }),
  'outside the Authoring Plan source universe'
);

expectThrows(
  () => build({
    locatorContexts: contexts.map((item) =>
      item.sourceId === 'SRC-ISO-42001-2023'
        ? { ...item, contextText: 'Protected standard text must not enter the model packet without rights.' }
        : item
    )
  }),
  'metadata/locator-only model context'
);

const rightsMissing = structuredClone(records);
rightsMissing[1]!.modelContextPolicy = 'BOUNDED_SNIPPET_ALLOWED';
expectThrows(
  () => build({ registerRecords: rightsMissing }),
  'requires an explicit usage-rights reference'
);

expectThrows(
  () => build({ registerRecords: records.slice(0, 1) }),
  'missing sealed register records'
);

console.log(JSON.stringify({
  sourceContextPacket: 'PASS',
  authoringPlanBinding: 'PASS',
  sourceRegisterHashBinding: 'PASS',
  deterministicLocatorHandles: 'PASS',
  metadataOnlyTextLeakage: 'REJECTED',
  licensedStandardRightsBoundary: 'PASS',
  outOfUniverseSourceContext: 'REJECTED',
  packetHashDeterminism: 'PASS'
}, null, 2));
