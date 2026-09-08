import { requestBody, supportsProviderJsonSchema } from '../ai/provider-client.js';
import { buildPromptPacket, outputShapeForTask } from '../cognitive/prompt-builder.js';
import type { TaskContract } from '../domain/task-contract.js';
import { classifyDomainPipelineStop } from '../operator/eligibility.js';
import type { ValidationFinding } from '../validation/contracts.js';
import {
  allowedRepairPathsFromFindings,
  buildContentCorrectionPacket,
  contentCorrectionFailureMessage,
  isContentCorrectionFailure,
  isExecutionFailure,
  isProviderRouteFailure,
  providerRouteFailureMessage,
  replayedOriginalPromptToFallback,
  routeCognitiveTask,
  type CognitiveRouteAttempt,
  type PacketKind,
  type RouteTarget
} from './content-correction.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function finding(overrides: Partial<ValidationFinding> = {}): ValidationFinding {
  return {
    checkId: 'SIR_CONTENT_ONLY',
    kind: 'SCHEMA',
    severity: 'BLOCKING',
    objectId: 'A1_AP-A1',
    objectPath: 'capability.canonicalDefinition',
    issue: 'canonicalDefinition is shorter than the required semantic minimum.',
    dependencyScope: ['capability.governancePurpose'],
    recommendedAction: 'Expand the capability definition without changing adjacent ownership.',
    ...overrides
  };
}

const contract: TaskContract = {
  contractVersion: '2.0.0',
  taskId: 'A1_AP-A1:PAIR_BOUNDARY:SIR',
  taskType: 'PAIR_BOUNDARY',
  targetObjectId: 'A1_AP-A1',
  objective: 'Define only the semantic ownership boundary.',
  modelRole: 'REASONER',
  upstreamTaskTypes: [],
  lockedInputs: {
    pair_identity: { pair_id: 'A1_AP-A1', capability_id: 'A1', antipattern_id: 'AP-A1' },
    adjacent_criteria: [{ criterionHandle: 'criterion_001', boundarySummary: 'Neighbor owns a different topic.' }]
  },
  allowedReferences: ['AUTHORING_PLAN'],
  doNot: ['Do not output pairId.'],
  outputContract: {
    format: 'JSON',
    schemaName: 'SirPairBoundaryOutput',
    requiredFields: ['capability.canonicalDefinition', 'boundaryRationale'],
    additionalProperties: false
  },
  validationProfile: ['SIR_CONTENT_ONLY'],
  dependencyPaths: ['sir.capability.canonicalDefinition'],
  failureMode: 'FAIL_CLOSED'
};

const rejectedJson = {
  capability: { canonicalDefinition: 'Too short' },
  antipattern: { canonicalDefinition: 'A longer anti-pattern definition for the pair.' },
  boundaryRationale: 'A longer rationale that still leaves the capability definition defective.'
};

const findings = [
  finding(),
  finding({
    checkId: 'NONEMPTY_SEMANTIC_BOUNDARY',
    objectPath: 'capability.ownedTopics',
    issue: 'ownedTopics is missing.',
    dependencyScope: []
  })
];

assert(
  allowedRepairPathsFromFindings(findings).join(',') ===
    'capability.canonicalDefinition,capability.governancePurpose,capability.ownedTopics',
  'allowed repair paths come from finding objectPath plus impact-resolver dependency scope'
);

const originalPacket = buildPromptPacket(contract);
const correctionPacket = buildContentCorrectionPacket(contract, rejectedJson, findings);
const correctionUser = JSON.parse(correctionPacket.user) as Record<string, unknown>;
const originalUser = JSON.parse(originalPacket.user) as Record<string, unknown>;

