import { createSirHandle } from '../sir/handles.js';
import {
  buildAuthoringPlan,
  type AuthoringPlan,
  type AuthoringPlanInput,
  type DomainId
} from '../authoring/authoring-plan.js';
import type { BaselineIdentity } from '../authoring/authoring-plan.js';
import {
  categoryDomain,
  categoryPair,
  loadCategoriesBaseline,
  type CategoriesBaseline
} from '../baseline/categories.js';
import { loadRepoBaselineArtifacts } from '../baseline/repo-artifacts.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { expectedDomainCapabilityIds } from '../orchestration/pipeline.js';
import { buildAllowedSourcePacket } from '../orchestration/source-packet.js';
import type { SourceRegisterBaseline } from '../validation/cross-artifact.js';

export function productionVocabulary(contract: {
  assurance_vocabularies: { technical: string[]; human: string[] };
  conclusion_vocabularies: { capability: string[]; antipattern: string[] };
  lifecycle_policy: { required_stages_in_order: string[] };
}): AuthoringPlanInput['vocabulary'] {
  return {
    technicalAssurance: contract.assurance_vocabularies.technical,
    humanAssurance: contract.assurance_vocabularies.human,
    capabilityConclusionStates: contract.conclusion_vocabularies.capability,
    antipatternConclusionStates: contract.conclusion_vocabularies.antipattern,
    hardGateEffects: ['NONE', 'WARN', 'BLOCK', 'CONSTRAIN'],
    lifecycleStages: contract.lifecycle_policy.required_stages_in_order
  };
}

export function baselineIdentityFromSnapshot(snapshot: BaselineSnapshot): BaselineIdentity {
  const required = (type: string) => {
    const entry = snapshot.manifest.find((item) => item.artifactType === type);
    if (!entry) throw new Error(`Sealed baseline is missing ${type}.`);
    return entry;
  };
  const production = required('PRODUCTION_CONTRACT');
  const capability = required('CAPABILITY_SCHEMA');
  const antipattern = required('ANTIPATTERN_SCHEMA');
  const shared = required('SHARED_DEFINITIONS_SCHEMA');
  const source = required('SOURCE_REGISTER');
  const golden = required('GOLDEN_REFERENCE');
  const tactic = snapshot.manifest.find((item) => item.artifactType === 'TACTIC_CATALOG');

  return {
    baselineSnapshotId: snapshot.id,
    baselineSha256: snapshot.sha256,
    productionContractVersion: production.version,
    productionContractSha256: production.sha256,
    capabilitySchemaVersion: capability.version,
    capabilitySchemaSha256: capability.sha256,
    antipatternSchemaVersion: antipattern.version,
    antipatternSchemaSha256: antipattern.sha256,
    sharedDefinitionsVersion: shared.version,
    sharedDefinitionsSha256: shared.sha256,
    sourceRegisterVersion: source.version,
    sourceRegisterSha256: source.sha256,
    tacticCatalogVersion: tactic?.version ?? null,
    tacticCatalogSha256: tactic?.sha256 ?? null,
    goldenReferenceId: golden.id,
    goldenReferenceVersion: golden.version,
    goldenReferenceSha256: golden.sha256
  };
}

export function buildPairAuthoringPlan(input: {
  domain: DomainId;
  pairId: string;
  snapshot: BaselineSnapshot;
  categories?: CategoriesBaseline;
  targetVersion?: string;
}): AuthoringPlan {
  const artifacts = loadRepoBaselineArtifacts();
  const production = artifacts.find((item) => item.artifactType === 'PRODUCTION_CONTRACT')?.content as {
    version: string;
    assurance_vocabularies: { technical: string[]; human: string[] };
    conclusion_vocabularies: { capability: string[]; antipattern: string[] };
    lifecycle_policy: { required_stages_in_order: string[] };
  };
  const sourceRegister = artifacts.find((item) => item.artifactType === 'SOURCE_REGISTER')
    ?.content as SourceRegisterBaseline & { version: string };
  const categories = input.categories ?? loadCategoriesBaseline();
  const domain = categoryDomain(categories, input.domain);
  const pair = categoryPair(categories, input.pairId);
  const packet = buildAllowedSourcePacket(input.domain, sourceRegister);
  const adjacent = expectedDomainCapabilityIds(input.domain).filter((id) => id !== pair.capabilityId);

  return buildAuthoringPlan({
    identity: {
      capabilityId: pair.capabilityId,
      antipatternId: pair.antipatternId,
      pairId: pair.pairId,
      domain: input.domain,
      domainTitle: domain.title,
      capabilityTitle: pair.capabilityTitle,
      antipatternTitle: pair.antipatternTitle
    },
    targetVersion: input.targetVersion ?? '1.0.0',
    schemaVersion: baselineIdentityFromSnapshot(input.snapshot).capabilitySchemaVersion,
    baseline: baselineIdentityFromSnapshot(input.snapshot),
    questionDimensions: [
      'DEFINITION_AND_INTENT',
      'IMPLEMENTATION_AND_OPERATION',
      'EVIDENCE_AND_EFFECTIVENESS'
    ],
    vocabulary: productionVocabulary(production),
    allowedSources: packet.sources.map((source, index) => ({
      sourceHandle: createSirHandle('source', index + 1),
      sourceId: source.id,
      versionOrDate: source.version_or_date,
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: source.last_verified_date
    })),
    allowedTactics: [],
    adjacentCriteria: adjacent.map((criterionId, index) => {
      const neighbor = categoryPair(categories, `${criterionId}_AP-${criterionId}`);
      return {
        criterionHandle: createSirHandle('criterion', index + 1),
        criterionId,
        boundarySummary: neighbor.capabilityBoundarySummary
      };
    })
  });
}

export function categoryBaselineRecord(): Record<string, unknown> {
  return loadCategoriesBaseline() as unknown as Record<string, unknown>;
}

export function goldenReferenceRecord(): Record<string, unknown> {
  const artifacts = loadRepoBaselineArtifacts();
  const golden = artifacts.find((item) => item.artifactType === 'GOLDEN_REFERENCE');
  if (!golden) throw new Error('Golden reference is missing from the repo baseline.');
  return golden.content as Record<string, unknown>;
}
