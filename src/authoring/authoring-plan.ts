import { createHash } from 'node:crypto';

export type DomainId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type QuestionDimension =
  | 'DEFINITION_AND_INTENT'
  | 'IMPLEMENTATION_AND_OPERATION'
  | 'EVIDENCE_AND_EFFECTIVENESS';

export interface AuthoritativeObjectIdentity {
  capabilityId: string;
  antipatternId: string;
  pairId: string;
  domain: DomainId;
  domainTitle: string;
  capabilityTitle: string;
  antipatternTitle: string;
}

export interface BaselineIdentity {
  baselineSnapshotId: string;
  baselineSha256: string;
  productionContractVersion: string;
  productionContractSha256: string;
  capabilitySchemaVersion: string;
  capabilitySchemaSha256: string;
  antipatternSchemaVersion: string;
  antipatternSchemaSha256: string;
  sharedDefinitionsVersion: string;
  sharedDefinitionsSha256: string;
  sourceRegisterVersion: string;
  sourceRegisterSha256: string;
  tacticCatalogVersion: string | null;
  tacticCatalogSha256: string | null;
  goldenReferenceId: string;
  goldenReferenceVersion: string;
  goldenReferenceSha256: string;
}

export interface FixedQuestionSlot {
  slot: 1 | 2 | 3;
  dimension: QuestionDimension;
}

export interface AllowedSourceRef {
  sourceHandle: string;
  sourceId: string;
  versionOrDate: string;
  verificationStatus: 'VERIFIED';
  lastVerifiedDate: string;
}

export interface AllowedTacticRef {
  tacticHandle: string;
  tacticId: string;
  tacticVersion: string;
  catalogVersion: string;
}

export interface AdjacentCriterionRef {
  criterionHandle: string;
  criterionId: string;
  boundarySummary: string;
}

export interface GovernedVocabulary {
  technicalAssurance: string[];
  humanAssurance: string[];
  capabilityConclusionStates: string[];
  antipatternConclusionStates: string[];
  hardGateEffects: string[];
  lifecycleStages: string[];
}

export interface AuthoringPlanInput {
  identity: AuthoritativeObjectIdentity;
  targetVersion: string;
  schemaVersion: string;
  baseline: BaselineIdentity;
  questionDimensions: [QuestionDimension, QuestionDimension, QuestionDimension];
  vocabulary: GovernedVocabulary;
  allowedSources: AllowedSourceRef[];
  allowedTactics: AllowedTacticRef[];
  adjacentCriteria: AdjacentCriterionRef[];
}

