import type { TaskContract } from '../domain/task-contract.js';
import type { PairBoundaryOutput, ApFailureModelOutput, ApplicabilityOutput } from './initial-contracts.js';
import type {
  PrimaryQuestionsOutput,
  AtomicDecompositionOutput,
  EvidenceArchitectureOutput,
  EvidenceSafetyOutput
} from './content-contracts.js';

export interface ApAbsenceContractOutput {
  antipatternId: string;
  scopeDefined: true;
  executed: true;
  successful: true;
  current: true;
  independentlyVerified: true;
  requiredArtifacts: string[];
  interpretationBoundary: string;
}

export interface SourceMappingDraft {
  mappingId: string;
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
}

export interface SourceMappingOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityMappings: SourceMappingDraft[];
  antipatternMappings: SourceMappingDraft[];
  unmappedClaims: string[];
}

export interface FindingDraft {
  id: string;
  title: string;
  eligibleConclusionStates: string[];
  mappedAtomicItemIds: string[];
  requiredEvidenceIds: string[];
  defaultSeverity: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';
  lifecycleConsequence: string;
  humanLockRequired: boolean;
}

export interface FindingArchitectureOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityFindings: FindingDraft[];
  antipatternFindings: FindingDraft[];
  findingLogicNotes: string[];
}

export interface RuntimeBoundaryDraft {
  machineMay: string[];
  machineMustNot: string[];
  humanAuthorityRequiredFor: string[];
}

export interface HardGateDraft {
  effect: 'NONE' | 'WARN' | 'BLOCK' | 'CONSTRAIN';
  conditions: string[];
  overrideAuthority: string | null;
}

export interface ControlBoundaryOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityHardGate: HardGateDraft;
  antipatternHardGate: HardGateDraft;
  capabilityRuntimeBoundary: RuntimeBoundaryDraft;
  antipatternRuntimeBoundary: RuntimeBoundaryDraft;
  controlNotes: string[];
}

export interface ReferenceMappingOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityRelatedCriteria: string[];
  antipatternRelatedCriteria: string[];
  capabilityTacticRefs: string[];
  antipatternTacticRefs: string[];
  unresolvedTacticNeeds: string[];
}

export interface PairCoherenceDefect {
  defectId: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';
  affectedPaths: string[];
  issue: string;
  violatedRule: string;
  recommendedRepairScope: string[];
}

export interface PairCoherenceReviewOutput {
  pairId: string;
  passed: boolean;
  defects: PairCoherenceDefect[];
  coherenceSummary: string;
}

interface CommonPairArtifacts {
  pairBoundary: PairBoundaryOutput;
  apFailureModel: ApFailureModelOutput;
  applicability: ApplicabilityOutput;
  primaryQuestions: PrimaryQuestionsOutput;
  atomicDecomposition: AtomicDecompositionOutput;
  evidenceArchitecture: EvidenceArchitectureOutput;
  evidenceSafety: EvidenceSafetyOutput;
}

export interface ApAbsenceContractSeed extends CommonPairArtifacts {
  goldenStandardAbsenceRules: Record<string, unknown>;
}

export interface SourceMappingSeed extends CommonPairArtifacts {
  apAbsenceContract: ApAbsenceContractOutput;
  sealedSourceRegister: Record<string, unknown>;
  allowedSourceSubset: Record<string, unknown>[];
  goldenStandardSourceRules: Record<string, unknown>;
}

export interface FindingArchitectureSeed extends SourceMappingSeed {
  sourceMapping: SourceMappingOutput;
  goldenStandardFindingRules: Record<string, unknown>;
}

export interface ControlBoundarySeed extends FindingArchitectureSeed {
  findingArchitecture: FindingArchitectureOutput;
  goldenStandardControlRules: Record<string, unknown>;
}

export interface ReferenceMappingSeed extends ControlBoundarySeed {
  controlBoundary: ControlBoundaryOutput;
  adjacentCriteria: Record<string, unknown>[];
  approvedTacticCatalog: Record<string, unknown> | null;
  goldenStandardReferenceRules: Record<string, unknown>;
}

export interface PairCoherenceReviewSeed extends ReferenceMappingSeed {
  referenceMapping: ReferenceMappingOutput;
  goldenStandardPairRules: Record<string, unknown>;
}

const CONTRACT_VERSION = '1.0.0';

