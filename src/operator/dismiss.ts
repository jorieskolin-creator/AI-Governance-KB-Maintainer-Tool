import type { CommandFlag } from './eligibility.js';

export const PARKED_ACTION = 'PARKED_FOR_LATER_REVIEW';
export const DEFERRED_FINDING_KIND = 'DEFERRED_QC';

export function dismissAvailability(input: {
  blockingDefectCount: number;
  localRepairCompleted: boolean;
  pairState: string;
  taskInFlight: boolean;
}): CommandFlag {
  if (input.taskInFlight) {
    return { enabled: false, reason: 'A SIR task is already running.' };
  }
  if (input.pairState === 'VALIDATED') {
    return { enabled: false, reason: 'This pair is already VALIDATED.' };
  }
  if (input.pairState === 'DEFERRED') {
    return { enabled: false, reason: 'HIGH blockers for this pair are already parked for later review.' };
  }
  if (input.blockingDefectCount <= 0) {
    return { enabled: false, reason: 'No HIGH blockers to park.' };
  }
  if (!input.localRepairCompleted) {
    return {
      enabled: false,
      reason: 'Park is available after one repair loop on this pair. Schema and IDs stay code-owned.'
    };
  }
  return {
    enabled: true,
    reason:
      'Park HIGH blockers for later review, then continue remaining pairs. Items stay retrievable. Schema and IDs cannot be edited here.'
  };
}
