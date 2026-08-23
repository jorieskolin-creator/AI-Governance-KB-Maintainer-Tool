import type { DomainId } from '../authoring/authoring-plan.js';
import type {
  SirDomainCoherenceDefectDraft,
  SirDomainCoherenceOutput
} from '../cognitive/sir-domain-coherence-contract.js';
import type { TaskContract } from '../domain/task-contract.js';
import {
  materializeDomainCoherenceReview,
  type MaterializedDomainCoherenceReview
} from '../sir/domain-coherence-materializer.js';
import { validateSirDomainCoherenceCompletion } from '../validation/sir-domain-coherence-completion.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import type {
  DomainCoherencePacket,
  DomainCoherencePairHandle,
  DomainCoherencePathHandle
} from './domain-coherence-packet.js';

function assertSameJson(left: unknown, right: unknown, label: string): void {
  if (canonicalArtifactHash(left) !== canonicalArtifactHash(right)) {
    throw new Error(`Persisted Domain Coherence contract ${label} drifted from the verified upstream artifact.`);
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

function pairHandles(value: unknown, label: string): DomainCoherencePairHandle[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array of pair handles.`);
  }
  return value.map((raw, index) => {
    if (typeof raw !== 'string' || !/^pair_[0-9]{3}$/.test(raw)) {
      throw new Error(`${label}[${index}] is not a Domain Coherence pair handle.`);
    }
    return raw as DomainCoherencePairHandle;
  });
}

function pathHandles(value: unknown, label: string): DomainCoherencePathHandle[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array of path handles.`);
  }
  return value.map((raw, index) => {
    if (typeof raw !== 'string' || !/^path_[0-9]{3}$/.test(raw)) {
      throw new Error(`${label}[${index}] is not a Domain Coherence path handle.`);
    }
    return raw as DomainCoherencePathHandle;
  });
}

function extractSemanticDefects(value: unknown): SirDomainCoherenceDefectDraft[] {
  if (!Array.isArray(value)) {
    throw new Error('Persisted Domain Coherence defects must be an array.');
  }
  return value.map((raw, index) => {
    const item = objectRecord(raw, `Persisted Domain Coherence defects[${index}]`);
    exactKeys(
      item,
      [
        'defectId',
        'severity',
        'coherenceDimension',
        'affectedPairHandles',
        'affectedPairIds',
        'affectedPathHandles',
        'affectedPaths',
        'issue',
        'coherenceExpectation',
        'recommendedRepairPairHandles',
        'recommendedRepairPairIds',
        'recommendedRepairPathHandles',
        'recommendedRepairPaths'
      ],
      `Persisted Domain Coherence defects[${index}]`
    );
    if (typeof item.defectId !== 'string' || !/^defect_[0-9]{3}$/.test(item.defectId)) {
      throw new Error(`Persisted Domain Coherence defects[${index}] has a non-deterministic defect identity.`);
    }
    if (
      item.severity !== 'LOW' &&
      item.severity !== 'MEDIUM' &&
      item.severity !== 'HIGH' &&
      item.severity !== 'BLOCKING'
    ) {
      throw new Error(`Persisted Domain Coherence defects[${index}] has an ungoverned severity.`);
    }
    if (typeof item.coherenceDimension !== 'string' || !item.coherenceDimension.trim()) {
      throw new Error(`Persisted Domain Coherence defects[${index}] is missing a coherence dimension.`);
    }
    if (!Array.isArray(item.affectedPairIds) || item.affectedPairIds.some((id) => typeof id !== 'string' || !id.trim())) {
      throw new Error(`Persisted Domain Coherence defects[${index}] has invalid materialized pair IDs.`);
    }
    if (!Array.isArray(item.affectedPaths) || item.affectedPaths.some((path) => typeof path !== 'string' || !path.trim())) {
      throw new Error(`Persisted Domain Coherence defects[${index}] has invalid materialized affected paths.`);
    }
    if (
      !Array.isArray(item.recommendedRepairPairIds) ||
      item.recommendedRepairPairIds.some((id) => typeof id !== 'string' || !id.trim())
    ) {
      throw new Error(`Persisted Domain Coherence defects[${index}] has invalid materialized repair pair IDs.`);
    }
    if (
      !Array.isArray(item.recommendedRepairPaths) ||
      item.recommendedRepairPaths.some((path) => typeof path !== 'string' || !path.trim())
    ) {
      throw new Error(`Persisted Domain Coherence defects[${index}] has invalid materialized repair paths.`);
    }
    return {
      severity: item.severity,
      coherenceDimension: item.coherenceDimension as SirDomainCoherenceDefectDraft['coherenceDimension'],
      affectedPairHandles: pairHandles(
        item.affectedPairHandles,
        `Persisted Domain Coherence defects[${index}].affectedPairHandles`
      ),
      affectedPathHandles: pathHandles(
        item.affectedPathHandles,
        `Persisted Domain Coherence defects[${index}].affectedPathHandles`
      ),
      issue: nonEmptyString(item.issue, `Persisted Domain Coherence defects[${index}].issue`),
      coherenceExpectation: nonEmptyString(
        item.coherenceExpectation,
        `Persisted Domain Coherence defects[${index}].coherenceExpectation`
      ),
      recommendedRepairPairHandles: pairHandles(
        item.recommendedRepairPairHandles,
        `Persisted Domain Coherence defects[${index}].recommendedRepairPairHandles`
      ),
      recommendedRepairPathHandles: pathHandles(
        item.recommendedRepairPathHandles,
        `Persisted Domain Coherence defects[${index}].recommendedRepairPathHandles`
      )
    };
  });
}

