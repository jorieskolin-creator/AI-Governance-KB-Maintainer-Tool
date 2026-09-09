import type { CognitiveTaskType } from '../domain/states.js';
import type { CompletionValidatorRoute } from '../validation/task-completion-router.js';
import { PAIR_TASK_SEQUENCE } from './pipeline.js';

export type TaskExecutionKind = 'CODE' | 'MODEL_AUTHORING' | 'MODEL_CRITIC' | 'MODEL_REPAIR';

export type ConsolidationDecision = 'FORBIDDEN' | 'KEEP_SEPARATE';

export type PairSirTaskType = Exclude<
  CognitiveTaskType,
  'SOURCE_CONTEXT' | 'DOMAIN_COHERENCE_REVIEW' | 'LOCAL_REPAIR'
>;

export type SirV2ValidatorRoute = Exclude<CompletionValidatorRoute, 'LIFECYCLE_ASSURANCE' | 'LEGACY_COMPLETION'>;

export const CONSOLIDATION_MERGE_AUTHORIZED = false as const;

export const PAIR_SIR_TASK_COUNT = 14 as const;

export function isPairSirTask(taskType: CognitiveTaskType): taskType is PairSirTaskType {
  return taskType !== 'SOURCE_CONTEXT' && taskType !== 'DOMAIN_COHERENCE_REVIEW' && taskType !== 'LOCAL_REPAIR';
}

const PREFIX = (taskType: PairSirTaskType): readonly CognitiveTaskType[] =>
  PAIR_TASK_SEQUENCE.slice(0, PAIR_TASK_SEQUENCE.indexOf(taskType));

