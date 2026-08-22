import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { SourceContextPacket } from './source-context-packet.js';
import { verifySourceContextPacket } from './source-context-verifier.js';

interface MaterializedMappingLike {
  sourceHandle?: unknown;
  locatorHandle?: unknown;
  sourceId?: unknown;
  sourceVersionOrDate?: unknown;
  exactLocator?: unknown;
  relationship?: unknown;
  supportedClaim?: unknown;
  categoryRationale?: unknown;
  applicabilityConditions?: unknown;
  exclusions?: unknown;
  verificationStatus?: unknown;
  lastVerifiedDate?: unknown;
  authorityTier?: unknown;
  authorityType?: unknown;
  locatorContextSha256?: unknown;
  mappingId?: unknown;
  mapping_id?: unknown;
}

interface MaterializedSourceMappingsLike {
  sourceContextPacketSha256?: unknown;
  capability?: unknown;
  antipattern?: unknown;
  unmappedClaims?: unknown;
  mappingNotes?: unknown;
}

function nonEmptyString(value:unknown,label:string):string {
  if (typeof value!=='string'||!value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function verifyGroup(
  value:unknown,
  label:'capability'|'antipattern',
  packet:SourceContextPacket
):void {
  if (!Array.isArray(value)) throw new Error(`Materialized Source Mapping ${label} group must be an array.`);
  value.forEach((raw,index)=>{
    if (!raw||typeof raw!=='object'||Array.isArray(raw)) throw new Error(`Materialized Source Mapping ${label}[${index}] must be an object.`);
    const item=raw as MaterializedMappingLike;
    if (item.mappingId!==undefined||item.mapping_id!==undefined) {
      throw new Error(`Materialized Source Mapping ${label}[${index}] contains canonical mapping identity before compilation.`);
    }
    const sourceHandle=nonEmptyString(item.sourceHandle,`${label}[${index}].sourceHandle`);
    const locatorHandle=nonEmptyString(item.locatorHandle,`${label}[${index}].locatorHandle`);
    const source=packet.sources.find((candidate)=>candidate.sourceHandle===sourceHandle);
    if (!source) throw new Error(`Materialized Source Mapping ${label}[${index}] references unknown source handle ${sourceHandle}.`);
    const locator=source.locatorContexts.find((candidate)=>candidate.locatorHandle===locatorHandle);
    if (!locator) throw new Error(`Materialized Source Mapping ${label}[${index}] locator ${locatorHandle} is not bound to ${sourceHandle}.`);

    if (item.sourceId!==source.sourceId) throw new Error(`Materialized Source Mapping ${label}[${index}] sourceId drifted from the Source Context Packet.`);
    if (item.sourceVersionOrDate!==source.versionOrDate) throw new Error(`Materialized Source Mapping ${label}[${index}] source version/date drifted from the Source Context Packet.`);
    if (item.exactLocator!==locator.exactLocator) throw new Error(`Materialized Source Mapping ${label}[${index}] exact locator drifted from the Source Context Packet.`);
    if (item.verificationStatus!==source.verificationStatus) throw new Error(`Materialized Source Mapping ${label}[${index}] verification status drifted from the Source Context Packet.`);
    if (item.lastVerifiedDate!==source.lastVerifiedDate) throw new Error(`Materialized Source Mapping ${label}[${index}] verification date drifted from the Source Context Packet.`);
    if (item.authorityTier!==source.authorityTier||item.authorityType!==source.authorityType) throw new Error(`Materialized Source Mapping ${label}[${index}] authority metadata drifted from the Source Context Packet.`);
    if (item.locatorContextSha256!==locator.contextSha256) throw new Error(`Materialized Source Mapping ${label}[${index}] locator context hash drifted from the Source Context Packet.`);

    nonEmptyString(item.relationship,`${label}[${index}].relationship`);
    nonEmptyString(item.supportedClaim,`${label}[${index}].supportedClaim`);
    nonEmptyString(item.categoryRationale,`${label}[${index}].categoryRationale`);
    if (!Array.isArray(item.applicabilityConditions)||!Array.isArray(item.exclusions)) {
      throw new Error(`Materialized Source Mapping ${label}[${index}] applicability/exclusion fields must be arrays.`);
    }
  });
}

export function verifyMaterializedSourceMappingArtifact(input:{
  output:unknown;
  sourceContextPacket:SourceContextPacket;
  authoringPlan:AuthoringPlan;
}):void {
  verifySourceContextPacket(input.sourceContextPacket,input.authoringPlan);
  if (!input.output||typeof input.output!=='object'||Array.isArray(input.output)) {
    throw new Error('Persisted SOURCE_MAPPING output is not a materialized SIR object.');
  }
  const output=input.output as MaterializedSourceMappingsLike;
  if (output.sourceContextPacketSha256!==input.sourceContextPacket.packetSha256) {
    throw new Error('Persisted SOURCE_MAPPING output is not bound to its Source Context Packet hash.');
  }
  verifyGroup(output.capability,'capability',input.sourceContextPacket);
  verifyGroup(output.antipattern,'antipattern',input.sourceContextPacket);
  if (!Array.isArray(output.unmappedClaims)||!Array.isArray(output.mappingNotes)) {
    throw new Error('Persisted SOURCE_MAPPING output is missing unmappedClaims or mappingNotes arrays.');
  }
}
