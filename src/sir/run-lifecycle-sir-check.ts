import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirLifecycleAssuranceOutput } from '../cognitive/sir-lifecycle-contract.js';
import { buildSirLifecycleAssuranceContract } from '../cognitive/sir-lifecycle-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { materializeSirLifecycleTargets } from './lifecycle-materializer.js';
import { validateSirLifecycleCompletion } from '../validation/sir-lifecycle-completion.js';

const plan = buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-lifecycle',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{
    technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],
    humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],
    capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],
    antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],
    hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],
    lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']
  },
  allowedSources:[],allowedTactics:[],adjacentCriteria:[]
});

const findings = {
  capability:[{handle:'finding_001',title:'Capability finding.',eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Constrain progression pending evidence.',humanLockRequired:true}],
  antipattern:[{handle:'finding_001',title:'Anti-pattern finding.',eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN','TESTED_ABSENT'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Require human review before progression.',humanLockRequired:true}],
  findingLogicNotes:['Findings remain reusable knowledge definitions.']
};

const evidence = {
  capability:[{handle:'evidence_001',title:'Capability evidence',claimSupported:'Bounded capability claim.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence is attributable.'],limitations:['Presence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}],
  antipattern:[{handle:'evidence_001',title:'Anti-pattern evidence',claimSupported:'Bounded anti-pattern claim.',evidenceClass:'TEST_RECORD',minimumTechnicalAssurance:'TESTED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence covers the defined scope.'],limitations:['Silence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}]
};

const evidenceSafety = {
  capabilityRules:{evidenceCeilings:['Capability ceiling.'],falsePositiveGuards:['Capability guard.'],prohibitedInferences:['Capability prohibited inference.'],contradictionHandling:['Capability contradiction rule.'],freshnessRules:['Capability freshness rule.']},
  antipatternRules:{evidenceCeilings:['AP ceiling.'],falsePositiveGuards:['AP guard.'],prohibitedInferences:['AP prohibited inference.'],contradictionHandling:['AP contradiction rule.'],freshnessRules:['AP freshness rule.']},
  crossPairSafetyNotes:['Conclusions remain evidence-bounded.']
};

const apAbsence = {
  requiredArtifacts:['Scoped executed absence test','Independent verification record'],
  interpretationBoundary:'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'
};

const controlBoundary = {
  capabilityHardGate:{effect:'WARN' as const,conditions:['Evidence gap remains unresolved.'],overrideAuthority:'Named human governance authority.'},
  antipatternHardGate:{effect:'BLOCK' as const,conditions:['The governed failure mechanism is confirmed present.'],overrideAuthority:'Named human governance authority.'},
  capabilityRuntimeBoundary:{machineMay:['Summarize validated evidence.'],machineMustNot:['Approve lifecycle progression.'],humanAuthorityRequiredFor:['Lifecycle progression decision.']},
  antipatternRuntimeBoundary:{machineMay:['Surface validated failure indicators.'],machineMustNot:['Declare residual risk accepted.'],humanAuthorityRequiredFor:['Residual-risk decision.']},
  controlNotes:['Machine reasoning supports analysis but never authorizes lifecycle transitions.']
};

const contract = buildSirLifecycleAssuranceContract({
  authoringPlan:plan,
  pairBoundary:{
    capability:{canonicalDefinition:'Bounded capability definition.',governancePurpose:'Bounded governance purpose.',distinctClaim:'Distinct capability claim.',ownedTopics:['Owned topic'],excludedTopics:[]},
    antipattern:{canonicalDefinition:'Bounded anti-pattern definition.',pairedRelationship:'The anti-pattern captures failure of the paired capability.'},
    boundaryRationale:'The pair boundary is explicit.'
  },
  evidence,
  evidenceSafety,
  apAbsence,
  findings,
  controlBoundary,
  categoryBaseline:{criterion:'A2 baseline'},
  goldenReference:{reference_id:'A1_AP-A1',normative:false}
});

const completed = new Set<CognitiveTaskType>(contract.upstreamTaskTypes);
const validTarget = {minimumTechnicalAssurance:'TESTED' as const,requiredHumanAssurance:'HUMAN_VALIDATED' as const};
const validOutput:SirLifecycleAssuranceOutput = {
  capabilityTargets:plan.vocabulary.lifecycleStages.map(()=>({...validTarget})),
  antipatternTargets:plan.vocabulary.lifecycleStages.map(()=>({...validTarget})),
  rationaleNotes:['Assurance targets are category-specific reusable knowledge expectations and do not authorize a real-system transition.']
};

function expectPass(output:unknown):void {
  const report=validateSirLifecycleCompletion(contract,completed,output,{runId:'lifecycle-sir-regression',expectedPairId:plan.identity.pairId});
  if(!report.passed) throw new Error(`Expected lifecycle validation PASS; received ${report.findings.map(item=>item.checkId).join(', ')}`);
}

function expectReject(output:unknown,expectedCheck:string,overrideContract=contract):void {
  const report=validateSirLifecycleCompletion(overrideContract,completed,output,{runId:'lifecycle-sir-regression',expectedPairId:plan.identity.pairId});
  if(report.passed) throw new Error(`Expected lifecycle rejection ${expectedCheck}, but validation passed.`);
  if(!report.findings.some(item=>item.checkId===expectedCheck)) {
    throw new Error(`Expected lifecycle rejection ${expectedCheck}; received ${report.findings.map(item=>item.checkId).join(', ')}`);
  }
}

expectPass(validOutput);

const wrongCount=structuredClone(validOutput);
wrongCount.capabilityTargets.pop();
expectReject(wrongCount,'SIR_LIFECYCLE_CAPABILITY_TARGET_COUNT');

const modelOwnedStage=structuredClone(validOutput) as any;
modelOwnedStage.capabilityTargets[0].lifecycleStage='QUALIFICATION_AND_REGISTRATION';
expectReject(modelOwnedStage,'SIR_LIFECYCLE_OUTPUT_CONTRACT');

const modelOwnedIdentity=structuredClone(validOutput) as any;
modelOwnedIdentity.capabilityId='A2';
expectReject(modelOwnedIdentity,'SIR_LIFECYCLE_OUTPUT_CONTRACT');

const narrowedVocabulary=structuredClone(contract);
narrowedVocabulary.lockedInputs.governed_technical_assurance_vocabulary=['DECLARED'];
expectReject(validOutput,'SIR_LIFECYCLE_TECHNICAL_ASSURANCE_NOT_GOVERNED',narrowedVocabulary);

const missingControl=structuredClone(contract);
delete missingControl.lockedInputs.control_boundary;
expectReject(validOutput,'SIR_LIFECYCLE_CONTROL_BOUNDARY_REQUIRED',missingControl);

const materialized=materializeSirLifecycleTargets(validOutput,plan.vocabulary.lifecycleStages);
if(materialized.capability.length!==plan.vocabulary.lifecycleStages.length||materialized.antipattern.length!==plan.vocabulary.lifecycleStages.length) {
  throw new Error('Lifecycle materializer lost governed stage cardinality.');
}
plan.vocabulary.lifecycleStages.forEach((stage,index)=>{
  if(materialized.capability[index]?.lifecycleStage!==stage||materialized.antipattern[index]?.lifecycleStage!==stage) {
    throw new Error(`Lifecycle materializer stage identity drift at index ${index}.`);
  }
});

let mismatchRejected=false;
try {
  materializeSirLifecycleTargets({...validOutput,capabilityTargets:validOutput.capabilityTargets.slice(0,-1)},plan.vocabulary.lifecycleStages);
} catch (error) {
  mismatchRejected=String(error).includes('does not match governed lifecycle stage count');
}
if(!mismatchRejected) throw new Error('Lifecycle materializer did not reject target/stage cardinality mismatch.');

console.log(JSON.stringify({
  lifecycleSir:'PASS',
  identityFreeModelOutput:'PASS',
  governedStageCardinality:'PASS',
  governedAssuranceVocabulary:'PASS',
  controlDependencyRequired:'PASS',
  modelOwnedStageIdentity:'REJECTED',
  modelOwnedCanonicalIdentity:'REJECTED',
  deterministicLifecycleStageMaterialization:'PASS',
  materializationCardinalityMismatch:'REJECTED'
},null,2));
