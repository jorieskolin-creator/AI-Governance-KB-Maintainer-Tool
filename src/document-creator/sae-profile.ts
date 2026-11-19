import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';
import { z } from 'zod';
import { pinLocalInputs, type LocalSelection } from './local-inputs.js';
import type { PlanObject, PlanPair } from './plan.js';

const roles = [
  'taxonomy', 'id-register', 'criteria-instrument', 'criteria-reference', 'cognitive-model',
  'source-register', 'source-register-schema', 'tactic-playbook', 'tactic-playbook-schema', 'tactic-source-snapshot',
  'capability-schema', 'antipattern-schema', 'shared-definitions', 'golden-capability', 'golden-antipattern'
] as const;
const text = z.string().min(1);
const ids = z.array(text);
const object = z.object({ id: text, title: text });
const taxonomySchema = z.object({
  version: text,
  domains: z.array(z.object({ domain_id: text, capability_ids: ids, antipattern_ids: ids })).min(1),
  category_pairs: z.array(z.object({ pair_id: text, domain: text, capability: object, antipattern: object })).min(1)
});
const question = z.object({ id: text, dimension: text, question: text });
const instrumentObject = object.extend({
  domain: text, pairedObjectId: text, questions: z.array(question).min(1),
  findingDefinitions: z.array(z.unknown()), evidenceRules: z.array(z.unknown()).nullable()
});
const instrumentSchema = z.object({
  version: text,
  requirements: z.array(z.object({ id: text, domain: text, authoringObjectId: text, sourceIds: ids })),
  controls: z.array(instrumentObject.extend({ authoringObjectId: text, requirementIds: ids, atomicSubcriteria: z.array(z.unknown()) })),
  antipatterns: z.array(instrumentObject.extend({ relatedControlIds: ids, atomicTests: z.array(z.unknown()) }))
});
const schemaDocument = z.object({ $id: text }).passthrough();

function index<T>(values: readonly T[], getId: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = getId(value);
    if (result.has(id)) throw new Error(`${label}: duplicate ID ${id}`);
    result.set(id, value);
  }
  return result;
}

function lookup<T>(map: Map<string, T>, id: string, label: string): T {
  const value = map.get(id);
  if (!value) throw new Error(`${label}: unresolved ID ${id}`);
  return value;
}

function sameIds(a: readonly string[], b: readonly string[], label: string): void {
  if (JSON.stringify([...a].sort()) !== JSON.stringify([...b].sort())) throw new Error(`${label}: IDs disagree`);
}

