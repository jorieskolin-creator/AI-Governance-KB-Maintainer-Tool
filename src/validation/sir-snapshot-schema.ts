import { z } from 'zod';
import { SNAPSHOT_ROOT_TASK } from '../repair/qc-repair.js';

export const SNAPSHOT_SCHEMA_EMPTY_SECTION_NOTICE =
  'QC save rejected: a required snapshot section is empty or structurally incomplete. Empty objects do not satisfy SIR section contracts.';

const meaningful = z.string().trim().min(10);
const nonEmpty = z.string().trim().min(1);
const strings = z.array(nonEmpty).min(1);
const optionalStrings = z.array(nonEmpty);
const atomicHandle = z.string().regex(/^atomic_[0-9]{3}$/);
const evidenceHandle = z.string().regex(/^evidence_[0-9]{3}$/);
const findingHandle = z.string().regex(/^finding_[0-9]{3}$/);
const sourceHandle = z.string().regex(/^source_[0-9]{3}$/);
const locatorHandle = z.string().regex(/^locator_[0-9]{3}$/);
const criterionHandle = z.string().regex(/^criterion_[A-Za-z0-9._-]+$/);
const sha256 = z.string().trim().min(1);

const pairBoundarySchema = z
  .object({
    capability: z
      .object({
        canonicalDefinition: meaningful,
        governancePurpose: meaningful,
        distinctClaim: meaningful,
        ownedTopics: strings,
        excludedTopics: z.array(z.object({ criterionHandle: nonEmpty, ownershipBoundary: meaningful }).strict())
      })
      .strict(),
    antipattern: z.object({ canonicalDefinition: meaningful, pairedRelationship: meaningful }).strict(),
    boundaryRationale: meaningful
  })
  .strict();

const apFailureModelSchema = z
  .object({
    failureMechanism: meaningful,
    triggeringConditions: strings,
    observableFailureSurfaces: strings,
    nonExamples: strings,
    distinctionFromCapabilityGap: meaningful
  })
  .strict();

const applicabilityItem = z
  .object({
    statement: meaningful,
    conditions: strings,
    exclusions: optionalStrings,
    reassessmentTriggers: strings
  })
  .strict();

const applicabilitySchema = z
  .object({
    capability: applicabilityItem,
    antipattern: applicabilityItem,
    consistencyNotes: optionalStrings
  })
  .strict();

const question = z.object({ slot: z.union([z.literal(1), z.literal(2), z.literal(3)]), question: meaningful }).strict();
const primaryQuestionsSchema = z
  .object({
    capabilityQuestions: z.tuple([question, question, question]),
    antipatternQuestions: z.tuple([question, question, question]),
    coverageRationale: meaningful
  })
  .strict();

const atomicItem = z
  .object({
    handle: atomicHandle,
    questionSlot: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    statement: meaningful,
    evidenceNeed: meaningful
  })
  .strict();

const atomicsSchema = z
  .object({
    capability: z.array(atomicItem).min(3),
    antipattern: z.array(atomicItem).min(3)
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const side of ['capability', 'antipattern'] as const) {
      const handles = new Set<string>();
      const slots = new Set<number>();
      for (const [index, item] of value[side].entries()) {
        if (handles.has(item.handle)) {
          ctx.addIssue({
            code: 'custom',
            path: [side, index, 'handle'],
            message: `duplicate atomic handle ${item.handle}`
          });
        }
        handles.add(item.handle);
        slots.add(item.questionSlot);
      }
      for (const slot of [1, 2, 3] as const) {
        if (!slots.has(slot)) {
          ctx.addIssue({
            code: 'custom',
            path: [side],
            message: `must cover governed question slot ${slot}`
          });
        }
      }
    }
  });

const evidenceItem = z
  .object({
    handle: evidenceHandle,
    title: z.string().trim().min(3),
    claimSupported: meaningful,
    evidenceClass: nonEmpty,
    minimumTechnicalAssurance: nonEmpty,
    requiredHumanAssurance: nonEmpty,
    acceptanceConditions: strings,
    limitations: strings,
    supportsAtomicHandles: z.array(atomicHandle).min(1)
  })
  .strict();

