import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const nonEmptyString = z.string().trim().min(1);
const meaningfulString = z.string().trim().min(10);
const stringList = z.array(nonEmptyString).min(1);

const excludedTopicSchema = z
  .object({
    criterionId: z.string().regex(/^(AP-)?[A-F][1-5]$/),
    ownershipBoundary: meaningfulString
  })
  .strict();

export const pairBoundaryOutputSchema = z
  .object({
    pairId: nonEmptyString,
    capabilityId: z.string().regex(/^[A-F][1-5]$/),
    antipatternId: z.string().regex(/^AP-[A-F][1-5]$/),
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
    antipatternId: z.string().regex(/^AP-[A-F][1-5]$/),
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
    capabilityId: z.string().regex(/^[A-F][1-5]$/),
    antipatternId: z.string().regex(/^AP-[A-F][1-5]$/),
    capability: applicabilityObjectSchema,
    antipattern: applicabilityObjectSchema,
    consistencyNotes: z.array(nonEmptyString)
  })
  .strict();

const OUTPUT_SCHEMAS: Partial<Record<CognitiveTaskType, z.ZodType>> = {
  PAIR_BOUNDARY: pairBoundaryOutputSchema,
  AP_FAILURE_MODEL: apFailureModelOutputSchema,
  APPLICABILITY: applicabilityOutputSchema
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
