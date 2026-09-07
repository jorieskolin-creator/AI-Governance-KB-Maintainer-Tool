import { schemaGateSnapshotIssues } from '../validation/sir-snapshot-schema.js';
import { validMinimalSnapshotFixture } from '../validation/sir-snapshot-schema.js';
import { renderCandidateObjectHtml, type DomainCandidateBundle } from '../operator/candidate-documents.js';
import { compileGateResult, compileSirPair, parsePersistedSirSnapshot } from './sir-compiler.js';
import { a2CompileAuthoringPlan, completeSirCompileSnapshot } from './sir-compile-fixture.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function idsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    const record = item as Record<string, unknown>;
    return String(record.id ?? record.mapping_id ?? '');
  });
}

const plan = a2CompileAuthoringPlan();
const snapshot = completeSirCompileSnapshot();
assert(schemaGateSnapshotIssues(snapshot as unknown as Record<string, unknown>).length === 0, 'compile fixture must pass SIR section schemas');
const parsed = parsePersistedSirSnapshot(snapshot);
assert(parsed.ok, 'compile fixture must parse as a persisted SIR snapshot');

const draft = await compileSirPair({
  authoringPlan: plan,
  snapshot,
  mode: 'DRAFT',
  reviewNotes: ['Pair coherence passed with remaining visible notes.']
});
assert(draft.ok && draft.outcome === 'CANONICAL_COMPILE_VALID', `complete fixture must compile as DRAFT; defects=${draft.defects.map((item) => item.checkId).join(',')}`);
assert(draft.capability && draft.antipattern, 'successful compile must emit both objects');
assert(draft.capability.id === 'A2' && draft.antipattern.id === 'AP-A2', 'object IDs come from the Authoring Plan');
assert(draft.capability.schema_version === '2.1.0' && draft.capability.release_status === 'DRAFT', 'schema version and DRAFT status are compiler-owned');
assert(!('approval_record' in draft.capability) && !('approval_record' in draft.antipattern), 'DRAFT compile must not invent approval records');

const capabilityQuestions = idsOf(draft.capability.primary_questions);
const antipatternQuestions = idsOf(draft.antipattern.primary_questions);
assert(capabilityQuestions.join(',') === 'A2-Q1,A2-Q2,A2-Q3', 'capability question IDs are slot-derived');
assert(antipatternQuestions.join(',') === 'AP-A2-Q1,AP-A2-Q2,AP-A2-Q3', 'anti-pattern question IDs are slot-derived');
assert(idsOf(draft.capability.atomic_subcriteria).join(',') === 'A2-SC-001,A2-SC-002,A2-SC-003', 'capability atomic IDs are compiler-assigned');
assert(idsOf(draft.antipattern.atomic_tests).join(',') === 'AP-A2-AT-001,AP-A2-AT-002,AP-A2-AT-003', 'anti-pattern atomic IDs are compiler-assigned');
assert(idsOf(draft.capability.required_evidence).join(',') === 'EVD-A2-001,EVD-A2-002,EVD-A2-003', 'capability evidence IDs are compiler-assigned');
assert(idsOf(draft.antipattern.required_evidence).join(',') === 'EVD-AP-A2-001,EVD-AP-A2-002,EVD-AP-A2-003', 'anti-pattern evidence IDs are compiler-assigned');
assert(idsOf(draft.capability.finding_definitions).join(',') === 'FND-A2-001', 'capability finding IDs are compiler-assigned');
assert(idsOf(draft.antipattern.finding_definitions).join(',') === 'FND-AP-A2-001', 'anti-pattern finding IDs are compiler-assigned');
assert(idsOf(draft.capability.normative_source_mappings).join(',') === 'SRCMAP-A2-001', 'source mapping IDs are compiler-assigned');

const firstAtomic = Array.isArray(draft.capability.atomic_subcriteria)
  ? (draft.capability.atomic_subcriteria[0] as Record<string, unknown>)
  : {};
assert(
  JSON.stringify(firstAtomic.required_evidence_ids) === JSON.stringify(['EVD-A2-001']),
  'SIR evidence-to-atomic handles invert into canonical required_evidence_ids'
);
assert(
  Array.isArray(draft.capability.related_criteria) && draft.capability.related_criteria.includes('A1') && draft.capability.related_criteria.includes('AP-A2'),
  'related criteria emit Authoring Plan canonical IDs, not handles'
);
assert(
  draft.notes.some((note) => note.includes('Unmapped ANTIPATTERN claim')),
  'visible source gaps remain in DRAFT candidate metadata'
);
assert(compileGateResult(draft).outcome === 'CANONICAL_COMPILE_VALID', 'successful compile records CANONICAL_COMPILE_VALID');