const evidenceSchema = z
  .object({
    capability: z.array(evidenceItem).min(1),
    antipattern: z.array(evidenceItem).min(1)
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const side of ['capability', 'antipattern'] as const) {
      const handles = new Set<string>();
      for (const [index, item] of value[side].entries()) {
        if (handles.has(item.handle)) {
          ctx.addIssue({
            code: 'custom',
            path: [side, index, 'handle'],
            message: `duplicate evidence handle ${item.handle}`
          });
        }
        handles.add(item.handle);
      }
    }
  });

const evidenceRules = z
  .object({
    evidenceCeilings: strings,
    falsePositiveGuards: strings,
    prohibitedInferences: strings,
    contradictionHandling: strings,
    freshnessRules: strings
  })
  .strict();

const evidenceSafetySchema = z
  .object({
    capabilityRules: evidenceRules,
    antipatternRules: evidenceRules,
    crossPairSafetyNotes: optionalStrings
  })
  .strict();

const apAbsenceSchema = z
  .object({
    requiredArtifacts: strings,
    interpretationBoundary: meaningful
  })
  .strict();

const sourceMapping = z
  .object({
    sourceHandle,
    locatorHandle,
    sourceId: nonEmpty,
    sourceVersionOrDate: nonEmpty,
    exactLocator: nonEmpty,
    relationship: nonEmpty,
    supportedClaim: meaningful,
    categoryRationale: meaningful,
    applicabilityConditions: optionalStrings,
    exclusions: optionalStrings,
    verificationStatus: z.literal('VERIFIED'),
    lastVerifiedDate: nonEmpty,
    authorityTier: nonEmpty,
    authorityType: nonEmpty,
    locatorContextSha256: sha256
  })
  .strict();

const unmappedClaim = z
  .object({
    objectKind: z.enum(['CAPABILITY', 'ANTIPATTERN']),
    claim: meaningful,
    reason: z.enum([
      'INSUFFICIENT_SOURCE_CONTEXT',
      'NO_ALLOWED_SOURCE_SUPPORT',
      'APPLICABILITY_AMBIGUOUS',
      'RIGHTS_RESTRICTED_SOURCE_CONTEXT'
    ]),
    consideredSourceHandles: z.array(sourceHandle)
  })
  .strict();

const sourceMappingsSchema = z
  .object({
    sourceContextPacketSha256: sha256,
    capability: z.array(sourceMapping),
    antipattern: z.array(sourceMapping),
    unmappedClaims: z.array(unmappedClaim),
    mappingNotes: optionalStrings
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.capability.length === 0 && value.antipattern.length === 0 && value.unmappedClaims.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['unmappedClaims'],
        message:
          'sourceMappings cannot be empty on both mappings and unmappedClaims. Unsupported claims must be recorded, not implied by empty objects.'
      });
    }
  });

const capabilityFinding = z
  .object({
    handle: findingHandle,
    title: meaningful,
    eligibleConclusionStates: z
      .array(z.enum(['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE']))
      .min(1),
    atomicHandles: z.array(atomicHandle).min(1),
    evidenceHandles: z.array(evidenceHandle).min(1),
    defaultSeverity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKING']),
    lifecycleConsequence: meaningful,
    humanLockRequired: z.boolean()
  })
  .strict();

const antipatternFinding = z
  .object({
    handle: findingHandle,
    title: meaningful,
    eligibleConclusionStates: z
      .array(z.enum(['CONFIRMED_PRESENT', 'PARTIALLY_PRESENT', 'TESTED_ABSENT', 'UNKNOWN', 'NOT_APPLICABLE']))
      .min(1),
    atomicHandles: z.array(atomicHandle).min(1),
    evidenceHandles: z.array(evidenceHandle).min(1),
    defaultSeverity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'BLOCKING']),
    lifecycleConsequence: meaningful,
    humanLockRequired: z.boolean()
  })
  .strict();

