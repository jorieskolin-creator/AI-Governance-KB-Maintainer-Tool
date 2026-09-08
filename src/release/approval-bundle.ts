import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import {
  canonicalArtifactHash,
  sha256Utf8,
  utf8Bytes
} from '../orchestration/artifact-hash.js';
import {
  STALE_REVISION_ISSUE,
  staleRevisionIssues,
  type NamedGateResult
} from '../orchestration/named-gates.js';
import type { ValidationFinding } from '../validation/contracts.js';
import {
  renderCanonicalObject,
  renderParityGate,
  type CanonicalRenderedBytes
} from './canonical-render.js';
import {
  manifestPairsSorted,
  pairBasePath,
  proposedManifestSha256,
  validateProposedReleaseManifest,
  type ManifestArtifact,
  type PairManifestEntry,
  type ProposedDomainReleaseManifest,
  type ReleaseBaselineIdentity
} from './manifest.js';

export const APPROVAL_BUNDLE_KIND = 'APPROVAL_BUNDLE' as const;
export const APPROVAL_BUNDLE_SCHEMA_VERSION = '1.0.0' as const;

export interface ApprovalBundleRenderRef {
  pairId: string;
  objectId: string;
  objectType: 'CAPABILITY' | 'ANTIPATTERN';
  format: 'JSON' | 'HTML';
  path: string;
  contentType: string;
  sha256: string;
}

export interface ApprovalBundlePayload {
  contentType: string;
  utf8: string;
}

export interface ApprovalBundle {
  documentKind: typeof APPROVAL_BUNDLE_KIND;
  schemaVersion: typeof APPROVAL_BUNDLE_SCHEMA_VERSION;
  domain: string;
  domainCandidateHash: string;
  pairCandidateHashes: Record<string, string>;
  source: {
    sourceRegisterVersion: string;
    sourceRegisterSha256: string;
    pairSourceContextPacketSha256: Record<string, string | null>;
  };
  baseline: {
    baselineSnapshotId: string;
    baselineSha256: string;
  };
  renders: ApprovalBundleRenderRef[];
  gateResults: {
    sha256: string;
  };
  proposedManifest: ProposedDomainReleaseManifest;
  proposedManifestSha256: string;
  approval: 'NOT_GRANTED';
  releaseStatus: 'DRAFT';
}

export interface ApprovalPairInput {
  pairId: string;
  pairCandidateHash: string;
  sourceContextPacketSha256: string | null;
  capability: Record<string, unknown>;
  antipattern: Record<string, unknown>;
  gates: readonly NamedGateResult[];
}

export interface BuildApprovalBundleInput {
  domain: string;
  domainCandidateHash: string;
  domainReleaseVersion: string;
  baseline: ReleaseBaselineIdentity;
  pairCandidates: readonly ApprovalPairInput[];
  domainGates: readonly NamedGateResult[];
  expectedDomainCandidateHash?: string;
}

