import type { TaskContract } from '../domain/task-contract.js';
import type { PairBoundaryOutput } from './initial-contracts.js';
import type { FindingArchitectureOutput, ControlBoundaryOutput } from './final-pair-contracts.js';

export type LifecycleStage =
  | 'QUALIFICATION_AND_REGISTRATION'
  | 'DESIGN_AND_DEVELOPMENT'
  | 'VERIFICATION_AND_VALIDATION'
  | 'DEPLOYMENT'
  | 'OPERATION_AND_MONITORING'
  | 'REVIEW_AND_EVALUATION'
  | 'RETIREMENT';

export const LIFECYCLE_STAGE_VOCABULARY: readonly LifecycleStage[] = [
  'QUALIFICATION_AND_REGISTRATION',
  'DESIGN_AND_DEVELOPMENT',
  'VERIFICATION_AND_VALIDATION',
  'DEPLOYMENT',
  'OPERATION_AND_MONITORING',
  'REVIEW_AND_EVALUATION',
  'RETIREMENT'
] as const;

export type TechnicalAssurance =
  | 'UNKNOWN'
  | 'DECLARED'
  | 'IMPLEMENTED'
  | 'TESTED'
  | 'OPERATIONALLY_OBSERVED';

export type HumanAssurance = 'PENDING' | 'HUMAN_VALIDATED' | 'FORMALLY_APPROVED';

export interface LifecycleAssuranceTarget {
  lifecycleStage: LifecycleStage;
  minimumTechnicalAssurance: TechnicalAssurance;
  requiredHumanAssurance: HumanAssurance;
}

export interface LifecycleAssuranceOutput {
  capabilityId: string;
  antipatternId: string;
  capabilityTargets: LifecycleAssuranceTarget[];
  antipatternTargets: LifecycleAssuranceTarget[];
  rationaleNotes: string[];
}

export interface LifecycleAssuranceSeed {
  pairBoundary: PairBoundaryOutput;
  findingArchitecture: FindingArchitectureOutput;
  controlBoundary: ControlBoundaryOutput;
  /**
   * Required lifecycle coverage is supplied by the normative baseline/policy.
   * It is never inferred merely from the A1/AP-A1 reference fixture.
   */
  requiredLifecycleStages: LifecycleStage[];
  goldenReferenceLifecycleExample?: Record<string, unknown>;
}

function assertRequiredLifecycleStages(stages: LifecycleStage[]): void {
  if (stages.length === 0) {
    throw new Error('Normative lifecycle policy must provide at least one required lifecycle stage.');
  }
  const allowed = new Set(LIFECYCLE_STAGE_VOCABULARY);
  const unique = new Set(stages);
  if (unique.size !== stages.length) {
    throw new Error('Normative lifecycle policy contains duplicate lifecycle stages.');
  }
  for (const stage of stages) {
    if (!allowed.has(stage)) throw new Error(`Unknown lifecycle stage ${stage}.`);
  }
}

export function buildLifecycleAssuranceContract(
  seed: LifecycleAssuranceSeed
): TaskContract<LifecycleAssuranceOutput> {
  assertRequiredLifecycleStages(seed.requiredLifecycleStages);

  return {
    contractVersion: '1.1.0',
    taskId: `${seed.pairBoundary.pairId}:LIFECYCLE_ASSURANCE`,
    taskType: 'LIFECYCLE_ASSURANCE',
    targetObjectId: seed.pairBoundary.pairId,
    objective:
      'Define the knowledge-level target technical and human assurance for the lifecycle stages required by the active normative baseline for both the capability and paired anti-pattern. These values describe assessment-content expectations only; they do not authorize or manage lifecycle transitions.',
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
      'FINDING_ARCHITECTURE',
      'CONTROL_BOUNDARY'
    ],
    lockedInputs: {
      pair_boundary: seed.pairBoundary,
      finding_architecture: seed.findingArchitecture,
      control_boundary: seed.controlBoundary,
      required_lifecycle_stages: seed.requiredLifecycleStages,
      golden_reference_lifecycle_example: seed.goldenReferenceLifecycleExample ?? null
    },
    allowedReferences: [
      'VALIDATED_PAIR_BOUNDARY',
      'VALIDATED_FINDINGS',
      'VALIDATED_CONTROL_BOUNDARY',
      'NORMATIVE_LIFECYCLE_POLICY',
      'GOLDEN_REFERENCE_AS_EXAMPLE_ONLY'
    ],
    doNot: [
      'Do not add, remove, rename or reorder lifecycle stages relative to the supplied normative required_lifecycle_stages list.',
      'Do not infer mandatory lifecycle coverage or assurance values merely from the A1/AP-A1 reference example.',
      'Do not authorize a lifecycle transition, deployment, continued operation, retirement or exception.',
      'Do not treat these targets as evidence that a real system has achieved the stated assurance.',
      'Do not raise assurance beyond what the pair evidence architecture and control boundary can support.',
      'Do not rewrite findings, gates, evidence, applicability, sources or tactic references.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'LifecycleAssuranceOutput',
      requiredFields: [
        'capabilityId',
        'antipatternId',
        'capabilityTargets',
        'antipatternTargets',
        'rationaleNotes'
      ],
      additionalProperties: false
    },
    validationProfile: [
      'IDS_MATCH',
      'NORMATIVE_LIFECYCLE_STAGE_COVERAGE_EXACT',
      'NORMATIVE_LIFECYCLE_STAGE_ORDER_EXACT',
      'ASSURANCE_VALUES_ALLOWED',
      'NO_LIFECYCLE_AUTHORIZATION_INFERENCE'
    ],
    dependencyPaths: [
      'capability.target_assurance_by_lifecycle_stage',
      'antipattern.target_assurance_by_lifecycle_stage'
    ],
    failureMode: 'FAIL_CLOSED'
  };
}
