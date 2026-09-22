import type { Finding, StrictnessTier, ValidationResult } from './finding.js';
import { applyTier } from './finding.js';
import { stableSha256 } from './hash.js';
import { renderTaskPrompt, type PromptContract } from './prompt.js';
import { schemaFindings } from './schema.js';

export type DecisionEligibleSourceStatus = 'IN_FORCE' | 'PUBLISHED';
export type ModelContextPolicy = 'METADATA_LOCATOR_ONLY' | 'BOUNDED_SNIPPET_ALLOWED';

export interface SourceUniverseEntry {
  sourceHandle: string;
  sourceId: string;
  versionOrDate: string;
  verificationStatus: 'VERIFIED';
  lastVerifiedDate: string;
}

export interface SourceContextPlan {
  planSha256: string;
  identity: { pairId: string; domain: string };
  baseline: { sourceRegisterVersion: string; sourceRegisterSha256: string };
  sourceUniverse: SourceUniverseEntry[];
}

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
  locatorHandle: string;
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

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
}

function assertRecordMatchesPlan(plan: SourceContextPlan, record: AuthoringSourceRegisterRecord): string {
  const allowed = plan.sourceUniverse.find((item) => item.sourceId === record.sourceId);
  if (!allowed) throw new Error(`${record.sourceId} is not present in the Authoring Plan source universe.`);
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

export function buildSourceContextPacket(input: {
  plan: SourceContextPlan;
  registerRecords: AuthoringSourceRegisterRecord[];
  locatorContexts: SourceLocatorContextInput[];
  limits?: SourceContextPacketLimits;
}): SourceContextPacket {
  const limits = input.limits ?? DEFAULT_LIMITS;
  if (!Number.isInteger(limits.maxSnippetCharsPerLocator) || limits.maxSnippetCharsPerLocator <= 0) {
    throw new Error('maxSnippetCharsPerLocator must be a positive integer.');
  }
  if (!Number.isInteger(limits.maxTotalSnippetChars) || limits.maxTotalSnippetChars <= 0) {
    throw new Error('maxTotalSnippetChars must be a positive integer.');
  }
  if (input.plan.baseline.sourceRegisterVersion.trim().length === 0) {
    throw new Error('Sealed Source Register version must not be empty.');
  }
  const planSourceIds = new Set(input.plan.sourceUniverse.map((item) => item.sourceId));
  const recordIds = input.registerRecords.map((record) => record.sourceId);
  if (new Set(recordIds).size !== recordIds.length) {
    throw new Error('Source Context Packet input contains duplicate Source Register records.');
  }
  for (const context of input.locatorContexts) {
    if (!planSourceIds.has(context.sourceId)) {
      throw new Error(`Locator context for ${context.sourceId} is outside the Authoring Plan source universe.`);
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
    .map((record) => ({ record, sourceHandle: assertRecordMatchesPlan(input.plan, record) }))
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
          throw new Error(`${record.sourceId} locator ${context.locator} exceeds the bounded snippet limit.`);
        }
        if (text !== null) {
          totalSnippetChars += text.length;
          if (totalSnippetChars > limits.maxTotalSnippetChars) {
            throw new Error('Source Context Packet exceeds the total bounded snippet limit.');
          }
        }
        locatorSequence += 1;
        const locatorLabel = context.locatorLabel?.trim() || null;
        const exactLocator = context.locator.trim();
        return {
          locatorHandle: `locator_${String(locatorSequence).padStart(3, '0')}`,
          exactLocator,
          locatorLabel,
          contextMode: text === null ? 'LOCATOR_METADATA_ONLY' : 'BOUNDED_TEXT_SNIPPET',
          contextText: text,
          contextSha256: stableSha256({
            sourceId: record.sourceId,
            versionOrDate: record.versionOrDate,
            locator: exactLocator,
            locatorLabel,
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
  const missingRegisterRecords = input.plan.sourceUniverse
    .filter((item) => !suppliedSourceIds.has(item.sourceId))
    .map((item) => item.sourceId);
  if (missingRegisterRecords.length > 0) {
    throw new Error(
      `Source Context Packet is missing sealed register records for: ${missingRegisterRecords.join(', ')}.`
    );
  }
  const withoutHash = {
    packetVersion: '1.0.0' as const,
    pairId: input.plan.identity.pairId,
    authoringPlanSha256: input.plan.planSha256,
    sourceRegisterVersion: input.plan.baseline.sourceRegisterVersion,
    sourceRegisterSha256: input.plan.baseline.sourceRegisterSha256,
    sources,
    missingContextSourceHandles: sources.filter((item) => !item.mappingContextAvailable).map((item) => item.sourceHandle),
    mappingContextAvailable: sources.some((item) => item.mappingContextAvailable)
  };
  return { ...withoutHash, packetSha256: stableSha256(withoutHash) };
}

function snippetRightsAllow(record: AuthoringSourceRegisterRecord | undefined): boolean {
  return record?.modelContextPolicy === 'BOUNDED_SNIPPET_ALLOWED' && Boolean(record.usageRightsReference?.trim());
}

export function governedLocatorInputs(
  records: readonly AuthoringSourceRegisterRecord[],
  locators: readonly SourceLocatorContextInput[]
): SourceLocatorContextInput[] {
  const byId = new Map(records.map((record) => [record.sourceId, record]));
  return locators.map((locator) => {
    if (snippetRightsAllow(byId.get(locator.sourceId))) return locator;
    const { contextText: _contextText, ...rest } = locator;
    return rest;
  });
}

export function assembleSourceContext(input: {
  plan: SourceContextPlan;
  registerRecords: AuthoringSourceRegisterRecord[];
  locatorContexts: SourceLocatorContextInput[];
  limits?: SourceContextPacketLimits;
}): SourceContextPacket {
  return buildSourceContextPacket({
    ...input,
    locatorContexts: governedLocatorInputs(input.registerRecords, input.locatorContexts)
  });
}

const sha256 = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const nonEmpty = { type: 'string', minLength: 1 } as const;

export const sourceContextSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ai-governance-kb.local/pipeline/source-context.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'packetVersion',
    'pairId',
    'authoringPlanSha256',
    'sourceRegisterVersion',
    'sourceRegisterSha256',
    'sources',
    'missingContextSourceHandles',
    'mappingContextAvailable',
    'packetSha256'
  ],
  properties: {
    packetVersion: { const: '1.0.0' },
    pairId: { type: 'string', minLength: 1 },
    authoringPlanSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    sourceRegisterVersion: { type: 'string', minLength: 1 },
    sourceRegisterSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sourceHandle',
          'sourceId',
          'versionOrDate',
          'verificationStatus',
          'lastVerifiedDate',
          'effectiveStatus',
          'authorityTier',
          'authorityType',
          'officialLocation',
          'applicabilityBoundary',
          'licensingBoundary',
          'modelContextPolicy',
          'usageRightsReference',
          'locatorContexts',
          'mappingContextAvailable'
        ],
        properties: {
          sourceHandle: nonEmpty,
          sourceId: nonEmpty,
          versionOrDate: nonEmpty,
          verificationStatus: { const: 'VERIFIED' },
          lastVerifiedDate: nonEmpty,
          effectiveStatus: { enum: ['IN_FORCE', 'PUBLISHED'] },
          authorityTier: nonEmpty,
          authorityType: nonEmpty,
          officialLocation: nonEmpty,
          applicabilityBoundary: nonEmpty,
          licensingBoundary: nonEmpty,
          modelContextPolicy: { enum: ['METADATA_LOCATOR_ONLY', 'BOUNDED_SNIPPET_ALLOWED'] },
          usageRightsReference: { type: ['string', 'null'] },
          locatorContexts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['locatorHandle', 'exactLocator', 'locatorLabel', 'contextMode', 'contextText', 'contextSha256'],
              properties: {
                locatorHandle: { type: 'string', pattern: '^locator_[0-9]{3}$' },
                exactLocator: nonEmpty,
                locatorLabel: { type: ['string', 'null'] },
                contextMode: { enum: ['LOCATOR_METADATA_ONLY', 'BOUNDED_TEXT_SNIPPET'] },
                contextText: { type: ['string', 'null'] },
                contextSha256: sha256
              }
            }
          },
          mappingContextAvailable: { type: 'boolean' }
        }
      }
    },
    missingContextSourceHandles: { type: 'array', items: { type: 'string' } },
    mappingContextAvailable: { type: 'boolean' },
    packetSha256: sha256
  }
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contractFindings(output: unknown): Finding[] {
  if (!isRecord(output)) return [];
  const findings: Finding[] = [];
  const { packetSha256, ...withoutHash } = output;
  if (typeof packetSha256 === 'string' && packetSha256 !== stableSha256(withoutHash)) {
    findings.push({
      code: 'SOURCE_CONTEXT_PACKET_HASH',
      path: '/packetSha256',
      message: 'Source Context Packet hash does not match the canonical packet bytes.'
    });
  }
  if (!Array.isArray(output.sources)) return findings;

  const sourceHandles = new Set<string>();
  const locatorHandles = new Set<string>();
  output.sources.forEach((source, sourceIndex) => {
    if (!isRecord(source)) return;
    const handle = typeof source.sourceHandle === 'string' ? source.sourceHandle : '';
    if (handle && sourceHandles.has(handle)) {
      findings.push({
        code: 'SOURCE_CONTEXT_DUPLICATE_SOURCE',
        path: `/sources/${sourceIndex}/sourceHandle`,
        message: 'Source Context Packet contains duplicate source handles.'
      });
    }
    sourceHandles.add(handle);
    for (const field of ['authorityTier', 'authorityType'] as const) {
      if (typeof source[field] === 'string' && source[field].trim().length === 0) {
        findings.push({
          code: 'SOURCE_CONTEXT_AUTHORITY_METADATA',
          path: `/sources/${sourceIndex}/${field}`,
          message: `${handle || 'source'} is missing authority metadata.`
        });
      }
    }
    for (const field of ['officialLocation', 'applicabilityBoundary', 'licensingBoundary'] as const) {
      if (typeof source[field] === 'string' && source[field].trim().length === 0) {
        findings.push({
          code: 'SOURCE_CONTEXT_BOUNDARY_METADATA',
          path: `/sources/${sourceIndex}/${field}`,
          message: `${handle || 'source'} is missing source-governance boundary metadata.`
        });
      }
    }
    if (
      source.authorityType === 'PUBLISHED_STANDARD' &&
      source.modelContextPolicy === 'BOUNDED_SNIPPET_ALLOWED' &&
      !(typeof source.usageRightsReference === 'string' && source.usageRightsReference.trim().length > 0)
    ) {
      findings.push({
        code: 'SOURCE_CONTEXT_USAGE_RIGHTS',
        path: `/sources/${sourceIndex}/usageRightsReference`,
        message: `${handle || 'source'} exposes published-standard text without explicit usage rights.`
      });
    }
    const locators = Array.isArray(source.locatorContexts) ? source.locatorContexts : [];
    if (
      typeof source.mappingContextAvailable === 'boolean' &&
      source.mappingContextAvailable !== (locators.length > 0)
    ) {
      findings.push({
        code: 'SOURCE_CONTEXT_MAPPING_FLAG',
        path: `/sources/${sourceIndex}/mappingContextAvailable`,
        message: `${handle || 'source'} mappingContextAvailable does not match locator availability.`
      });
    }
    locators.forEach((locator, locatorIndex) => {
      if (!isRecord(locator)) return;
      const locatorHandle = typeof locator.locatorHandle === 'string' ? locator.locatorHandle : '';
      if (locatorHandle && locatorHandles.has(locatorHandle)) {
        findings.push({
          code: 'SOURCE_CONTEXT_DUPLICATE_LOCATOR',
          path: `/sources/${sourceIndex}/locatorContexts/${locatorIndex}/locatorHandle`,
          message: `Duplicate locator handle ${locatorHandle}.`
        });
      }
      if (locatorHandle) locatorHandles.add(locatorHandle);
      if (typeof locator.exactLocator === 'string' && locator.exactLocator.trim().length === 0) {
        findings.push({
          code: 'SOURCE_CONTEXT_EMPTY_LOCATOR',
          path: `/sources/${sourceIndex}/locatorContexts/${locatorIndex}/exactLocator`,
          message: `${locatorHandle || 'locator'} has an empty exact locator.`
        });
      }
      if (source.modelContextPolicy === 'METADATA_LOCATOR_ONLY' && locator.contextText != null) {
        findings.push({
          code: 'SOURCE_CONTEXT_METADATA_ONLY_TEXT',
          path: `/sources/${sourceIndex}/locatorContexts/${locatorIndex}/contextText`,
          message: `${handle || 'source'} contains model-visible text despite metadata-only policy.`
        });
      }
      if (
        typeof source.sourceId === 'string' &&
        typeof source.versionOrDate === 'string' &&
        typeof locator.exactLocator === 'string' &&
        (locator.locatorLabel === null || typeof locator.locatorLabel === 'string') &&
        (locator.contextText === null || typeof locator.contextText === 'string') &&
        typeof locator.contextSha256 === 'string'
      ) {
        const expected = stableSha256({
          sourceId: source.sourceId,
          versionOrDate: source.versionOrDate,
          locator: locator.exactLocator,
          locatorLabel: locator.locatorLabel,
          contextText: locator.contextText
        });
        if (locator.contextSha256 !== expected) {
          findings.push({
            code: 'SOURCE_CONTEXT_CONTEXT_HASH',
            path: `/sources/${sourceIndex}/locatorContexts/${locatorIndex}/contextSha256`,
            message: `${locatorHandle || 'locator'} source-context hash mismatch.`
          });
        }
      }
    });
  });

  const expectedMissing = output.sources
    .filter((item) => isRecord(item) && Array.isArray(item.locatorContexts) && item.locatorContexts.length === 0)
    .map((item) => (item as { sourceHandle: string }).sourceHandle)
    .sort();
  const actualMissing = Array.isArray(output.missingContextSourceHandles)
    ? [...(output.missingContextSourceHandles as unknown[])].sort()
    : [];
  if (JSON.stringify(expectedMissing) !== JSON.stringify(actualMissing)) {
    findings.push({
      code: 'SOURCE_CONTEXT_MISSING_INDEX',
      path: '/missingContextSourceHandles',
      message: 'missingContextSourceHandles does not match sources without locator context.'
    });
  }
  if (
    typeof output.mappingContextAvailable === 'boolean' &&
    output.mappingContextAvailable !==
      output.sources.some((item) => isRecord(item) && Array.isArray(item.locatorContexts) && item.locatorContexts.length > 0)
  ) {
    findings.push({
      code: 'SOURCE_CONTEXT_AGGREGATE_MAPPING',
      path: '/mappingContextAvailable',
      message: 'Source Context Packet aggregate mappingContextAvailable is inconsistent.'
    });
  }
  return findings;
}

export function validateSourceContext(output: unknown, tier: StrictnessTier = 'RELEASE'): ValidationResult {
  return applyTier(schemaFindings(sourceContextSchema, output), contractFindings(output), tier);
}

export function buildSourceContextPrompt(plan: SourceContextPlan): string {
  const contract: PromptContract = {
    contractVersion: 'source-context/v1',
    failureMode: 'FAIL_CLOSED',
    taskType: 'SOURCE_CONTEXT',
    objective:
      'Acquire governed source identity, provenance, context policy, and exact locators allowed by the sealed Authoring Plan. Do not invent locators.',
    lockedInputs: {
      authoring_plan_sha256: plan.planSha256,
      source_register_version: plan.baseline.sourceRegisterVersion,
      source_register_sha256: plan.baseline.sourceRegisterSha256
    },
    allowedReferences: ['SEALED_SOURCE_REGISTER', 'AUTHORING_PLAN'],
    doNot: ['INVENT_LOCATORS', 'FETCH_UNGOVERNED_PASSAGES', 'INCLUDE_PROTECTED_TEXT_WITHOUT_USAGE_RIGHTS'],
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
    validationProfile: ['SOURCE_CONTEXT_PACKET']
  };
  return renderTaskPrompt(contract);
}
