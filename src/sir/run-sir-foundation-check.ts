import { SirHandleAllocator, assertValidSirHandle, createSirHandle } from './handles.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function main(): void {
  assert(createSirHandle('atomic', 1) === 'atomic_001', 'Atomic handle allocation must be deterministic.');
  assert(createSirHandle('evidence', 12) === 'evidence_012', 'Evidence handle zero-padding must be deterministic.');

  const allocator = new SirHandleAllocator();
  const firstAtomic = allocator.next('atomic');
  const secondAtomic = allocator.next('atomic');
  const firstEvidence = allocator.next('evidence');

  assert(firstAtomic === 'atomic_001', 'First atomic handle must be atomic_001.');
  assert(secondAtomic === 'atomic_002', 'Second atomic handle must be atomic_002.');
  assert(firstEvidence === 'evidence_001', 'Handle sequences must be independent by kind.');

  assertValidSirHandle(firstAtomic, 'atomic');
  assertValidSirHandle(firstEvidence, 'evidence');

  let canonicalIdRejected = false;
  try {
    assertValidSirHandle('A2-SC-001');
  } catch {
    canonicalIdRejected = true;
  }
  assert(canonicalIdRejected, 'Canonical IDs must never be accepted as SIR local handles.');

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        handles: [firstAtomic, secondAtomic, firstEvidence],
        canonicalIdAcceptedAsSirHandle: false
      },
      null,
      2
    )
  );
}

main();