export async function loadLocalSaeProfile(selection: LocalSelection) {
  const input = await pinLocalInputs(selection, roles);
  const taxonomy = taxonomySchema.parse(input.json('taxonomy'));
  const idRegister = z.object({
    version: text,
    reserved_object_ids: z.object({ capabilities: ids, antipatterns: ids, pairs: ids }),
    question_dimensions: z.record(text, text)
  }).parse(input.json('id-register'));
  const instrument = instrumentSchema.parse(input.json('criteria-instrument'));
  const schemaRoles = ['source-register-schema', 'tactic-playbook-schema', 'shared-definitions', 'capability-schema', 'antipattern-schema'] as const;
  const schemas = Object.fromEntries(schemaRoles.map(role => [role, schemaDocument.parse(input.json(role))] as const));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const addFormats = typeof formatsPlugin === 'function'
    ? formatsPlugin
    : (formatsPlugin as unknown as { default: (instance: Ajv2020) => void }).default;
  addFormats(ajv);
  for (const role of schemaRoles) ajv.addSchema(schemas[role]!);
  const validate = (role: typeof roles[number], schemaRole: typeof schemaRoles[number]): unknown => {
    const data = input.json(role);
    const validator = ajv.getSchema(schemas[schemaRole]!.$id)!;
    if (!validator(data)) {
      throw new Error(`${role}: does not match pinned ${schemaRole}: ${ajv.errorsText(validator.errors)}`);
    }
    return data;
  };
  const register = z.object({ version: text, sources: z.array(z.object({ id: text, domain_coverage: ids })) })
    .parse(validate('source-register', 'source-register-schema'));
  const playbook = z.object({
    version: text, source_document: z.object({ sha256: text }),
    tactics: z.array(z.object({
      id: text, primary_object_mappings: ids,
      assessment_mappings: z.object({ capabilities: ids, antipatterns: ids, question_ids: ids }),
      reassessment_targets: ids, prerequisite_tactic_ids: ids
    }))
  }).parse(validate('tactic-playbook', 'tactic-playbook-schema'));
  const goldenCapability = object.extend({ version: text }).parse(validate('golden-capability', 'capability-schema'));
  const goldenAntipattern = object.extend({ version: text }).parse(validate('golden-antipattern', 'antipattern-schema'));
  for (const [role, version] of [
    ['taxonomy', taxonomy.version], ['id-register', idRegister.version], ['criteria-instrument', instrument.version],
    ['source-register', register.version], ['tactic-playbook', playbook.version],
    ['golden-capability', goldenCapability.version], ['golden-antipattern', goldenAntipattern.version]
  ]) {
    if (input.files.find(ref => ref.role === role)?.version !== version) throw new Error(`${role}: declared version differs from inventory`);
  }
  if (playbook.source_document.sha256 !== input.files.find(ref => ref.role === 'tactic-source-snapshot')?.sha256) {
    throw new Error('tactic-playbook: source snapshot SHA-256 differs from the selected PDF');
  }

  const domains = index(taxonomy.domains, d => d.domain_id, 'taxonomy domain');
  const pairs = index(taxonomy.category_pairs, p => p.pair_id, 'taxonomy pair');
  const capabilities = index(taxonomy.category_pairs.map(p => p.capability), o => o.id, 'taxonomy capability');
  const antipatterns = index(taxonomy.category_pairs.map(p => p.antipattern), o => o.id, 'taxonomy anti-pattern');
  if ([...capabilities.keys()].some(id => antipatterns.has(id))) throw new Error('an object ID is both capability and anti-pattern');
  sameIds([...pairs.keys()], idRegister.reserved_object_ids.pairs, 'taxonomy / ID register pairs');
  sameIds([...capabilities.keys()], idRegister.reserved_object_ids.capabilities, 'taxonomy / ID register capabilities');
  sameIds([...antipatterns.keys()], idRegister.reserved_object_ids.antipatterns, 'taxonomy / ID register anti-patterns');
  for (const domain of domains.values()) {
    const members = [...pairs.values()].filter(p => p.domain === domain.domain_id);
    sameIds(members.map(p => p.capability.id), domain.capability_ids, `${domain.domain_id} capability membership`);
    sameIds(members.map(p => p.antipattern.id), domain.antipattern_ids, `${domain.domain_id} anti-pattern membership`);
  }
  const goldenPair = [...pairs.values()].find(p => p.capability.id === goldenCapability.id && p.antipattern.id === goldenAntipattern.id);
  if (!goldenPair) throw new Error('selected Golden capability and anti-pattern are not a taxonomy pair');

  const sources = index(register.sources, s => s.id, 'source register');
  for (const source of sources.values()) for (const domain of source.domain_coverage) lookup(domains, domain, source.id);
  const requirements = index(instrument.requirements, r => r.id, 'instrument requirement');
  const controls = index(instrument.controls, c => c.id, 'instrument control');
  sameIds([...new Set(instrument.controls.flatMap(c => c.requirementIds))], [...requirements.keys()], 'instrument requirement coverage');
  const controlsByObject = index(instrument.controls, c => c.authoringObjectId, 'instrument authoring object');
  const anti = index(instrument.antipatterns, a => a.id, 'instrument anti-pattern');
  sameIds([...controlsByObject.keys()], [...capabilities.keys()], 'taxonomy / instrument capabilities');
  sameIds([...anti.keys()], [...antipatterns.keys()], 'taxonomy / instrument anti-patterns');
  const questionOwners = index([
    ...instrument.controls.flatMap(o => o.questions.map(q => ({ ...q, objectId: o.authoringObjectId }))),
    ...instrument.antipatterns.flatMap(o => o.questions.map(q => ({ ...q, objectId: o.id })))
  ], q => q.id, 'instrument question');
  // Match only the pinned Thinking Flow's plain-text question cells. Do not execute or fetch HTML.
  const cells = [...input.text('cognitive-model').matchAll(/<code class="qid">([^<]+)<\/code><div>([^<]+)<\/div>/g)];
  sameIds(cells.map(m => m[1]!), [...questionOwners.keys()], 'Thinking Flow / instrument questions');
  for (const [, id, raw] of cells) {
    if (raw!.replaceAll('&#x27;', "'") !== lookup(questionOwners, id!, 'Thinking Flow').question) {
      throw new Error(`${id}: Thinking Flow and instrument question text disagree`);
    }
  }

  const tactics = index(playbook.tactics, t => t.id, 'tactic playbook');
  const tacticsByObject = new Map<string, string[]>();
  for (const tactic of tactics.values()) {
    const mapping = tactic.assessment_mappings;
    for (const id of mapping.capabilities) lookup(capabilities, id, tactic.id);
    for (const id of mapping.antipatterns) lookup(antipatterns, id, tactic.id);
    for (const id of mapping.question_ids) {
      const target = lookup(questionOwners, id, tactic.id);
      if (!tactic.primary_object_mappings.includes(target.objectId)) {
        throw new Error(`${tactic.id}: question ${id} is outside its declared object links`);
      }
    }
    for (const id of tactic.reassessment_targets) {
      if (!capabilities.has(id) && !antipatterns.has(id)) throw new Error(`${tactic.id}: unresolved reassessment target ${id}`);
    }
    for (const id of tactic.prerequisite_tactic_ids) lookup(tactics, id, tactic.id);
    sameIds(tactic.primary_object_mappings, [...mapping.capabilities, ...mapping.antipatterns], `${tactic.id} object links`);
    if (new Set(tactic.primary_object_mappings).size !== tactic.primary_object_mappings.length) {
      throw new Error(`${tactic.id}: duplicate object links`);
    }
    for (const id of tactic.primary_object_mappings) {
      const linked = tacticsByObject.get(id) ?? [];
      linked.push(tactic.id);
      tacticsByObject.set(id, linked);
    }
  }

  function describe(tax: z.infer<typeof object>, record: z.infer<typeof instrumentObject>, domain: string,
    expectedPartner: string, sourceIds: readonly string[], missingAtomic: string | undefined): PlanObject {
    if (record.title !== tax.title || record.domain !== domain || record.pairedObjectId !== expectedPartner) {
      throw new Error(`${tax.id}: taxonomy and instrument title, domain or pairing disagree`);
    }
    const expectedQuestions = Object.entries(idRegister.question_dimensions).map(([suffix, dimension]) => `${tax.id}-${suffix}:${dimension}`);
    sameIds(record.questions.map(q => `${q.id}:${q.dimension}`), expectedQuestions, `${tax.id} question ownership and dimensions`);
    const detailGaps = [missingAtomic, !record.findingDefinitions.length ? 'finding definitions' : undefined,
      !record.evidenceRules?.length ? 'evidence rules' : undefined].filter(gap => gap !== undefined);
    return {
      id: tax.id, title: tax.title, questions: record.questions, tacticIds: tacticsByObject.get(tax.id) ?? [],
      domainSourceIds: [...sources.values()].filter(s => s.domain_coverage.includes(domain)).map(s => s.id),
      missingSourceIds: [...new Set(sourceIds.filter(id => !sources.has(id)))], detailGaps
    };
  }
  const requirementSources = (control: z.infer<typeof instrumentSchema>['controls'][number]) => control.requirementIds.flatMap(id => {
    const requirement = lookup(requirements, id, control.id);
    if (requirement.authoringObjectId !== control.authoringObjectId || requirement.domain !== control.domain) {
      throw new Error(`${control.id}: requirement ${id} has a different object or domain`);
    }
    return requirement.sourceIds;
  });
  const planned: PlanPair[] = [];
  for (const p of pairs.values()) {
    lookup(domains, p.domain, p.pair_id);
    const capability = lookup(controlsByObject, p.capability.id, p.pair_id);
    const antipattern = lookup(anti, p.antipattern.id, p.pair_id);
    const relatedControls = antipattern.relatedControlIds.map(id => lookup(controls, id, antipattern.id));
    if (!relatedControls.includes(capability)) throw new Error(`${antipattern.id}: missing related paired control ${capability.id}`);
    planned.push({ id: p.pair_id, domain: p.domain,
      capability: describe(p.capability, capability, p.domain, p.antipattern.id, requirementSources(capability),
        capability.atomicSubcriteria.length ? undefined : 'atomic subcriteria'),
      antipattern: describe(p.antipattern, antipattern, p.domain, p.capability.id, relatedControls.flatMap(requirementSources),
        antipattern.atomicTests.length ? undefined : 'atomic tests')
    });
  }
  return { ...input, kbId: 'solution-assurance-engine', pairs: planned, goldenPairId: goldenPair.pair_id };
}
