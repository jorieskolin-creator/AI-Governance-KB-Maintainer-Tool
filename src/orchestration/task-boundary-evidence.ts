import type { CognitiveTaskType } from '../domain/states.js';
import {
  CONSOLIDATION_MERGE_AUTHORIZED,
  isForbiddenConsolidation,
  isMeasureOnlyCandidate,
  MEASURE_ONLY_CANDIDATE,
  type ConsolidationDecision
} from './task-boundaries.js';

export const EVIDENCE_THRESHOLDS = {
  minPairsInDomain: 5,
  minCompletedPairs: 5,
  requireIndependentValidators: true,
  requireQualityImprovement: true,
  requireRepairCostImprovement: true
} as const;

export interface LoadedTaskBoundaryRecord {
  taskType: CognitiveTaskType;
  status: 'COMPLETED' | 'FAILED';
  validationPassed?: boolean;
  retryCount?: number;
  isFallback?: boolean;
  correctionAttempted?: boolean;
  latencyMs?: number;
  tokens?: number;
  cost?: number;
  findingCount?: number;
  sourceGapCount?: number;
  repairCount?: number;
  revisionCount?: number;
  pairCoherenceFirstDefect?: boolean;
}

export interface TaskBoundaryMetrics {
  taskType: CognitiveTaskType;
  completions: number;
  validationFailures: number;
  retries: number;
  providerFallbacks: number;
  correctionAttempts: number;
  latencyMsTotal: number;
  tokensTotal: number;
  costTotal: number;
  validationFindingCount: number;
  sourceGaps: number;
  repairCount: number;
  revisionCount: number;
  pairCoherenceFirstDefects: number;
}

export interface ConsolidationEvidence {
  left: CognitiveTaskType;
  right: CognitiveTaskType;
  pairCount: number;
  independentValidatorsRan: boolean;
  combinedRepairCostWouldDecrease: boolean;
  qualityWouldImprove: boolean;
  ownershipPreserved: boolean;
  sourceAttributionPreserved: boolean;
  qcIndependencePreserved: boolean;
  repairLocalizationPreserved: boolean;
  leftMetrics?: TaskBoundaryMetrics;
  rightMetrics?: TaskBoundaryMetrics;
}

export interface ConsolidationVerdict {
  left: CognitiveTaskType;
  right: CognitiveTaskType;
  decision: ConsolidationDecision;
  mergeEligible: false;
  reasons: readonly string[];
}

function emptyMetrics(taskType: CognitiveTaskType): TaskBoundaryMetrics {
  return {
    taskType,
    completions: 0,
    validationFailures: 0,
    retries: 0,
    providerFallbacks: 0,
    correctionAttempts: 0,
    latencyMsTotal: 0,
    tokensTotal: 0,
    costTotal: 0,
    validationFindingCount: 0,
    sourceGaps: 0,
    repairCount: 0,
    revisionCount: 0,
    pairCoherenceFirstDefects: 0
  };
}

export function summarizeTaskMetrics(
  records: readonly LoadedTaskBoundaryRecord[]
): Map<CognitiveTaskType, TaskBoundaryMetrics> {
  const byTask = new Map<CognitiveTaskType, TaskBoundaryMetrics>();
  for (const record of records) {
    const current = byTask.get(record.taskType) ?? emptyMetrics(record.taskType);
    if (record.status === 'COMPLETED') current.completions += 1;
    if (record.validationPassed === false) current.validationFailures += 1;
    current.retries += record.retryCount ?? 0;
    if (record.isFallback) current.providerFallbacks += 1;
    if (record.correctionAttempted) current.correctionAttempts += 1;
    current.latencyMsTotal += record.latencyMs ?? 0;
    current.tokensTotal += record.tokens ?? 0;
    current.costTotal += record.cost ?? 0;
    current.validationFindingCount += record.findingCount ?? 0;
    current.sourceGaps += record.sourceGapCount ?? 0;
    current.repairCount += record.repairCount ?? 0;
    current.revisionCount += record.revisionCount ?? 0;
    if (record.pairCoherenceFirstDefect) current.pairCoherenceFirstDefects += 1;
    byTask.set(record.taskType, current);
  }
  return byTask;
}

