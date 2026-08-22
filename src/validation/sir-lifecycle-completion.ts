import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const target = z.object({
  minimumTechnicalAssurance: z.enum(['UNKNOWN','DECLARED','IMPLEMENTED','TESTED','OPERATIONALLY_OBSERVED']),
  requiredHumanAssurance: z.enum(['PENDING','HUMAN_VALIDATED','FORMALLY_APPROVED'])
}).strict();

const outputSchema = z.object({
  capabilityTargets: z.array(target).min(1),
  antipatternTargets: z.array(target).min(1),
  rationaleNotes: z.array(z.string().trim().min(1))
}).strict();

export interface SirLifecycleCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(
  context: SirLifecycleCompletionContext,
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

function report(context: SirLifecycleCompletionContext, findings: ValidationFinding[]): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

export function validateSirLifecycleCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirLifecycleCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'LIFECYCLE_ASSURANCE') {
    findings.push(
      finding(
        context,
        'SIR_LIFECYCLE_CONTRACT_IDENTITY',
        '/',
        'Lifecycle SIR completion requires LIFECYCLE_ASSURANCE contractVersion 2.0.0.'
      )
    );
    return report(context, findings);
  }

  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(
        finding(
          context,
          'SIR_PREREQUISITE_MISSING',
          '/',
          `LIFECYCLE_ASSURANCE requires validated ${prerequisite}.`
        )
      );
    }
  }

  const stages = contract.lockedInputs.lifecycle_stage_order;
  const technicalVocabulary = contract.lockedInputs.governed_technical_assurance_vocabulary;
  const humanVocabulary = contract.lockedInputs.governed_human_assurance_vocabulary;
  if (!Array.isArray(stages) || stages.length === 0 || stages.some((item) => typeof item !== 'string' || !item.trim())) {
    findings.push(
      finding(
        context,
        'SIR_LIFECYCLE_STAGE_ORDER_REQUIRED',
        '/lifecycle_stage_order',
        'Lifecycle assurance requires a non-empty lifecycle stage order locked from the Authoring Plan.'
      )
    );
  } else if (new Set(stages).size !== stages.length) {
    findings.push(
      finding(
        context,
        'SIR_LIFECYCLE_STAGE_ORDER_UNIQUE',
        '/lifecycle_stage_order',
        'Lifecycle stage order must not contain duplicate stage identities.'
      )
    );
  }
  if (!Array.isArray(technicalVocabulary) || technicalVocabulary.length === 0 || technicalVocabulary.some((item) => typeof item !== 'string')) {
    findings.push(
      finding(
        context,
        'SIR_LIFECYCLE_TECHNICAL_VOCABULARY_REQUIRED',
        '/governed_technical_assurance_vocabulary',
        'Technical assurance vocabulary must be locked from the Authoring Plan.'
      )
    );
  }
  if (!Array.isArray(humanVocabulary) || humanVocabulary.length === 0 || humanVocabulary.some((item) => typeof item !== 'string')) {
    findings.push(
      finding(
        context,
        'SIR_LIFECYCLE_HUMAN_VOCABULARY_REQUIRED',
        '/governed_human_assurance_vocabulary',
        'Human assurance vocabulary must be locked from the Authoring Plan.'
      )
    );
  }

  const control = contract.lockedInputs.control_boundary;
  if (!control || typeof control !== 'object' || Array.isArray(control)) {
    findings.push(
      finding(
        context,
        'SIR_LIFECYCLE_CONTROL_BOUNDARY_REQUIRED',
        '/control_boundary',
        'Lifecycle assurance requires the verified persisted Control Boundary artifact.',
        'REFERENCE'
      )
    );
  }
  const capabilityFindings = contract.lockedInputs.capability_findings;
  const antipatternFindings = contract.lockedInputs.antipattern_findings;
  if (!Array.isArray(capabilityFindings) || capabilityFindings.length === 0 || !Array.isArray(antipatternFindings) || antipatternFindings.length === 0) {
    findings.push(
      finding(
        context,
        'SIR_LIFECYCLE_FINDINGS_REQUIRED',
        '/',
        'Lifecycle assurance requires non-empty verified materialized Findings.',
        'REFERENCE'
      )
    );
  }

  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(
        finding(
          context,
          'SIR_LIFECYCLE_OUTPUT_CONTRACT',
          `/${issue.path.join('/')}`,
          issue.message
        )
      );
    }
    return report(context, findings);
  }

  if (Array.isArray(stages)) {
    if (parsed.data.capabilityTargets.length !== stages.length) {
      findings.push(
        finding(
          context,
          'SIR_LIFECYCLE_CAPABILITY_TARGET_COUNT',
          '/capabilityTargets',
          `Capability lifecycle target count ${parsed.data.capabilityTargets.length} must equal governed stage count ${stages.length}.`
        )
      );
    }
    if (parsed.data.antipatternTargets.length !== stages.length) {
      findings.push(
        finding(
          context,
          'SIR_LIFECYCLE_ANTIPATTERN_TARGET_COUNT',
          '/antipatternTargets',
          `Anti-pattern lifecycle target count ${parsed.data.antipatternTargets.length} must equal governed stage count ${stages.length}.`
        )
      );
    }
  }

  const technical = new Set(Array.isArray(technicalVocabulary) ? technicalVocabulary : []);
  const human = new Set(Array.isArray(humanVocabulary) ? humanVocabulary : []);
  for (const [groupName, targets] of [
    ['capabilityTargets', parsed.data.capabilityTargets],
    ['antipatternTargets', parsed.data.antipatternTargets]
  ] as const) {
    targets.forEach((item, index) => {
      if (!technical.has(item.minimumTechnicalAssurance)) {
        findings.push(
          finding(
            context,
            'SIR_LIFECYCLE_TECHNICAL_ASSURANCE_NOT_GOVERNED',
            `/${groupName}/${index}/minimumTechnicalAssurance`,
            `${item.minimumTechnicalAssurance} is not present in the locked technical-assurance vocabulary.`
          )
        );
      }
      if (!human.has(item.requiredHumanAssurance)) {
        findings.push(
          finding(
            context,
            'SIR_LIFECYCLE_HUMAN_ASSURANCE_NOT_GOVERNED',
            `/${groupName}/${index}/requiredHumanAssurance`,
            `${item.requiredHumanAssurance} is not present in the locked human-assurance vocabulary.`
          )
        );
      }
    });
  }

  return report(context, findings);
}
