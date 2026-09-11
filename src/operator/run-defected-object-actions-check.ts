import { renderPairActions, renderPairReviewHtml, type PairReviewPage } from './pair-review.js';
import {
  assertReworkWithGenAiAvailable,
  finalizeLaterForPair,
  regenerateSection
} from './commands.js';

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

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      fourActionSetRendered: 'PASS',
      editApprovePreserved: 'PASS',
      earlierStageDefectReachable: 'PASS',
      approveHiddenWithoutReview: 'PASS',
      reworkRequiresCoherenceDefects: 'PASS',
      actionsDisabledWhenCommandsOff: 'PASS',
      finalizeLaterFailClosed: 'PASS',
      regenerateFailClosed: 'PASS',
      reworkFailClosed: 'PASS',
      finalizeLaterRequiresReasonAndOwner: 'PASS'
    },
    null,
    2
  )
);
