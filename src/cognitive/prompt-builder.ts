import type { TaskContract } from '../domain/task-contract.js';

export interface CognitivePromptPacket {
  system: string;
  user: string;
}

const SYSTEM_BOUNDARY = `You are executing one bounded cognitive task inside the AI Governance Knowledge Authoring pipeline.

The application, not the conversation, owns pipeline state. Treat every LOCKED INPUT as immutable. Perform only the stated OBJECTIVE. Do not broaden the task, repair unrelated content, invent missing upstream decisions, or make approval/legal/lifecycle decisions that are outside the task contract.

AUTHORITY HIERARCHY:
- Normative requirements come from the active Production Contract, active schemas, category/taxonomy baseline, sealed Source Register and approved Tactic Catalog when supplied.
- A1/AP-A1 Golden material is a non-normative reference exemplar only. It may calibrate semantic depth, traceability, evidence discipline, human/machine boundaries and publication completeness.
- Never infer a mandatory rule merely because the Golden reference contains a particular count, wording, source, tactic, severity, assurance value or category-specific structure. If the normative baseline and the Golden reference differ, follow the normative baseline.

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
