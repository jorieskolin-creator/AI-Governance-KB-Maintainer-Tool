import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirReferenceMappingOutput } from '../cognitive/sir-reference-mapping-contract.js';
import { buildSirReferenceMappingContract } from '../cognitive/sir-reference-mapping-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { materializeSirFindings } from './finding-materializer.js';
import { materializeSirReferenceMappings } from './reference-mapping-materializer.js';
import { validateSirReferenceMappingCompletion } from '../validation/sir-reference-mapping-completion.js';

const hash='a'.repeat(64);
const plan=buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-reference',baselineSha256:hash,productionContractVersion:'1.0.0',productionContractSha256:hash,capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:hash,antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:hash,sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:hash,sourceRegisterVersion:'1.5.0',sourceRegisterSha256:hash,tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:hash},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},
  allowedSources:[],allowedTactics:[],
  adjacentCriteria:[
    {criterionHandle:'criterion_001',criterionId:'AP-A2',boundarySummary:'Paired anti-pattern boundary.'},
    {criterionHandle:'criterion_002',criterionId:'A2',boundarySummary:'Paired capability boundary.'},
    {criterionHandle:'criterion_003',criterionId:'A1',boundarySummary:'Purpose-boundary dependency.'},
    {criterionHandle:'criterion_004',criterionId:'A3',boundarySummary:'Responsibility-allocation dependency.'}
  ]
});

const findings=materializeSirFindings({
  capabilityFindings:[{title:'Capability finding with bounded traceability.',eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Constrain progression pending evidence.',humanLockRequired:true}],
  antipatternFindings:[{title:'Anti-pattern finding with bounded traceability.',eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Require human review before progression.',humanLockRequired:true}],
  findingLogicNotes:['Findings remain reusable knowledge definitions.']
});

const contract=buildSirReferenceMappingContract({
  authoringPlan:plan,
  pairBoundary:{
    capability:{canonicalDefinition:'Bounded A2 capability definition.',governancePurpose:'Govern proportionate evidence-based AI selection.',distinctClaim:'A2 owns AI suitability and proportionality.',ownedTopics:['AI suitability'],excludedTopics:['Purpose definition']},
    antipattern:{canonicalDefinition:'Bounded AP-A2 anti-pattern definition.',pairedRelationship:'AP-A2 captures failure of evidence-based suitability.'},
    boundaryRationale:'Pair ownership remains explicit.'
  },
  findings,
  categoryBaseline:{criterion:'A2 baseline'},
  goldenReference:{reference_id:'A1_AP-A1',normative:false}
});
const completed=new Set<CognitiveTaskType>(contract.upstreamTaskTypes);
const validOutput:SirReferenceMappingOutput={
  capabilityRelatedCriterionHandles:['criterion_001','criterion_003'],
  antipatternRelatedCriterionHandles:['criterion_002','criterion_004'],
  referenceNotes:['Related criteria are selected only where the bounded ownership relationship is material.']
};

function validate(output:unknown,currentContract=contract){
  return validateSirReferenceMappingCompletion(currentContract,completed,output,{runId:'reference-mapping-regression',expectedPairId:plan.identity.pairId});
}
function expectCheck(output:unknown,checkId:string):void{
  const report=validate(output);
  if(report.passed||!report.findings.some(item=>item.checkId===checkId)) {
    throw new Error(`Expected Reference Mapping rejection ${checkId}; received ${report.findings.map(item=>item.checkId).join(', ')}`);
  }
}

if(!validate(validOutput).passed) throw new Error('Valid Reference Mapping SIR failed regression.');

expectCheck({...validOutput,capabilityRelatedCriterionHandles:['criterion_999']},'SIR_REFERENCE_UNKNOWN_CRITERION_HANDLE');
expectCheck({...validOutput,capabilityRelatedCriterionHandles:['criterion_003','criterion_003']},'SIR_REFERENCE_DUPLICATE_CRITERION_HANDLE');
expectCheck({...validOutput,capabilityRelatedCriterionHandles:['criterion_002']},'SIR_REFERENCE_SELF_REFERENCE');
expectCheck({...validOutput,antipatternRelatedCriterionHandles:['criterion_001']},'SIR_REFERENCE_SELF_REFERENCE');
expectCheck({...validOutput,capabilityTacticRefs:['GOV-PUR-001']} as unknown,'SIR_REFERENCE_OUTPUT_CONTRACT');
expectCheck({capabilityRelatedCriteria:['A1'],antipatternRelatedCriterionHandles:[],referenceNotes:[]} as unknown,'SIR_REFERENCE_OUTPUT_CONTRACT');

const materialized=materializeSirReferenceMappings(validOutput,plan);
if(materialized.capabilityRelatedCriteria[0]?.criterionId!=='AP-A2'||materialized.capabilityRelatedCriteria[1]?.criterionId!=='A1') {
  throw new Error('Reference materializer did not resolve capability criterion handles deterministically.');
}
if(materialized.antipatternRelatedCriteria[0]?.criterionId!=='A2'||materialized.antipatternRelatedCriteria[1]?.criterionId!=='A3') {
  throw new Error('Reference materializer did not resolve anti-pattern criterion handles deterministically.');
}
if(materialized.capabilityTacticRefs.length!==0||materialized.antipatternTacticRefs.length!==0) {
  throw new Error('Reference materializer emitted tactic refs without an approved reciprocal mapping packet.');
}

const catalogPlan=buildAuthoringPlan({
  identity:plan.identity,targetVersion:plan.targetVersion,schemaVersion:plan.schemaVersion,
  baseline:{...plan.baseline,tacticCatalogVersion:'1.2.0',tacticCatalogSha256:'b'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:plan.vocabulary,allowedSources:[],allowedTactics:[],adjacentCriteria:plan.adjacentCriteria
});
let catalogRejected=false;
try {
  buildSirReferenceMappingContract({authoringPlan:catalogPlan,pairBoundary:contract.lockedInputs.pair_boundary as any,findings,categoryBaseline:{criterion:'A2 baseline'},goldenReference:{reference_id:'A1_AP-A1',normative:false}});
} catch (error) {
  catalogRejected=String(error).includes('approved reciprocal tactic-mapping packet');
}
if(!catalogRejected) throw new Error('Reference contract did not fail closed when a sealed tactic catalog lacked a reciprocal mapping packet.');

console.log(JSON.stringify({
  referenceMappingSir:'PASS',
  pairedCounterpartRelatedCriterion:'ALLOWED',
  deterministicCriterionIdentity:'PASS',
  unknownCriterionHandle:'REJECTED',
  duplicateCriterionHandle:'REJECTED',
  selfReference:'REJECTED',
  modelAuthoredTacticRefs:'REJECTED',
  modelAuthoredCanonicalCriterionIds:'REJECTED',
  noApprovedTacticAvailableProducesEmptyRefs:'PASS',
  sealedCatalogWithoutReciprocalPacket:'REJECTED'
},null,2));
