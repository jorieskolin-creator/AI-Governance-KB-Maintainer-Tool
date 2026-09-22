import { describe, expect, it } from 'vitest';
import type { AuthoringPlan } from '../../src/authoring/authoring-plan.js';
import { buildPromptPacket } from '../../src/cognitive/prompt-builder.js';
import {
  buildSirApFailureModelContract,
  buildSirApplicabilityContract,
  buildSirPairBoundaryContract,
  buildSirPrimaryQuestionsContract
} from '../../src/cognitive/sir-initial-contracts.js';
import { buildPairFramePrompt, validatePairFrame, type PairFrameOutput } from '../../src/pipeline/pair-frame.js';
import type { PipelinePlan } from '../../src/pipeline/prompt.js';

const plan = {
  planId: 'A1_AP-A1:authoring-plan:1.0.0',
  planSha256: 'ab'.repeat(32),
  identity: {
    pairId: 'A1_AP-A1',
    capabilityId: 'A1',
    antipatternId: 'AP-A1',
    domain: 'A',
    domainTitle: 'Purpose',
    capabilityTitle: 'Intended purpose',
    antipatternTitle: 'Purpose theatre'
  },
  adjacentCriteria: [{ criterionHandle: 'criterion_001', criterionId: 'A2', boundarySummary: 'Neighbor boundary.' }],
  fixedQuestionSlots: [
    { slot: 1, dimension: 'DEFINITION_AND_INTENT' },
    { slot: 2, dimension: 'IMPLEMENTATION_AND_OPERATION' },
    { slot: 3, dimension: 'EVIDENCE_AND_EFFECTIVENESS' }
  ],
  vocabulary: {
    technicalAssurance: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED'],
    antipatternConclusionStates: ['UNKNOWN'],
    hardGateEffects: ['NONE'],
    lifecycleStages: ['QUALIFICATION_AND_REGISTRATION']
  },
  baseline: {
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: 'cd'.repeat(32)
  },
  tacticUniverse: []
} as unknown as PipelinePlan;

const categoryBaseline = { title: 'domain A' };
const goldenReference = { reference_id: 'A1_AP-A1' };
const pairBoundary = {
  capability: {
    canonicalDefinition: 'Purpose is bounded enough to govern design and operation.',
    governancePurpose: 'Keep intended use explicit.',
    distinctClaim: 'A1 owns purpose boundaries.',
    ownedTopics: ['intended purpose'],
    excludedTopics: []
  },
  antipattern: {
    canonicalDefinition: 'Purpose theatre states a use the system does not have.',
    pairedRelationship: 'The anti-pattern is unbounded purpose.'
  },
  boundaryRationale: 'The pair is bounded around intended purpose.'
};
const apFailureModel = {
  failureMechanism: 'A stated purpose hides the actual decision the system makes.',
  triggeringConditions: ['Public purpose text and operating use diverge.'],
  observableFailureSurfaces: ['Operators cannot name the decision the system takes.'],
  nonExamples: ['A purpose statement that matches observed use.'],
  distinctionFromCapabilityGap: 'This is misstated purpose, not missing evidence of a true purpose.'
};
const applicability = {
  capability: {
    statement: 'Applies whenever an AI system has an intended use.',
    conditions: ['A system is proposed, deployed, or changed.'],
    exclusions: [],
    reassessmentTriggers: ['The user population changes.']
  },
  antipattern: {
    statement: 'Applies when stated purpose can be compared with actual use.',
    conditions: ['Purpose text and operating behavior are both observable.'],
    exclusions: [],
    reassessmentTriggers: ['A new workflow uses the system.']
  },
  consistencyNotes: ['Both sides stay independently assessable.']
};

function validOutput(): PairFrameOutput {
  return {
    pairBoundary,
    apFailureModel,
    applicability,
    primaryQuestions: {
      capabilityQuestions: [
        { slot: 1, question: 'Is the intended purpose specific and testable?' },
        { slot: 2, question: 'Is that purpose implemented in the operating workflow?' },
        { slot: 3, question: 'Does current evidence show use stays inside the purpose?' }
      ],
      antipatternQuestions: [
        { slot: 1, question: 'Is the failure a misstated purpose rather than missing evidence?' },
        { slot: 2, question: 'Does operating behavior leave the stated purpose?' },
        { slot: 3, question: 'Does evidence show the misstatement is present or absent?' }
      ],
      coverageRationale: 'The three governed slots are covered for both objects.'
    }
  };
}

describe('pair frame contract', () => {
  it('rejects a malformed output with a precise schema finding', () => {
    const broken = validOutput();
    broken.pairBoundary = { ...broken.pairBoundary, boundaryRationale: 'short' };
    const result = validatePairFrame(broken, 'RELEASE');
    expect(result.ok).toBe(false);
    const finding = result.findings.find((item) => item.path === '/pairBoundary/boundaryRationale');
    expect(finding?.code).toBe('MINLENGTH');
    expect(finding?.message.length).toBeGreaterThan(0);
  });

  it('warns on slot-order contract violations in DRAFT and fails them in RELEASE', () => {
    const swapped = validOutput();
    const first = swapped.primaryQuestions.capabilityQuestions[0];
    const second = swapped.primaryQuestions.capabilityQuestions[1];
    if (!first || !second) throw new Error('fixture questions missing');
    swapped.primaryQuestions.capabilityQuestions[0] = { ...second, slot: 2 };
    swapped.primaryQuestions.capabilityQuestions[1] = { ...first, slot: 1 };
    const draft = validatePairFrame(swapped, 'DRAFT');
    expect(draft.ok).toBe(true);
    expect(draft.findings).toEqual([]);
    expect(draft.warnings.some((item) => item.code === 'QUESTION_SLOTS_FIXED_AND_ORDERED')).toBe(true);
    const release = validatePairFrame(swapped, 'RELEASE');
    expect(release.ok).toBe(false);
    expect(release.warnings).toEqual([]);
    expect(release.findings.some((item) => item.code === 'QUESTION_SLOTS_FIXED_AND_ORDERED')).toBe(true);
  });

  it('keeps the constituent prompt bytes aligned with the old task contracts', () => {
    const authoringPlan = plan as unknown as AuthoringPlan;
    const seed = { plan, categoryBaseline, goldenReference, pairBoundary, apFailureModel, applicability };
    const prompt = buildPairFramePrompt(seed);
    const again = buildPairFramePrompt(seed);
    expect(prompt).toBe(again);
    const oldPackets = [
      buildPromptPacket(buildSirPairBoundaryContract({ authoringPlan, categoryBaseline, goldenReference })),
      buildPromptPacket(
        buildSirApFailureModelContract({ authoringPlan, categoryBaseline, goldenReference, pairBoundary })
      ),
      buildPromptPacket(
        buildSirApplicabilityContract({
          authoringPlan,
          categoryBaseline,
          goldenReference,
          pairBoundary,
          apFailureModel
        })
      ),
      buildPromptPacket(
        buildSirPrimaryQuestionsContract({
          authoringPlan,
          categoryBaseline,
          goldenReference,
          pairBoundary,
          apFailureModel,
          applicability
        })
      )
    ];
    for (const packet of oldPackets) {
      expect(prompt).toContain(`${packet.system}\n\n${packet.user}`);
    }
  });
});
