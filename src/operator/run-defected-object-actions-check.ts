import { renderPairActions, renderPairReviewHtml, type PairReviewPage } from './pair-review.js';
import { renderDomainReviewHtml } from './domain-review.js';
import {
  assertReworkWithGenAiAvailable,
  finalizeLaterForPair,
  regenerateSection
} from './commands.js';
import { reviewSaveMayValidatePair } from './eligibility.js';

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

const defectedPage: PairReviewPage = {
  domain: 'A',
  pairId: 'A1_AP-A1',
  pairState: 'REPAIR_REQUIRED',
  passed: false,
  coherenceSummary: 'HIGH evidence defect remains.',
  defects: [
    {
      defectId: 'defect_001',
      severity: 'HIGH',
      coherenceDimension: 'EVIDENCE_INTERPRETATION',
      issue: 'Capability evidence title is too thin.',
      coherenceExpectation: 'Evidence titles must state a testable claim.',
      path: 'evidence.capability[evidence_001]',
      currentValue: { handle: 'evidence_001', title: 'Thin' },
      valueJson: '{"handle":"evidence_001","title":"Thin"}',
      disposition: 'OPEN',
      rationale: ''
    }
  ],
  blockingCount: 1,
  gateIssues: [],
  candidateHash: 'c'.repeat(64),
  hasCoherenceReview: true,
  regenerableSections: ['EVIDENCE_ARCHITECTURE', 'FINDING_ARCHITECTURE'],
  reworkAvailable: true,
  commandsEnabled: true
};

const actionsHtml = renderPairActions(defectedPage);
assert(actionsHtml.includes('value="rework-with-genai"'), 'Rework with GenAI action is offered on a defected object');
assert(actionsHtml.includes('value="regenerate-section"'), 'Regenerate a section action is offered');
assert(actionsHtml.includes('value="finalize-later"'), 'Save & Finalize Later action is offered');
assert(actionsHtml.includes('name="owner"'), 'Finalize Later captures an owner/category');
assert(actionsHtml.includes('name="reason"'), 'Finalize Later captures a free-text reason');
assert(actionsHtml.includes('value="EVIDENCE_ARCHITECTURE"'), 'Regenerate lists the completed sections');

const APPROVE_BUTTON = '<button type="submit">Approve and save</button>';
const reviewHtml = renderPairReviewHtml(defectedPage);
assert(reviewHtml.includes('data-disposition-finding="defect_001"'), 'coherence disposition form is preserved for Edit');
assert(reviewHtml.includes(APPROVE_BUTTON), 'Edit + Approve stays available when a coherence review exists');
assert(reviewHtml.includes('pair-actions'), 'the four-action set renders under the review');
assert(reviewHtml.includes('Fix, save and continue'), 'finding offers Fix, save and continue');
assert(reviewHtml.includes('Maintainer, fix this'), 'finding offers Maintainer, fix this');
assert(reviewHtml.includes('Park, fix after the rest is ready'), 'finding offers Park');
assert(!reviewHtml.includes('window.alert'), 'failed focused checks stay on the page without alert');
assert(
  !reviewHtml.includes('<option value="ACCEPTED_RISK"'),
  'ACCEPTED_RISK is hidden from the primary disposition list so it is not used as a defer'
);

const earlyStagePage: PairReviewPage = {
  domain: 'A',
  pairId: 'A3_AP-A3',
  pairState: 'REPAIR_REQUIRED',
  passed: false,
  coherenceSummary: 'No readable Pair Coherence review yet.',
  defects: [],
  blockingCount: 0,
  gateIssues: [],
  hasCoherenceReview: false,
  regenerableSections: ['PAIR_BOUNDARY'],
  reworkAvailable: false,
  commandsEnabled: true
};
const earlyHtml = renderPairReviewHtml(earlyStagePage);
assert(!earlyHtml.includes(APPROVE_BUTTON), 'Approve is hidden when there is no readable coherence review');
assert(earlyHtml.includes('value="finalize-later"'), 'Finalize Later is reachable for an earlier-stage defect');
assert(earlyHtml.includes('value="regenerate-section"'), 'Regenerate is reachable for an earlier-stage defect');
assert(!earlyHtml.includes('value="rework-with-genai"'), 'GenAI rework needs coherence defects and is not offered without them');

const disabledPage: PairReviewPage = { ...defectedPage, commandsEnabled: false };
assert(renderPairActions(disabledPage).includes('disabled'), 'actions are disabled when operator commands are off');

// Operator command guards fire before any database access.
const priorFlag = process.env.OPERATOR_COMMANDS_ENABLED;
process.env.OPERATOR_COMMANDS_ENABLED = 'false';
await expectThrow(
  () => finalizeLaterForPair({ domain: 'A', pairId: 'A1_AP-A1', reason: 'Awaiting the delegated act.', owner: 'LEGAL_REVIEW' }),
  'disabled',
  'Finalize Later is fail-closed when operator commands are disabled'
);
await expectThrow(
  () => regenerateSection({ domain: 'A', pairId: 'A1_AP-A1', taskType: 'EVIDENCE_ARCHITECTURE' }),
  'disabled',
  'Regenerate is fail-closed when operator commands are disabled'
);
await expectThrow(
  () => assertReworkWithGenAiAvailable({ domain: 'A', pairId: 'A1_AP-A1' }),
  'disabled',
  'Rework with GenAI is fail-closed when operator commands are disabled'
);

