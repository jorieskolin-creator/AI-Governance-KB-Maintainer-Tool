const HANDLE_ORDINAL = /^(atomic|evidence|finding|source|locator|question|tactic|criterion)_([0-9]{3})$/;

export function handleOrdinal(handle: string, expectedKind?: string): number | undefined {
  const match = HANDLE_ORDINAL.exec(handle);
  if (!match) return undefined;
  if (expectedKind && match[1] !== expectedKind) return undefined;
  return Number(match[2]);
}

function pad(ordinal: number): string {
  return String(ordinal).padStart(3, '0');
}

export function questionId(objectId: string, slot: 1 | 2 | 3): string {
  return `${objectId}-Q${slot}`;
}

export function capabilityAtomicId(capabilityId: string, ordinal: number): string {
  return `${capabilityId}-SC-${pad(ordinal)}`;
}

export function antipatternAtomicId(antipatternId: string, ordinal: number): string {
  return `${antipatternId}-AT-${pad(ordinal)}`;
}

export function evidenceId(objectId: string, ordinal: number): string {
  return `EVD-${objectId}-${pad(ordinal)}`;
}

export function findingId(objectId: string, ordinal: number): string {
  return `FND-${objectId}-${pad(ordinal)}`;
}

export function sourceMappingId(objectId: string, ordinal: number): string {
  return `SRCMAP-${objectId}-${pad(ordinal)}`;
}