assert(correctionUser.correction_mode === true, 'correction packet must mark correction_mode');
assert(
  JSON.stringify(correctionUser.rejected_json) === JSON.stringify(rejectedJson),
  'correction packet must include the rejected JSON'
);
assert(
  Array.isArray(correctionUser.deterministic_findings) &&
    (correctionUser.deterministic_findings as Array<{ checkId: string }>)[0]?.checkId === 'SIR_CONTENT_ONLY',
  'correction packet must include exact deterministic findings'
);
assert(
  JSON.stringify(correctionUser.allowed_repair_paths) ===
    JSON.stringify(allowedRepairPathsFromFindings(findings)),
  'correction packet must include allowed repair paths'
);
assert(
  JSON.stringify(correctionUser.contract_identity) ===
    JSON.stringify({
      task_id: contract.taskId,
      task_type: contract.taskType,
      contract_version: contract.contractVersion,
      schema_name: contract.outputContract.schemaName
    }),
  'correction packet must include contract identity'
);
assert(
  JSON.stringify(correctionUser.output_shape) === JSON.stringify(outputShapeForTask('PAIR_BOUNDARY')),
  'correction packet must include the applicable output shape'
);
assert(
  JSON.stringify(correctionUser.output_contract) === JSON.stringify(contract.outputContract),
  'correction packet must include the applicable output contract'
);
assert(!correctionPacket.user.includes('"pair_id"'), 'correction packet must strip locked pair_id');
assert(!correctionPacket.user.includes('"capability_id"'), 'correction packet must strip locked capability_id');
assert(correctionPacket.user.includes('criterionHandle'), 'correction packet must keep adjacent handles');
assert(
  !Array.isArray(correctionUser.deterministic_findings) ||
    !JSON.stringify(correctionUser.deterministic_findings).includes('"objectId"'),
  'model-facing findings omit objectId so the correction does not re-emit canonical identity'
);
assert(originalUser.correction_mode === undefined, 'original authoring packet is not a correction request');
assert(correctionPacket.user !== originalPacket.user, 'correction packet must differ from the original prompt');

const executionError = new Error('HTTP 429 quota exceeded');
assert(isExecutionFailure({ executionError, output: undefined }) === true, 'transport/quota errors are execution failures');
assert(
  isExecutionFailure({ output: rejectedJson }) === false,
  'a parsed JSON body that failed validation is not an execution failure'
);

async function recordRoute(
  script: Array<{ target: RouteTarget; packetKind: PacketKind; result: Omit<CognitiveRouteAttempt, 'target' | 'packetKind'> }>
) {
  const calls: Array<{ target: RouteTarget; packetKind: PacketKind }> = [];
  let index = 0;
  const routed = await routeCognitiveTask({
    async runAttempt(args) {
      calls.push(args);
      const next = script[index];
      index += 1;
      if (!next || next.target !== args.target || next.packetKind !== args.packetKind) {
        throw new Error(
          `Unexpected attempt ${args.target}/${args.packetKind}; expected ${next?.target ?? 'none'}/${next?.packetKind ?? 'none'}`
        );
      }
      return next.result;
    }
  });
  return { routed, calls };
}

const executionFallback = await recordRoute([
  {
    target: 'primary',
    packetKind: 'ORIGINAL',
    result: { passed: false, findings: [], executionError }
  },
  {
    target: 'fallback',
    packetKind: 'ORIGINAL',
    result: { passed: true, output: { ok: true }, findings: [] }
  }
]);
assert(executionFallback.routed.status === 'COMPLETED', 'execution failure may complete on fallback');
assert(executionFallback.routed.status === 'COMPLETED' && executionFallback.routed.usedFallback === true, 'fallback completion is marked usedFallback');
assert(
  executionFallback.calls.some((item) => item.target === 'fallback' && item.packetKind === 'ORIGINAL'),
  'execution/transport failure replays the original packet on fallback'
);

const validationNoFallback = await recordRoute([
  {
    target: 'primary',
    packetKind: 'ORIGINAL',
    result: { passed: false, output: rejectedJson, findings }
  },
  {
    target: 'primary',
    packetKind: 'CORRECTION',
    result: { passed: true, output: { ok: true }, findings: [] }
  }
]);
assert(validationNoFallback.routed.status === 'COMPLETED', 'validation failure may complete from the defect packet');
assert(
  validationNoFallback.routed.status === 'COMPLETED' && validationNoFallback.routed.usedFallback === false,
  'primary correction does not count as provider fallback'
);
assert(
  !validationNoFallback.calls.some((item) => item.target === 'fallback'),
  'validation failure must not call the fallback provider'
);
assert(
  replayedOriginalPromptToFallback(validationNoFallback.routed.attempts) === false,
  'a known invalid response is not replayed to another provider'
);

const persisted: Array<{ rejectedJson: unknown; findings: ValidationFinding[] }> = [];
const stillInvalid = await routeCognitiveTask({
  async runAttempt(args) {
    if (args.packetKind === 'ORIGINAL') {
      return { passed: false, output: rejectedJson, findings };
    }
    return { passed: false, output: { still: 'invalid' }, findings };
  },
  async onValidationFailure(packet) {
    persisted.push(packet);
  }
});
assert(stillInvalid.status === 'FAIL_CONTENT_CORRECTION', 'still-invalid correction remains failed');
assert(persisted.length === 1, 'the rejected candidate is persisted before the correction request');
assert(JSON.stringify(persisted[0]?.rejectedJson) === JSON.stringify(rejectedJson), 'persisted candidate is the rejected JSON');
assert(stillInvalid.status === 'FAIL_CONTENT_CORRECTION' && stillInvalid.findings.length >= 1, 'terminal findings stay available for human review');
assert(
  stillInvalid.attempts.every((item) => item.target === 'primary'),
  'failed correction stays on the provider that produced the invalid JSON'
);

