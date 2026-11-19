import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { planPair, type PlanObject } from '../../src/document-creator/plan.js';
import { loadLocalSaeProfile } from '../../src/document-creator/sae-profile.js';

const selection = {
  workspace: process.cwd(),
  inventoryPath: 'baseline/sae-training/input-inventory.json',
  outputPath: 'baseline/sae-training/knowledge-base'
};
const scratch: string[] = [];
afterEach(async () => {
  for (const workspace of scratch.splice(0)) await rm(workspace, { recursive: true, force: true });
});

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'sae-preflight-'));
  scratch.push(workspace);
  const config = { ...selection, workspace };
  const inventory = JSON.parse(await readFile(selection.inventoryPath, 'utf8')) as {
    files: { role: string; path: string; sha256: string }[];
    owner_decision: { sha256: string };
  };
  for (const ref of inventory.files) {
    const dest = join(workspace, ref.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(ref.path, dest);
  }
  await mkdir(join(workspace, config.outputPath));
  const save = () => writeFile(join(workspace, config.inventoryPath), JSON.stringify(inventory));
  const change = async (role: string, update: (old: string) => string, repin = true) => {
    const ref = inventory.files.find(input => input.role === role)!;
    const dest = join(workspace, ref.path);
    const next = update(await readFile(dest, 'utf8'));
    if (repin) ref.sha256 = createHash('sha256').update(next).digest('hex');
    await writeFile(dest, next);
    await save();
  };
  await save();
  return { config, inventory, save, change };
}

it('plans an SAE pair from the current instrument without admitting unverified source support or writing files', async () => {
  const { config } = await fixture();
  const profile = await loadLocalSaeProfile(config);
  const docs = planPair(profile.kbId, profile.pairs, 'PAIR-A2');
  expect(profile.pairs).toHaveLength(30);
  expect(profile.goldenPairId).toBe('PAIR-A1');
  expect(docs.map(d => [d.documentId, d.relativePathTemplate])).toEqual([
    ['solution-assurance-engine:A2', 'A/capabilities/A2/<version>/document.md'],
    ['solution-assurance-engine:AP-A2', 'A/antipatterns/AP-A2/<version>/document.md']
  ]);
  expect(docs.map(d => d.questions.map(q => q.id))).toEqual([
    ['A2-Q1', 'A2-Q2', 'A2-Q3'], ['AP-A2-Q1', 'AP-A2-Q2', 'AP-A2-Q3']
  ]);
  for (const doc of docs) {
    expect(doc.tacticIds.length).toBeGreaterThan(0);
    expect(doc.missingSourceIds).toEqual(['SRC-INTERNAL-AI-GOVERNANCE-GUIDELINE-2026']);
    expect(doc.domainSourceIds).not.toContain(doc.missingSourceIds[0]);
    expect(doc.detailGaps).toContain('evidence rules');
  }
  expect(docs[1]?.detailGaps).toContain('atomic tests');
  expect(await readdir(join(config.workspace, config.outputPath))).toEqual([]);
});

it('uses captured bytes, rejects drift, and derives a different input identity when a change is pinned', async () => {
  const { config, change } = await fixture();
  const old = await loadLocalSaeProfile(config);
  const html = old.text('cognitive-model');
  await change('cognitive-model', old => `${old}\n`, false);
  expect(old.text('cognitive-model')).toBe(html);
  await expect(loadLocalSaeProfile(config)).rejects.toThrow('cognitive-model: SHA-256 mismatch');
  await change('cognitive-model', current => current);
  expect((await loadLocalSaeProfile(config)).inputSetId).not.toBe(old.inputSetId);
});

it('rejects a repinned same-version shared schema incompatible with the Golden baseline', async () => {
  const { config, change } = await fixture();
  const rootSchema = await readFile('schemas/shared-definitions.schema.json', 'utf8');
  await change('shared-definitions', () => rootSchema);
  await expect(loadLocalSaeProfile(config)).rejects.toThrow(/golden-capability.*pinned capability-schema/);
});

it('does not apply the final-playbook decision to a different hash', async () => {
  const { config, inventory, save } = await fixture();
  inventory.owner_decision.sha256 = 'a'.repeat(64);
  await save();
  await expect(loadLocalSaeProfile(config)).rejects.toThrow('owner decision does not bind');
});

it('rejects an unresolved tactic question even when the selected playbook hash has an owner decision', async () => {
  const { config, inventory, save, change } = await fixture();
  await change('tactic-playbook', json => {
    const playbook = JSON.parse(json);
    playbook.tactics[0].assessment_mappings.question_ids = ['MISSING-QUESTION'];
    return JSON.stringify(playbook);
  });
  inventory.owner_decision.sha256 = inventory.files.find(file => file.role === 'tactic-playbook')!.sha256;
  await save();
  await expect(loadLocalSaeProfile(config)).rejects.toThrow('unresolved ID MISSING-QUESTION');
});

it('reports a repinned Thinking Flow contradiction instead of silently overwriting criteria', async () => {
  const { config, change } = await fixture();
  await change('cognitive-model', html => html.replace(
    /(<code class="qid">A2-Q1<\/code><div>)[^<]+/, '$1Unrelated question?'
  ));
  await expect(loadLocalSaeProfile(config)).rejects.toThrow('A2-Q1: Thinking Flow and instrument question text disagree');
});

it('reports a missing required role rather than using repository defaults', async () => {
  const { config, inventory, save } = await fixture();
  inventory.files = inventory.files.filter(ref => ref.role !== 'golden-antipattern');
  await save();
  await expect(loadLocalSaeProfile(config)).rejects.toThrow('missing required role golden-antipattern');
});

it('rejects output that escapes the selected workspace via a symlink', async () => {
  const { config } = await fixture();
  const external = await mkdtemp(join(tmpdir(), 'sae-outside-'));
  scratch.push(external);
  await symlink(external, join(config.workspace, 'outside'));
  await expect(loadLocalSaeProfile({ ...config, outputPath: 'outside' })).rejects.toThrow('output destination: path escapes');
});

it('keeps synthetic non-SAE domain paths and KB identities independent', () => {
  const object: PlanObject = { id: 'CTRL-01', title: 'Synthetic capability', questions: [], tacticIds: [],
    domainSourceIds: [], missingSourceIds: [], detailGaps: [] };
  const pairs = [{ id: 'set-12', domain: 'training', capability: object,
    antipattern: { ...object, id: 'MISTAKE-01', title: 'Synthetic anti-pattern' } }];
  expect(planPair('kb-one', pairs, 'set-12')[0]).toMatchObject({
    documentId: 'kb-one:CTRL-01', relativePathTemplate: 'training/capabilities/CTRL-01/<version>/document.md'
  });
  expect(planPair('kb-two', pairs, 'set-12')[0]?.documentId).toBe('kb-two:CTRL-01');
  expect(() => planPair('kb-one', [{ ...pairs[0]!, domain: '../outside' }], 'set-12')).toThrow('unsafe document path token');
});
