import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import type { SirApAbsenceOutput } from './sir-ap-absence-contract.js';
import type { SirEvidenceSafetyOutput } from './sir-evidence-safety-contract.js';
import type { SirPairBoundaryOutput } from './sir-initial-contracts.js';

export type SirHardGateEffect = 'NONE' | 'WARN' | 'BLOCK' | 'CONSTRAIN';

export interface SirHardGateContent {
  effect: SirHardGateEffect;
  conditions: string[];
  overrideAuthority: string | null;
}

export interface SirRuntimeBoundaryContent {
  machineMay: string[];
  machineMustNot: string[];
  humanAuthorityRequiredFor: string[];
}

export interface SirControlBoundaryOutput {
  capabilityHardGate: SirHardGateContent;
  antipatternHardGate: SirHardGateContent;
  capabilityRuntimeBoundary: SirRuntimeBoundaryContent;
  antipatternRuntimeBoundary: SirRuntimeBoundaryContent;
  controlNotes: string[];
}

export interface SirControlBoundarySeed {
  authoringPlan: AuthoringPlan;
  pairBoundary: SirPairBoundaryOutput;
  evidenceSafety: SirEvidenceSafetyOutput;
  apAbsence: SirApAbsenceOutput;
  findings: MaterializedSirFindings;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function buildSirControlBoundaryContract(
  seed: SirControlBoundarySeed
): TaskContract<SirControlBoundaryOutput> {
  return {
    contractVersion: '2.0.0',
    taskId: `${seed.authoringPlan.identity.pairId}:CONTROL_BOUNDARY:SIR`,
    taskType: 'CONTROL_BOUNDARY',
    targetObjectId: seed.authoringPlan.identity.pairId,
    objective:
      'Define only knowledge-level hard-gate semantics and machine/human decision boundaries for the validated capability and anti-pattern findings. Preserve all upstream findings. Use only the governed hard-gate vocabulary. State what machine reasoning may support, what it must never decide, and which decisions require human authority. Do not authorize any real-system lifecycle transition or approval.',
    modelRole: 'REASONER',
    upstreamTaskTypes: [
      'PAIR_BOUNDARY',
      'AP_FAILURE_MODEL',
      'APPLICABILITY',
      'PRIMARY_QUESTIONS',
      'ATOMIC_DECOMPOSITION',
      'EVIDENCE_ARCHITECTURE',
      'EVIDENCE_SAFETY',
      'AP_ABSENCE_CONTRACT',
      'SOURCE_MAPPING',
      'FINDING_ARCHITECTURE'
    ],
    lockedInputs: {
      authoring_plan_id: seed.authoringPlan.planId,
      authoring_plan_sha256: seed.authoringPlan.planSha256,
      governed_hard_gate_effects: seed.authoringPlan.vocabulary.hardGateEffects,
      pair_boundary: seed.pairBoundary,
      capability_findings: seed.findings.capability,
      antipattern_findings: seed.findings.antipattern,
      finding_logic_notes: seed.findings.findingLogicNotes,
      capability_evidence_safety: seed.evidenceSafety.capabilityRules,
      antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
      ap_absence_contract: seed.apAbsence,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference
    },
    allowedReferences: [
      'AUTHORING_PLAN',
      'VALIDATED_PAIR_BOUNDARY',
      'VERIFIED_MATERIALIZED_FINDINGS',
      'VALIDATED_SIR_EVIDENCE_SAFETY',
      'VALIDATED_SIR_AP_ABSENCE',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE'
    ],
    doNot: [
      'Do not create or return capability IDs, anti-pattern IDs, finding IDs or finding handles.',
      'Do not rewrite, merge, remove or reinterpret validated findings.',
      'Do not create new findings, evidence requirements, source mappings, tactic mappings or related criteria.',
      'Do not define lifecycle assurance targets or lifecycle-stage requirements; LIFECYCLE_ASSURANCE owns those semantics.',
      'Do not grant legal compliance, residual-risk acceptance, approval, exception approval, deployment authorization, continued-operation authorization or retirement authorization to a model.',
      'Do not permit machine reasoning to override a human-locked finding or a deterministic gate.',
      'Do not treat source registration, document presence or missing incidents as control satisfaction.',
      'Do not infer TESTED_ABSENT outside the validated AP absence contract.',
      'Do not copy hard-gate effect choices from the Golden reference without category-specific justification.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirControlBoundaryOutput',
      requiredFields: [
        'capabilityHardGate',
        'antipatternHardGate',
        'capabilityRuntimeBoundary',
        'antipatternRuntimeBoundary',
        'controlNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'SIR_CONTENT_ONLY',
      'HARD_GATE_EFFECT_FROM_AUTHORING_PLAN',
      'RUNTIME_BOUNDARY_FAMILIES_NONEMPTY',
      'RUNTIME_BOUNDARY_ENTRIES_UNIQUE',
      'NO_EXACT_MACHINE_MAY_MUST_NOT_CONTRADICTION',
      'NO_EXACT_MACHINE_MAY_HUMAN_AUTHORITY_CONTRADICTION',
      'NO_MODEL_OWNED_CANONICAL_IDENTITY',
      'NO_LIFECYCLE_ASSURANCE_CONTENT',
      'NO_UPSTREAM_FINDING_REWRITE'
    ],
    dependencyPaths: [
      'sir.capability.hardGate',
      'sir.capability.runtimeBoundary',
      'sir.antipattern.hardGate',
      'sir.antipattern.runtimeBoundary'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}
