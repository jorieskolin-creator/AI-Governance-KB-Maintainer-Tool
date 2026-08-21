import type { CognitiveTaskType } from './states.js';

export type ModelRole = 'REASONER' | 'WORKHORSE' | 'QUALITY_CHECKER';

export interface TaskContract<TOutput = unknown> {
  taskId: string;
  taskType: CognitiveTaskType;
  targetObjectId: string;
  objective: string;
  modelRole: ModelRole;
  lockedInputs: Record<string, unknown>;
  allowedReferences: string[];
  doNot: string[];
  outputContract: string;
  validationProfile: string[];
  dependencyPaths: string[];
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
