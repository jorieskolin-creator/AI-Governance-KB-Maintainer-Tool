import type {
  AtomicDecompositionOutput,
  EvidenceArchitectureOutput,
  EvidenceSafetyOutput,
  PrimaryQuestionsOutput,
  TechnicalAssurance,
  HumanAssurance
} from '../cognitive/content-contracts.js';
import type {
  ApAbsenceContractOutput,
  ApFailureModelOutput,
  ApplicabilityOutput,
  ControlBoundaryOutput,
  FindingArchitectureOutput,
  PairBoundaryOutput,
  PairCoherenceReviewOutput,
  ReferenceMappingOutput,
  SourceMappingOutput
} from '../cognitive/final-pair-contracts.js';
import type { LifecycleAssuranceOutput } from '../cognitive/lifecycle-assurance-contract.js';
import {
  resolveTacticReferences,
  type ApprovedTacticCatalogMapping
} from './tactic-resolver.js';

export interface ApprovalRecordInput {
  approval_status: 'APPROVED';
  approval_scope: string;
  approved_by_role: string;
  approved_on: string;
  effective_from: string;
  review_due_on: string | null;
  release_version: string;
  supersedes: string | null;
  authority_statement: string;
  change_control: string;
}

export interface CanonicalPairMetadata {
  schemaVersion: string;
  domainTitle: string;
  capabilityTitle: string;
  antipatternTitle: string;
  capabilityVersion: string;
  antipatternVersion: string;
  releaseStatus: 'APPROVED' | 'FROZEN';
  capabilityApprovalRecord: ApprovalRecordInput;
  antipatternApprovalRecord: ApprovalRecordInput;
}

export interface CanonicalPairArtifacts {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  applicability: ApplicabilityOutput;
  primaryQuestions: PrimaryQuestionsOutput;
  atomicDecomposition: AtomicDecompositionOutput;
  evidenceArchitecture: EvidenceArchitectureOutput;
  evidenceSafety: EvidenceSafetyOutput;
  apAbsenceContract: ApAbsenceContractOutput;
  sourceMapping: SourceMappingOutput;
  findingArchitecture: FindingArchitectureOutput;
  controlBoundary: ControlBoundaryOutput;
  lifecycleAssurance: LifecycleAssuranceOutput;
  referenceMapping: ReferenceMappingOutput;
  pairCoherenceReview: PairCoherenceReviewOutput;
}

export interface CanonicalPairCompileInput {
  metadata: CanonicalPairMetadata;
  artifacts: CanonicalPairArtifacts;
  approvedTacticCatalog: readonly ApprovedTacticCatalogMapping[] | null;
}

export interface CanonicalPairCompileResult {
  capability: Record<string, unknown>;
  antipattern: Record<string, unknown>;
}

const TECHNICAL_RANK: Record<TechnicalAssurance, number> = {
  UNKNOWN: 0,
  DECLARED: 1,
  IMPLEMENTED: 2,
  TESTED: 3,
  OPERATIONALLY_OBSERVED: 4
};

const HUMAN_RANK: Record<HumanAssurance, number> = {
  PENDING: 0,
  HUMAN_VALIDATED: 1,
  FORMALLY_APPROVED: 2
};

function highestTechnical(values: TechnicalAssurance[]): TechnicalAssurance {
  if (values.length === 0) throw new Error('Cannot derive atomic technical assurance without bound evidence.');
  return values.reduce((highest, value) =>
    TECHNICAL_RANK[value] > TECHNICAL_RANK[highest] ? value : highest
  );
}

