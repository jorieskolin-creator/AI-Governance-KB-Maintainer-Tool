import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const meaningful = z.string().trim().min(10);
const nonEmpty = z.string().trim().min(1);
const strings = z.array(nonEmpty).min(1);

const evidenceItem = z.object({
  title: z.string().trim().min(3),
  claimSupported: meaningful,
  evidenceClass: nonEmpty,
  minimumTechnicalAssurance: nonEmpty,
  requiredHumanAssurance: nonEmpty,
  acceptanceConditions: strings,
  limitations: strings,
  supportsAtomicHandles: strings
}).strict();

const evidenceSchema = z.object({
  capabilityEvidence: z.array(evidenceItem).min(1),
  antipatternEvidence: z.array(evidenceItem).min(1),
  sufficiencyNotes: z.array(nonEmpty)
}).strict();

export interface SirEvidenceCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(
  context: SirEvidenceCompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'SCHEMA'
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

function report(context: SirEvidenceCompletionContext, findings: ValidationFinding[]): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

function validatePrerequisites(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  context: SirEvidenceCompletionContext,
  findings: ValidationFinding[]
): void {
  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(
        finding(context, 'SIR_PREREQUISITE_MISSING', '/', `${contract.taskType} requires validated ${prerequisite}.`)
      );
    }
  }
}

function atomicHandleSet(contract: TaskContract, key: 'capability_atomics' | 'antipattern_atomics'): Set<string> {
  const items = (contract.lockedInputs[key] as Array<Record<string, unknown>> | undefined) ?? [];
  return new Set(items.map((item) => String(item.handle ?? '')));
}

function vocabularySet(contract: TaskContract, key: string): Set<string> {
  return new Set(((contract.lockedInputs[key] as string[] | undefined) ?? []).map(String));
}

function validateEvidenceGroup(
  items: Array<Record<string, unknown>>,
  allowedAtomicHandles: Set<string>,
  technicalVocabulary: Set<string>,
  humanVocabulary: Set<string>,
  path: string,
  context: SirEvidenceCompletionContext,
  findings: ValidationFinding[]
): void {
  const covered = new Set<string>();

  for (const [index, item] of items.entries()) {
    const handles = (item.supportsAtomicHandles as string[] | undefined) ?? [];
    for (const handle of handles) {
      if (!allowedAtomicHandles.has(handle)) {
        findings.push(
          finding(
            context,
            'SIR_EVIDENCE_ATOMIC_HANDLE_RESOLVES',
            `/${path}/${index}/supportsAtomicHandles`,
            `${handle} does not resolve to an atomic item in the supplied object-scoped SIR graph.`,
            'REFERENCE'
          )
        );
      } else {
        covered.add(handle);
      }
    }

    const technical = String(item.minimumTechnicalAssurance ?? '');
    if (!technicalVocabulary.has(technical)) {
      findings.push(
        finding(
          context,
          'SIR_TECHNICAL_ASSURANCE_ALLOWED',
          `/${path}/${index}/minimumTechnicalAssurance`,
          `${technical} is not in the governed technical-assurance vocabulary.`
        )
      );
    }

    const human = String(item.requiredHumanAssurance ?? '');
    if (!humanVocabulary.has(human)) {
      findings.push(
        finding(
          context,
          'SIR_HUMAN_ASSURANCE_ALLOWED',
          `/${path}/${index}/requiredHumanAssurance`,
          `${human} is not in the governed human-assurance vocabulary.`
        )
      );
    }
  }

  for (const atomicHandle of allowedAtomicHandles) {
    if (!covered.has(atomicHandle)) {
      findings.push(
        finding(
          context,
          'SIR_EVERY_ATOMIC_HAS_EVIDENCE',
          `/${path}`,
          `${atomicHandle} has no evidence relationship in the semantic evidence architecture.`,
          'REFERENCE'
        )
      );
    }
  }
}

export function validateSirEvidenceCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirEvidenceCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'EVIDENCE_ARCHITECTURE') {
    findings.push(
      finding(
        context,
        'SIR_EVIDENCE_CONTRACT_IDENTITY',
        '/',
        `Evidence SIR completion requires EVIDENCE_ARCHITECTURE contractVersion 2.0.0.`
      )
    );
    return report(context, findings);
  }

  validatePrerequisites(contract, completed, context, findings);

  const parsed = evidenceSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        finding(context, 'SIR_EVIDENCE_OUTPUT_CONTRACT', `/${issue.path.join('/')}`, issue.message)
      );
    }
    return report(context, findings);
  }

  const capabilityAtomics = atomicHandleSet(contract, 'capability_atomics');
  const antipatternAtomics = atomicHandleSet(contract, 'antipattern_atomics');
  if (capabilityAtomics.size === 0 || antipatternAtomics.size === 0) {
    findings.push(
      finding(
        context,
        'SIR_EVIDENCE_ATOMIC_INPUT_REQUIRED',
        '/',
        'Evidence Architecture requires non-empty validated materialized atomic SIR for both objects.',
        'REFERENCE'
      )
    );
    return report(context, findings);
  }

  const technicalVocabulary = vocabularySet(contract, 'governed_technical_assurance_vocabulary');
  const humanVocabulary = vocabularySet(contract, 'governed_human_assurance_vocabulary');

  validateEvidenceGroup(
    parsed.data.capabilityEvidence as Array<Record<string, unknown>>,
    capabilityAtomics,
    technicalVocabulary,
    humanVocabulary,
    'capabilityEvidence',
    context,
    findings
  );
  validateEvidenceGroup(
    parsed.data.antipatternEvidence as Array<Record<string, unknown>>,
    antipatternAtomics,
    technicalVocabulary,
    humanVocabulary,
    'antipatternEvidence',
    context,
    findings
  );

  return report(context, findings);
}
