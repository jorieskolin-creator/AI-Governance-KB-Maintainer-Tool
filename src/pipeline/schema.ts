import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import formatsPlugin from 'ajv-formats';
import type { Finding } from './finding.js';

const compiled = new Map<string, ValidateFunction>();

function addFormats(ajv: Ajv2020): void {
  const plugin =
    typeof formatsPlugin === 'function'
      ? formatsPlugin
      : (formatsPlugin as unknown as { default: (instance: Ajv2020) => void }).default;
  plugin(ajv);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

export function findingsFromAjv(errors: ErrorObject[] | null | undefined): Finding[] {
  if (!errors?.length) return [];
  return errors.map((error) => ({
    code: error.keyword.toUpperCase(),
    path: findingPath(error),
    message: error.message ?? 'schema validation failed'
  }));
}

export function compileSchema(schema: object & { $id: string }): ValidateFunction {
  const cached = compiled.get(schema.$id);
  if (cached) return cached;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const validator = ajv.compile(schema);
  compiled.set(schema.$id, validator);
  return validator;
}

export function schemaFindings(schema: object & { $id: string }, output: unknown): Finding[] {
  const validator = compileSchema(schema);
  const ok = validator(output) === true;
  return ok ? [] : findingsFromAjv(validator.errors);
}
