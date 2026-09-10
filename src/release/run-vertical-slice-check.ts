import {
  runFivePairDomainVerticalSlice,
  runOnePairVerticalSlice
} from './vertical-slice.js';
import { expectedDomainPairIds } from '../orchestration/pipeline.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const onePair = await runOnePairVerticalSlice();
assert(onePair.pairId === 'A2_AP-A2', 'one-pair rehearsal must use A2_AP-A2');
assert(onePair.gappyCoverage === 'SOURCE_GAPS_PRESENT', 'one-pair rehearsal lost the gappy coverage invariant');
assert(onePair.publication.idempotentRetry, 'one-pair publication retry was not idempotent');
assert(onePair.publication.partialUploadRecovery, 'one-pair partial upload did not recover');

const fivePair = await runFivePairDomainVerticalSlice();
assert(
  fivePair.pairIds.join(',') === expectedDomainPairIds('A').join(','),
  'five-pair domain must approve A1-A5 as the domain unit'
);
assert(fivePair.publication.idempotentRetry, 'five-pair publication retry was not idempotent');
assert(fivePair.publication.partialUploadRecovery, 'five-pair partial upload did not recover');
assert(
  fivePair.domainCandidateHash !== onePair.domainCandidateHash,
  'five-pair domain candidate hash must not collapse to the one-pair rehearsal hash'
);

console.log(
  JSON.stringify(
    {
      onePair: {
        pairId: onePair.pairId,
        sourceGapsBeforeAuthoring: onePair.sourceGapsBeforeAuthoring,
        fixtureMappingsDoNotComplete: onePair.fixtureMappingsDoNotComplete,
        gappyCoverage: onePair.gappyCoverage,
        draftVisibleWithGaps: onePair.draftVisibleWithGaps,
        injectedDefectBlocksApproval: onePair.injectedDefectBlocksApproval,
        staleRevisionRejected: onePair.staleRevisionRejected,
        sourceContextPacketSha256: onePair.sourceContextPacketSha256,
        pairCandidateHash: onePair.pairCandidateHash,
        domainCandidateHash: onePair.domainCandidateHash,
        approvalBundleSha256: onePair.approvalBundleSha256,
        releaseManifestSha256: onePair.releaseManifestSha256,
        publication: onePair.publication
      },
      fivePair: {
        domain: fivePair.domain,
        pairIds: fivePair.pairIds,
        sourceContextPacketSha256: fivePair.sourceContextPacketSha256,
        pairCandidateHashes: fivePair.pairCandidateHashes,
        domainCandidateHash: fivePair.domainCandidateHash,
        domainPacketSha256: fivePair.domainPacketSha256,
        approvalBundleSha256: fivePair.approvalBundleSha256,
        releaseManifestSha256: fivePair.releaseManifestSha256,
        publication: fivePair.publication
      }
    },
    null,
    2
  )
);
console.log('VERTICAL_SLICE_CHECK_PASS');
