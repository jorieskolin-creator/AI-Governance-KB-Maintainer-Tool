export type ValidationKind =
  | 'SCHEMA'
  | 'IDENTIFIER'
  | 'REFERENCE'
  | 'SOURCE'
  | 'TACTIC'
  | 'SEMANTIC'
  | 'FACTUAL'
  | 'GOLDEN_STANDARD'
  | 'DOMAIN_COHERENCE'
  | 'PUBLICATION_PARITY';

export type ValidationSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';

export interface ValidationFinding {
  checkId: string;
  kind: ValidationKind;
  severity: ValidationSeverity;
  objectId: string;
  objectPath: string;
  issue: string;
  dependencyScope: string[];
  recommendedAction?: string;
}

export interface ValidationReport {
  runId: string;
  objectId: string;
  passed: boolean;
  findings: ValidationFinding[];
}
