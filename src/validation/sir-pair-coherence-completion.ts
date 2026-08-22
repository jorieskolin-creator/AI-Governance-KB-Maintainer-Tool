import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { PairCoherencePacket } from '../orchestration/pair-coherence-packet.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const pathHandle = z.string().regex(/^path_[0-9]{3}$/);
const defectSchema = z.object({
  severity: z.enum(['LOW','MEDIUM','HIGH','BLOCKING']),
  coherenceDimension: z.enum([
    'SEMANTIC_BOUNDARY',
    'CAPABILITY_ANTIPATTERN_RELATIONSHIP',
    'APPLICABILITY',
    'QUESTION_ATOMIC_ALIGNMENT',
    'EVIDENCE_INTERPRETATION',
    'SOURCE_INTERPRETATION',
    'FINDING_LOGIC',
    'CONTROL_AUTHORITY',
    'LIFECYCLE_ASSURANCE',
    'REFERENCE_OWNERSHIP',
    'CROSS_ARTIFACT_CONTRADICTION'
  ]),
  affectedPathHandles: z.array(pathHandle).min(1),
  issue: z.string().trim().min(10),
  coherenceExpectation: z.string().trim().min(10),
  recommendedRepairPathHandles: z.array(pathHandle).min(1)
}).strict();

const outputSchema = z.object({
  defects: z.array(defectSchema).max(50),
  coherenceSummary: z.string().trim().min(10)
}).strict();

export interface SirPairCoherenceCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(
  context: SirPairCoherenceCompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'SEMANTIC'
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: ['PAIR_COHERENCE_REVIEW']
  };
}

function report(
  context: SirPairCoherenceCompletionContext,
  findings: ValidationFinding[]
): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

function lockedPacket(
  contract: TaskContract,
  context: SirPairCoherenceCompletionContext,
  findings: ValidationFinding[]
): PairCoherencePacket | undefined {
  const raw = contract.lockedInputs.pair_coherence_packet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    findings.push(
      finding(
        context,
        'SIR_PAIR_COHERENCE_PACKET_REQUIRED',
        '/lockedInputs/pair_coherence_packet',
        'Pair Coherence completion requires the locked verified Pair Coherence Packet.',
        'REFERENCE'
      )
    );
    return undefined;
  }
  const packet = raw as PairCoherencePacket;
  if (
    packet.packetVersion !== '1.0.0' ||
    packet.pairId !== context.expectedPairId ||
    typeof packet.packetSha256 !== 'string' ||
    typeof packet.authoringPlanSha256 !== 'string' ||
    !Array.isArray(packet.pathRegistry)
  ) {
    findings.push(
      finding(
        context,
        'SIR_PAIR_COHERENCE_PACKET_INVALID',
        '/lockedInputs/pair_coherence_packet',
        'Locked Pair Coherence Packet identity or path registry is malformed.',
        'REFERENCE'
      )
    );
    return undefined;
  }

  if (contract.lockedInputs.pair_coherence_packet_sha256 !== packet.packetSha256) {
    findings.push(
      finding(
        context,
        'SIR_PAIR_COHERENCE_PACKET_HASH_BINDING',
        '/lockedInputs/pair_coherence_packet_sha256',
        'Task contract Pair Coherence Packet hash does not match the embedded packet hash.',
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
        'SIR_PAIR_COHERENCE_PACKET_HASH_INTEGRITY',
        '/lockedInputs/pair_coherence_packet',
        'Embedded Pair Coherence Packet content does not match its SHA-256 hash.',
        'REFERENCE'
      )
    );
  }
  if (contract.lockedInputs.authoring_plan_sha256 !== packet.authoringPlanSha256) {
    findings.push(
      finding(
        context,
        'SIR_PAIR_COHERENCE_AUTHORING_PLAN_BINDING',
        '/lockedInputs/authoring_plan_sha256',
        'Pair Coherence Packet and task contract belong to different Authoring Plans.',
        'REFERENCE'
      )
    );
  }
  return packet;
}

export function validateSirPairCoherenceCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirPairCoherenceCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'PAIR_COHERENCE_REVIEW') {
    findings.push(
      finding(
        context,
        'SIR_PAIR_COHERENCE_CONTRACT_IDENTITY',
        '/',
        'Pair Coherence SIR completion requires PAIR_COHERENCE_REVIEW contractVersion 2.0.0.',
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
          `PAIR_COHERENCE_REVIEW requires validated ${prerequisite}.`,
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
          'SIR_PAIR_COHERENCE_OUTPUT_CONTRACT',
          `/${issue.path.join('/')}`,
          issue.message,
          'SCHEMA'
        )
      );
    }
    return report(context, findings);
  }

  if (!packet) return report(context, findings);
  const allowedPaths = new Set(packet.pathRegistry.map((entry) => entry.pathHandle));
  if (allowedPaths.size !== packet.pathRegistry.length) {
    findings.push(
      finding(
        context,
        'SIR_PAIR_COHERENCE_PATH_REGISTRY_UNIQUE',
        '/lockedInputs/pair_coherence_packet/pathRegistry',
        'Pair Coherence Packet path registry contains duplicate handles.',
        'REFERENCE'
      )
    );
  }

  parsed.data.defects.forEach((defect, defectIndex) => {
    for (const [field, values] of [
      ['affectedPathHandles', defect.affectedPathHandles],
      ['recommendedRepairPathHandles', defect.recommendedRepairPathHandles]
    ] as const) {
      if (new Set(values).size !== values.length) {
        findings.push(
          finding(
            context,
            'SIR_PAIR_COHERENCE_DUPLICATE_PATH_HANDLE',
            `/defects/${defectIndex}/${field}`,
            `${field} must not contain duplicate path handles.`,
            'SCHEMA'
          )
        );
      }
      values.forEach((handle, pathIndex) => {
        if (!allowedPaths.has(handle)) {
          findings.push(
            finding(
              context,
              'SIR_PAIR_COHERENCE_UNKNOWN_PATH_HANDLE',
              `/defects/${defectIndex}/${field}/${pathIndex}`,
              `Path handle ${handle} is absent from the locked Pair Coherence Packet.`,
              'REFERENCE'
            )
          );
        }
      });
    }
  });

  // A HIGH/BLOCKING semantic defect is a valid QC result. It does not make the
  // model call structurally invalid; deterministic materialization derives pair passed=false.
  return report(context, findings);
}