export function buildApAbsenceContract(seed: ApAbsenceContractSeed): TaskContract<ApAbsenceContractOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:AP_ABSENCE_CONTRACT`,
    taskType: 'AP_ABSENCE_CONTRACT',
    targetObjectId: seed.pairBoundary.antipatternId,
    objective: 'Define the mandatory conditions and artifacts that must all be satisfied before the anti-pattern may be concluded TESTED_ABSENT. This task defines the knowledge contract only; it does not assess any real system.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS','ATOMIC_DECOMPOSITION','EVIDENCE_ARCHITECTURE','EVIDENCE_SAFETY'],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      primary_questions: seed.primaryQuestions,
      atomic_decomposition: seed.atomicDecomposition,
      evidence_architecture: seed.evidenceArchitecture,
      evidence_safety: seed.evidenceSafety,
      golden_standard_absence_rules: seed.goldenStandardAbsenceRules
    },
    allowedReferences: ['VALIDATED_PAIR_ARTIFACTS_THROUGH_EVIDENCE_SAFETY','GOLDEN_STANDARD'],
    doNot: [
      'Do not conclude that the anti-pattern is absent for any real system.',
      'Do not weaken any required boolean condition below true.',
      'Do not treat lack of discovered evidence as successful absence testing.',
      'Do not rewrite evidence, atomic tests, applicability or failure mechanism.',
      'Do not create source mappings, findings, controls or tactics.'
    ],
    outputContract: { format:'JSON', schemaName:'ApAbsenceContractOutput', requiredFields:['antipatternId','scopeDefined','executed','successful','current','independentlyVerified','requiredArtifacts','interpretationBoundary'], additionalProperties:false },
    validationProfile: ['ANTIPATTERN_ID_MATCH','ALL_ABSENCE_CONDITIONS_CONST_TRUE','REQUIRED_ARTIFACTS_NONEMPTY','NO_SILENCE_EQUALS_ABSENCE'],
    dependencyPaths: ['antipattern.absence_test_contract'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildSourceMappingContract(seed: SourceMappingSeed): TaskContract<SourceMappingOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:SOURCE_MAPPING`,
    taskType: 'SOURCE_MAPPING',
    targetObjectId: seed.pairBoundary.pairId,
    objective: 'Map only decision-eligible sources from the sealed source-register subset to specific category claims using exact locators, supported claims, relationship, rationale, applicability conditions and exclusions. Report unsupported claims instead of inventing sources or locators.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: ['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS','ATOMIC_DECOMPOSITION','EVIDENCE_ARCHITECTURE','EVIDENCE_SAFETY','AP_ABSENCE_CONTRACT'],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      ap_failure_model: seed.apFailureModel,
      applicability: seed.applicability,
      primary_questions: seed.primaryQuestions,
      atomic_decomposition: seed.atomicDecomposition,
      evidence_architecture: seed.evidenceArchitecture,
      evidence_safety: seed.evidenceSafety,
      ap_absence_contract: seed.apAbsenceContract,
      sealed_source_register: seed.sealedSourceRegister,
      allowed_source_subset: seed.allowedSourceSubset,
      golden_standard_source_rules: seed.goldenStandardSourceRules
    },
    allowedReferences: ['VALIDATED_PAIR_ARTIFACTS','SEALED_SOURCE_REGISTER_SUBSET','GOLDEN_STANDARD'],
    doNot: [
      'Do not introduce a source ID that is absent from the sealed allowed source subset.',
      'Do not invent or generalize exact locators.',
      'Do not map a source merely because its register domain coverage includes the category domain.',
      'Do not infer legal applicability, compliance, control satisfaction or decision authority from registration.',
      'Do not combine multiple publications behind one mapping.',
      'For licensed standards, use only permitted metadata and locator information unless explicit rights are supplied.',
      'If a claim is not supportable from the allowed subset, place it in unmappedClaims.'
    ],
    outputContract: { format:'JSON', schemaName:'SourceMappingOutput', requiredFields:['capabilityId','antipatternId','capabilityMappings','antipatternMappings','unmappedClaims'], additionalProperties:false },
    validationProfile: ['IDS_MATCH','SOURCE_IDS_REGISTERED_AND_ALLOWED','SOURCE_RECORDS_VERIFIED','EXACT_LOCATOR_NON_GENERIC','VERSION_AND_VERIFICATION_MATCH_REGISTER','SUPPORTED_CLAIM_AND_RATIONALE_PRESENT','NO_REGISTRATION_EQUALS_COMPLIANCE'],
    dependencyPaths: ['capability.normative_source_mappings','antipattern.normative_source_mappings'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildFindingArchitectureContract(seed: FindingArchitectureSeed): TaskContract<FindingArchitectureOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:FINDING_ARCHITECTURE`,
    taskType: 'FINDING_ARCHITECTURE',
    targetObjectId: seed.pairBoundary.pairId,
    objective: 'Define only findings that are traceable to validated atomic items and required evidence. Findings must respect evidence ceilings and the anti-pattern absence contract, and must not raise assurance or infer unsupported legal conclusions.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS','ATOMIC_DECOMPOSITION','EVIDENCE_ARCHITECTURE','EVIDENCE_SAFETY','AP_ABSENCE_CONTRACT','SOURCE_MAPPING'],
    lockedInputs: { ...seed, sealedSourceRegister: undefined, allowedSourceSubset: undefined, goldenStandardSourceRules: undefined },
    allowedReferences: ['VALIDATED_ATOMIC_DECOMPOSITION','VALIDATED_EVIDENCE_ARCHITECTURE','VALIDATED_EVIDENCE_SAFETY','VALIDATED_AP_ABSENCE_CONTRACT','VALIDATED_SOURCE_MAPPING','GOLDEN_STANDARD'],
    doNot: [
      'Do not create a finding that references nonexistent atomic items or evidence IDs.',
      'Do not permit TESTED_ABSENT unless the validated absence contract is satisfied by assessment-time evidence.',
      'Do not treat source registration or document presence as finding satisfaction.',
      'Do not create source mappings, controls, tactics or approvals.',
      'Do not define legal compliance as a model-generated conclusion.'
    ],
    outputContract: { format:'JSON', schemaName:'FindingArchitectureOutput', requiredFields:['capabilityId','antipatternId','capabilityFindings','antipatternFindings','findingLogicNotes'], additionalProperties:false },
    validationProfile: ['IDS_MATCH','FINDING_IDS_DETERMINISTIC','ATOMIC_REFERENCES_RESOLVE','EVIDENCE_REFERENCES_RESOLVE','ALLOWED_CONCLUSION_STATES','TESTED_ABSENT_GUARDED','NO_UNSUPPORTED_ASSURANCE_ESCALATION'],
    dependencyPaths: ['capability.finding_definitions','antipattern.finding_definitions'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildControlBoundaryContract(seed: ControlBoundarySeed): TaskContract<ControlBoundaryOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:CONTROL_BOUNDARY`,
    taskType: 'CONTROL_BOUNDARY',
    targetObjectId: seed.pairBoundary.pairId,
    objective: 'Define hard-gate effects and the machine/human decision boundary for the knowledge pair. Preserve the validated findings and state explicitly what machines may do, must not do, and what requires human authority.',
    modelRole: 'REASONER',
    upstreamTaskTypes: ['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS','ATOMIC_DECOMPOSITION','EVIDENCE_ARCHITECTURE','EVIDENCE_SAFETY','AP_ABSENCE_CONTRACT','SOURCE_MAPPING','FINDING_ARCHITECTURE'],
    lockedInputs: { finding_architecture: seed.findingArchitecture, pair_boundary: seed.pairBoundary, evidence_safety: seed.evidenceSafety, ap_absence_contract: seed.apAbsenceContract, golden_standard_control_rules: seed.goldenStandardControlRules },
    allowedReferences: ['VALIDATED_FINDINGS','VALIDATED_EVIDENCE_SAFETY','VALIDATED_AP_ABSENCE_CONTRACT','VALIDATED_PAIR_BOUNDARY','GOLDEN_STANDARD'],
    doNot: [
      'Do not rewrite findings or their evidence requirements.',
      'Do not grant legal compliance, residual-risk acceptance, approval or lifecycle authorization to a model.',
      'Do not allow a model to override deterministic gates or locked findings.',
      'Do not create tactics or source mappings.'
    ],
    outputContract: { format:'JSON', schemaName:'ControlBoundaryOutput', requiredFields:['capabilityId','antipatternId','capabilityHardGate','antipatternHardGate','capabilityRuntimeBoundary','antipatternRuntimeBoundary','controlNotes'], additionalProperties:false },
    validationProfile: ['IDS_MATCH','HARD_GATE_EFFECT_ALLOWED','RUNTIME_BOUNDARY_COMPLETE','HUMAN_AUTHORITY_EXPLICIT','NO_MODEL_OVERRIDE_AUTHORITY'],
    dependencyPaths: ['capability.hard_gate_effect','capability.runtime_decision_boundary','antipattern.hard_gate_effect','antipattern.runtime_decision_boundary'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildReferenceMappingContract(seed: ReferenceMappingSeed): TaskContract<ReferenceMappingOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:REFERENCE_MAPPING`,
    taskType: 'REFERENCE_MAPPING',
    targetObjectId: seed.pairBoundary.pairId,
    objective: 'Define exact related-criterion references and exact approved tactic references. Tactic references may be emitted only when the supplied tactic catalog contains an approved reciprocal mapping; otherwise keep the tactic reference list empty and report the unresolved need.',
    modelRole: 'WORKHORSE',
    upstreamTaskTypes: ['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS','ATOMIC_DECOMPOSITION','EVIDENCE_ARCHITECTURE','EVIDENCE_SAFETY','AP_ABSENCE_CONTRACT','SOURCE_MAPPING','FINDING_ARCHITECTURE','CONTROL_BOUNDARY'],
    lockedInputs: { pair_boundary: seed.pairBoundary, finding_architecture: seed.findingArchitecture, control_boundary: seed.controlBoundary, adjacent_criteria: seed.adjacentCriteria, approved_tactic_catalog: seed.approvedTacticCatalog, golden_standard_reference_rules: seed.goldenStandardReferenceRules },
    allowedReferences: ['VALIDATED_PAIR_BOUNDARY','VALIDATED_FINDINGS','VALIDATED_CONTROL_BOUNDARY','ADJACENT_CRITERIA','APPROVED_TACTIC_CATALOG_IF_SUPPLIED','GOLDEN_STANDARD'],
    doNot: [
      'Do not invent tactic IDs, tactic versions, mapping IDs or reciprocal mappings.',
      'Do not use keyword, semantic-similarity or domain fallback to create tactic mappings.',
      'Do not create a tactic reference when the approved reciprocal catalog mapping is absent.',
      'Do not invent related criteria outside the taxonomy baseline.',
      'Do not rewrite content owned by earlier tasks.'
    ],
    outputContract: { format:'JSON', schemaName:'ReferenceMappingOutput', requiredFields:['capabilityId','antipatternId','capabilityRelatedCriteria','antipatternRelatedCriteria','capabilityTacticRefs','antipatternTacticRefs','unresolvedTacticNeeds'], additionalProperties:false },
    validationProfile: ['IDS_MATCH','RELATED_CRITERIA_EXIST','NO_SELF_REFERENCE','TACTICS_APPROVED_IF_PRESENT','TACTIC_RECIPROCITY_EXACT','EMPTY_TACTICS_ALLOWED'],
    dependencyPaths: ['capability.related_criteria','capability.candidate_tactic_refs','antipattern.related_criteria','antipattern.candidate_tactic_refs'],
    failureMode: 'FAIL_CLOSED'
  };
}

export function buildPairCoherenceReviewContract(seed: PairCoherenceReviewSeed): TaskContract<PairCoherenceReviewOutput> {
  return {
    contractVersion: CONTRACT_VERSION,
    taskId: `${seed.pairBoundary.pairId}:PAIR_COHERENCE_REVIEW`,
    taskType: 'PAIR_COHERENCE_REVIEW',
    targetObjectId: seed.pairBoundary.pairId,
    objective: 'Independently review the complete validated pair for semantic, evidence, source, finding, control and reference coherence. Return defects only; do not rewrite any production content.',
    modelRole: 'QUALITY_CHECKER',
    upstreamTaskTypes: ['PAIR_BOUNDARY','AP_FAILURE_MODEL','APPLICABILITY','PRIMARY_QUESTIONS','ATOMIC_DECOMPOSITION','EVIDENCE_ARCHITECTURE','EVIDENCE_SAFETY','AP_ABSENCE_CONTRACT','SOURCE_MAPPING','FINDING_ARCHITECTURE','CONTROL_BOUNDARY','REFERENCE_MAPPING'],
    lockedInputs: { pair_boundary: seed.pairBoundary, ap_failure_model: seed.apFailureModel, applicability: seed.applicability, primary_questions: seed.primaryQuestions, atomic_decomposition: seed.atomicDecomposition, evidence_architecture: seed.evidenceArchitecture, evidence_safety: seed.evidenceSafety, ap_absence_contract: seed.apAbsenceContract, source_mapping: seed.sourceMapping, finding_architecture: seed.findingArchitecture, control_boundary: seed.controlBoundary, reference_mapping: seed.referenceMapping, golden_standard_pair_rules: seed.goldenStandardPairRules },
    allowedReferences: ['ALL_VALIDATED_PAIR_ARTIFACTS','GOLDEN_STANDARD'],
    doNot: [
      'Do not rewrite, normalize, improve or silently repair any production content.',
      'Do not create new sources, evidence, findings, tactics or controls.',
      'Do not approve the pair.',
      'Do not suppress a defect merely because repair would affect multiple dependent paths.'
    ],
    outputContract: { format:'JSON', schemaName:'PairCoherenceReviewOutput', requiredFields:['pairId','passed','defects','coherenceSummary'], additionalProperties:false },
    validationProfile: ['PAIR_ID_MATCH','DEFECT_PATHS_RESOLVE','PASS_ONLY_WHEN_NO_BLOCKING_OR_HIGH_DEFECTS','REVIEW_OUTPUT_CONTAINS_NO_REWRITTEN_CONTENT'],
    dependencyPaths: [],
    failureMode: 'FAIL_CLOSED'
  };
}
