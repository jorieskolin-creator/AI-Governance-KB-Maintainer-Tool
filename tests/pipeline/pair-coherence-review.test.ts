import { describe, expect, it } from 'vitest';
import { buildPairCoherenceReviewPrompt, validatePairCoherenceReview } from '../../src/pipeline/pair-coherence-review.js';
import type { PipelinePlan } from '../../src/pipeline/prompt.js';

const plan = {
  planId: 'A1_AP-A1:authoring-plan:1.0.0',
  planSha256: 'ab'.repeat(32),
  identity: { pairId: 'A1_AP-A1', capabilityId: 'A1', antipatternId: 'AP-A1', domain: 'A' },
  adjacentCriteria: [],
  fixedQuestionSlots: [],
  vocabulary: {
    technicalAssurance: [],
    humanAssurance: [],
    capabilityConclusionStates: [],
    antipatternConclusionStates: [],
    hardGateEffects: [],
    lifecycleStages: []
  },
  baseline: {
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: 'cd'.repeat(32)
  },
  tacticUniverse: []
} as PipelinePlan;

describe('pair coherence review contract', () => {
  it('rejects a model-owned pass flag as a schema finding', () => {
    const result = validatePairCoherenceReview(
      { defects: [], coherenceSummary: 'No cross-artifact contradiction was found.', passed: true },
      'RELEASE'
    );
    expect(result.ok).toBe(false);
    expect(result.findings.some((item) => item.path === '/passed' && item.code === 'ADDITIONALPROPERTIES')).toBe(true);
  });

  it('warns on a duplicate path handle in DRAFT and fails it in RELEASE', () => {
    const output = {
      defects: [
        {
          severity: 'HIGH',
          coherenceDimension: 'SEMANTIC_BOUNDARY',
          affectedPathHandles: ['path_001', 'path_001'],
          issue: 'The capability boundary contradicts the anti-pattern boundary.',
          coherenceExpectation: 'The two boundaries must describe one pair without contradiction.',
          recommendedRepairPathHandles: ['path_001']
        }
      ],
      coherenceSummary: 'One boundary contradiction remains.'
    };
    const draft = validatePairCoherenceReview(output, 'DRAFT');
    expect(draft.ok).toBe(true);
    expect(draft.warnings.some((item) => item.code === 'PATH_HANDLES_RESOLVE_TO_LOCKED_REGISTRY')).toBe(true);
    const release = validatePairCoherenceReview(output, 'RELEASE');
    expect(release.ok).toBe(false);
    expect(release.findings.some((item) => item.path === '/defects/0/affectedPathHandles/1')).toBe(true);
  });

  it('renders a byte-stable prompt and refuses a mismatched packet', () => {
    const seed = {
      plan,
      pairCoherencePacket: {
        pairId: 'A1_AP-A1',
        authoringPlanSha256: plan.planSha256,
        packetSha256: '11'.repeat(32)
      },
      categoryBaseline: {},
      goldenReference: {}
    };
    expect(buildPairCoherenceReviewPrompt(seed)).toBe(buildPairCoherenceReviewPrompt(seed));
    expect(buildPairCoherenceReviewPrompt(seed)).toContain('PAIR_COHERENCE_REVIEW');
    expect(() =>
      buildPairCoherenceReviewPrompt({
        ...seed,
        pairCoherencePacket: { ...seed.pairCoherencePacket, pairId: 'A2_AP-A2' }
      })
    ).toThrow(/does not match/);
  });
});
