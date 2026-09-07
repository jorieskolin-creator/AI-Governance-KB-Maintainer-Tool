import { canonicalArtifactHash } from './artifact-hash.js';

export interface ArtifactRevisionDraft {
  taskType: string;
  revisionNo: number;
  outputHash: string;
  supersededRevisionNo: number | null;
}

function sortedHashes(hashes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(hashes)
      .filter(([, hash]) => Boolean(hash))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

export function pairCandidateRevisionHash(
  pairId: string,
  artifactOutputHashes: Record<string, string>
): string {
  return canonicalArtifactHash({
    scope: 'PAIR',
    pairId,
    artifactOutputHashes: sortedHashes(artifactOutputHashes)
  });
}

export function domainCandidateRevisionHash(
  domain: string,
  pairCandidateHashes: Record<string, string>,
  domainCoherenceOutputHash: string
): string {
  return canonicalArtifactHash({
    scope: 'DOMAIN',
    domain,
    pairCandidateHashes: sortedHashes(pairCandidateHashes),
    domainCoherenceOutputHash
  });
}

export function appendArtifactRevisionDraft(
  existing: readonly ArtifactRevisionDraft[],
  taskType: string,
  outputHash: string
): ArtifactRevisionDraft {
  const current = existing.filter((item) => item.taskType === taskType);
  const max = current.reduce((highest, item) => Math.max(highest, item.revisionNo), 0);
  return {
    taskType,
    revisionNo: max + 1,
    outputHash,
    supersededRevisionNo: max === 0 ? null : max
  };
}

export function latestRevisionNo(
  existing: readonly ArtifactRevisionDraft[],
  taskType: string
): number | undefined {
  const current = existing.filter((item) => item.taskType === taskType);
  if (current.length === 0) return undefined;
  return current.reduce((highest, item) => Math.max(highest, item.revisionNo), 0);
}
