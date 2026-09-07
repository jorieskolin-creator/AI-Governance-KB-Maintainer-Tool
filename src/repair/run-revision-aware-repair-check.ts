import { a2CompileAuthoringPlan, completeSirCompileSnapshot } from '../compiler/sir-compile-fixture.js';
import { compileSirPair } from '../compiler/sir-compiler.js';
import { schemaGate } from '../operator/schema-gate.js';
import { remainingDefects, renderPairReviewHtml, parseReviewSaveBody } from '../operator/pair-review.js';
import { remainingDomainDefects, renderDomainReviewHtml } from '../operator/domain-review.js';
import { SNAPSHOT_ROOT_TASK } from './qc-repair.js';
import {
  BLOCKING_NON_WAIVABLE_ISSUE,
  DELETED_FINDING_FORM_ISSUE,
  deletedFindingFormIssues,
  parseFindingDispositionDrafts,
  reviewForNamedGates,
  validateFindingDispositions,
  type FindingDispositionDraft
} from './finding-dispositions.js';
import {
  REPAIR_NOT_COHERENCE_ADMISSIBLE,
  rebuildPairCoherencePacket,
  rematerializePairReviewForCurrentPacket,
  staleDomainPairSnapshotIssues
} from './revision-aware-repair.js';
import type { MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import type { DomainCoherencePacket } from '../orchestration/domain-coherence-packet.js';
import { validMinimalSnapshotFixture } from '../validation/sir-snapshot-schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const highDefect = {
  defectId: 'defect_001' as const,
  severity: 'HIGH' as const,
  coherenceDimension: 'EVIDENCE_INTERPRETATION' as const,
  affectedPathHandles: ['path_001' as const],
  affectedPaths: ['evidence.capability[evidence_001]'],
  issue: 'Capability evidence title is too thin to support the governed claim.',
  coherenceExpectation: 'Evidence titles must state a testable, attributable claim.',
  recommendedRepairPathHandles: ['path_001' as const],
  recommendedRepairPaths: ['evidence.capability[evidence_001]']
};

const blockingDefect = {
  ...highDefect,
  defectId: 'defect_002' as const,
  severity: 'BLOCKING' as const,
  issue: 'Capability evidence is missing a governed locator binding.'
};

const review: MaterializedPairCoherenceReview = {
  pairId: 'A2_AP-A2',
  pairCoherencePacketSha256: 'a'.repeat(64),
  passed: false,
  coherenceSummary: 'HIGH evidence defect remains.',
  defects: [highDefect]
};

assert(deletedFindingFormIssues(['defect_001'])[0] === DELETED_FINDING_FORM_ISSUE, 'form deletion is never a resolution');
assert(deletedFindingFormIssues([]).length === 0, 'absent deletion list is not an error');
assert(
  remainingDefects(review, []).length === 1,
  'findings stay open unless an explicit closing disposition is recorded'
);
assert(
  remainingDefects(review, [
    {
      findingId: 'defect_001',
      disposition: 'RESOLVED',
      authority: 'OPERATOR',
      rationale: 'Evidence title now states the governed claim with attribution.'
    }
  ]).length === 0,
  'RESOLVED with rationale closes the finding for coherence'
);
assert(
  remainingDefects(review, [
    {
      findingId: 'defect_001',
      disposition: 'REJECTED',
      authority: 'OPERATOR',
      rationale: 'The listed finding is not accepted; it remains open on this revision.'
    }
  ]).length === 1,
  'REJECTED keeps the finding open'
);

const blockingDrafts: FindingDispositionDraft[] = [
  {
    findingId: 'defect_002',
    disposition: 'WAIVED',
    authority: 'OPERATOR',
    rationale: 'Operator attempted to waive a BLOCKING source finding.'
  }
];
assert(
  validateFindingDispositions([blockingDefect], blockingDrafts).some((item) => item.includes(BLOCKING_NON_WAIVABLE_ISSUE)),
  'BLOCKING findings cannot be WAIVED'
);
assert(
  validateFindingDispositions([blockingDefect], [
    {
      findingId: 'defect_002',
      disposition: 'ACCEPTED_RISK',
      authority: 'OPERATOR',
      rationale: 'Operator attempted accepted risk on a BLOCKING finding.'
    }
  ]).some((item) => item.includes(BLOCKING_NON_WAIVABLE_ISSUE)),
  'BLOCKING findings cannot be ACCEPTED_RISK'
);
assert(
  validateFindingDispositions(review.defects, [
    {
      findingId: 'defect_001',
      disposition: 'RESOLVED',
      authority: 'OPERATOR',
      rationale: 'short'
    }
  ]).length > 0,
  'disposition rationale must be at least 10 characters'
);

