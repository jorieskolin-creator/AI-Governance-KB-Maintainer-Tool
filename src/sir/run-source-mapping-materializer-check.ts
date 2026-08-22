import type { TaskContract } from '../domain/task-contract.js';
import type { SourceContextPacket } from '../orchestration/source-context-packet.js';
import { materializeValidatedSirTaskOutput } from './task-artifact.js';

const packet: SourceContextPacket = {
  packetVersion:'1.0.0',
  pairId:'A2_AP-A2',
  authoringPlanSha256:'plan-hash',
  sourceRegisterVersion:'1.5.0',
  sourceRegisterSha256:'register-hash',
  sources:[{
    sourceHandle:'source_001',
    sourceId:'SRC-EU-AIA',
    versionOrDate:'2024-07-12',
    verificationStatus:'VERIFIED',
    lastVerifiedDate:'2026-08-18',
    effectiveStatus:'IN_FORCE',
    authorityTier:'PRIMARY_BINDING_AUTHORITY',
    authorityType:'LEGISLATION',
    officialLocation:'https://eur-lex.europa.eu/eli/reg/2024/1689/oj',
    applicabilityBoundary:'Apply according to actor role, classification, jurisdiction, use and effective date.',
    licensingBoundary:'Official legislation may be used within bounded context rules.',
    modelContextPolicy:'BOUNDED_SNIPPET_ALLOWED',
    usageRightsReference:null,
    locatorContexts:[{
      locatorHandle:'locator_001',
      exactLocator:'Article 9(2)',
      locatorLabel:'Risk-management process',
      contextMode:'BOUNDED_TEXT_SNIPPET',
      contextText:'Bounded source context for regression.',
      contextSha256:'locator-context-hash'
    }],
    mappingContextAvailable:true
  }],
  missingContextSourceHandles:[],
  mappingContextAvailable:true,
  packetSha256:'packet-hash'
};

function contract(withPacket = true):TaskContract {
  return {
    contractVersion:'2.0.0',
    taskId:'A2_AP-A2:SOURCE_MAPPING:SIR',
    taskType:'SOURCE_MAPPING',
    targetObjectId:'A2_AP-A2',
    objective:'Materializer regression.',
    modelRole:'WORKHORSE',
    upstreamTaskTypes:[],
    lockedInputs:withPacket ? {source_context_packet:packet} : {},
    allowedReferences:[], doNot:[],
    outputContract:{format:'JSON',schemaName:'SirSourceMappingOutput',requiredFields:[],additionalProperties:false},
    validationProfile:[], dependencyPaths:[], failureMode:'FAIL_CLOSED'
  };
}

const semanticOutput = {
  capabilityMappings:[{
    sourceHandle:'source_001',
    locatorHandle:'locator_001',
    relationship:'BINDING_LAW_WHEN_APPLICABLE',
    supportedClaim:'The supplied source context supports a bounded category-specific governance claim.',
    categoryRationale:'The selected locator is relevant to the bounded capability interpretation.',
    applicabilityConditions:['Only when the mapped legal requirement applies to the relevant role and system.'],
    exclusions:['Registration alone does not establish legal applicability or compliance.']
  }],
  antipatternMappings:[],
  unmappedClaims:[],
  mappingNotes:['Factual verification remains a downstream quality gate.']
};

const materialized = materializeValidatedSirTaskOutput(contract(), semanticOutput) as any;
const mapping = materialized.capability?.[0];
if (!mapping) throw new Error('Source mapping was not materialized.');
if (mapping.sourceId !== 'SRC-EU-AIA' || mapping.sourceVersionOrDate !== '2024-07-12') {
  throw new Error('Source identity/version were not materialized from the packet.');
}
if (mapping.exactLocator !== 'Article 9(2)' || mapping.verificationStatus !== 'VERIFIED') {
  throw new Error('Exact locator or verification metadata were not materialized from the packet.');
}
if (mapping.locatorContextSha256 !== 'locator-context-hash') {
  throw new Error('Locator-context provenance hash was not preserved.');
}
if ('mappingId' in mapping || 'mapping_id' in mapping) {
  throw new Error('Canonical source mapping identity must not be created in SIR materialization.');
}
if (materialized.sourceContextPacketSha256 !== 'packet-hash') {
  throw new Error('Persisted source mapping lost Source Context Packet hash provenance.');
}

const wrongLocator = structuredClone(semanticOutput);
wrongLocator.capabilityMappings[0]!.locatorHandle = 'locator_999';
try {
  materializeValidatedSirTaskOutput(contract(), wrongLocator);
  throw new Error('Unknown locator unexpectedly materialized.');
} catch (error) {
  if (error instanceof Error && error.message === 'Unknown locator unexpectedly materialized.') throw error;
}

try {
  materializeValidatedSirTaskOutput(contract(false), semanticOutput);
  throw new Error('SOURCE_MAPPING unexpectedly materialized without a Source Context Packet.');
} catch (error) {
  if (error instanceof Error && error.message === 'SOURCE_MAPPING unexpectedly materialized without a Source Context Packet.') throw error;
}

console.log(JSON.stringify({
  sourceMappingMaterialization:'PASS',
  sourceIdentityFromPacket:'PASS',
  exactLocatorFromPacket:'PASS',
  locatorContextProvenance:'PASS',
  canonicalMappingIdCreation:'PROHIBITED',
  unknownLocatorMaterialization:'REJECTED',
  missingPacketMaterialization:'REJECTED'
}, null, 2));