function highestHuman(values: HumanAssurance[]): HumanAssurance {
  if (values.length === 0) throw new Error('Cannot derive atomic human assurance without bound evidence.');
  return values.reduce((highest, value) =>
    HUMAN_RANK[value] > HUMAN_RANK[highest] ? value : highest
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function assertPairIdentity(artifacts: CanonicalPairArtifacts): void {
  const capabilityId = artifacts.pairBoundary.capabilityId;
  const antipatternId = artifacts.pairBoundary.antipatternId;
  if (antipatternId !== `AP-${capabilityId}`) {
    throw new Error(`Invalid pair identity ${capabilityId}/${antipatternId}.`);
  }

  const pairBearing = [
    artifacts.applicability,
    artifacts.primaryQuestions,
    artifacts.atomicDecomposition,
    artifacts.evidenceArchitecture,
    artifacts.evidenceSafety,
    artifacts.sourceMapping,
    artifacts.findingArchitecture,
    artifacts.controlBoundary,
    artifacts.lifecycleAssurance,
    artifacts.referenceMapping
  ] as const;

  for (const artifact of pairBearing) {
    if (artifact.capabilityId !== capabilityId || artifact.antipatternId !== antipatternId) {
      throw new Error(`Artifact identity drift detected while compiling ${capabilityId}/${antipatternId}.`);
    }
  }

  if (artifacts.apFailureModel.antipatternId !== antipatternId) {
    throw new Error('AP failure model is bound to a different anti-pattern.');
  }
  if (artifacts.apAbsenceContract.antipatternId !== antipatternId) {
    throw new Error('AP absence contract is bound to a different anti-pattern.');
  }
  if (
    artifacts.pairCoherenceReview.pairId !== artifacts.pairBoundary.pairId ||
    !artifacts.pairCoherenceReview.passed ||
    artifacts.pairCoherenceReview.defects.length > 0
  ) {
    throw new Error('Canonical compilation requires a defect-free passed pair-coherence review.');
  }
}

function assertApproval(metadata: CanonicalPairMetadata): void {
  if (metadata.capabilityApprovalRecord.release_version !== metadata.capabilityVersion) {
    throw new Error('Capability approval record release_version does not match capability version.');
  }
  if (metadata.antipatternApprovalRecord.release_version !== metadata.antipatternVersion) {
    throw new Error('Anti-pattern approval record release_version does not match anti-pattern version.');
  }
}

function evidenceRequirement(item: EvidenceArchitectureOutput['capabilityEvidence'][number]) {
  return {
    id: item.id,
    title: item.title,
    claim_supported: item.claimSupported,
    evidence_class: item.evidenceClass,
    minimum_technical_assurance: item.minimumTechnicalAssurance,
    required_human_assurance: item.requiredHumanAssurance,
    acceptance_conditions: item.acceptanceConditions,
    limitations: item.limitations
  };
}

function evidenceRules(item: EvidenceSafetyOutput['capabilityRules']) {
  return {
    evidence_ceilings: item.evidenceCeilings,
    false_positive_guards: item.falsePositiveGuards,
    prohibited_inferences: item.prohibitedInferences,
    contradiction_handling: item.contradictionHandling,
    freshness_rules: item.freshnessRules
  };
}

function sourceMapping(item: SourceMappingOutput['capabilityMappings'][number]) {
  return {
    mapping_id: item.mappingId,
    source_id: item.sourceId,
    source_version_or_date: item.sourceVersionOrDate,
    exact_locator: item.exactLocator,
    relationship: item.relationship,
    supported_claim: item.supportedClaim,
    category_rationale: item.categoryRationale,
    applicability_conditions: item.applicabilityConditions,
    exclusions: item.exclusions,
    verification_status: item.verificationStatus,
    last_verified_date: item.lastVerifiedDate
  };
}

function finding(item: FindingArchitectureOutput['capabilityFindings'][number]) {
  return {
    id: item.id,
    title: item.title,
    eligible_conclusion_states: item.eligibleConclusionStates,
    mapped_atomic_item_ids: item.mappedAtomicItemIds,
    required_evidence_ids: item.requiredEvidenceIds,
    default_severity: item.defaultSeverity,
    lifecycle_consequence: item.lifecycleConsequence,
    human_lock_required: item.humanLockRequired
  };
}

function hardGate(item: ControlBoundaryOutput['capabilityHardGate']) {
  return {
    effect: item.effect,
    conditions: item.conditions,
    override_authority: item.overrideAuthority
  };
}

function runtimeBoundary(item: ControlBoundaryOutput['capabilityRuntimeBoundary']) {
  return {
    machine_may: item.machineMay,
    machine_must_not: item.machineMustNot,
    human_authority_required_for: item.humanAuthorityRequiredFor
  };
}

function lifecycleTargets(items: LifecycleAssuranceOutput['capabilityTargets']) {
  return items.map((item) => ({
    lifecycle_stage: item.lifecycleStage,
    minimum_technical_assurance: item.minimumTechnicalAssurance,
    required_human_assurance: item.requiredHumanAssurance
  }));
}

function capabilityAtomicItems(
  atomic: AtomicDecompositionOutput,
  evidence: EvidenceArchitectureOutput
) {
  const evidenceById = new Map(evidence.capabilityEvidence.map((item) => [item.id, item]));
  const bindingByAtomic = new Map(evidence.capabilityBindings.map((item) => [item.atomicItemId, item]));

  return atomic.capabilitySubcriteria.map((item) => {
    const binding = bindingByAtomic.get(item.id);
    if (!binding) throw new Error(`Missing capability evidence binding for ${item.id}.`);
    const requirements = binding.evidenceIds.map((id) => {
      const requirement = evidenceById.get(id);
      if (!requirement) throw new Error(`Unknown capability evidence ${id} bound to ${item.id}.`);
      return requirement;
    });
    return {
      id: item.id,
      question_id: item.questionId,
      criterion: item.criterion,
      required_evidence_ids: binding.evidenceIds,
      minimum_technical_assurance: highestTechnical(
        requirements.map((requirement) => requirement.minimumTechnicalAssurance)
      ),
      required_human_assurance: highestHuman(
        requirements.map((requirement) => requirement.requiredHumanAssurance)
      )
    };
  });
}

function antipatternAtomicItems(
  atomic: AtomicDecompositionOutput,
  evidence: EvidenceArchitectureOutput
) {
  const evidenceById = new Map(evidence.antipatternEvidence.map((item) => [item.id, item]));
  const bindingByAtomic = new Map(evidence.antipatternBindings.map((item) => [item.atomicItemId, item]));

  return atomic.antipatternTests.map((item) => {
    const binding = bindingByAtomic.get(item.id);
    if (!binding) throw new Error(`Missing anti-pattern evidence binding for ${item.id}.`);
    const requirements = binding.evidenceIds.map((id) => {
      const requirement = evidenceById.get(id);
      if (!requirement) throw new Error(`Unknown anti-pattern evidence ${id} bound to ${item.id}.`);
      return requirement;
    });
    return {
      id: item.id,
      question_id: item.questionId,
      test: item.test,
      required_evidence_ids: binding.evidenceIds,
      minimum_technical_assurance: highestTechnical(
        requirements.map((requirement) => requirement.minimumTechnicalAssurance)
      ),
      required_human_assurance: highestHuman(
        requirements.map((requirement) => requirement.requiredHumanAssurance)
      )
    };
  });
}

export function compileCanonicalPair(input: CanonicalPairCompileInput): CanonicalPairCompileResult {
  const { metadata, artifacts } = input;
  assertPairIdentity(artifacts);
  assertApproval(metadata);

  if (artifacts.sourceMapping.unmappedClaims.length > 0) {
    throw new Error(
      `Canonical compilation blocked by unmapped source claims: ${artifacts.sourceMapping.unmappedClaims.join('; ')}`
    );
  }

  const capabilityId = artifacts.pairBoundary.capabilityId;
  const antipatternId = artifacts.pairBoundary.antipatternId;
  const domain = capabilityId.slice(0, 1);
  const tactics = resolveTacticReferences(artifacts.referenceMapping, input.approvedTacticCatalog);

  const capability: Record<string, unknown> = {
    schema_version: metadata.schemaVersion,
    id: capabilityId,
    version: metadata.capabilityVersion,
    release_status: metadata.releaseStatus,
    approval_record: metadata.capabilityApprovalRecord,
    domain,
    domain_title: metadata.domainTitle,
    object_type: 'CAPABILITY',
    title: metadata.capabilityTitle,
    canonical_definition: artifacts.pairBoundary.capability.canonicalDefinition,
    applicability: {
      statement: artifacts.applicability.capability.statement,
      conditions: artifacts.applicability.capability.conditions,
      exclusions: artifacts.applicability.capability.exclusions,
      reassessment_triggers: artifacts.applicability.capability.reassessmentTriggers
    },
    primary_questions: artifacts.primaryQuestions.capabilityQuestions.map((item) => ({
      id: item.id,
      dimension: item.dimension,
      question: item.question
    })),
    required_evidence: artifacts.evidenceArchitecture.capabilityEvidence.map(evidenceRequirement),
    evidence_rules: evidenceRules(artifacts.evidenceSafety.capabilityRules),
    hard_gate_effect: hardGate(artifacts.controlBoundary.capabilityHardGate),
    normative_source_mappings: artifacts.sourceMapping.capabilityMappings.map(sourceMapping),
    finding_definitions: artifacts.findingArchitecture.capabilityFindings.map(finding),
    candidate_tactic_refs: tactics.capability,
    runtime_decision_boundary: runtimeBoundary(artifacts.controlBoundary.capabilityRuntimeBoundary),
    related_criteria: unique(artifacts.referenceMapping.capabilityRelatedCriteria),
    governance_purpose: artifacts.pairBoundary.capability.governancePurpose,
    distinct_claim: artifacts.pairBoundary.capability.distinctClaim,
    atomic_subcriteria: capabilityAtomicItems(
      artifacts.atomicDecomposition,
      artifacts.evidenceArchitecture
    ),
    target_assurance_by_lifecycle_stage: lifecycleTargets(
      artifacts.lifecycleAssurance.capabilityTargets
    )
  };

  const antipattern: Record<string, unknown> = {
    schema_version: metadata.schemaVersion,
    id: antipatternId,
    version: metadata.antipatternVersion,
    release_status: metadata.releaseStatus,
    approval_record: metadata.antipatternApprovalRecord,
    domain,
    domain_title: metadata.domainTitle,
    object_type: 'ANTIPATTERN',
    title: metadata.antipatternTitle,
    canonical_definition: artifacts.pairBoundary.antipattern.canonicalDefinition,
    applicability: {
      statement: artifacts.applicability.antipattern.statement,
      conditions: artifacts.applicability.antipattern.conditions,
      exclusions: artifacts.applicability.antipattern.exclusions,
      reassessment_triggers: artifacts.applicability.antipattern.reassessmentTriggers
    },
    primary_questions: artifacts.primaryQuestions.antipatternQuestions.map((item) => ({
      id: item.id,
      dimension: item.dimension,
      question: item.question
    })),
    required_evidence: artifacts.evidenceArchitecture.antipatternEvidence.map(evidenceRequirement),
    evidence_rules: evidenceRules(artifacts.evidenceSafety.antipatternRules),
    hard_gate_effect: hardGate(artifacts.controlBoundary.antipatternHardGate),
    normative_source_mappings: artifacts.sourceMapping.antipatternMappings.map(sourceMapping),
    finding_definitions: artifacts.findingArchitecture.antipatternFindings.map(finding),
    candidate_tactic_refs: tactics.antipattern,
    runtime_decision_boundary: runtimeBoundary(artifacts.controlBoundary.antipatternRuntimeBoundary),
    related_criteria: unique(artifacts.referenceMapping.antipatternRelatedCriteria),
    failure_mechanism: artifacts.apFailureModel.failureMechanism,
    atomic_tests: antipatternAtomicItems(
      artifacts.atomicDecomposition,
      artifacts.evidenceArchitecture
    ),
    absence_test_contract: {
      scope_defined: artifacts.apAbsenceContract.scopeDefined,
      executed: artifacts.apAbsenceContract.executed,
      successful: artifacts.apAbsenceContract.successful,
      current: artifacts.apAbsenceContract.current,
      independently_verified: artifacts.apAbsenceContract.independentlyVerified,
      required_artifacts: artifacts.apAbsenceContract.requiredArtifacts
    },
    target_assurance_by_lifecycle_stage: lifecycleTargets(
      artifacts.lifecycleAssurance.antipatternTargets
    )
  };

  return { capability, antipattern };
}
