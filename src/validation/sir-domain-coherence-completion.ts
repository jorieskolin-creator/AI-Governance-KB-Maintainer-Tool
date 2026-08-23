import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { DomainCoherencePacket } from '../orchestration/domain-coherence-packet.js';
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
  const parsed = outputSchema.safeParse(output);
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
