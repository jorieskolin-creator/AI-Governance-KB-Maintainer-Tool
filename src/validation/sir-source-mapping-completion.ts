import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { SourceContextPacket } from '../orchestration/source-context-packet.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const sourceHandle = z.string().regex(/^source_[A-Za-z0-9._-]+$/);
const locatorHandle = z.string().regex(/^locator_[0-9]{3}$/);
const meaningful = z.string().trim().min(10);

const mappingSchema = z.object({
  sourceHandle,
  locatorHandle,
  relationship: z.string().trim().min(1),
  supportedClaim: meaningful,
  categoryRationale: meaningful,
  applicabilityConditions: z.array(z.string().trim().min(1)),
  exclusions: z.array(z.string().trim().min(1))
}).strict();

const unmappedSchema = z.object({
  objectKind: z.enum(['CAPABILITY', 'ANTIPATTERN']),
  claim: meaningful,
  reason: z.enum([
    'INSUFFICIENT_SOURCE_CONTEXT',
    'NO_ALLOWED_SOURCE_SUPPORT',
    'APPLICABILITY_AMBIGUOUS',
    'RIGHTS_RESTRICTED_SOURCE_CONTEXT'
  ]),
  consideredSourceHandles: z.array(sourceHandle)
}).strict();

const outputSchema = z.object({
  capabilityMappings: z.array(mappingSchema),
  antipatternMappings: z.array(mappingSchema),
  unmappedClaims: z.array(unmappedSchema),
  mappingNotes: z.array(z.string().trim().min(1))
}).strict();

export interface SirSourceMappingCompletionContext {
  runId: string;
  expectedPairId: string;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function finding(
  context: SirSourceMappingCompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'REFERENCE'
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: []
  };
}

function report(
  context: SirSourceMappingCompletionContext,
  findings: ValidationFinding[]
): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

function validatePrerequisites(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  context: SirSourceMappingCompletionContext,
  findings: ValidationFinding[]
): void {
  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(
        finding(
          context,
          'SIR_PREREQUISITE_MISSING',
          '/',
          `${contract.taskType} requires validated ${prerequisite}.`,
          'SCHEMA'
        )
      );
    }
  }
}

function validatePacket(
  contract: TaskContract,
  context: SirSourceMappingCompletionContext,
  findings: ValidationFinding[]
): SourceContextPacket | undefined {
  const packet = contract.lockedInputs.source_context_packet as SourceContextPacket | undefined;
  if (!packet || typeof packet !== 'object') {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_PACKET_REQUIRED', '/source_context_packet', 'SOURCE_MAPPING requires a sealed Source Context Packet.', 'SOURCE')
    );
    return undefined;
  }

  if (packet.packetVersion !== '1.0.0') {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_PACKET_VERSION', '/source_context_packet/packetVersion', `Unsupported Source Context Packet version ${String(packet.packetVersion)}.`, 'SOURCE')
    );
  }
  if (packet.pairId !== context.expectedPairId) {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_PAIR_BINDING', '/source_context_packet/pairId', `Source Context Packet belongs to ${packet.pairId}, expected ${context.expectedPairId}.`, 'SOURCE')
    );
  }
  if (packet.authoringPlanSha256 !== contract.lockedInputs.authoring_plan_sha256) {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_PLAN_BINDING', '/source_context_packet/authoringPlanSha256', 'Source Context Packet belongs to a different Authoring Plan.', 'SOURCE')
    );
  }
  if (packet.packetSha256 !== contract.lockedInputs.source_context_packet_sha256) {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_PACKET_HASH_BINDING', '/source_context_packet/packetSha256', 'Task contract Source Context Packet hash does not match the supplied packet.', 'SOURCE')
    );
  }

  const { packetSha256, ...withoutHash } = packet;
  const expectedHash = sha256(withoutHash);
  if (packetSha256 !== expectedHash) {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_PACKET_HASH_INTEGRITY', '/source_context_packet/packetSha256', 'Source Context Packet content does not match its persisted hash.', 'SOURCE')
    );
  }

  const sourceHandles = packet.sources.map((item) => item.sourceHandle);
  if (new Set(sourceHandles).size !== sourceHandles.length) {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_DUPLICATE_SOURCE_HANDLE', '/source_context_packet/sources', 'Source Context Packet contains duplicate source handles.', 'SOURCE')
    );
  }

  const locatorHandles = packet.sources.flatMap((item) => item.locatorContexts.map((locator) => locator.locatorHandle));
  if (new Set(locatorHandles).size !== locatorHandles.length) {
    findings.push(
      finding(context, 'SIR_SOURCE_CONTEXT_DUPLICATE_LOCATOR_HANDLE', '/source_context_packet/sources', 'Source Context Packet contains duplicate locator handles.', 'SOURCE')
    );
  }

  return packet;
}

