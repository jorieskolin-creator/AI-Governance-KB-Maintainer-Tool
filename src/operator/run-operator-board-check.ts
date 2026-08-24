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

const titles = loadDomainCoverageTitles();
const status = buildOperatorStatus({
  database: { connected: false, schemaReady: false },
  domainTitles: titles
});

assert(status.service === OPERATOR_SERVICE, 'operator status service is wrong');
assert(status.slice === OPERATOR_SLICE, 'operator status slice is wrong');
assert(status.mode === 'READ_ONLY', 'operator status must be read-only');
assert(status.commands.startDomainRun.enabled === false, 'startDomainRun must stay closed');
assert(status.commands.runNextTask.enabled === false, 'runNextTask must stay closed');
assert(status.commands.recordApproval.enabled === false, 'recordApproval must stay closed');
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
assert(html.includes('text/html') === false, 'renderer must emit a document, not a content-type');
assert(html.includes('<!doctype html>'), 'home page must be HTML');
assert(html.includes('READ_ONLY'), 'home page must declare read-only mode');
assert(!html.includes('<textarea'), 'home page must not include a chat or prompt box');
assert(!html.includes('contenteditable'), 'home page must not be an editor');
assert(!html.toLowerCase().includes('force continue'), 'home page must not offer a force-continue action');
for (const taskType of PAIR_TASK_SEQUENCE) {
  assert(html.includes(taskType), `home page is missing ${taskType}`);
}
for (const domain of OPERATOR_DOMAINS) {
  assert(html.includes(`data-domain="${domain}"`), `home page is missing domain ${domain}`);
  assert(html.includes(expectedDomainPairIds(domain)[0] ?? ''), `home page is missing first pair for ${domain}`);
}

const app = Fastify({ logger: false });
registerOperatorRoutes(app, () => status);

const home = await app.inject({ method: 'GET', url: '/' });
assert(home.statusCode === 200, `GET / returned ${String(home.statusCode)}`);
assert((home.headers['content-type'] ?? '').includes('text/html'), 'GET / must be HTML');
assert(home.body.includes('AI Governance KB Maintainer'), 'GET / is missing the service title');
assert(home.body.includes('PAIR_BOUNDARY'), 'GET / is missing the pair sequence');

const api = await app.inject({ method: 'GET', url: '/api/operator/status' });
assert(api.statusCode === 200, `GET /api/operator/status returned ${String(api.statusCode)}`);
const payload = api.json() as { mode?: unknown; pipeline?: { pairTaskSequence?: unknown } };
assert(payload.mode === 'READ_ONLY', 'status API must stay read-only');
assert(
  JSON.stringify(payload.pipeline?.pairTaskSequence) === JSON.stringify(PAIR_TASK_SEQUENCE),
  'status API sequence drifted from pipeline.ts'
);

await app.close();

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      slice: OPERATOR_SLICE,
      domains: status.domains.map((card) => card.domain),
      pairTasks: PAIR_TASK_SEQUENCE.length,
      mode: status.mode
    },
    null,
    2
  )
);
