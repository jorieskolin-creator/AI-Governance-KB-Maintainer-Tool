import { applyRepairPatches, validateLocalRepairOutput } from './local-repair.js';
import {
  applySnapshotPatches,
  blockingQcDefects,
  buildQcLocalRepairContract,
  pathIsAllowed,
  patchedSnapshotRoots,
  qcDefectsToFindings,
  repairPathsFromDefects,
  tokenizeRepairPath
} from './qc-repair.js';
import type { MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const snapshot = {
  pairBoundary: {
    capability: { canonicalDefinition: 'Old capability definition that needs more precision.', governancePurpose: 'Govern suitability.' },
    antipattern: { canonicalDefinition: 'Old anti-pattern definition.' }
  },
  evidence: {
    capability: [
      {
        handle: 'evidence_001',
        title: 'Thin evidence title',
        claimSupported: 'A bounded claim.',
        evidenceClass: 'DECISION_RECORD'
      }
    ],
    antipattern: [{ handle: 'evidence_001', title: 'AP evidence' }]
  },
  lifecycleTargets: {
    capability: [{ lifecycleStage: 'DEPLOYMENT', minimumTechnicalAssurance: 'DECLARED', requiredHumanAssurance: 'PENDING' }]
  },
  sourceMappings: {
    capability: [{ sourceHandle: 'source_001', locatorHandle: 'locator_001', supportedClaim: 'Weak claim.' }]
  }
} as unknown as PairCoherenceSnapshot;

const review: MaterializedPairCoherenceReview = {
  pairId: 'A2_AP-A2',
  pairCoherencePacketSha256: 'a'.repeat(64),
  passed: false,
  coherenceSummary: 'Capability evidence does not support the bounded claim with enough specificity.',
  defects: [
    {
      defectId: 'defect_001',
      severity: 'HIGH',
      coherenceDimension: 'EVIDENCE_INTERPRETATION',
      affectedPathHandles: ['path_001'],
      affectedPaths: ['evidence.capability[evidence_001]'],
      issue: 'Capability evidence title is too thin to support the governed claim.',
      coherenceExpectation: 'Evidence titles must state a testable, attributable claim.',
      recommendedRepairPathHandles: ['path_001'],
      recommendedRepairPaths: ['evidence.capability[evidence_001]']
    },
    {
      defectId: 'defect_002',
      severity: 'MEDIUM',
      coherenceDimension: 'SEMANTIC_BOUNDARY',
      affectedPathHandles: ['path_002'],
      affectedPaths: ['pairBoundary.capability'],
      issue: 'Capability boundary could be sharper versus adjacent criteria.',
      coherenceExpectation: 'Owned topics stay inside the pair.',
      recommendedRepairPathHandles: ['path_002'],
      recommendedRepairPaths: ['pairBoundary.capability']
    }
  ]
};

assert(blockingQcDefects(review).length === 1, 'only HIGH/BLOCKING defects are repair targets');
assert(repairPathsFromDefects(blockingQcDefects(review)).join(',') === 'evidence.capability[evidence_001]', 'repair paths come from QC recommendations');
assert(qcDefectsToFindings('A2_AP-A2', review)[0]?.checkId === 'defect_001', 'board findings use defect ids');
assert(pathIsAllowed('evidence.capability[evidence_001].title', ['evidence.capability[evidence_001]']), 'child paths stay in scope');
assert(!pathIsAllowed('findings.capability[finding_001]', ['evidence.capability[evidence_001]']), 'out-of-scope paths are rejected');
assert(tokenizeRepairPath('sourceMappings.capability[source_001/locator_001].supportedClaim').length === 4, 'source/locator selectors tokenize');

const patched = applySnapshotPatches(snapshot, [
  { path: 'evidence.capability[evidence_001].title', value: 'Attributable suitability decision record for the governed claim.' },
  {
    path: 'evidence.capability[evidence_001]',
    value: {
      handle: 'evidence_999',
      title: 'Attributable suitability decision record for the governed claim.',
      claimSupported: 'The record supports a bounded suitability claim.',
      evidenceClass: 'DECISION_RECORD'
    }
  }
]);
assert(patched.evidence.capability[0]?.handle === 'evidence_001', 'code keeps evidence handles');
assert(
  patched.evidence.capability[0]?.title === 'Attributable suitability decision record for the governed claim.',
  'semantic title is repaired'
);

let identityRejected = false;
try {
  applySnapshotPatches(snapshot, [{ path: 'evidence.capability[evidence_001].handle', value: 'evidence_999' }]);
} catch (error) {
  identityRejected = error instanceof Error && error.message.includes('identity field');
}
assert(identityRejected, 'identity field patches are rejected');

assert(patchedSnapshotRoots(['evidence.capability[evidence_001].title'])[0] === 'EVIDENCE_ARCHITECTURE', 'path roots map to SIR tasks');

const contract = buildQcLocalRepairContract({ pairId: 'A2_AP-A2', review, snapshot });
assert(contract.taskType === 'LOCAL_REPAIR', 'QC repair uses LOCAL_REPAIR');
assert(contract.modelRole === 'REASONER', 'repair is a Reasoner task');
assert(Array.isArray(contract.lockedInputs.allowed_target_paths), 'repair paths are locked');

const output = validateLocalRepairOutput(
  {
    objectId: 'A2_AP-A2',
    repairs: [{ path: 'evidence.capability[evidence_001].title', value: 'Repaired title with enough specificity.' }],
    rationale: 'The QC defect asked for a testable evidence title, not a new identity.'
  },
  'A2_AP-A2',
  contract.lockedInputs.allowed_target_paths as string[]
);
assert(output.repairs.length === 1, 'scoped child-path repairs are accepted');

const dotted = applyRepairPatches({ a: { b: 1 } }, [{ path: 'a.b', value: 2 }]);
assert(dotted.a.b === 2, 'legacy dotted patches still apply');

console.log(
  JSON.stringify(
    {
      qcRepair: 'PASS',
      blockingDefectSelection: 'PASS',
      boardFindingProjection: 'PASS',
      handleIndexedPatch: 'PASS',
      identityPreservation: 'PASS',
      identityFieldPatch: 'REJECTED',
      descendantRepairPath: 'PASS',
      snapshotRootBinding: 'PASS',
      qcLocalRepairContract: 'PASS'
    },
    null,
    2
  )
);
