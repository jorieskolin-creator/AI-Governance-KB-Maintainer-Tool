import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import formatsPlugin from 'ajv-formats';

export const SOURCE_REGISTER_SCHEMA_PATH = 'schemas/source-register.schema.json';

export type Finding = {
  code: string;
  path: string;
  message: string;
};

export type ValidateRegisterResult = {
  ok: boolean;
  findings: Finding[];
};

let cachedValidator: ValidateFunction | undefined;

function addFormats(ajv: Ajv2020): void {
  const plugin =
    typeof formatsPlugin === 'function'
      ? formatsPlugin
      : (formatsPlugin as unknown as { default: (instance: Ajv2020) => void }).default;
  plugin(ajv);
}

function loadValidator(schemaPath = SOURCE_REGISTER_SCHEMA_PATH) {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(readFileSync(resolve(process.cwd(), schemaPath), 'utf8')) as object;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

function findingPath(error: ErrorObject): string {
  const base = error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/';
  if (error.keyword === 'required' && isRecord(error.params) && typeof error.params.missingProperty === 'string') {
    return base === '/' ? `/${error.params.missingProperty}` : `${base}/${error.params.missingProperty}`;
  }
  if (
    error.keyword === 'additionalProperties' &&
    isRecord(error.params) &&
    typeof error.params.additionalProperty === 'string'
  ) {
    return base === '/' ? `/${error.params.additionalProperty}` : `${base}/${error.params.additionalProperty}`;
  }
  return base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function findingsFromAjv(errors: ErrorObject[] | null | undefined): Finding[] {
  if (!errors?.length) return [];
  return errors.map((error) => ({
    code: error.keyword.toUpperCase(),
    path: findingPath(error),
    message: error.message ?? 'schema validation failed'
  }));
}

export function validateRegister(candidate: unknown): ValidateRegisterResult {
  const validator = loadValidator();
  const ok = validator(candidate) === true;
  return {
    ok,
    findings: ok ? [] : findingsFromAjv(validator.errors)
  };
}
