import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const meaningful = z.string().trim().min(3);
const hardGate = z.object({
  effect: z.enum(['NONE','WARN','BLOCK','CONSTRAIN']),
  conditions: z.array(meaningful),
  overrideAuthority: z.string().trim().min(3).nullable()
}).strict();

const runtimeBoundary = z.object({
  machineMay: z.array(meaningful).min(1),
  machineMustNot: z.array(meaningful).min(1),
  humanAuthorityRequiredFor: z.array(meaningful).min(1)
}).strict();

const outputSchema = z.object({
  capabilityHardGate: hardGate,
  antipatternHardGate: hardGate,
  capabilityRuntimeBoundary: runtimeBoundary,
  antipatternRuntimeBoundary: runtimeBoundary,
  controlNotes: z.array(z.string().trim().min(1))
}).strict();

export interface SirControlCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(
  context: SirControlCompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'SEMANTIC'
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

function report(context: SirControlCompletionContext, findings: ValidationFinding[]): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function validateUnique(
  values: string[],
  path: string,
  context: SirControlCompletionContext,
  findings: ValidationFinding[]
): void {
  const normalized = values.map(normalize);
  if (new Set(normalized).size !== normalized.length) {
    findings.push(
      finding(
        context,
        'SIR_CONTROL_DUPLICATE_RUNTIME_BOUNDARY_ENTRY',
        path,
        'Runtime-boundary entries must be unique after whitespace/case normalization.',
        'SCHEMA'
      )
    );
  }
}

function validateRuntimeBoundary(
  boundary: {
    machineMay: string[];
    machineMustNot: string[];
    humanAuthorityRequiredFor: string[];
  },
  path: string,
  context: SirControlCompletionContext,
  findings: ValidationFinding[]
): void {
  validateUnique(boundary.machineMay, `${path}/machineMay`, context, findings);
  validateUnique(boundary.machineMustNot, `${path}/machineMustNot`, context, findings);
  validateUnique(boundary.humanAuthorityRequiredFor, `${path}/humanAuthorityRequiredFor`, context, findings);

  const may = new Set(boundary.machineMay.map(normalize));
  const mustNot = new Set(boundary.machineMustNot.map(normalize));
  const human = new Set(boundary.humanAuthorityRequiredFor.map(normalize));

  for (const item of may) {
    if (mustNot.has(item)) {
      findings.push(
        finding(
          context,
          'SIR_CONTROL_MACHINE_MAY_MUST_NOT_CONTRADICTION',
          path,
          `The same normalized action appears in both machineMay and machineMustNot: ${item}`
        )
      );
    }
    if (human.has(item)) {
      findings.push(
        finding(
          context,
          'SIR_CONTROL_MACHINE_MAY_HUMAN_AUTHORITY_CONTRADICTION',
          path,
          `The same normalized decision appears in both machineMay and humanAuthorityRequiredFor: ${item}`
        )
      );
    }
  }
}

function validateHardGate(
  gate: { effect: 'NONE'|'WARN'|'BLOCK'|'CONSTRAIN'; conditions: string[]; overrideAuthority: string|null },
  allowedEffects: Set<string>,
  path: string,
  context: SirControlCompletionContext,
  findings: ValidationFinding[]
): void {
  if (!allowedEffects.has(gate.effect)) {
    findings.push(
      finding(
        context,
        'SIR_CONTROL_HARD_GATE_EFFECT_NOT_GOVERNED',
        `${path}/effect`,
        `${gate.effect} is not present in the Authoring Plan hard-gate vocabulary.`,
        'SCHEMA'
      )
    );
  }
  if (gate.effect !== 'NONE' && gate.conditions.length === 0) {
    findings.push(
      finding(
        context,
        'SIR_CONTROL_ACTIVE_GATE_REQUIRES_CONDITION',
        `${path}/conditions`,
        `Hard-gate effect ${gate.effect} requires at least one explicit activation condition.`
      )
    );
  }
}

export function validateSirControlCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirControlCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'CONTROL_BOUNDARY') {
    findings.push(
      finding(
        context,
        'SIR_CONTROL_CONTRACT_IDENTITY',
        '/',
        'Control SIR completion requires CONTROL_BOUNDARY contractVersion 2.0.0.',
        'SCHEMA'
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
          `CONTROL_BOUNDARY requires validated ${prerequisite}.`,
          'SCHEMA'
        )
      );
    }
  }

  const governedEffects = contract.lockedInputs.governed_hard_gate_effects;
  if (!Array.isArray(governedEffects) || governedEffects.length === 0 || governedEffects.some((item) => typeof item !== 'string')) {
    findings.push(
      finding(
        context,
        'SIR_CONTROL_GOVERNED_GATE_VOCABULARY_REQUIRED',
        '/governed_hard_gate_effects',
        'CONTROL_BOUNDARY requires a non-empty hard-gate vocabulary locked from the Authoring Plan.',
        'SCHEMA'
      )
    );
  }

  const capabilityFindings = contract.lockedInputs.capability_findings;
  const antipatternFindings = contract.lockedInputs.antipattern_findings;
  if (!Array.isArray(capabilityFindings) || capabilityFindings.length === 0 || !Array.isArray(antipatternFindings) || antipatternFindings.length === 0) {
    findings.push(
      finding(
        context,
        'SIR_CONTROL_MATERIALIZED_FINDINGS_REQUIRED',
        '/',
        'CONTROL_BOUNDARY requires non-empty verified materialized capability and anti-pattern finding artifacts.',
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
          'SIR_CONTROL_OUTPUT_CONTRACT',
          `/${issue.path.join('/')}`,
          issue.message,
          'SCHEMA'
        )
      );
    }
    return report(context, findings);
  }

  const allowedEffects = new Set(
    Array.isArray(governedEffects) ? governedEffects.filter((item): item is string => typeof item === 'string') : []
  );

  validateHardGate(parsed.data.capabilityHardGate, allowedEffects, '/capabilityHardGate', context, findings);
  validateHardGate(parsed.data.antipatternHardGate, allowedEffects, '/antipatternHardGate', context, findings);
  validateRuntimeBoundary(parsed.data.capabilityRuntimeBoundary, '/capabilityRuntimeBoundary', context, findings);
  validateRuntimeBoundary(parsed.data.antipatternRuntimeBoundary, '/antipatternRuntimeBoundary', context, findings);

  return report(context, findings);
}
