import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

export interface SirReferenceMappingCompletionContext {
  runId: string;
  expectedPairId: string;
}

interface ParsedReferenceOutput {
  capabilityRelatedCriterionHandles: string[];
  antipatternRelatedCriterionHandles: string[];
  referenceNotes: string[];
}

function finding(
  context: SirReferenceMappingCompletionContext,
  checkId: string,
  path: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'REFERENCE'
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath: path,
    issue,
    dependencyScope: []
  };
}

function result(
  context: SirReferenceMappingCompletionContext,
  findings: ValidationFinding[]
): ValidationReport {
  return {
    runId: context.runId,
    objectId: context.expectedPairId,
    passed: findings.length === 0,
    findings
  };
}

function parsePairId(pairId: string): { capabilityId: string; antipatternId: string } | undefined {
  const separator = pairId.indexOf('_');
  if (separator < 1) return undefined;
  const capabilityId = pairId.slice(0, separator);
  const antipatternId = pairId.slice(separator + 1);
  if (!/^[A-F][1-5]$/.test(capabilityId)) return undefined;
  if (antipatternId !== `AP-${capabilityId}`) return undefined;
  return { capabilityId, antipatternId };
}

function parseStringArray(value: unknown, requireCriterionHandle: boolean): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) return undefined;
    if (requireCriterionHandle && !item.startsWith('criterion_')) return undefined;
    parsed.push(item);
  }
  return parsed;
}

function parseOutput(value: unknown): ParsedReferenceOutput | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort().join('|');
  if (keys !== 'antipatternRelatedCriterionHandles|capabilityRelatedCriterionHandles|referenceNotes') {
    return undefined;
  }
  const capability = parseStringArray(object.capabilityRelatedCriterionHandles, true);
  const antipattern = parseStringArray(object.antipatternRelatedCriterionHandles, true);
  const notes = parseStringArray(object.referenceNotes, false);
  if (capability === undefined || antipattern === undefined || notes === undefined) return undefined;
  return {
    capabilityRelatedCriterionHandles: capability,
    antipatternRelatedCriterionHandles: antipattern,
    referenceNotes: notes
  };
}

function criterionUniverse(contract: TaskContract): Map<string, string> | undefined {
  const raw = contract.lockedInputs.adjacent_criteria;
  if (!Array.isArray(raw)) return undefined;
  const universe = new Map<string, string>();
  for (const value of raw) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const item = value as Record<string, unknown>;
    const handle = item.criterionHandle;
    const id = item.criterionId;
    const boundary = item.boundarySummary;
    if (typeof handle !== 'string' || !handle.startsWith('criterion_')) return undefined;
    if (typeof id !== 'string' || !/^(AP-)?[A-F][1-5]$/.test(id)) return undefined;
    if (typeof boundary !== 'string' || boundary.trim().length === 0) return undefined;
    if (universe.has(handle)) return undefined;
    universe.set(handle, id);
  }
  return universe;
}

function validateObjectSelections(
  handles: string[],
  ownObjectId: string,
  path: string,
  universe: Map<string, string>,
  context: SirReferenceMappingCompletionContext,
  findings: ValidationFinding[]
): void {
  if (new Set(handles).size !== handles.length) {
    findings.push(
      finding(
        context,
        'SIR_REFERENCE_DUPLICATE_CRITERION_HANDLE',
        path,
        'Related-criterion handles must be unique within each object.',
        'SCHEMA'
      )
    );
  }
  handles.forEach((handle, index) => {
    const criterionId = universe.get(handle);
    if (criterionId === undefined) {
      findings.push(
        finding(
          context,
          'SIR_REFERENCE_UNKNOWN_CRITERION_HANDLE',
          `${path}/${index}`,
          `Criterion handle ${handle} is absent from the Authoring Plan adjacent-criterion universe.`
        )
      );
    } else if (criterionId === ownObjectId) {
      findings.push(
        finding(
          context,
          'SIR_REFERENCE_SELF_REFERENCE',
          `${path}/${index}`,
          `${ownObjectId} cannot reference itself as a related criterion.`
        )
      );
    }
  });
}

export function validateSirReferenceMappingCompletion(
  contract: TaskContract,
  completed: ReadonlySet<CognitiveTaskType>,
  output: unknown,
  context: SirReferenceMappingCompletionContext
): ValidationReport {
  const findings: ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'REFERENCE_MAPPING') {
    findings.push(
      finding(
        context,
        'SIR_REFERENCE_CONTRACT_IDENTITY',
        '/',
        'Reference Mapping SIR completion requires REFERENCE_MAPPING contractVersion 2.0.0.',
        'SCHEMA'
      )
    );
    return result(context, findings);
  }

  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(
        finding(
          context,
          'SIR_PREREQUISITE_MISSING',
          '/',
          `REFERENCE_MAPPING requires validated ${prerequisite}.`,
          'SCHEMA'
        )
      );
    }
  }

  if (contract.lockedInputs.tactic_resolution_mode !== 'NO_APPROVED_TACTIC_AVAILABLE') {
    findings.push(
      finding(
        context,
        'SIR_REFERENCE_TACTIC_MODE_UNSUPPORTED',
        '/lockedInputs/tactic_resolution_mode',
        'Reference Mapping SIR v2 requires the no-approved-tactic fail-safe until an approved reciprocal tactic-mapping packet is implemented.',
        'TACTIC'
      )
    );
  }

  const pair = parsePairId(context.expectedPairId);
  if (pair === undefined) {
    findings.push(
      finding(context, 'SIR_REFERENCE_PAIR_ID_INVALID', '/', 'Expected pair ID is invalid.', 'IDENTIFIER')
    );
  }

  const universe = criterionUniverse(contract);
  if (universe === undefined) {
    findings.push(
      finding(
        context,
        'SIR_REFERENCE_ADJACENT_UNIVERSE_INVALID',
        '/lockedInputs/adjacent_criteria',
        'Adjacent-criterion universe is missing or malformed.',
        'SCHEMA'
      )
    );
  }

  const parsed = parseOutput(output);
  if (parsed === undefined) {
    findings.push(
      finding(
        context,
        'SIR_REFERENCE_OUTPUT_CONTRACT',
        '/',
        'Output must contain only capabilityRelatedCriterionHandles, antipatternRelatedCriterionHandles and referenceNotes arrays.',
        'SCHEMA'
      )
    );
    return result(context, findings);
  }

  if (pair !== undefined && universe !== undefined) {
    validateObjectSelections(
      parsed.capabilityRelatedCriterionHandles,
      pair.capabilityId,
      '/capabilityRelatedCriterionHandles',
      universe,
      context,
      findings
    );
    validateObjectSelections(
      parsed.antipatternRelatedCriterionHandles,
      pair.antipatternId,
      '/antipatternRelatedCriterionHandles',
      universe,
      context,
      findings
    );
  }

  return result(context, findings);
}
