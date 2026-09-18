import { coerceLockedTechnicalAssurance, schemaGate, schemaGateFocused } from './schema-gate.js';
import {
  FIX_SAVE_CONTINUE,
  MAINTAINER_FIX_THIS,
  PARK_FIX_LATER,
  DEFAULT_PARK_OWNER,
  DEFAULT_PARK_REASON,
  findingActionStatus,
  parkReasonAndOwner,
  renderFindingActionButtons,
  renderFindingStatus,
  renderReviewClientScript
} from './review-fix-ui.js';
import { dispositionsForReviewFix } from '../repair/finding-dispositions.js';
import { validMinimalSnapshotFixture } from '../validation/sir-snapshot-schema.js';
import { maintainerFixFinding } from './maintainer-fix-finding.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectThrow(run: () => Promise<unknown>, includes: string, message: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert(text.includes(includes), `${message} (got: ${text})`);
    return;
  }
  throw new Error(`${message} (no error thrown)`);
}

const snapshot = validMinimalSnapshotFixture();
assert(schemaGate('A1_AP-A1', snapshot).length === 0, 'fixture snapshot is fully schema-valid');

const brokenLifecycle = structuredClone(snapshot);
(brokenLifecycle.lifecycleTargets as { capability: Array<{ minimumTechnicalAssurance: string }> }).capability[0]!.minimumTechnicalAssurance =
  'MAGIC';
const brokenEvidenceGraph = structuredClone(snapshot);
(
  brokenEvidenceGraph.evidence as {
    capability: Array<{ supportsAtomicHandles: string[] }>;
  }
).capability[0]!.supportsAtomicHandles = ['atomic_999'];

assert(
  schemaGate('A1_AP-A1', brokenLifecycle).some((item) => item.includes('minimumTechnicalAssurance')),
  'whole-snapshot schemaGate still rejects illegal locked vocabulary'
);
assert(
  schemaGateFocused('A1_AP-A1', brokenLifecycle, ['evidence.capability[evidence_001]']).length === 0,
  'focused check of evidence does not re-validate an illegal lifecycle enum on another section'
);
assert(
  schemaGateFocused('A1_AP-A1', brokenLifecycle, ['lifecycleTargets']).some((item) =>
    item.includes('minimumTechnicalAssurance')
  ),
  'option 1 cannot save illegal minimumTechnicalAssurance: focused check requires the locked set'
);
assert(
  schemaGateFocused('A1_AP-A1', snapshot, ['evidence.capability[evidence_001]']).length === 0,
  'focused evidence check passes when the touched section and its atomic handles are valid'
);
assert(
  schemaGateFocused('A1_AP-A1', brokenEvidenceGraph, ['evidence.capability[evidence_001]']).some((item) =>
    item.includes('atomic_999')
  ),
  'focused check keeps adjacent graph: evidence may not reference an unknown atomic'
);
assert(
  schemaGateFocused('A1_AP-A1', brokenEvidenceGraph, ['lifecycleTargets']).length === 0,
  'focused lifecycle check does not re-run the evidence graph'
);

const coerced = coerceLockedTechnicalAssurance(brokenLifecycle);
assert(
  coerced.coercedPaths.some((item) => item.includes('minimumTechnicalAssurance')),
  'option 2 records the coerced assurance path'
);
assert(
  (coerced.snapshot as { lifecycleTargets: { capability: Array<{ minimumTechnicalAssurance: string }> } })
    .lifecycleTargets.capability[0]?.minimumTechnicalAssurance === 'UNKNOWN',
  'option 2 coerces illegal minimumTechnicalAssurance to UNKNOWN'
);
assert(
  schemaGateFocused('A1_AP-A1', coerced.snapshot, ['lifecycleTargets']).length === 0,
  'after option 2 coerce, focused lifecycle check passes and the finding can remain open'
);
const noOp = coerceLockedTechnicalAssurance(snapshot);
assert(noOp.coercedPaths.length === 0, 'locked values already in the set are not coerced');

