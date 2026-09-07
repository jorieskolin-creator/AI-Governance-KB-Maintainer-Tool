import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import { loadRepoBaselineArtifacts } from '../baseline/repo-artifacts.js';
import type { TaskContract } from '../domain/task-contract.js';
import { canonicalArtifactHash } from './artifact-hash.js';
import {
  buildSourceContextPacket,
  isSourceContextPacket,
  type AuthoringSourceRegisterRecord,
  type SourceContextPacket,
  type SourceLocatorContextInput
} from './source-context-packet.js';
import { verifySourceContextPacket } from './source-context-verifier.js';
import { getLatestCompletedTaskArtifact, persistDeterministicArtifact } from './store.js';

export const SOURCE_CONTEXT_CONTRACT_VERSION = 'source-context/v1';

interface SealedRegisterSource {
  id: string;
  version_or_date: string;
  verification_status: string;
  last_verified_date: string;
  effective_status: string;
  authority_tier: string;
  authority_type: string;
  official_location: string;
  roles_or_applicability_conditions?: string[];
  licensing_storage_boundary: string;
  domain_coverage: string[];
}

export function sourceRecordsForPlan(plan: AuthoringPlan): AuthoringSourceRegisterRecord[] {
  const artifacts = loadRepoBaselineArtifacts();
  const register = artifacts.find((item) => item.artifactType === 'SOURCE_REGISTER')?.content as {
    sources: SealedRegisterSource[];
  };
  if (!register?.sources) {
    throw new Error('Sealed Source Register is missing from the repo baseline.');
  }
  return plan.sourceUniverse.map((allowed) => {
    const source = register.sources.find((item) => item.id === allowed.sourceId);
    if (!source) throw new Error(`Source ${allowed.sourceId} is missing from the sealed register.`);
    return {
      sourceId: source.id,
      versionOrDate: source.version_or_date,
      verificationStatus: 'VERIFIED' as const,
      lastVerifiedDate: source.last_verified_date,
      effectiveStatus: source.effective_status === 'IN_FORCE' ? 'IN_FORCE' : 'PUBLISHED',
      authorityTier: source.authority_tier,
      authorityType: source.authority_type,
      officialLocation: source.official_location,
      applicabilityBoundary: (source.roles_or_applicability_conditions ?? [
        'Registered applicability boundary.'
      ]).join(' '),
      licensingBoundary: source.licensing_storage_boundary,
      domainCoverage: source.domain_coverage,
      modelContextPolicy: 'METADATA_LOCATOR_ONLY' as const,
      usageRightsReference: null
    };
  });
}

function snippetRightsAllow(record: AuthoringSourceRegisterRecord | undefined): boolean {
  return (
    record?.modelContextPolicy === 'BOUNDED_SNIPPET_ALLOWED' &&
    Boolean(record.usageRightsReference?.trim())
  );
}

function governedLocatorInputs(
  records: readonly AuthoringSourceRegisterRecord[],
  locators: readonly SourceLocatorContextInput[]
): SourceLocatorContextInput[] {
  const byId = new Map(records.map((record) => [record.sourceId, record]));
  return locators.map((locator) => {
    if (snippetRightsAllow(byId.get(locator.sourceId))) return locator;
    const { contextText: _stripped, ...rest } = locator;
    return rest;
  });
}

export function sourceContextAcquisitionContract(plan: AuthoringPlan): TaskContract {
  return {
    contractVersion: SOURCE_CONTEXT_CONTRACT_VERSION,
    taskId: `${plan.identity.pairId}:SOURCE_CONTEXT`,
    taskType: 'SOURCE_CONTEXT',
    targetObjectId: plan.identity.pairId,
    objective:
      'Acquire governed source identity, provenance, context policy, and exact locators allowed by the sealed Authoring Plan. Do not invent locators.',
    modelRole: 'QUALITY_CHECKER',
    upstreamTaskTypes: [],
    lockedInputs: {
      authoring_plan_sha256: plan.planSha256,
      source_register_version: plan.baseline.sourceRegisterVersion,
      source_register_sha256: plan.baseline.sourceRegisterSha256
    },
    allowedReferences: ['SEALED_SOURCE_REGISTER', 'AUTHORING_PLAN'],
    doNot: [
      'INVENT_LOCATORS',
      'FETCH_UNGOVERNED_PASSAGES',
      'INCLUDE_PROTECTED_TEXT_WITHOUT_USAGE_RIGHTS'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SourceContextPacket',
      requiredFields: [
        'packetVersion',
        'pairId',
        'packetSha256',
        'sources',
        'missingContextSourceHandles',
        'mappingContextAvailable'
      ],
      additionalProperties: false
    },
    validationProfile: ['SOURCE_CONTEXT_PACKET'],
    dependencyPaths: [],
    failureMode: 'FAIL_CLOSED'
  };
}

export function acquireSourceContext(input: {
  authoringPlan: AuthoringPlan;
  registerRecords?: AuthoringSourceRegisterRecord[];
  locatorInputs?: SourceLocatorContextInput[];
}): SourceContextPacket {
  const registerRecords = input.registerRecords ?? sourceRecordsForPlan(input.authoringPlan);
  const locatorInputs = governedLocatorInputs(registerRecords, input.locatorInputs ?? []);
  const packet = buildSourceContextPacket({
    authoringPlan: input.authoringPlan,
    sealedSourceRegisterVersion: input.authoringPlan.baseline.sourceRegisterVersion,
    sealedSourceRegisterSha256: input.authoringPlan.baseline.sourceRegisterSha256,
    registerRecords,
    locatorContexts: locatorInputs
  });
  verifySourceContextPacket(packet, input.authoringPlan);
  return packet;
}

export async function ensurePersistedSourceContext(
  pairRunId: string,
  plan: AuthoringPlan,
  options?: {
    registerRecords?: AuthoringSourceRegisterRecord[];
    locatorInputs?: SourceLocatorContextInput[];
  }
): Promise<SourceContextPacket> {
  const existing = await getLatestCompletedTaskArtifact(pairRunId, 'SOURCE_CONTEXT');
  if (existing && isSourceContextPacket(existing.output)) {
    verifySourceContextPacket(existing.output, plan);
    return existing.output;
  }
  const packet = acquireSourceContext({
    authoringPlan: plan,
    registerRecords: options?.registerRecords,
    locatorInputs: options?.locatorInputs
  });
  const contract = sourceContextAcquisitionContract(plan);
  await persistDeterministicArtifact({
    pairRunId,
    taskType: 'SOURCE_CONTEXT',
    output: packet,
    outputHash: canonicalArtifactHash(packet),
    inputHash: canonicalArtifactHash({
      taskType: 'SOURCE_CONTEXT',
      contractVersion: contract.contractVersion,
      authoringPlanSha256: plan.planSha256,
      sourceRegisterSha256: plan.baseline.sourceRegisterSha256
    }),
    taskContract: contract
  });
  return packet;
}
