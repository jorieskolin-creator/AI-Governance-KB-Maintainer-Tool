import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { PAIR_TASK_SEQUENCE, expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  operatorTaskBoundarySummary,
  operatorTaskBoundaryWording
} from '../orchestration/task-boundaries.js';
import {
  buildOperatorStatus,
  loadDomainCoverageTitles,
  OPERATOR_DOMAINS,
  OPERATOR_SERVICE,
  OPERATOR_SLICE
} from './board.js';
import { commandAvailability } from './eligibility.js';
import type { DomainRunOverlay } from './overlay.js';
import { renderOperatorHome } from './render-home.js';
import { registerOperatorRoutes } from './routes.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function withCommandFlag<T>(enabled: boolean, run: () => Promise<T>): Promise<T> {
  const previous = process.env.OPERATOR_COMMANDS_ENABLED;
  process.env.OPERATOR_COMMANDS_ENABLED = enabled ? 'true' : 'false';
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.OPERATOR_COMMANDS_ENABLED;
    else process.env.OPERATOR_COMMANDS_ENABLED = previous;
  }
}

const titles = loadDomainCoverageTitles();
const status = buildOperatorStatus({
  database: { connected: false, schemaReady: false },
  domainTitles: titles
});

assert(status.service === OPERATOR_SERVICE, 'operator status service is wrong');
assert(status.slice === OPERATOR_SLICE, 'operator status slice is wrong');
assert(status.mode === 'READ_ONLY', 'operator status without a database must stay read-only');
assert(status.domains[0]?.commands.recordApproval.enabled === false, 'recordApproval must stay closed');
assert(status.domains[0]?.commands.startDomainRun.enabled === false, 'startDomainRun must stay closed without a ready database');
assert(status.domains[0]?.commands.runNextTask.enabled === false, 'runNextTask must stay closed without a ready database');
assert(
  JSON.stringify(status.pipeline.pairTaskSequence) === JSON.stringify(PAIR_TASK_SEQUENCE),
  'operator board pair sequence drifted from pipeline.ts'
);
assert(status.pipeline.taskBoundaries.pairSirTaskCount === PAIR_TASK_SEQUENCE.length, 'operator board SIR task count drifted');
assert(status.pipeline.taskBoundaries.sourceContextIsModelTask === false, 'operator board must not treat SOURCE_CONTEXT as a model task');
assert(status.pipeline.taskBoundaries.consolidationPolicy === 'KEEP_SEPARATE_UNTIL_MEASURED', 'operator board consolidation policy drifted');
assert(status.pipeline.taskBoundaries.mergeAuthorized === false, 'operator board must report merge closed');
assert(
  JSON.stringify(status.pipeline.taskBoundaries) === JSON.stringify(operatorTaskBoundarySummary()),
  'operator board task-boundary summary drifted'
);
assert(status.domains.length === OPERATOR_DOMAINS.length, 'operator board must show six domains');

for (const domain of OPERATOR_DOMAINS) {
  const card = status.domains.find((entry) => entry.domain === domain);
  assert(card, `missing domain ${domain}`);
  assert(
    JSON.stringify(card.pairIds) === JSON.stringify(expectedDomainPairIds(domain)),
    `pair ids for domain ${domain} drifted from pipeline.ts`
  );
  assert(card.pairs.length === 5, `domain ${domain} must have five pair columns`);
  for (const pair of card.pairs) {
    assert(pair.tasks.length === PAIR_TASK_SEQUENCE.length, `${pair.pairId} is missing SIR tasks`);
    assert(
      pair.tasks.every((task, index) => task.taskType === PAIR_TASK_SEQUENCE[index] && task.status === 'PENDING'),
      `${pair.pairId} task sequence drifted`
    );
  }
}

const golden = JSON.parse(readFileSync(resolve(process.cwd(), 'golden/fixtures/A1_v1.0.0.json'), 'utf8')) as {
  domain_title?: unknown;
};
assert(typeof golden.domain_title === 'string', 'golden A1 is missing domain_title');
assert(status.domains[0]?.title === golden.domain_title, 'domain A title drifted from golden A1');

