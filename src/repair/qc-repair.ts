import type { CognitiveTaskType } from '../domain/states.js';
import type { ValidationFinding } from '../validation/contracts.js';
import type { MaterializedPairCoherenceDefect, MaterializedPairCoherenceReview } from '../sir/pair-coherence-materializer.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';
import { buildLocalRepairContract, pathIsAllowed } from './local-repair.js';
import type { LocalRepairOutput, RepairPatch } from './local-repair.js';

const IDENTITY_KEYS = new Set([
  'handle',
  'sourceHandle',
  'locatorHandle',
  'criterionHandle',
  'lifecycleStage',
  'pairId',
  'capabilityId',
  'antipatternId',
  'pathHandle',
  'defectId',
  'packetSha256'
]);

export const SNAPSHOT_ROOT_TASK: Record<string, CognitiveTaskType> = {
  pairBoundary: 'PAIR_BOUNDARY',
  apFailureModel: 'AP_FAILURE_MODEL',
  applicability: 'APPLICABILITY',
  primaryQuestions: 'PRIMARY_QUESTIONS',
  atomics: 'ATOMIC_DECOMPOSITION',
  evidence: 'EVIDENCE_ARCHITECTURE',
  evidenceSafety: 'EVIDENCE_SAFETY',
  apAbsence: 'AP_ABSENCE_CONTRACT',
  sourceMappings: 'SOURCE_MAPPING',
  findings: 'FINDING_ARCHITECTURE',
  controlBoundary: 'CONTROL_BOUNDARY',
  lifecycleTargets: 'LIFECYCLE_ASSURANCE',
  referenceMappings: 'REFERENCE_MAPPING'
};

export function blockingQcDefects(
  review: MaterializedPairCoherenceReview
): MaterializedPairCoherenceDefect[] {
  return review.defects.filter((item) => item.severity === 'HIGH' || item.severity === 'BLOCKING');
}

export function repairPathsFromDefects(defects: MaterializedPairCoherenceDefect[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const defect of defects) {
    const candidates = defect.recommendedRepairPaths.length
      ? defect.recommendedRepairPaths
      : defect.affectedPaths;
    for (const path of candidates) {
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

export function qcDefectsToFindings(
  pairId: string,
  review: MaterializedPairCoherenceReview
): Array<{ objectId: string; checkId: string; severity: string; objectPath: string; issue: string }> {
  return review.defects.map((defect) => ({
    objectId: pairId,
    checkId: defect.defectId,
    severity: defect.severity,
    objectPath: defect.recommendedRepairPaths[0] ?? defect.affectedPaths[0] ?? '',
    issue: defect.issue
  }));
}

export { pathIsAllowed } from './local-repair.js';

type PathToken = { kind: 'key'; value: string } | { kind: 'id'; value: string };

export function tokenizeRepairPath(path: string): PathToken[] {
  if (!path.trim()) throw new Error('Repair path cannot be empty.');
  const tokens: PathToken[] = [];
  let index = 0;
  while (index < path.length) {
    if (path[index] === '[') {
      const close = path.indexOf(']', index);
      if (close < 0) throw new Error(`Repair path ${path} has an unclosed handle selector.`);
      tokens.push({ kind: 'id', value: path.slice(index + 1, close) });
      index = close + 1;
      if (path[index] === '.') index += 1;
      continue;
    }
    const dot = path.indexOf('.', index);
    const bracket = path.indexOf('[', index);
    let end = path.length;
    if (dot >= 0) end = Math.min(end, dot);
    if (bracket >= 0) end = Math.min(end, bracket);
    const key = path.slice(index, end);
    if (!key) throw new Error(`Repair path ${path} is malformed.`);
    tokens.push({ kind: 'key', value: key });
    index = end;
    if (path[index] === '.') index += 1;
  }
  return tokens;
}

function identityOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.handle === 'string') return record.handle;
  if (typeof record.lifecycleStage === 'string') return record.lifecycleStage;
  if (typeof record.criterionHandle === 'string') return record.criterionHandle;
  if (typeof record.sourceHandle === 'string' && typeof record.locatorHandle === 'string') {
    return `${record.sourceHandle}/${record.locatorHandle}`;
  }
  return undefined;
}

function selectById(value: unknown, id: string, path: string): Record<string, unknown> {
  if (!Array.isArray(value)) {
    throw new Error(`Repair path ${path} expected an array before [${id}].`);
  }
  const match = value.find((item) => identityOf(item) === id);
  if (!match || typeof match !== 'object' || Array.isArray(match)) {
    throw new Error(`Repair path ${path} does not resolve handle ${id}.`);
  }
  return match as Record<string, unknown>;
}

function preserveIdentity(previous: unknown, next: unknown): unknown {
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return next;
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
  const prior = previous as Record<string, unknown>;
  const incoming = { ...(next as Record<string, unknown>) };
  for (const key of IDENTITY_KEYS) {
    if (key in prior) incoming[key] = prior[key];
  }
  return incoming;
}

export function applySnapshotPatches<T>(object: T, patches: RepairPatch[]): T {
  const result = JSON.parse(JSON.stringify(object)) as T;
  for (const patch of patches) {
    const tokens = tokenizeRepairPath(patch.path);
    const last = tokens[tokens.length - 1];
    if (!last) throw new Error('Repair path cannot be empty.');
    if (last.kind === 'key' && IDENTITY_KEYS.has(last.value)) {
      throw new Error(`Repair path ${patch.path} attempts to change a code-owned identity field.`);
    }

    let parent: unknown = result;
    for (let index = 0; index < tokens.length - 1; index += 1) {
      const token = tokens[index]!;
      if (token.kind === 'key') {
        if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
          throw new Error(`Repair path ${patch.path} does not resolve through ${token.value}.`);
        }
        parent = (parent as Record<string, unknown>)[token.value];
      } else {
        parent = selectById(parent, token.value, patch.path);
      }
    }

    if (last.kind === 'id') {
      const node = selectById(parent, last.value, patch.path);
      const merged = preserveIdentity(node, patch.value);
      if (!merged || typeof merged !== 'object' || Array.isArray(merged)) {
        throw new Error(`Repair path ${patch.path} must replace the selected item with an object.`);
      }
      Object.keys(node).forEach((key) => {
        delete node[key];
      });
      Object.assign(node, merged);
      continue;
    }

    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) {
      throw new Error(`Repair path ${patch.path} does not resolve to an object.`);
    }
    const target = parent as Record<string, unknown>;
    target[last.value] = preserveIdentity(target[last.value], patch.value);
  }
  return result;
}

