import type { AuthoringPlan, DomainId } from '../authoring/authoring-plan.js';
import type { MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import type { PairCoherencePacket } from './pair-coherence-packet.js';
import { expectedDomainPairIds } from './pipeline.js';

export type DomainCoherencePairHandle = `pair_${string}`;
export type DomainCoherencePathHandle = `path_${string}`;

export interface DomainCoherencePairDigest {
  pairHandle: DomainCoherencePairHandle;
  pairId: string;
  capabilityId: string;
  antipatternId: string;
  capabilityTitle: string;
  antipatternTitle: string;
  authoringPlanSha256: string;
  baselineSha256: string;
  pairCoherencePacketSha256: string;
  pairCoherenceOutputHash: string;
  passed: true;
  capabilityCanonicalDefinition: string;
  antipatternCanonicalDefinition: string;
  ownedTopics: string[];
  excludedTopics: Array<{ criterionHandle: string; ownershipBoundary: string }>;
  relatedCapabilityCriterionIds: string[];
  relatedAntipatternCriterionIds: string[];
  capabilityFindingTitles: string[];
  antipatternFindingTitles: string[];
  capabilitySourceIds: string[];
  antipatternSourceIds: string[];
}

export interface DomainCoherencePairDigestInput extends Omit<DomainCoherencePairDigest, 'pairHandle'> {}

export interface DomainCoherencePathEntry {
  pathHandle: DomainCoherencePathHandle;
  pairHandle: DomainCoherencePairHandle;
  objectPath: string;
  label: string;
}

export interface DomainCoherencePacket {
  packetVersion: '1.0.0';
  domain: DomainId;
  baselineSha256: string;
  pairDigests: DomainCoherencePairDigest[];
  pathRegistry: DomainCoherencePathEntry[];
  packetSha256: string;
}

export interface DomainCoherencePacketSeed {
  domain: DomainId;
  baselineSha256: string;
  pairDigests: DomainCoherencePairDigestInput[];
}

interface PathDraft {
  pairHandle: DomainCoherencePairHandle;
  objectPath: string;
  label: string;
}

function assertDomain(domain: string): asserts domain is DomainId {
  if (!/^[A-F]$/.test(domain)) {
    throw new Error(`Domain Coherence Packet domain ${domain} is not a governed A-F domain.`);
  }
}

export function deriveDomainCoherencePairDigest(input: {
  authoringPlan: AuthoringPlan;
  pairCoherencePacket: PairCoherencePacket;
  pairCoherenceReview: MaterializedPairCoherenceReview;
}): DomainCoherencePairDigestInput {
  const plan = input.authoringPlan;
  const packet = input.pairCoherencePacket;
  const review = input.pairCoherenceReview;
  if (packet.pairId !== plan.identity.pairId) {
    throw new Error('Pair Coherence Packet pair does not match the Authoring Plan pair.');
  }
  if (packet.authoringPlanSha256 !== plan.planSha256) {
    throw new Error('Pair Coherence Packet belongs to a different Authoring Plan.');
  }
  if (review.pairId !== plan.identity.pairId) {
    throw new Error('Pair Coherence review pair does not match the Authoring Plan pair.');
  }
  if (review.pairCoherencePacketSha256 !== packet.packetSha256) {
    throw new Error('Pair Coherence review is bound to a different Pair Coherence Packet.');
  }
  if (review.passed !== true) {
    throw new Error(
      `Domain Coherence cannot admit ${plan.identity.pairId} because Pair Coherence did not pass.`
    );
  }

  const snapshot = packet.snapshot;
  return {
    pairId: plan.identity.pairId,
    capabilityId: plan.identity.capabilityId,
    antipatternId: plan.identity.antipatternId,
    capabilityTitle: plan.identity.capabilityTitle,
    antipatternTitle: plan.identity.antipatternTitle,
    authoringPlanSha256: plan.planSha256,
    baselineSha256: plan.baseline.baselineSha256,
    pairCoherencePacketSha256: packet.packetSha256,
    pairCoherenceOutputHash: canonicalArtifactHash(review),
    passed: true,
    capabilityCanonicalDefinition: snapshot.pairBoundary.capability.canonicalDefinition,
    antipatternCanonicalDefinition: snapshot.pairBoundary.antipattern.canonicalDefinition,
    ownedTopics: [...snapshot.pairBoundary.capability.ownedTopics],
    excludedTopics: snapshot.pairBoundary.capability.excludedTopics.map((topic) => ({
      criterionHandle: topic.criterionHandle,
      ownershipBoundary: topic.ownershipBoundary
    })),
    relatedCapabilityCriterionIds: snapshot.referenceMappings.capabilityRelatedCriteria.map(
      (item) => item.criterionId
    ),
    relatedAntipatternCriterionIds: snapshot.referenceMappings.antipatternRelatedCriteria.map(
      (item) => item.criterionId
    ),
    capabilityFindingTitles: snapshot.findings.capability.map((item) => item.title),
    antipatternFindingTitles: snapshot.findings.antipattern.map((item) => item.title),
    capabilitySourceIds: snapshot.sourceMappings.capability.map((item) => item.sourceId),
    antipatternSourceIds: snapshot.sourceMappings.antipattern.map((item) => item.sourceId)
  };
}

function assertExpectedPairSet(domain: DomainId, digests: DomainCoherencePairDigestInput[]): void {
  if (digests.length !== 5) {
    throw new Error(`Domain Coherence Packet requires exactly 5 validated pairs; received ${digests.length}.`);
  }
  const expected = expectedDomainPairIds(domain);
  const actual = digests.map((item) => item.pairId);
  if (actual.some((pairId, index) => pairId !== expected[index])) {
    throw new Error(
      `Domain Coherence Packet pair set must be ${expected.join(', ')}; received ${actual.join(', ')}.`
    );
  }
}

function pathDrafts(pairDigests: DomainCoherencePairDigest[]): PathDraft[] {
  const paths: PathDraft[] = [];
  for (const pair of pairDigests) {
    const prefix = `pairs[${pair.pairId}]`;
    paths.push(
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.capability.boundary`,
        label: `${pair.capabilityId} capability boundary`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.antipattern.boundary`,
        label: `${pair.antipatternId} anti-pattern boundary`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.capability.ownedTopics`,
        label: `${pair.capabilityId} owned topics`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.capability.excludedTopics`,
        label: `${pair.capabilityId} excluded ownership`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.capability.relatedCriteria`,
        label: `${pair.capabilityId} related criteria`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.antipattern.relatedCriteria`,
        label: `${pair.antipatternId} related criteria`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.capability.findings`,
        label: `${pair.capabilityId} findings`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.antipattern.findings`,
        label: `${pair.antipatternId} findings`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.capability.sources`,
        label: `${pair.capabilityId} source mappings`
      },
      {
        pairHandle: pair.pairHandle,
        objectPath: `${prefix}.antipattern.sources`,
        label: `${pair.antipatternId} source mappings`
      }
    );
  }
  return paths;
}

function materializePathRegistry(pairDigests: DomainCoherencePairDigest[]): DomainCoherencePathEntry[] {
  const drafts = pathDrafts(pairDigests);
  const objectPaths = new Set<string>();
  for (const draft of drafts) {
    if (!draft.objectPath.trim() || !draft.label.trim()) {
      throw new Error('Domain Coherence path registry cannot contain empty paths or labels.');
    }
    if (objectPaths.has(draft.objectPath)) {
      throw new Error(`Domain Coherence path registry contains duplicate object path ${draft.objectPath}.`);
    }
    objectPaths.add(draft.objectPath);
  }
  return drafts.map((draft, index) => ({
    pathHandle: `path_${String(index + 1).padStart(3, '0')}` as DomainCoherencePathHandle,
    pairHandle: draft.pairHandle,
    objectPath: draft.objectPath,
    label: draft.label
  }));
}

export function buildDomainCoherencePacket(seed: DomainCoherencePacketSeed): DomainCoherencePacket {
  assertDomain(seed.domain);
  const sorted = [...seed.pairDigests].sort((left, right) =>
    left.capabilityId.localeCompare(right.capabilityId)
  );
  assertExpectedPairSet(seed.domain, sorted);

  const pairIds = new Set<string>();
  const pairDigests = sorted.map((digest, index): DomainCoherencePairDigest => {
    if (digest.capabilityId !== `${seed.domain}${index + 1}`) {
      throw new Error(`Domain Coherence pair ${digest.capabilityId} is not slot ${index + 1} of domain ${seed.domain}.`);
    }
    if (digest.antipatternId !== `AP-${digest.capabilityId}`) {
      throw new Error(`Domain Coherence pair ${digest.pairId} is not a deterministic capability/anti-pattern pair.`);
    }
    if (digest.pairId !== `${digest.capabilityId}_${digest.antipatternId}`) {
      throw new Error(`Domain Coherence pair ID ${digest.pairId} is not deterministic.`);
    }
    if (digest.baselineSha256 !== seed.baselineSha256) {
      throw new Error(`Domain Coherence pair ${digest.pairId} belongs to a different baseline.`);
    }
    if (digest.passed !== true) {
      throw new Error(`Domain Coherence Packet cannot include a failing pair ${digest.pairId}.`);
    }
    if (pairIds.has(digest.pairId)) {
      throw new Error(`Domain Coherence Packet contains duplicate pair ${digest.pairId}.`);
    }
    pairIds.add(digest.pairId);
    if (!digest.capabilityCanonicalDefinition.trim() || !digest.antipatternCanonicalDefinition.trim()) {
      throw new Error(`Domain Coherence pair ${digest.pairId} is missing a canonical definition digest.`);
    }
    return {
      ...digest,
      pairHandle: `pair_${String(index + 1).padStart(3, '0')}` as DomainCoherencePairHandle
    };
  });

  const withoutHash = {
    packetVersion: '1.0.0' as const,
    domain: seed.domain,
    baselineSha256: seed.baselineSha256,
    pairDigests,
    pathRegistry: materializePathRegistry(pairDigests)
  };
  return {
    ...withoutHash,
    packetSha256: canonicalArtifactHash(withoutHash)
  };
}