process.env.OPERATOR_COMMANDS_ENABLED = 'true';
await expectThrow(
  () => finalizeLaterForPair({ domain: 'A', pairId: 'A1_AP-A1', reason: 'x', owner: 'LEGAL_REVIEW' }),
  'reason of at least 5 characters',
  'Finalize Later requires a substantive reason'
);
await expectThrow(
  () => finalizeLaterForPair({ domain: 'A', pairId: 'A1_AP-A1', reason: 'Awaiting the delegated act.', owner: '' }),
  'owner or category',
  'Finalize Later requires an owner/category'
);
if (priorFlag === undefined) delete process.env.OPERATOR_COMMANDS_ENABLED;
else process.env.OPERATOR_COMMANDS_ENABLED = priorFlag;

assert(reviewSaveMayValidatePair(true, 0), 'Edit/Approve may VALIDATE when parked items are closed');
assert(
  !reviewSaveMayValidatePair(true, 1),
  'Edit/Approve must not VALIDATE a pair while FINALIZE_LATER items remain open'
);

const domainReviewHtml = renderDomainReviewHtml({
  domain: 'A',
  domainState: 'REPAIR_REQUIRED',
  passed: false,
  coherenceSummary: 'HIGH related-criteria defect remains.',
  blockingCount: 1,
  gateIssues: [],
  defects: [
    {
      defectId: 'defect_001',
      severity: 'HIGH',
      coherenceDimension: 'BROKEN_RELATED_CRITERION',
      issue: 'The lifecycle pair omits a reciprocal related-criterion link.',
      coherenceExpectation: 'Related-criterion lists must be reciprocal.',
      pairId: 'A2_AP-A2',
      domainPath: 'pairs[A2_AP-A2].capability.relatedCriteria',
      snapshotPath: 'referenceMappings.capabilityRelatedCriteria',
      currentValue: [],
      valueJson: '[]',
      disposition: 'OPEN',
      rationale: ''
    }
  ]
});
assert(domainReviewHtml.includes('Park, fix after the rest is ready'), 'domain review parks the affected pair so other pairs can move');
assert(domainReviewHtml.includes('data-finding-action="fix"'), 'domain review finding has Fix, save and continue');
assert(domainReviewHtml.includes('data-finding-action="maintainer"'), 'domain review finding has Maintainer, fix this');
assert(domainReviewHtml.includes('data-pair-id="A2_AP-A2"'), 'domain park targets this pair/object');
assert(!domainReviewHtml.includes('window.alert'), 'domain review does not alert focused-check failures');

async function liveParkedApprovalCheck(): Promise<'PASS' | 'SKIPPED'> {
  if (!process.env.DATABASE_URL?.trim()) return 'SKIPPED';
  const { createHash } = await import('node:crypto');
  const { runMigrations } = await import('../db/migrate.js');
  const { getDbPool, closeDatabase } = await import('../db/client.js');
  const { getParkedFindings } = await import('../orchestration/store.js');
  const { assembleDomainApprovalBundle } = await import('../release/assemble-approval-bundle.js');
  await runMigrations();
  const db = getDbPool();
  const marker = `parked-gate-live-${String(Date.now())}`;
  const sha256 = createHash('sha256').update(marker).digest('hex');
  let domainRunId: string | undefined;
  try {
    const baseline = await db.query<{ id: string }>(
      `insert into baseline_snapshots(sha256, manifest) values ($1, '{}'::jsonb) returning id`,
      [sha256]
    );
    const domain = await db.query<{ id: string }>(
      `insert into domain_runs(domain, state, baseline_snapshot_id)
       values ('F', 'READY_FOR_APPROVAL', $1) returning id`,
      [baseline.rows[0]?.id]
    );
    domainRunId = domain.rows[0]?.id;
    assert(domainRunId, 'live check must insert a domain run');
    const pair = await db.query<{ id: string }>(
      `insert into pair_runs(domain_run_id, pair_id, state, target_version)
       values ($1, 'F1_AP-F1', 'VALIDATED', '1.0.0') returning id`,
      [domainRunId]
    );
    await db.query(
      `insert into validation_findings(
        pair_run_id, domain_run_id, check_id, kind, severity, object_id, object_path, issue,
        recommended_action, resolved
      ) values ($1,$2,'FINALIZE_LATER','DEFERRED_QC','HIGH','F1_AP-F1','',
                'Finalized later: live parked-approval gate', 'PARKED_FOR_LATER_REVIEW', false)`,
      [pair.rows[0]?.id, domainRunId]
    );
    const parked = await getParkedFindings(domainRunId);
    assert(parked.some((item) => item.checkId === 'FINALIZE_LATER'), 'live check must persist an open FINALIZE_LATER finding');
    const view = await assembleDomainApprovalBundle({ domain: 'F' });
    assert(view.ok === false, 'approval bundle must refuse READY_FOR_APPROVAL while parked items are open');
    assert(
      view.issues.some((item) => item.includes('remain unresolved')),
      `live parked refusal must name the queue (got: ${view.issues.join('; ')})`
    );
    return 'PASS';
  } finally {
    if (domainRunId) {
      await db.query('delete from domain_runs where id = $1', [domainRunId]);
    }
    await db.query('delete from baseline_snapshots where sha256 = $1', [sha256]);
    await closeDatabase();
  }
}

const liveParkedApproval = await liveParkedApprovalCheck();

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      fourActionSetRendered: 'PASS',
      findingFixLoopRendered: 'PASS',
      editApprovePreserved: 'PASS',
      earlierStageDefectReachable: 'PASS',
      approveHiddenWithoutReview: 'PASS',
      reworkRequiresCoherenceDefects: 'PASS',
      actionsDisabledWhenCommandsOff: 'PASS',
      finalizeLaterFailClosed: 'PASS',
      regenerateFailClosed: 'PASS',
      reworkFailClosed: 'PASS',
      finalizeLaterRequiresReasonAndOwner: 'PASS',
      reviewSaveDoesNotValidateWhileParked: 'PASS',
      liveParkedApproval
    },
    null,
    2
  )
);
