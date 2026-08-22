import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';

export interface CanonicalValidationContext {
  activeSchemaVersion: string;
  requiredLifecycleStages: string[];
}

export interface CanonicalValidationIssue {
  checkId: string;
  objectId: string;
  objectPath: string;
  issue: string;
}

export interface CanonicalValidationReport {
  passed: boolean;
  issues: CanonicalValidationIssue[];
}

interface SchemaRegistry {
  capability: ValidateFunction;
  antipattern: ValidateFunction;
}

let registryPromise: Promise<SchemaRegistry> | null = null;

type JsonRecord = Record<string, any>;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

async function loadJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')) as Record<string, unknown>;
}

async function loadRegistry(): Promise<SchemaRegistry> {
  if (registryPromise) return registryPromise;
  registryPromise = (async () => {
    const [shared, capabilitySchema, antipatternSchema] = await Promise.all([
      loadJson('schemas/shared-definitions.schema.json'),
      loadJson('schemas/capability.schema.json'),
      loadJson('schemas/antipattern.schema.json')
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
    ajv.addFormat('date', { type: 'string', validate: isIsoDate });
    ajv.addSchema(shared);
    return {
      capability: ajv.compile(capabilitySchema),
      antipattern: ajv.compile(antipatternSchema)
    };
  })();
  return registryPromise;
}

function asRecord(value: unknown): JsonRecord {
  return value as JsonRecord;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function addIssue(
  issues: CanonicalValidationIssue[],
  checkId: string,
  objectId: string,
  objectPath: string,
  text: string
): void {
  issues.push({ checkId, objectId, objectPath, issue: text });
}

function addSchemaIssues(
  issues: CanonicalValidationIssue[],
  objectId: string,
  errors: ErrorObject[] | null | undefined
): void {
  for (const error of errors ?? []) {
    addIssue(
      issues,
      'CANONICAL_SCHEMA',
      objectId,
      error.instancePath || '/',
      `${error.keyword}: ${error.message ?? 'schema validation failed'}`
    );
  }
}

function validateCommon(
  object: JsonRecord,
  context: CanonicalValidationContext,
  issues: CanonicalValidationIssue[]
): void {
  const objectId = String(object.id ?? 'UNKNOWN');
  if (object.schema_version !== context.activeSchemaVersion) {
    addIssue(
      issues,
      'ACTIVE_SCHEMA_VERSION_MATCH',
      objectId,
      '/schema_version',
      `Expected active schema ${context.activeSchemaVersion}, received ${String(object.schema_version)}.`
    );
  }

  const expectedDomain = objectId.startsWith('AP-') ? objectId.slice(3, 4) : objectId.slice(0, 1);
  if (object.domain !== expectedDomain) {
    addIssue(issues, 'DOMAIN_ID_MATCH', objectId, '/domain', `Expected domain ${expectedDomain}.`);
  }
  if (object.approval_record?.release_version !== object.version) {
    addIssue(
      issues,
      'APPROVAL_VERSION_MATCH',
      objectId,
      '/approval_record/release_version',
      'Approval release_version must equal canonical object version.'
    );
  }

  const questions = asArray(object.primary_questions);
  const evidence = asArray(object.required_evidence);
  const findings = asArray(object.finding_definitions);
  const questionIds = new Set(questions.map((item) => String(item.id)));
  const evidenceIds = new Set(evidence.map((item) => String(item.id)));
  const findingIds = new Set(findings.map((item) => String(item.id)));

  if (questionIds.size !== questions.length) {
    addIssue(issues, 'QUESTION_IDS_UNIQUE', objectId, '/primary_questions', 'Question IDs must be unique.');
  }
  if (evidenceIds.size !== evidence.length) {
    addIssue(issues, 'EVIDENCE_IDS_UNIQUE', objectId, '/required_evidence', 'Evidence IDs must be unique.');
  }
  if (findingIds.size !== findings.length) {
    addIssue(issues, 'FINDING_IDS_UNIQUE', objectId, '/finding_definitions', 'Finding IDs must be unique.');
  }

  findings.forEach((finding, index) => {
    for (const evidenceId of asArray(finding.required_evidence_ids).map(String)) {
      if (!evidenceIds.has(evidenceId)) {
        addIssue(
          issues,
          'FINDING_EVIDENCE_REFERENCE_RESOLVES',
          objectId,
          `/finding_definitions/${index}/required_evidence_ids`,
          `${evidenceId} is absent from required_evidence.`
        );
      }
    }
  });

  asArray(object.candidate_tactic_refs).forEach((tactic, index) => {
    if (!findingIds.has(String(tactic.finding_id))) {
      addIssue(
        issues,
        'TACTIC_FINDING_REFERENCE_RESOLVES',
        objectId,
        `/candidate_tactic_refs/${index}/finding_id`,
        `${String(tactic.finding_id)} is absent from finding_definitions.`
      );
    }
  });

  for (const related of asArray(object.related_criteria).map(String)) {
    if (related === objectId) {
      addIssue(
        issues,
        'RELATED_CRITERIA_NO_SELF_REFERENCE',
        objectId,
        '/related_criteria',
        'Canonical object must not reference itself as a related criterion.'
      );
    }
  }

  const lifecycle = asArray(object.target_assurance_by_lifecycle_stage).map((item) =>
    String(item.lifecycle_stage)
  );
  if (
    lifecycle.length !== context.requiredLifecycleStages.length ||
    lifecycle.some((stage, index) => stage !== context.requiredLifecycleStages[index])
  ) {
    addIssue(
      issues,
      'NORMATIVE_LIFECYCLE_COVERAGE',
      objectId,
      '/target_assurance_by_lifecycle_stage',
      `Expected exact lifecycle sequence ${context.requiredLifecycleStages.join(', ')}.`
    );
  }
}

function validateAtomicGraph(
  object: JsonRecord,
  atomicField: 'atomic_subcriteria' | 'atomic_tests',
  issues: CanonicalValidationIssue[]
): void {
  const objectId = String(object.id ?? 'UNKNOWN');
  const questionIds = new Set(asArray(object.primary_questions).map((item) => String(item.id)));
  const evidenceIds = new Set(asArray(object.required_evidence).map((item) => String(item.id)));
  const atomic = asArray(object[atomicField]);
  const atomicIds = new Set(atomic.map((item) => String(item.id)));

  atomic.forEach((item, index) => {
    if (!questionIds.has(String(item.question_id))) {
      addIssue(
        issues,
        'ATOMIC_QUESTION_REFERENCE_RESOLVES',
        objectId,
        `/${atomicField}/${index}/question_id`,
        `${String(item.question_id)} is absent from primary_questions.`
      );
    }
    for (const evidenceId of asArray(item.required_evidence_ids).map(String)) {
      if (!evidenceIds.has(evidenceId)) {
        addIssue(
          issues,
          'ATOMIC_EVIDENCE_REFERENCE_RESOLVES',
          objectId,
          `/${atomicField}/${index}/required_evidence_ids`,
          `${evidenceId} is absent from required_evidence.`
        );
      }
    }
  });

  asArray(object.finding_definitions).forEach((finding, index) => {
    for (const atomicId of asArray(finding.mapped_atomic_item_ids).map(String)) {
      if (!atomicIds.has(atomicId)) {
        addIssue(
          issues,
          'FINDING_ATOMIC_REFERENCE_RESOLVES',
          objectId,
          `/finding_definitions/${index}/mapped_atomic_item_ids`,
          `${atomicId} is absent from ${atomicField}.`
        );
      }
    }
  });
}

export async function validateCanonicalPair(
  capabilityInput: Record<string, unknown>,
  antipatternInput: Record<string, unknown>,
  context: CanonicalValidationContext
): Promise<CanonicalValidationReport> {
  const schemas = await loadRegistry();
  const capability = asRecord(capabilityInput);
  const antipattern = asRecord(antipatternInput);
  const capabilityId = String(capabilityInput.id ?? 'UNKNOWN');
  const antipatternId = String(antipatternInput.id ?? 'UNKNOWN');
  const pairId = `${capabilityId}/${antipatternId}`;
  const issues: CanonicalValidationIssue[] = [];

  const capabilityValid = schemas.capability(capabilityInput);
  if (!capabilityValid) addSchemaIssues(issues, capabilityId, schemas.capability.errors);
  const antipatternValid = schemas.antipattern(antipatternInput);
  if (!antipatternValid) addSchemaIssues(issues, antipatternId, schemas.antipattern.errors);

  if (antipatternId !== `AP-${capabilityId}`) {
    addIssue(
      issues,
      'PAIR_ID_COHERENCE',
      pairId,
      '/',
      'Anti-pattern ID must be the exact AP-* pair of the capability ID.'
    );
  }
  if (capability.domain !== antipattern.domain || capability.domain_title !== antipattern.domain_title) {
    addIssue(
      issues,
      'PAIR_DOMAIN_COHERENCE',
      pairId,
      '/domain',
      'Capability and anti-pattern must share the exact domain and domain title.'
    );
  }

  validateCommon(capability, context, issues);
  validateCommon(antipattern, context, issues);
  validateAtomicGraph(capability, 'atomic_subcriteria', issues);
  validateAtomicGraph(antipattern, 'atomic_tests', issues);

  return { passed: issues.length === 0, issues };
}
