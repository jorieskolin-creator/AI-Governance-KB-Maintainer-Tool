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
import { materializeSirEvidence } from '../sir/evidence-materializer.js';
import { materializeSirFindings } from '../sir/finding-materializer.js';
import { materializeValidatedSirTaskOutput } from '../sir/task-artifact.js';
import { verifyPersistedLifecycleArtifact } from './lifecycle-artifact-verifier.js';

const plan=buildAuthoringPlan({
  identity:{capabilityId:'A2',antipatternId:'AP-A2',pairId:'A2_AP-A2',domain:'A',domainTitle:'Purpose, value, context, roles and classification',capabilityTitle:'AI suitability, proportionality and value hypothesis',antipatternTitle:'AI-first solutionism or value theatre'},
  targetVersion:'1.0.0',schemaVersion:'2.1.0',
  baseline:{baselineSnapshotId:'baseline-lifecycle-artifact',baselineSha256:'a'.repeat(64),productionContractVersion:'1.0.0',productionContractSha256:'b'.repeat(64),capabilitySchemaVersion:'2.1.0',capabilitySchemaSha256:'c'.repeat(64),antipatternSchemaVersion:'2.1.0',antipatternSchemaSha256:'d'.repeat(64),sharedDefinitionsVersion:'2.1.0',sharedDefinitionsSha256:'e'.repeat(64),sourceRegisterVersion:'1.5.0',sourceRegisterSha256:'f'.repeat(64),tacticCatalogVersion:null,tacticCatalogSha256:null,goldenReferenceId:'A1_AP-A1',goldenReferenceVersion:'1.0.0',goldenReferenceSha256:'1'.repeat(64)},
  questionDimensions:['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary:{technicalAssurance:['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],humanAssurance:['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],capabilityConclusionStates:['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],antipatternConclusionStates:['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],hardGateEffects:['NONE','WARN','BLOCK','CONSTRAIN'],lifecycleStages:['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']},
  allowedSources:[],allowedTactics:[],adjacentCriteria:[]
});

const pairBoundary={
  capability:{canonicalDefinition:'Bounded capability definition.',governancePurpose:'Bounded governance purpose.',distinctClaim:'Distinct capability claim.',ownedTopics:['Owned topic'],excludedTopics:[]},
  antipattern:{canonicalDefinition:'Bounded anti-pattern definition.',pairedRelationship:'The anti-pattern captures failure of the paired capability.'},
  boundaryRationale:'The pair boundary is explicit.'
} satisfies SirPairBoundaryOutput;

const evidence=materializeSirEvidence({
  capabilityEvidence:[{title:'Capability evidence',claimSupported:'Bounded capability claim.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence is attributable.'],limitations:['Presence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}],
  antipatternEvidence:[{title:'Anti-pattern evidence',claimSupported:'Bounded anti-pattern claim.',evidenceClass:'TEST_RECORD',minimumTechnicalAssurance:'TESTED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Evidence covers the defined scope.'],limitations:['Silence alone is insufficient.'],supportsAtomicHandles:['atomic_001']}],
  sufficiencyNotes:['The bounded regression evidence graph is explicit.']
} satisfies SirEvidenceArchitectureOutput);

const evidenceSafety={
  capabilityRules:{evidenceCeilings:['Capability ceiling.'],falsePositiveGuards:['Capability guard.'],prohibitedInferences:['Capability prohibited inference.'],contradictionHandling:['Capability contradiction rule.'],freshnessRules:['Capability freshness rule.']},
  antipatternRules:{evidenceCeilings:['AP ceiling.'],falsePositiveGuards:['AP guard.'],prohibitedInferences:['AP prohibited inference.'],contradictionHandling:['AP contradiction rule.'],freshnessRules:['AP freshness rule.']},
  crossPairSafetyNotes:['Conclusions remain evidence-bounded.']
} satisfies SirEvidenceSafetyOutput;

const apAbsence={requiredArtifacts:['Scoped executed absence test','Independent verification record'],interpretationBoundary:'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'} satisfies SirApAbsenceOutput;

const findings=materializeSirFindings({
  capabilityFindings:[{title:'Capability finding.',eligibleConclusionStates:['NOT_SATISFIED','UNKNOWN'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Constrain progression pending evidence.',humanLockRequired:true}],
  antipatternFindings:[{title:'Anti-pattern finding.',eligibleConclusionStates:['CONFIRMED_PRESENT','UNKNOWN','TESTED_ABSENT'],atomicHandles:['atomic_001'],evidenceHandles:['evidence_001'],defaultSeverity:'HIGH',lifecycleConsequence:'Require human review before progression.',humanLockRequired:true}],
  findingLogicNotes:['Findings remain reusable knowledge definitions.']
} satisfies SirFindingArchitectureOutput);

const control={
  capabilityHardGate:{effect:'CONSTRAIN',conditions:['Required suitability evidence remains materially unresolved.'],overrideAuthority:'Designated accountable human authority'},
  antipatternHardGate:{effect:'BLOCK',conditions:['The solution-first failure mechanism is confirmed in a material decision.'],overrideAuthority:'Designated accountable human authority'},
  capabilityRuntimeBoundary:{machineMay:['Summarize validated evidence.'],machineMustNot:['Approve lifecycle progression.'],humanAuthorityRequiredFor:['Lifecycle progression decision.']},
  antipatternRuntimeBoundary:{machineMay:['Surface validated failure indicators.'],machineMustNot:['Declare residual risk accepted.'],humanAuthorityRequiredFor:['Residual-risk decision.']},
  controlNotes:['Machine reasoning supports analysis but never authorizes lifecycle transitions.']
} satisfies SirControlBoundaryOutput;

const categoryBaseline={criterion:'A2 baseline'};
const goldenReference={reference_id:'A1_AP-A1',normative:false};
const contract=buildSirLifecycleAssuranceContract({authoringPlan:plan,pairBoundary,evidence,evidenceSafety,apAbsence,findings,controlBoundary:control,categoryBaseline,goldenReference});
const target={minimumTechnicalAssurance:'TESTED' as const,requiredHumanAssurance:'HUMAN_VALIDATED' as const};
const semanticOutput:SirLifecycleAssuranceOutput={
  capabilityTargets:plan.vocabulary.lifecycleStages.map(()=>({...target})),
  antipatternTargets:plan.vocabulary.lifecycleStages.map(()=>({...target})),
  rationaleNotes:['Assurance targets are reusable knowledge expectations and do not authorize a real-system transition.']
};

const persisted=materializeValidatedSirTaskOutput(contract,semanticOutput);
verifyPersistedLifecycleArtifact({output:persisted,lifecycleTaskContract:contract,authoringPlan:plan,verifiedPairBoundary:pairBoundary,verifiedEvidence:evidence,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence,verifiedFindings:findings,verifiedControl:control,categoryBaseline,goldenReference});

function expectThrows(fn:()=>unknown,expected:string):void{
  try{fn();}catch(error){const message=error instanceof Error?error.message:String(error);if(!message.includes(expected))throw new Error(`Expected ${expected}; received ${message}`);return;}throw new Error(`Expected rejection containing ${expected}.`);
}

expectThrows(
  ()=>verifyPersistedLifecycleArtifact({output:semanticOutput,lifecycleTaskContract:contract,authoringPlan:plan,verifiedPairBoundary:pairBoundary,verifiedEvidence:evidence,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence,verifiedFindings:findings,verifiedControl:control,categoryBaseline,goldenReference}),
  'unexpected or missing fields'
);

const stageDrift=structuredClone(persisted) as any;
stageDrift.capability[0].lifecycleStage='RETIREMENT';
expectThrows(
  ()=>verifyPersistedLifecycleArtifact({output:stageDrift,lifecycleTaskContract:contract,authoringPlan:plan,verifiedPairBoundary:pairBoundary,verifiedEvidence:evidence,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence,verifiedFindings:findings,verifiedControl:control,categoryBaseline,goldenReference}),
  'stage identity drifted'
);

const assuranceDrift=structuredClone(persisted) as any;
assuranceDrift.antipattern[0].minimumTechnicalAssurance='MAGIC';
expectThrows(
  ()=>verifyPersistedLifecycleArtifact({output:assuranceDrift,lifecycleTaskContract:contract,authoringPlan:plan,verifiedPairBoundary:pairBoundary,verifiedEvidence:evidence,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence,verifiedFindings:findings,verifiedControl:control,categoryBaseline,goldenReference}),
  'technical assurance is outside'
);

const controlDrift=structuredClone(control);
controlDrift.controlNotes=['Different verified Control artifact.'];
expectThrows(
  ()=>verifyPersistedLifecycleArtifact({output:persisted,lifecycleTaskContract:contract,authoringPlan:plan,verifiedPairBoundary:pairBoundary,verifiedEvidence:evidence,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence,verifiedFindings:findings,verifiedControl:controlDrift,categoryBaseline,goldenReference}),
  'Control Boundary drifted'
);

expectThrows(
  ()=>verifyPersistedLifecycleArtifact({output:persisted,lifecycleTaskContract:contract,authoringPlan:plan,verifiedPairBoundary:pairBoundary,verifiedEvidence:evidence,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence,verifiedFindings:findings,verifiedControl:control,categoryBaseline:{criterion:'drifted baseline'},goldenReference}),
  'category baseline drifted'
);

const stageOrderDrift={...contract,lockedInputs:{...contract.lockedInputs,lifecycle_stage_order:[...plan.vocabulary.lifecycleStages].reverse()}};
expectThrows(
  ()=>verifyPersistedLifecycleArtifact({output:persisted,lifecycleTaskContract:stageOrderDrift,authoringPlan:plan,verifiedPairBoundary:pairBoundary,verifiedEvidence:evidence,verifiedEvidenceSafety:evidenceSafety,verifiedApAbsence:apAbsence,verifiedFindings:findings,verifiedControl:control,categoryBaseline,goldenReference}),
  'lifecycle stage order drifted'
);

console.log(JSON.stringify({
  persistedLifecycleArtifact:'PASS',
  taskArtifactLifecycleMaterialization:'PASS',
  deterministicStageIdentity:'PASS',
  rawSemanticLifecycleArtifact:'REJECTED',
  tamperedStageIdentity:'REJECTED',
  assuranceVocabularyDrift:'REJECTED',
  lockedControlDependencyDrift:'REJECTED',
  categoryBaselineDrift:'REJECTED',
  authoringPlanStageOrderDrift:'REJECTED'
},null,2));