const html = renderOperatorHome(status);
assert(html.includes('<!doctype html>'), 'home page must be HTML');
assert(!html.includes('<textarea'), 'home page must not include a chat or prompt box');
assert(!html.includes('contenteditable'), 'home page must not be an editor');
assert(!html.toLowerCase().includes('force continue'), 'home page must not offer a force-continue action');
assert(html.includes('Start domain run'), 'home page must expose the start-run command');
assert(html.includes('Continue domain'), 'home page must continue a domain until it is ready');
assert(html.includes('Park HIGH blockers for later review'), 'home page must offer park-for-later after repair');
assert(html.includes('command-form'), 'home page must post operator commands from domain-scoped forms');
assert(html.includes("fetch('/api/operator/commands'"), 'Retry/Continue must not rely on meta-refresh form posts');
assert(!html.includes('http-equiv="refresh"'), 'idle board must not auto-navigate away from a command click');
assert(html.includes('after five pairs are VALIDATED') || html.includes('After five pairs are VALIDATED'), 'home page must still complete the five-pair authoring unit');
assert(html.includes('DOMAIN_COHERENCE_REVIEW'), 'home page must admit domain coherence after five validated pairs');
assert(html.includes('DRAFT documents'), 'home page must name DRAFT documents as the pair-complete output');
assert(html.includes('Approval bundle'), 'home page must name the hash-bound approval bundle');
assert(html.includes('Hash-bound operator approval'), 'home page must name standalone operator approval, not an external intake');
assert(!html.includes('until external APPROVED'), 'home page must not wait for an external approval layer');
assert(html.includes('section schemas') || html.includes('Approve and save'), 'home page must name the human-approval schema gate');
assert(status.domains[0]?.review.kind === '' || status.domains[0]?.review.kind === 'PAIR' || status.domains[0]?.review.kind === 'DOMAIN', 'review kind is governed');
assert(html.includes('Production candidates'), 'home page must show the production-candidate unit');
assert(html.includes('latest run for the selected domain'), 'home page must say the board is the latest run only');
assert(html.includes('Task boundaries'), 'home page must name task boundaries');
assert(html.includes(operatorTaskBoundaryWording()), 'home page must keep the task-boundary policy wording');
assert(html.includes('KEEP_SEPARATE_UNTIL_MEASURED'), 'home page must say consolidation stays unmerged until measured');
assert(html.includes('Source Context is code-owned'), 'home page must say Source Context is not a model authoring step');
assert(html.includes('Merge is closed'), 'home page must say merge stays closed');
assert(!html.includes('Last model call:'), 'home page must not dump a global last-model-call mix at the footer');
assert(html.includes('Pipeline'), 'home page must show pipeline activity');
assert(html.includes('Work order'), 'home page must show the work-order machine');
assert(html.includes('Current task'), 'home page must show the current-task machine');
assert(html.includes('name="action" value="run-next-task"'), 'run command must post a hidden action field');
assert(!html.includes('Command accepted. Refresh'), 'home page must not claim a command was accepted in the browser');
for (const taskType of PAIR_TASK_SEQUENCE) {
  assert(html.includes(taskType), `home page is missing ${taskType}`);
}