const findingsSchema = z
  .object({
    capability: z.array(capabilityFinding).min(1),
    antipattern: z.array(antipatternFinding).min(1),
    findingLogicNotes: z.array(nonEmpty).min(1)
  })
  .strict();

const hardGate = z
  .object({
    effect: z.enum(['NONE', 'WARN', 'BLOCK', 'CONSTRAIN']),
    conditions: z.array(z.string().trim().min(3)),
    overrideAuthority: z.string().trim().min(3).nullable()
  })
  .strict();

const runtimeBoundary = z
  .object({
    machineMay: z.array(z.string().trim().min(3)).min(1),
    machineMustNot: z.array(z.string().trim().min(3)).min(1),
    humanAuthorityRequiredFor: z.array(z.string().trim().min(3)).min(1)
  })
  .strict();

const controlBoundarySchema = z
  .object({
    capabilityHardGate: hardGate,
    antipatternHardGate: hardGate,
    capabilityRuntimeBoundary: runtimeBoundary,
    antipatternRuntimeBoundary: runtimeBoundary,
    controlNotes: z.array(nonEmpty).min(1)
  })
  .strict();

const lifecycleTarget = z
  .object({
    lifecycleStage: nonEmpty,
    minimumTechnicalAssurance: z.enum(['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED']),
    requiredHumanAssurance: z.enum(['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'])
  })
  .strict();

const lifecycleTargetsSchema = z
  .object({
    capability: z.array(lifecycleTarget).min(1),
    antipattern: z.array(lifecycleTarget).min(1),
    rationaleNotes: z.array(nonEmpty).min(1)
  })
  .strict();

const relatedCriterion = z
  .object({
    criterionHandle,
    criterionId: z.string().regex(/^(AP-)?[A-F][1-5]$/),
    boundarySummary: meaningful
  })
  .strict();

const referenceMappingsSchema = z
  .object({
    capabilityRelatedCriteria: z.array(relatedCriterion).min(1),
    antipatternRelatedCriteria: z.array(relatedCriterion),
    capabilityTacticRefs: z.array(z.unknown()).length(0),
    antipatternTacticRefs: z.array(z.unknown()).length(0),
    referenceNotes: z.array(nonEmpty).min(1)
  })
  .strict();

const sectionSchemas: Record<string, z.ZodType> = {
  pairBoundary: pairBoundarySchema,
  apFailureModel: apFailureModelSchema,
  applicability: applicabilitySchema,
  primaryQuestions: primaryQuestionsSchema,
  atomics: atomicsSchema,
  evidence: evidenceSchema,
  evidenceSafety: evidenceSafetySchema,
  apAbsence: apAbsenceSchema,
  sourceMappings: sourceMappingsSchema,
  findings: findingsSchema,
  controlBoundary: controlBoundarySchema,
  lifecycleTargets: lifecycleTargetsSchema,
  referenceMappings: referenceMappingsSchema
};

function formatIssue(root: string, issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.length ? `${root}.${issue.path.map(String).join('.')}` : root;
  return `${path}: ${issue.message}`;
}

function handleSet(items: Array<{ handle?: unknown }> | undefined): Set<string> {
  return new Set((items ?? []).map((item) => String(item.handle ?? '')).filter(Boolean));
}

function addUnknownRefs(
  issues: string[],
  path: string,
  refs: string[] | undefined,
  allowed: Set<string>,
  kind: string
): void {
  for (const handle of refs ?? []) {
    if (!allowed.has(handle)) {
      issues.push(`${path} references unknown ${kind} ${handle}`);
    }
  }
}

