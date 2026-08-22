import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { materializeSirFindings } from '../sir/finding-materializer.js';
import { materializeSirSourceMappings } from '../sir/source-mapping-materializer.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import { buildSourceContextPacket } from './source-context-packet.js';
import { resolveSirTaskContract } from './sir-contract-resolver.js';
import type { CompletedTaskArtifact } from './store.js';

const plan=buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-lifecycle-resolver',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},
  allowedSources:[{sourceHandle:'source_001',sourceId:'SRC-EU-AIA',versionOrDate:'2024-07-12',verificationStatus:'VERIFIED',lastVerifiedDate:'2026-08-18'}],allowedTactics:[],adjacentCriteria:[]
});

const atomics={
  capability:[{handle:'atomic_001',questionSlot:1,statement:'Capability atomic criterion.',evidenceNeed:'Capability evidence need.'}],
  antipattern:[{handle:'atomic_001',questionSlot:1,statement:'Anti-pattern atomic test.',evidenceNeed:'Anti-pattern evidence need.'}]
};
const evidence={
  capability:[{handle:'evidence_001',title:'Capability evidence',claimSupported:'Capability evidence supports the governed claim.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence is attributable.'],limitations:['Document presence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}],
  antipattern:[{handle:'evidence_001',title:'Anti-pattern evidence',claimSupported:'Anti-pattern evidence supports the governed failure claim.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence covers the failure chronology.'],limitations:['Silence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}]
};
const evidenceSafety={
  capabilityRules:{evidenceCeilings:['Intent does not prove effectiveness.'],falsePositiveGuards:['Require attributable evidence.'],prohibitedInferences:['Do not infer approval.'],contradictionHandling:['Conflicts keep conclusions unresolved.'],freshnessRules:['Evidence must remain current.']},
  antipatternRules:{evidenceCeilings:['Concern alone does not establish the failure mechanism.'],falsePositiveGuards:['Distinguish ordinary maturity gaps.'],prohibitedInferences:['Do not infer absence from silence.'],contradictionHandling:['Conflicts prevent definitive absence.'],freshnessRules:['Absence evidence must remain current.']},
  crossPairSafetyNotes:['Pair conclusions remain independent.']
};
const apAbsence={requiredArtifacts:['Scoped executed absence test','Independent verification record'],interpretationBoundary:'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'};

const sourcePacket=buildSourceContextPacket({
  authoringPlan:plan,sealedSourceRegisterVersion:'1.5.0',sealedSourceRegisterSha256:'f'.repeat(64),
  registerRecords:[{sourceId:'SRC-EU-AIA',versionOrDate:'2024-07-12',verificationStatus:'VERIFIED',lastVerifiedDate:'2026-08-18',effectiveStatus:'IN_FORCE',authorityTier:'PRIMARY_BINDING_AUTHORITY',authorityType:'LEGISLATION',officialLocation:'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',applicabilityBoundary:'Apply article-by-article according to role, classification, jurisdiction, use and transition date.',licensingBoundary:'Official legislation may be used within bounded context rules.',domainCoverage:['A'],modelContextPolicy:'BOUNDED_SNIPPET_ALLOWED',usageRightsReference:null}],
  locatorContexts:[{sourceId:'SRC-EU-AIA',locator:'Article 9(2)',locatorLabel:'Risk management process',contextText:'Risk management is a continuous iterative lifecycle process.'}]
});
const sourceMappings=materializeSirSourceMappings({
  capabilityMappings:[{sourceHandle:'source_001',locatorHandle:'locator_001',relationship:'BINDING_LAW_WHEN_APPLICABLE',supportedClaim:'The provision supplies bounded support for the category claim.',categoryRationale:'The provision is relevant to the governed subject when legally applicable.',applicabilityConditions:['Apply only when legally applicable.'],exclusions:['Do not infer compliance from mapping.']}],
  antipatternMappings:[],unmappedClaims:[],mappingNotes:['Factual support remains subject to downstream quality validation.']
},sourcePacket);

const findings=materializeSirFindings({
  capabilityFindings:[{title:'Suitability evidence is insufficient for the governed claim.',eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Progression remains constrained until evidence is resolved.',humanLockRequired:true}],
  antipatternFindings:[{title:'Solution-first decision logic may be present.',eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN','TESTED_ABSENT'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Human review is required before progression.',humanLockRequired:true}],
  findingLogicNotes:['Findings are reusable knowledge definitions.']
});

const artifacts=new Map<CognitiveTaskType,CompletedTaskArtifact>();
function taskContract(taskType:CognitiveTaskType,extra:Record<string,unknown>={},version='2.0.0'):TaskContract{
  return {contractVersion:version,taskId:`A2_AP-A2:${taskType}:fixture`,taskType,targetObjectId:'A2_AP-A2',objective:'Lifecycle resolver fixture.',modelRole:'REASONER',upstreamTaskTypes:[],lockedInputs:{authoring_plan_sha256:plan.planSha256,...extra},allowedReferences:[],doNot:[],outputContract:{format:'JSON',schemaName:'Fixture',requiredFields:[],additionalProperties:false},validationProfile:[],dependencyPaths:[],failureMode:'FAIL_CLOSED'};
}
function put(taskType:CognitiveTaskType,output:unknown,extra:Record<string,unknown>={},version='2.0.0'):void{
  artifacts.set(taskType,{output,taskContract:taskContract(taskType,extra,version),inputHash:`input-${taskType}`,outputHash:canonicalArtifactHash(output)});
}

const pairBoundary={capability:{canonicalDefinition:'Capability boundary definition with sufficient detail.',governancePurpose:'Govern evidence-based suitability decisions.',distinctClaim:'AI selection is proportionate to a defined problem and alternatives.',ownedTopics:['AI suitability'],excludedTopics:[]},antipattern:{canonicalDefinition:'Solution-first selection without proportionate justification.',pairedRelationship:'Failure of evidence-based suitability.'},boundaryRationale:'The boundary is explicit.'};
put('PAIR_BOUNDARY',pairBoundary);
put('AP_FAILURE_MODEL',{failureMechanism:'AI is predetermined before problem and alternatives are bounded.'});
put('APPLICABILITY',{capability:{},antipattern:{}});
put('PRIMARY_QUESTIONS',{capabilityQuestions:[],antipatternQuestions:[]});
put('ATOMIC_DECOMPOSITION',atomics);
put('EVIDENCE_ARCHITECTURE',evidence);
put('EVIDENCE_SAFETY',evidenceSafety);
put('AP_ABSENCE_CONTRACT',apAbsence);
put('SOURCE_MAPPING',sourceMappings,{source_context_packet_sha256:sourcePacket.packetSha256,source_context_packet:sourcePacket});
put('FINDING_ARCHITECTURE',findings,{
  capability_conclusion_states:plan.vocabulary.capabilityConclusionStates,
  antipattern_conclusion_states:plan.vocabulary.antipatternConclusionStates,
  capability_atomics:atomics.capability,
  antipattern_atomics:atomics.antipattern,
  capability_evidence:evidence.capability,
  antipattern_evidence:evidence.antipattern,
  ap_absence_contract:apAbsence
});

const loadArtifact=async<T>(_pairRunId:string,taskType:CognitiveTaskType)=>artifacts.get(taskType) as CompletedTaskArtifact<T>|undefined;
const base={pairRunId:'pair-run-lifecycle-resolver',authoringPlan:plan,categoryBaseline:{criterion:'A2'},goldenReference:{reference_id:'A1_AP-A1',normative:false},loadArtifact};

const controlContract=await resolveSirTaskContract({...base,taskType:'CONTROL_BOUNDARY'});
const controlOutput:SirControlBoundaryOutput={
  capabilityHardGate:{effect:'CONSTRAIN',conditions:['Required suitability evidence remains materially unresolved.'],overrideAuthority:'Designated accountable human authority'},
  antipatternHardGate:{effect:'BLOCK',conditions:['The solution-first failure mechanism is confirmed in a material decision.'],overrideAuthority:'Designated accountable human authority'},
  capabilityRuntimeBoundary:{machineMay:['Summarize validated evidence and surface unresolved finding conditions.'],machineMustNot:['Approve progression or accept residual risk.'],humanAuthorityRequiredFor:['Approve progression, exceptions, or residual-risk acceptance.']},
  antipatternRuntimeBoundary:{machineMay:['Detect and summarize evidence relevant to the defined failure mechanism.'],machineMustNot:['Declare legal compliance or authorize progression.'],humanAuthorityRequiredFor:['Resolve material finding disputes and authorize any progression decision.']},
  controlNotes:['Control semantics define reusable knowledge boundaries and do not authorize a real system.']
};
artifacts.set('CONTROL_BOUNDARY',{output:controlOutput,taskContract:controlContract,inputHash:'input-CONTROL_BOUNDARY',outputHash:canonicalArtifactHash(controlOutput)});

const resolved=await resolveSirTaskContract({...base,taskType:'LIFECYCLE_ASSURANCE'});
if(resolved.taskType!=='LIFECYCLE_ASSURANCE'||resolved.contractVersion!=='2.0.0') throw new Error('Resolver did not construct LIFECYCLE_ASSURANCE SIR v2 contract.');
const lockedStages=resolved.lockedInputs.lifecycle_stage_order as string[];
if(JSON.stringify(lockedStages)!==JSON.stringify(plan.vocabulary.lifecycleStages)) throw new Error('Lifecycle resolver lost Authoring Plan lifecycle stage order.');
if(resolved.lockedInputs.control_boundary!==controlOutput) throw new Error('Lifecycle contract did not receive the verified persisted Control artifact.');
if('source_context_packet' in resolved.lockedInputs||'source_mappings' in resolved.lockedInputs) throw new Error('Lifecycle contract leaked Source Context Packet or source mappings into its prompt boundary.');

async function expectReject(fn:()=>Promise<unknown>,expected:string):Promise<void>{
  try{await fn();}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.includes(expected))throw new Error(`Expected ${expected}; received ${message}`);return;}throw new Error(`Expected rejection containing ${expected}.`);
}

const originalControl=artifacts.get('CONTROL_BOUNDARY')!;
const invalidControl=structuredClone(controlOutput) as any;
invalidControl.capabilityHardGate.effect='MAGIC';
artifacts.set('CONTROL_BOUNDARY',{...originalControl,output:invalidControl,outputHash:canonicalArtifactHash(invalidControl)});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'LIFECYCLE_ASSURANCE'}),'failed deterministic re-validation');
artifacts.set('CONTROL_BOUNDARY',originalControl);

const staleControl=structuredClone(controlOutput);
staleControl.controlNotes=['Tampered after persistence.'];
artifacts.set('CONTROL_BOUNDARY',{...originalControl,output:staleControl});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'LIFECYCLE_ASSURANCE'}),'output hash mismatch');
artifacts.set('CONTROL_BOUNDARY',originalControl);