const buttons = renderFindingActionButtons({
  defectId: 'defect_001',
  pairId: 'A2_AP-A2',
  commandsEnabled: true
});
assert(buttons.includes(FIX_SAVE_CONTINUE), 'finding has Fix, save and continue');
assert(buttons.includes(MAINTAINER_FIX_THIS), 'finding has Maintainer, fix this');
assert(buttons.includes(PARK_FIX_LATER), 'finding has Park, fix after the rest is ready');
assert(buttons.includes('data-finding-action="park"'), 'park is a finding action, not accepted risk');
assert(buttons.includes('data-pair-id="A2_AP-A2"'), 'park targets this pair/object');
assert(buttons.includes(DEFAULT_PARK_REASON), 'park reason is pre-filled so one click parks');
assert(renderFindingActionButtons({ defectId: 'defect_001', pairId: 'A2_AP-A2', commandsEnabled: true, status: 'PARKED' }) === '', 'parked finding hides Fix/Maintainer/Park');
assert(renderFindingActionButtons({ defectId: 'defect_001', pairId: 'A2_AP-A2', commandsEnabled: true, status: 'FIXED' }) === '', 'fixed finding hides Fix/Maintainer/Park');
assert(renderFindingStatus({ status: 'PARKED', parkReason: 'Waiting on legal.' }).includes('data-finding-status="PARKED"'), 'parked status is visible on the finding');
assert(renderFindingStatus({ status: 'PARKED', parkReason: 'Waiting on legal.' }).includes('Waiting on legal.'), 'parked status shows why');
assert(renderFindingStatus({ status: 'FIXED' }).includes('data-finding-status="FIXED"'), 'fixed status is visible on the finding');
assert(findingActionStatus({ pairParked: true, disposition: 'REJECTED' }) === 'PARKED', 'parking is the status even if a leftover REJECTED record exists');
assert(findingActionStatus({ pairParked: false, disposition: 'RESOLVED' }) === 'FIXED', 'a passing Fix is Fixed, not a picker value');
assert(findingActionStatus({ pairParked: false, disposition: 'REJECTED' }) === 'OPEN', 'REJECTED is not a user-facing close');
assert(parkReasonAndOwner('', '').reason === DEFAULT_PARK_REASON, 'empty park reason uses the default');
assert(parkReasonAndOwner('x', '').reason === DEFAULT_PARK_REASON, 'short park reason uses the default');
assert(parkReasonAndOwner('', '').owner === DEFAULT_PARK_OWNER, 'empty park owner uses the default');
assert(parkReasonAndOwner('Awaiting the delegated act.', 'LEGAL_REVIEW').owner === 'LEGAL_REVIEW', 'explicit park owner is kept');

const autoFix = dispositionsForReviewFix({
  body: { findingAction: 'fix', findingId: 'defect_001' },
  defects: [{ defectId: 'defect_001' }, { defectId: 'defect_002' }],
  pathFor: (id) => (id === 'defect_001' ? 'evidence.capability[evidence_001]' : 'findings.capability'),
  patches: [{ path: 'evidence.capability[evidence_001]' }],
  existing: [
    {
      findingId: 'defect_002',
      disposition: 'RESOLVED',
      authority: 'OPERATOR',
      rationale: 'Previous finding already closed after a focused check.'
    }
  ]
});
assert(autoFix.some((item) => item.findingId === 'defect_001' && item.disposition === 'RESOLVED'), 'Fix auto-records RESOLVED for named gates');
assert(autoFix.some((item) => item.findingId === 'defect_002' && item.disposition === 'RESOLVED'), 'Fix keeps previously closed findings');

const pairScript = renderReviewClientScript('pair');
const domainScript = renderReviewClientScript('domain');
assert(!pairScript.includes('window.alert'), 'pair client lists issues on the page');
assert(!domainScript.includes('window.alert'), 'domain client lists issues on the page');
assert(domainScript.includes("action: 'finalize-later'"), 'domain review parks from the finding');
assert(pairScript.includes("action: 'maintainer-fix-finding'"), 'pair review asks Maintainer to fix this finding');
assert(pairScript.includes('/review/') && pairScript.includes("encodeURIComponent(pairId)"), 'pair park stays on the pair review so Parked is visible');
assert(domainScript.includes('/review/') && domainScript.includes('?notice='), 'domain park stays on domain review so other findings can move');

const priorFlag = process.env.OPERATOR_COMMANDS_ENABLED;
process.env.OPERATOR_COMMANDS_ENABLED = 'false';
await expectThrow(
  () => maintainerFixFinding({ domain: 'A', pairId: 'A1_AP-A1', findingId: 'defect_001' }),
  'disabled',
  'Maintainer fix is fail-closed when operator commands are disabled'
);
if (priorFlag === undefined) delete process.env.OPERATOR_COMMANDS_ENABLED;
else process.env.OPERATOR_COMMANDS_ENABLED = priorFlag;

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      focusedCheckIgnoresOtherSectionEnum: 'PASS',
      focusedCheckRejectsIllegalTouchedAssurance: 'PASS',
      focusedCheckKeepsAdjacentGraph: 'PASS',
      fullSchemaGateUnchanged: 'PASS',
      option2CoercesToUnknown: 'PASS',
      threeFindingActions: 'PASS',
      parkedAndFixedStatus: 'PASS',
      autoResolvedOnFix: 'PASS',
      parkDefaults: 'PASS',
      noAlert: 'PASS',
      parkFromDomainReview: 'PASS',
      maintainerFixFailClosed: 'PASS'
    },
    null,
    2
  )
);
