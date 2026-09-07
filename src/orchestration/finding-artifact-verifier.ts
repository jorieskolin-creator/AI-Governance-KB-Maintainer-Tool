import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { SirEvidenceItem } from '../sir/model.js';

interface MaterializedFindingLike {
  handle?: unknown;
  id?: unknown;
  findingId?: unknown;
  finding_id?: unknown;
  title?: unknown;
  eligibleConclusionStates?: unknown;
  atomicHandles?: unknown;
  evidenceHandles?: unknown;
  defaultSeverity?: unknown;
  lifecycleConsequence?: unknown;
  humanLockRequired?: unknown;
}

interface MaterializedFindingsLike {
  capability?: unknown;
  antipattern?: unknown;
  findingLogicNotes?: unknown;
}

function nonEmptyString(value: unknown, label: string, minLength = 1): string {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new Error(`${label} must be a non-empty string with minimum length ${minLength}.`);
  }
  return value;
}

function stringArray(value: unknown, label: string, minItems = 1): string[] {
  if (!Array.isArray(value) || value.length < minItems || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value as string[];
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
}

function sameOrderedStrings(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left) && left.length === right.length && left.every((item, index) => item === right[index]);
}

function verifyGroup(input: {
  value: unknown;
  label: 'capability' | 'antipattern';
  atomics: Array<{ handle: string }>;
  evidence: SirEvidenceItem[];
  allowedConclusionStates: readonly string[];
  absenceContract: { requiredArtifacts?: unknown; interpretationBoundary?: unknown } | undefined;
}): void {
  if (!Array.isArray(input.value) || input.value.length === 0) {
    throw new Error(`Materialized Finding ${input.label} group must be a non-empty array.`);
  }

  const atomicSet = new Set(input.atomics.map((item) => item.handle));
  const evidenceByHandle = new Map<string, SirEvidenceItem>(input.evidence.map((item) => [item.handle, item]));
  const allowedStates = new Set(input.allowedConclusionStates);

  input.value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Materialized Finding ${input.label}[${index}] must be an object.`);
    }
    const item = raw as MaterializedFindingLike;
    if (item.id !== undefined || item.findingId !== undefined || item.finding_id !== undefined) {
      throw new Error(`Materialized Finding ${input.label}[${index}] contains canonical finding identity before compilation.`);
    }

    const expectedHandle = `finding_${String(index + 1).padStart(3, '0')}`;
    if (item.handle !== expectedHandle) {
      throw new Error(`Materialized Finding ${input.label}[${index}] handle must be ${expectedHandle}.`);
    }

    nonEmptyString(item.title, `${input.label}[${index}].title`, 10);
    nonEmptyString(item.lifecycleConsequence, `${input.label}[${index}].lifecycleConsequence`, 10);
    if (!['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'].includes(String(item.defaultSeverity))) {
      throw new Error(`Materialized Finding ${input.label}[${index}] has invalid default severity.`);
    }
    if (typeof item.humanLockRequired !== 'boolean') {
      throw new Error(`Materialized Finding ${input.label}[${index}] humanLockRequired must be boolean.`);
    }

    const states = stringArray(item.eligibleConclusionStates, `${input.label}[${index}].eligibleConclusionStates`);
    assertUnique(states, `${input.label}[${index}].eligibleConclusionStates`);
    for (const state of states) {
      if (!allowedStates.has(state)) {
        throw new Error(`Materialized Finding ${input.label}[${index}] uses conclusion state ${state} outside the governed object vocabulary.`);
      }
    }

    const atomicHandles = stringArray(item.atomicHandles, `${input.label}[${index}].atomicHandles`);
    const evidenceHandles = stringArray(item.evidenceHandles, `${input.label}[${index}].evidenceHandles`);
    assertUnique(atomicHandles, `${input.label}[${index}].atomicHandles`);
    assertUnique(evidenceHandles, `${input.label}[${index}].evidenceHandles`);

    for (const handle of atomicHandles) {
      if (!atomicSet.has(handle)) {
        throw new Error(`Materialized Finding ${input.label}[${index}] references unknown atomic handle ${handle}.`);
      }
    }

    const selectedEvidence: SirEvidenceItem[] = [];
    for (const handle of evidenceHandles) {
      const evidenceItem = evidenceByHandle.get(handle);
      if (!evidenceItem) {
        throw new Error(`Materialized Finding ${input.label}[${index}] references unknown evidence handle ${handle}.`);
      }
      selectedEvidence.push(evidenceItem);
    }

    for (const atomicHandle of atomicHandles) {
      const covered = selectedEvidence.some((evidenceItem) =>
        evidenceItem.supportsAtomicHandles.some((supported) => supported === atomicHandle)
      );
      if (!covered) {
        throw new Error(`Materialized Finding ${input.label}[${index}] selected evidence does not cover atomic handle ${atomicHandle}.`);
      }
    }

    for (const evidenceItem of selectedEvidence) {
      const relevant = evidenceItem.supportsAtomicHandles.some((supported) => atomicHandles.includes(supported));
      if (!relevant) {
        throw new Error(`Materialized Finding ${input.label}[${index}] evidence ${evidenceItem.handle} is unrelated to its selected atomics.`);
      }
    }

    if (input.label === 'antipattern' && states.includes('TESTED_ABSENT')) {
      const absence = input.absenceContract;
      if (
        !absence ||
        !Array.isArray(absence.requiredArtifacts) ||
        absence.requiredArtifacts.length === 0 ||
        typeof absence.interpretationBoundary !== 'string' ||
        absence.interpretationBoundary.trim().length < 10
      ) {
        throw new Error('Materialized anti-pattern Finding uses TESTED_ABSENT without a valid locked AP absence contract.');
      }
    }
  });
}

export function verifyMaterializedFindingArtifact(input: {
  output: unknown;
  findingTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
}): void {
  if (!input.output || typeof input.output !== 'object' || Array.isArray(input.output)) {
    throw new Error('Persisted FINDING_ARCHITECTURE output is not a materialized SIR object.');
  }
  if (input.findingTaskContract.contractVersion !== '2.0.0' || input.findingTaskContract.taskType !== 'FINDING_ARCHITECTURE') {
    throw new Error('Persisted Finding artifact verifier requires FINDING_ARCHITECTURE contractVersion 2.0.0.');
  }
  if (input.findingTaskContract.lockedInputs.authoring_plan_sha256 !== input.authoringPlan.planSha256) {
    throw new Error('Persisted Finding artifact belongs to a different Authoring Plan.');
  }

  const capabilityStates = input.findingTaskContract.lockedInputs.capability_conclusion_states;
  const antipatternStates = input.findingTaskContract.lockedInputs.antipattern_conclusion_states;
  if (!sameOrderedStrings(capabilityStates, input.authoringPlan.vocabulary.capabilityConclusionStates)) {
    throw new Error('Persisted Finding contract capability conclusion-state vocabulary drifted from the Authoring Plan.');
  }
  if (!sameOrderedStrings(antipatternStates, input.authoringPlan.vocabulary.antipatternConclusionStates)) {
    throw new Error('Persisted Finding contract anti-pattern conclusion-state vocabulary drifted from the Authoring Plan.');
  }

  const capabilityAtomics = input.findingTaskContract.lockedInputs.capability_atomics;
  const antipatternAtomics = input.findingTaskContract.lockedInputs.antipattern_atomics;
  const capabilityEvidence = input.findingTaskContract.lockedInputs.capability_evidence;
  const antipatternEvidence = input.findingTaskContract.lockedInputs.antipattern_evidence;
  if (!Array.isArray(capabilityAtomics) || capabilityAtomics.length === 0 || !Array.isArray(antipatternAtomics) || antipatternAtomics.length === 0) {
    throw new Error('Persisted Finding contract is missing locked materialized atomic graphs.');
  }
  if (!Array.isArray(capabilityEvidence) || capabilityEvidence.length === 0 || !Array.isArray(antipatternEvidence) || antipatternEvidence.length === 0) {
    throw new Error('Persisted Finding contract is missing locked materialized evidence graphs.');
  }

  const output = input.output as MaterializedFindingsLike;
  if (!Array.isArray(output.findingLogicNotes)) {
    throw new Error('Persisted Finding artifact is missing findingLogicNotes array.');
  }

  const absenceContract = input.findingTaskContract.lockedInputs.ap_absence_contract as
    | { requiredArtifacts?: unknown; interpretationBoundary?: unknown }
    | undefined;

  verifyGroup({
    value: output.capability,
    label: 'capability',
    atomics: capabilityAtomics as Array<{ handle: string }>,
    evidence: capabilityEvidence as SirEvidenceItem[],
    allowedConclusionStates: input.authoringPlan.vocabulary.capabilityConclusionStates,
    absenceContract
  });
  verifyGroup({
    value: output.antipattern,
    label: 'antipattern',
    atomics: antipatternAtomics as Array<{ handle: string }>,
    evidence: antipatternEvidence as SirEvidenceItem[],
    allowedConclusionStates: input.authoringPlan.vocabulary.antipatternConclusionStates,
    absenceContract
  });
}
