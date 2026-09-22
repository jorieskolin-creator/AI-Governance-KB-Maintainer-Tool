import { describe, expect, it } from 'vitest';
import { buildEvidenceAndSafetyPrompt, validateEvidenceAndSafety } from '../../src/pipeline/evidence-and-safety.js';
import type { PipelinePlan } from '../../src/pipeline/prompt.js';

const plan = {
  planId: 'A1_AP-A1:authoring-plan:1.0.0',
  planSha256: 'ab'.repeat(32),
  identity: { pairId: 'A1_AP-A1', capabilityId: 'A1', antipatternId: 'AP-A1', domain: 'A' },
  adjacentCriteria: [],
  fixedQuestionSlots: [{ slot: 1, dimension: 'DEFINITION_AND_INTENT' }],
  vocabulary: {
    technicalAssurance: ['DECLARED'],
    humanAssurance: ['HUMAN_VALIDATED'],
    capabilityConclusionStates: ['SATISFIED'],
    antipatternConclusionStates: ['UNKNOWN'],
    hardGateEffects: ['NONE'],
    lifecycleStages: ['DEPLOYMENT']
  },
  baseline: {
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    sourceRegisterVersion: '1.5.0',
    sourceRegisterSha256: 'cd'.repeat(32)
  },
  tacticUniverse: []
} as PipelinePlan;

function evidenceItem() {
  return {
    title: 'Purpose statement',
    claimSupported: 'The intended purpose is specific and bounded.',
    evidenceClass: 'DOCUMENT',
    minimumTechnicalAssurance: 'DECLARED',
    requiredHumanAssurance: 'HUMAN_VALIDATED',
    acceptanceConditions: ['The statement names the decision.'],
    limitations: ['A statement does not prove operation.'],
    supportsAtomicHandles: ['atomic_001']
  };
}

function rules() {
  return {
    evidenceCeilings: ['A document does not prove operational effectiveness.'],
    falsePositiveGuards: ['Do not treat a draft purpose as approved.'],
    prohibitedInferences: ['Do not infer legal compliance from a purpose statement.'],
    contradictionHandling: ['Record conflicting purpose statements as contradictions.'],
    freshnessRules: ['Reassess when the user population changes.']
  };
}

function valid() {
  const slot = (questionSlot: 1 | 2 | 3) => ({
    questionSlot,
    criterion: `Capability criterion for slot ${String(questionSlot)}.`,
    evidenceNeed: `Evidence need for slot ${String(questionSlot)}.`
  });
  const test = (questionSlot: 1 | 2 | 3) => ({
    questionSlot,
    test: `Anti-pattern test for slot ${String(questionSlot)}.`,
    evidenceNeed: `Evidence need for anti-pattern slot ${String(questionSlot)}.`
  });
  return {
    atomicDecomposition: {
      capabilitySubcriteria: [slot(1), slot(2), slot(3)],
      antipatternTests: [test(1), test(2), test(3)],
      coverageNotes: ['Every governed slot has an atomic item.']
    },
    evidenceArchitecture: {
      capabilityEvidence: [evidenceItem()],
      antipatternEvidence: [evidenceItem()],
      sufficiencyNotes: []
    },
    evidenceSafety: {
      capabilityRules: rules(),
      antipatternRules: rules(),
      crossPairSafetyNotes: []
    },
    apAbsenceContract: {
      requiredArtifacts: ['An executed absence test with a defined scope.'],
      interpretationBoundary: 'Absence is not inferred from missing complaints.'
    }
  };
}

describe('evidence and safety contract', () => {
  it('rejects an evidence item that supports no atomic handle', () => {
    const broken = valid();
    broken.evidenceArchitecture.capabilityEvidence[0]?.supportsAtomicHandles.splice(0, 1);
    const result = validateEvidenceAndSafety(broken, 'RELEASE');
    expect(result.ok).toBe(false);
    expect(result.findings.some((item) => item.path.includes('supportsAtomicHandles') && item.code === 'MINITEMS')).toBe(
      true
    );
  });

  it('warns when a primary-question slot is uncovered in DRAFT and fails that contract in RELEASE', () => {
    const broken = valid();
    broken.atomicDecomposition.capabilitySubcriteria = broken.atomicDecomposition.capabilitySubcriteria.filter(
      (item) => item.questionSlot !== 3
    );
    const draft = validateEvidenceAndSafety(broken, 'DRAFT');
    expect(draft.ok).toBe(true);
    expect(draft.warnings.some((item) => item.code === 'EVERY_PRIMARY_QUESTION_SLOT_COVERED')).toBe(true);
    const release = validateEvidenceAndSafety(broken, 'RELEASE');
    expect(release.ok).toBe(false);
    expect(release.findings.some((item) => item.code === 'EVERY_PRIMARY_QUESTION_SLOT_COVERED')).toBe(true);
  });

  it('renders a byte-stable prompt', () => {
    const seed = {
      plan,
      categoryBaseline: { title: 'A' },
      goldenReference: { reference_id: 'A1_AP-A1' },
      pairBoundary: { boundaryRationale: 'bounded' },
      apFailureModel: { failureMechanism: 'mechanism' },
      applicability: { consistencyNotes: [] },
      primaryQuestions: { coverageRationale: 'covered' },
      atomics: { capability: [], antipattern: [] },
      evidence: { capability: [], antipattern: [] },
      evidenceSafety: { capabilityRules: rules(), antipatternRules: rules() }
    };
    expect(buildEvidenceAndSafetyPrompt(seed)).toBe(buildEvidenceAndSafetyPrompt(seed));
    expect(buildEvidenceAndSafetyPrompt(seed)).toContain('ATOMIC_DECOMPOSITION');
    expect(buildEvidenceAndSafetyPrompt(seed)).toContain('AP_ABSENCE_CONTRACT');
  });
});
