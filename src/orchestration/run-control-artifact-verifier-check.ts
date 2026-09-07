import { buildAuthoringPlan } from '../authoring/authoring-plan.js';
import { buildSirControlBoundaryContract, type SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import { materializeSirFindings } from '../sir/finding-materializer.js';
import { verifyPersistedControlArtifact } from './control-artifact-verifier.js';

const plan=buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-control-artifact',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},allowedSources:[],allowedTactics:[],adjacentCriteria:[]
});

const findings=materializeSirFindings({
  capabilityFindings:[{title:'Suitability evidence is insufficient for progression.',eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Progression remains constrained until evidence is resolved.',humanLockRequired:true}],
  antipatternFindings:[{title:'Solution-first decision logic may be present.',eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Human review is required before progression.',humanLockRequired:true}],
  findingLogicNotes:['Findings remain reusable knowledge definitions.']
});
const evidenceSafety={
  capabilityRules:{evidenceCeilings:['Intent does not prove effectiveness.'],falsePositiveGuards:['Require attributable evidence.'],prohibitedInferences:['Do not infer approval.'],contradictionHandling:['Conflicts keep conclusions unresolved.'],freshnessRules:['Evidence must remain current.']},
  antipatternRules:{evidenceCeilings:['Concern alone does not establish the failure mechanism.'],falsePositiveGuards:['Distinguish ordinary maturity gaps.'],prohibitedInferences:['Do not infer absence from silence.'],contradictionHandling:['Conflicts prevent definitive absence.'],freshnessRules:['Absence evidence must remain current.']},
  crossPairSafetyNotes:['Pair conclusions remain independent.']
};
const apAbsence={requiredArtifacts:['Scoped executed absence test','Independent verification record'],interpretationBoundary:'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'};
const pairBoundary={
  capability:{canonicalDefinition:'Capability boundary definition with sufficient detail.',governancePurpose:'Govern evidence-based suitability decisions.',distinctClaim:'AI selection is proportionate to a defined problem and alternatives.',ownedTopics:['AI suitability'],excludedTopics:[]},
  antipattern:{canonicalDefinition:'Solution-first selection without proportionate justification.',pairedRelationship:'Failure of evidence-based suitability.'},
  boundaryRationale:'The pair boundary is explicit.'
};
const contract=buildSirControlBoundaryContract({authoringPlan:plan,pairBoundary,evidenceSafety,apAbsence,findings,categoryBaseline:{criterion:'A2'},goldenReference:{reference_id:'A1_AP-A1',normative:false}});
const valid:SirControlBoundaryOutput={
  capabilityHardGate:{effect:'CONSTRAIN',conditions:['Required suitability evidence remains materially unresolved.'],overrideAuthority:'Designated accountable human authority'},
  antipatternHardGate:{effect:'BLOCK',conditions:['The solution-first failure mechanism is confirmed in a material decision.'],overrideAuthority:'Designated accountable human authority'},
  capabilityRuntimeBoundary:{machineMay:['Summarize validated evidence and unresolved findings.'],machineMustNot:['Approve progression or accept residual risk.'],humanAuthorityRequiredFor:['Approve progression, exceptions, or residual-risk acceptance.']},
  antipatternRuntimeBoundary:{machineMay:['Summarize evidence relevant to the defined failure mechanism.'],machineMustNot:['Declare legal compliance or authorize progression.'],humanAuthorityRequiredFor:['Resolve material disputes and authorize progression.']},
  controlNotes:['Control semantics define reusable knowledge boundaries only.']
};

verifyPersistedControlArtifact({output:valid,controlTaskContract:contract,authoringPlan:plan,verifiedFindings:findings,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence});

function expectThrows(fn:()=>unknown,expected:string):void{
  try{fn();}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.includes(expected))throw new Error(`Expected ${expected}; received ${message}`);return;}throw new Error(`Expected rejection containing ${expected}.`);
}

const invalidOutput=structuredClone(valid);
invalidOutput.capabilityRuntimeBoundary.machineMay=['Approve progression or accept residual risk.'];
expectThrows(()=>verifyPersistedControlArtifact({output:invalidOutput,controlTaskContract:contract,authoringPlan:plan,verifiedFindings:findings,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence}),'failed deterministic re-validation');

const findingsDrift=structuredClone(findings);
findingsDrift.capability[0]!.title='Different verified finding title.';
expectThrows(()=>verifyPersistedControlArtifact({output:valid,controlTaskContract:contract,authoringPlan:plan,verifiedFindings:findingsDrift,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence}),'capability Findings drifted');

const safetyDrift=structuredClone(evidenceSafety);
safetyDrift.capabilityRules.prohibitedInferences=['Different safety boundary.'];
expectThrows(()=>verifyPersistedControlArtifact({output:valid,controlTaskContract:contract,authoringPlan:plan,verifiedFindings:findings,verifiedEvidenceSafety:safetyDrift,verifiedApAbsence:apAbsence}),'capability Evidence Safety drifted');

const absenceDrift=structuredClone(apAbsence);
absenceDrift.requiredArtifacts=['Different absence artifact'];
expectThrows(()=>verifyPersistedControlArtifact({output:valid,controlTaskContract:contract,authoringPlan:plan,verifiedFindings:findings,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:absenceDrift}),'AP absence contract drifted');

const vocabContract=structuredClone(contract);
vocabContract.lockedInputs.governed_hard_gate_effects=['NONE','WARN'];
expectThrows(()=>verifyPersistedControlArtifact({output:valid,controlTaskContract:vocabContract,authoringPlan:plan,verifiedFindings:findings,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence}),'hard-gate vocabulary drifted');

const foreignPlanContract=structuredClone(contract);
foreignPlanContract.lockedInputs.authoring_plan_sha256='wrong-plan';
expectThrows(()=>verifyPersistedControlArtifact({output:valid,controlTaskContract:foreignPlanContract,authoringPlan:plan,verifiedFindings:findings,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence}),'different Authoring Plan');

console.log(JSON.stringify({
  persistedControlArtifact:'PASS',
  deterministicControlRevalidation:'PASS',
  lockedFindingDrift:'REJECTED',
  lockedEvidenceSafetyDrift:'REJECTED',
  lockedApAbsenceDrift:'REJECTED',
  hardGateVocabularyDrift:'REJECTED',
  foreignAuthoringPlan:'REJECTED'
},null,2));
