import type {
  AtomicDecompositionOutput,
  EvidenceArchitectureOutput
} from '../cognitive/content-contracts.js';
import type {
  SourceMappingOutput,
  FindingArchitectureOutput,
  ReferenceMappingOutput
} from '../cognitive/final-pair-contracts.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';
import type { CompletionContext } from './cognitive-completion.js';

export interface RegisteredSource {
  id: string;
  version_or_date: string;
  verification_status: string;
  last_verified_date: string;
  domain_coverage: string[];
  effective_status: string;
}

export interface SourceRegisterBaseline {
  release_status: string;
  sources: RegisteredSource[];
}

export interface ApprovedTacticReciprocalMapping {
  objectId: string;
  tacticId: string;
  findingId?: string;
  approved: boolean;
}

function finding(
  context: CompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'REFERENCE'
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: []
  };
}

function result(context: CompletionContext, findings: ValidationFinding[]): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
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

  return result(context, findings);
}

export function validateSourceMappingsAgainstSealedRegister(
  mappings: SourceMappingOutput,
  sealedRegister: SourceRegisterBaseline,
  allowedSourceIds: ReadonlySet<string>,
  context: CompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];
  const registered = new Map(sealedRegister.sources.map((source) => [source.id, source]));
  const expectedDomain = context.expectedCapabilityId.slice(0, 1);

  if (sealedRegister.release_status !== 'APPROVED') {
    findings.push(
      finding(
        context,
        'SOURCE_REGISTER_NOT_APPROVED',
        'sealedSourceRegister.release_status',
        'The frozen Source Register must be APPROVED before source mappings can become decision-eligible.',
        'SOURCE'
      )
    );
  }

  const groups = [
    ['capabilityMappings', mappings.capabilityMappings],
    ['antipatternMappings', mappings.antipatternMappings]
  ] as const;

  for (const [path, items] of groups) {
    items.forEach((mapping, index) => {
      const source = registered.get(mapping.sourceId);
      const basePath = `${path}.${index}`;

      if (!source) {
        findings.push(
          finding(context, 'SOURCE_ID_NOT_REGISTERED', `${basePath}.sourceId`, `${mapping.sourceId} is absent from the sealed Source Register.`, 'SOURCE')
        );
        return;
      }

      if (!allowedSourceIds.has(mapping.sourceId)) {
        findings.push(
          finding(context, 'SOURCE_ID_NOT_ALLOWED_FOR_PACKET', `${basePath}.sourceId`, `${mapping.sourceId} was not included in the frozen allowed-source subset.`, 'SOURCE')
        );
      }

      if (source.verification_status !== 'VERIFIED' || mapping.verificationStatus !== source.verification_status) {
        findings.push(
          finding(context, 'SOURCE_VERIFICATION_MISMATCH', `${basePath}.verificationStatus`, `Mapping verification status must equal the sealed register value ${source.verification_status}.`, 'SOURCE')
        );
      }

      if (mapping.sourceVersionOrDate !== source.version_or_date) {
        findings.push(
          finding(context, 'SOURCE_VERSION_MISMATCH', `${basePath}.sourceVersionOrDate`, `Mapping must use exact sealed version/date: ${source.version_or_date}.`, 'SOURCE')
        );
      }

      if (mapping.lastVerifiedDate !== source.last_verified_date) {
        findings.push(
          finding(context, 'SOURCE_VERIFICATION_DATE_MISMATCH', `${basePath}.lastVerifiedDate`, `Mapping must use exact sealed verification date: ${source.last_verified_date}.`, 'SOURCE')
        );
      }

      if (!source.domain_coverage.includes(expectedDomain)) {
        findings.push(
          finding(context, 'SOURCE_OUTSIDE_REGISTERED_DOMAIN_BOUNDARY', `${basePath}.sourceId`, `${mapping.sourceId} is not registered for domain ${expectedDomain}.`, 'SOURCE')
        );
      }

      if (['DRAFT', 'WITHDRAWN', 'SUPERSEDED'].includes(source.effective_status)) {
        findings.push(
          finding(context, 'SOURCE_NOT_DECISION_ELIGIBLE', `${basePath}.sourceId`, `${mapping.sourceId} has non-decision-eligible effective status ${source.effective_status}.`, 'SOURCE')
        );
      }

      if (mapping.exactLocator.trim().split(/\s+/).length < 2) {
        findings.push(
          finding(context, 'SOURCE_LOCATOR_TOO_GENERIC', `${basePath}.exactLocator`, 'Locator is too generic; use a precise article, paragraph, clause, annex, numbered section, principle or control.', 'SOURCE')
        );
      }
    });
  }

  return result(context, findings);
}

export function validateFindingsAgainstValidatedGraph(
  atomic: AtomicDecompositionOutput,
  evidence: EvidenceArchitectureOutput,
  findingsOutput: FindingArchitectureOutput,
  context: CompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];
  const groups = [
    {
      path: 'capabilityFindings',
      items: findingsOutput.capabilityFindings,
      atomicIds: new Set(atomic.capabilitySubcriteria.map((item) => item.id)),
      evidenceIds: new Set(evidence.capabilityEvidence.map((item) => item.id))
    },
    {
      path: 'antipatternFindings',
      items: findingsOutput.antipatternFindings,
      atomicIds: new Set(atomic.antipatternTests.map((item) => item.id)),
      evidenceIds: new Set(evidence.antipatternEvidence.map((item) => item.id))
    }
  ];

  for (const group of groups) {
    group.items.forEach((item, index) => {
      for (const atomicId of item.mappedAtomicItemIds) {
        if (!group.atomicIds.has(atomicId)) {
          findings.push(
            finding(context, 'FINDING_UNKNOWN_ATOMIC_REFERENCE', `${group.path}.${index}.mappedAtomicItemIds`, `${atomicId} is absent from the validated atomic artifact.`)
          );
        }
      }
      for (const evidenceId of item.requiredEvidenceIds) {
        if (!group.evidenceIds.has(evidenceId)) {
          findings.push(
            finding(context, 'FINDING_UNKNOWN_EVIDENCE_REFERENCE', `${group.path}.${index}.requiredEvidenceIds`, `${evidenceId} is absent from the validated evidence artifact.`)
          );
        }
      }
    });
  }

  return result(context, findings);
}

export function validateTacticReferencesFailSafe(
  references: ReferenceMappingOutput,
  reciprocalMappings: readonly ApprovedTacticReciprocalMapping[] | null,
  context: CompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];
  const groups = [
    ['capabilityTacticRefs', context.expectedCapabilityId, references.capabilityTacticRefs],
    ['antipatternTacticRefs', context.expectedAntipatternId, references.antipatternTacticRefs]
  ] as const;

  for (const [path, objectId, tacticIds] of groups) {
    if (tacticIds.length > 0 && reciprocalMappings === null) {
      findings.push(
        finding(
          context,
          'TACTIC_CATALOG_NOT_MACHINE_VALIDATABLE',
          path,
          'Tactic references must remain empty until an approved machine-readable reciprocal mapping catalog is available.',
          'TACTIC'
        )
      );
      continue;
    }

    for (const tacticId of tacticIds) {
      const reciprocal = reciprocalMappings?.find(
        (mapping) => mapping.objectId === objectId && mapping.tacticId === tacticId && mapping.approved
      );
      if (!reciprocal) {
        findings.push(
          finding(context, 'TACTIC_RECIPROCAL_MAPPING_MISSING', path, `No exact approved reciprocal mapping exists for ${objectId} -> ${tacticId}.`, 'TACTIC')
        );
      }
    }
  }

  return result(context, findings);
}
