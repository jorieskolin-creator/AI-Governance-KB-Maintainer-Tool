import { buildAuthoringPlan, type AuthoringPlan, type DomainId } from '../authoring/authoring-plan.js';
import { loadCategoriesBaseline, categoryDomain, categoryPair } from '../baseline/categories.js';
import { compileGateResult, compileSirPair, type SirCompileReport } from '../compiler/sir-compiler.js';
import { completeSirCompileSnapshot } from '../compiler/sir-compile-fixture.js';
import {
  domainCandidateRevisionHash,
  pairCandidateRevisionHash
} from '../orchestration/candidate-revision.js';
import { canonicalArtifactHash } from '../orchestration/artifact-hash.js';
import {
  buildDomainCoherencePacket,
  deriveDomainCoherencePairDigest
} from '../orchestration/domain-coherence-packet.js';
import {
  STALE_REVISION_ISSUE,
  evaluateDomainGates,
  evaluatePairGates,
  evaluateSourceAcquisition,
  evaluateSourceCoverage,
  sourceMappingsBoundToPacket,
  staleRevisionIssues,
  type NamedGateResult
} from '../orchestration/named-gates.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';
import { PAIR_CANDIDATE_HASH_TASKS, PAIR_TASKS_BEFORE_SOURCE_MAPPING, expectedDomainPairIds } from '../orchestration/pipeline.js';
import { acquireSourceContext } from '../orchestration/source-context-acquisition.js';
import {
  sourceContextLocatorCount,
  type AuthoringSourceRegisterRecord,
  type SourceContextPacket,
  type SourceLocatorContextInput
} from '../orchestration/source-context-packet.js';
import { schemaGate } from '../operator/schema-gate.js';
import { renderCandidateObjectHtml, type DomainCandidateBundle } from '../operator/candidate-documents.js';
import { SNAPSHOT_ROOT_TASK } from '../repair/qc-repair.js';
import { reviewForNamedGates, type FindingDispositionDraft } from '../repair/finding-dispositions.js';
import {
  rebuildPairCoherencePacket,
  rematerializePairReviewForCurrentPacket
} from '../repair/revision-aware-repair.js';
import { materializeDomainCoherenceReview } from '../sir/domain-coherence-materializer.js';
import { materializePairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import { materializeSirSourceMappings } from '../sir/source-mapping-materializer.js';
import type { ArtifactStore, ReleaseArtifact, StoredArtifact } from '../storage/artifact-store.js';
import { validateCanonicalPair } from '../validation/canonical-pair.js';
import { buildApprovalBundle, releaseBaselineFromPlan } from './approval-bundle.js';
import { publishFrozenRelease } from './frozen-publisher.js';
import { recordOperatorApproval } from './operator-approval.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRepeatedHexHash(value: string): boolean {
  return /^([a-f0-9])\1{63}$/.test(value);
}

function assertLiveHash(value: string, label: string): void {
  assert(/^[a-f0-9]{64}$/.test(value), `${label} must be a SHA-256 digest.`);
  assert(!isRepeatedHexHash(value), `${label} must not be a dummy repeated-nibble hash.`);
}

