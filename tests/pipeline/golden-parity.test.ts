import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authorOfflineA1 } from '../../src/pipeline/author-offline.js';

const capability = JSON.parse(readFileSync('golden/fixtures/A1_v1.0.0.json', 'utf8')) as unknown;
const antipattern = JSON.parse(readFileSync('golden/fixtures/AP-A1_v1.0.0.json', 'utf8')) as unknown;

describe('golden parity', () => {
  it('deep-equals recorded A1 packets and the golden A1/AP-A1 fixtures', async () => {
    const result = await authorOfflineA1();
    expect(result.packets).toEqual(result.recordings);
    expect(result.compile.ok).toBe(true);
    expect(result.compile.capability).toEqual(capability);
    expect(result.compile.antipattern).toEqual(antipattern);
  });
});
