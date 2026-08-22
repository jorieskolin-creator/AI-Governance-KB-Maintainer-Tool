import { buildAuthoringPlan, type AuthoringPlanInput } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { buildSourceContextPacket } from './source-context-packet.js';
import { resolveSirTaskContract } from './sir-contract-resolver.js';
import type { CompletedTaskArtifact } from './store.js';

const planInput: AuthoringPlanInput = {
  identity: {
    capabilityId: 'A2', antipatternId: 'AP-A2', pairId: 'A2_AP-A2', domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'AI suitability, proportionality and value hypothesis',
    antipatternTitle: 'AI-first solutionism or value theatre'
  },
  targetVersion: '1.0.0', schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-source-resolver', baselineSha256: 'a'.repeat(64),
    productionContractVersion: '1.0.0', productionContractSha256: 'b'.repeat(64),
    capabilitySchemaVersion: '2.1.0', capabilitySchemaSha256: 'c'.repeat(64),
    antipatternSchemaVersion: '2.1.0', antipatternSchemaSha256: 'd'.repeat(64),
    sharedDefinitionsVersion: '2.1.0', sharedDefinitionsSha256: 'e'.repeat(64),
    sourceRegisterVersion: '1.5.0', sourceRegisterSha256: 'f'.repeat(64),
    tacticCatalogVersion: null, tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1', goldenReferenceVersion: '1.0.0', goldenReferenceSha256: '1'.repeat(64)
  },
  questionDimensions: ['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary: {
    technicalAssurance: ['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],
    antipatternConclusionStates: ['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],
    hardGateEffects: ['NONE','WARN','BLOCK','CONSTRAIN'],
    lifecycleStages: ['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']
  },
  allowedSources: [
    { sourceHandle:'source_001', sourceId:'SRC-EU-AIA', versionOrDate:'2024-07-12', verificationStatus:'VERIFIED', lastVerifiedDate:'2026-08-18' }
  ],
  allowedTactics: [], adjacentCriteria: []
};

const plan = buildAuthoringPlan(planInput);
const artifacts = new Map<CognitiveTaskType, CompletedTaskArtifact>();

function persistedContract(taskType: CognitiveTaskType, version = '2.0.0'): TaskContract {
  return {
    contractVersion: version,
    taskId: `${plan.identity.pairId}:${taskType}:persisted`,
    taskType,
    targetObjectId: plan.identity.pairId,
    objective: 'Dependency resolver fixture only.',
    modelRole: 'REASONER', upstreamTaskTypes: [],
    lockedInputs: { authoring_plan_sha256: plan.planSha256 },
    allowedReferences: [], doNot: [],
    outputContract: { format:'JSON', schemaName:'PersistedFixture', requiredFields:[], additionalProperties:false },
    validationProfile: [], dependencyPaths: [], failureMode:'FAIL_CLOSED'
  };
}

function put(taskType: CognitiveTaskType, output: unknown, version = '2.0.0'): void {
  artifacts.set(taskType, {
    output,
    taskContract: persistedContract(taskType, version),
    inputHash:`input-${taskType}`,
    outputHash:`output-${taskType}`
  });
}

put('PAIR_BOUNDARY', { capability:{}, antipattern:{} });
put('AP_FAILURE_MODEL', { failureMechanism:'fixture' });
put('APPLICABILITY', { capability:{}, antipattern:{} });
put('PRIMARY_QUESTIONS', { capabilityQuestions:[], antipatternQuestions:[] });
put('ATOMIC_DECOMPOSITION', { capability:[{handle:'atomic_001'}], antipattern:[{handle:'atomic_001'}] });
put('EVIDENCE_ARCHITECTURE', { capability:[{handle:'evidence_001'}], antipattern:[{handle:'evidence_001'}] });
put('EVIDENCE_SAFETY', { capabilityRules:{}, antipatternRules:{} });
put('AP_ABSENCE_CONTRACT', { requiredArtifacts:['fixture'], interpretationBoundary:'fixture boundary' });

function buildPacket(authoringPlan = plan) {
  return buildSourceContextPacket({
    authoringPlan,
    sealedSourceRegisterVersion:'1.5.0',
    sealedSourceRegisterSha256:'f'.repeat(64),
    registerRecords:[{
      sourceId:'SRC-EU-AIA', versionOrDate:'2024-07-12', verificationStatus:'VERIFIED', lastVerifiedDate:'2026-08-18',
      effectiveStatus:'IN_FORCE', authorityTier:'PRIMARY_BINDING_AUTHORITY', authorityType:'LEGISLATION',
      officialLocation:'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
      applicabilityBoundary:'Apply article-by-article according to actor role, classification, jurisdiction, use and date.',
      licensingBoundary:'Official legislation may be used within bounded source-context rules.',
      domainCoverage:['A'], modelContextPolicy:'BOUNDED_SNIPPET_ALLOWED', usageRightsReference:null
    }],
    locatorContexts:[{
      sourceId:'SRC-EU-AIA', locator:'Article 9(2)', locatorLabel:'Risk-management process',
      contextText:'Risk management is a continuous iterative lifecycle process.'
    }]
  });
}

const sourcePacket = buildPacket();
const loadArtifact = async <T>(_pairRunId:string, taskType:CognitiveTaskType) =>
  artifacts.get(taskType) as CompletedTaskArtifact<T> | undefined;
const base = {
  pairRunId:'pair-run-source-resolver', authoringPlan:plan,
  categoryBaseline:{criterion:'A2'}, goldenReference:{reference_id:'A1_AP-A1',normative:false},
  sourceContextPacket:sourcePacket, loadArtifact
};

const resolved = await resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING' });
if (resolved.taskType !== 'SOURCE_MAPPING' || resolved.contractVersion !== '2.0.0') {
  throw new Error('Resolver did not construct SOURCE_MAPPING SIR v2 contract.');
}
if (resolved.lockedInputs.source_context_packet_sha256 !== sourcePacket.packetSha256) {
  throw new Error('Resolver lost Source Context Packet hash binding.');
}
const packetInContract = resolved.lockedInputs.source_context_packet as any;
if (packetInContract.sources?.[0]?.locatorContexts?.[0]?.locatorHandle !== 'locator_001') {
  throw new Error('Resolver did not propagate deterministic locator context.');
}

async function expectReject(fn:()=>Promise<unknown>, expected:string):Promise<void> {
  try { await fn(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw new Error(`Expected ${expected}; received ${message}`);
    return;
  }
  throw new Error(`Expected rejection containing ${expected}, but resolution succeeded.`);
}

await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING', sourceContextPacket:undefined }),
  'requires a Source Context Packet'
);

const tampered = structuredClone(sourcePacket);
tampered.sources[0]!.locatorContexts[0]!.exactLocator = 'Article 999';
await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING', sourceContextPacket:tampered }),
  'hash mismatch'
);

const otherPlan = buildAuthoringPlan({ ...planInput, targetVersion:'1.0.1' });
const foreignPacket = buildPacket(otherPlan);
await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING', sourceContextPacket:foreignPacket }),
  'different Authoring Plan'
);

const originalAbsence = artifacts.get('AP_ABSENCE_CONTRACT')!;
artifacts.set('AP_ABSENCE_CONTRACT', {
  ...originalAbsence,
  taskContract:persistedContract('AP_ABSENCE_CONTRACT','1.0.0')
});
await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING' }),
  'SIR v2 requires 2.0.0'
);
artifacts.set('AP_ABSENCE_CONTRACT', originalAbsence);

console.log(JSON.stringify({
  sourceMappingResolver:'PASS',
  persistedUpstreamCompatibility:'PASS',
  sourceContextVerifier:'PASS',
  deterministicLocatorPropagation:'PASS',
  missingSourcePacket:'REJECTED',
  tamperedSourcePacket:'REJECTED',
  foreignAuthoringPlanPacket:'REJECTED',
  legacyApAbsenceDependency:'REJECTED'
}, null, 2));
