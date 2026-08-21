import type {
  AtomicDecompositionOutput,
  EvidenceArchitectureOutput
} from '../cognitive/content-contracts.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';
import type { CompletionContext } from './cognitive-completion.js';

function finding(
  context: CompletionContext,
  checkId: string,
  objectPath: string,
  issue: string
): ValidationFinding {
  return {
    checkId,
    kind: 'REFERENCE',
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: []
  };
}

function compareCoverage(
  expectedAtomicIds: string[],
  bindings: Array<{ atomicItemId: string; evidenceIds: string[] }>,
  path: string,
  context: CompletionContext,
  findings: ValidationFinding[]
): void {
  const expected = new Set(expectedAtomicIds);
  const actual = new Set(bindings.map((binding) => binding.atomicItemId));

  for (const atomicId of expected) {
    if (!actual.has(atomicId)) {
      findings.push(
        finding(
          context,
          'ATOMIC_EVIDENCE_BINDING_MISSING',
          path,
          `Validated atomic item ${atomicId} has no evidence binding.`
        )
      );
    }
  }

  for (const atomicId of actual) {
    if (!expected.has(atomicId)) {
      findings.push(
        finding(
          context,
          'ATOMIC_EVIDENCE_BINDING_UNKNOWN',
          path,
          `Evidence binding references ${atomicId}, which is not present in the validated atomic decomposition.`
        )
      );
    }
  }
}

export function validateEvidenceAgainstAtomicDecomposition(
  atomic: AtomicDecompositionOutput,
  evidence: EvidenceArchitectureOutput,
  context: CompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (atomic.capabilityId !== evidence.capabilityId) {
    findings.push(
      finding(
        context,
        'CAPABILITY_ARTIFACT_ID_MATCH',
        'capabilityId',
        `Atomic decomposition uses ${atomic.capabilityId} but evidence architecture uses ${evidence.capabilityId}.`
      )
    );
  }

  if (atomic.antipatternId !== evidence.antipatternId) {
    findings.push(
      finding(
        context,
        'ANTIPATTERN_ARTIFACT_ID_MATCH',
        'antipatternId',
        `Atomic decomposition uses ${atomic.antipatternId} but evidence architecture uses ${evidence.antipatternId}.`
      )
    );
  }

  compareCoverage(
    atomic.capabilitySubcriteria.map((item) => item.id),
    evidence.capabilityBindings,
    'capabilityBindings',
    context,
    findings
  );

  compareCoverage(
    atomic.antipatternTests.map((item) => item.id),
    evidence.antipatternBindings,
    'antipatternBindings',
    context,
    findings
  );

  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}
