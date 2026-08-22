import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import {
  completionValidatorRoute,
  type CompletionValidatorRoute
} from './task-completion-router.js';

function contract(taskType:CognitiveTaskType, version='2.0.0'):TaskContract {
  return {
    contractVersion:version,
    taskId:`router:${taskType}`,
    taskType,
    targetObjectId:'A2_AP-A2',
    objective:'Completion router regression.',
    modelRole:'REASONER',
    upstreamTaskTypes:[], lockedInputs:{}, allowedReferences:[], doNot:[],
    outputContract:{format:'JSON',schemaName:'RouterRegression',requiredFields:[],additionalProperties:false},
    validationProfile:[], dependencyPaths:[], failureMode:'FAIL_CLOSED'
  };
}

const expected: Array<[CognitiveTaskType,CompletionValidatorRoute]> = [
  ['PAIR_BOUNDARY','SIR_INITIAL'],
  ['AP_FAILURE_MODEL','SIR_INITIAL'],
  ['APPLICABILITY','SIR_INITIAL'],
  ['PRIMARY_QUESTIONS','SIR_INITIAL'],
  ['ATOMIC_DECOMPOSITION','SIR_ATOMIC'],
  ['EVIDENCE_ARCHITECTURE','SIR_EVIDENCE'],
  ['EVIDENCE_SAFETY','SIR_EVIDENCE_SAFETY'],
  ['AP_ABSENCE_CONTRACT','SIR_AP_ABSENCE'],
  ['SOURCE_MAPPING','SIR_SOURCE_MAPPING'],
  ['FINDING_ARCHITECTURE','SIR_FINDING'],
  ['CONTROL_BOUNDARY','SIR_CONTROL']
];

for (const [taskType,route] of expected) {
  const actual = completionValidatorRoute(contract(taskType));
  if (actual !== route) {
    throw new Error(`${taskType} routed to ${actual}; expected ${route}.`);
  }
}

if (completionValidatorRoute(contract('LIFECYCLE_ASSURANCE','1.1.0')) !== 'LIFECYCLE_ASSURANCE') {
  throw new Error('Legacy Lifecycle Assurance lost its dedicated validator route.');
}
if (completionValidatorRoute(contract('FINDING_ARCHITECTURE','1.0.0')) !== 'LEGACY_COMPLETION') {
  throw new Error('Legacy Finding Architecture no longer routes to the legacy validator.');
}

function expectUnsupported(taskType:CognitiveTaskType):void {
  try {
    completionValidatorRoute(contract(taskType,'2.0.0'));
    throw new Error(`Unregistered ${taskType} SIR v2 unexpectedly fell through completion routing.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Unsupported SIR v2 completion route')) throw error;
  }
}

expectUnsupported('LIFECYCLE_ASSURANCE');
expectUnsupported('REFERENCE_MAPPING');

console.log(JSON.stringify({
  explicitSirV2Routes:'PASS',
  evidenceSafetyRoute:'PASS',
  apAbsenceRoute:'PASS',
  sourceMappingRoute:'PASS',
  findingRoute:'PASS',
  controlRoute:'PASS',
  legacyLifecycleDedicatedRoute:'PASS',
  lifecycleSirV2BeforeRegistration:'REJECTED',
  legacyV1Fallback:'PASS',
  unregisteredSirV2Fallback:'REJECTED'
}, null, 2));
