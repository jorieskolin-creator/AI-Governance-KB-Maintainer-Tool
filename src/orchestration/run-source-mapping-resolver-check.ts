import { buildAuthoringPlan, type AuthoringPlanInput } from '../authoring/authoring-plan.js';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { buildSourceContextPacket } from './source-context-packet.js';
import { resolveSirTaskContract } from './sir-contract-resolver.js';
import type { CompletedTaskArtifact } from './store.js';

const planInput: AuthoringPlanInput = {
  identity: {
    capabilityId: 'A2', antipatternId: 'AP-A2', pairId: 'A2_AP-A2', domain: 'A',
    domainTitle: 'Purpose, value, context, roles and classification',
    capabilityTitle: 'AI suitability, proportionality and value hypothesis',
    antipatternTitle: 'AI-first solutionism or value theatre'
  },
  targetVersion: '1.0.0', schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'baseline-source-resolver', baselineSha256: 'a'.repeat(64),
    productionContractVersion: '1.0.0', productionContractSha256: 'b'.repeat(64),
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
  allowedSources: [
    { sourceHandle:'source_001', sourceId:'SRC-EU-AIA', versionOrDate:'2024-07-12', verificationStatus:'VERIFIED', lastVerifiedDate:'2026-08-18' }
  ],
  allowedTactics: [], adjacentCriteria: []
};

const plan = buildAuthoringPlan(planInput);
const artifacts = new Map<CognitiveTaskType, CompletedTaskArtifact>();

function taskContract(taskType: CognitiveTaskType, version = '2.0.0'): TaskContract {
  return {
    contractVersion: version,
    taskId: `${plan.identity.pairId}:${taskType}:SIR`,
    taskType,
    targetObjectId: plan.identity.pairId,
    objective: 'Persisted resolver regression artifact.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [],
    lockedInputs: { authoring_plan_sha256: plan.planSha256 },
    allowedReferences: [], doNot: [],
    outputContract: { format:'JSON', schemaName:'Regression', requiredFields:[], additionalProperties:false },
    validationProfile: [], dependencyPaths: [], failureMode:'FAIL_CLOSED'
  };
}

function put(taskType: CognitiveTaskType, output: unknown, version = '2.0.0'): void {
  artifacts.set(taskType, {
    output,
    taskContract: taskContract(taskType, version),
    inputHash: `input-${taskType}`,
    outputHash: `output-${taskType}`
  });
}