const bundle: DomainCandidateBundle = {
  documentKind: 'DOMAIN_PRODUCTION_CANDIDATE_BUNDLE',
  domain: 'A',
  domainTitle: plan.identity.domainTitle,
  domainState: 'IN_PROGRESS',
  domainCoherence: 'NONE',
  releaseStatus: 'DRAFT',
  approval: 'NOT_GRANTED',
  pairs: [
    {
      pairId: 'A2_AP-A2',
      status: 'COMPILED',
      notes: draft.notes,
      capability: draft.capability,
      antipattern: draft.antipattern
    }
  ],
  documents: [
    {
      pairId: 'A2_AP-A2',
      objectId: 'A2',
      objectType: 'CAPABILITY',
      title: plan.identity.capabilityTitle,
      status: 'COMPILED',
      href: '/documents/A/A2',
      htmlHref: '/documents/A/A2',
      jsonHref: '/api/operator/documents/A/A2.json',
      notes: draft.notes
    }
  ]
};
const html = renderCandidateObjectHtml({ domain: 'A', bundle, objectId: 'A2' });
for (const identity of ['A2-Q1', 'A2-SC-001', 'EVD-A2-001', 'FND-A2-001', 'SRCMAP-A2-001']) {
  assert(html.includes(identity), `DRAFT HTML must include canonical identity ${identity}`);
}
assert(!html.toLowerCase().includes('undefined'), 'DRAFT HTML must not contain missing identities');

const incomplete = await compileSirPair({
  authoringPlan: plan,
  snapshot: validMinimalSnapshotFixture(),
  mode: 'DRAFT'
});
assert(!incomplete.ok && incomplete.outcome === 'COMPILE_FAILED', 'structurally incomplete SIR must not be described as canonical');
assert(
  incomplete.defects.filter((item) => item.checkId === 'ATOMIC_EVIDENCE_BINDING').length >= 4,
  'unbound atomics must all be collected rather than stopping at the first mismatch'
);
assert(!incomplete.capability && !incomplete.antipattern, 'failed compile must not emit canonical objects');
assert(compileGateResult(incomplete).outcome === 'COMPILE_FAILED', 'failed compile records COMPILE_FAILED');

const broken = structuredClone(snapshot);
broken.evidence.capability[0]!.supportsAtomicHandles = ['atomic_999'];
const brokenReport = await compileSirPair({ authoringPlan: plan, snapshot: broken, mode: 'DRAFT' });
assert(!brokenReport.ok, 'unknown atomic handles fail compile');
assert(
  brokenReport.defects.filter((item) => item.issue.includes('atomic_999')).length >= 1,
  'unknown handle defects are collected by handle'
);
assert(
  brokenReport.defects.length > 1,
  'the unknown-handle compile report collects the full defect set rather than stopping at the first mismatch'
);

const empty = await compileSirPair({ authoringPlan: plan, snapshot: {}, mode: 'DRAFT' });
assert(!empty.ok && empty.defects.length > 1, 'empty snapshot collects every missing-section defect');
assert(
  empty.defects.every((item) => item.checkId === 'SIR_SNAPSHOT_SCHEMA'),
  'persisted non-SIR objects are not cast into V1 identity-bearing contracts'
);

const release = await compileSirPair({ authoringPlan: plan, snapshot, mode: 'RELEASE' });
assert(!release.ok, 'release compile stays closed without approval records and with remaining source gaps');
assert(
  release.defects.some((item) => item.checkId === 'SOURCE_UNMAPPED_CLAIM') &&
    release.defects.some((item) => item.checkId === 'APPROVAL_RECORD'),
  'release policy defects are collected together'
);

console.log(
  JSON.stringify({
    draftOutcome: draft.outcome,
    capabilityId: draft.capability.id,
    antipatternId: draft.antipattern.id,
    identities: {
      questions: capabilityQuestions,
      atomics: idsOf(draft.capability.atomic_subcriteria),
      evidence: idsOf(draft.capability.required_evidence),
      findings: idsOf(draft.capability.finding_definitions),
      mappings: idsOf(draft.capability.normative_source_mappings)
    },
    incompleteOutcome: incomplete.outcome,
    incompleteDefectCount: incomplete.defects.length,
    unknownHandleOutcome: brokenReport.outcome,
    releaseOutcome: release.outcome
  })
);
console.log('SIR_COMPILER_CHECK_PASS');
