import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirFindingArchitectureOutput } from '../cognitive/sir-finding-contract.js';
import type { TaskContract } from '../domain/task-contract.js';
import { materializeSirFindings } from '../sir/finding-materializer.js';
import { verifyMaterializedFindingArtifact } from './finding-artifact-verifier.js';

const plan = buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-finding-artifact',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},
  allowedSources:[],allowedTactics:[],adjacentCriteria:[]
});

const capabilityAtomics=[{handle:'atomic_001',questionSlot:1,statement:'Capability atomic criterion.',evidenceNeed:'Capability evidence need.'}];
const antipatternAtomics=[{handle:'atomic_001',questionSlot:1,statement:'Anti-pattern atomic test.',evidenceNeed:'Anti-pattern evidence need.'}];
const capabilityEvidence=[{handle:'evidence_001',title:'Capability evidence',claimSupported:'Capability evidence supports the bounded claim.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence is attributable.'],limitations:['Document presence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}];
const antipatternEvidence=[{handle:'evidence_001',title:'Anti-pattern evidence',claimSupported:'Anti-pattern evidence supports the bounded failure claim.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence covers the bounded chronology.'],limitations:['Silence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}];

const findingContract:TaskContract={
  contractVersion:'2.0.0',taskId:'A2_AP-A2:FINDING_ARCHITECTURE:SIR',taskType:'FINDING_ARCHITECTURE',targetObjectId:'A2_AP-A2',
  objective:'Finding artifact verifier fixture.',modelRole:'REASONER',upstreamTaskTypes:[],
  lockedInputs:{
    authoring_plan_sha256:plan.planSha256,
    capability_conclusion_states:plan.vocabulary.capabilityConclusionStates,
    antipattern_conclusion_states:plan.vocabulary.antipatternConclusionStates,
    capability_atomics:capabilityAtomics,
    antipattern_atomics:antipatternAtomics,
    capability_evidence:capabilityEvidence,
    antipattern_evidence:antipatternEvidence,
    ap_absence_contract:{requiredArtifacts:['Scoped executed absence test','Independent verification record'],interpretationBoundary:'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'}
  },
  allowedReferences:[],doNot:[],outputContract:{format:'JSON',schemaName:'Fixture',requiredFields:[],additionalProperties:false},
  validationProfile:[],dependencyPaths:[],failureMode:'FAIL_CLOSED'
};

const semanticOutput:SirFindingArchitectureOutput={
  capabilityFindings:[{
    title:'Capability suitability evidence is insufficient for the governed claim.',
    eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],
    atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',
    lifecycleConsequence:'Progression should remain constrained until the required evidence gap is resolved.',
    humanLockRequired:true
  }],
  antipatternFindings:[{
    title:'Solution-first decision logic is present or cannot be ruled out.',
    eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN','TESTED_ABSENT'],
    atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',
    lifecycleConsequence:'Progression requires human review of the failure mechanism and absence-test evidence.',
    humanLockRequired:true
  }],
  findingLogicNotes:['Finding definitions remain reusable knowledge content and do not assess a real system.']
};

const materialized=materializeSirFindings(semanticOutput);
verifyMaterializedFindingArtifact({output:materialized,findingTaskContract:findingContract,authoringPlan:plan});

function expectThrows(fn:()=>unknown,expected:string):void {
  try{fn();}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.includes(expected))throw new Error(`Expected ${expected}; received ${message}`);return;}throw new Error(`Expected rejection containing ${expected}.`);
}

expectThrows(
  ()=>verifyMaterializedFindingArtifact({output:semanticOutput,findingTaskContract:findingContract,authoringPlan:plan}),
  'capability group must be a non-empty array'
);

const wrongHandle=structuredClone(materialized);
wrongHandle.capability[0]!.handle='finding_999';
expectThrows(
  ()=>verifyMaterializedFindingArtifact({output:wrongHandle,findingTaskContract:findingContract,authoringPlan:plan}),
  'handle must be finding_001'
);

const wrongState=structuredClone(materialized);
wrongState.capability[0]!.eligibleConclusionStates=['CONFIRMED_PRESENT'];
expectThrows(
  ()=>verifyMaterializedFindingArtifact({output:wrongState,findingTaskContract:findingContract,authoringPlan:plan}),
  'outside the governed object vocabulary'
);

const brokenGraph=structuredClone(materialized);
brokenGraph.capability[0]!.atomicHandles=['atomic_001'];
brokenGraph.capability[0]!.evidenceHandles=['evidence_001'];
const graphContract=structuredClone(findingContract) as TaskContract;
graphContract.lockedInputs.capability_evidence=[{...capabilityEvidence[0],supportsAtomicHandles:['atomic_999']}];
expectThrows(
  ()=>verifyMaterializedFindingArtifact({output:brokenGraph,findingTaskContract:graphContract,authoringPlan:plan}),
  'selected evidence does not cover atomic handle atomic_001'
);

const noAbsenceContract=structuredClone(findingContract) as TaskContract;
delete noAbsenceContract.lockedInputs.ap_absence_contract;
expectThrows(
  ()=>verifyMaterializedFindingArtifact({output:materialized,findingTaskContract:noAbsenceContract,authoringPlan:plan}),
  'TESTED_ABSENT without a valid locked AP absence contract'
);

const vocabularyDrift=structuredClone(findingContract) as TaskContract;
vocabularyDrift.lockedInputs.capability_conclusion_states=['SATISFIED','UNKNOWN'];
expectThrows(
  ()=>verifyMaterializedFindingArtifact({output:materialized,findingTaskContract:vocabularyDrift,authoringPlan:plan}),
  'capability conclusion-state vocabulary drifted'
);

console.log(JSON.stringify({
  materializedFindingArtifact:'PASS',
  deterministicFindingHandles:'PASS',
  rawFindingModelOutput:'REJECTED',
  tamperedFindingHandle:'REJECTED',
  crossVocabularyConclusionState:'REJECTED',
  atomicEvidenceGraphDrift:'REJECTED',
  testedAbsentWithoutLockedAbsenceContract:'REJECTED',
  conclusionVocabularyDrift:'REJECTED'
},null,2));
