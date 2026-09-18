import { SNAPSHOT_ROOT_TASK, tokenizeRepairPath } from '../repair/qc-repair.js';
import {
  schemaGateSnapshotIssues,
  schemaGateTouchedSectionIssues
} from '../validation/sir-snapshot-schema.js';

export const LOCKED_TECHNICAL_ASSURANCE = [
  'UNKNOWN',
  'DECLARED',
  'IMPLEMENTED',
  'TESTED',
  'OPERATIONALLY_OBSERVED'
] as const;

const LOCKED_TECHNICAL_ASSURANCE_SET = new Set<string>(LOCKED_TECHNICAL_ASSURANCE);

function capabilityIdOf(pairId: string): string {
  return pairId.split('_')[0] ?? pairId;
}

function collectIdentityIssues(pairId: string, value: unknown, path = ''): string[] {
  const capabilityId = capabilityIdOf(pairId);
  const antipatternId = `AP-${capabilityId}`;
  const issues: string[] = [];
  if (!value || typeof value !== 'object') return issues;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      issues.push(...collectIdentityIssues(pairId, item, `${path}[${String(index)}]`));
    });
    return issues;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.pairId === 'string' && record.pairId !== pairId) {
    issues.push(`${path || '/'}.pairId drifted to ${record.pairId}.`);
  }
  if (typeof record.capabilityId === 'string' && record.capabilityId !== capabilityId) {
    issues.push(`${path || '/'}.capabilityId drifted to ${record.capabilityId}.`);
  }
  if (typeof record.antipatternId === 'string' && record.antipatternId !== antipatternId) {
    issues.push(`${path || '/'}.antipatternId drifted to ${record.antipatternId}.`);
  }
  for (const [key, child] of Object.entries(record)) {
    if (child && typeof child === 'object') {
      issues.push(...collectIdentityIssues(pairId, child, path ? `${path}.${key}` : key));
    }
  }
  return issues;
}

function collectHandleIssues(value: unknown, path = ''): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== 'object') return issues;
  if (Array.isArray(value)) {
    const seen = new Map<string, number>();
    value.forEach((item, index) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const handle = (item as { handle?: unknown }).handle;
        if (typeof handle === 'string') {
          if (!handle.trim()) {
            issues.push(`${path}[${String(index)}].handle is empty.`);
          } else if (seen.has(handle)) {
            issues.push(`${path} has duplicate handle ${handle}.`);
          } else {
            seen.set(handle, index);
          }
        }
      }
      issues.push(...collectHandleIssues(item, `${path}[${String(index)}]`));
    });
    return issues;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (child && typeof child === 'object') {
      issues.push(...collectHandleIssues(child, path ? `${path}.${key}` : key));
    }
  }
  return issues;
}

export function schemaGate(pairId: string, snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return ['Pair snapshot is missing required sections.'];
  }
  const issues = schemaGateSnapshotIssues(snapshot as Record<string, unknown>);
  issues.push(...collectIdentityIssues(pairId, snapshot));
  issues.push(...collectHandleIssues(snapshot));
  return issues;
}

export function snapshotRootsFromPaths(paths: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const path of paths) {
    if (!path.trim()) continue;
    const root = tokenizeRepairPath(path)[0];
    if (!root || root.kind !== 'key') continue;
    if (root.value in SNAPSHOT_ROOT_TASK) roots.add(root.value);
  }
  return [...roots];
}

/**
 * Focused QC for a review/fix save: the snapshot section(s) touched by the
 * finding or patch, plus handles and outgoing references those sections use.
 * Does not re-validate untouched sections or other pairs. Whole-snapshot
 * schemaGate remains the gate for VALIDATED / READY_FOR_APPROVAL / publication.
 */
export function schemaGateFocused(
  pairId: string,
  snapshot: unknown,
  touchedPaths: readonly string[]
): string[] {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return ['Pair snapshot is missing required sections.'];
  }
  const roots = snapshotRootsFromPaths(touchedPaths);
  if (!roots.length) return [];
  const record = snapshot as Record<string, unknown>;
  const issues = schemaGateTouchedSectionIssues(record, roots);
  for (const root of roots) {
    issues.push(...collectIdentityIssues(pairId, record[root], root));
    issues.push(...collectHandleIssues(record[root], root));
  }
  return issues;
}

function coerceAssuranceList(items: unknown, prefix: string, coercedPaths: string[]): void {
  if (!Array.isArray(items)) return;
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const value = record.minimumTechnicalAssurance;
    if (typeof value !== 'string') continue;
    if (LOCKED_TECHNICAL_ASSURANCE_SET.has(value)) continue;
    record.minimumTechnicalAssurance = 'UNKNOWN';
    coercedPaths.push(`${prefix}[${String(index)}].minimumTechnicalAssurance`);
  }
}

/**
 * Option 2 (Maintainer fix): illegal locked-vocabulary values become UNKNOWN.
 * The finding stays open. Option 1 cannot use this; it may only save when the
 * focused check says the new value is already in the locked set.
 */
export function coerceLockedTechnicalAssurance<T>(snapshot: T): { snapshot: T; coercedPaths: string[] } {
  const clone = JSON.parse(JSON.stringify(snapshot)) as T;
  const coercedPaths: string[] = [];
  if (!clone || typeof clone !== 'object' || Array.isArray(clone)) {
    return { snapshot: clone, coercedPaths };
  }
  const record = clone as Record<string, unknown>;
  const lifecycle = record.lifecycleTargets;
  if (lifecycle && typeof lifecycle === 'object' && !Array.isArray(lifecycle)) {
    const targets = lifecycle as { capability?: unknown; antipattern?: unknown };
    coerceAssuranceList(targets.capability, 'lifecycleTargets.capability', coercedPaths);
    coerceAssuranceList(targets.antipattern, 'lifecycleTargets.antipattern', coercedPaths);
  }
  const evidence = record.evidence;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const items = evidence as { capability?: unknown; antipattern?: unknown };
    coerceAssuranceList(items.capability, 'evidence.capability', coercedPaths);
    coerceAssuranceList(items.antipattern, 'evidence.antipattern', coercedPaths);
  }
  return { snapshot: clone, coercedPaths };
}
