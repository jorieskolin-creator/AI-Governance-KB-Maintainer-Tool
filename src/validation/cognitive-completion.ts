import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const nonEmptyString = z.string().trim().min(1);
const meaningfulString = z.string().trim().min(10);
const stringList = z.array(nonEmptyString).min(1);

const capabilityIdSchema = z.string().regex(/^[A-F][1-5]$/);
const antipatternIdSchema = z.string().regex(/^AP-[A-F][1-5]$/);

const excludedTopicSchema = z
  .object({
    criterionId: z.string().regex(/^(AP-)?[A-F][1-5]$/),
    ownershipBoundary: meaningfulString
  })
  .strict();

export const pairBoundaryOutputSchema = z
  .object({
    pairId: nonEmptyString,
    capabilityId: capabilityIdSchema,
    antipatternId: antipatternIdSchema,
    capability: z
      .object({
        canonicalDefinition: meaningfulString,
        governancePurpose: meaningfulString,
        distinctClaim: meaningfulString,
        ownedTopics: stringList,
        excludedTopics: z.array(excludedTopicSchema)
      })
      .strict(),
    antipattern: z
      .object({
        canonicalDefinition: meaningfulString,
        pairedRelationship: meaningfulString
      })
      .strict(),
    boundaryRationale: meaningfulString
  })
  .strict();

export const apFailureModelOutputSchema = z
  .object({
    antipatternId: antipatternIdSchema,
    failureMechanism: meaningfulString,
    triggeringConditions: stringList,
    observableFailureSurfaces: stringList,
    nonExamples: stringList,
    distinctionFromCapabilityGap: meaningfulString
  })
  .strict();

const applicabilityObjectSchema = z
  .object({
    statement: meaningfulString,
    conditions: stringList,
    exclusions: z.array(nonEmptyString),
    reassessmentTriggers: stringList
  })
  .strict();

export const applicabilityOutputSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    antipatternId: antipatternIdSchema,
    capability: applicabilityObjectSchema,
    antipattern: applicabilityObjectSchema,
    consistencyNotes: z.array(nonEmptyString)
  })
  .strict();

const dimensionSchema = z.enum([
  'DEFINITION_AND_INTENT',
  'IMPLEMENTATION_AND_OPERATION',
  'EVIDENCE_AND_EFFECTIVENESS'
]);

const primaryQuestionSchema = z
  .object({
    id: nonEmptyString,
    dimension: dimensionSchema,
    question: meaningfulString
  })
  .strict();

export const primaryQuestionsOutputSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    antipatternId: antipatternIdSchema,
    capabilityQuestions: z.tuple([
      primaryQuestionSchema,
      primaryQuestionSchema,
      primaryQuestionSchema
    ]),
    antipatternQuestions: z.tuple([
      primaryQuestionSchema,
      primaryQuestionSchema,
      primaryQuestionSchema
    ]),
    coverageRationale: meaningfulString
  })
  .strict();

const capabilityAtomicDraftSchema = z
  .object({
    id: z.string().regex(/^[A-F][1-5]-SC-[0-9]{3}$/),
    questionId: z.string().regex(/^[A-F][1-5]-Q[1-3]$/),
    criterion: meaningfulString,
    evidenceNeed: meaningfulString
  })
  .strict();

const antipatternAtomicDraftSchema = z
  .object({
    id: z.string().regex(/^AP-[A-F][1-5]-AT-[0-9]{3}$/),
    questionId: z.string().regex(/^AP-[A-F][1-5]-Q[1-3]$/),
    test: meaningfulString,
    evidenceNeed: meaningfulString
  })
  .strict();

export const atomicDecompositionOutputSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    antipatternId: antipatternIdSchema,
    capabilitySubcriteria: z.array(capabilityAtomicDraftSchema).min(3),
    antipatternTests: z.array(antipatternAtomicDraftSchema).min(3),
    coverageNotes: z.array(nonEmptyString)
  })
  .strict();

const technicalAssuranceSchema = z.enum([
  'UNKNOWN',
  'DECLARED',
  'IMPLEMENTED',
  'TESTED',
  'OPERATIONALLY_OBSERVED'
]);

const humanAssuranceSchema = z.enum(['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED']);