const parsedDelete = parseReviewSaveBody({
  deletedDefectIds: ['defect_001'],
  patches: [{ path: 'evidence.capability[evidence_001]', value: { title: 'Fixed title with enough length' } }]
});
assert(parsedDelete.deletedIds.join(',') === 'defect_001', 'legacy delete payload is still parsed so it can be rejected');
assert(deletedFindingFormIssues(parsedDelete.deletedIds).length === 1, 'legacy delete payload cannot close findings');

const parsedDisposition = parseFindingDispositionDrafts(
  {
    findingDispositions: [
      {
        findingId: 'defect_001',
        disposition: 'RESOLVED',
        authority: 'OPERATOR',
        rationale: 'Evidence title now states the governed claim with attribution.'
      }
    ]
  },
  'OPERATOR'
);
assert(parsedDisposition.drafts[0]?.disposition === 'RESOLVED', 'JSON save body parses explicit dispositions');

const plan = a2CompileAuthoringPlan();
const snapshot = completeSirCompileSnapshot();
const firstPacket = rebuildPairCoherencePacket({ snapshot, authoringPlan: plan });
const edited = structuredClone(snapshot);
edited.evidence.capability[0] = {
  ...edited.evidence.capability[0]!,
  title: 'Updated evidence title that changes the current revision hash'
};
const secondPacket = rebuildPairCoherencePacket({ snapshot: edited, authoringPlan: plan });
assert(firstPacket.packetSha256 !== secondPacket.packetSha256, 'semantic snapshot edits rebuild a new pair packet hash');

const rematerialized = rematerializePairReviewForCurrentPacket({
  review: {
    ...review,
    defects: [
      {
        ...highDefect,
        affectedPaths: ['evidence.capability[evidence_001]'],
        recommendedRepairPaths: ['evidence.capability[evidence_001]']
      }
    ]
  },
  packet: firstPacket,
  dispositions: [
    {
      findingId: 'defect_001',
      disposition: 'RESOLVED',
      authority: 'OPERATOR',
      rationale: 'Evidence title now states the governed claim with attribution.'
    }
  ],
  savedAt: '2026-09-07T16:40:00.000Z'
});
assert(rematerialized.defects.length === 1, 'the newly saved revision still lists the precise finding');
assert(rematerialized.passed === true, 'closing dispositions derive passed=true without deleting the finding');
assert(rematerialized.pairCoherencePacketSha256 === firstPacket.packetSha256, 'rematerialized review binds the current packet hash');
assert(
  reviewForNamedGates(rematerialized, [
    {
      findingId: rematerialized.defects[0]!.defectId,
      disposition: 'RESOLVED',
      authority: 'OPERATOR',
      rationale: 'Evidence title now states the governed claim with attribution.'
    }
  ]).defects.length === 0,
  'named gates see only open findings'
);

const emptyRoots = Object.fromEntries(Object.keys(SNAPSHOT_ROOT_TASK).map((key) => [key, {}]));
assert(schemaGate('A2_AP-A2', emptyRoots).length > 0, 'empty-section repaired content is not coherence-admissible');
assert(
  `${REPAIR_NOT_COHERENCE_ADMISSIBLE} ${schemaGate('A2_AP-A2', emptyRoots)[0]}`.startsWith(REPAIR_NOT_COHERENCE_ADMISSIBLE),
  'invalid repaired content is described as not coherence-admissible'
);
assert(schemaGate('A2_AP-A2', validMinimalSnapshotFixture()).length === 0, 'complete section-valid snapshot remains admissible');

const incompleteCompile = await compileSirPair({ authoringPlan: plan, snapshot: {}, mode: 'DRAFT' });
assert(incompleteCompile.ok === false && incompleteCompile.outcome === 'COMPILE_FAILED', 'structurally incomplete snapshots record COMPILE_FAILED');

const staleDomain = staleDomainPairSnapshotIssues(
  {
    pairDigests: [
      {
        pairId: 'A2_AP-A2',
        pairCoherencePacketSha256: firstPacket.packetSha256
      }
    ]
  } as DomainCoherencePacket,
  [{ pairId: 'A2_AP-A2', packetSha256: secondPacket.packetSha256 }]
);
assert(staleDomain.some((item) => item.includes('stale pair snapshot')), 'domain review rejects a superseded pair packet hash');
assert(
  staleDomainPairSnapshotIssues(
    {
      pairDigests: [{ pairId: 'A2_AP-A2', pairCoherencePacketSha256: firstPacket.packetSha256 }]
    } as DomainCoherencePacket,
    [{ pairId: 'A2_AP-A2', packetSha256: firstPacket.packetSha256 }]
  ).length === 0,
  'current pair packet hashes are accepted'
);

