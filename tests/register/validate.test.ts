import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRegister } from '../../src/assets/validate.js';
import type { SourceRegister } from '../../src/assets/load.js';

function loadRegister(): SourceRegister {
  return JSON.parse(readFileSync('AI_Governance_Global_Source_Register_v1.5.0.json', 'utf8')) as SourceRegister;
}

describe('register validation', () => {
  it('accepts a valid date-only edit and reports precise findings for an invalid edit', () => {
    const valid = loadRegister();
    const first = valid.sources[0];
    if (!first) throw new Error('fixture is missing sources');
    first.last_verified_date = '2026-09-21';

    const ok = validateRegister(valid);
    expect(ok.ok).toBe(true);
    expect(ok.findings).toEqual([]);

    const invalid = loadRegister();
    const broken = invalid.sources[0];
    if (!broken) throw new Error('fixture is missing sources');
    broken.id = 'NOT-A-SOURCE-ID';
    broken.last_verified_date = '21 September 2026';

    const fail = validateRegister(invalid);
    expect(fail.ok).toBe(false);
    expect(fail.findings.length).toBeGreaterThan(0);
    const idFinding = fail.findings.find((finding) => finding.path.includes('id') || finding.message.includes('pattern'));
    const dateFinding = fail.findings.find(
      (finding) => finding.path.includes('last_verified_date') || finding.message.includes('date')
    );
    expect(idFinding?.path).toMatch(/\/sources\/0\/id/);
    expect(idFinding?.message.length).toBeGreaterThan(0);
    expect(dateFinding?.path).toMatch(/\/sources\/0\/last_verified_date/);
    expect(dateFinding?.message.length).toBeGreaterThan(0);
  });
});
