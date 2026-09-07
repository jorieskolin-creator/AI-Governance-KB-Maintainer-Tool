import type { TaskContract } from '../domain/task-contract.js';
import type { PairCoherenceReviewOutput } from './final-pair-contracts.js';

export interface ValidatedPairSnapshot {
  pairId: string;
  capabilityId: string;
  antipatternId: string;
  pairArtifacts: Record<string, unknown>;
  pairCoherenceReview: PairCoherenceReviewOutput;
}

export interface DomainCoherenceDefect {
  defectId: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';
  affectedPairIds: string[];
  affectedPaths: string[];
  issue: string;
  violatedRule: string;
  recommendedRepairScope: string[];
}

export interface DomainCoherenceOutput {
  domain: string;
  passed: boolean;
  defects: DomainCoherenceDefect[];
  domainSummary: string;
}

export interface DomainCoherenceSeed {
  domain: string;
  validatedPairs: ValidatedPairSnapshot[];
  domainBaseline: Record<string, unknown>;
  goldenStandardDomainRules: Record<string, unknown>;
}

export function buildDomainCoherenceReviewContract(
  seed: DomainCoherenceSeed
): TaskContract<DomainCoherenceOutput> {
  return {
    contractVersion: '1.0.0',
    taskId: `DOMAIN-${seed.domain}:DOMAIN_COHERENCE_REVIEW`,
    taskType: 'DOMAIN_COHERENCE_REVIEW',
    targetObjectId: `DOMAIN-${seed.domain}`,
    objective:
      'Independently review the complete validated domain batch for overlap, gaps, contradictory boundaries, duplicated atomic mechanisms, inconsistent terminology, conflicting source interpretation, inconsistent evidence/assurance logic, and broken related-criterion relationships. Return defects only; do not rewrite pair content.',
    modelRole: 'QUALITY_CHECKER',
    upstreamTaskTypes: [],
    lockedInputs: {
      domain: seed.domain,
      validated_pairs: seed.validatedPairs,
      domain_baseline: seed.domainBaseline,
      golden_standard_domain_rules: seed.goldenStandardDomainRules
    },
    allowedReferences: ['VALIDATED_DOMAIN_PAIR_SNAPSHOTS', 'DOMAIN_BASELINE', 'GOLDEN_STANDARD'],
    doNot: [
      'Do not rewrite or normalize any pair content.',
      'Do not create new criteria, sources, evidence, findings, tactics or controls.',
      'Do not approve the domain batch.',
      'Do not merge two categories merely because their terminology is similar.',
      'Do not suppress a defect because fixing it may affect multiple pairs.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'DomainCoherenceOutput',
      requiredFields: ['domain', 'passed', 'defects', 'domainSummary'],
      additionalProperties: false
    },
    validationProfile: [
      'DOMAIN_ID_MATCH',
      'EXPECTED_PAIR_SET_COMPLETE',
      'ALL_PAIR_REVIEWS_PASSED',
      'DEFECT_PAIR_IDS_RESOLVE',
      'PASS_ONLY_WHEN_NO_HIGH_OR_BLOCKING_DEFECTS',
      'REVIEW_OUTPUT_CONTAINS_NO_REWRITTEN_CONTENT'
    ],
    dependencyPaths: [],
    failureMode: 'FAIL_CLOSED'
  };
}