const completedTasks = PAIR_TASK_SEQUENCE.map((taskType) => ({ taskType, status: 'COMPLETED' as const }));
const fiveValidatedPairs = expectedDomainPairIds('A').map((pairId) => ({
  pairId,
  state: 'VALIDATED' as const,
  tasks: completedTasks,
  pairCoherencePassed: true
}));
const closedDismiss = { enabled: false, reason: 'No HIGH blockers to park.' };
const readyCommands = {
  ...commandAvailability({
    databaseReady: true,
    commandsEnabled: true,
    modelRoutesConfigured: true,
    domain: 'A',
    activeRun: {
      state: 'READY_FOR_APPROVAL',
      pairs: fiveValidatedPairs,
      domainCoherence: { status: 'COMPLETED', passed: true }
    }
  }),
  dismissBlockers: closedDismiss
};
const readyOverlay: DomainRunOverlay = {
  domain: 'A',
  runId: 'run-a-ready',
  state: 'READY_FOR_APPROVAL',
  baselineSha256: 'abc123',
  pairs: fiveValidatedPairs,
  findings: [],
  parkedFindings: [],
  modelCalls: [],
  commands: readyCommands,
  documents: {
    available: true,
    indexHref: '/documents/A',
    bundleHref: '/api/operator/documents/A',
    approvalHref: '/approval/A',
    approvalAvailable: true
  },
  review: {
    available: false,
    href: '',
    pairId: '',
    kind: '',
    reason: 'No remaining HIGH blockers to review.'
  }
};
const readyHtml = renderOperatorHome(
  buildOperatorStatus({
    database: { connected: true, schemaReady: true },
    overlays: [readyOverlay]
  }),
  '',
  'A'
);
assert(readyHtml.includes('READY FOR APPROVAL'), 'passed domain coherence must show READY FOR APPROVAL, not OPEN');
assert(readyHtml.includes('Record operator approval'), 'READY domain must expose Record operator approval on the command row');
assert(readyHtml.includes('href="/approval/A"'), 'Record operator approval must link to the hash-bound approval page');
assert(
  readyHtml.includes(readyCommands.recordApproval.reason),
  'command reason prefers hash-bound operator approval once it is enabled'
);
assert(readyHtml.includes('Work order READY FOR APPROVAL'), 'activity copy matches the READY FOR APPROVAL work order');

const parkedReadyCommands = {
  ...commandAvailability({
    databaseReady: true,
    commandsEnabled: true,
    modelRoutesConfigured: true,
    domain: 'E',
    activeRun: {
      state: 'READY_FOR_APPROVAL',
      pairs: expectedDomainPairIds('E').map((pairId) => ({
        pairId,
        state: 'VALIDATED' as const,
        tasks: completedTasks,
        pairCoherencePassed: true
      })),
      domainCoherence: { status: 'COMPLETED', passed: false },
      openParkedCount: 1
    }
  }),
  dismissBlockers: closedDismiss
};
const parkedReadyHtml = renderOperatorHome(
  buildOperatorStatus({
    database: { connected: true, schemaReady: true },
    overlays: [
      {
        domain: 'E',
        runId: 'run-e-parked',
        state: 'READY_FOR_APPROVAL',
        baselineSha256: 'def456',
        pairs: expectedDomainPairIds('E').map((pairId) => ({
          pairId,
          state: 'VALIDATED' as const,
          tasks: completedTasks,
          pairCoherencePassed: true
        })),
        findings: [],
        parkedFindings: [
          {
            id: 'finding-e',
            pairRunId: null,
            checkId: 'defect_001',
            severity: 'HIGH',
            objectId: 'E3_AP-E3',
            objectPath: 'pairs[E3_AP-E3].capability.relatedCriteria',
            issue: 'Parked HIGH defect.',
            resolved: false,
            createdAt: new Date(),
            parkReason: 'Wait for expert review.'
          }
        ],
        modelCalls: [],
        commands: parkedReadyCommands,
        documents: {
          available: true,
          indexHref: '/documents/E',
          bundleHref: '/api/operator/documents/E',
          approvalHref: '/approval/E',
          approvalAvailable: false
        },
        review: {
          available: false,
          href: '',
          pairId: '',
          kind: '',
          reason: 'No remaining HIGH blockers to review.'
        }
      }
    ]
  }),
  '',
  'E'
);
assert(parkedReadyHtml.includes('Open DRAFT documents'), 'READY with parked items still continues document creation via DRAFT documents');
assert(parkedReadyHtml.includes('href="/documents/E"'), 'parked READY next phase opens DRAFT documents');
assert(
  !parkedReadyHtml.includes('>Record operator approval<'),
  'hash-bound Record operator approval stays closed while parked items remain'
);
assert(parkedReadyHtml.includes('fail-closed') || parkedReadyHtml.includes('parked'), 'parked READY reason names the parked gate');