function validateReferenceGraph(snapshot: Record<string, unknown>, issues: string[]): void {
  const atomics = snapshot.atomics as { capability?: Array<{ handle?: unknown }>; antipattern?: Array<{ handle?: unknown }> } | undefined;
  const evidence = snapshot.evidence as {
    capability?: Array<{ handle?: unknown; supportsAtomicHandles?: string[] }>;
    antipattern?: Array<{ handle?: unknown; supportsAtomicHandles?: string[] }>;
  } | undefined;
  const findings = snapshot.findings as {
    capability?: Array<{ atomicHandles?: string[]; evidenceHandles?: string[] }>;
    antipattern?: Array<{ atomicHandles?: string[]; evidenceHandles?: string[] }>;
  } | undefined;
  const capabilityAtomics = handleSet(atomics?.capability);
  const antipatternAtomics = handleSet(atomics?.antipattern);
  const capabilityEvidence = handleSet(evidence?.capability);
  const antipatternEvidence = handleSet(evidence?.antipattern);

  evidence?.capability?.forEach((item, index) => {
    addUnknownRefs(issues, `evidence.capability[${index}]`, item.supportsAtomicHandles, capabilityAtomics, 'atomic');
  });
  evidence?.antipattern?.forEach((item, index) => {
    addUnknownRefs(issues, `evidence.antipattern[${index}]`, item.supportsAtomicHandles, antipatternAtomics, 'atomic');
  });
  findings?.capability?.forEach((item, index) => {
    addUnknownRefs(issues, `findings.capability[${index}]`, item.atomicHandles, capabilityAtomics, 'atomic');
    addUnknownRefs(issues, `findings.capability[${index}]`, item.evidenceHandles, capabilityEvidence, 'evidence');
  });
  findings?.antipattern?.forEach((item, index) => {
    addUnknownRefs(issues, `findings.antipattern[${index}]`, item.atomicHandles, antipatternAtomics, 'atomic');
    addUnknownRefs(issues, `findings.antipattern[${index}]`, item.evidenceHandles, antipatternEvidence, 'evidence');
  });
}

export function schemaGateSnapshotIssues(snapshot: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const root of Object.keys(SNAPSHOT_ROOT_TASK)) {
    if (!(root in snapshot) || snapshot[root] == null) {
      issues.push(`Missing required snapshot section: ${root}`);
    }
  }
  for (const [root, schema] of Object.entries(sectionSchemas)) {
    if (!(root in snapshot) || snapshot[root] == null) continue;
    const parsed = schema.safeParse(snapshot[root]);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push(formatIssue(root, issue));
      }
    }
  }
  if (issues.length === 0) {
    validateReferenceGraph(snapshot, issues);
  }
  if (issues.length > 0 && !issues.some((item) => item.includes(SNAPSHOT_SCHEMA_EMPTY_SECTION_NOTICE))) {
    issues.unshift(SNAPSHOT_SCHEMA_EMPTY_SECTION_NOTICE);
  }
  return issues;
}

