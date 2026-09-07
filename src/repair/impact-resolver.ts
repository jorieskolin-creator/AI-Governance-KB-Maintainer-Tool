import type { ValidationFinding, ValidationKind } from '../validation/contracts.js';

const DEFAULT_DEPENDENCIES: Partial<Record<ValidationKind, string[]>> = {
  SCHEMA: ['SCHEMA', 'REFERENCE'],
  IDENTIFIER: ['IDENTIFIER', 'REFERENCE'],
  REFERENCE: ['REFERENCE', 'SEMANTIC'],
  SOURCE: ['SOURCE', 'FACTUAL', 'SEMANTIC'],
  TACTIC: ['TACTIC', 'REFERENCE'],
  SEMANTIC: ['SEMANTIC', 'GOLDEN_STANDARD'],
  FACTUAL: ['FACTUAL', 'SOURCE', 'GOLDEN_STANDARD'],
  GOLDEN_STANDARD: ['GOLDEN_STANDARD'],
  DOMAIN_COHERENCE: ['DOMAIN_COHERENCE'],
  PUBLICATION_PARITY: ['PUBLICATION_PARITY']
};

export interface RepairScope {
  targetObjectId: string;
  targetPaths: string[];
  validatorsToRerun: string[];
}

export function resolveRepairScope(finding: ValidationFinding): RepairScope {
  return {
    targetObjectId: finding.objectId,
    targetPaths: [finding.objectPath, ...finding.dependencyScope],
    validatorsToRerun: [...new Set(DEFAULT_DEPENDENCIES[finding.kind] ?? [finding.kind])]
  };
}

// The resolver is deliberately deterministic: a model may repair the selected
// object path, but it does not decide what unrelated content should be regenerated.
