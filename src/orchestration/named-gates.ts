import { SNAPSHOT_ROOT_TASK } from '../repair/qc-repair.js';
import type { ValidationFinding } from '../validation/contracts.js';
import {
  isSourceContextPacket,
  sourceContextLocatorCount,
  type SourceContextPacket
} from './source-context-packet.js';

export const GATE_VALIDATOR_VERSION = '1.0.0';

export const STALE_REVISION_ISSUE =
  'STALE_REVISION: this review is bound to a superseded candidate. Reload and review the current revision.';

export type NamedGate =
  | 'SIR'
  | 'SOURCE_COVERAGE'
  | 'CANONICAL_COMPILE'
  | 'QC'
  | 'COHERENCE'
  | 'RENDER_PARITY'
  | 'APPROVAL_READINESS'
  | 'APPROVAL'
  | 'PUBLICATION';

export type NamedGateOutcome =
  | 'SIR_VALID'
  | 'SOURCE_COVERAGE_COMPLETE'
  | 'SOURCE_GAPS_PRESENT'
  | 'CANONICAL_COMPILE_VALID'
  | 'COMPILE_FAILED'
  | 'QC_COMPLETE'
  | 'QC_INCOMPLETE'
  | 'COHERENCE_CLEAN'
  | 'DEFECTS_OPEN'
  | 'RENDER_PARITY_VALID'
  | 'RENDER_PARITY_FAILED'
  | 'READY_FOR_APPROVAL'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'PUBLICATION_FAILED';

