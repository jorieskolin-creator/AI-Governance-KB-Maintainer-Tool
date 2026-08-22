import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const nonEmpty = z.string().trim().min(1);
const meaningful = z.string().trim().min(10);
const strings = z.array(nonEmpty).min(1);
const capabilityId = z.string().regex(/^[A-F][1-5]$/);
const antipatternId = z.string().regex(/^AP-[A-F][1-5]$/);
const pairIds = { capabilityId, antipatternId };

const pairBoundarySchema = z.object({
  pairId: nonEmpty,
  capabilityId,
  antipatternId,
  capability: z.object({
    canonicalDefinition: meaningful,
    governancePurpose: meaningful,
    distinctClaim: meaningful,
    ownedTopics: strings,
    excludedTopics: z.array(z.object({ criterionId: z.string().regex(/^(AP-)?[A-F][1-5]$/), ownershipBoundary: meaningful }).strict())
  }).strict(),
  antipattern: z.object({ canonicalDefinition: meaningful, pairedRelationship: meaningful }).strict(),
  boundaryRationale: meaningful
}).strict();

const apFailureSchema = z.object({
  antipatternId,
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
const applicabilitySchema = z.object({ ...pairIds, capability: applicabilityItem, antipattern: applicabilityItem, consistencyNotes: z.array(nonEmpty) }).strict();

const dimensions = z.enum(['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS']);
const question = z.object({ id: nonEmpty, dimension: dimensions, question: meaningful }).strict();
const primaryQuestionsSchema = z.object({
  ...pairIds,
  capabilityQuestions: z.tuple([question, question, question]),
  antipatternQuestions: z.tuple([question, question, question]),
  coverageRationale: meaningful
}).strict();

const capabilityAtomic = z.object({ id: z.string().regex(/^[A-F][1-5]-SC-[0-9]{3}$/), questionId: z.string().regex(/^[A-F][1-5]-Q[1-3]$/), criterion: meaningful, evidenceNeed: meaningful }).strict();
const antipatternAtomic = z.object({ id: z.string().regex(/^AP-[A-F][1-5]-AT-[0-9]{3}$/), questionId: z.string().regex(/^AP-[A-F][1-5]-Q[1-3]$/), test: meaningful, evidenceNeed: meaningful }).strict();
const atomicSchema = z.object({ ...pairIds, capabilitySubcriteria: z.array(capabilityAtomic).min(3), antipatternTests: z.array(antipatternAtomic).min(3), coverageNotes: z.array(nonEmpty) }).strict();

const technicalAssurance = z.enum(['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED']);
const humanAssurance = z.enum(['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED']);
const evidence = z.object({
  id: z.string().regex(/^EVD-(AP-)?[A-F][1-5]-[0-9]{3}$/),
  title: z.string().trim().min(3),
  claimSupported: meaningful,
  evidenceClass: nonEmpty,
  minimumTechnicalAssurance: technicalAssurance,
  requiredHumanAssurance: humanAssurance,
  acceptanceConditions: strings,
  limitations: strings
}).strict();
const binding = z.object({ atomicItemId: nonEmpty, evidenceIds: z.array(z.string().regex(/^EVD-/)).min(1) }).strict();
const evidenceArchitectureSchema = z.object({ ...pairIds, capabilityEvidence: z.array(evidence).min(1), antipatternEvidence: z.array(evidence).min(1), capabilityBindings: z.array(binding).min(1), antipatternBindings: z.array(binding).min(1), sufficiencyNotes: z.array(nonEmpty) }).strict();

const evidenceRules = z.object({ evidenceCeilings: strings, falsePositiveGuards: strings, prohibitedInferences: strings, contradictionHandling: strings, freshnessRules: strings }).strict();
const evidenceSafetySchema = z.object({ ...pairIds, capabilityRules: evidenceRules, antipatternRules: evidenceRules, crossPairSafetyNotes: z.array(nonEmpty) }).strict();

const apAbsenceSchema = z.object({
  antipatternId,
  scopeDefined: z.literal(true),
  executed: z.literal(true),
  successful: z.literal(true),
  current: z.literal(true),
  independentlyVerified: z.literal(true),
  requiredArtifacts: strings,
  interpretationBoundary: meaningful
}).strict();

const sourceMapping = z.object({
  mappingId: z.string().regex(/^SRCMAP-/),
  sourceId: z.string().regex(/^SRC-/),
  sourceVersionOrDate: nonEmpty,
  exactLocator: z.string().trim().min(3),
  relationship: nonEmpty,
  supportedClaim: meaningful,
  categoryRationale: meaningful,
  applicabilityConditions: z.array(nonEmpty),
  exclusions: z.array(nonEmpty),
  verificationStatus: z.literal('VERIFIED'),
  lastVerifiedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
}).strict();
const sourceMappingSchema = z.object({ ...pairIds, capabilityMappings: z.array(sourceMapping), antipatternMappings: z.array(sourceMapping), unmappedClaims: z.array(nonEmpty) }).strict();

const findingItem = z.object({
  id: z.string().regex(/^FND-(AP-)?[A-F][1-5]-[0-9]{3}$/),
  title: meaningful,
  eligibleConclusionStates: strings,
  mappedAtomicItemIds: strings,
  requiredEvidenceIds: strings,
  defaultSeverity: z.enum(['LOW','MEDIUM','HIGH','BLOCKING']),
  lifecycleConsequence: meaningful,
  humanLockRequired: z.boolean()
}).strict();
const findingSchema = z.object({ ...pairIds, capabilityFindings: z.array(findingItem).min(1), antipatternFindings: z.array(findingItem).min(1), findingLogicNotes: z.array(nonEmpty) }).strict();

const hardGate = z.object({ effect: z.enum(['NONE','WARN','BLOCK','CONSTRAIN']), conditions: z.array(nonEmpty), overrideAuthority: z.string().nullable() }).strict();
const runtimeBoundary = z.object({ machineMay: strings, machineMustNot: strings, humanAuthorityRequiredFor: strings }).strict();
const controlSchema = z.object({ ...pairIds, capabilityHardGate: hardGate, antipatternHardGate: hardGate, capabilityRuntimeBoundary: runtimeBoundary, antipatternRuntimeBoundary: runtimeBoundary, controlNotes: z.array(nonEmpty) }).strict();

const referenceSchema = z.object({
  ...pairIds,
  capabilityRelatedCriteria: z.array(z.string().regex(/^(AP-)?[A-F][1-5]$/)),
  antipatternRelatedCriteria: z.array(z.string().regex(/^(AP-)?[A-F][1-5]$/)),
  capabilityTacticRefs: z.array(nonEmpty),
  antipatternTacticRefs: z.array(nonEmpty),
  unresolvedTacticNeeds: z.array(nonEmpty)
}).strict();

const defect = z.object({ defectId: nonEmpty, severity: z.enum(['LOW','MEDIUM','HIGH','BLOCKING']), affectedPaths: strings, issue: meaningful, violatedRule: nonEmpty, recommendedRepairScope: strings }).strict();
const pairCoherenceSchema = z.object({ pairId: nonEmpty, passed: z.boolean(), defects: z.array(defect), coherenceSummary: meaningful }).strict();

const OUTPUT_SCHEMAS: Partial<Record<CognitiveTaskType, z.ZodType>> = {
  PAIR_BOUNDARY: pairBoundarySchema,
  AP_FAILURE_MODEL: apFailureSchema,
  APPLICABILITY: applicabilitySchema,
  PRIMARY_QUESTIONS: primaryQuestionsSchema,
  ATOMIC_DECOMPOSITION: atomicSchema,
  EVIDENCE_ARCHITECTURE: evidenceArchitectureSchema,
  EVIDENCE_SAFETY: evidenceSafetySchema,
  AP_ABSENCE_CONTRACT: apAbsenceSchema,
  SOURCE_MAPPING: sourceMappingSchema,
  FINDING_ARCHITECTURE: findingSchema,
  CONTROL_BOUNDARY: controlSchema,
  REFERENCE_MAPPING: referenceSchema,
  PAIR_COHERENCE_REVIEW: pairCoherenceSchema
};

export interface CompletionContext {
  runId: string;
  expectedPairId: string;
  expectedCapabilityId: string;
  expectedAntipatternId: string;
}

function issue(context: CompletionContext, checkId: string, objectPath: string, text: string): ValidationFinding {
  return { checkId, kind: 'SCHEMA', severity: 'BLOCKING', objectId: context.expectedPairId, objectPath, issue: text, dependencyScope: [] };
}

function validateIds(value: Record<string, unknown>, context: CompletionContext, findings: ValidationFinding[]): void {
  if (value.capabilityId !== undefined && value.capabilityId !== context.expectedCapabilityId) findings.push(issue(context,'CAPABILITY_ID_MATCH','capabilityId',`Expected ${context.expectedCapabilityId}, received ${String(value.capabilityId)}.`));
  if (value.antipatternId !== undefined && value.antipatternId !== context.expectedAntipatternId) findings.push(issue(context,'ANTIPATTERN_ID_MATCH','antipatternId',`Expected ${context.expectedAntipatternId}, received ${String(value.antipatternId)}.`));
  if (value.pairId !== undefined && value.pairId !== context.expectedPairId) findings.push(issue(context,'PAIR_ID_MATCH','pairId',`Expected ${context.expectedPairId}, received ${String(value.pairId)}.`));
  if (value.capabilityId !== undefined && value.antipatternId !== undefined && value.antipatternId !== `AP-${String(value.capabilityId)}`) findings.push(issue(context,'PAIR_ID_COHERENCE','antipatternId','Anti-pattern ID must be the exact AP-* pair of the capability.'));
}

function validateQuestions(value: Record<string, unknown>, context: CompletionContext, findings: ValidationFinding[]): void {
  const dims = ['DEFINITION_AND_INTENT','IMPLEMENTATION_AND_OPERATION','EVIDENCE_AND_EFFECTIVENESS'];
  for (const [path,prefix] of [['capabilityQuestions',context.expectedCapabilityId],['antipatternQuestions',context.expectedAntipatternId]] as const) {
    const items = value[path] as Array<Record<string,unknown>>;
    items?.forEach((item,i) => {
      if (item.id !== `${prefix}-Q${i+1}`) findings.push(issue(context,'QUESTION_ID_MATCH',`${path}.${i}.id`,`Expected ${prefix}-Q${i+1}.`));
      if (item.dimension !== dims[i]) findings.push(issue(context,'QUESTION_DIMENSION_ORDER',`${path}.${i}.dimension`,`Expected ${dims[i]}.`));
    });
  }
}

function validateAtomic(value: Record<string, unknown>, context: CompletionContext, findings: ValidationFinding[]): void {
  const groups = [
    ['capabilitySubcriteria',`${context.expectedCapabilityId}-SC-`,context.expectedCapabilityId],
    ['antipatternTests',`${context.expectedAntipatternId}-AT-`,context.expectedAntipatternId]
  ] as const;
  for (const [path,idPrefix,qPrefix] of groups) {
    const items = value[path] as Array<Record<string,unknown>>;
    const covered = new Set<string>();
    items?.forEach((item,i) => {
      const expected = `${idPrefix}${String(i+1).padStart(3,'0')}`;
      if (item.id !== expected) findings.push(issue(context,'ATOMIC_ID_SEQUENCE',`${path}.${i}.id`,`Expected ${expected}.`));
      const q = String(item.questionId ?? '');
      if (!new RegExp(`^${qPrefix}-Q[1-3]$`).test(q)) findings.push(issue(context,'ATOMIC_QUESTION_REFERENCE',`${path}.${i}.questionId`,`${q} does not resolve.`)); else covered.add(q);
    });
    for (let i=1;i<=3;i+=1) if (!covered.has(`${qPrefix}-Q${i}`)) findings.push(issue(context,'PRIMARY_QUESTION_COVERAGE',path,`No atomic item covers ${qPrefix}-Q${i}.`));
  }
}

function validateEvidence(value: Record<string, unknown>, context: CompletionContext, findings: ValidationFinding[]): void {
  const groups = [
    ['capabilityEvidence','capabilityBindings',`EVD-${context.expectedCapabilityId}-`,new RegExp(`^${context.expectedCapabilityId}-SC-[0-9]{3}$`)],
    ['antipatternEvidence','antipatternBindings',`EVD-${context.expectedAntipatternId}-`,new RegExp(`^${context.expectedAntipatternId}-AT-[0-9]{3}$`)]
  ] as const;
  for (const [ePath,bPath,prefix,atomicPattern] of groups) {
    const ev = value[ePath] as Array<Record<string,unknown>>;
    const binds = value[bPath] as Array<Record<string,unknown>>;
    const ids = new Set<string>();
    ev?.forEach((item,i) => { const expected=`${prefix}${String(i+1).padStart(3,'0')}`; const actual=String(item.id??''); ids.add(actual); if(actual!==expected)findings.push(issue(context,'EVIDENCE_ID_SEQUENCE',`${ePath}.${i}.id`,`Expected ${expected}.`)); });
    const used = new Set<string>();
    const atomic = new Set<string>();
    binds?.forEach((b,i)=>{ const a=String(b.atomicItemId??''); if(!atomicPattern.test(a))findings.push(issue(context,'ATOMIC_BINDING_REFERENCE',`${bPath}.${i}.atomicItemId`,`${a} does not belong to current object.`)); atomic.add(a); for(const id of ((b.evidenceIds as string[])??[])){ if(!ids.has(id))findings.push(issue(context,'EVIDENCE_BINDING_REFERENCE',`${bPath}.${i}.evidenceIds`,`${id} does not resolve.`)); else used.add(id); }});
    for(const id of ids) if(!used.has(id)) findings.push(issue(context,'UNUSED_EVIDENCE_OBJECT',ePath,`${id} is unused.`));
    if (atomic.size !== (binds?.length ?? 0)) findings.push(issue(context,'DUPLICATE_ATOMIC_BINDING',bPath,'Each atomic item must have exactly one binding object.'));
  }
}

function validateFindings(value: Record<string, unknown>, context: CompletionContext, findings: ValidationFinding[]): void {
  const groups = [
    ['capabilityFindings',`FND-${context.expectedCapabilityId}-`,new RegExp(`^${context.expectedCapabilityId}-SC-[0-9]{3}$`),new RegExp(`^EVD-${context.expectedCapabilityId}-[0-9]{3}$`)],
    ['antipatternFindings',`FND-${context.expectedAntipatternId}-`,new RegExp(`^${context.expectedAntipatternId}-AT-[0-9]{3}$`),new RegExp(`^EVD-${context.expectedAntipatternId}-[0-9]{3}$`)]
  ] as const;
  for(const [path,prefix,aPattern,ePattern] of groups){ const items=value[path] as Array<Record<string,unknown>>; items?.forEach((f,i)=>{ const expected=`${prefix}${String(i+1).padStart(3,'0')}`; if(f.id!==expected)findings.push(issue(context,'FINDING_ID_SEQUENCE',`${path}.${i}.id`,`Expected ${expected}.`)); for(const id of ((f.mappedAtomicItemIds as string[])??[]))if(!aPattern.test(id))findings.push(issue(context,'FINDING_ATOMIC_REFERENCE',`${path}.${i}.mappedAtomicItemIds`,`${id} does not belong to current object.`)); for(const id of ((f.requiredEvidenceIds as string[])??[]))if(!ePattern.test(id))findings.push(issue(context,'FINDING_EVIDENCE_REFERENCE',`${path}.${i}.requiredEvidenceIds`,`${id} does not belong to current object.`)); }); }
}

function validateReferences(value: Record<string, unknown>, context: CompletionContext, findings: ValidationFinding[]): void {
  for(const path of ['capabilityRelatedCriteria','antipatternRelatedCriteria'] as const){ for(const id of ((value[path] as string[])??[])){ if(id===context.expectedCapabilityId || id===context.expectedAntipatternId) findings.push(issue(context,'RELATED_CRITERIA_SELF_REFERENCE',path,`${id} is a self-reference.`)); }}
}

function validatePairReview(value: Record<string, unknown>, context: CompletionContext, findings: ValidationFinding[]): void {
  const defects=(value.defects as Array<Record<string,unknown>>)??[];
  const blocking=defects.some(d=>d.severity==='HIGH'||d.severity==='BLOCKING');
  if(value.passed===true && blocking) findings.push(issue(context,'PAIR_REVIEW_PASS_CONTRADICTION','passed','Pair cannot pass while HIGH or BLOCKING defects remain.'));
}

export function validateTaskPrerequisites(contract: TaskContract, completedTaskTypes: ReadonlySet<CognitiveTaskType>, context: CompletionContext): ValidationReport {
  const findings = contract.upstreamTaskTypes.filter(t=>!completedTaskTypes.has(t)).map(t=>issue(context,`TASK_PREREQUISITE_${t}`,'upstreamTaskTypes',`Required validated upstream task ${t} is missing.`));
  return { runId: context.runId, objectId: context.expectedPairId, passed: findings.length===0, findings };
}

export function validateCognitiveTaskCompletion(taskType: CognitiveTaskType, output: unknown, context: CompletionContext): ValidationReport {
  const findings: ValidationFinding[]=[];
  const schema=OUTPUT_SCHEMAS[taskType];
  if(!schema) return { runId:context.runId, objectId:context.expectedPairId, passed:false, findings:[issue(context,'TASK_COMPLETION_SCHEMA_NOT_IMPLEMENTED',taskType,`No deterministic completion schema has been implemented yet for ${taskType}.`)] };
  const parsed=schema.safeParse(output);
  if(!parsed.success){ for(const zIssue of parsed.error.issues)findings.push(issue(context,'TASK_OUTPUT_CONTRACT',zIssue.path.join('.')||taskType,zIssue.message)); }
  else {
    const value=parsed.data as Record<string,unknown>;
    validateIds(value,context,findings);
    if(taskType==='PRIMARY_QUESTIONS')validateQuestions(value,context,findings);
    if(taskType==='ATOMIC_DECOMPOSITION')validateAtomic(value,context,findings);
    if(taskType==='EVIDENCE_ARCHITECTURE')validateEvidence(value,context,findings);
    if(taskType==='FINDING_ARCHITECTURE')validateFindings(value,context,findings);
    if(taskType==='REFERENCE_MAPPING')validateReferences(value,context,findings);
    if(taskType==='PAIR_COHERENCE_REVIEW')validatePairReview(value,context,findings);
  }
  return { runId:context.runId, objectId:context.expectedPairId, passed:findings.length===0, findings };
}

export function canPersistTaskAsCompleted(contract: TaskContract, completedTaskTypes: ReadonlySet<CognitiveTaskType>, output: unknown, context: CompletionContext): ValidationReport {
  const pre=validateTaskPrerequisites(contract,completedTaskTypes,context);
  return pre.passed ? validateCognitiveTaskCompletion(contract.taskType,output,context) : pre;
}