const driftedContract=structuredClone(controlContract);
const lockedCapabilityFindings=structuredClone(findings.capability);
lockedCapabilityFindings[0]!.title='Drifted locked finding.';
driftedContract.lockedInputs.capability_findings=lockedCapabilityFindings;
artifacts.set('CONTROL_BOUNDARY',{...originalControl,taskContract:driftedContract});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'LIFECYCLE_ASSURANCE'}),'capability Findings drifted');
artifacts.set('CONTROL_BOUNDARY',originalControl);

artifacts.set('CONTROL_BOUNDARY',{...originalControl,taskContract:{...originalControl.taskContract,contractVersion:'1.0.0'}});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'LIFECYCLE_ASSURANCE'}),'SIR v2 requires 2.0.0');
artifacts.set('CONTROL_BOUNDARY',originalControl);

const originalSource=artifacts.get('SOURCE_MAPPING')!;
const tamperedSource=structuredClone(sourceMappings);
tamperedSource.capability[0]!.exactLocator='Article 999';
artifacts.set('SOURCE_MAPPING',{...originalSource,output:tamperedSource,outputHash:canonicalArtifactHash(tamperedSource)});
await expectReject(()=>resolveSirTaskContract({...base,taskType:'LIFECYCLE_ASSURANCE'}),'exact locator drifted');
artifacts.set('SOURCE_MAPPING',originalSource);

console.log(JSON.stringify({
  lifecycleResolver:'PASS',
  authoringPlanStageOrderBinding:'PASS',
  verifiedPersistedControlDependency:'PASS',
  transitiveSourceFindingControlIntegrity:'PASS',
  sourceContextLeakageToLifecyclePrompt:'PROHIBITED',
  invalidControlArtifact:'REJECTED',
  staleControlOutputHash:'REJECTED',
  controlLockedFindingDrift:'REJECTED',
  legacyControlDependency:'REJECTED',
  tamperedUpstreamSourceMapping:'REJECTED'
},null,2));
