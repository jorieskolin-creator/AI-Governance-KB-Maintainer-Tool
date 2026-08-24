import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBaselineManifest, type BaselineArtifact } from './snapshot.js';

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8'));
}

function schemaVersion(schema: unknown, label: string): string {
  if (!schema || typeof schema !== 'object') throw new Error(`${label} is not JSON.`);
  const id = (schema as { $id?: unknown }).$id;
  if (typeof id !== 'string' || !id.includes(':')) {
    throw new Error(`${label} is missing a versioned $id.`);
  }
  const version = id.split(':').at(-1);
  if (!version) throw new Error(`${label} $id has no version.`);
  return version;
}

export function loadRepoBaselineArtifacts(): BaselineArtifact[] {
  const productionContract = readJson('baseline/production-contract.json') as { version?: unknown };
  const categories = readJson('baseline/categories-baseline.json') as { id?: unknown; version?: unknown };
  const capabilitySchema = readJson('schemas/capability.schema.json');
  const antipatternSchema = readJson('schemas/antipattern.schema.json');
  const sharedDefinitions = readJson('schemas/shared-definitions.schema.json');
  const sourceRegister = readJson('AI_Governance_Global_Source_Register_v1.5.0.json') as {
    register_id?: unknown;
    version?: unknown;
  };
  const goldenManifest = readJson('golden/golden-reference.manifest.json') as {
    reference_id?: unknown;
    reference_version?: unknown;
  };
  const goldenA1 = readJson('golden/fixtures/A1_v1.0.0.json');
  const goldenApA1 = readJson('golden/fixtures/AP-A1_v1.0.0.json');

  if (typeof productionContract.version !== 'string') {
    throw new Error('Production contract is missing version.');
  }
  if (typeof categories.id !== 'string' || typeof categories.version !== 'string') {
    throw new Error('Categories baseline is missing identity.');
  }
  if (typeof sourceRegister.register_id !== 'string' || typeof sourceRegister.version !== 'string') {
    throw new Error('Source register is missing identity.');
  }
  if (typeof goldenManifest.reference_id !== 'string' || typeof goldenManifest.reference_version !== 'string') {
    throw new Error('Golden reference manifest is missing identity.');
  }

  return [
    {
      artifactType: 'PRODUCTION_CONTRACT',
      id: 'AI-GOV-KB-AUTHORING-PRODUCTION-CONTRACT',
      version: productionContract.version,
      content: productionContract
    },
    {
      artifactType: 'CATEGORIES_BASELINE',
      id: categories.id,
      version: categories.version,
      content: categories
    },
    {
      artifactType: 'CAPABILITY_SCHEMA',
      id: 'capability.schema.json',
      version: schemaVersion(capabilitySchema, 'capability schema'),
      content: capabilitySchema
    },
    {
      artifactType: 'ANTIPATTERN_SCHEMA',
      id: 'antipattern.schema.json',
      version: schemaVersion(antipatternSchema, 'anti-pattern schema'),
      content: antipatternSchema
    },
    {
      artifactType: 'SHARED_DEFINITIONS_SCHEMA',
      id: 'shared-definitions.schema.json',
      version: schemaVersion(sharedDefinitions, 'shared definitions'),
      content: sharedDefinitions
    },
    {
      artifactType: 'SOURCE_REGISTER',
      id: sourceRegister.register_id,
      version: sourceRegister.version,
      content: sourceRegister
    },
    {
      artifactType: 'GOLDEN_REFERENCE',
      id: goldenManifest.reference_id,
      version: goldenManifest.reference_version,
      content: { manifest: goldenManifest, fixtures: { A1: goldenA1, 'AP-A1': goldenApA1 } }
    }
  ];
}

export function previewRepoBaselineManifest() {
  return buildBaselineManifest(loadRepoBaselineArtifacts());
}