const evidenceRequirementDraftSchema = z
  .object({
    id: z.string().regex(/^EVD-(AP-)?[A-F][1-5]-[0-9]{3}$/),
    title: z.string().trim().min(3),
    claimSupported: meaningfulString,
    evidenceClass: nonEmptyString,
    minimumTechnicalAssurance: technicalAssuranceSchema,
    requiredHumanAssurance: humanAssuranceSchema,
    acceptanceConditions: stringList,
    limitations: stringList
  })
  .strict();

const atomicEvidenceBindingSchema = z
  .object({
    atomicItemId: nonEmptyString,
    evidenceIds: z.array(z.string().regex(/^EVD-/)).min(1)
  })
  .strict();

export const evidenceArchitectureOutputSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    antipatternId: antipatternIdSchema,
    capabilityEvidence: z.array(evidenceRequirementDraftSchema).min(1),
    antipatternEvidence: z.array(evidenceRequirementDraftSchema).min(1),
    capabilityBindings: z.array(atomicEvidenceBindingSchema).min(1),
    antipatternBindings: z.array(atomicEvidenceBindingSchema).min(1),
    sufficiencyNotes: z.array(nonEmptyString)
  })
  .strict();

const evidenceRulesDraftSchema = z
  .object({
    evidenceCeilings: stringList,
    falsePositiveGuards: stringList,
    prohibitedInferences: stringList,
    contradictionHandling: stringList,
    freshnessRules: stringList
  })
  .strict();

export const evidenceSafetyOutputSchema = z
  .object({
    capabilityId: capabilityIdSchema,
    antipatternId: antipatternIdSchema,
    capabilityRules: evidenceRulesDraftSchema,
    antipatternRules: evidenceRulesDraftSchema,
    crossPairSafetyNotes: z.array(nonEmptyString)
  })
  .strict();

const OUTPUT_SCHEMAS: Partial<Record<CognitiveTaskType, z.ZodType>> = {
  PAIR_BOUNDARY: pairBoundaryOutputSchema,
  AP_FAILURE_MODEL: apFailureModelOutputSchema,
  APPLICABILITY: applicabilityOutputSchema,
  PRIMARY_QUESTIONS: primaryQuestionsOutputSchema,
  ATOMIC_DECOMPOSITION: atomicDecompositionOutputSchema,
  EVIDENCE_ARCHITECTURE: evidenceArchitectureOutputSchema,
  EVIDENCE_SAFETY: evidenceSafetyOutputSchema
};

export interface CompletionContext {
  runId: string;
  expectedPairId: string;
  expectedCapabilityId: string;
  expectedAntipatternId: string;
}

function finding(
  context: CompletionContext,
  checkId: string,
  objectPath: string,
  issue: string
): ValidationFinding {
  return {
    checkId,
    kind: 'SCHEMA',
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: []
  };
}

function validatePairIds(
  value: Record<string, unknown>,
  context: CompletionContext,
  findings: ValidationFinding[]
): void {
  const capabilityId = value.capabilityId;
  const antipatternId = value.antipatternId;
  const pairId = value.pairId;

  if (capabilityId !== undefined && capabilityId !== context.expectedCapabilityId) {
    findings.push(
      finding(
        context,
        'CAPABILITY_ID_MATCH',
        'capabilityId',
        `Expected ${context.expectedCapabilityId}, received ${String(capabilityId)}.`
      )
    );
  }

  if (antipatternId !== undefined && antipatternId !== context.expectedAntipatternId) {
    findings.push(
      finding(
        context,
        'ANTIPATTERN_ID_MATCH',
        'antipatternId',
        `Expected ${context.expectedAntipatternId}, received ${String(antipatternId)}.`
      )
    );
  }

  if (pairId !== undefined && pairId !== context.expectedPairId) {
    findings.push(
      finding(
        context,
        'PAIR_ID_MATCH',
        'pairId',
        `Expected ${context.expectedPairId}, received ${String(pairId)}.`
      )
    );
  }

  if (
    capabilityId !== undefined &&
    antipatternId !== undefined &&
    antipatternId !== `AP-${String(capabilityId)}`
  ) {
    findings.push(
      finding(
        context,
        'PAIR_ID_COHERENCE',
        'antipatternId',
        'The anti-pattern ID must be the exact paired AP-* ID of the capability.'
      )
    );
  }
}

