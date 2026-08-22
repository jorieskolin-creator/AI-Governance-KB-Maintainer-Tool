import type { CognitiveTaskType } from '../domain/states.js';
import { materializeSirAtomics } from './atomic-materializer.js';
import { validateSirAtomicCompletion } from '../validation/sir-atomic-completion.js';
import type { SirAtomicDecompositionOutput } from '../cognitive/sir-atomic-contract.js';
import type { TaskContract } from '../domain/task-contract.js';

const contract: TaskContract = {
  contractVersion: '2.0.0',
  taskId: 'A2_AP-A2:ATOMIC_DECOMPOSITION:SIR',
  taskType: 'ATOMIC_DECOMPOSITION',
  targetObjectId: 'A2_AP-A2',
  objective: 'Regression-only SIR atomic contract.',
  modelRole: 'REASONER',
  upstreamTaskTypes: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY', 'PRIMARY_QUESTIONS'],
  lockedInputs: {},
  allowedReferences: [],
  doNot: [],
  outputContract: { format: 'JSON', schemaName: 'SirAtomicDecompositionOutput', requiredFields: ['capabilitySubcriteria','antipatternTests','coverageNotes'], additionalProperties: false },
  validationProfile: [],
  dependencyPaths: [],
  failureMode: 'FAIL_CLOSED'
};

const completed = new Set<CognitiveTaskType>(['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS']);
const valid: SirAtomicDecompositionOutput = {
  capabilitySubcriteria: [
    { questionSlot: 1, criterion: 'A sufficiently atomic capability criterion for the first question.', evidenceNeed: 'Evidence must establish the first criterion without inference.' },
    { questionSlot: 2, criterion: 'A sufficiently atomic capability criterion for the second question.', evidenceNeed: 'Evidence must establish implementation of the second criterion.' },
    { questionSlot: 3, criterion: 'A sufficiently atomic capability criterion for the third question.', evidenceNeed: 'Evidence must establish effectiveness for the third criterion.' }
  ],
  antipatternTests: [
    { questionSlot: 1, test: 'A sufficiently atomic anti-pattern test for the first question.', evidenceNeed: 'Evidence must establish the defined failure condition.' },
    { questionSlot: 2, test: 'A sufficiently atomic anti-pattern test for the second question.', evidenceNeed: 'Evidence must establish the operational failure surface.' },
    { questionSlot: 3, test: 'A sufficiently atomic anti-pattern test for the third question.', evidenceNeed: 'Evidence must support presence, uncertainty or tested absence.' }
  ],
  coverageNotes: ['All governed question slots are independently covered.']
};

const context = { runId: 'atomic-sir-regression', expectedPairId: 'A2_AP-A2' };
const base = validateSirAtomicCompletion(contract, completed, valid, context);
if (!base.passed) throw new Error(`Valid atomic SIR failed: ${base.findings.map((item) => item.checkId).join(', ')}`);

const materialized = materializeSirAtomics(valid);
const expectedCapability = ['atomic_001','atomic_002','atomic_003'];
const expectedAntipattern = ['atomic_001','atomic_002','atomic_003'];
if (materialized.capability.map((item) => item.handle).join('|') !== expectedCapability.join('|')) {
  throw new Error('Capability atomic handles are not deterministic.');
}
if (materialized.antipattern.map((item) => item.handle).join('|') !== expectedAntipattern.join('|')) {
  throw new Error('Antipattern atomic handles are not deterministic.');
}

const missingSlot = {
  ...valid,
  capabilitySubcriteria: valid.capabilitySubcriteria.map((item) => ({ ...item, questionSlot: item.questionSlot === 3 ? 2 as const : item.questionSlot }))
};
const missing = validateSirAtomicCompletion(contract, completed, missingSlot, context);
if (missing.passed || !missing.findings.some((item) => item.checkId === 'SIR_PRIMARY_QUESTION_SLOT_COVERAGE')) {
  throw new Error('Missing question-slot coverage was not detected.');
}

const withModelHandle = {
  ...valid,
  capabilitySubcriteria: valid.capabilitySubcriteria.map((item, index) => index === 0 ? { ...item, handle: 'atomic_001' } : item)
};
const handleAttempt = validateSirAtomicCompletion(contract, completed, withModelHandle, context);
if (handleAttempt.passed || !handleAttempt.findings.some((item) => item.checkId === 'SIR_ATOMIC_OUTPUT_CONTRACT')) {
  throw new Error('Model-owned SIR handle was not rejected.');
}

console.log(JSON.stringify({ atomicSir: 'PASS', modelOwnedHandles: 'PROHIBITED', deterministicHandleMaterialization: 'PASS', questionSlotCoverage: 'PASS' }, null, 2));
