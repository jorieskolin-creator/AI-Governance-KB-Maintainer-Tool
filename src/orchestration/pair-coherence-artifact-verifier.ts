import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type {
  SirPairCoherenceDefectDraft,
  SirPairCoherenceOutput
} from '../cognitive/sir-pair-coherence-contract.js';
import type { TaskContract } from '../domain/task-contract.js';
import {
  materializePairCoherenceReview,
  type MaterializedPairCoherenceReview
} from '../sir/pair-coherence-materializer.js';
import { validateSirPairCoherenceCompletion } from '../validation/sir-pair-coherence-completion.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import type {
  PairCoherencePacket,
  PairCoherencePathHandle
} from './pair-coherence-packet.js';

function assertSameJson(left: unknown, right: unknown, label: string): void {
  if (canonicalArtifactHash(left) !== canonicalArtifactHash(right)) {
    throw new Error(`Persisted Pair Coherence contract ${label} drifted from the verified upstream artifact.`);
  }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unexpected or missing fields.`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function pathHandles(value: unknown, label: string): PairCoherencePathHandle[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array of path handles.`);
  }
  return value.map((raw, index) => {
    if (typeof raw !== 'string' || !/^path_[0-9]{3}$/.test(raw)) {
      throw new Error(`${label}[${index}] is not a Pair Coherence path handle.`);
    }
    return raw as PairCoherencePathHandle;
  });
}

function extractSemanticDefects(value: unknown): SirPairCoherenceDefectDraft[] {
  if (!Array.isArray(value)) {
    throw new Error('Persisted Pair Coherence defects must be an array.');
  }
  return value.map((raw, index) => {
    const item = objectRecord(raw, `Persisted Pair Coherence defects[${index}]`);
    exactKeys(
      item,
      [
        'defectId',
        'severity',
        'coherenceDimension',
        'affectedPathHandles',
        'affectedPaths',
        'issue',
        'coherenceExpectation',
        'recommendedRepairPathHandles',
        'recommendedRepairPaths'
      ],
      `Persisted Pair Coherence defects[${index}]`
    );
    if (typeof item.defectId !== 'string' || !/^defect_[0-9]{3}$/.test(item.defectId)) {
      throw new Error(`Persisted Pair Coherence defects[${index}] has a non-deterministic defect identity.`);
    }
    if (
      item.severity !== 'LOW' &&
      item.severity !== 'MEDIUM' &&
      item.severity !== 'HIGH' &&
      item.severity !== 'BLOCKING'
    ) {
      throw new Error(`Persisted Pair Coherence defects[${index}] has an ungoverned severity.`);
    }
    if (typeof item.coherenceDimension !== 'string' || !item.coherenceDimension.trim()) {
      throw new Error(`Persisted Pair Coherence defects[${index}] is missing a coherence dimension.`);
    }
    if (!Array.isArray(item.affectedPaths) || item.affectedPaths.some((path) => typeof path !== 'string' || !path.trim())) {
      throw new Error(`Persisted Pair Coherence defects[${index}] has invalid materialized affected paths.`);
    }
    if (
      !Array.isArray(item.recommendedRepairPaths) ||
      item.recommendedRepairPaths.some((path) => typeof path !== 'string' || !path.trim())
    ) {
      throw new Error(`Persisted Pair Coherence defects[${index}] has invalid materialized repair paths.`);
    }
    return {
      severity: item.severity,
      coherenceDimension: item.coherenceDimension as SirPairCoherenceDefectDraft['coherenceDimension'],
      affectedPathHandles: pathHandles(item.affectedPathHandles, `Persisted Pair Coherence defects[${index}].affectedPathHandles`),
      issue: nonEmptyString(item.issue, `Persisted Pair Coherence defects[${index}].issue`),
      coherenceExpectation: nonEmptyString(
        item.coherenceExpectation,
        `Persisted Pair Coherence defects[${index}].coherenceExpectation`
      ),
      recommendedRepairPathHandles: pathHandles(
        item.recommendedRepairPathHandles,
        `Persisted Pair Coherence defects[${index}].recommendedRepairPathHandles`
      )
    };
  });
}