function validatePrimaryQuestionIds(
  value: Record<string, unknown>,
  context: CompletionContext,
  findings: ValidationFinding[]
): void {
  const expectedDimensions = [
    'DEFINITION_AND_INTENT',
    'IMPLEMENTATION_AND_OPERATION',
    'EVIDENCE_AND_EFFECTIVENESS'
  ];
  const groups = [
    {
      path: 'capabilityQuestions',
      items: value.capabilityQuestions as Array<Record<string, unknown>> | undefined,
      prefix: context.expectedCapabilityId
    },
    {
      path: 'antipatternQuestions',
      items: value.antipatternQuestions as Array<Record<string, unknown>> | undefined,
      prefix: context.expectedAntipatternId
    }
  ];

  for (const group of groups) {
    if (!group.items) continue;
    group.items.forEach((item, index) => {
      const expectedId = `${group.prefix}-Q${index + 1}`;
      if (item.id !== expectedId) {
        findings.push(
          finding(
            context,
            'QUESTION_ID_MATCH',
            `${group.path}.${index}.id`,
            `Expected ${expectedId}, received ${String(item.id)}.`
          )
        );
      }
      if (item.dimension !== expectedDimensions[index]) {
        findings.push(
          finding(
            context,
            'QUESTION_DIMENSION_ORDER',
            `${group.path}.${index}.dimension`,
            `Expected ${expectedDimensions[index]}, received ${String(item.dimension)}.`
          )
        );
      }
    });
  }
}

function validateAtomicDecomposition(
  value: Record<string, unknown>,
  context: CompletionContext,
  findings: ValidationFinding[]
): void {
  const capabilityItems = value.capabilitySubcriteria as Array<Record<string, unknown>> | undefined;
  const antipatternItems = value.antipatternTests as Array<Record<string, unknown>> | undefined;

  const groups = [
    {
      path: 'capabilitySubcriteria',
      items: capabilityItems,
      idPrefix: `${context.expectedCapabilityId}-SC-`,
      questionPrefix: context.expectedCapabilityId
    },
    {
      path: 'antipatternTests',
      items: antipatternItems,
      idPrefix: `${context.expectedAntipatternId}-AT-`,
      questionPrefix: context.expectedAntipatternId
    }
  ];

  for (const group of groups) {
    if (!group.items) continue;
    const coveredQuestions = new Set<string>();
    group.items.forEach((item, index) => {
      const expectedId = `${group.idPrefix}${String(index + 1).padStart(3, '0')}`;
      if (item.id !== expectedId) {
        findings.push(
          finding(
            context,
            'ATOMIC_ID_SEQUENCE',
            `${group.path}.${index}.id`,
            `Expected deterministic ID ${expectedId}, received ${String(item.id)}.`
          )
        );
      }
      const questionId = String(item.questionId ?? '');
      if (!new RegExp(`^${group.questionPrefix}-Q[1-3]$`).test(questionId)) {
        findings.push(
          finding(
            context,
            'ATOMIC_QUESTION_REFERENCE',
            `${group.path}.${index}.questionId`,
            `Question reference ${questionId} does not resolve to the current object.`
          )
        );
      } else {
        coveredQuestions.add(questionId);
      }
    });

    for (let index = 1; index <= 3; index += 1) {
      const expectedQuestion = `${group.questionPrefix}-Q${index}`;
      if (!coveredQuestions.has(expectedQuestion)) {
        findings.push(
          finding(
            context,
            'PRIMARY_QUESTION_COVERAGE',
            group.path,
            `No atomic item covers required question ${expectedQuestion}.`
          )
        );
      }
    }
  }
}

