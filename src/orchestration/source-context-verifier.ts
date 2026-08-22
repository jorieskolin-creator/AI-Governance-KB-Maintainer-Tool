import { createHash } from 'node:crypto';
import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { SourceContextPacket } from './source-context-packet.js';

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

export function verifySourceContextPacket(packet: SourceContextPacket, plan: AuthoringPlan): void {
  if (packet.packetVersion !== '1.0.0') {
    throw new Error(`Unsupported Source Context Packet version ${packet.packetVersion}.`);
  }
  if (packet.pairId !== plan.identity.pairId) {
    throw new Error(`Source Context Packet pair ${packet.pairId} does not match ${plan.identity.pairId}.`);
  }
  if (packet.authoringPlanSha256 !== plan.planSha256) {
    throw new Error('Source Context Packet belongs to a different Authoring Plan.');
  }
  if (packet.sourceRegisterVersion !== plan.baseline.sourceRegisterVersion) {
    throw new Error('Source Context Packet Source Register version differs from the Authoring Plan.');
  }
  if (packet.sourceRegisterSha256 !== plan.baseline.sourceRegisterSha256) {
    throw new Error('Source Context Packet Source Register hash differs from the Authoring Plan.');
  }

  const { packetSha256, ...withoutHash } = packet;
  const expectedHash = sha256(withoutHash);
  if (packetSha256 !== expectedHash) {
    throw new Error(`Source Context Packet hash mismatch: expected ${expectedHash}, received ${packetSha256}.`);
  }

  const planByHandle = new Map(plan.sourceUniverse.map((item) => [item.sourceHandle, item]));
  const packetHandles = packet.sources.map((item) => item.sourceHandle);
  if (new Set(packetHandles).size !== packetHandles.length) {
    throw new Error('Source Context Packet contains duplicate source handles.');
  }
  if (packet.sources.length !== plan.sourceUniverse.length) {
    throw new Error('Source Context Packet does not contain the complete Authoring Plan source universe.');
  }

  const allLocatorHandles = new Set<string>();
  for (const source of packet.sources) {
    const planned = planByHandle.get(source.sourceHandle);
    if (!planned) {
      throw new Error(`${source.sourceHandle} is not present in the Authoring Plan source universe.`);
    }
    if (
      source.sourceId !== planned.sourceId ||
      source.versionOrDate !== planned.versionOrDate ||
      source.verificationStatus !== planned.verificationStatus ||
      source.lastVerifiedDate !== planned.lastVerifiedDate
    ) {
      throw new Error(`${source.sourceHandle} metadata drifted from the Authoring Plan.`);
    }
    if (!['IN_FORCE', 'PUBLISHED'].includes(source.effectiveStatus)) {
      throw new Error(`${source.sourceHandle} is not decision-eligible.`);
    }
    if (!source.authorityTier.trim() || !source.authorityType.trim()) {
      throw new Error(`${source.sourceHandle} is missing authority metadata.`);
    }
    if (!source.officialLocation.trim() || !source.applicabilityBoundary.trim() || !source.licensingBoundary.trim()) {
      throw new Error(`${source.sourceHandle} is missing source-governance boundary metadata.`);
    }
    if (
      source.authorityType === 'PUBLISHED_STANDARD' &&
      source.modelContextPolicy === 'BOUNDED_SNIPPET_ALLOWED' &&
      !source.usageRightsReference?.trim()
    ) {
      throw new Error(`${source.sourceHandle} exposes published-standard text without explicit usage rights.`);
    }

    for (const locator of source.locatorContexts) {
      if (!/^locator_[0-9]{3}$/.test(locator.locatorHandle)) {
        throw new Error(`${String(locator.locatorHandle)} is not a governed deterministic locator handle.`);
      }
      if (allLocatorHandles.has(locator.locatorHandle)) {
        throw new Error(`Duplicate locator handle ${locator.locatorHandle}.`);
      }
      allLocatorHandles.add(locator.locatorHandle);
      if (!locator.exactLocator.trim()) {
        throw new Error(`${locator.locatorHandle} has an empty exact locator.`);
      }
      if (source.modelContextPolicy === 'METADATA_LOCATOR_ONLY' && locator.contextText !== null) {
        throw new Error(`${source.sourceHandle} contains model-visible text despite metadata-only policy.`);
      }
      const expectedContextHash = sha256({
        sourceId: source.sourceId,
        versionOrDate: source.versionOrDate,
        locator: locator.exactLocator,
        locatorLabel: locator.locatorLabel,
        contextText: locator.contextText
      });
      if (locator.contextSha256 !== expectedContextHash) {
        throw new Error(`${locator.locatorHandle} source-context hash mismatch.`);
      }
    }

    if (source.mappingContextAvailable !== (source.locatorContexts.length > 0)) {
      throw new Error(`${source.sourceHandle} mappingContextAvailable does not match locator availability.`);
    }
  }

  const expectedMissing = packet.sources
    .filter((item) => item.locatorContexts.length === 0)
    .map((item) => item.sourceHandle)
    .sort();
  const actualMissing = [...packet.missingContextSourceHandles].sort();
  if (JSON.stringify(expectedMissing) !== JSON.stringify(actualMissing)) {
    throw new Error('Source Context Packet missing-context index is inconsistent with source entries.');
  }
  if (packet.mappingContextAvailable !== packet.sources.some((item) => item.locatorContexts.length > 0)) {
    throw new Error('Source Context Packet aggregate mappingContextAvailable is inconsistent.');
  }
}