put('PAIR_BOUNDARY', {
  capability: { canonicalDefinition:'Capability definition with sufficient detail.', governancePurpose:'Govern proportionate AI selection against problem, alternatives and value.', distinctClaim:'AI is selected only when proportionate to a defined problem, alternatives, value, cost and risk.', ownedTopics:['AI suitability'], excludedTopics:[] },
  antipattern: { canonicalDefinition:'AI is selected first without evidence of proportionate suitability.', pairedRelationship:'Failure of evidence-based AI suitability and value justification.' },
  boundaryRationale:'A2 owns AI suitability and proportionality.'
});
put('AP_FAILURE_MODEL', {
  failureMechanism:'AI is predetermined and novelty or activity substitutes for value and alternative evidence.',
  triggeringConditions:['AI is selected before alternatives are evaluated.'],
  observableFailureSurfaces:['No non-AI baseline or alternative comparison exists.'],
  nonExamples:['AI is selected after explicit comparison against simpler alternatives.'],
  distinctionFromCapabilityGap:'The anti-pattern requires solution-first decision logic rather than a generic maturity gap.'
});
put('APPLICABILITY', {
  capability:{ statement:'Applies to proposed and materially changed AI uses.', conditions:['An AI mechanism is proposed.'], exclusions:[], reassessmentTriggers:['Material change occurs.'] },
  antipattern:{ statement:'Applies where solution-selection rationale is assessable.', conditions:['AI selection is in scope.'], exclusions:[], reassessmentTriggers:['Material change occurs.'] },
  consistencyNotes:['Both objects share the same solution-selection boundary.']
});
put('PRIMARY_QUESTIONS', {
  capabilityQuestions:[{slot:1,question:'Is the problem and measurable value hypothesis defined independently of AI?'},{slot:2,question:'Is the AI approach compared with simpler alternatives using explicit trade-offs?'},{slot:3,question:'Do representative trials show sufficient value and feasibility with stop criteria?'}],
  antipatternQuestions:[{slot:1,question:'Was AI predetermined before a bounded problem and alternatives were established?'},{slot:2,question:'Do implementation choices substitute novelty for proportionate justification?'},{slot:3,question:'Does current evidence show progression despite weak value or alternative evidence?'}],
  coverageRationale:'The fixed dimensions cover intent, operation and evidence.'
});
put('ATOMIC_DECOMPOSITION', {
  capability:[{handle:'atomic_001',questionSlot:1,statement:'A measurable problem and non-AI baseline are defined.',evidenceNeed:'Problem and baseline evidence.'}],
  antipattern:[{handle:'atomic_001',questionSlot:1,statement:'AI was selected before the problem and alternatives were bounded.',evidenceNeed:'Decision chronology evidence.'}]
});
put('EVIDENCE_ARCHITECTURE', {
  capability:[{handle:'evidence_001',title:'Problem and alternatives record',claimSupported:'The problem, baseline and alternatives are documented.',evidenceClass:'DOCUMENTED_ANALYSIS',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Problem is defined independently of AI.'],limitations:['Planning evidence does not establish realized value.'],supportsAtomicHandles:['atomic_001']}],
  antipattern:[{handle:'evidence_001',title:'Solution-selection trail',claimSupported:'Decision chronology shows whether AI was predetermined.',evidenceClass:'DECISION_RECORD',minimumTechnicalAssurance:'DECLARED',requiredHumanAssurance:'HUMAN_VALIDATED',acceptanceConditions:['Chronology is attributable.'],limitations:['Retrospective narrative may be insufficient.'],supportsAtomicHandles:['atomic_001']}]
});
put('EVIDENCE_SAFETY', {
  capabilityRules:{evidenceCeilings:['Hypothesis does not prove realized value.'],falsePositiveGuards:['Require an alternative baseline.'],prohibitedInferences:['Do not infer proportionality from sponsorship.'],contradictionHandling:['Conflicts keep suitability unresolved.'],freshnessRules:['Material change requires reassessment.']},
  antipatternRules:{evidenceCeilings:['AI use alone does not establish solutionism.'],falsePositiveGuards:['Distinguish evidence-based selection from novelty.'],prohibitedInferences:['Do not infer tested absence from silence.'],contradictionHandling:['Conflicts prevent definitive conclusion.'],freshnessRules:['Evidence must match current solution.']},
  crossPairSafetyNotes:['Capability satisfaction and AP absence remain independent.']
});
put('AP_ABSENCE_CONTRACT', {
  requiredArtifacts:['Scoped decision record','Executed alternative comparison','Independent verification record'],
  interpretationBoundary:'Silence or missing business-case evidence cannot establish tested absence.'
});

const sourcePacket = buildSourceContextPacket({
  authoringPlan: plan,
  sealedSourceRegisterVersion: '1.5.0',
  sealedSourceRegisterSha256: 'f'.repeat(64),
  registerRecords: [{
    sourceId:'SRC-EU-AIA', versionOrDate:'2024-07-12', verificationStatus:'VERIFIED', lastVerifiedDate:'2026-08-18',
    effectiveStatus:'IN_FORCE', authorityTier:'PRIMARY_BINDING_AUTHORITY', authorityType:'LEGISLATION',
    officialLocation:'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
    applicabilityBoundary:'Apply article-by-article according to actor role, system classification, jurisdiction, use and transition date.',
    licensingBoundary:'Official legislation may be used within bounded source-context rules.',
    domainCoverage:['A'], modelContextPolicy:'BOUNDED_SNIPPET_ALLOWED', usageRightsReference:null
  }],
  locatorContexts:[{
    sourceId:'SRC-EU-AIA', locator:'Article 9(2)', locatorLabel:'Risk-management process',
    contextText:'The risk management system is a continuous iterative process planned and run throughout the lifecycle.'
  }]
});

const loadArtifact = async <T>(_pairRunId: string, taskType: CognitiveTaskType) =>
  artifacts.get(taskType) as CompletedTaskArtifact<T> | undefined;
const base = {
  pairRunId:'pair-run-source-resolver', authoringPlan:plan,
  categoryBaseline:{criterion:'A2 baseline'}, goldenReference:{reference_id:'A1_AP-A1',normative:false},
  sourceContextPacket:sourcePacket, loadArtifact
};

const resolved = await resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING' });
if (resolved.taskType !== 'SOURCE_MAPPING' || resolved.contractVersion !== '2.0.0') {
  throw new Error('Resolver did not construct SOURCE_MAPPING SIR v2 contract.');
}
if (resolved.lockedInputs.source_context_packet_sha256 !== sourcePacket.packetSha256) {
  throw new Error('Resolved Source Mapping contract lost Source Context Packet hash binding.');
}
const resolvedPacket = resolved.lockedInputs.source_context_packet as { sources?: Array<{locatorContexts?: Array<{locatorHandle?:string}>}> };
if (resolvedPacket.sources?.[0]?.locatorContexts?.[0]?.locatorHandle !== 'locator_001') {
  throw new Error('Resolver did not propagate deterministic locator context.');
}

async function expectReject(fn: () => Promise<unknown>, expected: string): Promise<void> {
  try { await fn(); }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expected)) throw new Error(`Expected rejection containing ${expected}; received ${message}`);
    return;
  }
  throw new Error(`Expected rejection containing ${expected}, but resolution succeeded.`);
}

await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING', sourceContextPacket:undefined }),
  'requires a Source Context Packet'
);

const tamperedPacket = structuredClone(sourcePacket);
tamperedPacket.sources[0]!.locatorContexts[0]!.exactLocator = 'Article 999';
await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING', sourceContextPacket:tamperedPacket }),
  'hash mismatch'
);

const otherPlan = buildAuthoringPlan({ ...planInput, targetVersion:'1.0.1' });
await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING', authoringPlan:otherPlan }),
  'different Authoring Plan'
);

const originalAbsence = artifacts.get('AP_ABSENCE_CONTRACT')!;
artifacts.set('AP_ABSENCE_CONTRACT', { ...originalAbsence, taskContract:taskContract('AP_ABSENCE_CONTRACT','1.0.0') });
await expectReject(
  () => resolveSirTaskContract({ ...base, taskType:'SOURCE_MAPPING' }),
  'SIR v2 requires 2.0.0'
);
artifacts.set('AP_ABSENCE_CONTRACT', originalAbsence);

console.log(JSON.stringify({
  sourceMappingResolver:'PASS',
  persistedUpstreamChain:'PASS',
  sourceContextVerifier:'PASS',
  deterministicLocatorPropagation:'PASS',
  missingSourcePacket:'REJECTED',
  tamperedSourcePacket:'REJECTED',
  wrongAuthoringPlanPacket:'REJECTED',
  legacyApAbsenceDependency:'REJECTED'
}, null, 2));