export const CONTRACT_UPSTREAM: { readonly [K in PairSirTaskType]: readonly CognitiveTaskType[] } = {
  PAIR_BOUNDARY: [],
  AP_FAILURE_MODEL: ['PAIR_BOUNDARY'],
  APPLICABILITY: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL'],
  PRIMARY_QUESTIONS: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY'],
  ATOMIC_DECOMPOSITION: ['PAIR_BOUNDARY', 'AP_FAILURE_MODEL', 'APPLICABILITY', 'PRIMARY_QUESTIONS'],
  EVIDENCE_ARCHITECTURE: [
    'PAIR_BOUNDARY',
    'AP_FAILURE_MODEL',
    'APPLICABILITY',
    'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION'
  ],
  EVIDENCE_SAFETY: [
    'PAIR_BOUNDARY',
    'AP_FAILURE_MODEL',
    'APPLICABILITY',
    'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION',
    'EVIDENCE_ARCHITECTURE'
  ],
  AP_ABSENCE_CONTRACT: [
    'PAIR_BOUNDARY',
    'AP_FAILURE_MODEL',
    'APPLICABILITY',
    'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION',
    'EVIDENCE_ARCHITECTURE',
    'EVIDENCE_SAFETY'
  ],
  SOURCE_MAPPING: [
    'PAIR_BOUNDARY',
    'AP_FAILURE_MODEL',
    'APPLICABILITY',
    'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION',
    'EVIDENCE_ARCHITECTURE',
    'EVIDENCE_SAFETY',
    'AP_ABSENCE_CONTRACT'
  ],
  FINDING_ARCHITECTURE: [
    'PAIR_BOUNDARY',
    'AP_FAILURE_MODEL',
    'APPLICABILITY',
    'PRIMARY_QUESTIONS',
    'ATOMIC_DECOMPOSITION',
    'EVIDENCE_ARCHITECTURE',
    'EVIDENCE_SAFETY',
    'AP_ABSENCE_CONTRACT',
    'SOURCE_MAPPING'
  ],
  CONTROL_BOUNDARY: [
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
  LIFECYCLE_ASSURANCE: [
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
  REFERENCE_MAPPING: ['PAIR_BOUNDARY', 'FINDING_ARCHITECTURE', 'LIFECYCLE_ASSURANCE'],
  PAIR_COHERENCE_REVIEW: [
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
    'CONTROL_BOUNDARY',
    'LIFECYCLE_ASSURANCE',
    'REFERENCE_MAPPING'
  ]
};

export const REFERENCE_MAPPING_CONTRACT_UPSTREAM_IS_RESOLVER_SUBSET = true as const;

export const SIR_V2_VALIDATOR_ROUTE: { readonly [K in PairSirTaskType]: SirV2ValidatorRoute } = {
  PAIR_BOUNDARY: 'SIR_INITIAL',
  AP_FAILURE_MODEL: 'SIR_INITIAL',
  APPLICABILITY: 'SIR_INITIAL',
  PRIMARY_QUESTIONS: 'SIR_INITIAL',
  ATOMIC_DECOMPOSITION: 'SIR_ATOMIC',
  EVIDENCE_ARCHITECTURE: 'SIR_EVIDENCE',
  EVIDENCE_SAFETY: 'SIR_EVIDENCE_SAFETY',
  AP_ABSENCE_CONTRACT: 'SIR_AP_ABSENCE',
  SOURCE_MAPPING: 'SIR_SOURCE_MAPPING',
  FINDING_ARCHITECTURE: 'SIR_FINDING',
  CONTROL_BOUNDARY: 'SIR_CONTROL',
  LIFECYCLE_ASSURANCE: 'SIR_LIFECYCLE',
  REFERENCE_MAPPING: 'SIR_REFERENCE_MAPPING',
  PAIR_COHERENCE_REVIEW: 'SIR_PAIR_COHERENCE'
};

export interface TaskBoundaryPolicy {
  taskType: CognitiveTaskType;
  executionKind: TaskExecutionKind;
  sirV2ValidatorRoute: SirV2ValidatorRoute | 'UNSUPPORTED_SIR_V2';
  contractUpstream: readonly CognitiveTaskType[];
  resolverLoadPrefix: readonly CognitiveTaskType[];
  extraRequirements: readonly string[];
  ownedConcern: string;
}

export const SOURCE_CONTEXT_POLICY: TaskBoundaryPolicy = {
  taskType: 'SOURCE_CONTEXT',
  executionKind: 'CODE',
  sirV2ValidatorRoute: 'UNSUPPORTED_SIR_V2',
  contractUpstream: [],
  resolverLoadPrefix: [],
  extraRequirements: ['SEALED_SOURCE_REGISTER', 'AUTHORING_PLAN'],
  ownedConcern: 'Governed source acquisition and sealed packet identity. Not a model SIR task.'
};

export const DOMAIN_COHERENCE_POLICY: TaskBoundaryPolicy = {
  taskType: 'DOMAIN_COHERENCE_REVIEW',
  executionKind: 'MODEL_CRITIC',
  sirV2ValidatorRoute: 'SIR_DOMAIN_COHERENCE',
  contractUpstream: [],
  resolverLoadPrefix: [],
  extraRequirements: ['FIVE_VALIDATED_PAIRS', 'DOMAIN_COHERENCE_PACKET'],
  ownedConcern: 'Independent five-pair domain critic. Returns defects only.'
};

export const LOCAL_REPAIR_POLICY: TaskBoundaryPolicy = {
  taskType: 'LOCAL_REPAIR',
  executionKind: 'MODEL_REPAIR',
  sirV2ValidatorRoute: 'UNSUPPORTED_SIR_V2',
  contractUpstream: [],
  resolverLoadPrefix: [],
  extraRequirements: ['VALIDATION_FINDING', 'ALLOWED_TARGET_PATHS'],
  ownedConcern: 'Path-scoped repair after deterministic localization. Not an authoring task.'
};

const PAIR_OWNED_CONCERN: { readonly [K in PairSirTaskType]: string } = {
  PAIR_BOUNDARY: 'Semantic ownership boundary of the capability and paired anti-pattern.',
  AP_FAILURE_MODEL: 'Anti-pattern failure mechanism and triggering conditions.',
  APPLICABILITY: 'Applicability and exclusion boundary for both objects.',
  PRIMARY_QUESTIONS: 'Wording of the three governed primary-question slots.',
  ATOMIC_DECOMPOSITION: 'Independently assessable subcriteria and tests. Does not create evidence IDs.',
  EVIDENCE_ARCHITECTURE: 'Evidence meaning and atomic bindings. Owns evidence objects, not safety rules.',
  EVIDENCE_SAFETY: 'Ceilings, false-positive guards, prohibited inferences, contradiction handling, freshness.',
  AP_ABSENCE_CONTRACT: 'Absence-test interpretation boundary. Silence must not become tested absence.',
  SOURCE_MAPPING: 'Claim-to-locator mapping using only the sealed Source Context Packet.',
  FINDING_ARCHITECTURE: 'Finding definitions, conclusion states, severity, and human-lock semantics.',
  CONTROL_BOUNDARY: 'Knowledge-level hard-gate and machine/human decision boundaries.',
  LIFECYCLE_ASSURANCE: 'Minimum technical and required human assurance per governed lifecycle stage.',
  REFERENCE_MAPPING: 'Related-criterion handle selection. Tactic mappings remain empty without an approved catalog.',
  PAIR_COHERENCE_REVIEW: 'Independent pair critic. Returns defects only; never replacement production content.'
};

function pairPolicy(taskType: PairSirTaskType): TaskBoundaryPolicy {
  const extraRequirements =
    taskType === 'SOURCE_MAPPING' ? (['SEALED_SOURCE_CONTEXT_PACKET'] as const) : ([] as const);
  return {
    taskType,
    executionKind: taskType === 'PAIR_COHERENCE_REVIEW' ? 'MODEL_CRITIC' : 'MODEL_AUTHORING',
    sirV2ValidatorRoute: SIR_V2_VALIDATOR_ROUTE[taskType],
    contractUpstream: CONTRACT_UPSTREAM[taskType],
    resolverLoadPrefix: PREFIX(taskType),
    extraRequirements,
    ownedConcern: PAIR_OWNED_CONCERN[taskType]
  };
}

export const PAIR_TASK_POLICIES: readonly TaskBoundaryPolicy[] = PAIR_TASK_SEQUENCE.map((taskType) => {
  if (!isPairSirTask(taskType)) {
    throw new Error(`PAIR_TASK_SEQUENCE contains non-model SIR task ${taskType}.`);
  }
  return pairPolicy(taskType);
});

export const ALL_TASK_POLICIES: readonly TaskBoundaryPolicy[] = [
  SOURCE_CONTEXT_POLICY,
  ...PAIR_TASK_POLICIES,
  DOMAIN_COHERENCE_POLICY,
  LOCAL_REPAIR_POLICY
];

export function taskBoundaryPolicy(taskType: CognitiveTaskType): TaskBoundaryPolicy {
  const match = ALL_TASK_POLICIES.find((policy) => policy.taskType === taskType);
  if (!match) throw new Error(`No task-boundary policy for ${taskType}.`);
  return match;
}

export function resolverLoadPrefix(taskType: CognitiveTaskType): readonly CognitiveTaskType[] {
  return taskBoundaryPolicy(taskType).resolverLoadPrefix;
}

function pairKey(left: CognitiveTaskType, right: CognitiveTaskType): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

const EXPLICIT_FORBIDDEN_PAIRS: ReadonlyArray<readonly [CognitiveTaskType, CognitiveTaskType]> = [
  ['EVIDENCE_ARCHITECTURE', 'EVIDENCE_SAFETY'],
  ['ATOMIC_DECOMPOSITION', 'EVIDENCE_ARCHITECTURE'],
  ['AP_ABSENCE_CONTRACT', 'EVIDENCE_ARCHITECTURE'],
  ['AP_ABSENCE_CONTRACT', 'EVIDENCE_SAFETY'],
  ['SOURCE_MAPPING', 'REFERENCE_MAPPING'],
  ['FINDING_ARCHITECTURE', 'CONTROL_BOUNDARY'],
  ['CONTROL_BOUNDARY', 'LIFECYCLE_ASSURANCE'],
  ['PAIR_COHERENCE_REVIEW', 'DOMAIN_COHERENCE_REVIEW']
];

function authoringTasks(): readonly CognitiveTaskType[] {
  return ALL_TASK_POLICIES.filter((policy) => policy.executionKind === 'MODEL_AUTHORING').map(
    (policy) => policy.taskType
  );
}

function criticTasks(): readonly CognitiveTaskType[] {
  return ALL_TASK_POLICIES.filter((policy) => policy.executionKind === 'MODEL_CRITIC').map(
    (policy) => policy.taskType
  );
}

function repairTasks(): readonly CognitiveTaskType[] {
  return ALL_TASK_POLICIES.filter((policy) => policy.executionKind === 'MODEL_REPAIR').map(
    (policy) => policy.taskType
  );
}

function modelTasks(): readonly CognitiveTaskType[] {
  return ALL_TASK_POLICIES.filter((policy) => policy.executionKind !== 'CODE').map((policy) => policy.taskType);
}

function collectForbiddenKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const [left, right] of EXPLICIT_FORBIDDEN_PAIRS) keys.add(pairKey(left, right));
  for (const taskType of modelTasks()) keys.add(pairKey('SOURCE_CONTEXT', taskType));
  for (const taskType of authoringTasks()) {
    if (taskType !== 'SOURCE_MAPPING') keys.add(pairKey('SOURCE_MAPPING', taskType));
  }
  for (const authoring of authoringTasks()) {
    for (const critic of criticTasks()) keys.add(pairKey(authoring, critic));
    for (const repair of repairTasks()) keys.add(pairKey(authoring, repair));
  }
  for (const critic of criticTasks()) {
    for (const repair of repairTasks()) keys.add(pairKey(critic, repair));
  }
  return keys;
}