const app = Fastify({ logger: false });
registerOperatorRoutes(app, () => status);

const home = await app.inject({ method: 'GET', url: '/' });
assert(home.statusCode === 200, `GET / returned ${String(home.statusCode)}`);
assert((home.headers['content-type'] ?? '').includes('text/html'), 'GET / must be HTML');

const api = await app.inject({ method: 'GET', url: '/api/operator/status' });
assert(api.statusCode === 200, `GET /api/operator/status returned ${String(api.statusCode)}`);
const payload = api.json() as {
  mode?: unknown;
  pipeline?: { pairTaskSequence?: unknown; taskBoundaries?: { mergeAuthorized?: unknown; pairSirTaskCount?: unknown } };
  pipelineActivity?: { state?: unknown };
};
assert(payload.mode === 'READ_ONLY', 'status API must stay read-only without a database');
assert(payload.pipelineActivity?.state === 'NOT_READY', 'status API must expose pipeline activity');
assert(
  JSON.stringify(payload.pipeline?.pairTaskSequence) === JSON.stringify(PAIR_TASK_SEQUENCE),
  'status API sequence drifted from pipeline.ts'
);
assert(payload.pipeline?.taskBoundaries?.mergeAuthorized === false, 'status API must report merge closed');
assert(payload.pipeline?.taskBoundaries?.pairSirTaskCount === PAIR_TASK_SEQUENCE.length, 'status API SIR task count drifted');

const denied = await withCommandFlag(false, () =>
  app.inject({
    method: 'POST',
    url: '/api/operator/commands',
    headers: { 'content-type': 'application/json' },
    payload: { domain: 'A', action: 'start-domain-run' }
  })
);
assert(denied.statusCode === 403, 'start-domain-run must fail closed when commands are disabled');
const deniedBody = denied.json() as { error?: unknown };
assert(
  String(deniedBody.error).includes('disabled'),
  'fail-closed start-domain-run must report that commands are disabled'
);

const skip = await withCommandFlag(true, () =>
  app.inject({
    method: 'POST',
    url: '/api/operator/commands',
    headers: { 'content-type': 'application/json' },
    payload: { domain: 'A', action: 'skip-to-source-mapping' }
  })
);
assert(skip.statusCode === 400, 'unknown operator actions must be rejected even when commands are enabled');

const missingAction = await app.inject({
  method: 'POST',
  url: '/api/operator/commands',
  headers: {
    accept: 'text/html',
    'content-type': 'application/x-www-form-urlencoded'
  },
  payload: 'domain=A'
});
assert(missingAction.statusCode === 302, 'HTML commands without action must redirect, not return JSON 400');
assert(String(missingAction.headers.location).includes('notice='), 'HTML unknown action must surface a notice');

const formRun = await withCommandFlag(true, () =>
  app.inject({
    method: 'POST',
    url: '/api/operator/commands',
    headers: {
      accept: 'text/html',
      'content-type': 'application/x-www-form-urlencoded'
    },
    payload: 'domain=A&action=run-next-task'
  })
);
assert(formRun.statusCode === 302, 'HTML run-next-task must accept hidden action and redirect');
assert(String(formRun.headers.location).includes('running'), 'HTML run-next-task must start the domain pipeline');
assert(!String(formRun.headers.location).includes('Queued next eligible'), 'HTML must not queue a single SIR step');

await app.close();

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      slice: OPERATOR_SLICE,
      domains: status.domains.map((card) => card.domain),
      pairTasks: PAIR_TASK_SEQUENCE.length,
      mode: status.mode,
      commandGateIndependentOfProcessEnv: 'PASS'
    },
    null,
    2
  )
);
