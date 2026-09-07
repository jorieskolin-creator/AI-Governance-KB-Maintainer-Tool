import type { AuthoringPlan, DomainId } from '../authoring/authoring-plan.js';
import { buildSirDomainCoherenceContract } from '../cognitive/sir-domain-coherence-contract.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import {
  buildDomainCoherencePacket,
  deriveDomainCoherencePairDigest,
  type DomainCoherencePacket
} from './domain-coherence-packet.js';
import { verifyDomainCoherencePacket } from './domain-coherence-packet-verifier.js';
import { verifyPersistedPairCoherenceArtifact } from './pair-coherence-artifact-verifier.js';
import type { PairCoherencePacket } from './pair-coherence-packet.js';
import { expectedDomainPairIds } from './pipeline.js';

export interface DomainCoherencePairResolutionInput {
  authoringPlan: AuthoringPlan;
  pairCoherenceTaskContract: TaskContract;
  pairCoherenceOutput: unknown;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export interface DomainCoherenceResolverInput {
  domain: DomainId;
  domainBaseline: Record<string, unknown>;
  goldenStandardDomainRules: Record<string, unknown>;
  pairs: DomainCoherencePairResolutionInput[];
}

function lockedPairCoherencePacket(contract: TaskContract, pairId: string): PairCoherencePacket {
  const raw = contract.lockedInputs.pair_coherence_packet;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Persisted Pair Coherence for ${pairId} has no locked Pair Coherence Packet.`);
  }
  return raw as PairCoherencePacket;
}

export function resolveDomainCoherenceContract(input: DomainCoherenceResolverInput): TaskContract {
  if (input.pairs.length !== 5) {
    throw new Error(`DOMAIN_COHERENCE_REVIEW requires exactly 5 validated pairs; received ${input.pairs.length}.`);
  }

  const sorted = [...input.pairs].sort((left, right) =>
    left.authoringPlan.identity.capabilityId.localeCompare(right.authoringPlan.identity.capabilityId)
  );
  const expected = expectedDomainPairIds(input.domain);
  const actual = sorted.map((pair) => pair.authoringPlan.identity.pairId);
  if (actual.some((pairId, index) => pairId !== expected[index])) {
    throw new Error(
      `DOMAIN_COHERENCE_REVIEW pair set must be ${expected.join(', ')}; received ${actual.join(', ')}.`
    );
  }

  const baselineHashes = new Set<string>();
  const pairDigests = sorted.map((pair) => {
    const plan = pair.authoringPlan;
    if (plan.identity.domain !== input.domain) {
      throw new Error(`${plan.identity.pairId} does not belong to domain ${input.domain}.`);
    }
    baselineHashes.add(plan.baseline.baselineSha256);

    const packet = lockedPairCoherencePacket(pair.pairCoherenceTaskContract, plan.identity.pairId);
    verifyPersistedPairCoherenceArtifact({
      output: pair.pairCoherenceOutput,
      pairCoherenceTaskContract: pair.pairCoherenceTaskContract,
      authoringPlan: plan,
      verifiedPacket: packet,
      categoryBaseline: pair.categoryBaseline,
      goldenReference: pair.goldenReference
    });

    const review = pair.pairCoherenceOutput as MaterializedPairCoherenceReview;

    return deriveDomainCoherencePairDigest({
      authoringPlan: plan,
      pairCoherencePacket: packet,
      pairCoherenceReview: review
    });
  });

  if (baselineHashes.size !== 1) {
    throw new Error('DOMAIN_COHERENCE_REVIEW requires all five pairs to share one sealed baseline hash.');
  }
  const baselineSha256 = pairDigests[0]?.baselineSha256;
  if (!baselineSha256) {
    throw new Error('DOMAIN_COHERENCE_REVIEW could not resolve the sealed baseline hash.');
  }

  const packetSeed = {
    domain: input.domain,
    baselineSha256,
    pairDigests
  };
  const packet: DomainCoherencePacket = buildDomainCoherencePacket(packetSeed);
  verifyDomainCoherencePacket(packet, packetSeed);

  return buildSirDomainCoherenceContract({
    domain: input.domain,
    domainCoherencePacket: packet,
    domainBaseline: input.domainBaseline,
    goldenStandardDomainRules: input.goldenStandardDomainRules
  });
}
