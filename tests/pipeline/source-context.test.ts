import { describe, expect, it } from 'vitest';
import type { AuthoringPlan } from '../../src/authoring/authoring-plan.js';
import { buildPromptPacket } from '../../src/cognitive/prompt-builder.js';
import { sourceContextAcquisitionContract } from '../../src/orchestration/source-context-acquisition.js';
import { buildSourceContextPacket as buildLegacySourceContextPacket } from '../../src/orchestration/source-context-packet.js';
import {
  assembleSourceContext,
  buildSourceContextPacket,
  buildSourceContextPrompt,
  validateSourceContext,
  type AuthoringSourceRegisterRecord,
  type SourceContextPlan
} from '../../src/pipeline/source-context.js';

const plan: SourceContextPlan = {
  planSha256: 'ab'.repeat(32),
  identity: { pairId: 'A1_AP-A1', domain: 'A' },
  baseline: { sourceRegisterVersion: '1.5.0', sourceRegisterSha256: 'cd'.repeat(32) },
  sourceUniverse: [
    {
      sourceHandle: 'source_002',
      sourceId: 'SRC-2',
      versionOrDate: '2026-01-01',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-02-01'
    },
    {
      sourceHandle: 'source_001',
      sourceId: 'SRC-1',
      versionOrDate: '2024',
      verificationStatus: 'VERIFIED',
      lastVerifiedDate: '2026-01-15'
    }
  ]
};

function record(sourceId: string, versionOrDate: string, lastVerifiedDate: string): AuthoringSourceRegisterRecord {
  return {
    sourceId,
    versionOrDate,
    verificationStatus: 'VERIFIED',
    lastVerifiedDate,
    effectiveStatus: 'IN_FORCE',
    authorityTier: 'PRIMARY',
    authorityType: 'STATUTE',
    officialLocation: 'https://example.test/source',
    applicabilityBoundary: 'Applies to the assessed operating context.',
    licensingBoundary: 'Public text may be cited by locator.',
    domainCoverage: ['A'],
    modelContextPolicy: 'METADATA_LOCATOR_ONLY',
    usageRightsReference: null
  };
}

describe('source context stage', () => {
  it('builds a byte-identical packet from the same inputs regardless of locator order', () => {
    const records = [
      record('SRC-2', '2026-01-01', '2026-02-01'),
      record('SRC-1', '2024', '2026-01-15')
    ];
    const first = buildSourceContextPacket({
      plan,
      registerRecords: records,
      locatorContexts: [
        { sourceId: 'SRC-2', locator: 'Article 2' },
        { sourceId: 'SRC-1', locator: 'Section 1' }
      ]
    });
    const second = buildSourceContextPacket({
      plan,
      registerRecords: [...records].reverse(),
      locatorContexts: [
        { sourceId: 'SRC-1', locator: 'Section 1' },
        { sourceId: 'SRC-2', locator: 'Article 2' }
      ]
    });
    expect(second).toEqual(first);
    expect(first.packetSha256).toBe(second.packetSha256);
    expect(first.sources.map((item) => item.sourceHandle)).toEqual(['source_001', 'source_002']);
    const validated = validateSourceContext(first, 'RELEASE');
    expect(validated.ok).toBe(true);
  });

  it('warns on a hash mismatch in DRAFT and fails it in RELEASE', () => {
    const packet = buildSourceContextPacket({
      plan,
      registerRecords: [record('SRC-1', '2024', '2026-01-15'), record('SRC-2', '2026-01-01', '2026-02-01')],
      locatorContexts: []
    });
    const tampered = { ...packet, packetSha256: '0'.repeat(64) };
    const draft = validateSourceContext(tampered, 'DRAFT');
    expect(draft.ok).toBe(true);
    expect(draft.warnings.some((item) => item.code === 'SOURCE_CONTEXT_PACKET_HASH' && item.path === '/packetSha256')).toBe(
      true
    );
    const release = validateSourceContext(tampered, 'RELEASE');
    expect(release.ok).toBe(false);
    expect(release.findings.some((item) => item.code === 'SOURCE_CONTEXT_PACKET_HASH')).toBe(true);
  });

  it('refuses to invent a locator outside the plan and keeps the prompt byte-stable', () => {
    expect(() =>
      buildSourceContextPacket({
        plan,
        registerRecords: [record('SRC-1', '2024', '2026-01-15'), record('SRC-2', '2026-01-01', '2026-02-01')],
        locatorContexts: [{ sourceId: 'SRC-9', locator: 'Invented clause' }]
      })
    ).toThrow(/outside the Authoring Plan/);
    const authoringPlan = {
      planSha256: plan.planSha256,
      identity: { pairId: plan.identity.pairId, domain: plan.identity.domain },
      baseline: plan.baseline,
      sourceUniverse: plan.sourceUniverse
    } as AuthoringPlan;
    const legacy = buildPromptPacket(sourceContextAcquisitionContract(authoringPlan));
    expect(buildSourceContextPrompt(plan)).toBe(`${legacy.system}\n\n${legacy.user}`);
  });

  it('deep-equals the legacy packet builder, including hashes, for the same inputs', () => {
    const records = [
      record('SRC-2', '2026-01-01', '2026-02-01'),
      {
        ...record('SRC-1', '2024', '2026-01-15'),
        modelContextPolicy: 'BOUNDED_SNIPPET_ALLOWED' as const,
        authorityType: 'STATUTE',
        usageRightsReference: 'rights-1'
      }
    ];
    const locatorContexts = [
      { sourceId: 'SRC-1', locator: ' Section 1 ', locatorLabel: ' s1 ', contextText: '  bounded passage  ' },
      { sourceId: 'SRC-2', locator: 'Article 2', contextText: 'must be stripped' }
    ];
    const authoringPlan = {
      planSha256: plan.planSha256,
      identity: { pairId: plan.identity.pairId, domain: plan.identity.domain },
      baseline: plan.baseline,
      sourceUniverse: plan.sourceUniverse
    } as AuthoringPlan;
    const legacy = buildLegacySourceContextPacket({
      authoringPlan,
      sealedSourceRegisterVersion: plan.baseline.sourceRegisterVersion,
      sealedSourceRegisterSha256: plan.baseline.sourceRegisterSha256,
      registerRecords: records,
      locatorContexts: locatorContexts.map((item) =>
        item.sourceId === 'SRC-2' ? { sourceId: item.sourceId, locator: item.locator } : item
      )
    });
    const current = buildSourceContextPacket({
      plan,
      registerRecords: [...records].reverse(),
      locatorContexts: locatorContexts
        .filter((item) => item.sourceId === 'SRC-1')
        .concat(locatorContexts.filter((item) => item.sourceId === 'SRC-2').map(({ contextText: _text, ...rest }) => rest))
        .reverse()
    });
    expect(current).toEqual(legacy);
    const assembled = assembleSourceContext({ plan, registerRecords: records, locatorContexts });
    expect(assembled).toEqual(legacy);
    expect(validateSourceContext({ ...current, extra: true }, 'RELEASE').findings.some((item) => item.code === 'ADDITIONALPROPERTIES')).toBe(
      true
    );
  });
});
