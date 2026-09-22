import { describe, expect, it } from 'vitest';
import { buildMappingsPrompt, validateMappings } from '../../src/pipeline/mappings.js';
import type { PipelinePlan } from '../../src/pipeline/prompt.js';

const plan = {
  planId: 'A1_AP-A1:authoring-plan:1.0.0',
  planSha256: 'ab'.repeat(32),
  identity: { pairId: 'A1_AP-A1', capabilityId: 'A1', antipatternId: 'AP-A1', domain: 'A' },
  adjacentCriteria: [{ criterionHandle: 'criterion_002', boundarySummary: 'Suitability stays distinct.' }],
  fixedQuestionSlots: [],
  vocabulary: {
    technicalAssurance: ['DECLARED'],
    humanAssurance: ['PENDING'],
    capabilityConclusionStates: ['SATISFIED', 'UNKNOWN'],
    antipatternConclusionStates: ['UNKNOWN', 'TESTED_ABSENT'],
    hardGateEffects: ['NONE', 'BLOCK'],
    lifecycleStages: ['DEPLOYMENT', 'OPERATION_AND_MONITORING']
  },
  baseline: {
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: 'cd'.repeat(32)
  },
  tacticUniverse: []
} as PipelinePlan;

function target() {
  return { minimumTechnicalAssurance: 'DECLARED', requiredHumanAssurance: 'PENDING' };
}

function valid() {
  return {
    sourceMapping: {
      capabilityMappings: [],
      antipatternMappings: [],
      unmappedClaims: [
        {
          objectKind: 'CAPABILITY',
          claim: 'The purpose boundary has no sealed locator yet.',
          reason: 'INSUFFICIENT_SOURCE_CONTEXT',
          consideredSourceHandles: ['source_001']
        }
      ],
      mappingNotes: []
    },
    findingArchitecture: {
      capabilityFindings: [
        {
          title: 'Purpose boundary is not evidenced.',
          eligibleConclusionStates: ['UNKNOWN'],
          atomicHandles: ['atomic_001'],
          evidenceHandles: ['evidence_001'],
          defaultSeverity: 'HIGH',
          lifecycleConsequence: 'Deployment stays blocked until purpose evidence exists.',
          humanLockRequired: true
        }
      ],
      antipatternFindings: [
        {
          title: 'Purpose theatre is not ruled out.',
          eligibleConclusionStates: ['UNKNOWN'],
          atomicHandles: ['atomic_001'],
          evidenceHandles: ['evidence_001'],
          defaultSeverity: 'HIGH',
          lifecycleConsequence: 'Operation cannot treat silence as absence.',
          humanLockRequired: true
        }
      ],
      findingLogicNotes: []
    },
    controlBoundary: {
      capabilityHardGate: { effect: 'BLOCK', conditions: ['Purpose evidence is missing.'], overrideAuthority: null },
      antipatternHardGate: { effect: 'WARN', conditions: ['Absence was not tested.'], overrideAuthority: null },
      capabilityRuntimeBoundary: {
        machineMay: ['Summarize the declared purpose.'],
        machineMustNot: ['Authorize deployment.'],
        humanAuthorityRequiredFor: ['Accept a purpose change.']
      },
      antipatternRuntimeBoundary: {
        machineMay: ['List contradictory purpose statements.'],
        machineMustNot: ['Declare the anti-pattern absent.'],
        humanAuthorityRequiredFor: ['Lock an absence conclusion.']
      },
      controlNotes: []
    },
    lifecycleAssurance: {
      capabilityTargets: [target(), target()],
      antipatternTargets: [target(), target()],
      rationaleNotes: []
    },
    referenceMapping: {
      capabilityRelatedCriterionHandles: ['criterion_002'],
      antipatternRelatedCriterionHandles: [],
      referenceNotes: []
    }
  };
}

describe('mappings contract', () => {
  it('rejects an invented unmapped-claim reason', () => {
    const broken = valid();
    broken.sourceMapping.unmappedClaims[0]!.reason = 'GUESSED_LOCATOR';
    const result = validateMappings(broken, 'RELEASE');
    expect(result.ok).toBe(false);
    expect(result.findings.some((item) => item.path.includes('/reason'))).toBe(true);
  });

  it('warns on unequal lifecycle target counts in DRAFT and fails them in RELEASE', () => {
    const broken = valid();
    broken.lifecycleAssurance.antipatternTargets = [target()];
    const draft = validateMappings(broken, 'DRAFT');
    expect(draft.ok).toBe(true);
    expect(draft.warnings.some((item) => item.code === 'TARGET_COUNT_EQUALS_GOVERNED_LIFECYCLE_STAGE_COUNT')).toBe(
      true
    );
    const release = validateMappings(broken, 'RELEASE');
    expect(release.ok).toBe(false);
    expect(release.findings.some((item) => item.code === 'TARGET_COUNT_EQUALS_GOVERNED_LIFECYCLE_STAGE_COUNT')).toBe(
      true
    );
  });

  it('renders a byte-stable prompt and refuses a sealed tactic catalog', () => {
    const seed = {
      plan,
      categoryBaseline: {},
      goldenReference: {},
      pairBoundary: {},
      apFailureModel: {},
      applicability: {},
      primaryQuestions: {},
      atomics: { capability: [], antipattern: [] },
      evidence: { capability: [{ handle: 'evidence_001' }], antipattern: [] },
      evidenceSafety: { capabilityRules: {}, antipatternRules: {} },
      apAbsence: {},
      sourceContextPacket: { packetSha256: 'ef'.repeat(32) },
      sourceMappings: {},
      findings: { capability: [], antipattern: [], findingLogicNotes: [] },
      controlBoundary: {}
    };
    expect(buildMappingsPrompt(seed)).toBe(buildMappingsPrompt(seed));
    expect(buildMappingsPrompt(seed)).toContain('NO_APPROVED_TACTIC_AVAILABLE');
    expect(() =>
      buildMappingsPrompt({
        ...seed,
        plan: { ...plan, tacticUniverse: [{ tacticHandle: 'tactic_001' }] }
      })
    ).toThrow(/tactic-mapping packet/);
  });
});
