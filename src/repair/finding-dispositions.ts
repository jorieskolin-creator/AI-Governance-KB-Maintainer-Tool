export const FINDING_DISPOSITIONS = ['RESOLVED', 'WAIVED', 'ACCEPTED_RISK', 'REJECTED'] as const;

export type FindingDisposition = (typeof FINDING_DISPOSITIONS)[number];
export type FindingDispositionOrOpen = FindingDisposition | 'OPEN';

export interface FindingDispositionDraft {
  findingId: string;
  disposition: FindingDisposition;
  authority: string;
  rationale: string;
}

export const DELETED_FINDING_FORM_ISSUE =
  'Findings cannot be resolved by deleting them from the form. Record an explicit disposition with authority and rationale.';

export const BLOCKING_NON_WAIVABLE_ISSUE =
  'BLOCKING findings are not waivable. Record RESOLVED after a content repair, or REJECTED.';

export const RATIONALE_REQUIRED_ISSUE = 'A disposition requires rationale of at least 10 characters.';

export const AUTO_FIX_RATIONALE = 'Operator fixed this finding after a passing focused check.';

export function autoResolvedDisposition(findingId: string, path = ''): FindingDispositionDraft {
  const at = path.trim() ? ` at ${path.trim()}` : '';
  return {
    findingId,
    disposition: 'RESOLVED',
    authority: 'OPERATOR',
    rationale: `Operator fixed this finding${at} after a passing focused check.`
  };
}

export function dispositionsForReviewFix(input: {
  body: Record<string, unknown>;
  defects: ReadonlyArray<{ defectId: string }>;
  pathFor: (findingId: string) => string;
  patches: ReadonlyArray<{ path: string }>;
  existing?: readonly FindingDispositionDraft[];
}): FindingDispositionDraft[] {
  const byId = new Map((input.existing ?? []).map((item) => [item.findingId, item]));
  const focusId = typeof input.body.findingId === 'string' ? input.body.findingId.trim() : '';
  if ((input.body.findingAction === 'fix' || focusId) && focusId) {
    byId.set(focusId, autoResolvedDisposition(focusId, input.pathFor(focusId)));
    return [...byId.values()];
  }
  const patched = new Set(input.patches.map((item) => item.path));
  if (patched.size) {
    for (const item of input.defects) {
      if (patched.has(input.pathFor(item.defectId))) {
        byId.set(item.defectId, autoResolvedDisposition(item.defectId, input.pathFor(item.defectId)));
      }
    }
  }
  return [...byId.values()];
}

export function isFindingDisposition(value: unknown): value is FindingDisposition {
  return (
    value === 'RESOLVED' || value === 'WAIVED' || value === 'ACCEPTED_RISK' || value === 'REJECTED'
  );
}

export function isClosingDisposition(value: FindingDisposition): boolean {
  return value === 'RESOLVED' || value === 'WAIVED' || value === 'ACCEPTED_RISK';
}

export function deletedFindingFormIssues(deletedIds: readonly string[]): string[] {
  return deletedIds.length > 0 ? [DELETED_FINDING_FORM_ISSUE] : [];
}

function readDraft(raw: unknown, defaultAuthority: string): FindingDispositionDraft | string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const findingId = typeof record.findingId === 'string' ? record.findingId.trim() : '';
  if (!findingId) return undefined;
  if (record.disposition === 'OPEN' || record.disposition === '' || record.disposition === undefined) {
    return undefined;
  }
  if (!isFindingDisposition(record.disposition)) {
    return `Disposition for ${findingId} must be RESOLVED, WAIVED, ACCEPTED_RISK, or REJECTED.`;
  }
  return {
    findingId,
    disposition: record.disposition,
    authority:
      typeof record.authority === 'string' && record.authority.trim()
        ? record.authority.trim()
        : defaultAuthority,
    rationale: typeof record.rationale === 'string' ? record.rationale : ''
  };
}

export function parseFindingDispositionDrafts(
  body: Record<string, unknown>,
  defaultAuthority: string
): { drafts: FindingDispositionDraft[]; issues: string[] } {
  const issues: string[] = [];
  const byId = new Map<string, FindingDispositionDraft>();
  const listed = body.findingDispositions;
  if (Array.isArray(listed)) {
    for (const item of listed) {
      const parsed = readDraft(item, defaultAuthority);
      if (typeof parsed === 'string') issues.push(parsed);
      else if (parsed) byId.set(parsed.findingId, parsed);
    }
  }
  for (const [key, value] of Object.entries(body)) {
    if (!key.startsWith('disposition:')) continue;
    const findingId = key.slice('disposition:'.length).trim();
    if (!findingId) continue;
    const rationaleRaw = body[`rationale:${findingId}`];
    const parsed = readDraft(
      {
        findingId,
        disposition: value,
        authority: defaultAuthority,
        rationale: typeof rationaleRaw === 'string' ? rationaleRaw : ''
      },
      defaultAuthority
    );
    if (typeof parsed === 'string') issues.push(parsed);
    else if (parsed) byId.set(parsed.findingId, parsed);
  }
  return { drafts: [...byId.values()], issues };
}

export function validateFindingDispositions(
  defects: ReadonlyArray<{ defectId: string; severity: string }>,
  drafts: readonly FindingDispositionDraft[]
): string[] {
  const issues: string[] = [];
  const known = new Map(defects.map((item) => [item.defectId, item]));
  for (const draft of drafts) {
    const defect = known.get(draft.findingId);
    if (!defect) {
      issues.push(`Disposition refers to unknown finding ${draft.findingId}.`);
      continue;
    }
    if (draft.rationale.trim().length < 10) {
      issues.push(`${draft.findingId}: ${RATIONALE_REQUIRED_ISSUE}`);
    }
    if (
      (draft.disposition === 'WAIVED' || draft.disposition === 'ACCEPTED_RISK') &&
      defect.severity === 'BLOCKING'
    ) {
      issues.push(`${draft.findingId}: ${BLOCKING_NON_WAIVABLE_ISSUE}`);
    }
  }
  return issues;
}

export function openDefects<T extends { defectId: string }>(
  defects: readonly T[],
  drafts: readonly FindingDispositionDraft[]
): T[] {
  const closed = new Set(
    drafts.filter((item) => isClosingDisposition(item.disposition)).map((item) => item.findingId)
  );
  return defects.filter((item) => !closed.has(item.defectId));
}

export function reviewForNamedGates<T extends { defects: readonly { defectId: string }[] }>(
  review: T,
  drafts: readonly FindingDispositionDraft[]
): T {
  return {
    ...review,
    defects: openDefects(review.defects, drafts)
  };
}

export function dispositionForFinding(
  drafts: readonly FindingDispositionDraft[],
  findingId: string
): FindingDispositionDraft | undefined {
  return drafts.find((item) => item.findingId === findingId);
}

export function blockingOpenDefects<T extends { defectId: string; severity: string }>(
  defects: readonly T[],
  drafts: readonly FindingDispositionDraft[]
): T[] {
  return openDefects(defects, drafts).filter(
    (item) => item.severity === 'HIGH' || item.severity === 'BLOCKING'
  );
}
