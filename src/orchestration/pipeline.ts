import type { CognitiveTaskType, DomainState, PairState } from '../domain/states.js';

export const PAIR_TASK_SEQUENCE: readonly CognitiveTaskType[] = [
  'PAIR_BOUNDARY',
  'AP_FAILURE_MODEL',
  'APPLICABILITY',
  'PRIMARY_QUESTIONS',
  'ATOMIC_DECOMPOSITION',
  'EVIDENCE_ARCHITECTURE',
  'EVIDENCE_SAFETY',
  'SOURCE_MAPPING',
  'FINDING_ARCHITECTURE',
  'CONTROL_BOUNDARY',
  'REFERENCE_MAPPING',
  'PAIR_COHERENCE_REVIEW'
] as const;

export const pairTransitions: Record<PairState, readonly PairState[]> = {
  DRAFT: ['AUTHORING'],
  AUTHORING: ['VALIDATING', 'REPAIR_REQUIRED'],
  VALIDATING: ['VALIDATED', 'REPAIR_REQUIRED'],
  REPAIR_REQUIRED: ['AUTHORING', 'VALIDATING'],
  VALIDATED: []
};

export const domainTransitions: Record<DomainState, readonly DomainState[]> = {
  IN_PROGRESS: ['DOMAIN_VALIDATING'],
  DOMAIN_VALIDATING: ['READY_FOR_APPROVAL', 'REPAIR_REQUIRED'],
  REPAIR_REQUIRED: ['DOMAIN_VALIDATING'],
  READY_FOR_APPROVAL: ['APPROVED'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: []
};

export function canTransition<T extends string>(
  transitions: Record<T, readonly T[]>,
  from: T,
  to: T
): boolean {
  return transitions[from].includes(to);
}