export function patchedSnapshotRoots(paths: readonly string[]): CognitiveTaskType[] {
  const types = new Set<CognitiveTaskType>();
  for (const path of paths) {
    const root = tokenizeRepairPath(path)[0];
    if (!root || root.kind !== 'key' || !(root.value in SNAPSHOT_ROOT_TASK)) {
      throw new Error(`Repair path ${path} is outside the pair snapshot.`);
    }
    types.add(SNAPSHOT_ROOT_TASK[root.value]!);
  }
  return [...types];
}

export function snapshotSlice(snapshot: PairCoherenceSnapshot, taskType: CognitiveTaskType): unknown {
  const entry = Object.entries(SNAPSHOT_ROOT_TASK).find(([, type]) => type === taskType);
  if (!entry) throw new Error(`No pair snapshot root for ${taskType}.`);
  return snapshot[entry[0] as keyof PairCoherenceSnapshot];
}

export function buildQcLocalRepairContract(input: {
  pairId: string;
  review: MaterializedPairCoherenceReview;
  snapshot: PairCoherenceSnapshot;
}): ReturnType<typeof buildLocalRepairContract> {
  const defects = blockingQcDefects(input.review);
  if (!defects.length) {
    throw new Error(`${input.pairId} has no HIGH or BLOCKING pair-coherence defects to repair.`);
  }
  const allowedPaths = repairPathsFromDefects(defects);
  if (!allowedPaths.length) {
    throw new Error(`${input.pairId} pair-coherence defects have no recommended repair paths.`);
  }
  const finding: ValidationFinding = {
    checkId: 'PAIR_COHERENCE_QC',
    kind: 'SEMANTIC',
    severity: defects.some((item) => item.severity === 'BLOCKING') ? 'BLOCKING' : 'HIGH',
    objectId: input.pairId,
    objectPath: allowedPaths[0]!,
    issue: defects.map((item) => item.issue).join(' | '),
    dependencyScope: allowedPaths.slice(1),
    recommendedAction: 'Apply path-scoped semantic repairs, then re-run PAIR_COHERENCE_REVIEW.'
  };
  return buildLocalRepairContract({
    pairId: input.pairId,
    finding,
    frozenObject: input.snapshot,
    relevantDependencies: {
      coherenceSummary: input.review.coherenceSummary,
      defects
    }
  });
}

export function assertRepairOutputInScope(output: LocalRepairOutput, allowedPaths: readonly string[]): void {
  for (const repair of output.repairs) {
    if (!pathIsAllowed(repair.path, allowedPaths)) {
      throw new Error(`Repair attempted undeclared path ${repair.path}.`);
    }
  }
}
