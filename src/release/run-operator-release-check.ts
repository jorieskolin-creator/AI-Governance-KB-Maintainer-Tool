import { a2CompileAuthoringPlan, completeSirCompileSnapshot } from '../compiler/sir-compile-fixture.js';
import { compileGateResult, compileSirPair } from '../compiler/sir-compiler.js';
import { evaluateDomainGates, type NamedGateResult } from '../orchestration/named-gates.js';
import { validateCanonicalPair } from '../validation/canonical-pair.js';
import type { ArtifactStore, ReleaseArtifact, StoredArtifact } from '../storage/artifact-store.js';
import { buildApprovalBundle, releaseBaselineFromPlan } from './approval-bundle.js';
import { publishFrozenRelease } from './frozen-publisher.js';
import { recordOperatorApproval } from './operator-approval.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class MemoryArtifactStore implements ArtifactStore {
  readonly objects = new Map<string, StoredArtifact>();
  readonly putAttempts: string[] = [];
  failPath: string | undefined;

  async readImmutable(path: string): Promise<StoredArtifact | undefined> {
    return this.objects.get(path);
  }

  async putImmutable(artifact: ReleaseArtifact): Promise<StoredArtifact> {
    this.putAttempts.push(artifact.path);
    if (artifact.path === this.failPath) {
      this.failPath = undefined;
      throw new Error(`Injected upload failure for ${artifact.path}.`);
    }
    if (this.objects.has(artifact.path)) {
      throw new Error(`Already exists: ${artifact.path}.`);
    }
    const stored: StoredArtifact = {
      path: artifact.path,
      immutableUrl: `memory://${artifact.path}`,
      sha256: artifact.sha256
    };
    this.objects.set(artifact.path, stored);
    return stored;
  }
}

const plan = a2CompileAuthoringPlan();
const compiled = await compileSirPair({
  authoringPlan: plan,
  snapshot: completeSirCompileSnapshot(),
  mode: 'DRAFT'
});
assert(compiled.ok && compiled.capability && compiled.antipattern, 'release fixture must compile as DRAFT');

const requiredPairGates: NamedGateResult[] = [
  {
    gateName: 'SIR',
    outcome: 'SIR_VALID',
    validatorVersion: '1.0.0',
    findings: []
  },
  {
    gateName: 'SOURCE_COVERAGE',
    outcome: 'SOURCE_COVERAGE_COMPLETE',
    validatorVersion: '1.0.0',
    findings: []
  },
  compileGateResult(compiled),
  {
    gateName: 'QC',
    outcome: 'QC_COMPLETE',
    validatorVersion: '1.0.0',
    findings: []
  },
  {
    gateName: 'COHERENCE',
    outcome: 'COHERENCE_CLEAN',
    validatorVersion: '1.0.0',
    findings: []
  }
];
const domainGates = evaluateDomainGates({
  review: {
    coherenceSummary: 'No material domain coherence defects remain after an interpretable review.',
    defects: []
  }
});
const built = buildApprovalBundle({
  domain: 'A',
  domainCandidateHash: 'd'.repeat(64),
  domainReleaseVersion: plan.targetVersion,
  baseline: releaseBaselineFromPlan(plan),
  domainGates,
  pairCandidates: [
    {
      pairId: 'A2_AP-A2',
      pairCandidateHash: 'e'.repeat(64),
      sourceContextPacketSha256: 'f'.repeat(64),
      capability: compiled.capability,
      antipattern: compiled.antipattern,
      gates: requiredPairGates
    }
  ]
});

const decision = recordOperatorApproval(built.bundle, built.payloads, {
  domainCandidateHash: built.bundle.domainCandidateHash,
  approvalBundleSha256: built.bundleSha256,
  proposedManifestSha256: built.bundle.proposedManifestSha256,
  approvalReference: 'OP-2026-001',
  effectiveFrom: '2026-09-08',
  approvedOn: '2026-09-08T07:00:00.000Z'
});
assert(
  decision.releaseManifestSha256 !== built.bundle.proposedManifestSha256,
  'approved manifest must be separately hashed because approval metadata changes release bytes'
);
const capabilityArtifact = decision.releaseManifest.pairs[0]?.artifacts.find(
  (artifact) => artifact.object_id === 'A2' && artifact.content_type === 'application/json'
);
const antipatternArtifact = decision.releaseManifest.pairs[0]?.artifacts.find(
  (artifact) => artifact.object_id === 'AP-A2' && artifact.content_type === 'application/json'
);
assert(capabilityArtifact && antipatternArtifact, 'approved manifest must include both canonical JSON documents');
const finalCapability = JSON.parse(decision.releasePayloads[capabilityArtifact.sha256]?.utf8 ?? '{}');
const finalAntipattern = JSON.parse(decision.releasePayloads[antipatternArtifact.sha256]?.utf8 ?? '{}');
assert(
  finalCapability.release_status === 'APPROVED' &&
    finalAntipattern.release_status === 'APPROVED' &&
    finalCapability.approval_record.approval_reference === undefined,
  'approved object status and approval record must be deterministic and omit unrelated manifest references'
);
assert(
  finalCapability.approval_record.approved_by_role === 'OPERATOR' &&
    finalCapability.approval_record.approved_on === '2026-09-08',
  'standalone approval must use the fixed operator role and the approved date'
);
const releaseValidation = await validateCanonicalPair(finalCapability, finalAntipattern, {
  activeSchemaVersion: plan.schemaVersion,
  requiredLifecycleStages: plan.vocabulary.lifecycleStages
});
assert(releaseValidation.passed, `approved canonical payload must validate: ${JSON.stringify(releaseValidation.issues)}`);

