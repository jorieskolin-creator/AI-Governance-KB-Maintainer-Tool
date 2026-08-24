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

Return only JSON that matches OUTPUT SHAPE exactly. Use only the keys shown there. Do not emit pairId, pair_id, capabilityId, capability_id, antipatternId, antipattern_id, domain, schemaVersion, releaseStatus, criterionId, or any other canonical identity field. Adjacent criteria may be referenced only by criterionHandle values supplied in locked inputs.`;

const PAIR_BOUNDARY_SHAPE = {
  capability: {
    canonicalDefinition: 'string, min 10 characters, semantic definition only',
    governancePurpose: 'string, min 10 characters',
    distinctClaim: 'string, min 10 characters, what this capability uniquely owns versus adjacent handles',
    ownedTopics: ['string'],
    excludedTopics: [{ criterionHandle: 'criterion_001', ownershipBoundary: 'string, min 10 characters' }]
  },
  antipattern: {
    canonicalDefinition: 'string, min 10 characters',
    pairedRelationship: 'string, min 10 characters'
  },
  boundaryRationale: 'string, min 10 characters'
};

function stripIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdentity);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (
      key === 'pair_identity' ||
      key === 'pairId' ||
      key === 'pair_id' ||
      key === 'capabilityId' ||
      key === 'capability_id' ||
      key === 'antipatternId' ||
      key === 'antipattern_id' ||
      key === 'criterionId'
    ) {
      continue;
    }
    next[key] = stripIdentity(child);
  }
  return next;
}

export function modelFacingLockedInputs(lockedInputs: Record<string, unknown>): Record<string, unknown> {
  const stripped = stripIdentity(lockedInputs) as Record<string, unknown>;
  if (Array.isArray(lockedInputs.adjacent_criteria)) {
    stripped.adjacent_criteria = lockedInputs.adjacent_criteria.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        criterionHandle: row.criterionHandle,
        boundarySummary: row.boundarySummary
      };
    });
  }
  return stripped;
}

export function buildPromptPacket(contract: TaskContract): CognitivePromptPacket {
  const locked = modelFacingLockedInputs(contract.lockedInputs);
  const userPayload = {
    contract_version: contract.contractVersion,
    task_type: contract.taskType,
    objective: contract.objective,
    locked_inputs: locked,
    allowed_references: contract.allowedReferences,
    do_not: contract.doNot,
    output_contract: contract.outputContract,
    output_shape: contract.taskType === 'PAIR_BOUNDARY' ? PAIR_BOUNDARY_SHAPE : undefined,
    validation_profile: contract.validationProfile,
    failure_mode: contract.failureMode
  };

  return {
    system: SYSTEM_BOUNDARY,
    user: JSON.stringify(userPayload, null, 2)
  };
}
