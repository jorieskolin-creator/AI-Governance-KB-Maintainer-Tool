import { z } from 'zod';
import type {
  DomainCoherenceOutput,
  ValidatedPairSnapshot
} from '../cognitive/domain-coherence-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const defectSchema = z.object({
  defectId: z.string().trim().min(1),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKING']),
  affectedPairIds: z.array(z.string().trim().min(1)).min(1),
  affectedPaths: z.array(z.string().trim().min(1)).min(1),
  issue: z.string().trim().min(10),
  violatedRule: z.string().trim().min(1),
  recommendedRepairScope: z.array(z.string().trim().min(1)).min(1)
}).strict();

const outputSchema = z.object({
  domain: z.string().regex(/^[A-F]$/),
  passed: z.boolean(),
  defects: z.array(defectSchema),
  domainSummary: z.string().trim().min(10)
}).strict();

function finding(
  runId: string,
  domain: string,
  checkId: string,
  objectPath: string,
  issue: string
): ValidationFinding {
  return {
    checkId,
    kind: 'DOMAIN_COHERENCE',
    severity: 'BLOCKING',
    objectId: `DOMAIN-${domain}`,
    objectPath,
    issue,
    dependencyScope: []
  };
}

export function validateDomainCoherenceCompletion(
  runId: string,
  domain: string,
  expectedPairIds: readonly string[],
  validatedPairs: readonly ValidatedPairSnapshot[],
  output: unknown
): ValidationReport {
  const findings: ValidationFinding[] = [];
  const parsed = outputSchema.safeParse(output);

  if (!parsed.success) {
    for (const issueItem of parsed.error.issues) {
      findings.push(
        finding(runId, domain, 'DOMAIN_REVIEW_OUTPUT_CONTRACT', issueItem.path.join('.') || 'output', issueItem.message)
      );
    }
    return { runId, objectId: `DOMAIN-${domain}`, passed: false, findings };
  }

  const value = parsed.data as DomainCoherenceOutput;
  if (value.domain !== domain) {
    findings.push(finding(runId, domain, 'DOMAIN_ID_MATCH', 'domain', `Expected ${domain}, received ${value.domain}.`));
  }

  const actualPairIds = new Set(validatedPairs.map((pair) => pair.pairId));
  for (const expectedPairId of expectedPairIds) {
    if (!actualPairIds.has(expectedPairId)) {
      findings.push(finding(runId, domain, 'DOMAIN_PAIR_SET_INCOMPLETE', 'validatedPairs', `Required pair ${expectedPairId} is missing.`));
    }
  }

  for (const pair of validatedPairs) {
    if (!pair.pairCoherenceReview.passed) {
      findings.push(finding(runId, domain, 'PAIR_NOT_COHERENCE_VALIDATED', pair.pairId, `${pair.pairId} has not passed pair coherence review.`));
    }
  }

  for (const [index, defect] of value.defects.entries()) {
    for (const pairId of defect.affectedPairIds) {
      if (!actualPairIds.has(pairId)) {
        findings.push(finding(runId, domain, 'DOMAIN_DEFECT_UNKNOWN_PAIR', `defects.${index}.affectedPairIds`, `${pairId} is not part of the validated domain batch.`));
      }
    }
  }

  const highOrBlocking = value.defects.some(
    (defect) => defect.severity === 'HIGH' || defect.severity === 'BLOCKING'
  );
  if (value.passed && highOrBlocking) {
    findings.push(finding(runId, domain, 'DOMAIN_REVIEW_PASS_CONTRADICTION', 'passed', 'Domain cannot pass while HIGH or BLOCKING defects remain.'));
  }

  return { runId, objectId: `DOMAIN-${domain}`, passed: findings.length === 0, findings };
}
