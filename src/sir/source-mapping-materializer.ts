import type {
  SirSourceMappingCandidate,
  SirSourceMappingOutput,
  SirUnmappedSourceClaim
} from '../cognitive/sir-source-mapping-contract.js';
import type {
  SourceContextPacket,
  SourceContextPacketEntry,
  SourceLocatorContext
} from '../orchestration/source-context-packet.js';
import type { SirHandle } from './model.js';

export interface MaterializedSirSourceMapping {
  sourceHandle: SirHandle;
  locatorHandle: SirHandle;
  sourceId: string;
  sourceVersionOrDate: string;
  exactLocator: string;
  relationship: string;
  supportedClaim: string;
  categoryRationale: string;
  applicabilityConditions: string[];
  exclusions: string[];
  verificationStatus: 'VERIFIED';
  lastVerifiedDate: string;
  authorityTier: string;
  authorityType: string;
  locatorContextSha256: string;
}

export interface MaterializedSirSourceMappings {
  sourceContextPacketSha256: string;
  capability: MaterializedSirSourceMapping[];
  antipattern: MaterializedSirSourceMapping[];
  unmappedClaims: SirUnmappedSourceClaim[];
  mappingNotes: string[];
}

function resolveSource(
  packet: SourceContextPacket,
  sourceHandle: SirHandle
): SourceContextPacketEntry {
  const source = packet.sources.find((item) => item.sourceHandle === sourceHandle);
  if (!source) {
    throw new Error(`Cannot materialize unknown source handle ${sourceHandle}.`);
  }
  return source;
}

function resolveLocator(
  source: SourceContextPacketEntry,
  locatorHandle: SirHandle
): SourceLocatorContext {
  const locator = source.locatorContexts.find((item) => item.locatorHandle === locatorHandle);
  if (!locator) {
    throw new Error(
      `Cannot materialize locator ${locatorHandle}; it is not bound to source ${source.sourceHandle}.`
    );
  }
  return locator;
}

function materialize(
  item: SirSourceMappingCandidate,
  packet: SourceContextPacket
): MaterializedSirSourceMapping {
  const source = resolveSource(packet, item.sourceHandle);
  const locator = resolveLocator(source, item.locatorHandle);

  return {
    sourceHandle: item.sourceHandle,
    locatorHandle: item.locatorHandle,
    sourceId: source.sourceId,
    sourceVersionOrDate: source.versionOrDate,
    exactLocator: locator.exactLocator,
    relationship: item.relationship,
    supportedClaim: item.supportedClaim,
    categoryRationale: item.categoryRationale,
    applicabilityConditions: item.applicabilityConditions,
    exclusions: item.exclusions,
    verificationStatus: source.verificationStatus,
    lastVerifiedDate: source.lastVerifiedDate,
    authorityTier: source.authorityTier,
    authorityType: source.authorityType,
    locatorContextSha256: locator.contextSha256
  };
}

/**
 * Resolves validated local source/locator selections to immutable factual metadata.
 * This is still an SIR artifact: canonical SRCMAP-* identity is intentionally not created here.
 */
export function materializeSirSourceMappings(
  output: SirSourceMappingOutput,
  packet: SourceContextPacket
): MaterializedSirSourceMappings {
  return {
    sourceContextPacketSha256: packet.packetSha256,
    capability: output.capabilityMappings.map((item) => materialize(item, packet)),
    antipattern: output.antipatternMappings.map((item) => materialize(item, packet)),
    unmappedClaims: output.unmappedClaims,
    mappingNotes: output.mappingNotes
  };
}
