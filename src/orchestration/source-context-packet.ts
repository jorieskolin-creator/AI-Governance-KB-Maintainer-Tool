import { createHash } from 'node:crypto';
import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirHandle } from '../sir/model.js';

export type DecisionEligibleSourceStatus = 'IN_FORCE' | 'PUBLISHED';
export type ModelContextPolicy = 'METADATA_LOCATOR_ONLY' | 'BOUNDED_SNIPPET_ALLOWED';

export interface AuthoringSourceRegisterRecord {
  sourceId: string;
  versionOrDate: string;
  verificationStatus: 'VERIFIED';
  lastVerifiedDate: string;
  effectiveStatus: DecisionEligibleSourceStatus;
  authorityTier: string;
  authorityType: string;
  officialLocation: string;
  applicabilityBoundary: string;
  licensingBoundary: string;
  domainCoverage: string[];
  modelContextPolicy: ModelContextPolicy;
  usageRightsReference: string | null;
}

export interface SourceLocatorContextInput {
  sourceId: string;
  locator: string;
  locatorLabel?: string;
  contextText?: string;
}

export interface SourceContextPacketLimits {
  maxSnippetCharsPerLocator: number;
  maxTotalSnippetChars: number;
}

export interface SourceLocatorContext {
  locatorHandle: SirHandle;
  exactLocator: string;
  locatorLabel: string | null;
  contextMode: 'LOCATOR_METADATA_ONLY' | 'BOUNDED_TEXT_SNIPPET';
  contextText: string | null;
  contextSha256: string;
}

export interface SourceContextPacketEntry {
  sourceHandle: string;
  sourceId: string;
  versionOrDate: string;
  verificationStatus: 'VERIFIED';
  lastVerifiedDate: string;
  effectiveStatus: DecisionEligibleSourceStatus;
  authorityTier: string;
  authorityType: string;
  officialLocation: string;
  applicabilityBoundary: string;
  licensingBoundary: string;
  modelContextPolicy: ModelContextPolicy;
  usageRightsReference: string | null;
  locatorContexts: SourceLocatorContext[];
  mappingContextAvailable: boolean;
}

export interface SourceContextPacket {
  packetVersion: '1.0.0';
  pairId: string;
  authoringPlanSha256: string;
  sourceRegisterVersion: string;
  sourceRegisterSha256: string;
  sources: SourceContextPacketEntry[];
  missingContextSourceHandles: string[];
  mappingContextAvailable: boolean;
  packetSha256: string;
}

const DEFAULT_LIMITS: SourceContextPacketLimits = {
  maxSnippetCharsPerLocator: 6000,
  maxTotalSnippetChars: 30000
};

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
}

function assertRegisterBinding(
  plan: AuthoringPlan,
  sealedSourceRegisterVersion: string,
  sealedSourceRegisterSha256: string
): void {
  if (sealedSourceRegisterVersion !== plan.baseline.sourceRegisterVersion) {
    throw new Error(
      `Source Register version ${sealedSourceRegisterVersion} does not match Authoring Plan ${plan.baseline.sourceRegisterVersion}.`
    );
  }
  if (sealedSourceRegisterSha256 !== plan.baseline.sourceRegisterSha256) {
    throw new Error('Source Register hash does not match the sealed Authoring Plan baseline.');
  }
}

function assertRecordMatchesPlan(
  plan: AuthoringPlan,
  record: AuthoringSourceRegisterRecord
): string {
  const allowed = plan.sourceUniverse.find((item) => item.sourceId === record.sourceId);
  if (!allowed) {
    throw new Error(`${record.sourceId} is not present in the Authoring Plan source universe.`);
  }
  if (record.versionOrDate !== allowed.versionOrDate) {
    throw new Error(
      `${record.sourceId} version/date ${record.versionOrDate} does not match Authoring Plan ${allowed.versionOrDate}.`
    );
  }
  if (record.verificationStatus !== allowed.verificationStatus) {
    throw new Error(`${record.sourceId} verification status drifted from the Authoring Plan.`);
  }
  if (record.lastVerifiedDate !== allowed.lastVerifiedDate) {
    throw new Error(`${record.sourceId} verification date drifted from the Authoring Plan.`);
  }
  if (!record.domainCoverage.includes(plan.identity.domain)) {
    throw new Error(`${record.sourceId} is not registered for domain ${plan.identity.domain}.`);
  }
  if (!['IN_FORCE', 'PUBLISHED'].includes(record.effectiveStatus)) {
    throw new Error(`${record.sourceId} is not decision-eligible: ${record.effectiveStatus}.`);
  }

  assertNonEmpty(record.authorityTier, `${record.sourceId} authorityTier`);
  assertNonEmpty(record.authorityType, `${record.sourceId} authorityType`);
  assertNonEmpty(record.officialLocation, `${record.sourceId} officialLocation`);
  assertNonEmpty(record.applicabilityBoundary, `${record.sourceId} applicabilityBoundary`);
  assertNonEmpty(record.licensingBoundary, `${record.sourceId} licensingBoundary`);

  if (
    record.authorityType === 'PUBLISHED_STANDARD' &&
    record.modelContextPolicy === 'BOUNDED_SNIPPET_ALLOWED' &&
    !record.usageRightsReference?.trim()
  ) {
    throw new Error(
      `${record.sourceId} is a published standard; model-visible protected text requires an explicit usage-rights reference.`
    );
  }

  return allowed.sourceHandle;
}

function validateLimits(limits: SourceContextPacketLimits): void {
  if (!Number.isInteger(limits.maxSnippetCharsPerLocator) || limits.maxSnippetCharsPerLocator <= 0) {
    throw new Error('maxSnippetCharsPerLocator must be a positive integer.');
  }
  if (!Number.isInteger(limits.maxTotalSnippetChars) || limits.maxTotalSnippetChars <= 0) {
    throw new Error('maxTotalSnippetChars must be a positive integer.');
  }
}

