import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SOURCE_REGISTER_SCHEMA_PATH, validateRegister } from './validate.js';

export const SOURCE_REGISTER_FILENAME = 'AI_Governance_Global_Source_Register_v1.5.0.json';

export type SourceRegister = {
  version: string;
  sources: SourceRecord[];
  approval_record?: Record<string, unknown>;
  [key: string]: unknown;
};

export type SourceRecord = {
  id: string;
  last_verified_date: string;
  effective_status: string;
  supersedes_source_id: string | null;
  [key: string]: unknown;
};

export type LoadedRegister = {
  register: SourceRegister;
  version: string;
  sha256: string;
  raw: string;
};

export type LoadSourceRegisterOptions = {
  cwd?: string;
  registerPath?: string;
  schemaPath?: string;
};

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function serializeRegister(register: SourceRegister): string {
  return `${JSON.stringify(register, null, 2)}\n`;
}

function assertSourceRegister(value: unknown): SourceRegister {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Source register is not a JSON object.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'string' || record.version.length === 0) {
    throw new Error('Source register is missing version.');
  }
  if (!Array.isArray(record.sources)) {
    throw new Error('Source register is missing sources.');
  }
  return value as SourceRegister;
}

export function loadSourceRegister(options: LoadSourceRegisterOptions = {}): LoadedRegister {
  const cwd = options.cwd ?? process.cwd();
  const registerPath = resolve(cwd, options.registerPath ?? SOURCE_REGISTER_FILENAME);
  const schemaPath = resolve(cwd, options.schemaPath ?? SOURCE_REGISTER_SCHEMA_PATH);

  if (!existsSync(registerPath)) {
    throw new Error(`Source register is missing at ${registerPath}. Boot aborted.`);
  }
  if (!existsSync(schemaPath)) {
    throw new Error(`Source register schema is missing at ${schemaPath}. Boot aborted.`);
  }

  let raw: string;
  try {
    raw = readFileSync(registerPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Source register could not be read at ${registerPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Source register JSON is invalid at ${registerPath}: ${message}`);
  }

  const result = validateRegister(parsed);
  if (!result.ok) {
    const detail = result.findings.map((finding) => `${finding.path}: ${finding.message}`).join('; ');
    throw new Error(`Source register failed schema validation at ${registerPath}. ${detail}`);
  }

  const register = assertSourceRegister(parsed);
  return {
    register,
    version: register.version,
    sha256: sha256Hex(raw),
    raw
  };
}
