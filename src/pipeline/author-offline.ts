import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileSirPair, type SirCompileReport } from '../compiler/sir-compiler.js';
import type { ValidationResult } from './finding.js';
import { validateEvidenceAndSafety } from './evidence-and-safety.js';
import { validateMappings } from './mappings.js';
import { validatePairCoherenceReview } from './pair-coherence-review.js';
import { validatePairFrame } from './pair-frame.js';
import { validateSourceContext } from './source-context.js';

export const A1_RECORDING_TASKS = [
  'SOURCE_CONTEXT',
  'PAIR_FRAME',
  'EVIDENCE_AND_SAFETY',
  'MAPPINGS',
  'PAIR_COHERENCE_REVIEW'
] as const;

export type A1RecordingTask = (typeof A1_RECORDING_TASKS)[number];

const validators: Record<A1RecordingTask, (output: unknown) => ValidationResult> = {
  SOURCE_CONTEXT: (output) => validateSourceContext(output, 'RELEASE'),
  PAIR_FRAME: (output) => validatePairFrame(output, 'RELEASE'),
  EVIDENCE_AND_SAFETY: (output) => validateEvidenceAndSafety(output, 'RELEASE'),
  MAPPINGS: (output) => validateMappings(output, 'RELEASE'),
  PAIR_COHERENCE_REVIEW: (output) => validatePairCoherenceReview(output, 'RELEASE')
};

export function a1RecordingPath(task: A1RecordingTask, recordingDir = 'tests/pipeline/recordings/A1'): string {
  return resolve(process.cwd(), recordingDir, `${task}.json`);
}

export async function missingA1Recordings(recordingDir?: string): Promise<A1RecordingTask[]> {
  const missing: A1RecordingTask[] = [];
  for (const task of A1_RECORDING_TASKS) {
    try {
      await readFile(a1RecordingPath(task, recordingDir), 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        missing.push(task);
        continue;
      }
      throw error;
    }
  }
  return missing;
}

export interface OfflineAuthoringResult {
  packets: Record<A1RecordingTask, unknown>;
  recordings: Record<A1RecordingTask, unknown>;
  compile: SirCompileReport;
}

function recordingGap(missing: readonly string[]): string {
  return [
    `Missing recorded task output for A1/AP-A1: ${missing.join(', ')}.`,
    'Searched tests/pipeline/recordings/A1/.',
    'src/compiler/sir-compile-fixture.ts is pair A2, not A1.',
    'Embedded run-*-check.ts fixtures are not recorded A1 model task outputs.',
    'Model semantics were not synthesized.'
  ].join(' ');
}

export async function authorOfflineA1(recordingDir?: string): Promise<OfflineAuthoringResult> {
  const missing = await missingA1Recordings(recordingDir);
  if (missing.length > 0) throw new Error(recordingGap(missing));

  const packets = {} as Record<A1RecordingTask, unknown>;
  for (const task of A1_RECORDING_TASKS) {
    const recording = JSON.parse(await readFile(a1RecordingPath(task, recordingDir), 'utf8')) as unknown;
    const validated = validators[task](recording);
    if (!validated.ok) {
      const detail = validated.findings.map((item) => `${item.code} ${item.path} ${item.message}`).join('; ');
      throw new Error(`Recorded ${task} output failed RELEASE validation: ${detail}`);
    }
    packets[task] = recording;
  }

  const planPath = resolve(process.cwd(), recordingDir ?? 'tests/pipeline/recordings/A1', 'authoring-plan.json');
  const snapshotPath = resolve(process.cwd(), recordingDir ?? 'tests/pipeline/recordings/A1', 'snapshot.json');
  let planRaw: string;
  let snapshotRaw: string;
  try {
    planRaw = await readFile(planPath, 'utf8');
    snapshotRaw = await readFile(snapshotPath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(
        'A1 task recordings are present, but compiler input recordings authoring-plan.json and snapshot.json are not. The unmodified compiler requires a materialized SIR snapshot. Snapshot semantics were not synthesized.'
      );
    }
    throw error;
  }
  const compile = await compileSirPair({
    authoringPlan: JSON.parse(planRaw) as Parameters<typeof compileSirPair>[0]['authoringPlan'],
    snapshot: JSON.parse(snapshotRaw) as unknown,
    mode: 'RELEASE'
  });
  return { packets, recordings: packets, compile };
}
