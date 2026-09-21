import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSourceRegister } from '../../src/assets/load.js';

describe('register boot', () => {
  it('fails loudly when register JSON violates the schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'register-boot-'));
    const registerPath = join(dir, 'AI_Governance_Global_Source_Register_v1.5.0.json');
    writeFileSync(
      registerPath,
      JSON.stringify({
        version: 'not-a-semver',
        sources: []
      }),
      'utf8'
    );

    expect(() =>
      loadSourceRegister({
        registerPath,
        schemaPath: resolve('schemas/source-register.schema.json')
      })
    ).toThrow(/schema validation/i);
  });
});