function evidenceBarReasons(evidence: ConsolidationEvidence): string[] {
  const reasons: string[] = [];
  if (evidence.pairCount < EVIDENCE_THRESHOLDS.minCompletedPairs) {
    reasons.push('INSUFFICIENT_PAIR_SAMPLE');
  }
  if (EVIDENCE_THRESHOLDS.requireIndependentValidators && !evidence.independentValidatorsRan) {
    reasons.push('INDEPENDENT_VALIDATORS_NOT_BOTH_RUN');
  }
  if (EVIDENCE_THRESHOLDS.requireRepairCostImprovement && !evidence.combinedRepairCostWouldDecrease) {
    reasons.push('REPAIR_COST_NOT_PROVEN_LOWER');
  }
  if (EVIDENCE_THRESHOLDS.requireQualityImprovement && !evidence.qualityWouldImprove) {
    reasons.push('QUALITY_NOT_PROVEN_HIGHER');
  }
  if (!evidence.ownershipPreserved) reasons.push('OWNERSHIP_WOULD_WEAKEN');
  if (!evidence.sourceAttributionPreserved) reasons.push('SOURCE_ATTRIBUTION_WOULD_WEAKEN');
  if (!evidence.qcIndependencePreserved) reasons.push('QC_INDEPENDENCE_WOULD_WEAKEN');
  if (!evidence.repairLocalizationPreserved) reasons.push('REPAIR_LOCALIZATION_WOULD_WEAKEN');
  return reasons;
}

export function decideConsolidation(
  left: CognitiveTaskType,
  right: CognitiveTaskType,
  evidence?: ConsolidationEvidence
): ConsolidationVerdict {
  if (left === right) {
    return {
      left,
      right,
      decision: 'KEEP_SEPARATE',
      mergeEligible: false,
      reasons: ['SAME_TASK']
    };
  }

  if (isForbiddenConsolidation(left, right)) {
    return {
      left,
      right,
      decision: 'FORBIDDEN',
      mergeEligible: false,
      reasons: ['FORBIDDEN_OWNERSHIP_OR_AUTHORITY_SPLIT']
    };
  }

  const reasons: string[] = [];
  if (!CONSOLIDATION_MERGE_AUTHORIZED) reasons.push('MERGE_AUTHORIZATION_CLOSED');
  reasons.push('MERGE_DECISION_NOT_WIRED');

  if (isMeasureOnlyCandidate(left, right)) {
    reasons.push('MEASURE_ONLY_CANDIDATE');
    reasons.push('INDEPENDENT_VALIDATORS_REQUIRED');
    if (!MEASURE_ONLY_CANDIDATE.requiresIndependentValidators) {
      reasons.push('MEASURE_ONLY_VALIDATOR_SPLIT_DRIFTED');
    }
  } else {
    reasons.push('NOT_AN_AUTHORIZED_MEASURE_CANDIDATE');
  }

  if (evidence) reasons.push(...evidenceBarReasons(evidence));

  return {
    left,
    right,
    decision: 'KEEP_SEPARATE',
    mergeEligible: false,
    reasons
  };
}

export function emptyEvidence(left: CognitiveTaskType, right: CognitiveTaskType): ConsolidationEvidence {
  return {
    left,
    right,
    pairCount: 0,
    independentValidatorsRan: false,
    combinedRepairCostWouldDecrease: false,
    qualityWouldImprove: false,
    ownershipPreserved: true,
    sourceAttributionPreserved: true,
    qcIndependencePreserved: true,
    repairLocalizationPreserved: true
  };
}

export function optimisticMeasureEvidence(): ConsolidationEvidence {
  return {
    left: MEASURE_ONLY_CANDIDATE.left,
    right: MEASURE_ONLY_CANDIDATE.right,
    pairCount: EVIDENCE_THRESHOLDS.minCompletedPairs,
    independentValidatorsRan: true,
    combinedRepairCostWouldDecrease: true,
    qualityWouldImprove: true,
    ownershipPreserved: true,
    sourceAttributionPreserved: true,
    qcIndependencePreserved: true,
    repairLocalizationPreserved: true
  };
}

export function highRepairSourceMappingEvidence(): ConsolidationEvidence {
  return {
    left: 'SOURCE_MAPPING',
    right: 'FINDING_ARCHITECTURE',
    pairCount: 5,
    independentValidatorsRan: true,
    combinedRepairCostWouldDecrease: true,
    qualityWouldImprove: true,
    ownershipPreserved: false,
    sourceAttributionPreserved: false,
    qcIndependencePreserved: true,
    repairLocalizationPreserved: false,
    leftMetrics: {
      ...emptyMetrics('SOURCE_MAPPING'),
      completions: 5,
      validationFailures: 8,
      repairCount: 12,
      sourceGaps: 5,
      revisionCount: 9
    }
  };
}
