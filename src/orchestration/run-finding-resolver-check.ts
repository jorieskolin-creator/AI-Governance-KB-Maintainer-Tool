import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { resolveSirTaskContract } from './sir-contract-resolver.js';
import type { CompletedTaskArtifact } from './store.js';

const plan = buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-finding-resolver',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},
  allowedSources:[],allowedTactics:[],adjacentCriteria:[]
});

const artifacts = new Map<CognitiveTaskType,CompletedTaskArtifact>();
function contract(taskType:CognitiveTaskType,version='2.0.0'):TaskContract {
  return {contractVersion:version,taskId:`${plan.identity.pairId}:${taskType}:fixture`,taskType,targetObjectId:plan.identity.pairId,objective:'Resolver dependency fixture.',modelRole:'REASONER',upstreamTaskTypes:[],lockedInputs:{authoring_plan_sha256:plan.planSha256},allowedReferences:[],doNot:[],outputContract:{format:'JSON',schemaName:'Fixture',requiredFields:[],additionalProperties:false},validationProfile:[],dependencyPaths:[],failureMode:'FAIL_CLOSED'};
}
function put(taskType:CognitiveTaskType,output:unknown,version='2.0.0',outputHash=`hash-${taskType}`):void {
  artifacts.set(taskType,{output,taskContract:contract(taskType,version),inputHash:`input-${taskType}`,outputHash});
}

put('PAIR_BOUNDARY',{capability:{},antipattern:{}});
put('AP_FAILURE_MODEL',{failureMechanism:'fixture'});
put('APPLICABILITY',{capability:{},antipattern:{}});
put('PRIMARY_QUESTIONS',{capabilityQuestions:[],antipatternQuestions:[]});
put('ATOMIC_DECOMPOSITION',{capability:[{handle:'atomic_001'}],antipattern:[{handle:'atomic_001'}]});
put('EVIDENCE_ARCHITECTURE',{capability:[{handle:'evidence_001',supportsAtomicHandles:['atomic_001']}],antipattern:[{handle:'evidence_001',supportsAtomicHandles:['atomic_001']}]});
put('EVIDENCE_SAFETY',{capabilityRules:{},antipatternRules:{}});
put('AP_ABSENCE_CONTRACT',{requiredArtifacts:['fixture artifact'],interpretationBoundary:'Validated absence boundary fixture.'});
put('SOURCE_MAPPING',{
  sourceContextPacketSha256:'source-packet-hash',
  capability:[{sourceHandle:'source_001',locatorHandle:'locator_001',sourceId:'SRC-EU-AIA',sourceVersionOrDate:'2024-07-12',exactLocator:'Article 9(2)',relationship:'BINDING_LAW_WHEN_APPLICABLE',supportedClaim:'Bounded supported claim fixture.',categoryRationale:'Bounded category rationale fixture.',applicabilityConditions:[],exclusions:[],verificationStatus:'VERIFIED',lastVerifiedDate:'2026-08-18',authorityTier:'PRIMARY_BINDING_AUTHORITY',authorityType:'LEGISLATION',locatorContextSha256:'context-hash'}],
  antipattern:[],unmappedClaims:[],mappingNotes:[]
});

const loadArtifact = async <T>(_pairRunId:string,taskType:CognitiveTaskType)=>artifacts.get(taskType) as CompletedTaskArtifact<T>|undefined;
const base={pairRunId:'pair-run-finding-resolver',authoringPlan:plan,categoryBaseline:{criterion:'A2'},goldenReference:{reference_id:'A1_AP-A1'},loadArtifact};

const resolved = await resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'});
if (resolved.taskType!=='FINDING_ARCHITECTURE'||resolved.contractVersion!=='2.0.0') throw new Error('Resolver did not construct Finding SIR v2 contract.');
const lockedSource = resolved.lockedInputs.source_mappings as any;
if (lockedSource.sourceContextPacketSha256!=='source-packet-hash'||lockedSource.capability?.[0]?.exactLocator!=='Article 9(2)') {
  throw new Error('Finding contract did not receive materialized Source Mapping artifact.');
}
if ('source_context_packet' in resolved.lockedInputs) throw new Error('Finding contract should not reopen the full Source Context Packet.');

async function expectReject(fn:()=>Promise<unknown>,expected:string):Promise<void>{
  try{await fn();}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.includes(expected))throw new Error(`Expected ${expected}; received ${message}`);return;}throw new Error(`Expected rejection containing ${expected}.`);
}

const originalSource=artifacts.get('SOURCE_MAPPING')!;
artifacts.set('SOURCE_MAPPING',{...originalSource,taskContract:contract('SOURCE_MAPPING','1.0.0')});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'SIR v2 requires 2.0.0');
artifacts.set('SOURCE_MAPPING',originalSource);

artifacts.set('SOURCE_MAPPING',{...originalSource,outputHash:''});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'}),'has no persisted output hash');
artifacts.set('SOURCE_MAPPING',originalSource);

const rawSemanticSourceArtifact={...originalSource,output:{capabilityMappings:[{sourceHandle:'source_001',locatorHandle:'locator_001'}],antipatternMappings:[],unmappedClaims:[],mappingNotes:[]}};
artifacts.set('SOURCE_MAPPING',rawSemanticSourceArtifact);
const rawResolved=await resolveSirTaskContract({...base,taskType:'FINDING_ARCHITECTURE'});
const rawLocked=rawResolved.lockedInputs.source_mappings as any;
if (typeof rawLocked.sourceContextPacketSha256==='string') throw new Error('Raw semantic Source Mapping fixture unexpectedly looked materialized.');
artifacts.set('SOURCE_MAPPING',originalSource);

console.log(JSON.stringify({
  findingResolver:'PASS',
  materializedSourceMappingDependency:'PASS',
  sourceContextPacketReopen:'PROHIBITED',
  legacySourceMappingDependency:'REJECTED',
  missingSourceMappingOutputHash:'REJECTED',
  rawSemanticSourceMappingNotMaterialized:true
},null,2));
