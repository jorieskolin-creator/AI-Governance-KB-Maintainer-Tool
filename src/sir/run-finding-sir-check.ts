import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import { buildSirFindingArchitectureContract } from '../cognitive/sir-finding-contract.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { materializeSirFindings } from './finding-materializer.js';
import { validateSirFindingCompletion } from '../validation/sir-finding-completion.js';

const plan = buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0', schemaVersion:'2.1.0',
  baseline:{
    baselineSnapshotId:'baseline-finding',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),
    capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),
    sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),
    tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)
  },
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

const atomics = {
  capability:[
    {handle:'atomic_001' as const,questionSlot:1 as const,statement:'A measurable problem and non-AI baseline are defined.',evidenceNeed:'Problem and baseline evidence.'},
    {handle:'atomic_002' as const,questionSlot:2 as const,statement:'Alternative mechanisms are compared using explicit cost-risk trade-offs.',evidenceNeed:'Alternative comparison evidence.'}
  ],
  antipattern:[
    {handle:'atomic_001' as const,questionSlot:1 as const,statement:'AI was predetermined before alternatives were evaluated.',evidenceNeed:'Decision chronology evidence.'}
  ]
};

const evidence = {
  capability:[
    {handle:'evidence_001' as const,title:'Problem baseline',claimSupported:'A measurable problem and baseline are explicitly documented.',evidenceClass:'DOCUMENTED_ANALYSIS',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Problem is defined independently of AI.'],limitations:['Does not establish alternative comparison.'],supportsAtomicHandles:['atomic_001' as const]},
    {handle:'evidence_002' as const,title:'Alternatives record',claimSupported:'Alternative mechanisms and trade-offs are explicitly compared.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['At least one simpler alternative is evaluated.'],limitations:['Does not establish realized operational value.'],supportsAtomicHandles:['atomic_002' as const]}
  ],
  antipattern:[
    {handle:'evidence_001' as const,title:'Decision chronology',claimSupported:'The chronology demonstrates whether AI was selected before alternatives were assessed.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Chronology is attributable.'],limitations:['Retrospective narrative alone may be insufficient.'],supportsAtomicHandles:['atomic_001' as const]}
  ]
};

const sourceMappings = {
  sourceContextPacketSha256:'source-packet-hash',
  capability:[],antipattern:[],unmappedClaims:[],mappingNotes:[]
};

const contract = buildSirFindingArchitectureContract({
  authoringPlan:plan,
  pairBoundary:{capability:{canonicalDefinition:'Capability definition with sufficient semantic detail.',governancePurpose:'Ensure evidence-based proportionate AI selection.',distinctClaim:'AI selection is justified against a defined problem, alternatives, value, cost and risk.',ownedTopics:['AI suitability'],excludedTopics:[]},antipattern:{canonicalDefinition:'AI is selected first without proportionate evidence.',pairedRelationship:'Failure of evidence-based AI suitability.'},boundaryRationale:'A2 owns suitability and value justification.'},
  apFailureModel:{failureMechanism:'AI is predetermined and novelty substitutes for value and alternative evidence.',triggeringConditions:['AI selected before alternatives.'],observableFailureSurfaces:['No alternative baseline.'],nonExamples:['Evidence-based AI selection.'],distinctionFromCapabilityGap:'Requires solution-first logic rather than a generic gap.'},
  applicability:{capability:{statement:'Applies to proposed or materially changed AI uses.',conditions:['AI mechanism is proposed.'],exclusions:[],reassessmentTriggers:['Material change.']},antipattern:{statement:'Applies where solution-selection rationale is assessable.',conditions:['AI selection is in scope.'],exclusions:[],reassessmentTriggers:['Material change.']},consistencyNotes:['Shared decision boundary.']},
  primaryQuestions:{capabilityQuestions:[{slot:1,question:'Is the problem independently defined?'},{slot:2,question:'Are alternatives compared proportionately?'},{slot:3,question:'Does evidence justify progression?'}],antipatternQuestions:[{slot:1,question:'Was AI predetermined?'},{slot:2,question:'Were alternatives bypassed?'},{slot:3,question:'Did progression continue without value evidence?'}],coverageRationale:'Fixed dimensions covered.'},
  atomics,evidence,
  evidenceSafety:{capabilityRules:{evidenceCeilings:['Planning does not prove realized value.'],falsePositiveGuards:['Require alternative comparison.'],prohibitedInferences:['Do not infer suitability from sponsorship.'],contradictionHandling:['Conflicts remain unresolved.'],freshnessRules:['Material change triggers reassessment.']},antipatternRules:{evidenceCeilings:['AI use alone does not prove solutionism.'],falsePositiveGuards:['Distinguish evidence-based selection.'],prohibitedInferences:['Do not infer absence from silence.'],contradictionHandling:['Conflicts prevent definitive conclusion.'],freshnessRules:['Evidence must match current decision.']},crossPairSafetyNotes:[]},
  apAbsence:{requiredArtifacts:['Scoped decision record','Executed alternative comparison','Independent verification'],interpretationBoundary:'Silence or missing documentation cannot establish tested absence.'},
  sourceMappings,
  categoryBaseline:{},goldenReference:{}
});

const completed = new Set<CognitiveTaskType>(contract.upstreamTaskTypes);
const valid = {
  capabilityFindings:[{
    title:'Material suitability gap is established by the validated capability graph',
    eligibleConclusionStates:['NOT_SATISFIED','PARTIALLY_SATISFIED'] as const,
    atomicHandles:['atomic_001','atomic_002'],
    evidenceHandles:['evidence_001','evidence_002'],
    defaultSeverity:'HIGH' as const,
    lifecycleConsequence:'Progression should remain constrained until the material suitability gap is addressed.',
    humanLockRequired:true
  }],
  antipatternFindings:[{
    title:'Solution-first selection mechanism is demonstrated by attributable decision evidence',
    eligibleConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT'] as const,
    atomicHandles:['atomic_001'],
    evidenceHandles:['evidence_001'],
    defaultSeverity:'HIGH' as const,
    lifecycleConsequence:'Progression should remain constrained while solution-first selection remains materially unresolved.',
    humanLockRequired:true
  }],
  findingLogicNotes:['Finding definitions describe reusable conclusion eligibility; they do not assess a real system.']
};

function validate(output:unknown,currentContract=contract) {
  return validateSirFindingCompletion(currentContract,completed,output,{runId:'finding-regression',expectedPairId:'A2_AP-A2'});
}

const validReport = validate(valid);
if (!validReport.passed) throw new Error(`Valid Finding SIR failed: ${validReport.findings.map((item)=>item.checkId).join(', ')}`);

const wrongState = structuredClone(valid) as any;
wrongState.antipatternFindings[0].eligibleConclusionStates=['SATISFIED'];
if (!validate(wrongState).findings.some((item)=>item.checkId==='SIR_FINDING_OUTPUT_CONTRACT')) {
  throw new Error('Capability conclusion state inside AP finding was not rejected.');
}

const unknownAtomic = structuredClone(valid) as any;
unknownAtomic.capabilityFindings[0].atomicHandles=['atomic_999'];
if (!validate(unknownAtomic).findings.some((item)=>item.checkId==='SIR_FINDING_UNKNOWN_ATOMIC_HANDLE')) {
  throw new Error('Unknown finding atomic handle was not rejected.');
}

const uncoveredAtomic = structuredClone(valid) as any;
uncoveredAtomic.capabilityFindings[0].evidenceHandles=['evidence_001'];
if (!validate(uncoveredAtomic).findings.some((item)=>item.checkId==='SIR_FINDING_ATOMIC_NOT_COVERED_BY_SELECTED_EVIDENCE')) {
  throw new Error('Finding evidence/atomic graph mismatch was not rejected.');
}

const modelOwnedHandle = structuredClone(valid) as any;
modelOwnedHandle.capabilityFindings[0].handle='finding_777';
if (!validate(modelOwnedHandle).findings.some((item)=>item.checkId==='SIR_FINDING_OUTPUT_CONTRACT')) {
  throw new Error('Model-owned finding handle was not rejected.');
}

const testedAbsent = structuredClone(valid) as any;
testedAbsent.antipatternFindings[0].eligibleConclusionStates=['TESTED_ABSENT'];
const withoutAbsence = {
  ...contract,
  lockedInputs:{...contract.lockedInputs,ap_absence_contract:{requiredArtifacts:[],interpretationBoundary:''}}
};
if (!validate(testedAbsent,withoutAbsence).findings.some((item)=>item.checkId==='SIR_FINDING_TESTED_ABSENT_WITHOUT_ABSENCE_CONTRACT')) {
  throw new Error('TESTED_ABSENT without validated absence contract was not rejected.');
}

const withoutSourceMapping = {
  ...contract,
  lockedInputs:{...contract.lockedInputs,source_mappings:{}}
};
if (!validate(valid,withoutSourceMapping).findings.some((item)=>item.checkId==='SIR_FINDING_SOURCE_MAPPING_ARTIFACT_REQUIRED')) {
  throw new Error('Missing materialized Source Mapping artifact was not rejected.');
}

const materialized = materializeSirFindings(valid as any);
if (materialized.capability[0]?.handle!=='finding_001' || materialized.antipattern[0]?.handle!=='finding_001') {
  throw new Error('Finding handles were not deterministically materialized per object.');
}

console.log(JSON.stringify({
  findingSir:'PASS',
  objectSpecificConclusionVocabulary:'PASS',
  sameObjectReferenceResolution:'PASS',
  evidenceAtomicGraphCoherence:'PASS',
  testedAbsentGuard:'PASS',
  materializedSourceMappingDependency:'PASS',
  modelOwnedFindingHandle:'REJECTED',
  deterministicFindingHandles:'PASS'
},null,2));
