export interface PlanObject {
  id: string;
  title: string;
  questions: readonly { id: string; dimension: string; question: string }[];
  tacticIds: readonly string[];
  /** Domain-level candidates only; not evidence that a passage supports a question. */
  domainSourceIds: readonly string[];
  missingSourceIds: readonly string[];
  detailGaps: readonly string[];
}

export interface PlanPair {
  id: string;
  domain: string;
  capability: PlanObject;
  antipattern: PlanObject;
}

function token(value: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(value)) throw new Error(`unsafe document path token: ${value}`);
  return value;
}

/** Relative path previews only: successful delivery must reserve a version separately. */
export function planPair(kbId: string, pairs: readonly PlanPair[], pairId: string) {
  const pair = pairs.find(candidate => candidate.id === pairId);
  if (!pair) throw new Error(`unknown pair ID ${pairId}`);
  return ([['capabilities', pair.capability], ['antipatterns', pair.antipattern]] as const).map(([type, object]) => ({
    ...object,
    documentId: `${token(kbId)}:${token(object.id)}`,
    type,
    relativePathTemplate: `${token(pair.domain)}/${type}/${token(object.id)}/<version>/document.md`
  }));
}
