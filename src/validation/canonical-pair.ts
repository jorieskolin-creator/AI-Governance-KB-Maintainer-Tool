import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

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

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

async function loadJson(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(resolve(process.cwd(), path), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
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

function issue(
  issues: CanonicalValidationIssue[],
  checkId: string,
  objectId: string,
  objectPath: string,
  text: string
): void {
  issues.push({ checkId, objectId, objectPath, issue: text });
}

function schemaIssues(
  issues: CanonicalValidationIssue[],
  objectId: string,
  errors: ErrorObject[] | null | undefined
): void {
  for (const error of errors ?? []) {
    issue(
      issues,
      'CANONICAL_SCHEMA',
      objectId,
      error.instancePath || '/',
      `${error.keyword}: ${error.message ?? 'schema validation failed'}`
    );
  }
}

function record(value: unknown): Record<string, any> {
  return value as Record<string, any>;
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function validateCommon(
  object: Record<string, any>,
  context: CanonicalValidationContext,
  issues: CanonicalValidationIssue[]
): void {
  const objectId = String(object.id ?? 'UNKNOWN');
  if (object.schema_version !== context.activeSchemaVersion) {
    issue(
      issues,
      'ACTIVE_SCHEMA_VERSION_MATCH',
      objectId,
      '/schema_version',
      `Expected active schema ${context.activeSchemaVersion}, received ${String(object.schema_version)}.`
    );
  }

  const expectedDomain = objectId.startsWith('AP-') ? objectId.slice(3, 4) : objectId.slice(0, 1);
  if (object.domain !== expectedDomain) {
    issue(issues, 'DOMAIN_ID_MATCH', objectId, '/domain', `Expected domain ${expectedDomain}.`);
  }

  if (object.approval_record?.release_version !== object.version) {
    issue(
      issues,
      'APPROVAL_VERSION_MATCH',
      objectId,
      '/approval_record/release_version',
      'Approval release_version must equal canonical object version.'
    );
  }

  const questionIds = new Set(array(object.primary_questions).map((item) => String(item.id)));
  const evidenceIds = new Set(array(object.required_evidence).map((item) => String(item.id)));
  const findingIds = new Set(array(object.finding_definitions).map((item) => String(item.id)));

  for (const [index, finding] of array(object.finding_definitions).entries()) {
    for (const evidenceId of array(finding.required_evidence_ids).map(String)) {
      if (!evidenceIds.has(evidenceId)) {
        issue(
          issues,
          'FINDING_EVIDENCE_REFERENCE_RESOLVES',
          objectId,
          `/finding_definitions/${index}/required_evidence_ids`,
          `${evidenceId} is absent from required_evidence.`
        );
      }
    }
  }

  for (const [index, tactic] of array(object.candidate_tactic_refs).entries()) {
    if (!findingIds.has(String(tactic.finding_id))) {
      issue(
        issues,
        'TACTIC_FINDING_REFERENCE_RESOLVES',
        objectId,
        `/candidate_tactic_refs/${index}/finding_id`,
        `${String(tactic.finding_id)} is absent from finding_definitions.`
      );
    }
  }

  for (const related of array(object.related_criteria).map(String)) {
    if (related === objectId) {
      issue(
        issues,
        'RELATED_CRITERIA_NO_SELF_REFERENCE',
        objectId,
        '/related_criteria',
        'Canonical object must not reference itself as a related criterion.'
      );
    }
  }

  const lifecycle = array(object.target_assurance_by_lifecycle_stage).map((item) =>
    String(item.lifecycle_stage)
  );
  if (
    lifecycle.length !== context.requiredLifecycleStages.length ||
    lifecycle.some((stage, index) => stage !== context.requiredLifecycleStages[index])
  ) {
    issue(
      issues,
      'NORMATIVE_LIFECYCLE_COVERAGE',
      objectId,
      '/target_assurance_by_lifecycle_stage',
      `Expected exact lifecycle sequence ${context.requiredLifecycleStages.join(', ')}.`
    );
  }

  if (questionIds.size !== array(object.primary_questions).length) {
    issue(issues, 'QUESTION_IDS_UNIQUE', objectId, '/primary_questions', 'Question IDs must be unique.');
  }
  if (evidenceIds.size !== array(object.required_evidence).length) {
    issue(issues, 'EVIDENCE_IDS_UNIQUE', objectId, '/required_evidence', 'Evidence IDs must be unique.');
  }
  if (findingIds.size !== array(object.finding_definitions).length) {
    issue(issues, 'FINDING_IDS_UNIQUE', objectId, '/finding_definitions', 'Finding IDs must be unique.');
  }
}

function validateCapabilityRelations(
  capability: Record<string, any>,
  issues: CanonicalValidationIssue[]
): void {
  const objectId = String(capability.id);
  const questionIds = new Set(array(capability.primary_questions).map((item) => String(item.id)));
  const evidenceIds = new Set(array(capability.required_evidence).map((item) => String(item.id)));
  const atomicIds = new Set(array(capability.atomic_subcriteria).map((item) => String(item.id)));

  for (const [index, atomic] of array(capability.atomic_subcriteria).entries()) {
    if (!questionIds.has(String(atomic.question_id))) {
      issue(
        issues,
        'ATOMIC_QUESTION_REFERENCE_RESOLVES',
        objectId,
        `/atomic_subcriteria/${index}/question_id`,
        `${String(atomic.question_id)} is absent from primary_questions.`
      );
    }
    for (const evidenceId of array(atomic.required_evidence_ids).map(String)) {
      if (!evidenceIds.has(evidenceId)) {
        issue(
          issues,
          'ATOMIC_EVIDENCE_REFERENCE_RESOLVES',
          objectId,
          `/atomic_subcriteria/${index}/required_evidence_ids`,
          `${evidenceId} is absent from required_evidence.`
        );
      }
    }
  }

  for (const [index, finding] of array(capability.finding_definitions).entries()) {
    for (const atomicId of array(finding.mapped_atomic_item_ids).map(String)) {
      if (!atomicIds.has(atomicId)) {
        issue(
          issues,
          'FINDING_ATOMIC_REFERENCE_RESOLVES',
          objectId,
          `/finding_definitions/${index}/mapped_atomic_item_ids`,
          `${atomicId} is absent from atomic_subcriteria.`
        );
      }
    }
  }
}

function validateAntipatternRelations(
  antipattern: Record<string, any>,
  issues: CanonicalValidationIssue[]
): void {
  const objectId = String(antipattern.id);
  const questionIds = new Set(array(antipattern.primary_questions).map((item) => String(item.id)));
  const evidenceIds = new Set(array(antipattern.required_evidence).map((item) => String(item.id)));
  const atomicIds = new Set(array(antipattern.atomic_tests).map((item) => String(item.id)));

  for (const [index, atomic] of array(antipattern.atomic_tests).entries()) {
    if (!questionIds.has(String(atomic.question_id))) {
      issue(
        issues,
        'ATOMIC_QUESTION_REFERENCE_RESOLVES',
        objectId,
        `/atomic_tests/${index}/question_id`,
        `${String(atomic.question_id)} is absent from primary_questions.`
      );
    }
    for (const evidenceId of array(atomic.required_evidence_ids).map(String)) {
      if (!evidenceIds.has(evidenceId)) {
        issue(
          issues,
          'ATOMIC_EVIDENCE_REFERENCE_RESOLVES',
          objectId,
          `/atomic_tests/${index}/required_evidence_ids`,
          `${evidenceId} is absent from required_evidence.`
        );
      }
    }
  }

  for (const [index, finding] of array(antipattern.finding_definitions).entries()) {
    for (const atomicId of array(finding.mapped_atomic_item_ids).map(String)) {
      if (!atomicIds.has(atomicId)) {
        issue(
          issues,
          'FINDING_ATOMIC_REFERENCE_RESOLVES',
          objectId,
          `/finding_definitions/${index}/mapped_atomic_item_ids`,
          `${atomicId} is absent from atomic_tests.`
        );
      }
    }
  }
}

export async function validateCanonicalPair(
  capabilityInput: Record<string, unknown>,
  antipatternInput: Record<string, unknown>,
  context: CanonicalValidationContext
): Promise<CanonicalValidationReport> {
  const schemas = await loadRegistry();
  const capability = record(capabilityInput);
  const antipattern = record(antipatternInput);
  const issues: CanonicalValidationIssue[] = [];

  if (!schemas.capability(capability)) {
    schemaIssues(issues, String(capability.id ?? 'UNKNOWN'), schemas.capability.errors);
  }
  if (!schemas.antipattern(antipattern)) {
    schemaIssues(issues, String(antipattern.id ?? 'UNKNOWN'), schemas.antipattern.errors);
  }

  if (antipattern.id !== `AP-${String(capability.id)}`) {
    issue(
      issues,
      'PAIR_ID_COHERENCE',
      `${String(capability.id)}/${String(antipattern.id)}`,
      '/',
      'Anti-pattern ID must be the exact AP-* pair of the capability ID.'
    );
  }
  if (capability.domain !== antipattern.domain || capability.domain_title !== antipattern.domain_title) {
    issue(
      issues,
      'PAIR_DOMAIN_COHERENCE',
      `${String(capability.id)}/${String(antipattern.id)}`,
      '/domain',
      'Capability and anti-pattern must share the exact domain and domain title.'
    );
  }

  validateCommon(capability, context, issues);
  validateCommon(antipattern, context, issues);
  validateCapabilityRelations(capability, issues);
  validateAntipatternRelations(antipattern, issues);

  return { passed: issues.length === 0, issues };
}