function validateEvidenceArchitecture(
  value: Record<string, unknown>,
  context: CompletionContext,
  findings: ValidationFinding[]
): void {
  const groups = [
    {
      evidencePath: 'capabilityEvidence',
      evidence: value.capabilityEvidence as Array<Record<string, unknown>> | undefined,
      bindingsPath: 'capabilityBindings',
      bindings: value.capabilityBindings as Array<Record<string, unknown>> | undefined,
      evidencePrefix: `EVD-${context.expectedCapabilityId}-`,
      atomicPattern: new RegExp(`^${context.expectedCapabilityId}-SC-[0-9]{3}$`)
    },
    {
      evidencePath: 'antipatternEvidence',
      evidence: value.antipatternEvidence as Array<Record<string, unknown>> | undefined,
      bindingsPath: 'antipatternBindings',
      bindings: value.antipatternBindings as Array<Record<string, unknown>> | undefined,
      evidencePrefix: `EVD-${context.expectedAntipatternId}-`,
      atomicPattern: new RegExp(`^${context.expectedAntipatternId}-AT-[0-9]{3}$`)
    }
  ];

  for (const group of groups) {
    if (!group.evidence || !group.bindings) continue;
    const evidenceIds = new Set<string>();
    group.evidence.forEach((item, index) => {
      const expectedId = `${group.evidencePrefix}${String(index + 1).padStart(3, '0')}`;
      const actualId = String(item.id ?? '');
      evidenceIds.add(actualId);
      if (actualId !== expectedId) {
        findings.push(
          finding(
            context,
            'EVIDENCE_ID_SEQUENCE',
            `${group.evidencePath}.${index}.id`,
            `Expected deterministic ID ${expectedId}, received ${actualId}.`
          )
        );
      }
    });

    const usedEvidence = new Set<string>();
    const boundAtomic = new Set<string>();
    for (let index = 0; index < group.bindings.length; index += 1) {
      const binding = group.bindings[index] ?? {};
      const atomicItemId = String(binding.atomicItemId ?? '');
      if (!group.atomicPattern.test(atomicItemId)) {
        findings.push(
          finding(
            context,
            'ATOMIC_BINDING_REFERENCE',
            `${group.bindingsPath}.${index}.atomicItemId`,
            `Atomic item ${atomicItemId} does not belong to the current object.`
          )
        );
      }
      boundAtomic.add(atomicItemId);

      const ids = (binding.evidenceIds as string[] | undefined) ?? [];
      for (const id of ids) {
        if (!evidenceIds.has(id)) {
          findings.push(
            finding(
              context,
              'EVIDENCE_BINDING_REFERENCE',
              `${group.bindingsPath}.${index}.evidenceIds`,
              `Evidence ID ${id} does not resolve in ${group.evidencePath}.`
            )
          );
        } else {
          usedEvidence.add(id);
        }
      }
    }

    for (const id of evidenceIds) {
      if (!usedEvidence.has(id)) {
        findings.push(
          finding(
            context,
            'UNUSED_EVIDENCE_OBJECT',
            group.evidencePath,
            `Evidence object ${id} is not bound to any atomic item.`
          )
        );
      }
    }

    if (boundAtomic.size !== group.bindings.length) {
      findings.push(
        finding(
          context,
          'DUPLICATE_ATOMIC_BINDING',
          group.bindingsPath,
          'Each atomic item must have exactly one binding object; combine multiple evidence IDs into that binding.'
        )
      );
    }
  }
}

export function validateTaskPrerequisites(
  contract: TaskContract,
  completedTaskTypes: ReadonlySet<CognitiveTaskType>,
  context: CompletionContext
): ValidationReport {
  const findings = contract.upstreamTaskTypes
    .filter((taskType) => !completedTaskTypes.has(taskType))
    .map((taskType) =>
      finding(
        context,
        `TASK_PREREQUISITE_${taskType}`,
        'upstreamTaskTypes',
        `Required validated upstream task ${taskType} is missing.`
      )
    );

  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

export function validateCognitiveTaskCompletion(
  taskType: CognitiveTaskType,
  output: unknown,
  context: CompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];
  const schema = OUTPUT_SCHEMAS[taskType];

  if (!schema) {
    findings.push(
      finding(
        context,
        'TASK_COMPLETION_SCHEMA_NOT_IMPLEMENTED',
        taskType,
        `No deterministic completion schema has been implemented yet for ${taskType}.`
      )
    );
    return {
      runId: context.runId,
      objectId: context.expectedPairId,
      passed: false,
      findings
    };
  }

  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        finding(
          context,
          'TASK_OUTPUT_CONTRACT',
          issue.path.join('.') || taskType,
          issue.message
        )
      );
    }
  } else {
    const value = parsed.data as Record<string, unknown>;
    validatePairIds(value, context, findings);

    if (taskType === 'PRIMARY_QUESTIONS') {
      validatePrimaryQuestionIds(value, context, findings);
    }
    if (taskType === 'ATOMIC_DECOMPOSITION') {
      validateAtomicDecomposition(value, context, findings);
    }
    if (taskType === 'EVIDENCE_ARCHITECTURE') {
      validateEvidenceArchitecture(value, context, findings);
    }
  }

  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

export function canPersistTaskAsCompleted(
  contract: TaskContract,
  completedTaskTypes: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: CompletionContext
): ValidationReport {
  const prerequisiteReport = validateTaskPrerequisites(contract, completedTaskTypes, context);
  if (!prerequisiteReport.passed) return prerequisiteReport;

  return validateCognitiveTaskCompletion(contract.taskType, output, context);
}