export function validMinimalSnapshotFixture(): Record<string, unknown> {
  return {
    pairBoundary: {
      capability: {
        canonicalDefinition: 'A2 defines evidence-based AI suitability and proportionality in a bounded decision context.',
        governancePurpose: 'Keep AI selection tied to a defined problem, alternatives, proportionality and expected value.',
        distinctClaim: 'A2 owns the quality of the AI-selection decision.',
        ownedTopics: ['AI suitability', 'proportionality'],
        excludedTopics: [{ criterionHandle: 'criterion_002', ownershipBoundary: 'A1 owns authoritative purpose definition.' }]
      },
      antipattern: {
        canonicalDefinition: 'AP-A2 captures solution-first AI selection without adequate problem, alternative and value justification.',
        pairedRelationship: 'AP-A2 is the failure mechanism paired with A2 suitability and proportionality.'
      },
      boundaryRationale: 'The pair is bounded around selection quality rather than purpose definition.'
    },
    apFailureModel: {
      failureMechanism: 'AI is predetermined before the problem and credible alternatives are adequately bounded.',
      triggeringConditions: ['Technology choice precedes proportionate problem and alternative analysis.'],
      observableFailureSurfaces: ['Decision records assume AI without comparing credible alternatives.'],
      nonExamples: ['A documented AI choice made after proportionate alternatives analysis.'],
      distinctionFromCapabilityGap: 'The anti-pattern requires solution-first logic, not merely incomplete maturity evidence.'
    },
    applicability: {
      capability: {
        statement: 'Applies when an organization makes or maintains a material decision to use AI for a defined purpose.',
        conditions: ['An AI solution decision is materially relevant.'],
        exclusions: [],
        reassessmentTriggers: ['Problem, alternatives, expected value or operating context changes materially.']
      },
      antipattern: {
        statement: 'Applies where the ordering and rationale of the AI-selection decision can be assessed.',
        conditions: ['Decision chronology and rationale are assessable.'],
        exclusions: [],
        reassessmentTriggers: ['New decision evidence changes the solution-selection chronology.']
      },
      consistencyNotes: ['Capability and anti-pattern remain independently assessable in the same decision scope.']
    },
    primaryQuestions: {
      capabilityQuestions: [
        { slot: 1, question: 'Is the AI-selection problem and intended value sufficiently bounded?' },
        { slot: 2, question: 'Was AI selected proportionately against credible implementation alternatives?' },
        { slot: 3, question: 'Does current evidence support the claimed suitability and expected value?' }
      ],
      antipatternQuestions: [
        { slot: 1, question: 'Is the solution-first failure mechanism clearly distinguishable from an ordinary evidence gap?' },
        { slot: 2, question: 'Did AI selection materially precede adequate problem and alternatives analysis?' },
        { slot: 3, question: 'Does current evidence support presence, uncertainty or tested absence of the failure mechanism?' }
      ],
      coverageRationale: 'The governed definition, operation and evidence dimensions are covered.'
    },
    atomics: {
      capability: [
        { handle: 'atomic_001', questionSlot: 1, statement: 'Problem and value hypothesis are explicit.', evidenceNeed: 'Authoritative problem and value record.' },
        { handle: 'atomic_002', questionSlot: 2, statement: 'Credible alternatives were proportionately considered.', evidenceNeed: 'Decision record comparing alternatives.' },
        { handle: 'atomic_003', questionSlot: 3, statement: 'Suitability and value claims have current evidence.', evidenceNeed: 'Current validation or operational evidence.' }
      ],
      antipattern: [
        { handle: 'atomic_001', questionSlot: 1, statement: 'Failure mechanism is distinguishable from ordinary immaturity.', evidenceNeed: 'Bounded failure-mechanism analysis.' },
        { handle: 'atomic_002', questionSlot: 2, statement: 'AI choice preceded adequate problem and alternatives analysis.', evidenceNeed: 'Decision chronology and rationale.' },
        { handle: 'atomic_003', questionSlot: 3, statement: 'Presence or tested absence is supported by current evidence.', evidenceNeed: 'Current independent test evidence.' }
      ]
    },
    evidence: {
      capability: [
        {
          handle: 'evidence_001',
          title: 'Problem and value record',
          claimSupported: 'The problem and expected value are explicitly bounded.',
          evidenceClass: 'DECISION_RECORD',
          minimumTechnicalAssurance: 'DECLARED',
          requiredHumanAssurance: 'HUMAN_VALIDATED',
          acceptanceConditions: ['Record is current and attributable.'],
          limitations: ['Document presence alone does not prove effectiveness.'],
          supportsAtomicHandles: ['atomic_001']
        }
      ],
      antipattern: [
        {
          handle: 'evidence_001',
          title: 'Failure-mechanism analysis',
          claimSupported: 'The solution-first mechanism can be distinguished from ordinary immaturity.',
          evidenceClass: 'ANALYSIS_RECORD',
          minimumTechnicalAssurance: 'DECLARED',
          requiredHumanAssurance: 'HUMAN_VALIDATED',
          acceptanceConditions: ['Mechanism and scope are explicit.'],
          limitations: ['Definition alone does not prove presence.'],
          supportsAtomicHandles: ['atomic_001']
        }
      ]
    },
    evidenceSafety: {
      capabilityRules: {
        evidenceCeilings: ['Intent does not prove effectiveness.'],
        falsePositiveGuards: ['Require attributable evidence.'],
        prohibitedInferences: ['Do not infer approval.'],
        contradictionHandling: ['Conflicts keep conclusions unresolved.'],
        freshnessRules: ['Evidence must remain current.']
      },
      antipatternRules: {
        evidenceCeilings: ['Concern alone does not prove the failure mechanism.'],
        falsePositiveGuards: ['Distinguish ordinary maturity gaps.'],
        prohibitedInferences: ['Do not infer absence from silence.'],
        contradictionHandling: ['Conflicts prevent definitive absence.'],
        freshnessRules: ['Absence evidence must remain current.']
      },
      crossPairSafetyNotes: ['Capability and anti-pattern conclusions remain independent.']
    },
    apAbsence: {
      requiredArtifacts: ['Scoped executed absence test', 'Independent verification record'],
      interpretationBoundary: 'TESTED_ABSENT requires scoped, executed, successful, current and independently verified testing.'
    },
    sourceMappings: {
      sourceContextPacketSha256: '2'.repeat(64),
      capability: [],
      antipattern: [],
      unmappedClaims: [
        {
          objectKind: 'CAPABILITY',
          claim: 'Suitability and value claims are not yet bound to an allowed exact locator.',
          reason: 'INSUFFICIENT_SOURCE_CONTEXT',
          consideredSourceHandles: []
        }
      ],
      mappingNotes: ['Source context is insufficient; claims remain explicitly unmapped.']
    },
    findings: {
      capability: [
        {
          handle: 'finding_001',
          title: 'Suitability evidence is materially insufficient.',
          eligibleConclusionStates: ['NOT_SATISFIED', 'UNKNOWN'],
          atomicHandles: ['atomic_003'],
          evidenceHandles: ['evidence_001'],
          defaultSeverity: 'HIGH',
          lifecycleConsequence: 'Constrain progression pending evidence.',
          humanLockRequired: true
        }
      ],
      antipattern: [
        {
          handle: 'finding_001',
          title: 'Solution-first decision logic is materially evidenced.',
          eligibleConclusionStates: ['CONFIRMED_PRESENT', 'UNKNOWN'],
          atomicHandles: ['atomic_002'],
          evidenceHandles: ['evidence_001'],
          defaultSeverity: 'HIGH',
          lifecycleConsequence: 'Require human review before progression.',
          humanLockRequired: true
        }
      ],
      findingLogicNotes: ['Findings remain evidence-bounded reusable knowledge definitions.']
    },
    controlBoundary: {
      capabilityHardGate: { effect: 'CONSTRAIN', conditions: ['Material suitability evidence remains unresolved.'], overrideAuthority: 'Designated accountable human authority' },
      antipatternHardGate: { effect: 'BLOCK', conditions: ['Solution-first failure mechanism is confirmed.'], overrideAuthority: 'Designated accountable human authority' },
      capabilityRuntimeBoundary: { machineMay: ['Summarize validated evidence.'], machineMustNot: ['Approve progression.'], humanAuthorityRequiredFor: ['Any progression or exception decision.'] },
      antipatternRuntimeBoundary: { machineMay: ['Surface validated failure indicators.'], machineMustNot: ['Accept residual risk.'], humanAuthorityRequiredFor: ['Any residual-risk or progression decision.'] },
      controlNotes: ['Control semantics do not authorize a real system.']
    },
    lifecycleTargets: {
      capability: [{ lifecycleStage: 'DEPLOYMENT', minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'HUMAN_VALIDATED' }],
      antipattern: [{ lifecycleStage: 'DEPLOYMENT', minimumTechnicalAssurance: 'TESTED', requiredHumanAssurance: 'HUMAN_VALIDATED' }],
      rationaleNotes: ['Lifecycle assurance values are reusable knowledge targets.']
    },
    referenceMappings: {
      capabilityRelatedCriteria: [{ criterionHandle: 'criterion_001', criterionId: 'AP-A2', boundarySummary: 'Paired anti-pattern boundary for the suitability decision.' }],
      antipatternRelatedCriteria: [{ criterionHandle: 'criterion_002', criterionId: 'A1', boundarySummary: 'Purpose-boundary dependency that must remain distinct from suitability.' }],
      capabilityTacticRefs: [],
      antipatternTacticRefs: [],
      referenceNotes: ['Related criteria remain bounded to the Authoring Plan universe.']
    }
  };
}
