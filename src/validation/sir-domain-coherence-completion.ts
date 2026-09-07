import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type {
  SirDomainCoherenceDimension,
  SirDomainCoherenceOutput,
  SirDomainCoherenceSeverity
} from '../cognitive/sir-domain-coherence-contract.js';
import type {
  DomainCoherencePacket,
  DomainCoherencePairHandle,
  DomainCoherencePathHandle
} from '../orchestration/domain-coherence-packet.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const pairHandle = z.string().regex(/^pair_[0-9]{3}$/);
const pathHandle = z.string().regex(/^path_[0-9]{3}$/);
const defectSchema = z.object({
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKING']),
  coherenceDimension: z.enum([
    'OVERLAP',
    'COVERAGE_GAP',
    'CONTRADICTORY_BOUNDARY',
    'DUPLICATED_ATOMIC_MECHANISM',
    'INCONSISTENT_TERMINOLOGY',
    'CONFLICTING_SOURCE_INTERPRETATION',
    'INCONSISTENT_EVIDENCE_OR_ASSURANCE',
    'BROKEN_RELATED_CRITERION',
    'CROSS_PAIR_CONTRADICTION'
  ]),
  affectedPairHandles: z.array(pairHandle).min(1),
  affectedPathHandles: z.array(pathHandle).min(1),
  issue: z.string().trim().min(10),
  coherenceExpectation: z.string().trim().min(10),
  recommendedRepairPairHandles: z.array(pairHandle).min(1),
  recommendedRepairPathHandles: z.array(pathHandle).min(1)
}).strict();

const outputSchema = z.object({
  defects: z.array(defectSchema).max(50),
  coherenceSummary: z.string().trim().min(10)
}).strict();

const SEVERITY_ALIASES: Record<string, SirDomainCoherenceSeverity> = {
  low: 'LOW',
  minor: 'LOW',
  info: 'LOW',
  informational: 'LOW',
  medium: 'MEDIUM',
  moderate: 'MEDIUM',
  med: 'MEDIUM',
  high: 'HIGH',
  severe: 'HIGH',
  major: 'HIGH',
  blocking: 'BLOCKING',
  blocker: 'BLOCKING',
  critical: 'BLOCKING',
  fatal: 'BLOCKING'
};

const DIMENSION_ALIASES: Record<string, SirDomainCoherenceDimension> = {
  overlap: 'OVERLAP',
  coverage_gap: 'COVERAGE_GAP',
  coveragegap: 'COVERAGE_GAP',
  contradictory_boundary: 'CONTRADICTORY_BOUNDARY',
  contradictoryboundary: 'CONTRADICTORY_BOUNDARY',
  duplicated_atomic_mechanism: 'DUPLICATED_ATOMIC_MECHANISM',
  duplicatedatomicmechanism: 'DUPLICATED_ATOMIC_MECHANISM',
  inconsistent_terminology: 'INCONSISTENT_TERMINOLOGY',
  inconsistentterminology: 'INCONSISTENT_TERMINOLOGY',
  conflicting_source_interpretation: 'CONFLICTING_SOURCE_INTERPRETATION',
  conflictingsourceinterpretation: 'CONFLICTING_SOURCE_INTERPRETATION',
  inconsistent_evidence_or_assurance: 'INCONSISTENT_EVIDENCE_OR_ASSURANCE',
  inconsistentevidenceorassurance: 'INCONSISTENT_EVIDENCE_OR_ASSURANCE',
  broken_related_criterion: 'BROKEN_RELATED_CRITERION',
  brokenrelatedcriterion: 'BROKEN_RELATED_CRITERION',
  cross_pair_contradiction: 'CROSS_PAIR_CONTRADICTION',
  crosspaircontradiction: 'CROSS_PAIR_CONTRADICTION'
};

function recordOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
}

function pickList(record: Record<string, unknown>, keys: readonly string[]): string[] {
  for (const key of keys) {
    const list = stringList(record[key]);
    if (list.length) return list;
  }
  return [];
}

function pickText(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length >= 10) return value.trim();
  }
  return '';
}

