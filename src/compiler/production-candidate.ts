import type {
  AtomicDecompositionOutput,
  EvidenceArchitectureOutput,
  EvidenceSafetyOutput,
  PrimaryQuestionsOutput
} from '../cognitive/content-contracts.js';
import type {
  ApAbsenceContractOutput,
  ControlBoundaryOutput,
  FindingArchitectureOutput,
  PairCoherenceReviewOutput,
  ReferenceMappingOutput,
  SourceMappingOutput
} from '../cognitive/final-pair-contracts.js';
import type {
  ApFailureModelOutput,
  ApplicabilityOutput,
  PairBoundaryOutput
} from '../cognitive/initial-contracts.js';
import type { LifecycleAssuranceOutput } from '../cognitive/lifecycle-assurance-contract.js';
import {
  compileCanonicalPair,
  type CanonicalPairArtifacts,
  type CanonicalPairCompileResult,
  type CanonicalPairMetadata
} from './canonical-pair.js';

export function relatedCriterionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && /^(AP-)?[A-F][1-5]$/.test(item)) {
      ids.push(item);
      continue;
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const criterionId = (item as { criterionId?: unknown }).criterionId;
      if (typeof criterionId === 'string' && /^(AP-)?[A-F][1-5]$/.test(criterionId)) {
        ids.push(criterionId);
      }
    }
  }
  return [...new Set(ids)];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function normalizeReferenceMapping(output: unknown): ReferenceMappingOutput {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('Reference mapping artifact is missing.');
  }
  const record = output as Record<string, unknown>;
  return {
    capabilityId: String(record.capabilityId ?? ''),
    antipatternId: String(record.antipatternId ?? ''),
    capabilityRelatedCriteria: relatedCriterionIds(record.capabilityRelatedCriteria),
    antipatternRelatedCriteria: relatedCriterionIds(record.antipatternRelatedCriteria),
    capabilityTacticRefs: stringArray(record.capabilityTacticRefs),
    antipatternTacticRefs: stringArray(record.antipatternTacticRefs),
    unresolvedTacticNeeds: stringArray(record.unresolvedTacticNeeds ?? record.referenceNotes)
  };
}

export function normalizePairCoherenceReview(output: unknown, pairId: string): PairCoherenceReviewOutput {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error(`Pair coherence artifact is missing for ${pairId}.`);
  }
  const record = output as Record<string, unknown>;
  const defects = Array.isArray(record.defects) ? record.defects : [];
  return {
    pairId: typeof record.pairId === 'string' ? record.pairId : pairId,
    passed: record.passed === true,
    defects: defects.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const defect = item as Record<string, unknown>;
      return [
        {
          defectId: typeof defect.defectId === 'string' ? defect.defectId : 'defect',
          severity:
            defect.severity === 'BLOCKING' ||
            defect.severity === 'HIGH' ||
            defect.severity === 'MEDIUM' ||
            defect.severity === 'LOW'
              ? defect.severity
              : 'HIGH',
          affectedPaths: stringArray(defect.affectedPaths),
          issue: typeof defect.issue === 'string' ? defect.issue : 'Pair coherence defect.',
          violatedRule: typeof defect.violatedRule === 'string' ? defect.violatedRule : 'PAIR_COHERENCE',
          recommendedRepairScope: stringArray(defect.recommendedRepairScope)
        }
      ];
    }),
    coherenceSummary: typeof record.coherenceSummary === 'string' ? record.coherenceSummary : ''
  };
}

export interface ProductionCandidateInput {
  metadata: Omit<CanonicalPairMetadata, 'releaseStatus' | 'capabilityApprovalRecord' | 'antipatternApprovalRecord'>;
  artifacts: CanonicalPairArtifacts;
}

export interface ProductionCandidateCompileResult extends CanonicalPairCompileResult {
  releaseStatus: 'DRAFT';
  notes: string[];
}

export function compileProductionCandidate(input: ProductionCandidateInput): ProductionCandidateCompileResult {
  const notes: string[] = [];
  if (input.artifacts.pairCoherenceReview.defects.length > 0) {
    notes.push(
      `Pair coherence passed with ${String(input.artifacts.pairCoherenceReview.defects.length)} remaining note(s). They are recorded, not granted as APPROVED.`
    );
  }
  if (input.artifacts.referenceMapping.unresolvedTacticNeeds.length > 0) {
    notes.push('Tactic catalog is not sealed; candidate tactic refs stay empty.');
  }
  const compiled = compileCanonicalPair({
    metadata: {
      ...input.metadata,
      releaseStatus: 'DRAFT'
    },
    artifacts: {
      ...input.artifacts,
      referenceMapping: {
        ...input.artifacts.referenceMapping,
        capabilityTacticRefs: [],
        antipatternTacticRefs: []
      }
    },
    approvedTacticCatalog: null,
    candidate: true
  });
  return {
    ...compiled,
    releaseStatus: 'DRAFT',
    notes
  };
}

export type LoadedPairArtifactMap = {
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
  referenceMapping: unknown;
  pairCoherenceReview: unknown;
};

export function artifactsFromLoaded(pairId: string, loaded: LoadedPairArtifactMap): CanonicalPairArtifacts {
  return {
    pairBoundary: loaded.pairBoundary,
    apFailureModel: loaded.apFailureModel,
    applicability: loaded.applicability,
    primaryQuestions: loaded.primaryQuestions,
    atomicDecomposition: loaded.atomicDecomposition,
    evidenceArchitecture: loaded.evidenceArchitecture,
    evidenceSafety: loaded.evidenceSafety,
    apAbsenceContract: loaded.apAbsenceContract,
    sourceMapping: loaded.sourceMapping,
    findingArchitecture: loaded.findingArchitecture,
    controlBoundary: loaded.controlBoundary,
    lifecycleAssurance: loaded.lifecycleAssurance,
    referenceMapping: normalizeReferenceMapping(loaded.referenceMapping),
    pairCoherenceReview: normalizePairCoherenceReview(loaded.pairCoherenceReview, pairId)
  };
}