function validateMappings(
  groups: Array<{ path: string; items: z.infer<typeof mappingSchema>[] }>,
  packet: SourceContextPacket,
  context: SirSourceMappingCompletionContext,
  findings: ValidationFinding[]
): void {
  const sources = new Map(packet.sources.map((item) => [item.sourceHandle, item]));

  for (const group of groups) {
    const duplicateKeys = new Set<string>();
    group.items.forEach((item, index) => {
      const basePath = `/${group.path}/${index}`;
      const source = sources.get(item.sourceHandle);
      if (!source) {
        findings.push(
          finding(context, 'SIR_SOURCE_HANDLE_UNKNOWN', `${basePath}/sourceHandle`, `${item.sourceHandle} is absent from the sealed Source Context Packet.`, 'SOURCE')
        );
        return;
      }
      const locator = source.locatorContexts.find((candidate) => candidate.locatorHandle === item.locatorHandle);
      if (!locator) {
        findings.push(
          finding(
            context,
            'SIR_LOCATOR_HANDLE_WRONG_SOURCE_OR_UNKNOWN',
            `${basePath}/locatorHandle`,
            `${item.locatorHandle} is not a supplied locator for ${item.sourceHandle}.`,
            'SOURCE'
          )
        );
      }
      const duplicateKey = `${item.sourceHandle}\u0000${item.locatorHandle}\u0000${item.supportedClaim.trim().toLowerCase()}`;
      if (duplicateKeys.has(duplicateKey)) {
        findings.push(
          finding(context, 'SIR_SOURCE_MAPPING_DUPLICATE', basePath, 'Duplicate source/locator/supported-claim mapping candidate.', 'SOURCE')
        );
      }
      duplicateKeys.add(duplicateKey);
    });
  }
}

function validateUnmappedClaims(
  items: z.infer<typeof unmappedSchema>[],
  packet: SourceContextPacket,
  context: SirSourceMappingCompletionContext,
  findings: ValidationFinding[]
): void {
  const available = new Set(packet.sources.map((item) => item.sourceHandle));
  items.forEach((item, index) => {
    for (const handle of item.consideredSourceHandles) {
      if (!available.has(handle)) {
        findings.push(
          finding(
            context,
            'SIR_UNMAPPED_CLAIM_UNKNOWN_SOURCE_HANDLE',
            `/unmappedClaims/${index}/consideredSourceHandles`,
            `${handle} is absent from the sealed Source Context Packet.`,
            'SOURCE'
          )
        );
      }
    }
  });
}

export function validateSirSourceMappingCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirSourceMappingCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'SOURCE_MAPPING') {
    findings.push(
      finding(
        context,
        'SIR_SOURCE_MAPPING_CONTRACT_IDENTITY',
        '/',
        'Source Mapping SIR completion requires SOURCE_MAPPING contractVersion 2.0.0.',
        'SCHEMA'
      )
    );
    return report(context, findings);
  }

  validatePrerequisites(contract, completed, context, findings);
  const packet = validatePacket(contract, context, findings);

  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        finding(
          context,
          'SIR_SOURCE_MAPPING_OUTPUT_CONTRACT',
          `/${issue.path.join('/')}`,
          issue.message,
          'SCHEMA'
        )
      );
    }
    return report(context, findings);
  }

  if (
    parsed.data.capabilityMappings.length === 0 &&
    parsed.data.antipatternMappings.length === 0 &&
    parsed.data.unmappedClaims.length === 0
  ) {
    findings.push(
      finding(
        context,
        'SIR_SOURCE_MAPPING_EMPTY_RESULT',
        '/',
        'Source Mapping must return at least one mapping candidate or an explicit unmapped claim.',
        'SOURCE'
      )
    );
  }

  if (packet) {
    validateMappings(
      [
        { path: 'capabilityMappings', items: parsed.data.capabilityMappings },
        { path: 'antipatternMappings', items: parsed.data.antipatternMappings }
      ],
      packet,
      context,
      findings
    );
    validateUnmappedClaims(parsed.data.unmappedClaims, packet, context, findings);
  }

  return report(context, findings);
}
