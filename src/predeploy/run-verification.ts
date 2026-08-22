import { spawnSync } from 'node:child_process';

interface Gate {
  id: string;
  script: string;
}

const gates: Gate[] = [
  { id: 'RESPONSIBILITY_MAP', script: 'dist/architecture/run-responsibility-check.js' },
  { id: 'AUTHORING_PLAN', script: 'dist/authoring/run-authoring-plan-check.js' },
  { id: 'SIR_FOUNDATION', script: 'dist/sir/run-sir-foundation-check.js' },
  { id: 'SIR_INITIAL', script: 'dist/sir/run-initial-sir-check.js' },
  { id: 'SIR_ATOMIC', script: 'dist/sir/run-atomic-sir-check.js' },
  { id: 'SIR_EVIDENCE', script: 'dist/sir/run-evidence-sir-check.js' },
  { id: 'SIR_EVIDENCE_SAFETY', script: 'dist/sir/run-evidence-safety-sir-check.js' },
  { id: 'SIR_AP_ABSENCE', script: 'dist/sir/run-ap-absence-sir-check.js' },
  { id: 'SIR_DEPENDENCY_RESOLVER', script: 'dist/orchestration/run-sir-resolver-check.js' },
  { id: 'SIR_SAFETY_DEPENDENCY_RESOLVER', script: 'dist/orchestration/run-sir-safety-resolver-check.js' },
  { id: 'SOURCE_CONTEXT_PACKET', script: 'dist/orchestration/run-source-context-packet-check.js' },
  { id: 'SIR_SOURCE_MAPPING', script: 'dist/sir/run-source-mapping-sir-check.js' },
  { id: 'GOLDEN_REFERENCE', script: 'dist/golden/run-regression.js' }
];

for (const gate of gates) {
  console.log(`[PREDEPLOY] START ${gate.id}`);
  const result = spawnSync(process.execPath, [gate.script], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    console.error(`[PREDEPLOY] FAIL ${gate.id} exit=${String(result.status)}`);
    process.exit(result.status ?? 1);
  }
  console.log(`[PREDEPLOY] PASS ${gate.id}`);
}

console.log('[PREDEPLOY] ALL_GATES_PASS');
