import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { PAIR_TASK_SEQUENCE, expectedDomainPairIds } from '../orchestration/pipeline.js';
import {
  buildOperatorStatus,
  loadDomainCoverageTitles,
  OPERATOR_DOMAINS,
  OPERATOR_SERVICE,
  OPERATOR_SLICE
} from './board.js';
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
assert(html.includes('empty PENDING grid'), 'home page must say a new run starts empty');
assert(html.includes('latest run for the selected domain'), 'home page must say the board is the latest run only');
assert(html.includes('Pipeline'), 'home page must show pipeline activity');
assert(html.includes('name="action" value="run-next-task"'), 'run command must post a hidden action field');
assert(!html.includes('Command accepted. Refresh'), 'home page must not claim a command was accepted in the browser');
for (const taskType of PAIR_TASK_SEQUENCE) {
  assert(html.includes(taskType), `home page is missing ${taskType}`);
}

const app = Fastify({ logger: false });
registerOperatorRoutes(app, () => status);

const home = await app.inject({ method: 'GET', url: '/' });
assert(home.statusCode === 200, `GET / returned ${String(home.statusCode)}`);
assert((home.headers['content-type'] ?? '').includes('text/html'), 'GET / must be HTML');

const api = await app.inject({ method: 'GET', url: '/api/operator/status' });
assert(api.statusCode === 200, `GET /api/operator/status returned ${String(api.statusCode)}`);
const payload = api.json() as {
  mode?: unknown;
  pipeline?: { pairTaskSequence?: unknown };
  pipelineActivity?: { state?: unknown };
};
assert(payload.mode === 'READ_ONLY', 'status API must stay read-only without a database');
assert(payload.pipelineActivity?.state === 'NOT_READY', 'status API must expose pipeline activity');
assert(
  JSON.stringify(payload.pipeline?.pairTaskSequence) === JSON.stringify(PAIR_TASK_SEQUENCE),
  'status API sequence drifted from pipeline.ts'
);

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
assert(String(formRun.headers.location).includes('Queued'), 'HTML run-next-task must confirm the task was queued');

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