export interface AuthoringPlan {
  planVersion: '1.0.0';
  planId: string;
  planSha256: string;
  identity: AuthoritativeObjectIdentity;
  targetVersion: string;
  schemaVersion: string;
  baseline: BaselineIdentity;
  fixedQuestionSlots: [FixedQuestionSlot, FixedQuestionSlot, FixedQuestionSlot];
  vocabulary: GovernedVocabulary;
  sourceUniverse: AllowedSourceRef[];
  tacticUniverse: AllowedTacticRef[];
  adjacentCriteria: AdjacentCriterionRef[];
  compilerPolicies: {
    canonicalIdsFromModelOutputAllowed: false;
    canonicalReferencesFromModelOutputAllowed: false;
    canonicalRootMetadataFromModelOutputAllowed: false;
    semanticCollectionDepthMayBeDynamic: true;
    canonicalSerializationOwnedByCompiler: true;
    approvalFactsOwnedByExternalHuman: true;
  };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function assertUniqueHandles(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} handles must be unique.`);
  }
}

function assertPairIdentity(identity: AuthoritativeObjectIdentity): void {
  if (!/^[A-F][1-5]$/.test(identity.capabilityId)) {
    throw new Error(`Invalid capability ID ${identity.capabilityId}.`);
  }
  if (identity.antipatternId !== `AP-${identity.capabilityId}`) {
    throw new Error(`Anti-pattern ID ${identity.antipatternId} does not pair with ${identity.capabilityId}.`);
  }
  if (identity.pairId !== `${identity.capabilityId}_${identity.antipatternId}`) {
    throw new Error(`Pair ID ${identity.pairId} is not deterministic for the supplied pair.`);
  }
  if (identity.domain !== identity.capabilityId.slice(0, 1)) {
    throw new Error(`Domain ${identity.domain} does not match ${identity.capabilityId}.`);
  }
}

function assertTacticCatalogBinding(input: AuthoringPlanInput): void {
  const hasVersion = input.baseline.tacticCatalogVersion !== null;
  const hasHash = input.baseline.tacticCatalogSha256 !== null;
  if (hasVersion !== hasHash) {
    throw new Error('Tactic Catalog version and SHA-256 must either both be present or both be null.');
  }
  if (!hasVersion && input.allowedTactics.length > 0) {
    throw new Error('Allowed tactic universe must be empty when no sealed Tactic Catalog identity is present.');
  }
  if (hasVersion) {
    for (const tactic of input.allowedTactics) {
      if (tactic.catalogVersion !== input.baseline.tacticCatalogVersion) {
        throw new Error(
          `Allowed tactic ${tactic.tacticId}@${tactic.tacticVersion} belongs to catalog ${tactic.catalogVersion}; expected ${String(input.baseline.tacticCatalogVersion)}.`
        );
      }
    }
  }
}

export function validateAuthoringPlanInput(input: AuthoringPlanInput): void {
  assertPairIdentity(input.identity);

  const expectedDimensions: QuestionDimension[] = [
    'DEFINITION_AND_INTENT',
    'IMPLEMENTATION_AND_OPERATION',
    'EVIDENCE_AND_EFFECTIVENESS'
  ];
  if (input.questionDimensions.some((value, index) => value !== expectedDimensions[index])) {
    throw new Error('Primary-question dimensions must match the governed order.');
  }

  if (input.schemaVersion !== input.baseline.capabilitySchemaVersion) {
    throw new Error('Authoring schema version must match the sealed capability schema version.');
  }
  if (input.schemaVersion !== input.baseline.antipatternSchemaVersion) {
    throw new Error('Capability and anti-pattern must be authored against the same active schema family.');
  }
  if (input.schemaVersion !== input.baseline.sharedDefinitionsVersion) {
    throw new Error('Shared-definitions version must match the active pair schema family.');
  }

  if (input.vocabulary.lifecycleStages.length === 0) {
    throw new Error('Normative lifecycle-stage vocabulary must not be empty.');
  }
  if (new Set(input.vocabulary.lifecycleStages).size !== input.vocabulary.lifecycleStages.length) {
    throw new Error('Normative lifecycle-stage vocabulary must be unique and ordered.');
  }

  assertUniqueHandles(input.allowedSources.map((item) => item.sourceHandle), 'Source');
  assertUniqueHandles(input.allowedTactics.map((item) => item.tacticHandle), 'Tactic');
  assertUniqueHandles(input.adjacentCriteria.map((item) => item.criterionHandle), 'Adjacent criterion');
  assertTacticCatalogBinding(input);

  const sourceIds = input.allowedSources.map((item) => item.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('Allowed source universe must not contain duplicate source IDs.');
  }

  const tacticKeys = input.allowedTactics.map((item) => `${item.tacticId}@${item.tacticVersion}`);
  if (new Set(tacticKeys).size !== tacticKeys.length) {
    throw new Error('Allowed tactic universe must not contain duplicate tactic versions.');
  }
}

export function buildAuthoringPlan(input: AuthoringPlanInput): AuthoringPlan {
  validateAuthoringPlanInput(input);

  const withoutHash: Omit<AuthoringPlan, 'planSha256'> = {
    planVersion: '1.0.0',
    planId: `${input.identity.pairId}:authoring-plan:${input.targetVersion}`,
    identity: input.identity,
    targetVersion: input.targetVersion,
    schemaVersion: input.schemaVersion,
    baseline: input.baseline,
    fixedQuestionSlots: [
      { slot: 1, dimension: input.questionDimensions[0] },
      { slot: 2, dimension: input.questionDimensions[1] },
      { slot: 3, dimension: input.questionDimensions[2] }
    ],
    vocabulary: input.vocabulary,
    sourceUniverse: [...input.allowedSources].sort((a, b) => a.sourceHandle.localeCompare(b.sourceHandle)),
    tacticUniverse: [...input.allowedTactics].sort((a, b) => a.tacticHandle.localeCompare(b.tacticHandle)),
    adjacentCriteria: [...input.adjacentCriteria].sort((a, b) =>
      a.criterionHandle.localeCompare(b.criterionHandle)
    ),
    compilerPolicies: {
      canonicalIdsFromModelOutputAllowed: false,
      canonicalReferencesFromModelOutputAllowed: false,
      canonicalRootMetadataFromModelOutputAllowed: false,
      semanticCollectionDepthMayBeDynamic: true,
      canonicalSerializationOwnedByCompiler: true,
      approvalFactsOwnedByExternalHuman: true
    }
  };

  return { ...withoutHash, planSha256: sha256(withoutHash) };
}

export function verifyAuthoringPlan(plan: AuthoringPlan): void {
  const { planSha256, ...withoutHash } = plan;
  const expected = sha256(withoutHash);
  if (planSha256 !== expected) {
    throw new Error(`Authoring Plan hash mismatch: expected ${expected}, received ${planSha256}.`);
  }
  validateAuthoringPlanInput({
    identity: plan.identity,
    targetVersion: plan.targetVersion,
    schemaVersion: plan.schemaVersion,
    baseline: plan.baseline,
    questionDimensions: [
      plan.fixedQuestionSlots[0].dimension,
      plan.fixedQuestionSlots[1].dimension,
      plan.fixedQuestionSlots[2].dimension
    ],
    vocabulary: plan.vocabulary,
    allowedSources: plan.sourceUniverse,
    allowedTactics: plan.tacticUniverse,
    adjacentCriteria: plan.adjacentCriteria
  });
}