export const FORBIDDEN_CONSOLIDATION_KEYS = collectForbiddenKeys();

export const MEASURE_ONLY_CANDIDATE = {
  left: 'PRIMARY_QUESTIONS',
  right: 'ATOMIC_DECOMPOSITION',
  requiresIndependentValidators: true,
  independentValidatorRoutes: ['SIR_INITIAL', 'SIR_ATOMIC'] as const,
  defaultDecision: 'KEEP_SEPARATE' as const
} as const;

export function isForbiddenConsolidation(left: CognitiveTaskType, right: CognitiveTaskType): boolean {
  if (left === right) return false;
  return FORBIDDEN_CONSOLIDATION_KEYS.has(pairKey(left, right));
}

export function isMeasureOnlyCandidate(left: CognitiveTaskType, right: CognitiveTaskType): boolean {
  return pairKey(left, right) === pairKey(MEASURE_ONLY_CANDIDATE.left, MEASURE_ONLY_CANDIDATE.right);
}

export function independentValidatorsForCandidate(
  left: CognitiveTaskType,
  right: CognitiveTaskType
): readonly CompletionValidatorRoute[] {
  if (!isMeasureOnlyCandidate(left, right)) return [];
  return MEASURE_ONLY_CANDIDATE.independentValidatorRoutes;
}

