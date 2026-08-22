import { buildAuthoringPlan, verifyAuthoringPlan, type AuthoringPlanInput } from './authoring-plan.js';

const hash = 'a'.repeat(64);

const input: AuthoringPlanInput = {
  identity: {
    capabilityId: 'A2',
    antipatternId: 'AP-A2',
    pairId: 'A2_AP-A2',
    domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'Authoring Plan regression capability',
    antipatternTitle: 'Authoring Plan regression anti-pattern'
  },
  targetVersion: '1.0.0',
  schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-regression',
    baselineSha256: hash,
    productionContractVersion: '1.1.0',
    productionContractSha256: hash,
    capabilitySchemaVersion: '2.1.0',
    capabilitySchemaSha256: hash,
    antipatternSchemaVersion: '2.1.0',
    antipatternSchemaSha256: hash,
    sharedDefinitionsVersion: '2.1.0',
    sharedDefinitionsSha256: hash,
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: hash,
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1',
    goldenReferenceVersion: '1.0.0',
    goldenReferenceSha256: hash
  },
  questionDimensions: [
    'DEFINITION_AND_INTENT',
    'IMPLEMENTATION_AND_OPERATION',
    'EVIDENCE_AND_EFFECTIVENESS'
  ],
  vocabulary: {
    technicalAssurance: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'],
    capabilityConclusionStates: [
      'SATISFIED',
      'PARTIALLY_SATISFIED',
      'NOT_SATISFIED',
      'UNKNOWN',
      'NOT_APPLICABLE'
    ],
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
      sourceHandle: 'source_01',
      sourceId: 'SRC-EXAMPLE',
      versionOrDate: '2026-01-01',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-01-01'
    }
  ],
  allowedTactics: [],
  adjacentCriteria: [
    { criterionHandle: 'criterion_01', criterionId: 'A1', boundarySummary: 'Regression boundary A1.' },
    { criterionHandle: 'criterion_02', criterionId: 'A3', boundarySummary: 'Regression boundary A3.' }
  ]
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function expectReject(candidate: AuthoringPlanInput, expected: string): void {
  try {
    buildAuthoringPlan(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw error;
    return;
  }
  throw new Error(`Expected Authoring Plan rejection containing ${expected}.`);
}

function main(): void {
  const first = buildAuthoringPlan(input);
  const second = buildAuthoringPlan(input);
  verifyAuthoringPlan(first);

  assert(first.planSha256 === second.planSha256, 'Identical Authoring Plan inputs must produce identical hashes.');
  assert(first.planId === 'A2_AP-A2:authoring-plan:1.0.0', 'Authoring Plan ID must be deterministic.');
  assert(first.fixedQuestionSlots.length === 3, 'Authoring Plan must contain exactly three governed question slots.');
  assert(first.compilerPolicies.canonicalIdsFromModelOutputAllowed === false, 'Model-generated canonical IDs must remain prohibited.');
  assert(first.compilerPolicies.canonicalReferencesFromModelOutputAllowed === false, 'Model-generated canonical references must remain prohibited.');

  const tampered = { ...first, planSha256: 'b'.repeat(64) };
  let tamperDetected = false;
  try {
    verifyAuthoringPlan(tampered);
  } catch {
    tamperDetected = true;
  }
  assert(tamperDetected, 'Authoring Plan hash tampering must fail closed.');

  expectReject(
    {
      ...input,
      baseline: { ...input.baseline, tacticCatalogVersion: '1.2.0', tacticCatalogSha256: null }
    },
    'version and SHA-256 must either both be present or both be null'
  );

  expectReject(
    {
      ...input,
      allowedTactics: [{ tacticHandle: 'tactic_001', tacticId: 'GOV-PUR-001', tacticVersion: '1.0.0', catalogVersion: '1.2.0' }]
    },
    'Allowed tactic universe must be empty when no sealed Tactic Catalog identity is present'
  );

  expectReject(
    {
      ...input,
      baseline: { ...input.baseline, tacticCatalogVersion: '1.2.0', tacticCatalogSha256: hash },
      allowedTactics: [{ tacticHandle: 'tactic_001', tacticId: 'GOV-PUR-001', tacticVersion: '1.0.0', catalogVersion: '1.1.0' }]
    },
    'belongs to catalog 1.1.0; expected 1.2.0'
  );

  console.log(JSON.stringify({
    status: 'PASS',
    planId: first.planId,
    planSha256: first.planSha256,
    tacticCatalogIdentityPairing: 'PASS',
    tacticUniverseWithoutCatalog: 'REJECTED',
    tacticCatalogVersionDrift: 'REJECTED'
  }, null, 2));
}

main();
