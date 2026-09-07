import { buildAuthoringPlan, type AuthoringPlanInput } from '../authoring/authoring-plan.js';
import { buildSirEvidenceArchitectureContract, type SirEvidenceArchitectureOutput } from '../cognitive/sir-evidence-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from '../cognitive/sir-initial-contracts.js';
import type { CognitiveTaskType } from '../domain/states.js';
import { materializeSirAtomics } from './atomic-materializer.js';
import { materializeSirEvidence } from './evidence-materializer.js';
import { validateSirEvidenceCompletion } from '../validation/sir-evidence-completion.js';

const planInput: AuthoringPlanInput = {
  identity: {
    capabilityId: 'A2',
    antipatternId: 'AP-A2',
    pairId: 'A2_AP-A2',
    domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'Sample capability',
    antipatternTitle: 'Sample anti-pattern'
  },
  targetVersion: '1.0.0',
  schemaVersion: '2.1.0',
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
const pairBoundary = {
  capability: { canonicalDefinition: 'A sufficiently bounded capability definition for the evidence test.', governancePurpose: 'A sufficiently bounded governance purpose for the evidence test.', distinctClaim: 'A sufficiently distinct capability claim for the evidence test.', ownedTopics: ['Owned topic'], excludedTopics: [] },
  antipattern: { canonicalDefinition: 'A sufficiently bounded anti-pattern definition for the evidence test.', pairedRelationship: 'The anti-pattern captures failure of the paired capability.' },
  boundaryRationale: 'The semantic ownership boundary is sufficiently explicit for this regression.'
} satisfies SirPairBoundaryOutput;
const failure = {
  failureMechanism: 'A concrete governed failure mechanism occurs under defined conditions.',
  triggeringConditions: ['A material trigger occurs.'],
  observableFailureSurfaces: ['An observable failure surface exists.'],
  nonExamples: ['A mere maturity gap without the failure mechanism.'],
  distinctionFromCapabilityGap: 'The anti-pattern requires a failure mechanism, not incomplete maturity alone.'
} satisfies SirApFailureModelOutput;
const applicability = {
  capability: { statement: 'The capability applies in the governed context.', conditions: ['Relevant context exists.'], exclusions: ['A bounded exclusion exists.'], reassessmentTriggers: ['A material context change occurs.'] },
  antipattern: { statement: 'The anti-pattern is assessed in the same governed scope.', conditions: ['The failure mechanism is assessable.'], exclusions: ['A bounded evidenced exclusion exists.'], reassessmentTriggers: ['A material failure-surface change occurs.'] },
  consistencyNotes: ['The pair remains independently assessable.']
} satisfies SirApplicabilityOutput;
const questions = {
  capabilityQuestions: [
    { slot: 1, question: 'Is definition and intent sufficiently specific and bounded?' },
    { slot: 2, question: 'Is implementation and operation consistent with the intended capability?' },
    { slot: 3, question: 'Does current evidence demonstrate effectiveness and intended outcomes?' }
  ],
  antipatternQuestions: [
    { slot: 1, question: 'Is the anti-pattern failure mechanism clearly distinguished?' },
    { slot: 2, question: 'Does operation exhibit the defined failure mechanism?' },
    { slot: 3, question: 'Does current evidence establish presence, uncertainty or tested absence?' }
  ],
  coverageRationale: 'All three governed semantic dimensions are covered.'
} satisfies SirPrimaryQuestionsOutput;

const atomics = materializeSirAtomics({
  capabilitySubcriteria: [
    { questionSlot: 1, criterion: 'Capability criterion for definition and intent.', evidenceNeed: 'Evidence of authoritative definition and intent.' },
    { questionSlot: 2, criterion: 'Capability criterion for implementation and operation.', evidenceNeed: 'Evidence of implementation and operation.' },
    { questionSlot: 3, criterion: 'Capability criterion for evidence and effectiveness.', evidenceNeed: 'Evidence of measured effectiveness.' }
  ],
  antipatternTests: [
    { questionSlot: 1, test: 'Anti-pattern test for definition of the failure mechanism.', evidenceNeed: 'Evidence that distinguishes the mechanism.' },
    { questionSlot: 2, test: 'Anti-pattern test for observable operational failure.', evidenceNeed: 'Operational evidence of the failure mechanism.' },
    { questionSlot: 3, test: 'Anti-pattern test for evidence-based presence or tested absence.', evidenceNeed: 'Current independent test evidence.' }
  ],
  coverageNotes: ['Every governed question slot is covered.']
});

const contract = buildSirEvidenceArchitectureContract({
  authoringPlan: plan,
  pairBoundary,
  apFailureModel: failure,
  applicability,
  primaryQuestions: questions,
  atomics,
  categoryBaseline: { criterion: 'A2 sample baseline' },
  goldenReference: { reference_id: 'A1_AP-A1', normative: false }
});

const valid: SirEvidenceArchitectureOutput = {
  capabilityEvidence: [
    { title: 'Capability definition evidence', claimSupported: 'The capability has an authoritative and bounded definition.', evidenceClass: 'GOVERNANCE_RECORD', minimumTechnicalAssurance: 'DECLARED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['The record is current and authoritative.'], limitations: ['Document existence alone does not prove implementation.'], supportsAtomicHandles: ['atomic_001'] },
    { title: 'Capability implementation evidence', claimSupported: 'The capability is implemented in the governed operating context.', evidenceClass: 'IMPLEMENTATION_RECORD', minimumTechnicalAssurance: 'IMPLEMENTED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Implementation is traceable to the defined capability.'], limitations: ['Implementation evidence alone does not prove effectiveness.'], supportsAtomicHandles: ['atomic_002'] },
    { title: 'Capability effectiveness evidence', claimSupported: 'The capability demonstrates measured evidence of intended effectiveness.', evidenceClass: 'TEST_RESULT', minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Testing is current and relevant to the defined scope.'], limitations: ['Testing outside scope cannot establish current effectiveness.'], supportsAtomicHandles: ['atomic_003'] }
  ],
  antipatternEvidence: [
    { title: 'Failure mechanism definition evidence', claimSupported: 'The failure mechanism can be distinguished from an ordinary maturity gap.', evidenceClass: 'ANALYSIS_RECORD', minimumTechnicalAssurance: 'DECLARED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['The mechanism and scope are explicit.'], limitations: ['Definition alone does not prove presence.'], supportsAtomicHandles: ['atomic_001'] },
    { title: 'Operational failure evidence', claimSupported: 'Operational observations can establish the defined failure mechanism.', evidenceClass: 'OPERATIONAL_RECORD', minimumTechnicalAssurance: 'OPERATIONALLY_OBSERVED', requiredHumanAssurance: 'HUMAN_VALIDATED', acceptanceConditions: ['Observation is attributable to the governed scope.'], limitations: ['Unrelated incidents do not establish this anti-pattern.'], supportsAtomicHandles: ['atomic_002'] },
    { title: 'Independent absence test evidence', claimSupported: 'Current independent testing can support presence, uncertainty or tested absence.', evidenceClass: 'INDEPENDENT_TEST', minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'FORMALLY_APPROVED', acceptanceConditions: ['Testing covers the defined scope and mechanism.'], limitations: ['Missing incidents or silence cannot establish tested absence.'], supportsAtomicHandles: ['atomic_003'] }
  ],
  sufficiencyNotes: ['Each supplied atomic item has at least one explicit semantic evidence relationship.']
};

const completed = new Set<CognitiveTaskType>(['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS','ATOMIC_DECOMPOSITION']);
function validate(output: unknown) {
  return validateSirEvidenceCompletion(contract, completed, output, { runId: 'sir-evidence-regression', expectedPairId: plan.identity.pairId });
}
if (!validate(valid).passed) throw new Error('Valid SIR evidence architecture failed regression.');

const unknownAtomic = structuredClone(valid);
unknownAtomic.capabilityEvidence[0]!.supportsAtomicHandles = ['atomic_999'];
if (!validate(unknownAtomic).findings.some((item) => item.checkId === 'SIR_EVIDENCE_ATOMIC_HANDLE_RESOLVES')) {
  throw new Error('Unknown atomic handle mutation was not rejected.');
}

const missingCoverage = structuredClone(valid);
missingCoverage.capabilityEvidence = missingCoverage.capabilityEvidence.filter((item) => !item.supportsAtomicHandles.includes('atomic_003'));
if (!validate(missingCoverage).findings.some((item) => item.checkId === 'SIR_EVERY_ATOMIC_HAS_EVIDENCE')) {
  throw new Error('Missing atomic evidence coverage mutation was not rejected.');
}

const invalidAssurance = structuredClone(valid);
invalidAssurance.capabilityEvidence[0]!.minimumTechnicalAssurance = 'MAGIC';
if (!validate(invalidAssurance).findings.some((item) => item.checkId === 'SIR_TECHNICAL_ASSURANCE_ALLOWED')) {
  throw new Error('Invalid assurance mutation was not rejected.');
}

const materialized = materializeSirEvidence(valid);
if (materialized.capability[0]?.handle !== 'evidence_001' || materialized.antipattern[0]?.handle !== 'evidence_001') {
  throw new Error('Evidence handles are not deterministic and object-scoped.');
}

console.log(JSON.stringify({
  atomicToEvidenceDependency: 'PASS',
  canonicalIdsInModelOutput: 'PROHIBITED_BY_STRICT_OUTPUT',
  crossObjectAtomicReference: 'REJECTED',
  fullAtomicCoverage: 'PASS',
  governedAssuranceVocabulary: 'PASS',
  deterministicEvidenceHandles: 'PASS'
}, null, 2));