let mismatchedBundleRejected = false;
try {
  recordOperatorApproval(built.bundle, built.payloads, {
    domainCandidateHash: built.bundle.domainCandidateHash,
    approvalBundleSha256: '0'.repeat(64),
    proposedManifestSha256: built.bundle.proposedManifestSha256,
    approvalReference: 'OP-2026-001',
    effectiveFrom: '2026-09-08',
    approvedOn: '2026-09-08T07:00:00.000Z'
  });
} catch (error) {
  mismatchedBundleRejected = error instanceof Error && error.message.includes('Approval bundle hash');
}
assert(mismatchedBundleRejected, 'approval must reject a mismatched frozen bundle hash');

const storage = new MemoryArtifactStore();
const persistedManifests: string[] = [];
const first = await publishFrozenRelease({
  domainRunId: '00000000-0000-0000-0000-000000000001',
  manifest: decision.releaseManifest,
  manifestSha256: decision.releaseManifestSha256,
  payloads: decision.releasePayloads,
  artifactStore: storage,
  persist: async (input) => {
    persistedManifests.push(input.manifestSha256);
    return '00000000-0000-0000-0000-000000000002';
  }
});
assert(first.manifestUrl.startsWith('memory://'), 'publisher must persist a concrete immutable manifest location');
assert(
  storage.objects.size === decision.releaseManifest.pairs[0]!.artifacts.length + 1,
  'publisher must upload every approved pair artifact and the manifest'
);
const attemptsBeforeRetry = storage.putAttempts.length;
const retry = await publishFrozenRelease({
  domainRunId: '00000000-0000-0000-0000-000000000001',
  manifest: decision.releaseManifest,
  manifestSha256: decision.releaseManifestSha256,
  payloads: decision.releasePayloads,
  artifactStore: storage,
  persist: async () => '00000000-0000-0000-0000-000000000002'
});
assert(retry.releaseId === first.releaseId, 'repeat publication must retain the release identity');
assert(storage.putAttempts.length === attemptsBeforeRetry, 'repeat publication must verify immutable artifacts without overwriting');

const partial = new MemoryArtifactStore();
partial.failPath = decision.releaseManifest.pairs[0]!.artifacts[1]!.path;
let failureObserved = false;
try {
  await publishFrozenRelease({
    domainRunId: '00000000-0000-0000-0000-000000000001',
    manifest: decision.releaseManifest,
    manifestSha256: decision.releaseManifestSha256,
    payloads: decision.releasePayloads,
    artifactStore: partial,
    persist: async () => '00000000-0000-0000-0000-000000000002'
  });
} catch (error) {
  failureObserved = error instanceof Error && error.message.includes('Injected upload failure');
}
assert(failureObserved && partial.objects.size === 1, 'partial upload failure must preserve only already immutable bytes');
await publishFrozenRelease({
  domainRunId: '00000000-0000-0000-0000-000000000001',
  manifest: decision.releaseManifest,
  manifestSha256: decision.releaseManifestSha256,
  payloads: decision.releasePayloads,
  artifactStore: partial,
  persist: async () => '00000000-0000-0000-0000-000000000002'
});
assert(
  partial.objects.size === decision.releaseManifest.pairs[0]!.artifacts.length + 1,
  'publication retry must recover from partial upload using hash verification'
);

console.log(
  JSON.stringify({
    approvalBundleSha256: decision.approvalBundleSha256,
    releaseManifestSha256: decision.releaseManifestSha256,
    releaseArtifactCount: storage.objects.size,
    releaseValidation: 'PASS',
    idempotentRetry: 'PASS',
    partialUploadRecovery: 'PASS'
  })
);
console.log('OPERATOR_RELEASE_CHECK_PASS');