function caughtMessage(fn: () => unknown): string {
  try {
    fn();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export class MemoryArtifactStore implements ArtifactStore {
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

export const VERTICAL_SLICE_REGISTER_RECORDS: AuthoringSourceRegisterRecord[] = [
  {
    sourceId: 'SRC-EU-AIA',
    versionOrDate: '2024-07-12',
    verificationStatus: 'VERIFIED',
    lastVerifiedDate: '2026-08-18',
    effectiveStatus: 'IN_FORCE',
    authorityTier: 'PRIMARY_BINDING_AUTHORITY',
    authorityType: 'LEGISLATION',
    officialLocation: 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
    applicabilityBoundary:
      'Apply article-by-article according to role, system classification, jurisdiction, use and applicable transition date.',
    licensingBoundary: 'Official legislation may be used within bounded source-context rules.',
    domainCoverage: ['A'],
    modelContextPolicy: 'METADATA_LOCATOR_ONLY',
    usageRightsReference: null
  },
  {
    sourceId: 'SRC-ISO-42001-2023',
    versionOrDate: '2023',
    verificationStatus: 'VERIFIED',
    lastVerifiedDate: '2026-08-18',
    effectiveStatus: 'PUBLISHED',
    authorityTier: 'VOLUNTARY_STANDARD',
    authorityType: 'PUBLISHED_STANDARD',
    officialLocation: 'https://www.iso.org/standard/42001',
    applicabilityBoundary:
      'Voluntary organizational AI management system requirements and guidance; organizational scope must be determined separately.',
    licensingBoundary:
      'Metadata and locator only unless explicit usage rights permit storage or model transmission of protected text.',
    domainCoverage: ['A'],
    modelContextPolicy: 'METADATA_LOCATOR_ONLY',
    usageRightsReference: null
  }
];

export const VERTICAL_SLICE_LOCATORS: SourceLocatorContextInput[] = [
  {
    sourceId: 'SRC-EU-AIA',
    locator: 'Article 9(2)',
    locatorLabel: 'Risk management system requirements'
  },
  {
    sourceId: 'SRC-ISO-42001-2023',
    locator: 'Clause 6.1',
    locatorLabel: 'Actions to address risks and opportunities'
  }
];

const CLEAN_PAIR_SUMMARY = 'No material pair-coherence defects remain after bounded review.';
const CLEAN_DOMAIN_SUMMARY = 'No material domain-coherence defects remain after bounded review.';

export function verticalSliceAuthoringPlan(pairId: string): AuthoringPlan {
  const categories = loadCategoriesBaseline();
  const pair = categoryPair(categories, pairId);
  const domain = categoryDomain(categories, pair.capabilityId.slice(0, 1) as DomainId);
  const neighborId = expectedDomainPairIds(domain.domain).find((id) => id !== pairId) ?? pairId;
  const neighbor = categoryPair(categories, neighborId);
  return buildAuthoringPlan({
    identity: {
      capabilityId: pair.capabilityId,
      antipatternId: pair.antipatternId,
      pairId: pair.pairId,
      domain: domain.domain,
      domainTitle: domain.title,
      capabilityTitle: pair.capabilityTitle,
      antipatternTitle: pair.antipatternTitle
    },
    targetVersion: '1.0.0',
    schemaVersion: '2.1.0',
    baseline: {
      baselineSnapshotId: 'baseline-vertical-slice',
      baselineSha256: canonicalArtifactHash({ baseline: 'vertical-slice', domain: domain.domain }),
      productionContractVersion: '1.0.0',
      productionContractSha256: canonicalArtifactHash({ production: 'vertical-slice' }),
      capabilitySchemaVersion: '2.1.0',
      capabilitySchemaSha256: canonicalArtifactHash({ capabilitySchema: '2.1.0' }),
      antipatternSchemaVersion: '2.1.0',
      antipatternSchemaSha256: canonicalArtifactHash({ antipatternSchema: '2.1.0' }),
      sharedDefinitionsVersion: '2.1.0',
      sharedDefinitionsSha256: canonicalArtifactHash({ shared: '2.1.0' }),
      sourceRegisterVersion: '1.5.0',
      sourceRegisterSha256: canonicalArtifactHash({ sourceRegister: '1.5.0' }),
      tacticCatalogVersion: null,
      tacticCatalogSha256: null,
      goldenReferenceId: 'A1_AP-A1',
      goldenReferenceVersion: '1.0.0',
      goldenReferenceSha256: canonicalArtifactHash({ golden: 'A1_AP-A1' })
    },
    questionDimensions: ['DEFINITION_AND_INTENT', 'IMPLEMENTATION_AND_OPERATION', 'EVIDENCE_AND_EFFECTIVENESS'],
    vocabulary: {
      technicalAssurance: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED'],
      humanAssurance: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'],
      capabilityConclusionStates: ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE'],
      antipatternConclusionStates: ['CONFIRMED_PRESENT', 'PARTIALLY_PRESENT', 'TESTED_ABSENT', 'UNKNOWN', 'NOT_APPLICABLE'],
      hardGateEffects: ['NONE', 'WARN', 'BLOCK', 'CONSTRAIN'],
      lifecycleStages: [
        'QUALIFICATION_AND_REGISTRATION',
        'DESIGN_AND_DEVELOPMENT',
        'VERIFICATION_AND_VALIDATION',
        'DEPLOYMENT',
        'OPERATION_AND_MONITORING',
        'REVIEW_AND_EVALUATION',
        'RETIREMENT'
      ]
    },
    allowedSources: [
      {
        sourceHandle: 'source_001',
        sourceId: 'SRC-EU-AIA',
        versionOrDate: '2024-07-12',
        verificationStatus: 'VERIFIED',
        lastVerifiedDate: '2026-08-18'
      },
      {
        sourceHandle: 'source_002',
        sourceId: 'SRC-ISO-42001-2023',
        versionOrDate: '2023',
        verificationStatus: 'VERIFIED',
        lastVerifiedDate: '2026-08-18'
      }
    ],
    allowedTactics: [],
    adjacentCriteria: [
      {
        criterionHandle: 'criterion_001',
        criterionId: pair.antipatternId,
        boundarySummary: pair.antipatternBoundarySummary
      },
      {
        criterionHandle: 'criterion_002',
        criterionId: neighbor.capabilityId,
        boundarySummary: neighbor.capabilityBoundarySummary
      }
    ]
  });
}

export function acquireVerticalSliceSourcePacket(
  plan: AuthoringPlan,
  locators: readonly SourceLocatorContextInput[] = VERTICAL_SLICE_LOCATORS
): SourceContextPacket {
  return acquireSourceContext({
    authoringPlan: plan,
    registerRecords: VERTICAL_SLICE_REGISTER_RECORDS,
    locatorInputs: [...locators]
  });
}

function locatorBinding(packet: SourceContextPacket, sourceId: string): {
  sourceHandle: string;
  locatorHandle: string;
} {
  const source = packet.sources.find((entry) => entry.sourceId === sourceId);
  const locator = source?.locatorContexts[0];
  assert(source && locator, `Acquired packet is missing a locator for ${sourceId}.`);
  return { sourceHandle: source.sourceHandle, locatorHandle: locator.locatorHandle };
}

export function bindVerticalSliceSourceMappings(
  snapshot: PairCoherenceSnapshot,
  packet: SourceContextPacket,
  coverage: 'gappy' | 'complete'
): PairCoherenceSnapshot {
  const eu = locatorBinding(packet, 'SRC-EU-AIA');
  const iso = locatorBinding(packet, 'SRC-ISO-42001-2023');
  const capabilityMappings = [
    {
      sourceHandle: eu.sourceHandle as `source_${string}`,
      locatorHandle: eu.locatorHandle as `locator_${string}`,
      relationship: 'BINDING_LAW_WHEN_APPLICABLE',
      supportedClaim:
        'Suitability decisions remain bounded to a defined purpose and proportionate alternative analysis.',
      categoryRationale: 'The locator addresses purpose-bounded selection rather than a downstream control.',
      applicabilityConditions: ['Applies to material AI-selection decisions.'],
      exclusions: ['Does not authorize a real-system approval.']
    }
  ];
  const antipatternMappings =
    coverage === 'complete'
      ? [
          {
            sourceHandle: iso.sourceHandle as `source_${string}`,
            locatorHandle: iso.locatorHandle as `locator_${string}`,
            relationship: 'AUTHORITATIVE_VOLUNTARY_GUIDANCE',
            supportedClaim:
              'Intended purpose and contextual expectations should be understood and documented as part of AI risk management.',
            categoryRationale:
              'The locator supports disciplined context definition and helps distinguish evidence-based suitability from solution-first adoption.',
            applicabilityConditions: ['Use as voluntary risk-management guidance rather than binding law.'],
            exclusions: ['The mapping does not prove compliance, certification or absence of the anti-pattern.']
          }
        ]
      : [];
  const unmappedClaims =
    coverage === 'complete'
      ? []
      : [
          {
            objectKind: 'ANTIPATTERN' as const,
            claim: 'Solution-first chronology is not yet bound to an allowed exact locator.',
            reason: 'INSUFFICIENT_SOURCE_CONTEXT' as const,
            consideredSourceHandles: []
          }
        ];
  return {
    ...snapshot,
    sourceMappings: materializeSirSourceMappings(
      {
        capabilityMappings,
        antipatternMappings,
        unmappedClaims,
        mappingNotes:
          coverage === 'complete'
            ? ['Capability and anti-pattern claims are bound to acquired exact locators.']
            : ['Capability has one exact locator; remaining anti-pattern claims stay explicitly unmapped.']
      },
      packet
    )
  };
}

export function pairArtifactHashes(input: {
  snapshot: PairCoherenceSnapshot;
  sourcePacket: SourceContextPacket;
  review: unknown;
}): Record<string, string> {
  const hashes: Record<string, string> = {
    SOURCE_CONTEXT: input.sourcePacket.packetSha256
  };
  const snapshot = input.snapshot as unknown as Record<string, unknown>;
  for (const [root, taskType] of Object.entries(SNAPSHOT_ROOT_TASK)) {
    hashes[taskType] = canonicalArtifactHash(snapshot[root]);
  }
  hashes.PAIR_COHERENCE_REVIEW = canonicalArtifactHash(input.review);
  for (const taskType of PAIR_CANDIDATE_HASH_TASKS) {
    assert(Boolean(hashes[taskType]), `pair candidate is missing hash for ${taskType}.`);
    assertLiveHash(hashes[taskType]!, `${taskType} hash`);
  }
  return hashes;
}

function cleanPairReview(packet: ReturnType<typeof rebuildPairCoherencePacket>) {
  return materializePairCoherenceReview({ defects: [], coherenceSummary: CLEAN_PAIR_SUMMARY }, packet);
}

function draftBundle(input: {
  domain: DomainId;
  plan: AuthoringPlan;
  pairId: string;
  compiled: SirCompileReport;
}): DomainCandidateBundle {
  const capabilityId = input.plan.identity.capabilityId;
  return {
    documentKind: 'DOMAIN_PRODUCTION_CANDIDATE_BUNDLE',
    domain: input.domain,
    domainTitle: input.plan.identity.domainTitle,
    domainState: 'IN_PROGRESS',
    domainCoherence: 'NONE',
    releaseStatus: 'DRAFT',
    approval: 'NOT_GRANTED',
    unresolvedIssues: input.compiled.notes,
    pairs: [
      {
        pairId: input.pairId,
        status: input.compiled.ok ? 'COMPILED' : 'FAILED',
        notes: input.compiled.notes,
        capability: input.compiled.capability,
        antipattern: input.compiled.antipattern
      }
    ],
    documents: [
      {
        pairId: input.pairId,
        objectId: capabilityId,
        objectType: 'CAPABILITY',
        title: input.plan.identity.capabilityTitle,
        status: input.compiled.ok ? 'COMPILED' : 'FAILED',
        href: `/documents/${input.domain}/${capabilityId}`,
        htmlHref: `/documents/${input.domain}/${capabilityId}`,
        jsonHref: `/api/operator/documents/${input.domain}/${capabilityId}.json`,
        notes: input.compiled.notes
      }
    ]
  };
}

function requiredPairGates(input: {
  snapshot: PairCoherenceSnapshot;
  packet: SourceContextPacket;
  schemaIssues: readonly string[];
  review: unknown;
  compiled: SirCompileReport;
}): NamedGateResult[] {
  return [
    ...evaluatePairGates({
      snapshotComplete: true,
      schemaIssues: input.schemaIssues,
      sourceMappings: input.snapshot.sourceMappings,
      sourceContextPacket: input.packet,
      review: input.review
    }),
    compileGateResult(input.compiled)
  ];
}

function pathHandleFor(packet: ReturnType<typeof rebuildPairCoherencePacket>, objectPath: string) {
  const entry = packet.pathRegistry.find((item) => item.objectPath === objectPath);
  assert(entry, `Pair coherence packet is missing path ${objectPath}.`);
  return entry.pathHandle;
}

async function publishWithRecovery(input: {
  domainRunId: string;
  decision: ReturnType<typeof recordOperatorApproval>;
}): Promise<{ artifactCount: number; idempotentRetry: true; partialUploadRecovery: true }> {
  const storage = new MemoryArtifactStore();
  const first = await publishFrozenRelease({
    domainRunId: input.domainRunId,
    manifest: input.decision.releaseManifest,
    manifestSha256: input.decision.releaseManifestSha256,
    payloads: input.decision.releasePayloads,
    artifactStore: storage,
    persist: async () => '00000000-0000-0000-0000-000000000002'
  });
  const expectedCount = input.decision.releaseManifest.pairs.reduce(
    (count, pair) => count + pair.artifacts.length,
    0
  ) + 1;
  assert(storage.objects.size === expectedCount, 'publisher must upload every approved pair artifact and the manifest');
  const attemptsBeforeRetry = storage.putAttempts.length;
  const retry = await publishFrozenRelease({
    domainRunId: input.domainRunId,
    manifest: input.decision.releaseManifest,
    manifestSha256: input.decision.releaseManifestSha256,
    payloads: input.decision.releasePayloads,
    artifactStore: storage,
    persist: async () => '00000000-0000-0000-0000-000000000002'
  });
  assert(retry.releaseId === first.releaseId, 'repeat publication must retain the release identity');
  assert(storage.putAttempts.length === attemptsBeforeRetry, 'repeat publication must verify immutable artifacts without overwriting');

  const partial = new MemoryArtifactStore();
  const failArtifact = input.decision.releaseManifest.pairs[0]?.artifacts[1];
  assert(failArtifact, 'approved manifest must include a second artifact for partial-failure recovery');
  partial.failPath = failArtifact.path;
  let failureObserved = false;
  try {
    await publishFrozenRelease({
      domainRunId: input.domainRunId,
      manifest: input.decision.releaseManifest,
      manifestSha256: input.decision.releaseManifestSha256,
      payloads: input.decision.releasePayloads,
      artifactStore: partial,
      persist: async () => '00000000-0000-0000-0000-000000000002'
    });
  } catch (error) {
    failureObserved = error instanceof Error && error.message.includes('Injected upload failure');
  }
  assert(failureObserved && partial.objects.size === 1, 'partial upload failure must preserve only already immutable bytes');
  await publishFrozenRelease({
    domainRunId: input.domainRunId,
    manifest: input.decision.releaseManifest,
    manifestSha256: input.decision.releaseManifestSha256,
    payloads: input.decision.releasePayloads,
    artifactStore: partial,
    persist: async () => '00000000-0000-0000-0000-000000000002'
  });
  assert(partial.objects.size === expectedCount, 'publication retry must recover from partial upload using hash verification');
  return { artifactCount: storage.objects.size, idempotentRetry: true, partialUploadRecovery: true };
}

export interface OnePairVerticalSliceResult {
  pairId: string;
  sourceGapsBeforeAuthoring: 'PASS';
  fixtureMappingsDoNotComplete: 'PASS';
  gappyCoverage: 'SOURCE_GAPS_PRESENT';
  draftVisibleWithGaps: 'PASS';
  injectedDefectBlocksApproval: 'PASS';
  repairedPacketHash: string;
  staleRevisionRejected: 'PASS';
  pairCandidateHash: string;
  domainCandidateHash: string;
  sourceContextPacketSha256: string;
  approvalBundleSha256: string;
  releaseManifestSha256: string;
  publication: { artifactCount: number; idempotentRetry: true; partialUploadRecovery: true };
}

export async function runOnePairVerticalSlice(): Promise<OnePairVerticalSliceResult> {
  const pairId = 'A2_AP-A2';
  const plan = verticalSliceAuthoringPlan(pairId);
  const consumedAuthoringTasks: string[] = [];

  const zeroLocatorPacket = acquireVerticalSliceSourcePacket(plan, []);
  const zeroGate = evaluateSourceAcquisition(zeroLocatorPacket);
  assert(sourceContextLocatorCount(zeroLocatorPacket) === 0, 'zero-locator packet unexpectedly contains locators');
  assert(zeroGate.outcome === 'SOURCE_GAPS_PRESENT', 'zero-locator acquisition must record SOURCE_GAPS_PRESENT');
  assert(
    PAIR_TASKS_BEFORE_SOURCE_MAPPING.every((taskType) => !consumedAuthoringTasks.includes(taskType)),
    'SOURCE_GAPS_PRESENT arrived after pre-SOURCE_MAPPING authoring tasks'
  );
  const earlyGates = evaluatePairGates({
    snapshotComplete: false,
    schemaIssues: ['snapshot incomplete'],
    sourceMappings: undefined,
    sourceContextPacket: zeroLocatorPacket,
    review: undefined
  });
  assert(
    earlyGates.some((item) => item.outcome === 'SOURCE_GAPS_PRESENT') &&
      !earlyGates.some((item) => item.outcome === 'SIR_VALID') &&
      !earlyGates.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE'),
    'early acquisition must not record SIR_VALID or SOURCE_COVERAGE_COMPLETE'
  );

  const packet = acquireVerticalSliceSourcePacket(plan);
  assertLiveHash(packet.packetSha256, 'acquired source-context packet hash');
  assert(packet.pairId === pairId, 'source-context packet pairId must come from the Authoring Plan');
  assert(packet.packetSha256 !== zeroLocatorPacket.packetSha256, 'locator acquisition must change the packet hash');

  const fixtureSnapshot = completeSirCompileSnapshot();
  assert(
    evaluateSourceCoverage(fixtureSnapshot.sourceMappings, packet) === 'SOURCE_GAPS_PRESENT',
    'compile-fixture mappings with dummy packet hashes and unmapped antipattern claims cannot complete coverage'
  );
  assert(
    !sourceMappingsBoundToPacket(fixtureSnapshot.sourceMappings, packet),
    'compile-fixture mappings must not bind to the acquired packet'
  );

  const gappy = bindVerticalSliceSourceMappings(completeSirCompileSnapshot(), packet, 'gappy');
  assert(gappy.sourceMappings.sourceContextPacketSha256 === packet.packetSha256, 'gappy mappings must carry the acquired packet hash');
  const gappySchema = schemaGate(pairId, gappy);
  assert(gappySchema.length === 0, `gappy snapshot failed schemaGate: ${gappySchema.join('; ')}`);
  const gappyGates = evaluatePairGates({
    snapshotComplete: true,
    schemaIssues: gappySchema,
    sourceMappings: gappy.sourceMappings,
    sourceContextPacket: packet,
    review: undefined
  });
  assert(
    gappyGates.some((item) => item.outcome === 'SIR_VALID') &&
      gappyGates.some((item) => item.outcome === 'SOURCE_GAPS_PRESENT') &&
      !gappyGates.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE'),
    'unmapped antipattern claims must keep SOURCE_GAPS_PRESENT after SIR_VALID'
  );
  const gappyDraft = await compileSirPair({
    authoringPlan: plan,
    snapshot: gappy,
    mode: 'DRAFT',
    reviewNotes: ['Anti-pattern claim remains unmapped to an allowed exact locator.']
  });
  assert(gappyDraft.ok && gappyDraft.capability && gappyDraft.antipattern, 'gappy snapshot must still compile as a visible DRAFT');
  assert(
    gappyDraft.notes.some((note) => note.includes('Unmapped ANTIPATTERN claim')),
    'DRAFT compile must keep unmapped anti-pattern claims visible'
  );
  const draftHtml = renderCandidateObjectHtml({
    domain: 'A',
    bundle: draftBundle({ domain: 'A', plan, pairId, compiled: gappyDraft }),
    objectId: plan.identity.capabilityId
  });
  assert(draftHtml.includes('DRAFT'), 'gappy compile must remain labeled DRAFT');
  assert(draftHtml.includes('Unresolved issues'), 'gappy draft must identify unresolved issues');
  const gappyRelease = await compileSirPair({ authoringPlan: plan, snapshot: gappy, mode: 'RELEASE' });
  assert(!gappyRelease.ok, 'RELEASE compile must stay closed while source gaps remain');

  const gappyPacket = rebuildPairCoherencePacket({ snapshot: gappy, authoringPlan: plan });
  const gappyReview = cleanPairReview(gappyPacket);
  const gappyPairHash = pairCandidateRevisionHash(pairId, pairArtifactHashes({ snapshot: gappy, sourcePacket: packet, review: gappyReview }));
  const gappyDomainReview = { coherenceSummary: CLEAN_DOMAIN_SUMMARY, defects: [] };
  const gappyDomainHash = domainCandidateRevisionHash('A', { [pairId]: gappyPairHash }, canonicalArtifactHash(gappyDomainReview));
  const gappyApprovalMessage = caughtMessage(() =>
    buildApprovalBundle({
      domain: 'A',
      domainCandidateHash: gappyDomainHash,
      domainReleaseVersion: plan.targetVersion,
      baseline: releaseBaselineFromPlan(plan),
      domainGates: evaluateDomainGates({ review: gappyDomainReview }),
      pairCandidates: [
        {
          pairId,
          pairCandidateHash: gappyPairHash,
          sourceContextPacketSha256: packet.packetSha256,
          capability: gappyDraft.capability!,
          antipattern: gappyDraft.antipattern!,
          gates: requiredPairGates({
            snapshot: gappy,
            packet,
            schemaIssues: gappySchema,
            review: gappyReview,
            compiled: gappyDraft
          })
        }
      ]
    })
  );
  assert(
    gappyApprovalMessage.includes('SOURCE_COVERAGE_COMPLETE'),
    'approval bundle must refuse a pair that still has SOURCE_GAPS_PRESENT'
  );

  const covered = bindVerticalSliceSourceMappings(completeSirCompileSnapshot(), packet, 'complete');
  assert(covered.sourceMappings.sourceContextPacketSha256 === packet.packetSha256, 'release mappings must carry the acquired packet hash');
  assert(covered.sourceMappings.unmappedClaims.length === 0, 'release mappings must not keep unmapped claims');
  assert(covered.sourceMappings.capability.length > 0 && covered.sourceMappings.antipattern.length > 0, 'release mappings must cover both objects');
  assert(sourceMappingsBoundToPacket(covered.sourceMappings, packet), 'release mappings must resolve against acquired locator handles');
  const coveredSchema = schemaGate(pairId, covered);
  assert(coveredSchema.length === 0, `release-ready snapshot failed schemaGate: ${coveredSchema.join('; ')}`);
  const compiled = await compileSirPair({ authoringPlan: plan, snapshot: covered, mode: 'DRAFT' });
  assert(compiled.ok && compiled.capability && compiled.antipattern, 'release-ready snapshot must compile as DRAFT');
  assert(compiled.capability.id === 'A2' && compiled.antipattern.id === 'AP-A2', 'canonical IDs must come from the Authoring Plan');
  assert(!compiled.notes.some((note) => note.includes('Unmapped ANTIPATTERN claim')), 'release-ready compile must not keep unmapped claims');

  const firstPacket = rebuildPairCoherencePacket({ snapshot: covered, authoringPlan: plan });
  const evidencePath = 'evidence.capability[evidence_001]';
  const evidenceHandle = pathHandleFor(firstPacket, evidencePath);
  const defectiveReview = materializePairCoherenceReview(
    {
      coherenceSummary: 'HIGH evidence interpretation defect remains on this candidate.',
      defects: [
        {
          severity: 'HIGH',
          coherenceDimension: 'EVIDENCE_INTERPRETATION',
          affectedPathHandles: [evidenceHandle],
          issue: 'Capability evidence title is too thin to support the governed claim.',
          coherenceExpectation: 'Evidence titles must state a testable, attributable claim.',
          recommendedRepairPathHandles: [evidenceHandle]
        }
      ]
    },
    firstPacket
  );
  assert(defectiveReview.pairCoherencePacketSha256 === firstPacket.packetSha256, 'injected defect must bind the current pair packet');
  const defectGates = requiredPairGates({
    snapshot: covered,
    packet,
    schemaIssues: coveredSchema,
    review: defectiveReview,
    compiled
  });
  assert(
    defectGates.some((item) => item.outcome === 'DEFECTS_OPEN') &&
      defectGates.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE') &&
      defectGates.some((item) => item.outcome === 'CANONICAL_COMPILE_VALID'),
    'injected HIGH defect must record DEFECTS_OPEN without inventing SOURCE_COVERAGE_COMPLETE'
  );
  const defectPairHash = pairCandidateRevisionHash(
    pairId,
    pairArtifactHashes({ snapshot: covered, sourcePacket: packet, review: defectiveReview })
  );
  const defectDomainHash = domainCandidateRevisionHash(
    'A',
    { [pairId]: defectPairHash },
    canonicalArtifactHash(gappyDomainReview)
  );
  const defectApprovalMessage = caughtMessage(() =>
    buildApprovalBundle({
      domain: 'A',
      domainCandidateHash: defectDomainHash,
      domainReleaseVersion: plan.targetVersion,
      baseline: releaseBaselineFromPlan(plan),
      domainGates: evaluateDomainGates({ review: gappyDomainReview }),
      pairCandidates: [
        {
          pairId,
          pairCandidateHash: defectPairHash,
          sourceContextPacketSha256: packet.packetSha256,
          capability: compiled.capability!,
          antipattern: compiled.antipattern!,
          gates: defectGates
        }
      ]
    })
  );
  assert(
    defectApprovalMessage.includes('COHERENCE_CLEAN'),
    'approval bundle must refuse a pair with DEFECTS_OPEN'
  );

  const repairedSnapshot = structuredClone(covered);
  repairedSnapshot.evidence.capability[0] = {
    ...repairedSnapshot.evidence.capability[0]!,
    title: 'Attributed suitability evidence that states the governed claim with a testable acceptance condition.'
  };
  const repairedSchema = schemaGate(pairId, repairedSnapshot);
  assert(repairedSchema.length === 0, `repaired snapshot failed schemaGate: ${repairedSchema.join('; ')}`);
  const secondPacket = rebuildPairCoherencePacket({ snapshot: repairedSnapshot, authoringPlan: plan });
  assert(secondPacket.packetSha256 !== firstPacket.packetSha256, 'content repair must create a new pair coherence packet hash');
  const dispositions: FindingDispositionDraft[] = [
    {
      findingId: 'defect_001',
      disposition: 'RESOLVED',
      authority: 'OPERATOR',
      rationale: 'Evidence title now states the governed claim with attribution.'
    }
  ];
  const rematerialized = rematerializePairReviewForCurrentPacket({
    review: defectiveReview,
    packet: secondPacket,
    dispositions,
    savedAt: '2026-09-08T08:00:00.000Z'
  });
  assert(rematerialized.pairCoherencePacketSha256 === secondPacket.packetSha256, 'repaired review must bind the new packet hash');
  const gatedReview = reviewForNamedGates(rematerialized, dispositions);
  assert(gatedReview.defects.length === 0, 'RESOLVED disposition must close the HIGH finding for named gates');
  assert(
    staleRevisionIssues(secondPacket.packetSha256, firstPacket.packetSha256)[0] === STALE_REVISION_ISSUE,
    'stale pair packet must be rejected after repair'
  );

  const repairedCompile = await compileSirPair({ authoringPlan: plan, snapshot: repairedSnapshot, mode: 'DRAFT' });
  assert(repairedCompile.ok && repairedCompile.capability && repairedCompile.antipattern, 'repaired snapshot must compile');
  const cleanReview = cleanPairReview(secondPacket);
  const repairedGates = requiredPairGates({
    snapshot: repairedSnapshot,
    packet,
    schemaIssues: repairedSchema,
    review: cleanReview,
    compiled: repairedCompile
  });
  assert(
    repairedGates.some((item) => item.outcome === 'SIR_VALID') &&
      repairedGates.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE') &&
      repairedGates.some((item) => item.outcome === 'CANONICAL_COMPILE_VALID') &&
      repairedGates.some((item) => item.outcome === 'QC_COMPLETE') &&
      repairedGates.some((item) => item.outcome === 'COHERENCE_CLEAN'),
    'repaired pair must hold every required release gate'
  );
  const pairCandidateHash = pairCandidateRevisionHash(
    pairId,
    pairArtifactHashes({ snapshot: repairedSnapshot, sourcePacket: packet, review: cleanReview })
  );
  assert(pairCandidateHash !== defectPairHash, 'repair must change the pair candidate hash');
  const domainReview = { coherenceSummary: CLEAN_DOMAIN_SUMMARY, defects: [] };
  const domainCandidateHash = domainCandidateRevisionHash(
    'A',
    { [pairId]: pairCandidateHash },
    canonicalArtifactHash(domainReview)
  );
  assertLiveHash(pairCandidateHash, 'repaired pair candidate hash');
  assertLiveHash(domainCandidateHash, 'one-pair domain candidate hash');
  const staleBundleMessage = caughtMessage(() =>
    buildApprovalBundle({
      domain: 'A',
      domainCandidateHash,
      domainReleaseVersion: plan.targetVersion,
      baseline: releaseBaselineFromPlan(plan),
      domainGates: evaluateDomainGates({ review: domainReview }),
      pairCandidates: [
        {
          pairId,
          pairCandidateHash,
          sourceContextPacketSha256: packet.packetSha256,
          capability: repairedCompile.capability!,
          antipattern: repairedCompile.antipattern!,
          gates: repairedGates
        }
      ],
      expectedDomainCandidateHash: defectDomainHash
    })
  );
  assert(staleBundleMessage === STALE_REVISION_ISSUE, 'approval bundle must reject the pre-repair domain candidate hash');

  const built = buildApprovalBundle({
    domain: 'A',
    domainCandidateHash,
    domainReleaseVersion: plan.targetVersion,
    baseline: releaseBaselineFromPlan(plan),
    domainGates: evaluateDomainGates({ review: domainReview }),
    pairCandidates: [
      {
        pairId,
        pairCandidateHash,
        sourceContextPacketSha256: packet.packetSha256,
        capability: repairedCompile.capability,
        antipattern: repairedCompile.antipattern,
        gates: repairedGates
      }
    ],
    expectedDomainCandidateHash: domainCandidateHash
  });
  assert(built.bundle.source.pairSourceContextPacketSha256[pairId] === packet.packetSha256, 'approval bundle must bind the acquired packet hash');
  assert(built.bundle.pairCandidateHashes[pairId] === pairCandidateHash, 'approval bundle must bind the repaired pair candidate hash');
  const decision = recordOperatorApproval(built.bundle, built.payloads, {
    domainCandidateHash,
    approvalBundleSha256: built.bundleSha256,
    proposedManifestSha256: built.bundle.proposedManifestSha256,
    approvalReference: 'OP-SLICE-A2-001',
    effectiveFrom: '2026-09-08',
    approvedOn: '2026-09-08T08:15:00.000Z'
  });
  const capabilityArtifact = decision.releaseManifest.pairs[0]?.artifacts.find(
    (artifact) => artifact.object_id === 'A2' && artifact.content_type === 'application/json'
  );
  const antipatternArtifact = decision.releaseManifest.pairs[0]?.artifacts.find(
    (artifact) => artifact.object_id === 'AP-A2' && artifact.content_type === 'application/json'
  );
  assert(capabilityArtifact && antipatternArtifact, 'approved manifest must include both canonical JSON documents');
  const finalCapability = JSON.parse(decision.releasePayloads[capabilityArtifact.sha256]?.utf8 ?? '{}') as Record<string, unknown>;
  const finalAntipattern = JSON.parse(decision.releasePayloads[antipatternArtifact.sha256]?.utf8 ?? '{}') as Record<string, unknown>;
  const releaseValidation = await validateCanonicalPair(finalCapability, finalAntipattern, {
    activeSchemaVersion: plan.schemaVersion,
    requiredLifecycleStages: plan.vocabulary.lifecycleStages
  });
  assert(releaseValidation.passed, `approved canonical payload must validate: ${JSON.stringify(releaseValidation.issues)}`);
  const publication = await publishWithRecovery({
    domainRunId: '00000000-0000-0000-0000-0000000000a2',
    decision
  });

  return {
    pairId,
    sourceGapsBeforeAuthoring: 'PASS',
    fixtureMappingsDoNotComplete: 'PASS',
    gappyCoverage: 'SOURCE_GAPS_PRESENT',
    draftVisibleWithGaps: 'PASS',
    injectedDefectBlocksApproval: 'PASS',
    repairedPacketHash: secondPacket.packetSha256,
    staleRevisionRejected: 'PASS',
    pairCandidateHash,
    domainCandidateHash,
    sourceContextPacketSha256: packet.packetSha256,
    approvalBundleSha256: decision.approvalBundleSha256,
    releaseManifestSha256: decision.releaseManifestSha256,
    publication
  };
}

export interface FivePairVerticalSliceResult {
  domain: 'A';
  pairIds: string[];
  pairCandidateHashes: Record<string, string>;
  sourceContextPacketSha256: Record<string, string>;
  domainCandidateHash: string;
  domainPacketSha256: string;
  approvalBundleSha256: string;
  releaseManifestSha256: string;
  publication: { artifactCount: number; idempotentRetry: true; partialUploadRecovery: true };
}

export async function runFivePairDomainVerticalSlice(): Promise<FivePairVerticalSliceResult> {
  const domain = 'A' as const;
  const pairIds = [...expectedDomainPairIds(domain)];
  assert(pairIds.length === 5, 'domain approval unit must be five pairs');
  const pairPlans: AuthoringPlan[] = [];
  const pairCandidates = [];
  const pairCandidateHashes: Record<string, string> = {};
  const sourceHashes: Record<string, string> = {};
  const pairDigests = [];

  for (const pairId of pairIds) {
    const plan = verticalSliceAuthoringPlan(pairId);
    pairPlans.push(plan);
    const packet = acquireVerticalSliceSourcePacket(plan);
    assert(packet.pairId === pairId, `${pairId} source packet must bind that pair`);
    assertLiveHash(packet.packetSha256, `${pairId} source-context packet hash`);
    const snapshot = bindVerticalSliceSourceMappings(completeSirCompileSnapshot(), packet, 'complete');
    assert(sourceMappingsBoundToPacket(snapshot.sourceMappings, packet), `${pairId} mappings must bind the acquired packet`);
    const schemaIssues = schemaGate(pairId, snapshot);
    assert(schemaIssues.length === 0, `${pairId} failed schemaGate: ${schemaIssues.join('; ')}`);
    const compiled = await compileSirPair({ authoringPlan: plan, snapshot, mode: 'DRAFT' });
    assert(compiled.ok && compiled.capability && compiled.antipattern, `${pairId} must compile as DRAFT`);
    assert(
      compiled.capability.id === plan.identity.capabilityId && compiled.antipattern.id === plan.identity.antipatternId,
      `${pairId} canonical IDs must come from its Authoring Plan`
    );
    const pairPacket = rebuildPairCoherencePacket({ snapshot, authoringPlan: plan });
    const review = cleanPairReview(pairPacket);
    assert(review.passed === true, `${pairId} pair coherence must pass before domain admission`);
    const hashes = pairArtifactHashes({ snapshot, sourcePacket: packet, review });
    const pairCandidateHash = pairCandidateRevisionHash(pairId, hashes);
    pairCandidateHashes[pairId] = pairCandidateHash;
    sourceHashes[pairId] = packet.packetSha256;
    const gates = requiredPairGates({ snapshot, packet, schemaIssues, review, compiled });
    assert(
      gates.some((item) => item.outcome === 'SOURCE_COVERAGE_COMPLETE') &&
        gates.some((item) => item.outcome === 'CANONICAL_COMPILE_VALID') &&
        gates.some((item) => item.outcome === 'COHERENCE_CLEAN'),
      `${pairId} is missing a required release gate`
    );
    pairCandidates.push({
      pairId,
      pairCandidateHash,
      sourceContextPacketSha256: packet.packetSha256,
      capability: compiled.capability,
      antipattern: compiled.antipattern,
      gates
    });
    pairDigests.push(
      deriveDomainCoherencePairDigest({
        authoringPlan: plan,
        pairCoherencePacket: pairPacket,
        pairCoherenceReview: review
      })
    );
  }

  const uniquePackets = new Set(Object.values(sourceHashes));
  assert(uniquePackets.size === 5, 'each domain pair must have its own source-context packet hash');
  const uniquePairs = new Set(Object.values(pairCandidateHashes));
  assert(uniquePairs.size === 5, 'each domain pair must have its own candidate hash');

  const domainPacket = buildDomainCoherencePacket({
    domain,
    baselineSha256: pairPlans[0]!.baseline.baselineSha256,
    pairDigests
  });
  const domainReview = materializeDomainCoherenceReview(
    { defects: [], coherenceSummary: CLEAN_DOMAIN_SUMMARY },
    domainPacket
  );
  assert(domainReview.domainCoherencePacketSha256 === domainPacket.packetSha256, 'domain review must bind the domain packet');
  const domainGates = evaluateDomainGates({ review: domainReview });
  assert(
    domainGates.some((item) => item.outcome === 'READY_FOR_APPROVAL'),
    'five-pair domain QC must derive READY_FOR_APPROVAL'
  );
  const domainCandidateHash = domainCandidateRevisionHash(
    domain,
    pairCandidateHashes,
    canonicalArtifactHash(domainReview)
  );
  assertLiveHash(domainCandidateHash, 'five-pair domain candidate hash');
  assertLiveHash(domainPacket.packetSha256, 'domain coherence packet hash');

  const built = buildApprovalBundle({
    domain,
    domainCandidateHash,
    domainReleaseVersion: pairPlans[0]!.targetVersion,
    baseline: releaseBaselineFromPlan(pairPlans[0]!),
    domainGates,
    pairCandidates,
    expectedDomainCandidateHash: domainCandidateHash
  });
  assert(Object.keys(built.bundle.pairCandidateHashes).join(',') === pairIds.join(','), 'approval bundle must list A1-A5 in order');
  for (const pairId of pairIds) {
    assert(
      built.bundle.source.pairSourceContextPacketSha256[pairId] === sourceHashes[pairId],
      `${pairId} approval bundle source hash drifted from the acquired packet`
    );
  }
  const decision = recordOperatorApproval(built.bundle, built.payloads, {
    domainCandidateHash,
    approvalBundleSha256: built.bundleSha256,
    proposedManifestSha256: built.bundle.proposedManifestSha256,
    approvalReference: 'OP-SLICE-DOMAIN-A-001',
    effectiveFrom: '2026-09-08',
    approvedOn: '2026-09-08T08:30:00.000Z'
  });
  assert(decision.releaseManifest.pairs.length === 5, 'approved domain manifest must contain five pairs');
  const firstPlan = pairPlans[0]!;
  const firstCapability = decision.releaseManifest.pairs[0]?.artifacts.find(
    (artifact) => artifact.content_type === 'application/json' && artifact.object_id === 'A1'
  );
  const firstAntipattern = decision.releaseManifest.pairs[0]?.artifacts.find(
    (artifact) => artifact.content_type === 'application/json' && artifact.object_id === 'AP-A1'
  );
  assert(firstCapability && firstAntipattern, 'domain manifest must include A1 canonical JSON');
  const releaseValidation = await validateCanonicalPair(
    JSON.parse(decision.releasePayloads[firstCapability.sha256]?.utf8 ?? '{}') as Record<string, unknown>,
    JSON.parse(decision.releasePayloads[firstAntipattern.sha256]?.utf8 ?? '{}') as Record<string, unknown>,
    {
      activeSchemaVersion: firstPlan.schemaVersion,
      requiredLifecycleStages: firstPlan.vocabulary.lifecycleStages
    }
  );
  assert(releaseValidation.passed, `five-pair approved payload must validate: ${JSON.stringify(releaseValidation.issues)}`);
  const publication = await publishWithRecovery({
    domainRunId: '00000000-0000-0000-0000-00000000000a',
    decision
  });

  return {
    domain,
    pairIds,
    pairCandidateHashes,
    sourceContextPacketSha256: sourceHashes,
    domainCandidateHash,
    domainPacketSha256: domainPacket.packetSha256,
    approvalBundleSha256: decision.approvalBundleSha256,
    releaseManifestSha256: decision.releaseManifestSha256,
    publication
  };
}
