import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runGoldenMutationSuite, validateGoldenPair, type GoldenPair } from './regression.js';

interface GoldenManifestFixture {
  path: string;
  object_id: string;
  version: string;
  schema_version: string;
  semantic_sha256: string;
  source_byte_sha256: string;
}

interface GoldenManifest {
  reference_id: string;
  normative: boolean;
  fixtures: GoldenManifestFixture[];
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}

function semanticSha256(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

async function loadJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8')) as T;
}

async function main(): Promise<void> {
  const manifestPath = 'golden/golden-reference.manifest.json';
  const manifest = await loadJson<GoldenManifest>(manifestPath);

  if (manifest.normative !== false) {
    throw new Error('Golden reference manifest must remain explicitly non-normative.');
  }

  const capabilityFixture = manifest.fixtures.find((item) => item.object_id === 'A1');
  const antipatternFixture = manifest.fixtures.find((item) => item.object_id === 'AP-A1');
  if (!capabilityFixture || !antipatternFixture) {
    throw new Error('Golden reference manifest must contain A1 and AP-A1 fixtures.');
  }

  const capability = await loadJson<Record<string, unknown>>(capabilityFixture.path);
  const antipattern = await loadJson<Record<string, unknown>>(antipatternFixture.path);

  const fixtureChecks = [
    [capabilityFixture, capability],
    [antipatternFixture, antipattern]
  ] as const;

  for (const [fixture, value] of fixtureChecks) {
    const actual = semanticSha256(value);
    if (actual !== fixture.semantic_sha256) {
      throw new Error(
        `Golden semantic hash mismatch for ${fixture.path}: expected ${fixture.semantic_sha256}, received ${actual}.`
      );
    }
    if (!/^[a-f0-9]{64}$/.test(fixture.source_byte_sha256)) {
      throw new Error(`Invalid source-byte provenance hash for ${fixture.path}.`);
    }
  }

  const pair: GoldenPair = { capability, antipattern };
  const base = validateGoldenPair(pair);
  if (!base.passed) {
    throw new Error(
      `Golden reference base validation failed: ${base.findings
        .map((finding) => `${finding.checkId}:${finding.objectPath}`)
        .join(', ')}`
    );
  }

  const mutationResults = runGoldenMutationSuite(pair);
  const missed = mutationResults.filter((result) => !result.passed);
  if (missed.length) {
    throw new Error(
      `Golden mutation detection failed: ${missed
        .map((result) => `${result.name}[${result.detectedCheckIds.join('|')}]`)
        .join(', ')}`
    );
  }

  console.log(
    JSON.stringify(
      {
        referenceId: manifest.reference_id,
        normative: false,
        semanticFixtureHashesVerified: true,
        sourceByteHashesRetainedForProvenance: true,
        baseValidation: 'PASS',
        mutationSuite: mutationResults.map((result) => ({ name: result.name, status: 'PASS' }))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
