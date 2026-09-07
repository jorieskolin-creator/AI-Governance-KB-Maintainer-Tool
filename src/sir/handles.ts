import type { SirHandle, SirHandleKind } from './model.js';

const HANDLE_PATTERN = /^(question|atomic|evidence|finding|source|tactic|criterion)_[0-9]{3}$/;

export function createSirHandle(kind: SirHandleKind, ordinal: number): SirHandle {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 999) {
    throw new Error(`SIR handle ordinal must be an integer from 1 to 999; received ${ordinal}.`);
  }
  return `${kind}_${String(ordinal).padStart(3, '0')}` as SirHandle;
}

export function assertValidSirHandle(handle: string, expectedKind?: SirHandleKind): asserts handle is SirHandle {
  if (!HANDLE_PATTERN.test(handle)) {
    throw new Error(`Invalid SIR local handle ${handle}.`);
  }
  if (expectedKind && !handle.startsWith(`${expectedKind}_`)) {
    throw new Error(`Expected ${expectedKind} handle, received ${handle}.`);
  }
}

export class SirHandleAllocator {
  private readonly nextOrdinal = new Map<SirHandleKind, number>();

  next(kind: SirHandleKind): SirHandle {
    const ordinal = this.nextOrdinal.get(kind) ?? 1;
    const handle = createSirHandle(kind, ordinal);
    this.nextOrdinal.set(kind, ordinal + 1);
    return handle;
  }
}
