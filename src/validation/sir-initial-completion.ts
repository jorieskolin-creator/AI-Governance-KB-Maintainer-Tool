import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const meaningful = z.string().trim().min(10);
const nonEmpty = z.string().trim().min(1);
const strings = z.array(nonEmpty).min(1);

const boundarySchema = z.object({
  capability: z.object({
    canonicalDefinition: meaningful,
    governancePurpose: meaningful,
    distinctClaim: meaningful,
    ownedTopics: strings,
    excludedTopics: z.array(z.object({ criterionHandle: nonEmpty, ownershipBoundary: meaningful }).strict())
  }).strict(),
  antipattern: z.object({ canonicalDefinition: meaningful, pairedRelationship: meaningful }).strict(),
  boundaryRationale: meaningful
}).strict();

const failureSchema = z.object({
  failureMechanism: meaningful,
  triggeringConditions: strings,
  observableFailureSurfaces: strings,
  nonExamples: strings,
  distinctionFromCapabilityGap: meaningful
}).strict();

const applicabilityItem = z.object({
  statement: meaningful,
  conditions: strings,
  exclusions: z.array(nonEmpty),
  reassessmentTriggers: strings
}).strict();
const applicabilitySchema = z.object({
  capability: applicabilityItem,
  antipattern: applicabilityItem,
  consistencyNotes: z.array(nonEmpty)
}).strict();

const question = z.object({ slot: z.union([z.literal(1), z.literal(2), z.literal(3)]), question: meaningful }).strict();
const questionsSchema = z.object({
  capabilityQuestions: z.tuple([question, question, question]),
  antipatternQuestions: z.tuple([question, question, question]),
  coverageRationale: meaningful
}).strict();

const schemas: Partial<Record<CognitiveTaskType, z.ZodType>> = {
  PAIR_BOUNDARY: boundarySchema,
  AP_FAILURE_MODEL: failureSchema,
  APPLICABILITY: applicabilitySchema,
  PRIMARY_QUESTIONS: questionsSchema
};

const forbiddenIdentityKeys = new Set([
  'pairId','pair_id','capabilityId','capability_id','antipatternId','antipattern_id',
  'schemaVersion','schema_version','releaseStatus','release_status','domain','objectType','object_type','version'
]);

export interface SirInitialCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(context: SirInitialCompletionContext, checkId: string, objectPath: string, issue: string): ValidationFinding {
  return { checkId, kind: 'SCHEMA', severity: 'BLOCKING', objectId: context.expectedPairId, objectPath, issue, dependencyScope: [] };
}

function report(context: SirInitialCompletionContext, findings: ValidationFinding[]): ValidationReport {
  return { runId: context.runId, objectId: context.expectedPairId, passed: findings.length === 0, findings };
}

function walkForbiddenKeys(value: unknown, path: string, context: SirInitialCompletionContext, findings: ValidationFinding[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForbiddenKeys(item, `${path}/${index}`, context, findings));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}/${key}`;
    if (forbiddenIdentityKeys.has(key)) {
      findings.push(finding(context, 'SIR_CANONICAL_IDENTITY_FORBIDDEN', childPath, `${key} is compiler/Authoring Plan owned and must not appear in model SIR output.`));
    }
    walkForbiddenKeys(child, childPath, context, findings);
  }
}

function validatePrerequisites(contract: TaskContract, completed: ReadonlySet<CognitiveTaskType>, context: SirInitialCompletionContext, findings: ValidationFinding[]): void {
  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(finding(context, 'SIR_PREREQUISITE_MISSING', '/', `${contract.taskType} requires validated ${prerequisite}.`));
    }
  }
}

function validateBoundaryHandles(contract: TaskContract, output: Record<string, unknown>, context: SirInitialCompletionContext, findings: ValidationFinding[]): void {
  const adjacent = (contract.lockedInputs.adjacent_criteria as Array<Record<string, unknown>> | undefined) ?? [];
  const allowed = new Set(adjacent.map((item) => String(item.criterionHandle ?? '')));
  const capability = output.capability as Record<string, unknown> | undefined;
  const excluded = (capability?.excludedTopics as Array<Record<string, unknown>> | undefined) ?? [];
  for (const [index, item] of excluded.entries()) {
    const handle = String(item.criterionHandle ?? '');
    if (!allowed.has(handle)) {
      findings.push(finding(context, 'SIR_ADJACENT_HANDLE_RESOLVES', `/capability/excludedTopics/${index}/criterionHandle`, `${handle} is not present in the sealed Authoring Plan adjacent-criteria universe.`));
    }
  }
}

function validateQuestionSlots(output: Record<string, unknown>, context: SirInitialCompletionContext, findings: ValidationFinding[]): void {
  for (const path of ['capabilityQuestions', 'antipatternQuestions'] as const) {
    const items = (output[path] as Array<Record<string, unknown>> | undefined) ?? [];
    items.forEach((item, index) => {
      const expectedSlot = index + 1;
      if (item.slot !== expectedSlot) {
        findings.push(finding(context, 'SIR_QUESTION_SLOT_ORDER', `/${path}/${index}/slot`, `Expected governed slot ${expectedSlot}; canonical question ID and dimension will be materialized later.`));
      }
    });
  }
}

export function validateSirInitialCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirInitialCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];
  if (contract.contractVersion !== '2.0.0') {
    findings.push(finding(context, 'SIR_CONTRACT_VERSION', '/', `Initial SIR completion requires contractVersion 2.0.0; received ${contract.contractVersion}.`));
    return report(context, findings);
  }
  validatePrerequisites(contract, completed, context, findings);
  const schema = schemas[contract.taskType];
  if (!schema) {
    findings.push(finding(context, 'SIR_COMPLETION_SCHEMA_MISSING', '/', `No SIR completion schema for ${contract.taskType}.`));
    return report(context, findings);
  }
  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    for (const item of parsed.error.issues) {
      findings.push(finding(context, 'SIR_OUTPUT_CONTRACT', `/${item.path.join('/')}`, item.message));
    }
    return report(context, findings);
  }
  walkForbiddenKeys(parsed.data, '', context, findings);
  const record = parsed.data as Record<string, unknown>;
  if (contract.taskType === 'PAIR_BOUNDARY') validateBoundaryHandles(contract, record, context, findings);
  if (contract.taskType === 'PRIMARY_QUESTIONS') validateQuestionSlots(record, context, findings);
  return report(context, findings);
}