export const FORBIDDEN_MERGE_SUMMARY = [
  'source acquisition into authoring',
  'QC into authoring',
  'QC into local repair',
  'SOURCE_MAPPING with other authoring',
  'SOURCE_MAPPING with REFERENCE_MAPPING',
  'EVIDENCE_ARCHITECTURE with EVIDENCE_SAFETY',
  'ATOMIC_DECOMPOSITION with EVIDENCE_ARCHITECTURE',
  'AP_ABSENCE_CONTRACT with evidence tasks',
  'FINDING_ARCHITECTURE with CONTROL_BOUNDARY',
  'CONTROL_BOUNDARY with LIFECYCLE_ASSURANCE'
] as const;

export interface OperatorTaskBoundarySummary {
  pairSirTaskCount: typeof PAIR_SIR_TASK_COUNT;
  sourceContextIsModelTask: false;
  consolidationPolicy: 'KEEP_SEPARATE_UNTIL_MEASURED';
  mergeAuthorized: false;
  measureOnlyCandidate: 'PRIMARY_QUESTIONS+ATOMIC_DECOMPOSITION';
  measureOnlyDefault: 'KEEP_SEPARATE';
  independentValidatorsRequired: true;
  forbiddenMergeSummary: typeof FORBIDDEN_MERGE_SUMMARY;
}

export function operatorTaskBoundarySummary(): OperatorTaskBoundarySummary {
  return {
    pairSirTaskCount: PAIR_SIR_TASK_COUNT,
    sourceContextIsModelTask: false,
    consolidationPolicy: 'KEEP_SEPARATE_UNTIL_MEASURED',
    mergeAuthorized: CONSOLIDATION_MERGE_AUTHORIZED,
    measureOnlyCandidate: 'PRIMARY_QUESTIONS+ATOMIC_DECOMPOSITION',
    measureOnlyDefault: 'KEEP_SEPARATE',
    independentValidatorsRequired: true,
    forbiddenMergeSummary: FORBIDDEN_MERGE_SUMMARY
  };
}

export function operatorTaskBoundaryWording(): string {
  return `${String(PAIR_SIR_TASK_COUNT)} model SIR tasks remain separate. Source Context is code-owned and is not a model authoring step. Consolidation stays KEEP_SEPARATE_UNTIL_MEASURED. Merge is closed. Forbidden consolidations include source acquisition into authoring, QC into authoring, SOURCE_MAPPING with other authoring, Evidence Architecture with Evidence Safety, and Finding Architecture with Control Boundary. PRIMARY_QUESTIONS and ATOMIC_DECOMPOSITION may be measured only; both validators still run independently.`;
}
