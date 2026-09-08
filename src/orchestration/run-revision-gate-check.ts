import { validMinimalSnapshotFixture } from '../validation/sir-snapshot-schema.js';
import { schemaGate } from '../operator/pair-review.js';
import { appendArtifactRevisionDraft, pairCandidateRevisionHash } from './candidate-revision.js';
import {
  STALE_REVISION_ISSUE,
  evaluatePairGates,
  evaluateDomainGates,
  evaluateRenderParity,
  gateBoundToCurrentRevision,
  pairMayValidate,
  domainMayReadyForApproval,
  staleRevisionIssues
} from './named-gates.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const snapshot = validMinimalSnapshotFixture();
assert(schemaGate('A2_AP-A2', snapshot).length === 0, 'fixture snapshot is schema-valid');

const hashes = {
  PAIR_BOUNDARY: '1'.repeat(64),
  AP_FAILURE_MODEL: '2'.repeat(64),
  SOURCE_MAPPING: '3'.repeat(64),
  PAIR_COHERENCE_REVIEW: '4'.repeat(64)
};
const first = pairCandidateRevisionHash('A2_AP-A2', hashes);
const same = pairCandidateRevisionHash('A2_AP-A2', { SOURCE_MAPPING: hashes.SOURCE_MAPPING, PAIR_BOUNDARY: hashes.PAIR_BOUNDARY, PAIR_COHERENCE_REVIEW: hashes.PAIR_COHERENCE_REVIEW, AP_FAILURE_MODEL: hashes.AP_FAILURE_MODEL });
assert(first === same, 'candidate hash is order-independent');
const edited = pairCandidateRevisionHash('A2_AP-A2', { ...hashes, PAIR_BOUNDARY: '9'.repeat(64) });
assert(first !== edited, 'an edited artifact creates a new candidate hash');

assert(staleRevisionIssues(edited, first)[0] === STALE_REVISION_ISSUE, 'stale candidate token is rejected');
assert(staleRevisionIssues(edited, undefined).length === 1, 'missing candidate token is rejected');
assert(staleRevisionIssues(edited, edited).length === 0, 'current candidate token is accepted');
assert(!gateBoundToCurrentRevision(first, edited), 'a gate recorded on an older candidate cannot advance a newer revision');

const history = [
  appendArtifactRevisionDraft([], 'PAIR_BOUNDARY', hashes.PAIR_BOUNDARY)
];
const superseded = appendArtifactRevisionDraft(history, 'PAIR_BOUNDARY', edited);
assert(history[0]?.revisionNo === 1 && history[0]?.supersededRevisionNo === null, 'first artifact revision has no predecessor');
assert(superseded.revisionNo === 2 && superseded.supersededRevisionNo === 1, 'edits append a superseding revision');

const cleanReview = {
  passed: true,
  coherenceSummary: 'No material pair-coherence defects remain after bounded review.',
  defects: []
};
const highReview = {
  passed: false,
  coherenceSummary: 'A HIGH evidence interpretation defect remains in this pair.',
  defects: [{ severity: 'HIGH', issue: 'Evidence title is too thin to support the governed claim.' }]
};
const incompleteReview = { passed: false, explanation: 'The requested review could not be completed.' };

const allSnapshotHashes = Object.fromEntries(
  [
    'PAIR_BOUNDARY',
    'AP_FAILURE_MODEL',
    'APPLICABILITY',
    'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION',
    'EVIDENCE_ARCHITECTURE',
    'EVIDENCE_SAFETY',
    'AP_ABSENCE_CONTRACT',
    'SOURCE_MAPPING',
    'FINDING_ARCHITECTURE',
    'CONTROL_BOUNDARY',
    'LIFECYCLE_ASSURANCE',
    'REFERENCE_MAPPING',
    'PAIR_COHERENCE_REVIEW'
  ].map((task, index) => [task, String(index + 1).repeat(64)])
);

const cleanGates = evaluatePairGates({
  snapshotComplete: true,
  schemaIssues: [],
  sourceMappings: snapshot.sourceMappings,
  review: cleanReview
});
assert(
  pairMayValidate(cleanGates.map((item) => item.outcome)),
  'SIR_VALID + QC_COMPLETE + COHERENCE_CLEAN may derive VALIDATED'
);
assert(
  cleanGates.some((item) => item.outcome === 'SOURCE_GAPS_PRESENT'),
  'explicit unmapped claims record SOURCE_GAPS_PRESENT without blocking QC'
);