function padHandle(prefix: 'pair' | 'path', raw: string): string | undefined {
  const match = raw.match(new RegExp(`^${prefix}_(\\d+)$`, 'i'));
  const digits = match?.[1];
  if (!digits) return undefined;
  return `${prefix}_${digits.padStart(3, '0')}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function coerceSeverity(value: unknown): SirDomainCoherenceSeverity | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return SEVERITY_ALIASES[key];
}

function coerceDimension(value: unknown): SirDomainCoherenceDimension | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return DIMENSION_ALIASES[key];
}

function coercePairHandles(values: string[], packet: DomainCoherencePacket): DomainCoherencePairHandle[] {
  const resolved: string[] = [];
  for (const raw of values) {
    const padded = padHandle('pair', raw);
    const byHandle = packet.pairDigests.find((item) => item.pairHandle === padded || item.pairHandle === raw);
    if (byHandle) {
      resolved.push(byHandle.pairHandle);
      continue;
    }
    const byId = packet.pairDigests.find(
      (item) =>
        item.pairId === raw ||
        item.capabilityId === raw ||
        item.antipatternId === raw ||
        item.pairId.replace('_', '/') === raw
    );
    if (byId) {
      resolved.push(byId.pairHandle);
      continue;
    }
    if (padded) resolved.push(padded);
  }
  return unique(resolved) as DomainCoherencePairHandle[];
}

function coercePathHandles(
  values: string[],
  packet: DomainCoherencePacket,
  pairHandles: DomainCoherencePairHandle[]
): DomainCoherencePathHandle[] {
  const resolved: string[] = [];
  for (const raw of values) {
    const padded = padHandle('path', raw);
    const byHandle = packet.pathRegistry.find((item) => item.pathHandle === padded || item.pathHandle === raw);
    if (byHandle) {
      resolved.push(byHandle.pathHandle);
      continue;
    }
    const byPath = packet.pathRegistry.find(
      (item) => item.objectPath === raw || item.objectPath.endsWith(raw) || raw.endsWith(item.objectPath)
    );
    if (byPath) {
      resolved.push(byPath.pathHandle);
      continue;
    }
    if (padded) resolved.push(padded);
  }
  if (values.length === 0) {
    for (const pairHandle of pairHandles) {
      const fallback = packet.pathRegistry.find((item) => item.pairHandle === pairHandle);
      if (fallback) resolved.push(fallback.pathHandle);
    }
  }
  return unique(resolved) as DomainCoherencePathHandle[];
}

export function coerceSirDomainCoherenceOutput(
  output: unknown,
  packet: DomainCoherencePacket
): SirDomainCoherenceOutput | undefined {
  const record = recordOf(output);
  if (!record) return undefined;
  const rawDefects = Array.isArray(record.defects)
    ? record.defects
    : Array.isArray(record.findings)
      ? record.findings
      : Array.isArray(record.issues)
        ? record.issues
        : [];
  const defects: SirDomainCoherenceOutput['defects'] = [];
  for (const item of rawDefects) {
    const row = recordOf(item);
    if (!row) continue;
    const severity = coerceSeverity(row.severity);
    const coherenceDimension = coerceDimension(row.coherenceDimension ?? row.dimension ?? row.type);
    const issue = pickText(row, ['issue', 'description', 'problem', 'finding']);
    const coherenceExpectation = pickText(row, ['coherenceExpectation', 'expectation', 'expected', 'required']);
    const pairHandles = coercePairHandles(
      pickList(row, [
        'affectedPairHandles',
        'recommendedRepairPairHandles',
        'affectedPairIds',
        'affectedPairs',
        'pairHandles',
        'pairIds',
        'pairs'
      ]),
      packet
    );
    const pathHandles = coercePathHandles(
      pickList(row, [
        'affectedPathHandles',
        'recommendedRepairPathHandles',
        'affectedPaths',
        'pathHandles',
        'paths'
      ]),
      packet,
      pairHandles
    );
    const repairPairs = coercePairHandles(
      pickList(row, ['recommendedRepairPairHandles', 'recommendedRepairPairIds', 'repairPairs']),
      packet
    );
    const repairPaths = coercePathHandles(
      pickList(row, ['recommendedRepairPathHandles', 'recommendedRepairPaths', 'repairPaths']),
      packet,
      repairPairs.length ? repairPairs : pairHandles
    );
    if (!severity || !coherenceDimension || !issue || !coherenceExpectation || !pairHandles.length || !pathHandles.length) {
      continue;
    }
    defects.push({
      severity,
      coherenceDimension,
      affectedPairHandles: pairHandles,
      affectedPathHandles: pathHandles,
      issue,
      coherenceExpectation,
      recommendedRepairPairHandles: repairPairs.length ? repairPairs : pairHandles,
      recommendedRepairPathHandles: repairPaths.length ? repairPaths : pathHandles
    });
    if (defects.length >= 50) break;
  }
  if (rawDefects.length > 0 && defects.length === 0) return undefined;
  const summary =
    pickText(record, ['coherenceSummary', 'summary', 'notes', 'rationale']) ||
    (defects.length
      ? `Domain Coherence QUALITY_CHECKER returned ${String(defects.length)} defect(s).`
      : 'No material cross-pair domain coherence defects were identified in this bounded five-pair review.');
  return { defects, coherenceSummary: summary };
}

export interface SirDomainCoherenceCompletionContext {
  runId: string;
  expectedDomain: string;
}

function finding(
  context: SirDomainCoherenceCompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'SEMANTIC'
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId: `DOMAIN-${context.expectedDomain}`,
    objectPath,
    issue,
    dependencyScope: ['DOMAIN_COHERENCE_REVIEW']
  };
}

function report(
  context: SirDomainCoherenceCompletionContext,
  findings: ValidationFinding[]
): ValidationReport {
  return {
    runId: context.runId,
    objectId: `DOMAIN-${context.expectedDomain}`,
    passed: findings.length === 0,
    findings
  };
}

function lockedPacket(
  contract: TaskContract,
  context: SirDomainCoherenceCompletionContext,
  findings: ValidationFinding[]
): DomainCoherencePacket | undefined {
  const raw = contract.lockedInputs.domain_coherence_packet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PACKET_REQUIRED',
        '/lockedInputs/domain_coherence_packet',
        'Domain Coherence completion requires the locked verified Domain Coherence Packet.',
        'REFERENCE'
      )
    );
    return undefined;
  }
  const packet = raw as DomainCoherencePacket;
  if (
    packet.packetVersion !== '1.0.0' ||
    packet.domain !== context.expectedDomain ||
    typeof packet.packetSha256 !== 'string' ||
    typeof packet.baselineSha256 !== 'string' ||
    !Array.isArray(packet.pairDigests) ||
    !Array.isArray(packet.pathRegistry)
  ) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PACKET_INVALID',
        '/lockedInputs/domain_coherence_packet',
        'Locked Domain Coherence Packet identity or registries are malformed.',
        'REFERENCE'
      )
    );
    return undefined;
  }

  if (packet.pairDigests.length !== 5) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PAIR_SET_INCOMPLETE',
        '/lockedInputs/domain_coherence_packet/pairDigests',
        'Locked Domain Coherence Packet must contain exactly five verified pairs.',
        'REFERENCE'
      )
    );
  }
  if (packet.pairDigests.some((digest) => digest.passed !== true)) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PAIR_NOT_PASSED',
        '/lockedInputs/domain_coherence_packet/pairDigests',
        'Domain Coherence cannot complete while a locked pair has not passed Pair Coherence.',
        'REFERENCE'
      )
    );
  }
  if (contract.lockedInputs.domain_coherence_packet_sha256 !== packet.packetSha256) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PACKET_HASH_BINDING',
        '/lockedInputs/domain_coherence_packet_sha256',
        'Task contract Domain Coherence Packet hash does not match the embedded packet hash.',
        'REFERENCE'
      )
    );
  }
  const { packetSha256, ...withoutHash } = packet;
  const computed = canonicalArtifactHash(withoutHash);
  if (packetSha256 !== computed) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PACKET_HASH_INTEGRITY',
        '/lockedInputs/domain_coherence_packet',
        'Embedded Domain Coherence Packet content does not match its SHA-256 hash.',
        'REFERENCE'
      )
    );
  }
  if (contract.lockedInputs.domain !== packet.domain) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_DOMAIN_BINDING',
        '/lockedInputs/domain',
        'Domain Coherence Packet and task contract belong to different domains.',
        'REFERENCE'
      )
    );
  }
  return packet;
}

export function validateSirDomainCoherenceCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirDomainCoherenceCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'DOMAIN_COHERENCE_REVIEW') {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_CONTRACT_IDENTITY',
        '/',
        'Domain Coherence SIR completion requires DOMAIN_COHERENCE_REVIEW contractVersion 2.0.0.',
        'SCHEMA'
      )
    );
    return report(context, findings);
  }

  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(
        finding(
          context,
          'SIR_PREREQUISITE_MISSING',
          '/',
          `DOMAIN_COHERENCE_REVIEW requires validated ${prerequisite}.`,
          'SCHEMA'
        )
      );
    }
  }

  const packet = lockedPacket(contract, context, findings);
  const coerced = packet ? coerceSirDomainCoherenceOutput(output, packet) : undefined;
  const parsed = outputSchema.safeParse(coerced ?? output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        finding(
          context,
          'SIR_DOMAIN_COHERENCE_OUTPUT_CONTRACT',
          `/${issue.path.join('/')}`,
          issue.message,
          'SCHEMA'
        )
      );
    }
    return report(context, findings);
  }

  if (!packet) return report(context, findings);
  const allowedPairs = new Set<string>(packet.pairDigests.map((entry) => entry.pairHandle));
  const allowedPaths = new Set<string>(packet.pathRegistry.map((entry) => entry.pathHandle));
  if (allowedPairs.size !== packet.pairDigests.length) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PAIR_REGISTRY_UNIQUE',
        '/lockedInputs/domain_coherence_packet/pairDigests',
        'Domain Coherence Packet pair registry contains duplicate handles.',
        'REFERENCE'
      )
    );
  }
  if (allowedPaths.size !== packet.pathRegistry.length) {
    findings.push(
      finding(
        context,
        'SIR_DOMAIN_COHERENCE_PATH_REGISTRY_UNIQUE',
        '/lockedInputs/domain_coherence_packet/pathRegistry',
        'Domain Coherence Packet path registry contains duplicate handles.',
        'REFERENCE'
      )
    );
  }

  parsed.data.defects.forEach((defect, defectIndex) => {
    for (const [field, values, allowed, unknownCheck] of [
      ['affectedPairHandles', defect.affectedPairHandles, allowedPairs, 'SIR_DOMAIN_COHERENCE_UNKNOWN_PAIR_HANDLE'],
      ['recommendedRepairPairHandles', defect.recommendedRepairPairHandles, allowedPairs, 'SIR_DOMAIN_COHERENCE_UNKNOWN_PAIR_HANDLE'],
      ['affectedPathHandles', defect.affectedPathHandles, allowedPaths, 'SIR_DOMAIN_COHERENCE_UNKNOWN_PATH_HANDLE'],
      ['recommendedRepairPathHandles', defect.recommendedRepairPathHandles, allowedPaths, 'SIR_DOMAIN_COHERENCE_UNKNOWN_PATH_HANDLE']
    ] as const) {
      if (new Set(values).size !== values.length) {
        findings.push(
          finding(
            context,
            'SIR_DOMAIN_COHERENCE_DUPLICATE_HANDLE',
            `/defects/${defectIndex}/${field}`,
            `${field} must not contain duplicate handles.`,
            'SCHEMA'
          )
        );
      }
      values.forEach((handle, handleIndex) => {
        if (!allowed.has(handle)) {
          findings.push(
            finding(
              context,
              unknownCheck,
              `/defects/${defectIndex}/${field}/${handleIndex}`,
              `Handle ${handle} is absent from the locked Domain Coherence Packet.`,
              'REFERENCE'
            )
          );
        }
      });
    }
  });

  // A HIGH/BLOCKING semantic defect is a valid QC result. Deterministic materialization derives passed=false.
  return report(context, findings);
}
