import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { materializeSirSourceMappings } from '../sir/source-mapping-materializer.js';
import { buildSourceContextPacket } from './source-context-packet.js';
import { resolveSirTaskContract } from './sir-contract-resolver.js';
import type { CompletedTaskArtifact } from './store.js';

const plan = buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-finding-resolver',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},
  allowedSources:[{sourceHandle:'source_001',sourceId:'SRC-EU-AIA',versionOrDate:'2024-07-12',verificationStatus:'VERIFIED',lastVerifiedDate:'2026-08-18'}],
  allowedTactics:[],adjacentCriteria:[]
});

const sourcePacket = buildSourceContextPacket({
  authoringPlan:plan,
  sealedSourceRegisterVersion:'1.5.0',
  sealedSourceRegisterSha256:'f'.repeat(64),
  registerRecords:[{
    sourceId:'SRC-EU-AIA',versionOrDate:'2024-07-12',verificationStatus:'VERIFIED',lastVerifiedDate:'2026-08-18',
    effectiveStatus:'IN_FORCE',authorityTier:'PRIMARY_BINDING_AUTHORITY',authorityType:'LEGISLATION',
    officialLocation:'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
    applicabilityBoundary:'Apply article-by-article according to role, system classification, jurisdiction, use and transition date.',
    licensingBoundary:'Official legislation may be used within bounded source-context rules.',
    domainCoverage:['A'],modelContextPolicy:'BOUNDED_SNIPPET_ALLOWED',usageRightsReference:null
  }],
  locatorContexts:[{
    sourceId:'SRC-EU-AIA',locator:'Article 9(2)',locatorLabel:'Risk-management process',
    contextText:'The risk management system is a continuous iterative process planned and run throughout the lifecycle.'
  }]
});

const materializedSourceMappings = materializeSirSourceMappings({
  capabilityMappings:[{
    sourceHandle:'source_001',locatorHandle:'locator_001',relationship:'BINDING_LAW_WHEN_APPLICABLE',
    supportedClaim:'The mapped source provides bounded support for the governed category claim.',
    categoryRationale:'The selected provision is relevant to the bounded governance subject when legally applicable.',
    applicabilityConditions:['Apply only when the provision is legally applicable to the governed context.'],
    exclusions:['Do not infer compliance or applicability merely from this mapping.']
  }],
  antipatternMappings:[],unmappedClaims:[],mappingNotes:['Factual support remains subject to downstream quality validation.']
},sourcePacket);

const artifacts = new Map<CognitiveTaskType,CompletedTaskArtifact>();
function contract(
  taskType:CognitiveTaskType,
  version='2.0.0',
  extraLockedInputs:Record<string,unknown>={}
):TaskContract {
  return {
    contractVersion:version,taskId:`${plan.identity.pairId}:${taskType}:fixture`,taskType,
    targetObjectId:plan.identity.pairId,objective:'Resolver dependency fixture.',modelRole:'REASONER',
    upstreamTaskTypes:[],lockedInputs:{authoring_plan_sha256:plan.planSha256,...extraLockedInputs},
    allowedReferences:[],doNot:[],outputContract:{format:'JSON',schemaName:'Fixture',requiredFields:[],additionalProperties:false},
    validationProfile:[],dependencyPaths:[],failureMode:'FAIL_CLOSED'
  };
}
function put(
  taskType:CognitiveTaskType,
  output:unknown,
  options:{version?:string;outputHash?:string;extraLockedInputs?:Record<string,unknown>}={}
):void {
  artifacts.set(taskType,{
    output,
    taskContract:contract(taskType,options.version??'2.0.0',options.extraLockedInputs??{}),
    inputHash:`input-${taskType}`,
    outputHash:options.outputHash??`hash-${taskType}`
  });
}

put('PAIR_BOUNDARY',{capability:{},antipattern:{}});
put('AP_FAILURE_MODEL',{failureMechanism:'fixture'});
put('APPLICABILITY',{capability:{},antipattern:{}});
put('PRIMARY_QUESTIONS',{capabilityQuestions:[],antipatternQuestions:[]});
put('ATOMIC_DECOMPOSITION',{capability:[{handle:'atomic_001'}],antipattern:[{handle:'atomic_001'}]});
put('EVIDENCE_ARCHITECTURE',{capability:[{handle:'evidence_001',supportsAtomicHandles:['atomic_001']}],antipattern:[{handle:'evidence_001',supportsAtomicHandles:['atomic_001']}]});
put('EVIDENCE_SAFETY',{capabilityRules:{},antipatternRules:{}});
put('AP_ABSENCE_CONTRACT',{requiredArtifacts:['fixture artifact'],interpretationBoundary:'Validated absence boundary fixture.'});
put('SOURCE_MAPPING',materializedSourceMappings,{
  extraLockedInputs:{
    source_context_packet_sha256:sourcePacket.packetSha256,
    source_context_packet:sourcePacket
  }
});

