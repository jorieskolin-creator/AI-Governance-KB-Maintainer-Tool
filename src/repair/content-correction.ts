import {
  buildCorrectionPromptPacket,
  type CognitivePromptPacket
} from '../cognitive/prompt-builder.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding } from '../validation/contracts.js';
import { resolveRepairScope } from './impact-resolver.js';

export const PROVIDER_ROUTE_FAILURE_MARKER = 'failed primary and fallback routes';
export const CONTENT_CORRECTION_FAILURE_MARKER =
  'failed deterministic completion after bounded content correction';

export type PacketKind = 'ORIGINAL' | 'CORRECTION';
export type RouteTarget = 'primary' | 'fallback';

export interface CognitiveRouteAttempt {
  target: RouteTarget;
  packetKind: PacketKind;
  executionError?: Error;
  passed: boolean;
  output?: unknown;
  findings: ValidationFinding[];
}

export type CognitiveRouteResult =
  | {
      status: 'COMPLETED';
      usedFallback: boolean;
      output: unknown;
      attempts: CognitiveRouteAttempt[];
    }
  | {
      status: 'FAIL_EXECUTION_ROUTES';
      attempts: CognitiveRouteAttempt[];
      findings: ValidationFinding[];
    }
  | {
      status: 'FAIL_CONTENT_CORRECTION';
      attempts: CognitiveRouteAttempt[];
      findings: ValidationFinding[];
      rejectedJson?: unknown;
    };

export function allowedRepairPathsFromFindings(findings: readonly ValidationFinding[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const finding of findings) {
    for (const path of resolveRepairScope(finding).targetPaths) {
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

export function uniqueValidationFindings(findings: readonly ValidationFinding[]): ValidationFinding[] {
  return findings.filter(
    (item, index, all) =>
      all.findIndex(
        (other) =>
          other.checkId === item.checkId && other.objectPath === item.objectPath && other.issue === item.issue
      ) === index
  );
}

export function isExecutionFailure(attempt: {
  executionError?: Error;
  output?: unknown;
}): boolean {
  return attempt.executionError !== undefined && attempt.output === undefined;
}

export function replayedOriginalPromptToFallback(attempts: readonly CognitiveRouteAttempt[]): boolean {
  const primary = attempts.find((item) => item.target === 'primary' && item.packetKind === 'ORIGINAL');
  if (!primary || isExecutionFailure(primary) || primary.passed) return false;
  return attempts.some((item) => item.target === 'fallback' && item.packetKind === 'ORIGINAL');
}

export function modelFacingCorrectionFindings(
  findings: readonly ValidationFinding[]
): Array<{
  checkId: string;
  kind: ValidationFinding['kind'];
  severity: ValidationFinding['severity'];
  objectPath: string;
  issue: string;
  dependencyScope: string[];
  recommendedAction?: string;
}> {
  return findings.map((item) => ({
    checkId: item.checkId,
    kind: item.kind,
    severity: item.severity,
    objectPath: item.objectPath,
    issue: item.issue,
    dependencyScope: item.dependencyScope,
    ...(item.recommendedAction ? { recommendedAction: item.recommendedAction } : {})
  }));
}

export function buildContentCorrectionPacket(
  contract: TaskContract,
  rejectedJson: unknown,
  findings: readonly ValidationFinding[]
): CognitivePromptPacket {
  return buildCorrectionPromptPacket(contract, {
    rejectedJson,
    findings: modelFacingCorrectionFindings(findings),
    allowedRepairPaths: allowedRepairPathsFromFindings(findings)
  });
}

export function providerRouteFailureMessage(taskType: string, details?: string): string {
  return `Task ${taskType} ${PROVIDER_ROUTE_FAILURE_MARKER}${details ? `: ${details}` : ''}`;
}

export function contentCorrectionFailureMessage(taskType: string): string {
  return `Task ${taskType} ${CONTENT_CORRECTION_FAILURE_MARKER}.`;
}

export function isProviderRouteFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes(PROVIDER_ROUTE_FAILURE_MARKER);
}

export function isContentCorrectionFailure(error: unknown): boolean {
  return error instanceof Error && error.message.includes(CONTENT_CORRECTION_FAILURE_MARKER);
}

export async function routeCognitiveTask(input: {
  runAttempt: (
    args: { target: RouteTarget; packetKind: PacketKind }
  ) => Promise<Omit<CognitiveRouteAttempt, 'target' | 'packetKind'>>;
  onValidationFailure?: (args: {
    target: RouteTarget;
    rejectedJson: unknown;
    findings: ValidationFinding[];
  }) => Promise<void> | void;
}): Promise<CognitiveRouteResult> {
  const attempts: CognitiveRouteAttempt[] = [];

  const primary: CognitiveRouteAttempt = {
    target: 'primary',
    packetKind: 'ORIGINAL',
    ...(await input.runAttempt({ target: 'primary', packetKind: 'ORIGINAL' }))
  };
  attempts.push(primary);

  if (primary.passed && primary.output !== undefined) {
    return { status: 'COMPLETED', usedFallback: false, output: primary.output, attempts };
  }

  if (isExecutionFailure(primary)) {
    const fallback: CognitiveRouteAttempt = {
      target: 'fallback',
      packetKind: 'ORIGINAL',
      ...(await input.runAttempt({ target: 'fallback', packetKind: 'ORIGINAL' }))
    };
    attempts.push(fallback);
    if (fallback.passed && fallback.output !== undefined) {
      return { status: 'COMPLETED', usedFallback: true, output: fallback.output, attempts };
    }
    if (isExecutionFailure(fallback)) {
      return { status: 'FAIL_EXECUTION_ROUTES', attempts, findings: [] };
    }
    await input.onValidationFailure?.({
      target: 'fallback',
      rejectedJson: fallback.output,
      findings: fallback.findings
    });
    const correction: CognitiveRouteAttempt = {
      target: 'fallback',
      packetKind: 'CORRECTION',
      ...(await input.runAttempt({ target: 'fallback', packetKind: 'CORRECTION' }))
    };
    attempts.push(correction);
    if (correction.passed && correction.output !== undefined) {
      return { status: 'COMPLETED', usedFallback: true, output: correction.output, attempts };
    }
    return {
      status: 'FAIL_CONTENT_CORRECTION',
      attempts,
      findings: uniqueValidationFindings([...fallback.findings, ...correction.findings]),
      rejectedJson: correction.output ?? fallback.output
    };
  }

  await input.onValidationFailure?.({
    target: 'primary',
    rejectedJson: primary.output,
    findings: primary.findings
  });
  const correction: CognitiveRouteAttempt = {
    target: 'primary',
    packetKind: 'CORRECTION',
    ...(await input.runAttempt({ target: 'primary', packetKind: 'CORRECTION' }))
  };
  attempts.push(correction);
  if (correction.passed && correction.output !== undefined) {
    return { status: 'COMPLETED', usedFallback: false, output: correction.output, attempts };
  }
  return {
    status: 'FAIL_CONTENT_CORRECTION',
    attempts,
    findings: uniqueValidationFindings([...primary.findings, ...correction.findings]),
    rejectedJson: correction.output ?? primary.output
  };
}
