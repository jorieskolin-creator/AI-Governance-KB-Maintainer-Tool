import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runGoldenMutationSuite, validateGoldenPair, type GoldenPair } from './regression.js';

interface GoldenManifestFixture {
  path: string;
  object_id: string;
  version: string;
  schema_version: string;
  sha256: string;
}

interface GoldenManifest {
  reference_id: string;
  normative: boolean;
  fixtures: GoldenManifestFixture[];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadJson<T>(path: string): Promise<{ value: T; bytes: Uint8Array }> {
  const bytes = await readFile(resolve(process.cwd(), path));
  return { value: JSON.parse(bytes.toString('utf8')) as T, bytes };
}

async function main(): Promise<void> {
  const manifestPath = 'golden/golden-reference.manifest.json';
  const { value: manifest } = await loadJson<GoldenManifest>(manifestPath);

  if (manifest.normative !== false) {
    throw new Error('Golden reference manifest must remain explicitly non-normative.');
  }

  const capabilityFixture = manifest.fixtures.find((item) => item.object_id === 'A1');
  const antipatternFixture = manifest.fixtures.find((item) => item.object_id === 'AP-A1');
  if (!capabilityFixture || !antipatternFixture) {
    throw new Error('Golden reference manifest must contain exact A1 and AP-A1 fixtures.');
  }

  const capability = await loadJson<Record<string, unknown>>(capabilityFixture.path);
  const antipattern = await loadJson<Record<string, unknown>>(antipatternFixture.path);

  const fixtureChecks = [
    [capabilityFixture, capability.bytes],
    [antipatternFixture, antipattern.bytes]
  ] as const;

  for (const [fixture, bytes] of fixtureChecks) {
    const actual = sha256(bytes);
    if (actual !== fixture.sha256) {
      throw new Error(
        `Golden fixture hash mismatch for ${fixture.path}: expected ${fixture.sha256}, received ${actual}.`
      );
    }
  }

  const pair: GoldenPair = {
    capability: capability.value,
    antipattern: antipattern.value
  };

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
        fixtureHashesVerified: true,
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