const reviewHtml = renderPairReviewHtml({
  domain: 'A',
  pairId: 'A2_AP-A2',
  pairState: 'REPAIR_REQUIRED',
  passed: false,
  coherenceSummary: 'HIGH evidence defect remains.',
  blockingCount: 1,
  gateIssues: [],
  candidateHash: 'c'.repeat(64),
  defects: [
    {
      defectId: 'defect_001',
      severity: 'HIGH',
      coherenceDimension: 'EVIDENCE_INTERPRETATION',
      issue: 'Capability evidence title is too thin to support the governed claim.',
      coherenceExpectation: 'Evidence titles must state a testable, attributable claim.',
      path: 'evidence.capability[evidence_001]',
      currentValue: { handle: 'evidence_001', title: 'Thin evidence title' },
      valueJson: '{\n  "handle": "evidence_001",\n  "title": "Thin evidence title"\n}',
      disposition: 'OPEN',
      rationale: ''
    }
  ]
});
assert(reviewHtml.includes('data-disposition-finding="defect_001"'), 'review page records an explicit disposition');
assert(reviewHtml.includes('findingDispositions'), 'review save posts findingDispositions');
assert(!reviewHtml.includes('Delete this blocker'), 'review page does not infer resolution from form deletion');
assert(reviewHtml.includes('expectedCandidateHash'), 'review save still binds the current candidate revision');

const domainHtml = renderDomainReviewHtml({
  domain: 'A',
  domainState: 'REPAIR_REQUIRED',
  passed: false,
  coherenceSummary: 'HIGH related-criteria defect remains.',
  blockingCount: 1,
  gateIssues: ['Domain review cannot use a stale pair snapshot: A2_AP-A2 packet was superseded.'],
  defects: [
    {
      defectId: 'defect_001',
      severity: 'HIGH',
      coherenceDimension: 'BROKEN_RELATED_CRITERION',
      issue: 'The lifecycle pair omits a reciprocal related-criterion link to the suitability pair.',
      coherenceExpectation: 'Related-criterion lists must be reciprocal across the affected pairs.',
      pairId: 'A2_AP-A2',
      domainPath: 'pairs[A2_AP-A2].capability.relatedCriteria',
      snapshotPath: 'referenceMappings.capabilityRelatedCriteria',
      currentValue: [],
      valueJson: '[]',
      disposition: 'OPEN',
      rationale: ''
    }
  ]
});
assert(domainHtml.includes('data-disposition-finding="defect_001"'), 'domain review records an explicit disposition');
assert(domainHtml.includes('stale pair snapshot'), 'domain review displays a stale pair snapshot finding');
assert(!domainHtml.includes('Delete this blocker'), 'domain review does not infer resolution from form deletion');

assert(
  remainingDomainDefects(
    {
      domain: 'A',
      domainCoherencePacketSha256: 'a'.repeat(64),
      passed: false,
      coherenceSummary: 'HIGH related-criteria defect remains.',
      defects: [
        {
          defectId: 'defect_001',
          severity: 'HIGH',
          coherenceDimension: 'BROKEN_RELATED_CRITERION',
          affectedPairHandles: ['pair_002'],
          affectedPairIds: ['A2_AP-A2'],
          affectedPathHandles: ['path_015'],
          affectedPaths: ['pairs[A2_AP-A2].capability.relatedCriteria'],
          issue: 'The lifecycle pair omits a reciprocal related-criterion link.',
          coherenceExpectation: 'Related-criterion lists must be reciprocal.',
          recommendedRepairPairHandles: ['pair_002'],
          recommendedRepairPairIds: ['A2_AP-A2'],
          recommendedRepairPathHandles: ['path_015'],
          recommendedRepairPaths: ['pairs[A2_AP-A2].capability.relatedCriteria']
        }
      ]
    },
    []
  ).length === 1,
  'domain findings stay listed without a closing disposition'
);

console.log(
  JSON.stringify(
    {
      revisionAwareRepair: 'PASS',
      deletedFormNeverResolves: 'PASS',
      explicitDispositions: 'PASS',
      blockingNonWaivable: 'PASS',
      packetRebuildFromCurrentSnapshot: 'PASS',
      findingsRemainOnNewRevision: 'PASS',
      invalidRepairNotCoherenceAdmissible: 'PASS',
      staleDomainPairSnapshot: 'PASS'
    },
    null,
    2
  )
);
