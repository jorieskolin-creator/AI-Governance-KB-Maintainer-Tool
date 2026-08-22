import { buildAuthoringPlan, type AuthoringPlanInput } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { CompletedTaskArtifact } from './store.js';
import { resolveSirTaskContract } from './sir-contract-resolver.js';

const planInput: AuthoringPlanInput = {
  identity: {
    capabilityId: 'A2', antipatternId: 'AP-A2', pairId: 'A2_AP-A2', domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'Sample capability', antipatternTitle: 'Sample anti-pattern'
  },
  targetVersion: '1.0.0', schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-test', baselineSha256: 'a'.repeat(64),
    productionContractVersion: '1.1.0', productionContractSha256: 'b'.repeat(64),
    capabilitySchemaVersion: '2.1.0', capabilitySchemaSha256: 'c'.repeat(64),
    antipatternSchemaVersion: '2.1.0', antipatternSchemaSha256: 'd'.repeat(64),
    sharedDefinitionsVersion: '2.1.0', sharedDefinitionsSha256: 'e'.repeat(64),
    sourceRegisterVersion: '1.5.0', sourceRegisterSha256: 'f'.repeat(64),
    tacticCatalogVersion: null, tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1', goldenReferenceVersion: '1.0.0', goldenReferenceSha256: '1'.repeat(64)
  },
  questionDimensions: ['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'],
  vocabulary: {
    technicalAssurance: ['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'],
    antipatternConclusionStates: ['CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'],
    hardGateEffects: ['NONE','WARN','BLOCK','CONSTRAIN'],
    lifecycleStages: ['QUALIFICATION_AND_REGISTRATION','DESIGN_AND_DEVELOPMENT','VERIFICATION_AND_VALIDATION','DEPLOYMENT','OPERATION_AND_MONITORING','REVIEW_AND_EVALUATION','RETIREMENT']
  },
  allowedSources: [], allowedTactics: [], adjacentCriteria: []
};

const plan = buildAuthoringPlan(planInput);
const artifacts = new Map<CognitiveTaskType, CompletedTaskArtifact>();

function contract(taskType: CognitiveTaskType, lockedInputs: Record<string, unknown> = {}): TaskContract {
  return {
    contractVersion: '2.0.0',
    taskId: `${plan.identity.pairId}:${taskType}:SIR`,
    taskType,
    targetObjectId: plan.identity.pairId,
    objective: 'Resolver regression artifact.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [],
    lockedInputs: { authoring_plan_sha256: plan.planSha256, ...lockedInputs },
    allowedReferences: [], doNot: [],
    outputContract: { format: 'JSON', schemaName: 'Regression', requiredFields: [], additionalProperties: false },
    validationProfile: [], dependencyPaths: [], failureMode: 'FAIL_CLOSED'
  };
}

function put(taskType: CognitiveTaskType, output: unknown, lockedInputs: Record<string, unknown> = {}): void {
  artifacts.set(taskType, {
    output,
    taskContract: contract(taskType, lockedInputs),
    inputHash: `input-${taskType}`,
    outputHash: `output-${taskType}`
  });
}

