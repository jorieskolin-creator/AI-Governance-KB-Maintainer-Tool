import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirApAbsenceOutput } from '../cognitive/sir-ap-absence-contract.js';
import type { SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type { SirEvidenceArchitectureOutput } from '../cognitive/sir-evidence-contract.js';
import type { SirEvidenceSafetyOutput } from '../cognitive/sir-evidence-safety-contract.js';
import type { SirFindingArchitectureOutput } from '../cognitive/sir-finding-contract.js';
import type { SirPairBoundaryOutput } from '../cognitive/sir-initial-contracts.js';
import {
  buildSirLifecycleAssuranceContract,
  type SirLifecycleAssuranceOutput
} from '../cognitive/sir-lifecycle-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { materializeSirEvidence } from './evidence-materializer.js';
import { materializeSirFindings } from './finding-materializer.js';
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

const pairBoundary = {
  capability:{canonicalDefinition:'Bounded capability definition.',governancePurpose:'Bounded governance purpose.',distinctClaim:'Distinct capability claim.',ownedTopics:['Owned topic'],excludedTopics:[]},
  antipattern:{canonicalDefinition:'Bounded anti-pattern definition.',pairedRelationship:'The anti-pattern captures failure of the paired capability.'},
  boundaryRationale:'The pair boundary is explicit.'
} satisfies SirPairBoundaryOutput;

const evidence = materializeSirEvidence({
  capabilityEvidence:[{
    title:'Capability evidence',claimSupported:'Bounded capability claim.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence is attributable.'],limitations:['Presence alone is insufficient.'],supportsAtomicHandles:['atomic_001']
  }],
  antipatternEvidence:[{
    title:'Anti-pattern evidence',claimSupported:'Bounded anti-pattern claim.',evidenceClass:'TEST_RECORD',minimumTechnicalAssurance:'TESTED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence covers the defined scope.'],limitations:['Silence alone is insufficient.'],supportsAtomicHandles:['atomic_001']
  }],
  sufficiencyNotes:['The bounded regression evidence graph is explicit.']
} satisfies SirEvidenceArchitectureOutput);

const findings = materializeSirFindings({
  capabilityFindings:[{
    title:'Capability finding.',eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Constrain progression pending evidence.',humanLockRequired:true
  }],
  antipatternFindings:[{
    title:'Anti-pattern finding.',eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN','TESTED_ABSENT'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Require human review before progression.',humanLockRequired:true
  }],
  findingLogicNotes:['Findings remain reusable knowledge definitions.']
} satisfies SirFindingArchitectureOutput);

const evidenceSafety = {
  capabilityRules:{evidenceCeilings:['Capability ceiling.'],falsePositiveGuards:['Capability guard.'],prohibitedInferences:['Capability prohibited inference.'],contradictionHandling:['Capability contradiction rule.'],freshnessRules:['Capability freshness rule.']},
  antipatternRules:{evidenceCeilings:['AP ceiling.'],falsePositiveGuards:['AP guard.'],prohibitedInferences:['AP prohibited inference.'],contradictionHandling:['AP contradiction rule.'],freshnessRules:['AP freshness rule.']},
  crossPairSafetyNotes:['Conclusions remain evidence-bounded.']
} satisfies SirEvidenceSafetyOutput;

const apAbsence = {
  requiredArtifacts:['Scoped executed absence test','Independent verification record'],
  interpretationBoundary:'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'
} satisfies SirApAbsenceOutput;

const controlBoundary = {
  capabilityHardGate:{effect:'WARN',conditions:['Evidence gap remains unresolved.'],overrideAuthority:'Named human governance authority.'},
  antipatternHardGate:{effect:'BLOCK',conditions:['The governed failure mechanism is confirmed present.'],overrideAuthority:'Named human governance authority.'},
  capabilityRuntimeBoundary:{machineMay:['Summarize validated evidence.'],machineMustNot:['Approve lifecycle progression.'],humanAuthorityRequiredFor:['Lifecycle progression decision.']},
  antipatternRuntimeBoundary:{machineMay:['Surface validated failure indicators.'],machineMustNot:['Declare residual risk accepted.'],humanAuthorityRequiredFor:['Residual-risk decision.']},
  controlNotes:['Machine reasoning supports analysis but never authorizes lifecycle transitions.']
} satisfies SirControlBoundaryOutput;

const contract = buildSirLifecycleAssuranceContract({
  authoringPlan:plan,
  pairBoundary,
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

function validate(output:unknown,currentContract=contract,currentCompleted=completed){
  return validateSirLifecycleCompletion(currentContract,currentCompleted,output,{runId:'lifecycle-sir-regression',expectedPairId:plan.identity.pairId});
}

if(!validate(validOutput).passed) throw new Error('Valid Lifecycle SIR failed regression.');

const wrongCount=structuredClone(validOutput);
wrongCount.capabilityTargets.pop();
if(!validate(wrongCount).findings.some(item=>item.checkId==='SIR_LIFECYCLE_CAPABILITY_TARGET_COUNT')) {
  throw new Error('Lifecycle target/stage cardinality mismatch was not rejected.');
}

const modelOwnedStage=structuredClone(validOutput) as unknown as Record<string,unknown>;
const stageTargets=(modelOwnedStage.capabilityTargets as Array<Record<string,unknown>>);
stageTargets[0]!.lifecycleStage='QUALIFICATION_AND_REGISTRATION';
if(!validate(modelOwnedStage).findings.some(item=>item.checkId==='SIR_LIFECYCLE_OUTPUT_CONTRACT')) {
  throw new Error('Model-owned lifecycle stage identity was not rejected.');
}

const modelOwnedIdentity={...validOutput,capabilityId:'A2'};
if(!validate(modelOwnedIdentity).findings.some(item=>item.checkId==='SIR_LIFECYCLE_OUTPUT_CONTRACT')) {
  throw new Error('Model-owned canonical identity was not rejected.');
}

const narrowedVocabulary={...contract,lockedInputs:{...contract.lockedInputs,governed_technical_assurance_vocabulary:['DECLARED']}};
if(!validate(validOutput,narrowedVocabulary).findings.some(item=>item.checkId==='SIR_LIFECYCLE_TECHNICAL_ASSURANCE_NOT_GOVERNED')) {
  throw new Error('Assurance value outside the Authoring Plan vocabulary was not rejected.');
}

const missingControl={...contract,lockedInputs:{...contract.lockedInputs}};
delete missingControl.lockedInputs.control_boundary;
if(!validate(validOutput,missingControl).findings.some(item=>item.checkId==='SIR_LIFECYCLE_CONTROL_BOUNDARY_REQUIRED')) {
  throw new Error('Missing persisted Control dependency was not rejected.');
}

const incomplete=new Set<CognitiveTaskType>(completed);
incomplete.delete('CONTROL_BOUNDARY');
if(!validate(validOutput,contract,incomplete).findings.some(item=>item.checkId==='SIR_PREREQUISITE_MISSING')) {
  throw new Error('Missing Control prerequisite was not rejected.');
}

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
  prerequisiteGate:'PASS',
  modelOwnedStageIdentity:'REJECTED',
  modelOwnedCanonicalIdentity:'REJECTED',
  deterministicLifecycleStageMaterialization:'PASS',
  materializationCardinalityMismatch:'REJECTED'
},null,2));
