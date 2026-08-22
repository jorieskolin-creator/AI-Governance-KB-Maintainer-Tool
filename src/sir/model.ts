export type SirObjectKind = 'CAPABILITY' | 'ANTIPATTERN';

export type SirHandleKind =
  | 'question'
  | 'atomic'
  | 'evidence'
  | 'finding'
  | 'source'
  | 'locator'
  | 'tactic'
  | 'criterion';

export type SirHandle = `${SirHandleKind}_${string}`;

export interface SirQuestion {
  slot: 1 | 2 | 3;
  question: string;
}

export interface SirAtomicItem {
  handle: SirHandle;
  questionSlot: 1 | 2 | 3;
  statement: string;
  evidenceNeed: string;
}

export interface SirEvidenceItem {
  handle: SirHandle;
  title: string;
  claimSupported: string;
  evidenceClass: string;
  minimumTechnicalAssurance: string;
  requiredHumanAssurance: string;
  acceptanceConditions: string[];
  limitations: string[];
  supportsAtomicHandles: SirHandle[];
}

export interface SirFinding {
  handle: SirHandle;
  title: string;
  eligibleConclusionStates: string[];
  atomicHandles: SirHandle[];
  evidenceHandles: SirHandle[];
  defaultSeverity: string;
  lifecycleConsequence: string;
  humanLockRequired: boolean;
}

export interface SirSourceInterpretation {
  sourceHandle: SirHandle;
  locatorHandle: SirHandle;
  relationship: string;
  supportedClaim: string;
  categoryRationale: string;
  applicabilityConditions: string[];
  exclusions: string[];
}

export interface SirTacticSelection {
  tacticHandle: SirHandle;
  findingHandle: SirHandle;
}

export interface SirRelatedCriterionSelection {
  criterionHandle: SirHandle;
}

export interface SirEvidenceRules {
  evidenceCeilings: string[];
  falsePositiveGuards: string[];
  prohibitedInferences: string[];
  contradictionHandling: string[];
  freshnessRules: string[];
}

export interface SirRuntimeBoundary {
  machineMay: string[];
  machineMustNot: string[];
  humanAuthorityRequiredFor: string[];
}

export interface SirLifecycleTarget {
  lifecycleStage: string;
  minimumTechnicalAssurance: string;
  requiredHumanAssurance: string;
}

export interface CapabilitySir {
  sirVersion: '1.0.0';
  objectKind: 'CAPABILITY';
  canonicalDefinition: string;
  governancePurpose: string;
  distinctClaim: string;
  applicability: {
    statement: string;
    conditions: string[];
    exclusions: string[];
    reassessmentTriggers: string[];
  };
  questions: [SirQuestion, SirQuestion, SirQuestion];
  atomics: SirAtomicItem[];
  evidence: SirEvidenceItem[];
  evidenceRules: SirEvidenceRules;
  findings: SirFinding[];
  sources: SirSourceInterpretation[];
  tactics: SirTacticSelection[];
  relatedCriteria: SirRelatedCriterionSelection[];
  hardGate: {
    effect: string;
    conditions: string[];
    overrideAuthority: string | null;
  };
  runtimeBoundary: SirRuntimeBoundary;
  lifecycleTargets: SirLifecycleTarget[];
}

export interface AntipatternSir {
  sirVersion: '1.0.0';
  objectKind: 'ANTIPATTERN';
  canonicalDefinition: string;
  failureMechanism: string;
  applicability: {
    statement: string;
    conditions: string[];
    exclusions: string[];
    reassessmentTriggers: string[];
  };
  questions: [SirQuestion, SirQuestion, SirQuestion];
  atomics: SirAtomicItem[];
  evidence: SirEvidenceItem[];
  evidenceRules: SirEvidenceRules;
  absenceTest: {
    requiredArtifacts: string[];
    interpretationBoundary: string;
  };
  findings: SirFinding[];
  sources: SirSourceInterpretation[];
  tactics: SirTacticSelection[];
  relatedCriteria: SirRelatedCriterionSelection[];
  hardGate: {
    effect: string;
    conditions: string[];
    overrideAuthority: string | null;
  };
  runtimeBoundary: SirRuntimeBoundary;
  lifecycleTargets: SirLifecycleTarget[];
}

export interface PairSir {
  sirVersion: '1.0.0';
  pairId: string;
  authoringPlanSha256: string;
  capability: CapabilitySir;
  antipattern: AntipatternSir;
}
