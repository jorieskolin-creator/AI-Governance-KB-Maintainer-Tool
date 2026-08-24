import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCategoriesBaseline } from '../baseline/categories.js';
import { previewRepoBaselineManifest } from '../baseline/repo-artifacts.js';
import type { BaselineSnapshot } from '../baseline/snapshot.js';
import { PAIR_TASK_SEQUENCE } from '../orchestration/pipeline.js';
import { buildPairAuthoringPlan } from './authoring-context.js';
import { commandAvailability, nextEligiblePairTask } from './eligibility.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const categories = loadCategoriesBaseline();
assert(categories.domains.length === 6, 'categories baseline must have six domains');
assert(
  categories.domains.reduce((count, domain) => count + domain.pairs.length, 0) === 30,
  'categories baseline must have thirty pairs'
);

const goldenA1 = JSON.parse(readFileSync(resolve(process.cwd(), 'golden/fixtures/A1_v1.0.0.json'), 'utf8')) as {
  title?: string;
  domain_title?: string;
};
const goldenAp = JSON.parse(readFileSync(resolve(process.cwd(), 'golden/fixtures/AP-A1_v1.0.0.json'), 'utf8')) as {
  title?: string;
};
const a1 = categories.domains[0]?.pairs[0];
assert(a1?.capabilityTitle === goldenA1.title, 'A1 title drifted from golden fixture');
assert(a1?.antipatternTitle === goldenAp.title, 'AP-A1 title drifted from golden fixture');
assert(categories.domains[0]?.title === goldenA1.domain_title, 'domain A title drifted from golden fixture');

const pending = PAIR_TASK_SEQUENCE.map((taskType) => ({ taskType, status: 'PENDING' as const }));
const next = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'AUTHORING', tasks: pending },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in next), 'A1 PAIR_BOUNDARY must be eligible on a fresh run');
assert(!('blocked' in next) && next.taskType === 'PAIR_BOUNDARY', 'first eligible task must be PAIR_BOUNDARY');
assert(!('blocked' in next) && next.pairId === 'A1_AP-A1', 'first eligible pair must be A1_AP-A1');

const blockedRepair = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'REPAIR_REQUIRED', tasks: pending },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert('blocked' in blockedRepair, 'repair-required pairs must block the next task');

const completedBoundary = PAIR_TASK_SEQUENCE.map((taskType) => ({
  taskType,
  status: taskType === 'PAIR_BOUNDARY' ? ('COMPLETED' as const) : ('PENDING' as const)
}));
const second = nextEligiblePairTask('A', [
  { pairId: 'A1_AP-A1', state: 'AUTHORING', tasks: completedBoundary },
  { pairId: 'A2_AP-A2', state: 'AUTHORING', tasks: pending },
  { pairId: 'A3_AP-A3', state: 'AUTHORING', tasks: pending },
  { pairId: 'A4_AP-A4', state: 'AUTHORING', tasks: pending },
  { pairId: 'A5_AP-A5', state: 'AUTHORING', tasks: pending }
]);
assert(!('blocked' in second) && second.taskType === 'AP_FAILURE_MODEL', 'second task must stay sequential');

const availability = commandAvailability({
  databaseReady: true,
  commandsEnabled: true,
  modelRoutesConfigured: false,
  domain: 'A',
  activeRun: {
    state: 'IN_PROGRESS',
    pairs: [{ pairId: 'A1_AP-A1', state: 'AUTHORING', tasks: pending }]
  }
});
assert(availability.startDomainRun.enabled === false, 'open runs cannot be started again');
assert(availability.runNextTask.enabled === false, 'next-task must fail closed without model routing');
assert(availability.recordApproval.enabled === false, 'approval must stay closed');
assert(availability.runNextTask.next?.taskType === 'PAIR_BOUNDARY', 'eligibility is visible even when routing is missing');

const manifest = previewRepoBaselineManifest();
assert(
  manifest.some((item) => item.artifactType === 'CATEGORIES_BASELINE'),
  'repo baseline must include the categories baseline'
);
const snapshot: BaselineSnapshot = {
  id: 'baseline-operator-regression',
  sha256: 'a'.repeat(64),
  manifest
};
const plan = buildPairAuthoringPlan({ domain: 'A', pairId: 'A1_AP-A1', snapshot, categories });
assert(plan.identity.pairId === 'A1_AP-A1', 'authoring plan pair id must be derived');
assert(plan.tacticUniverse.length === 0, 'tactic universe must stay empty without a sealed catalog');
assert(
  plan.adjacentCriteria.map((item) => item.criterionId).join(',') === 'A2,A3,A4,A5',
  'adjacent criteria must be the other domain capabilities'
);
assert(plan.compilerPolicies.canonicalIdsFromModelOutputAllowed === false, 'canonical ids remain code-owned');

console.log(
  JSON.stringify(
    {
      status: 'PASS',
      categoriesPairs: 30,
      firstEligibleTask: 'PAIR_BOUNDARY',
      sequentialAdmission: 'PASS',
      repairBlocksAdvance: 'PASS',
      modelRoutingFailClosed: 'PASS',
      authoringPlanPairId: plan.planId
    },
    null,
    2
  )
);
