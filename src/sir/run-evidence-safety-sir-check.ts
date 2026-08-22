import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { validateSirEvidenceSafetyCompletion } from '../validation/sir-evidence-safety-completion.js';

const contract: TaskContract = {
  contractVersion: '2.0.0',
  taskId: 'A2_AP-A2:EVIDENCE_SAFETY:SIR',
  taskType: 'EVIDENCE_SAFETY',
  targetObjectId: 'A2_AP-A2',
  objective: 'Regression contract for semantic evidence-safety rules.',
  modelRole: 'REASONER',
  upstreamTaskTypes: [
    'PAIR_BOUNDARY',
    'AP_FAILURE_MODEL',
    'APPLICABILITY',
    'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION',
    'EVIDENCE_ARCHITECTURE'
  ],
  lockedInputs: {
    authoring_plan_sha256: 'plan-hash',
    capability_atomics: [{ handle: 'atomic_001' }],
    antipattern_atomics: [{ handle: 'atomic_001' }],
    capability_evidence: [{ handle: 'evidence_001', supportsAtomicHandles: ['atomic_001'] }],
    antipattern_evidence: [{ handle: 'evidence_001', supportsAtomicHandles: ['atomic_001'] }]
  },
  allowedReferences: ['VALIDATED_MATERIALIZED_SIR_ATOMICS', 'VALIDATED_MATERIALIZED_SIR_EVIDENCE'],
  doNot: [],
  outputContract: {
    format: 'JSON',
    schemaName: 'SirEvidenceSafetyOutput',
    requiredFields: ['capabilityRules', 'antipatternRules', 'crossPairSafetyNotes'],
    additionalProperties: false
  },
  validationProfile: ['ALL_EVIDENCE_RULE_FAMILIES_PRESENT'],
  dependencyPaths: ['sir.capability.evidenceRules', 'sir.antipattern.evidenceRules'],
  failureMode: 'FAIL_CLOSED'
};

const completed = new Set<CognitiveTaskType>(contract.upstreamTaskTypes);
const valid = {
  capabilityRules: {
    evidenceCeilings: ['Documented intent alone cannot establish implementation or operational effectiveness.'],
    falsePositiveGuards: ['Require evidence attributable to the governed scope before positive conclusions.'],
    prohibitedInferences: ['Do not infer implementation from policy approval alone.'],
    contradictionHandling: ['Material contradictions keep the affected conclusion unresolved until reconciled.'],
    freshnessRules: ['Evidence must be current for the assessed scope and material-change state.']
  },
  antipatternRules: {
    evidenceCeilings: ['A reported concern alone cannot establish the full anti-pattern failure mechanism.'],
    falsePositiveGuards: ['Distinguish the defined failure mechanism from an ordinary maturity gap.'],
    prohibitedInferences: ['Silence or missing incidents cannot establish tested absence.'],
    contradictionHandling: ['Conflicting evidence prevents a tested-absence conclusion until resolved.'],
    freshnessRules: ['Absence-relevant evidence must remain current to the defined testing scope.']
  },
  crossPairSafetyNotes: ['Capability satisfaction and anti-pattern absence remain independent evidence conclusions.']
};

function validate(output: unknown, currentContract: TaskContract = contract, currentCompleted = completed) {
  return validateSirEvidenceSafetyCompletion(
    currentContract,
    currentCompleted,
    output,
    { runId: 'evidence-safety-regression', expectedPairId: 'A2_AP-A2' }
  );
}

if (!validate(valid).passed) throw new Error('Valid Evidence Safety SIR failed regression.');

const missingFamily = structuredClone(valid) as any;
delete missingFamily.antipatternRules.prohibitedInferences;
if (!validate(missingFamily).findings.some((item) => item.checkId === 'SIR_EVIDENCE_SAFETY_OUTPUT_CONTRACT')) {
  throw new Error('Missing evidence-safety rule family was not rejected.');
}

const missingUpstream: TaskContract = {
  ...contract,
  lockedInputs: { ...contract.lockedInputs, capability_evidence: [] }
};
if (!validate(valid, missingUpstream).findings.some((item) => item.checkId === 'SIR_EVIDENCE_SAFETY_UPSTREAM_GRAPH_REQUIRED')) {
  throw new Error('Missing materialized evidence dependency was not rejected.');
}

const incomplete = new Set<CognitiveTaskType>(completed);
incomplete.delete('EVIDENCE_ARCHITECTURE');
if (!validate(valid, contract, incomplete).findings.some((item) => item.checkId === 'SIR_PREREQUISITE_MISSING')) {
  throw new Error('Missing Evidence Architecture prerequisite was not rejected.');
}

console.log(JSON.stringify({
  evidenceSafetySir: 'PASS',
  ruleFamilyCompleteness: 'PASS',
  materializedEvidenceDependency: 'PASS',
  prerequisiteGate: 'PASS',
  semanticQualityOwnedByQualityChecker: true
}, null, 2));
