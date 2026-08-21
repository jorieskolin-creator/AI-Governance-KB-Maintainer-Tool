import type { TaskContract } from '../domain/task-contract.js';

export interface CognitivePromptPacket {
  system: string;
  user: string;
}

const SYSTEM_BOUNDARY = `You are executing one bounded cognitive task inside the AI Governance Knowledge Authoring pipeline.

The application, not the conversation, owns pipeline state. Treat every LOCKED INPUT as immutable. Perform only the stated OBJECTIVE. Do not broaden the task, repair unrelated content, invent missing upstream decisions, or make approval/legal/lifecycle decisions that are outside the task contract.

Return only JSON that conforms to the OUTPUT CONTRACT. If the task cannot be completed from the supplied locked inputs and allowed references, fail explicitly rather than filling the gap by assumption.`;

export function buildPromptPacket(contract: TaskContract): CognitivePromptPacket {
  const userPayload = {
    contract_version: contract.contractVersion,
    task_id: contract.taskId,
    task_type: contract.taskType,
    target_object_id: contract.targetObjectId,
    objective: contract.objective,
    locked_inputs: contract.lockedInputs,
    allowed_references: contract.allowedReferences,
    do_not: contract.doNot,
    output_contract: contract.outputContract,
    validation_profile: contract.validationProfile,
    failure_mode: contract.failureMode
  };

  return {
    system: SYSTEM_BOUNDARY,
    user: JSON.stringify(userPayload, null, 2)
  };
}
