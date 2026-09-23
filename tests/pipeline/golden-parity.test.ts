import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileSirPair } from '../../src/compiler/sir-compiler.js';
import { authorOfflineA1 } from '../../src/pipeline/author-offline.js';

/**
 * Golden-projection parity (P2A-FIX2).
 *
 * This revises the P2A golden-parity contract. The immutable 2.0.0 APPROVED
 * fixtures stay the semantic calibration reference. The test no longer expects
 * byte-identity with those fixtures.
 *
 * What it proves: recorded A1 task outputs pass RELEASE validators, and a
 * DRAFT 2.1.0 compile of the golden-derived snapshot deep-equals the fixtures
 * after the five declared projections below.
 *
 * What it does not prove: RELEASE-mode compile.ok. compileSirPair in RELEASE
 * mode requires operator approval records owned by the release finalizer (P3)
 * and records APPROVAL_RECORD unconditionally. This test does not assert
 * anything about RELEASE-mode ok.
 */

const capability = JSON.parse(readFileSync('golden/fixtures/A1_v1.0.0.json', 'utf8')) as Record<string, unknown>;
const antipattern = JSON.parse(readFileSync('golden/fixtures/AP-A1_v1.0.0.json', 'utf8')) as Record<string, unknown>;
const plan = JSON.parse(readFileSync('tests/pipeline/recordings/A1/authoring-plan.json', 'utf8')) as Parameters<
  typeof compileSirPair
>[0]['authoringPlan'];
const snapshot = JSON.parse(readFileSync('tests/pipeline/recordings/A1/snapshot.json', 'utf8')) as Record<string, unknown>;

const SLUG_MAPPING_IDS = [
  'SRCMAP-A1-EU-AIA-001',
  'SRCMAP-A1-NIST-AI-RMF-002',
  'SRCMAP-AP-A1-EU-AIA-001',
  'SRCMAP-AP-A1-NIST-AI-RMF-002'
] as const;

function mappingIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    return String((item as { mapping_id?: unknown }).mapping_id ?? '');
  });
}

function assertFixtureStillHistorical(fixture: Record<string, unknown>, tacticCount: number): void {
  expect(fixture.schema_version).toBe('2.0.0');
  expect(fixture.release_status).toBe('APPROVED');
  expect(fixture.approval_record).toBeTruthy();
  expect(fixture.candidate_tactic_refs).toHaveLength(tacticCount);
  for (const id of mappingIds(fixture.normative_source_mappings)) {
    expect(id).toMatch(/^SRCMAP-/);
    expect(id).not.toMatch(/^SRCMAP-(?:AP-)?A1-\d{3}$/);
  }
}

function projectGolden(fixture: Record<string, unknown>): Record<string, unknown> {
  const projected = structuredClone(fixture);
  // 1. schema_version → plan value (2.1.0)
  projected.schema_version = plan.schemaVersion;
  // 2. release_status → DRAFT
  projected.release_status = 'DRAFT';
  // 3. delete approval_record (owned by the release finalizer — P3)
  delete projected.approval_record;
  // 4. candidate_tactic_refs → [] (legacy GOV-PUR mappings are not approved playbook IDs)
  projected.candidate_tactic_refs = [];
  // 5. normative_source_mappings → [] (2.0.0 artifacts predate supported_claim semantics)
  projected.normative_source_mappings = [];
  return projected;
}

function stripNonAttested(compiled: Record<string, unknown>): Record<string, unknown> {
  const mappings = compiled.normative_source_mappings;
  if (Array.isArray(mappings) && mappings.length > 0) {
    throw new Error(
      'Compiled DRAFT image contains normative_source_mappings. The derived snapshot should have produced none.'
    );
  }
  return compiled;
}

describe('golden-projection parity', () => {
  it('deep-equals a DRAFT 2.1.0 projection of the golden A1/AP-A1 fixtures', async () => {
    const result = await authorOfflineA1();
    expect(result.packets).toEqual(result.recordings);

    assertFixtureStillHistorical(capability, 5);
    assertFixtureStillHistorical(antipattern, 6);
    expect(mappingIds(capability.normative_source_mappings)).toEqual(SLUG_MAPPING_IDS.slice(0, 2));
    expect(mappingIds(antipattern.normative_source_mappings)).toEqual(SLUG_MAPPING_IDS.slice(2));

    const draft = await compileSirPair({
      authoringPlan: plan,
      snapshot,
      mode: 'DRAFT'
    });
    expect(draft.ok).toBe(true);
    expect(draft.capability).toBeTruthy();
    expect(draft.antipattern).toBeTruthy();
    expect(stripNonAttested(draft.capability!)).toEqual(projectGolden(capability));
    expect(stripNonAttested(draft.antipattern!)).toEqual(projectGolden(antipattern));
  });

  it('threads a synthetic supportedClaim into normative_source_mappings', async () => {
    const syntheticClaim = 'Synthetic threading probe: this supported claim is not golden-attested.';
    const threaded = structuredClone(snapshot) as {
      sourceMappings: { capability: Array<Record<string, unknown>> };
    };
    threaded.sourceMappings.capability.push({
      sourceHandle: 'source_001',
      locatorHandle: 'locator_001',
      sourceId: 'SRC-EU-AIA',
      sourceVersionOrDate: 'Regulation (EU) 2024/1689',
      exactLocator: 'Article 1',
      relationship: 'SUPPORTS',
      supportedClaim: syntheticClaim,
      categoryRationale: 'Synthetic threading probe rationale for compiler field threading.',
      applicabilityConditions: [],
      exclusions: [],
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-08-02',
      authorityTier: 'TIER_1_NORMATIVE',
      authorityType: 'LEGISLATION',
      locatorContextSha256: 'b'.repeat(64)
    });
    const compiled = await compileSirPair({
      authoringPlan: plan,
      snapshot: threaded,
      mode: 'DRAFT'
    });
    expect(compiled.ok).toBe(true);
    const mappings = compiled.capability?.normative_source_mappings as Array<{ supported_claim?: string }>;
    expect(mappings).toHaveLength(1);
    expect(mappings?.[0]?.supported_claim).toBe(syntheticClaim);
  });
});
