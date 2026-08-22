import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { validateSirApAbsenceCompletion } from '../validation/sir-ap-absence-completion.js';

const contract: TaskContract = {
  contractVersion: '2.0.0',
  taskId: 'A2_AP-A2:AP_ABSENCE_CONTRACT:SIR',
  taskType: 'AP_ABSENCE_CONTRACT',
  targetObjectId: 'A2_AP-A2',
  objective: 'Regression contract for anti-pattern absence semantic content.',
  modelRole: 'REASONER',
  upstreamTaskTypes: [
    'PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY', 'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION', 'EVIDENCE_ARCHITECTURE', 'EVIDENCE_SAFETY'
  ],
  lockedInputs: {
    authoring_plan_sha256: 'plan-hash',
    normative_absence_conditions: {
      scope_defined: true,
      executed: true,
      successful: true,
      current: true,
      independently_verified: true
    },
    antipattern_atomics: [{ handle: 'atomic_001' }],
    antipattern_evidence: [{ handle: 'evidence_001', supportsAtomicHandles: ['atomic_001'] }],
    antipattern_evidence_safety: {
      evidenceCeilings: ['A bounded evidence ceiling.'],
      falsePositiveGuards: ['A bounded false-positive guard.'],
      prohibitedInferences: ['A bounded prohibited inference.'],
      contradictionHandling: ['A bounded contradiction rule.'],
      freshnessRules: ['A bounded freshness rule.']
    }
  },
  allowedReferences: ['VALIDATED_SIR_EVIDENCE_SAFETY'],
  doNot: [],
  outputContract: {
    format: 'JSON',
    schemaName: 'SirApAbsenceOutput',
    requiredFields: ['requiredArtifacts', 'interpretationBoundary'],
    additionalProperties: false
  },
  validationProfile: ['REQUIRED_ARTIFACTS_NONEMPTY'],
  dependencyPaths: ['sir.antipattern.absenceTest'],
  failureMode: 'FAIL_CLOSED'
};

const completed = new Set<CognitiveTaskType>(contract.upstreamTaskTypes);
const valid = {
  requiredArtifacts: [
    'Documented scope and execution record for the required anti-pattern tests.',
    'Current independent verification record covering the defined testing scope.'
  ],
  interpretationBoundary: 'The artifact set supports the knowledge contract only when all normative test conditions are independently satisfied.'
};

function validate(output: unknown, currentContract: TaskContract = contract, currentCompleted = completed) {
  return validateSirApAbsenceCompletion(
    currentContract,
    currentCompleted,
    output,
    { runId: 'ap-absence-regression', expectedPairId: 'A2_AP-A2' }
  );
}

if (!validate(valid).passed) throw new Error('Valid AP absence SIR failed regression.');

const modelOwnedBooleans = { ...valid, executed: true };
if (!validate(modelOwnedBooleans).findings.some((item) => item.checkId === 'SIR_AP_ABSENCE_OUTPUT_CONTRACT')) {
  throw new Error('Model-authored normative boolean was not rejected.');
}

const weakened: TaskContract = {
  ...contract,
  lockedInputs: {
    ...contract.lockedInputs,
    normative_absence_conditions: {
      ...(contract.lockedInputs.normative_absence_conditions as Record<string, unknown>),
      independently_verified: false
    }
  }
};
if (!validate(valid, weakened).findings.some((item) => item.checkId === 'SIR_AP_ABSENCE_NORMATIVE_CONDITION_TRUE')) {
  throw new Error('Weakened deterministic absence condition was not rejected.');
}

const missingEvidence: TaskContract = {
  ...contract,
  lockedInputs: { ...contract.lockedInputs, antipattern_evidence: [] }
};
if (!validate(valid, missingEvidence).findings.some((item) => item.checkId === 'SIR_AP_ABSENCE_UPSTREAM_GRAPH_REQUIRED')) {
  throw new Error('Missing AP evidence dependency was not rejected.');
}

console.log(JSON.stringify({
  apAbsenceSir: 'PASS',
  modelAuthoredNormativeBooleans: 'PROHIBITED',
  deterministicAbsenceConditions: 'PASS',
  upstreamEvidenceSafetyDependency: 'PASS'
}, null, 2));