function lockedPacket(contract: TaskContract): PairCoherencePacket {
  const raw = contract.lockedInputs.pair_coherence_packet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Persisted Pair Coherence contract has no locked Pair Coherence Packet.');
  }
  const packet = raw as PairCoherencePacket;
  if (packet.packetVersion !== '1.0.0' || typeof packet.packetSha256 !== 'string') {
    throw new Error('Persisted Pair Coherence locked packet identity is malformed.');
  }
  if (contract.lockedInputs.pair_coherence_packet_sha256 !== packet.packetSha256) {
    throw new Error('Persisted Pair Coherence contract packet hash binding is inconsistent.');
  }
  const { packetSha256, ...withoutHash } = packet;
  if (packetSha256 !== canonicalArtifactHash(withoutHash)) {
    throw new Error('Persisted Pair Coherence locked packet content does not match its SHA-256 hash.');
  }
  return packet;
}

export function verifyPersistedPairCoherenceArtifact(input: {
  output: unknown;
  pairCoherenceTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedPacket: PairCoherencePacket;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}): asserts input is {
  output: MaterializedPairCoherenceReview;
  pairCoherenceTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedPacket: PairCoherencePacket;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
} {
  const contract = input.pairCoherenceTaskContract;
  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'PAIR_COHERENCE_REVIEW') {
    throw new Error('Persisted Pair Coherence verifier requires PAIR_COHERENCE_REVIEW contractVersion 2.0.0.');
  }
  if (contract.targetObjectId !== input.authoringPlan.identity.pairId) {
    throw new Error('Persisted Pair Coherence target does not match the Authoring Plan pair.');
  }
  if (contract.lockedInputs.authoring_plan_sha256 !== input.authoringPlan.planSha256) {
    throw new Error('Persisted Pair Coherence belongs to a different Authoring Plan.');
  }
  if (contract.modelRole !== 'QUALITY_CHECKER') {
    throw new Error('Persisted Pair Coherence must remain a QUALITY_CHECKER critic-only task.');
  }
  if (contract.lockedInputs.deterministic_preflight_status !== 'PASSED_BEFORE_PAIR_COHERENCE_QC') {
    throw new Error('Persisted Pair Coherence is missing the deterministic preflight binding.');
  }

  assertSameJson(contract.lockedInputs.category_baseline, input.categoryBaseline, 'category baseline');
  assertSameJson(contract.lockedInputs.golden_reference, input.goldenReference, 'Golden reference');

  const packet = lockedPacket(contract);
  if (packet.pairId !== input.authoringPlan.identity.pairId) {
    throw new Error('Persisted Pair Coherence Packet pair does not match the Authoring Plan pair.');
  }
  if (packet.authoringPlanSha256 !== input.authoringPlan.planSha256) {
    throw new Error('Persisted Pair Coherence Packet belongs to a different Authoring Plan.');
  }
  assertSameJson(packet, input.verifiedPacket, 'Pair Coherence Packet');

  const output = objectRecord(input.output, 'Persisted Pair Coherence artifact');
  exactKeys(
    output,
    ['pairId', 'pairCoherencePacketSha256', 'passed', 'defects', 'coherenceSummary'],
    'Persisted Pair Coherence artifact'
  );
  if (output.pairId !== packet.pairId) {
    throw new Error('Persisted Pair Coherence pair identity drifted from the locked packet.');
  }
  if (output.pairCoherencePacketSha256 !== packet.packetSha256) {
    throw new Error('Persisted Pair Coherence packet hash drifted from the locked packet.');
  }
  if (typeof output.passed !== 'boolean') {
    throw new Error('Persisted Pair Coherence pass status must be a derived boolean.');
  }

  const semanticOutput: SirPairCoherenceOutput = {
    defects: extractSemanticDefects(output.defects),
    coherenceSummary: nonEmptyString(output.coherenceSummary, 'Persisted Pair Coherence coherenceSummary')
  };

  const report = validateSirPairCoherenceCompletion(
    contract,
    new Set(contract.upstreamTaskTypes),
    semanticOutput,
    {
      runId: 'persisted-pair-coherence-artifact-verification',
      expectedPairId: input.authoringPlan.identity.pairId
    }
  );
  if (!report.passed) {
    const summary = report.findings
      .map((item) => `${item.checkId}@${item.objectPath}: ${item.issue}`)
      .join(' | ');
    throw new Error(`Persisted Pair Coherence artifact failed deterministic re-validation: ${summary}`);
  }

  const expected = materializePairCoherenceReview(semanticOutput, packet);
  if (output.passed !== expected.passed) {
    throw new Error('Persisted Pair Coherence pass status drifted from deterministic derivation.');
  }
  if (canonicalArtifactHash(expected) !== canonicalArtifactHash(input.output)) {
    throw new Error('Persisted Pair Coherence materialized content drifted from deterministic reconstruction.');
  }
}