const exhaustedRoutes = await recordRoute([
  {
    target: 'primary',
    packetKind: 'ORIGINAL',
    result: { passed: false, findings: [], executionError }
  },
  {
    target: 'fallback',
    packetKind: 'ORIGINAL',
    result: { passed: false, findings: [], executionError: new Error('timeout') }
  }
]);
assert(exhaustedRoutes.routed.status === 'FAIL_EXECUTION_ROUTES', 'timeout/quota exhaustion uses the execution-route failure');

const fallbackThenCorrect = await recordRoute([
  {
    target: 'primary',
    packetKind: 'ORIGINAL',
    result: { passed: false, findings: [], executionError }
  },
  {
    target: 'fallback',
    packetKind: 'ORIGINAL',
    result: { passed: false, output: rejectedJson, findings }
  },
  {
    target: 'fallback',
    packetKind: 'CORRECTION',
    result: { passed: true, output: { ok: true }, findings: [] }
  }
]);
assert(
  fallbackThenCorrect.calls[1]?.packetKind === 'ORIGINAL' && fallbackThenCorrect.calls[2]?.packetKind === 'CORRECTION',
  'fallback execution success with invalid JSON is corrected on that same fallback provider'
);
assert(
  fallbackThenCorrect.routed.status === 'COMPLETED' && fallbackThenCorrect.routed.usedFallback === true,
  'correction after execution failover still records usedFallback'
);

const routeError = new Error(providerRouteFailureMessage('PAIR_BOUNDARY', 'HTTP 429 quota exceeded'));
const correctionError = new Error(contentCorrectionFailureMessage('PAIR_BOUNDARY'));
assert(isProviderRouteFailure(routeError) === true, 'execution exhaustion remains a provider-route failure');
assert(isProviderRouteFailure(correctionError) === false, 'content-correction exhaustion is not a provider-route failure');
assert(isContentCorrectionFailure(correctionError) === true, 'content-correction exhaustion has a distinct marker');
assert(
  classifyDomainPipelineStop(routeError.message) === 'FAILED',
  'model or SIR execution-route failure must stop the pipeline for in-place retry'
);
assert(
  classifyDomainPipelineStop(correctionError.message) === 'FAILED',
  'still-invalid corrected content must stop for human review'
);

const gpt4oFormat = requestBody({
  target: { provider: 'OPENAI', model: 'gpt-4o' },
  systemPrompt: 'sys',
  userPrompt: 'user',
  structuredOutput: {
    schemaName: 'SirPairBoundaryOutput',
    requiredFields: ['capability.canonicalDefinition', 'boundaryRationale']
  }
}).response_format as { type?: string; json_schema?: { schema?: { required?: string[] } } };
assert(supportsProviderJsonSchema({ provider: 'OPENAI', model: 'gpt-4o' }) === true, 'gpt-4o can send json_schema');
assert(gpt4oFormat.type === 'json_schema', 'OpenAI gpt-4o uses provider-native json_schema as a transport hint');
assert(
  JSON.stringify(gpt4oFormat.json_schema?.schema?.required) === JSON.stringify(['capability', 'boundaryRationale']),
  'json_schema required keys are top-level output fields, not dotted SIR paths'
);

const gpt5Format = requestBody({
  target: { provider: 'OPENAI', model: 'gpt-5.6-terra' },
  systemPrompt: 'sys',
  userPrompt: 'user',
  structuredOutput: {
    schemaName: 'SirPairBoundaryOutput',
    requiredFields: ['capability.canonicalDefinition']
  }
}).response_format as { type?: string };
assert(gpt5Format.type === 'json_object', 'GPT-5 keeps json_object rather than json_schema');
assert(
  (
    requestBody({
      target: { provider: 'GROK', model: 'grok-4.6' },
      systemPrompt: 'sys',
      userPrompt: 'user',
      structuredOutput: { schemaName: 'SirPairBoundaryOutput', requiredFields: ['capability'] }
    }).response_format as { type?: string }
  ).type === 'json_object',
  'Grok keeps json_object'
);

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      executionUsesOriginalFallback: 'PASS',
      validationUsesDefectPacket: 'PASS',
      stillInvalidSurfacesHumanReview: 'PASS',
      providerRouteFailureDistinct: 'PASS',
      localValidationRemainsAuthority: 'PASS',
      providerNativeJsonSchemaHint: 'PASS'
    },
    null,
    2
  )
);