export interface BuiltApprovalBundle {
  bundle: ApprovalBundle;
  bundleSha256: string;
  payloads: Record<string, ApprovalBundlePayload>;
  pairParityGates: NamedGateResult[];
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function gateFindingHash(findings: readonly ValidationFinding[]): string {
  return canonicalArtifactHash(findings);
}

function uniqueGates(gates: readonly NamedGateResult[]): NamedGateResult[] {
  const byName = new Map<NamedGateResult['gateName'], NamedGateResult>();
  for (const gate of gates) byName.set(gate.gateName, gate);
  return [...byName.values()].sort((left, right) => left.gateName.localeCompare(right.gateName));
}

export function namedGateSetHash(input: {
  domainCandidateHash: string;
  domainGates: readonly NamedGateResult[];
  pairs: readonly { pairId: string; pairCandidateHash: string; gates: readonly NamedGateResult[] }[];
}): string {
  return canonicalArtifactHash({
    domainCandidateHash: input.domainCandidateHash,
    domainGates: uniqueGates(input.domainGates).map((gate) => ({
      gateName: gate.gateName,
      outcome: gate.outcome,
      validatorVersion: gate.validatorVersion,
      findingsSha256: gateFindingHash(gate.findings)
    })),
    pairs: [...input.pairs]
      .map((pair) => ({
        pairId: pair.pairId,
        pairCandidateHash: pair.pairCandidateHash,
        gates: uniqueGates(pair.gates).map((gate) => ({
          gateName: gate.gateName,
          outcome: gate.outcome,
          validatorVersion: gate.validatorVersion,
          findingsSha256: gateFindingHash(gate.findings)
        }))
      }))
      .sort((left, right) => left.pairId.localeCompare(right.pairId))
  });
}

export function releaseBaselineFromPlan(plan: AuthoringPlan): ReleaseBaselineIdentity {
  return {
    baseline_snapshot_id: plan.baseline.baselineSnapshotId,
    baseline_sha256: plan.baseline.baselineSha256,
    production_contract_version: plan.baseline.productionContractVersion,
    production_contract_sha256: plan.baseline.productionContractSha256,
    schema_version: plan.schemaVersion,
    source_register_version: plan.baseline.sourceRegisterVersion,
    source_register_sha256: plan.baseline.sourceRegisterSha256,
    tactic_catalog_version: plan.baseline.tacticCatalogVersion,
    tactic_catalog_sha256: plan.baseline.tacticCatalogSha256,
    golden_reference_id: plan.baseline.goldenReferenceId,
    golden_reference_version: plan.baseline.goldenReferenceVersion,
    golden_reference_sha256: plan.baseline.goldenReferenceSha256
  };
}

function objectTypeOf(object: Record<string, unknown>): 'CAPABILITY' | 'ANTIPATTERN' {
  return object.object_type === 'ANTIPATTERN' ? 'ANTIPATTERN' : 'CAPABILITY';
}

function artifactTypeOf(objectType: 'CAPABILITY' | 'ANTIPATTERN', format: 'JSON' | 'HTML'): string {
  return `${objectType}_${format}`;
}

function filenameOf(objectId: string, format: 'JSON' | 'HTML'): string {
  return format === 'JSON' ? `${objectId}.json` : `${objectId}.html`;
}

function bindPayload(
  payloads: Record<string, ApprovalBundlePayload>,
  rendered: CanonicalRenderedBytes
): void {
  const existing = payloads[rendered.sha256];
  if (existing && existing.utf8 !== rendered.utf8) {
    throw new Error(`SHA-256 collision while binding approval payload ${rendered.sha256}.`);
  }
  if (sha256Utf8(rendered.utf8) !== rendered.sha256) {
    throw new Error(`Rendered ${rendered.format} bytes do not match sha256 for ${rendered.objectId}.`);
  }
  if (Buffer.from(utf8Bytes(rendered.utf8)).equals(Buffer.from(rendered.bytes)) === false) {
    throw new Error(`Rendered ${rendered.format} Uint8Array drifted from UTF-8 for ${rendered.objectId}.`);
  }
  payloads[rendered.sha256] = { contentType: rendered.contentType, utf8: rendered.utf8 };
}

function manifestArtifact(input: {
  domain: string;
  capabilityId: string;
  capabilityVersion: string;
  antipatternId: string;
  antipatternVersion: string;
  rendered: CanonicalRenderedBytes;
}): ManifestArtifact {
  const path = `${pairBasePath({
    domain: input.domain,
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion,
    antipatternId: input.antipatternId,
    antipatternVersion: input.antipatternVersion
  })}/${filenameOf(input.rendered.objectId, input.rendered.format)}`;
  return {
    artifact_type: artifactTypeOf(input.rendered.objectType, input.rendered.format),
    object_id: input.rendered.objectId,
    version: input.capabilityVersion,
    path,
    url: path,
    sha256: input.rendered.sha256,
    content_type: input.rendered.contentType
  };
}

export function approvalBundleSha256(bundle: ApprovalBundle): string {
  return canonicalArtifactHash(bundle);
}

export function assertCurrentApprovalCandidate(
  currentDomainCandidateHash: string,
  requestedHash: unknown
): string[] {
  if (requestedHash === undefined) return [];
  return staleRevisionIssues(currentDomainCandidateHash, requestedHash);
}

export function buildApprovalBundle(input: BuildApprovalBundleInput): BuiltApprovalBundle {
  const stale = assertCurrentApprovalCandidate(input.domainCandidateHash, input.expectedDomainCandidateHash);
  if (stale.length > 0) {
    throw new Error(stale[0] ?? STALE_REVISION_ISSUE);
  }
  if (!/^[A-F]$/.test(input.domain)) {
    throw new Error(`Invalid approval-bundle domain ${input.domain}.`);
  }
  if (input.pairCandidates.length === 0) {
    throw new Error('An approval bundle requires at least one compiled pair.');
  }
  if (!input.domainGates.some((gate) => gate.outcome === 'READY_FOR_APPROVAL')) {
    throw new Error('An approval bundle requires READY_FOR_APPROVAL on the current domain candidate.');
  }

  const pairCandidateHashes: Record<string, string> = {};
  const pairSourceHashes: Record<string, string | null> = {};
  const pairEntries: PairManifestEntry[] = [];
  const renders: ApprovalBundleRenderRef[] = [];
  const payloads: Record<string, ApprovalBundlePayload> = {};
  const pairParityGates: NamedGateResult[] = [];
  const pairsForGateHash: Array<{
    pairId: string;
    pairCandidateHash: string;
    gates: NamedGateResult[];
  }> = [];

  for (const pair of input.pairCandidates) {
    const capabilityId = String(pair.capability.id ?? '');
    const antipatternId = String(pair.antipattern.id ?? '');
    const capabilityVersion = String(pair.capability.version ?? '');
    const antipatternVersion = String(pair.antipattern.version ?? '');
    if (`${capabilityId}_${antipatternId}` !== pair.pairId) {
      throw new Error(`Compiled identities ${capabilityId}/${antipatternId} do not match pair ${pair.pairId}.`);
    }
    if (objectTypeOf(pair.capability) !== 'CAPABILITY' || objectTypeOf(pair.antipattern) !== 'ANTIPATTERN') {
      throw new Error(`${pair.pairId} compiled objects are missing canonical object_type.`);
    }
    if (pair.sourceContextPacketSha256 && !/^[a-f0-9]{64}$/.test(pair.sourceContextPacketSha256)) {
      throw new Error(`${pair.pairId} source-context packet hash is not SHA-256.`);
    }

    const capabilityRender = renderCanonicalObject(pair.capability);
    const antipatternRender = renderCanonicalObject(pair.antipattern);
    const parityDefects = [...capabilityRender.parityDefects, ...antipatternRender.parityDefects];
    const compileGates = pair.gates.filter((gate) => gate.gateName === 'CANONICAL_COMPILE');
    if (!compileGates.some((gate) => gate.outcome === 'CANONICAL_COMPILE_VALID')) {
      parityDefects.push({
        checkId: 'CANONICAL_COMPILE',
        kind: 'PUBLICATION_PARITY',
        severity: 'BLOCKING',
        objectId: pair.pairId,
        objectPath: '/',
        issue: `${pair.pairId} cannot enter an approval bundle without CANONICAL_COMPILE_VALID.`,
        dependencyScope: []
      });
    }
    const parityGate = renderParityGate(parityDefects);
    pairParityGates.push(parityGate);
    if (parityGate.outcome !== 'RENDER_PARITY_VALID') {
      throw new Error(
        parityDefects.map((item) => item.issue).join(' ') || `${pair.pairId} failed RENDER_PARITY.`
      );
    }

    const artifacts = [
      manifestArtifact({
        domain: input.domain,
        capabilityId,
        capabilityVersion,
        antipatternId,
        antipatternVersion,
        rendered: capabilityRender.json
      }),
      manifestArtifact({
        domain: input.domain,
        capabilityId,
        capabilityVersion,
        antipatternId,
        antipatternVersion,
        rendered: capabilityRender.html
      }),
      manifestArtifact({
        domain: input.domain,
        capabilityId,
        capabilityVersion,
        antipatternId,
        antipatternVersion,
        rendered: antipatternRender.json
      }),
      manifestArtifact({
        domain: input.domain,
        capabilityId,
        capabilityVersion,
        antipatternId,
        antipatternVersion,
        rendered: antipatternRender.html
      })
    ];

    for (const rendered of [
      capabilityRender.json,
      capabilityRender.html,
      antipatternRender.json,
      antipatternRender.html
    ]) {
      bindPayload(payloads, rendered);
      const artifact = artifacts.find((item) => item.sha256 === rendered.sha256);
      if (!artifact) {
        throw new Error(`Rendered ${rendered.objectId} ${rendered.format} is missing from the proposed manifest.`);
      }
      renders.push({
        pairId: pair.pairId,
        objectId: rendered.objectId,
        objectType: rendered.objectType,
        format: rendered.format,
        path: artifact.path,
        contentType: rendered.contentType,
        sha256: rendered.sha256
      });
    }

    pairCandidateHashes[pair.pairId] = pair.pairCandidateHash;
    pairSourceHashes[pair.pairId] = pair.sourceContextPacketSha256;
    pairEntries.push({
      pair_id: pair.pairId,
      capability_id: capabilityId,
      capability_version: capabilityVersion,
      antipattern_id: antipatternId,
      antipattern_version: antipatternVersion,
      artifacts
    });
    pairsForGateHash.push({
      pairId: pair.pairId,
      pairCandidateHash: pair.pairCandidateHash,
      gates: [...pair.gates, parityGate]
    });
  }

  const proposedManifest: ProposedDomainReleaseManifest = {
    manifest_version: '1.0.0',
    manifest_kind: 'PROPOSED_RELEASE_MANIFEST',
    domain: input.domain,
    domain_release_version: input.domainReleaseVersion,
    baseline: input.baseline,
    external_approval: { status: 'NOT_GRANTED' },
    pairs: manifestPairsSorted(pairEntries)
  };
  validateProposedReleaseManifest(proposedManifest);
  const proposedHash = proposedManifestSha256(proposedManifest);
  const swapped = {
    ...proposedManifest,
    pairs: manifestPairsSorted([...pairEntries].reverse())
  };
  if (proposedManifestSha256(swapped) !== proposedHash) {
    throw new Error('Proposed manifest hash depends on pair or artifact order.');
  }

  const gateResultSha256 = namedGateSetHash({
    domainCandidateHash: input.domainCandidateHash,
    domainGates: input.domainGates,
    pairs: pairsForGateHash
  });

  const bundle: ApprovalBundle = {
    documentKind: APPROVAL_BUNDLE_KIND,
    schemaVersion: APPROVAL_BUNDLE_SCHEMA_VERSION,
    domain: input.domain,
    domainCandidateHash: input.domainCandidateHash,
    pairCandidateHashes: sortedRecord(pairCandidateHashes),
    source: {
      sourceRegisterVersion: input.baseline.source_register_version,
      sourceRegisterSha256: input.baseline.source_register_sha256,
      pairSourceContextPacketSha256: sortedRecord(pairSourceHashes)
    },
    baseline: {
      baselineSnapshotId: input.baseline.baseline_snapshot_id,
      baselineSha256: input.baseline.baseline_sha256
    },
    renders: [...renders].sort((left, right) => left.path.localeCompare(right.path)),
    gateResults: { sha256: gateResultSha256 },
    proposedManifest,
    proposedManifestSha256: proposedHash,
    approval: 'NOT_GRANTED',
    releaseStatus: 'DRAFT'
  };

  return {
    bundle,
    bundleSha256: approvalBundleSha256(bundle),
    payloads,
    pairParityGates
  };
}