put('PAIR_BOUNDARY', {
  capability: { canonicalDefinition: 'Bounded capability definition for resolver regression.', governancePurpose: 'Bounded governance purpose for resolver regression.', distinctClaim: 'Distinct capability claim for resolver regression.', ownedTopics: ['Owned topic'], excludedTopics: [] },
  antipattern: { canonicalDefinition: 'Bounded anti-pattern definition for resolver regression.', pairedRelationship: 'The anti-pattern represents failure of the paired capability.' },
  boundaryRationale: 'The pair has a bounded semantic ownership boundary.'
});
put('AP_FAILURE_MODEL', {
  failureMechanism: 'A concrete failure mechanism occurs in the governed scope.', triggeringConditions: ['Material trigger exists.'], observableFailureSurfaces: ['Observable failure surface exists.'], nonExamples: ['A maturity gap without this mechanism.'], distinctionFromCapabilityGap: 'The failure mechanism is distinct from incomplete maturity.'
});
put('APPLICABILITY', {
  capability: { statement: 'Capability applies in governed scope.', conditions: ['Relevant context exists.'], exclusions: ['Bounded exclusion exists.'], reassessmentTriggers: ['Material change occurs.'] },
  antipattern: { statement: 'Anti-pattern is assessed in governed scope.', conditions: ['Failure mechanism is assessable.'], exclusions: ['Bounded exclusion exists.'], reassessmentTriggers: ['Material change occurs.'] },
  consistencyNotes: ['Pair remains independently assessable.']
});
put('PRIMARY_QUESTIONS', {
  capabilityQuestions: [{slot:1,question:'Capability definition question with sufficient semantic detail.'},{slot:2,question:'Capability implementation question with sufficient semantic detail.'},{slot:3,question:'Capability evidence question with sufficient semantic detail.'}],
  antipatternQuestions: [{slot:1,question:'Anti-pattern definition question with sufficient semantic detail.'},{slot:2,question:'Anti-pattern implementation question with sufficient semantic detail.'},{slot:3,question:'Anti-pattern evidence question with sufficient semantic detail.'}],
  coverageRationale: 'All governed question slots are covered.'
});
put('ATOMIC_DECOMPOSITION', {
  capability: [{ handle:'atomic_001', questionSlot:1, statement:'Capability atomic criterion with sufficient detail.', evidenceNeed:'Capability evidence need with sufficient detail.' }],
  antipattern: [{ handle:'atomic_001', questionSlot:1, statement:'Anti-pattern atomic test with sufficient detail.', evidenceNeed:'Anti-pattern evidence need with sufficient detail.' }]
});
put('EVIDENCE_ARCHITECTURE', {
  capability: [{ handle:'evidence_001', title:'Capability evidence', claimSupported:'Capability evidence supports the governed claim.', evidenceClass:'GOVERNANCE_RECORD', minimumTechnicalAssurance:'DECLARED', requiredHumanAssurance:'HUMAN_VALIDATED', acceptanceConditions:['Evidence is current.'], limitations:['Document presence alone is insufficient.'], supportsAtomicHandles:['atomic_001'] }],
  antipattern: [{ handle:'evidence_001', title:'AP evidence', claimSupported:'Anti-pattern evidence supports the governed failure claim.', evidenceClass:'TEST_RECORD', minimumTechnicalAssurance:'TESTED', requiredHumanAssurance:'HUMAN_VALIDATED', acceptanceConditions:['Evidence covers the defined scope.'], limitations:['Silence alone is insufficient.'], supportsAtomicHandles:['atomic_001'] }]
});

const loadArtifact = async <T>(_pairRunId: string, taskType: CognitiveTaskType) => artifacts.get(taskType) as CompletedTaskArtifact<T> | undefined;
const base = { pairRunId: 'pair-run-test', authoringPlan: plan, categoryBaseline: { criterion: 'A2 baseline' }, goldenReference: { reference_id:'A1_AP-A1', normative:false }, loadArtifact };

const safetyContract = await resolveSirTaskContract({ ...base, taskType: 'EVIDENCE_SAFETY' });
const safetyEvidence = safetyContract.lockedInputs.antipattern_evidence as Array<{handle:string}>;
if (safetyEvidence[0]?.handle !== 'evidence_001') throw new Error('Evidence Safety did not receive materialized evidence SIR.');

const safetyOutput = {
  capabilityRules: { evidenceCeilings:['Capability ceiling.'], falsePositiveGuards:['Capability guard.'], prohibitedInferences:['Capability prohibited inference.'], contradictionHandling:['Capability contradiction rule.'], freshnessRules:['Capability freshness rule.'] },
  antipatternRules: { evidenceCeilings:['AP ceiling.'], falsePositiveGuards:['AP guard.'], prohibitedInferences:['AP prohibited inference.'], contradictionHandling:['AP contradiction rule.'], freshnessRules:['AP freshness rule.'] },
  crossPairSafetyNotes: ['Pair conclusions remain evidence-independent.']
};
put('EVIDENCE_SAFETY', safetyOutput, safetyContract.lockedInputs);

const absenceContract = await resolveSirTaskContract({ ...base, taskType: 'AP_ABSENCE_CONTRACT' });
if (absenceContract.lockedInputs.antipattern_evidence_safety !== safetyOutput.antipatternRules) {
  throw new Error('AP Absence did not receive compatible Evidence Safety SIR.');
}
const conditions = absenceContract.lockedInputs.normative_absence_conditions as Record<string, unknown>;
if (!conditions || Object.values(conditions).some((value) => value !== true)) {
  throw new Error('AP Absence deterministic conditions were not preserved by resolver construction.');
}

console.log(JSON.stringify({
  evidenceSafetyResolver: 'PASS',
  materializedEvidencePropagation: 'PASS',
  apAbsenceResolver: 'PASS',
  authoringPlanCompatibility: 'PASS',
  deterministicAbsenceConditions: 'PASS'
}, null, 2));
