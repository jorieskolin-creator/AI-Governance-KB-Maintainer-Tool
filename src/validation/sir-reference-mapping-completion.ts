import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

export interface SirReferenceMappingCompletionContext {
  runId: string;
  expectedPairId: string;
}

interface AdjacentCriterionLike {
  criterionHandle?: unknown;
  criterionId?: unknown;
  boundarySummary?: unknown;
}

interface ParsedReferenceOutput {
  capabilityRelatedCriterionHandles: string[];
  antipatternRelatedCriterionHandles: string[];
  referenceNotes: string[];
}

function finding(
  context: SirReferenceMappingCompletionContext,
  checkId: string,
  objectPath: string,
  issue: string,
  kind: ValidationFinding['kind'] = 'REFERENCE'
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId: context.expectedPairId,
    objectPath,
    issue,
    dependencyScope: ['REFERENCE_MAPPING']
  };
}

function report(
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

function parsePairIds(pairId: string): { capabilityId: string; antipatternId: string } | undefined {
  const match = /^([A-F][1-5])_(AP-[A-F][1-5])$/.exec(pairId);
  if (!match?.[1] || !match[2]) return undefined;
  return { capabilityId: match[1], antipatternId: match[2] };
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.some((item) => typeof item !== 'string')) return undefined;
  return value as string[];
}

function parseOutput(output: unknown): ParsedReferenceOutput | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const record = output as Record<string, unknown>;
  const allowedKeys = new Set([
    'capabilityRelatedCriterionHandles',
    'antipatternRelatedCriterionHandles',
    'referenceNotes'
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return undefined;
  if (Object.keys(record).length !== allowedKeys.size) return undefined;

  const capability = parseStringArray(record.capabilityRelatedCriterionHandles);
  const antipattern = parseStringArray(record.antipatternRelatedCriterionHandles);
  const notes = parseStringArray(record.referenceNotes);
  if (!capability || !antipattern || !notes) return undefined;
  if (notes.some((item) => !item.trim())) return undefined;
  if (capability.some((item) => !/^criterion_.+/.test(item))) return undefined;
  if (antipattern.some((item) => !/^criterion_.+/.test(item))) return undefined;

  return {
    capabilityRelatedCriterionHandles: capability,
    antipatternRelatedCriterionHandles: antipattern,
    referenceNotes: notes
  };
}

function adjacentUniverse(contract: TaskContract): Map<string, string> | undefined {
  const raw = contract.lockedInputs.adjacent_criteria;
  if (!Array.isArray(raw)) return undefined;
  const map = new Map<string, string>();
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
    const item = candidate as AdjacentCriterionLike;
    if (typeof item.criterionHandle !== 'string' || !/^criterion_.+/.test(item.criterionHandle)) {
      return undefined;
    }
    if (typeof item.criterionId !== 'string' || !/^(AP-)?[A-F][1-5]$/.test(item.criterionId)) {
      return undefined;
    }
    if (typeof item.boundarySummary !== 'string' || !item.boundarySummary.trim()) {
      return undefined;
    }
    if (map.has(item.criterionHandle)) return undefined;
    map.set(item.criterionHandle, item.criterionId);
  }
  return map;
}

function validateSelections(input: {
  handles: string[];
  path: string;
  ownId: string;
  universe: Map<string, string>;
  context: SirReferenceMappingCompletionContext;
  findings: ValidationFinding[];
}): void {
  if (new Set(input.handles).size !== input.handles.length) {
    input.findings.push(
      finding(
        input.context,
        'SIR_REFERENCE_DUPLICATE_CRITERION_HANDLE',
        input.path,
        'Related-criterion handles must be unique within each object.',
        'SCHEMA'
      )
    );
  }

  input.handles.forEach((handle, index) => {
    const criterionId = input.universe.get(handle);
    if (!criterionId) {
      input.findings.push(
        finding(
          input.context,
          'SIR_REFERENCE_UNKNOWN_CRITERION_HANDLE',
          `${input.path}/${index}`,
          `Criterion handle ${handle} is absent from the Authoring Plan adjacent-criterion universe.`
        )
      );
      return;
    }
    if (criterionId === input.ownId) {
      input.findings.push(
        finding(
          input.context,
          'SIR_REFERENCE_SELF_REFERENCE',
          `${input.path}/${index}`,
          `Object ${input.ownId} cannot reference itself as a related criterion.`
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
    return report(context, findings);
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
        'Reference Mapping SIR v2 supports only the no-approved-tactic fail-safe until an approved reciprocal tactic-mapping packet exists.',
        'TACTIC'
      )
    );
  }

  const pairIds = parsePairIds(context.expectedPairId);
  if (!pairIds) {
    findings.push(
      finding(context, 'SIR_REFERENCE_PAIR_ID_INVALID', '/', 'Expected pair ID is not canonical.', 'IDENTIFIER')
    );
  }

  const universe = adjacentUniverse(contract);
  if (!universe) {
    findings.push(
      finding(
        context,
        'SIR_REFERENCE_ADJACENT_UNIVERSE_INVALID',
        '/lockedInputs/adjacent_criteria',
        'Adjacent-criterion universe is missing, malformed or contains duplicate handles.',
        'REFERENCE'
      )
    );
  }

  const parsed = parseOutput(output);
  if (!parsed) {
    findings.push(
      finding(
        context,
        'SIR_REFERENCE_OUTPUT_CONTRACT',
        '/',
        'Reference Mapping output must contain only capabilityRelatedCriterionHandles, antipatternRelatedCriterionHandles and referenceNotes with valid string-array values.',
        'SCHEMA'
      )
    );
    return report(context, findings);
  }

  if (pairIds && universe) {
    validateSelections({
      handles: parsed.capabilityRelatedCriterionHandles,
      path: '/capabilityRelatedCriterionHandles',
      ownId: pairIds.capabilityId,
      universe,
      context,
      findings
    });
    validateSelections({
      handles: parsed.antipatternRelatedCriterionHandles,
      path: '/antipatternRelatedCriterionHandles',
      ownId: pairIds.antipatternId,
      universe,
      context,
      findings
    });
  }

  return report(context, findings);
}