export function buildSourceContextPacket(input: {
  authoringPlan: AuthoringPlan;
  sealedSourceRegisterVersion: string;
  sealedSourceRegisterSha256: string;
  registerRecords: AuthoringSourceRegisterRecord[];
  locatorContexts: SourceLocatorContextInput[];
  limits?: SourceContextPacketLimits;
}): SourceContextPacket {
  const limits = input.limits ?? DEFAULT_LIMITS;
  validateLimits(limits);
  assertRegisterBinding(
    input.authoringPlan,
    input.sealedSourceRegisterVersion,
    input.sealedSourceRegisterSha256
  );

  const planSourceIds = new Set(input.authoringPlan.sourceUniverse.map((item) => item.sourceId));
  const recordIds = input.registerRecords.map((record) => record.sourceId);
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error('Source Context Packet input contains duplicate Source Register records.');
  }

  for (const context of input.locatorContexts) {
    if (!planSourceIds.has(context.sourceId)) {
      throw new Error(
        `Locator context for ${context.sourceId} is outside the Authoring Plan source universe.`
      );
    }
    assertNonEmpty(context.locator, `${context.sourceId} locator`);
  }

  const contextsBySource = new Map<string, SourceLocatorContextInput[]>();
  for (const context of input.locatorContexts) {
    const list = contextsBySource.get(context.sourceId) ?? [];
    list.push(context);
    contextsBySource.set(context.sourceId, list);
  }

  let locatorSequence = 0;
  let totalSnippetChars = 0;
  const sources: SourceContextPacketEntry[] = input.registerRecords
    .map((record) => ({ record, sourceHandle: assertRecordMatchesPlan(input.authoringPlan, record) }))
    .sort((a, b) => a.sourceHandle.localeCompare(b.sourceHandle))
    .map(({ record, sourceHandle }) => {
      const rawContexts = [...(contextsBySource.get(record.sourceId) ?? [])].sort((a, b) =>
        a.locator.localeCompare(b.locator)
      );
      const locatorKeys = rawContexts.map((item) => `${item.locator}\u0000${item.locatorLabel ?? ''}`);
      if (new Set(locatorKeys).size !== locatorKeys.length) {
        throw new Error(`${record.sourceId} contains duplicate locator contexts.`);
      }

      const locatorContexts = rawContexts.map((context): SourceLocatorContext => {
        const text = context.contextText?.trim() || null;
        if (record.modelContextPolicy === 'METADATA_LOCATOR_ONLY' && text !== null) {
          throw new Error(
            `${record.sourceId} permits metadata/locator-only model context; protected/source text cannot be included.`
          );
        }
        if (text !== null && text.length > limits.maxSnippetCharsPerLocator) {
          throw new Error(
            `${record.sourceId} locator ${context.locator} exceeds the bounded snippet limit.`
          );
        }
        if (text !== null) {
          totalSnippetChars += text.length;
          if (totalSnippetChars > limits.maxTotalSnippetChars) {
            throw new Error('Source Context Packet exceeds the total bounded snippet limit.');
          }
        }

        locatorSequence += 1;
        const locatorHandle = `locator_${String(locatorSequence).padStart(3, '0')}` as SirHandle;
        return {
          locatorHandle,
          exactLocator: context.locator.trim(),
          locatorLabel: context.locatorLabel?.trim() || null,
          contextMode: text === null ? 'LOCATOR_METADATA_ONLY' : 'BOUNDED_TEXT_SNIPPET',
          contextText: text,
          contextSha256: sha256({
            sourceId: record.sourceId,
            versionOrDate: record.versionOrDate,
            locator: context.locator.trim(),
            locatorLabel: context.locatorLabel?.trim() || null,
            contextText: text
          })
        };
      });

      return {
        sourceHandle,
        sourceId: record.sourceId,
        versionOrDate: record.versionOrDate,
        verificationStatus: record.verificationStatus,
        lastVerifiedDate: record.lastVerifiedDate,
        effectiveStatus: record.effectiveStatus,
        authorityTier: record.authorityTier,
        authorityType: record.authorityType,
        officialLocation: record.officialLocation,
        applicabilityBoundary: record.applicabilityBoundary,
        licensingBoundary: record.licensingBoundary,
        modelContextPolicy: record.modelContextPolicy,
        usageRightsReference: record.usageRightsReference,
        locatorContexts,
        mappingContextAvailable: locatorContexts.length > 0
      };
    });

  const suppliedSourceIds = new Set(sources.map((item) => item.sourceId));
  const missingRegisterRecords = input.authoringPlan.sourceUniverse
    .filter((item) => !suppliedSourceIds.has(item.sourceId))
    .map((item) => item.sourceId);
  if (missingRegisterRecords.length > 0) {
    throw new Error(
      `Source Context Packet is missing sealed register records for: ${missingRegisterRecords.join(', ')}.`
    );
  }

  const withoutHash = {
    packetVersion: '1.0.0' as const,
    pairId: input.authoringPlan.identity.pairId,
    authoringPlanSha256: input.authoringPlan.planSha256,
    sourceRegisterVersion: input.sealedSourceRegisterVersion,
    sourceRegisterSha256: input.sealedSourceRegisterSha256,
    sources,
    missingContextSourceHandles: sources
      .filter((item) => !item.mappingContextAvailable)
      .map((item) => item.sourceHandle),
    mappingContextAvailable: sources.some((item) => item.mappingContextAvailable)
  };

  return { ...withoutHash, packetSha256: sha256(withoutHash) };
}