export interface NamedGateResult {
  gateName: NamedGate;
  outcome: NamedGateOutcome;
  validatorVersion: string;
  findings: ValidationFinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function blockingDefects(review: unknown): boolean {
  if (!isRecord(review) || !Array.isArray(review.defects)) return false;
  return review.defects.some((item) => {
    if (!isRecord(item)) return false;
    return item.severity === 'HIGH' || item.severity === 'BLOCKING';
  });
}

function qcComplete(review: unknown): boolean {
  if (!isRecord(review) || !Array.isArray(review.defects)) return false;
  return typeof review.coherenceSummary === 'string' && review.coherenceSummary.trim().length >= 10;
}

export function evaluateCanonicalCompile(defects: readonly ValidationFinding[]): NamedGateResult {
  return {
    gateName: 'CANONICAL_COMPILE',
    outcome: defects.length === 0 ? 'CANONICAL_COMPILE_VALID' : 'COMPILE_FAILED',
    validatorVersion: GATE_VALIDATOR_VERSION,
    findings: [...defects]
  };
}

export function evaluateRenderParity(defects: readonly ValidationFinding[]): NamedGateResult {
  return {
    gateName: 'RENDER_PARITY',
    outcome: defects.length === 0 ? 'RENDER_PARITY_VALID' : 'RENDER_PARITY_FAILED',
    validatorVersion: GATE_VALIDATOR_VERSION,
    findings: [...defects]
  };
}

export function evaluateSourceCoverage(sourceMappings: unknown): NamedGateOutcome | undefined {
  if (!isRecord(sourceMappings)) return undefined;
  const capability = Array.isArray(sourceMappings.capability) ? sourceMappings.capability : null;
  const antipattern = Array.isArray(sourceMappings.antipattern) ? sourceMappings.antipattern : null;
  const unmapped = Array.isArray(sourceMappings.unmappedClaims) ? sourceMappings.unmappedClaims : null;
  if (!capability || !antipattern || !unmapped) return 'SOURCE_GAPS_PRESENT';
  if (unmapped.length > 0 || capability.length + antipattern.length === 0) {
    return 'SOURCE_GAPS_PRESENT';
  }
  return 'SOURCE_COVERAGE_COMPLETE';
}

function sourceAcquisitionFinding(
  packet: SourceContextPacket | undefined,
  checkId: string,
  objectPath: string,
  issue: string,
  dependencyScope: string[]
): ValidationFinding {
  return {
    checkId,
    kind: 'SOURCE',
    severity: 'BLOCKING',
    objectId: packet?.pairId ?? 'SOURCE_CONTEXT',
    objectPath,
    issue,
    dependencyScope,
    recommendedAction:
      'Acquire governed exact locators from a sealed locator catalog where rights allow. Do not invent locators. BLOCKING source findings are not waivable.'
  };
}

export function evaluateSourceAcquisition(packet: unknown): NamedGateResult {
  if (!isSourceContextPacket(packet)) {
    return {
      gateName: 'SOURCE_COVERAGE',
      outcome: 'SOURCE_GAPS_PRESENT',
      validatorVersion: GATE_VALIDATOR_VERSION,
      findings: [
        sourceAcquisitionFinding(
          undefined,
          'SOURCE_CONTEXT_PACKET_INVALID',
          '/',
          'Source acquisition did not persist a verifiable Source Context Packet.',
          []
        )
      ]
    };
  }
  const locatorCount = sourceContextLocatorCount(packet);
  const missing = packet.missingContextSourceHandles;
  let checkId = 'SOURCE_CONTEXT_MAPPINGS_PENDING';
  let objectPath = '/sourceMappings';
  let issue =
    'Governed locators were acquired, but claim-to-locator mappings do not exist yet. SOURCE_COVERAGE_COMPLETE waits for SOURCE_MAPPING.';
  if (locatorCount === 0) {
    checkId = 'SOURCE_CONTEXT_ZERO_LOCATORS';
    objectPath = '/locatorContexts';
    issue =
      'Source acquisition completed with zero governed locators. Claim-bearing authoring remains unsupported until exact locators exist.';
  } else if (missing.length > 0 || !packet.mappingContextAvailable) {
    checkId = 'SOURCE_CONTEXT_MISSING_PASSAGES';
    objectPath = '/missingContextSourceHandles';
    issue = `Source acquisition is missing governed locator context for ${missing.join(', ') || 'one or more allowed sources'}.`;
  }
  return {
    gateName: 'SOURCE_COVERAGE',
    outcome: 'SOURCE_GAPS_PRESENT',
    validatorVersion: GATE_VALIDATOR_VERSION,
    findings: [sourceAcquisitionFinding(packet, checkId, objectPath, issue, missing)]
  };
}

export function evaluatePairGates(input: {
  snapshotComplete: boolean;
  schemaIssues: readonly string[];
  sourceMappings: unknown;
  sourceContextPacket?: unknown;
  review: unknown;
}): NamedGateResult[] {
  const results: NamedGateResult[] = [];
  if (input.snapshotComplete && input.schemaIssues.length === 0) {
    results.push({
      gateName: 'SIR',
      outcome: 'SIR_VALID',
      validatorVersion: GATE_VALIDATOR_VERSION,
      findings: []
    });
  }
  const source = evaluateSourceCoverage(input.sourceMappings);
  if (source) {
    results.push({
      gateName: 'SOURCE_COVERAGE',
      outcome: source,
      validatorVersion: GATE_VALIDATOR_VERSION,
      findings: []
    });
  } else if (input.sourceContextPacket !== undefined) {
    results.push(evaluateSourceAcquisition(input.sourceContextPacket));
  }
  if (input.review === undefined) {
    return results;
  }
  if (!qcComplete(input.review)) {
    results.push({
      gateName: 'QC',
      outcome: 'QC_INCOMPLETE',
      validatorVersion: GATE_VALIDATOR_VERSION,
      findings: []
    });
    return results;
  }
  results.push({
    gateName: 'QC',
    outcome: 'QC_COMPLETE',
    validatorVersion: GATE_VALIDATOR_VERSION,
    findings: []
  });
  results.push({
    gateName: 'COHERENCE',
    outcome: blockingDefects(input.review) ? 'DEFECTS_OPEN' : 'COHERENCE_CLEAN',
    validatorVersion: GATE_VALIDATOR_VERSION,
    findings: []
  });
  return results;
}

export function evaluateDomainGates(input: { review: unknown }): NamedGateResult[] {
  if (!qcComplete(input.review)) {
    return [
      {
        gateName: 'QC',
        outcome: 'QC_INCOMPLETE',
        validatorVersion: GATE_VALIDATOR_VERSION,
        findings: []
      }
    ];
  }
  const results: NamedGateResult[] = [
    {
      gateName: 'QC',
      outcome: 'QC_COMPLETE',
      validatorVersion: GATE_VALIDATOR_VERSION,
      findings: []
    },
    {
      gateName: 'COHERENCE',
      outcome: blockingDefects(input.review) ? 'DEFECTS_OPEN' : 'COHERENCE_CLEAN',
      validatorVersion: GATE_VALIDATOR_VERSION,
      findings: []
    }
  ];
  if (results[1]?.outcome === 'COHERENCE_CLEAN') {
    results.push({
      gateName: 'APPROVAL_READINESS',
      outcome: 'READY_FOR_APPROVAL',
      validatorVersion: GATE_VALIDATOR_VERSION,
      findings: []
    });
  }
  return results;
}

export function pairMayValidate(outcomes: readonly NamedGateOutcome[]): boolean {
  return (
    outcomes.includes('SIR_VALID') &&
    outcomes.includes('QC_COMPLETE') &&
    outcomes.includes('COHERENCE_CLEAN') &&
    !outcomes.includes('DEFECTS_OPEN') &&
    !outcomes.includes('QC_INCOMPLETE')
  );
}

export function domainMayReadyForApproval(outcomes: readonly NamedGateOutcome[]): boolean {
  return (
    outcomes.includes('QC_COMPLETE') &&
    outcomes.includes('COHERENCE_CLEAN') &&
    outcomes.includes('READY_FOR_APPROVAL') &&
    !outcomes.includes('DEFECTS_OPEN') &&
    !outcomes.includes('QC_INCOMPLETE')
  );
}

export function snapshotIsComplete(hashes: Record<string, string>): boolean {
  return Object.values(SNAPSHOT_ROOT_TASK).every((taskType) => Boolean(hashes[taskType]));
}

export function staleRevisionIssues(currentHash: string, expectedHash: unknown): string[] {
  if (typeof expectedHash !== 'string' || !expectedHash.trim()) {
    return [STALE_REVISION_ISSUE];
  }
  if (expectedHash !== currentHash) {
    return [STALE_REVISION_ISSUE];
  }
  return [];
}

export function gateBoundToCurrentRevision(
  gateCandidateHash: string,
  currentCandidateHash: string
): boolean {
  return gateCandidateHash === currentCandidateHash;
}
