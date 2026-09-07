import type { CognitiveTaskType } from './states.js';

export type ModelRole = 'REASONER' | 'WORKHORSE' | 'QUALITY_CHECKER';

export interface StructuredOutputContract {
  format: 'JSON';
  schemaName: string;
  requiredFields: string[];
  additionalProperties: false;
}

export interface TaskContract<TOutput = unknown> {
  contractVersion: string;
  taskId: string;
  taskType: CognitiveTaskType;
  targetObjectId: string;
  objective: string;
  modelRole: ModelRole;
  upstreamTaskTypes: CognitiveTaskType[];
  lockedInputs: Record<string, unknown>;
  allowedReferences: string[];
  doNot: string[];
  outputContract: StructuredOutputContract;
  validationProfile: string[];
  dependencyPaths: string[];
  failureMode: 'FAIL_CLOSED';
}

export interface TaskResult<TOutput = unknown> {
  taskId: string;
  status: 'COMPLETED' | 'FAILED';
  output?: TOutput;
  inputHash: string;
  outputHash?: string;
  modelCallId?: string;
  failureReason?: string;
}
