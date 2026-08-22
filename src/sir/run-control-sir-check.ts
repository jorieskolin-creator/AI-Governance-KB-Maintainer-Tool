import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import { buildSirControlBoundaryContract, type SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { materializeSirFindings } from './finding-materializer.js';
import { validateSirControlCompletion } from '../validation/sir-control-completion.js';

const plan = buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-control',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},
  allowedSources:[],allowedTactics:[],adjacentCriteria:[]
});

const findings=materializeSirFindings({
  capabilityFindings:[{
    title:'Suitability evidence is insufficient for progression.',
    eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],
    defaultSeverity:'HIGH',lifecycleConsequence:'Progression remains constrained until evidence is resolved.',humanLockRequired:true
  }],
  antipatternFindings:[{
    title:'Solution-first decision logic may be present.',
    eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],
    defaultSeverity:'HIGH',lifecycleConsequence:'Human review is required before progression.',humanLockRequired:true
  }],
  findingLogicNotes:['Findings are reusable knowledge definitions.']
});

const contract=buildSirControlBoundaryContract({
  authoringPlan:plan,
  pairBoundary:{
    capability:{canonicalDefinition:'Bounded capability definition for control regression.',governancePurpose:'Bounded governance purpose for control regression.',distinctClaim:'Distinct capability claim for control regression.',ownedTopics:['AI suitability'],excludedTopics:[]},
    antipattern:{canonicalDefinition:'Bounded anti-pattern definition for control regression.',pairedRelationship:'Failure of evidence-based suitability.'},
    boundaryRationale:'The pair boundary is explicit.'
  },
  evidenceSafety:{
    capabilityRules:{evidenceCeilings:['Do not infer effectiveness from intent alone.'],falsePositiveGuards:['Require attributable evidence.'],prohibitedInferences:['Do not infer approval.'],contradictionHandling:['Contradictions keep the conclusion unresolved.'],freshnessRules:['Evidence must remain current.']},
    antipatternRules:{evidenceCeilings:['Concern alone does not establish the full failure mechanism.'],falsePositiveGuards:['Distinguish ordinary maturity gaps.'],prohibitedInferences:['Do not infer tested absence from silence.'],contradictionHandling:['Contradictions prevent definitive absence.'],freshnessRules:['Absence evidence must remain current.']},
    crossPairSafetyNotes:['Capability and anti-pattern conclusions remain independent.']
  },
  apAbsence:{requiredArtifacts:['Scoped executed absence test','Independent verification record'],interpretationBoundary:'TESTED_ABSENT requires complete scoped and independently verified testing.'},
  findings,
  categoryBaseline:{criterion:'A2'},
  goldenReference:{reference_id:'A1_AP-A1',normative:false}
});

const completed=new Set<CognitiveTaskType>(contract.upstreamTaskTypes);
const valid:SirControlBoundaryOutput={
  capabilityHardGate:{effect:'CONSTRAIN',conditions:['Required suitability evidence remains materially unresolved.'],overrideAuthority:'Designated accountable human authority'},
  antipatternHardGate:{effect:'BLOCK',conditions:['The solution-first failure mechanism is confirmed in a material decision.'],overrideAuthority:'Designated accountable human authority'},
  capabilityRuntimeBoundary:{
    machineMay:['Summarize validated evidence and surface unresolved finding conditions.'],
    machineMustNot:['Approve progression or accept residual risk.'],
    humanAuthorityRequiredFor:['Approve progression, exceptions, or residual-risk acceptance.']
  },
  antipatternRuntimeBoundary:{
    machineMay:['Detect and summarize evidence relevant to the defined failure mechanism.'],
    machineMustNot:['Declare legal compliance or authorize progression.'],
    humanAuthorityRequiredFor:['Resolve material finding disputes and authorize any progression decision.']
  },
  controlNotes:['Control semantics define reusable knowledge boundaries and do not authorize a real system.']
};

function validate(output:unknown,currentContract=contract,currentCompleted=completed){
  return validateSirControlCompletion(currentContract,currentCompleted,output,{runId:'control-sir-regression',expectedPairId:'A2_AP-A2'});
}

if(!validate(valid).passed) throw new Error('Valid Control SIR failed regression.');

const activeGateWithoutCondition=structuredClone(valid);
activeGateWithoutCondition.capabilityHardGate.conditions=[];
if(!validate(activeGateWithoutCondition).findings.some((item)=>item.checkId==='SIR_CONTROL_ACTIVE_GATE_REQUIRES_CONDITION')){
  throw new Error('Active hard gate without condition was not rejected.');
}

const contradiction=structuredClone(valid);
contradiction.capabilityRuntimeBoundary.machineMay=['Approve progression or accept residual risk.'];
if(!validate(contradiction).findings.some((item)=>item.checkId==='SIR_CONTROL_MACHINE_MAY_MUST_NOT_CONTRADICTION')){
  throw new Error('machineMay/machineMustNot contradiction was not rejected.');
}

const humanContradiction=structuredClone(valid);
humanContradiction.capabilityRuntimeBoundary.machineMay=['Approve progression, exceptions, or residual-risk acceptance.'];
if(!validate(humanContradiction).findings.some((item)=>item.checkId==='SIR_CONTROL_MACHINE_MAY_HUMAN_AUTHORITY_CONTRADICTION')){
  throw new Error('machineMay/humanAuthority contradiction was not rejected.');
}

const duplicate=structuredClone(valid);
duplicate.antipatternRuntimeBoundary.machineMustNot=['Declare legal compliance.','  declare   legal compliance.  '];
if(!validate(duplicate).findings.some((item)=>item.checkId==='SIR_CONTROL_DUPLICATE_RUNTIME_BOUNDARY_ENTRY')){
  throw new Error('Normalized duplicate runtime-boundary entry was not rejected.');
}

const extraIdentity={...valid,capabilityId:'A2'};
if(!validate(extraIdentity).findings.some((item)=>item.checkId==='SIR_CONTROL_OUTPUT_CONTRACT')){
  throw new Error('Model-owned capability identity was not rejected by strict Control output.');
}

const lifecycleLeak={...valid,lifecycleTargets:[]};
if(!validate(lifecycleLeak).findings.some((item)=>item.checkId==='SIR_CONTROL_OUTPUT_CONTRACT')){
  throw new Error('Lifecycle-assurance content leaked into Control output.');
}

const noFindings={...contract,lockedInputs:{...contract.lockedInputs,capability_findings:[]}};
if(!validate(valid,noFindings).findings.some((item)=>item.checkId==='SIR_CONTROL_MATERIALIZED_FINDINGS_REQUIRED')){
  throw new Error('Missing materialized Finding dependency was not rejected.');
}

const incomplete=new Set<CognitiveTaskType>(completed);
incomplete.delete('FINDING_ARCHITECTURE');
if(!validate(valid,contract,incomplete).findings.some((item)=>item.checkId==='SIR_PREREQUISITE_MISSING')){
  throw new Error('Missing Finding prerequisite was not rejected.');
}

console.log(JSON.stringify({
  controlSir:'PASS',
  hardGateVocabularyBoundary:'PASS',
  activeGateConditionRequirement:'PASS',
  runtimeBoundaryCompleteness:'PASS',
  exactMachineAuthorityContradictions:'REJECTED',
  duplicateRuntimeEntries:'REJECTED',
  modelOwnedCanonicalIdentity:'REJECTED',
  lifecycleAssuranceLeakage:'REJECTED',
  materializedFindingDependency:'PASS',
  prerequisiteGate:'PASS',
  semanticGateChoiceOwnedByQualityChecker:true
},null,2));