function lockedPacket(contract: TaskContract): DomainCoherencePacket {
  const raw = contract.lockedInputs.domain_coherence_packet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Persisted Domain Coherence contract has no locked Domain Coherence Packet.');
  }
  const packet = raw as DomainCoherencePacket;
  if (packet.packetVersion !== '1.0.0' || typeof packet.packetSha256 !== 'string') {
    throw new Error('Persisted Domain Coherence locked packet identity is malformed.');
  }
  if (contract.lockedInputs.domain_coherence_packet_sha256 !== packet.packetSha256) {
    throw new Error('Persisted Domain Coherence contract packet hash binding is inconsistent.');
  }
  const { packetSha256, ...withoutHash } = packet;
  if (packetSha256 !== canonicalArtifactHash(withoutHash)) {
    throw new Error('Persisted Domain Coherence locked packet content does not match its SHA-256 hash.');
  }
  return packet;
}

export function verifyPersistedDomainCoherenceArtifact(input: {
  output: unknown;
  domainCoherenceTaskContract: TaskContract;
  domain: DomainId;
  verifiedPacket: DomainCoherencePacket;
  domainBaseline: Record<string, unknown>;
  goldenStandardDomainRules: Record<string, unknown>;
}): asserts input is {
  output: MaterializedDomainCoherenceReview;
  domainCoherenceTaskContract: TaskContract;
  domain: DomainId;
  verifiedPacket: DomainCoherencePacket;
  domainBaseline: Record<string, unknown>;
  goldenStandardDomainRules: Record<string, unknown>;
} {
  const contract = input.domainCoherenceTaskContract;
  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'DOMAIN_COHERENCE_REVIEW') {
    throw new Error('Persisted Domain Coherence verifier requires DOMAIN_COHERENCE_REVIEW contractVersion 2.0.0.');
  }
  if (contract.targetObjectId !== `DOMAIN-${input.domain}`) {
    throw new Error('Persisted Domain Coherence target does not match the requested domain.');
  }
  if (contract.lockedInputs.domain !== input.domain) {
    throw new Error('Persisted Domain Coherence belongs to a different domain.');
  }
  if (contract.modelRole !== 'QUALITY_CHECKER') {
    throw new Error('Persisted Domain Coherence must remain a QUALITY_CHECKER critic-only task.');
  }
  if (contract.lockedInputs.deterministic_preflight_status !== 'PASSED_BEFORE_DOMAIN_COHERENCE_QC') {
    throw new Error('Persisted Domain Coherence is missing the deterministic preflight binding.');
  }

  assertSameJson(contract.lockedInputs.domain_baseline, input.domainBaseline, 'domain baseline');
  assertSameJson(
    contract.lockedInputs.golden_standard_domain_rules,
    input.goldenStandardDomainRules,
    'Golden domain rules'
  );

  const packet = lockedPacket(contract);
  if (packet.domain !== input.domain) {
    throw new Error('Persisted Domain Coherence Packet domain does not match the requested domain.');
  }
  assertSameJson(packet, input.verifiedPacket, 'Domain Coherence Packet');

  const output = objectRecord(input.output, 'Persisted Domain Coherence artifact');
  exactKeys(
    output,
    ['domain', 'domainCoherencePacketSha256', 'passed', 'defects', 'coherenceSummary'],
    'Persisted Domain Coherence artifact'
  );
  if (output.domain !== packet.domain) {
    throw new Error('Persisted Domain Coherence domain identity drifted from the locked packet.');
  }
  if (output.domainCoherencePacketSha256 !== packet.packetSha256) {
    throw new Error('Persisted Domain Coherence packet hash drifted from the locked packet.');
  }
  if (typeof output.passed !== 'boolean') {
    throw new Error('Persisted Domain Coherence pass status must be a derived boolean.');
  }

  const semanticOutput: SirDomainCoherenceOutput = {
    defects: extractSemanticDefects(output.defects),
    coherenceSummary: nonEmptyString(output.coherenceSummary, 'Persisted Domain Coherence coherenceSummary')
  };

  const report = validateSirDomainCoherenceCompletion(
    contract,
    new Set(contract.upstreamTaskTypes),
    semanticOutput,
    {
      runId: 'persisted-domain-coherence-artifact-verification',
      expectedDomain: input.domain
    }
  );
  if (!report.passed) {
    const summary = report.findings
      .map((item) => `${item.checkId}@${item.objectPath}: ${item.issue}`)
      .join(' | ');
    throw new Error(`Persisted Domain Coherence artifact failed deterministic re-validation: ${summary}`);
  }

  const expected = materializeDomainCoherenceReview(semanticOutput, packet);
  if (output.passed !== expected.passed) {
    throw new Error('Persisted Domain Coherence pass status drifted from deterministic derivation.');
  }
  if (canonicalArtifactHash(expected) !== canonicalArtifactHash(input.output)) {
    throw new Error('Persisted Domain Coherence materialized content drifted from deterministic reconstruction.');
  }
}