const loadArtifact = async <T>(_pairRunId:string,taskType:CognitiveTaskType)=>artifacts.get(taskType) as CompletedTaskArtifact<T>|undefined;
const base={pairRunId:'pair-run-finding-resolver',authoringPlan:plan,categoryBaseline:{criterion:'A2'},goldenReference:{reference_id:'A1_AP-A1'},loadArtifact};

const resolved = await resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'});
if (resolved.taskType!=='FINDING_ARCHITECTURE'||resolved.contractVersion!=='2.0.0') throw new Error('Resolver did not construct Finding SIR v2 contract.');
const lockedSource = resolved.lockedInputs.source_mappings as typeof materializedSourceMappings;
if (lockedSource.sourceContextPacketSha256!==sourcePacket.packetSha256||lockedSource.capability[0]?.exactLocator!=='Article 9(2)') {
  throw new Error('Finding contract did not receive verified materialized Source Mapping artifact.');
}
if ('source_context_packet' in resolved.lockedInputs) throw new Error('Finding contract should not reopen the full Source Context Packet.');

async function expectReject(fn:()=>Promise<unknown>,expected:string):Promise<void>{
  try{await fn();}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.includes(expected))throw new Error(`Expected ${expected}; received ${message}`);return;}throw new Error(`Expected rejection containing ${expected}.`);
}

const originalSource=artifacts.get('SOURCE_MAPPING')!;

artifacts.set('SOURCE_MAPPING',{...originalSource,taskContract:contract('SOURCE_MAPPING','1.0.0',{
  source_context_packet_sha256:sourcePacket.packetSha256,source_context_packet:sourcePacket
})});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'SIR v2 requires 2.0.0');
artifacts.set('SOURCE_MAPPING',originalSource);

artifacts.set('SOURCE_MAPPING',{...originalSource,outputHash:''});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'has no persisted output hash');
artifacts.set('SOURCE_MAPPING',originalSource);

artifacts.set('SOURCE_MAPPING',{
  ...originalSource,
  output:{capabilityMappings:[{sourceHandle:'source_001',locatorHandle:'locator_001'}],antipatternMappings:[],unmappedClaims:[],mappingNotes:[]}
});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'not bound to its Source Context Packet hash');
artifacts.set('SOURCE_MAPPING',originalSource);

const tamperedOutput=structuredClone(materializedSourceMappings);
tamperedOutput.capability[0]!.exactLocator='Article 999';
artifacts.set('SOURCE_MAPPING',{...originalSource,output:tamperedOutput});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'exact locator drifted');
artifacts.set('SOURCE_MAPPING',originalSource);

artifacts.set('SOURCE_MAPPING',{
  ...originalSource,
  taskContract:contract('SOURCE_MAPPING','2.0.0',{
    source_context_packet_sha256:'wrong-packet-hash',
    source_context_packet:sourcePacket
  })
});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'hash binding is inconsistent');
artifacts.set('SOURCE_MAPPING',originalSource);

artifacts.set('SOURCE_MAPPING',{
  ...originalSource,
  taskContract:contract('SOURCE_MAPPING','2.0.0',{
    source_context_packet_sha256:sourcePacket.packetSha256
  })
});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'has no locked Source Context Packet');
artifacts.set('SOURCE_MAPPING',originalSource);

console.log(JSON.stringify({
  findingResolver:'PASS',
  verifiedMaterializedSourceMappingDependency:'PASS',
  sourceContextPacketReopenInFindingPrompt:'PROHIBITED',
  legacySourceMappingDependency:'REJECTED',
  missingSourceMappingOutputHash:'REJECTED',
  rawSemanticSourceMapping:'REJECTED',
  tamperedMaterializedSourceMapping:'REJECTED',
  sourceMappingPacketHashDrift:'REJECTED',
  missingLockedSourceContextPacket:'REJECTED'
},null,2));
