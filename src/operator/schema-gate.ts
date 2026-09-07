import { schemaGateSnapshotIssues } from '../validation/sir-snapshot-schema.js';

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