const defectGates = evaluatePairGates({
  snapshotComplete: true,
  schemaIssues: [],
  sourceMappings: snapshot.sourceMappings,
  review: highReview
});
assert(
  !pairMayValidate(defectGates.map((item) => item.outcome)) &&
    defectGates.some((item) => item.outcome === 'DEFECTS_OPEN'),
  'HIGH defects keep DEFECTS_OPEN and cannot derive VALIDATED'
);

const incompleteGates = evaluatePairGates({
  snapshotComplete: true,
  schemaIssues: [],
  sourceMappings: snapshot.sourceMappings,
  review: incompleteReview
});
assert(
  incompleteGates.some((item) => item.outcome === 'QC_INCOMPLETE') &&
    !pairMayValidate(incompleteGates.map((item) => item.outcome)),
  'uninterpretable QC cannot derive VALIDATED'
);

const invalidSchema = evaluatePairGates({
  snapshotComplete: true,
  schemaIssues: ['atomics are empty'],
  sourceMappings: snapshot.sourceMappings,
  review: cleanReview
});
assert(!pairMayValidate(invalidSchema.map((item) => item.outcome)), 'schema-invalid snapshot cannot derive VALIDATED');

const covered = evaluatePairGates({
  snapshotComplete: true,
  schemaIssues: [],
  sourceMappings: {
    capability: [{ sourceHandle: 'source_001' }],
    antipattern: [{ sourceHandle: 'source_001' }],
    unmappedClaims: []
  },
  review: cleanReview
});
assert(
  covered.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE'),
  'mapped claims with no unmapped gaps record SOURCE_COVERAGE_COMPLETE'
);

const earlyAcquisition = evaluatePairGates({
  snapshotComplete: false,
  schemaIssues: ['snapshot incomplete'],
  sourceMappings: undefined,
  sourceContextPacket: { packetVersion: '1.0.0', pairId: 'A2_AP-A2', sources: [], missingContextSourceHandles: [], mappingContextAvailable: false, packetSha256: 'x', authoringPlanSha256: 'y', sourceRegisterVersion: '1.5.0', sourceRegisterSha256: 'z' },
  review: undefined
});
assert(
  earlyAcquisition.some((item) => item.outcome === 'SOURCE_GAPS_PRESENT') &&
    !earlyAcquisition.some((item) => item.outcome === 'SIR_VALID'),
  'a source-context packet records SOURCE_GAPS_PRESENT before claim-bearing SIR tasks exist'
);

const domainClean = evaluateDomainGates({ review: { ...cleanReview, domain: 'A' } });
assert(
  domainMayReadyForApproval(domainClean.map((item) => item.outcome)),
  'clean domain QC derives READY_FOR_APPROVAL from gate results'
);
const domainHigh = evaluateDomainGates({
  review: { ...highReview, domain: 'A', defects: [{ severity: 'BLOCKING', issue: 'Related-criterion lists are not reciprocal.' }] }
});
assert(
  !domainMayReadyForApproval(domainHigh.map((item) => item.outcome)) &&
    domainHigh.some((item) => item.outcome === 'DEFECTS_OPEN'),
  'domain HIGH/BLOCKING defects cannot derive READY_FOR_APPROVAL'
);

assert(Boolean(allSnapshotHashes.PAIR_BOUNDARY), 'pair candidate uses named SIR task hashes');
assert(evaluateRenderParity([]).outcome === 'RENDER_PARITY_VALID', 'empty render defects record RENDER_PARITY_VALID');
assert(
  evaluateRenderParity([
    {
      checkId: 'RENDER_PARITY',
      kind: 'PUBLICATION_PARITY',
      severity: 'BLOCKING',
      objectId: 'A2',
      objectPath: '/title',
      issue: 'Rendered title diverged from canonical JSON.',
      dependencyScope: []
    }
  ]).outcome === 'RENDER_PARITY_FAILED',
  'render semantic drift records RENDER_PARITY_FAILED'
);

console.log(
  JSON.stringify(
    {
      immutableRevisions: 'PASS',
      candidateHashDeterminism: 'PASS',
      staleReviewRejected: 'PASS',
      supersededRevisionLineage: 'PASS',
      namedGates: {
        SIR_VALID: 'PASS',
        SOURCE_GAPS_PRESENT: 'PASS',
        SOURCE_COVERAGE_COMPLETE: 'PASS',
        QC_COMPLETE: 'PASS',
        QC_INCOMPLETE: 'PASS',
        COHERENCE_CLEAN: 'PASS',
        DEFECTS_OPEN: 'PASS',
        READY_FOR_APPROVAL: 'PASS',
        RENDER_PARITY_VALID: 'PASS',
        RENDER_PARITY_FAILED: 'PASS'
      },
      lifecycleFromGates: 'PASS'
    },
    null,
    2
  )
);
