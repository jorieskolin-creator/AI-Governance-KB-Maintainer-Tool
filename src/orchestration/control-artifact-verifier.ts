import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirApAbsenceOutput } from '../cognitive/sir-ap-absence-contract.js';
import type { SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type { SirEvidenceSafetyOutput } from '../cognitive/sir-evidence-safety-contract.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import { validateSirControlCompletion } from '../validation/sir-control-completion.js';
import { canonicalArtifactHash } from './artifact-hash.js';

function assertSameJson(left: unknown, right: unknown, label: string): void {
  if (canonicalArtifactHash(left) !== canonicalArtifactHash(right)) {
    throw new Error(`Persisted Control contract ${label} drifted from the verified upstream artifact.`);
  }
}

export function verifyPersistedControlArtifact(input: {
  output: unknown;
  controlTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedFindings: MaterializedSirFindings;
  verifiedEvidenceSafety: SirEvidenceSafetyOutput;
  verifiedApAbsence: SirApAbsenceOutput;
}): asserts input is {
  output: SirControlBoundaryOutput;
  controlTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedFindings: MaterializedSirFindings;
  verifiedEvidenceSafety: SirEvidenceSafetyOutput;
  verifiedApAbsence: SirApAbsenceOutput;
} {
  const contract = input.controlTaskContract;
  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'CONTROL_BOUNDARY') {
    throw new Error('Persisted Control artifact verifier requires CONTROL_BOUNDARY contractVersion 2.0.0.');
  }
  if (contract.targetObjectId !== input.authoringPlan.identity.pairId) {
    throw new Error('Persisted Control artifact target does not match the Authoring Plan pair.');
  }
  if (contract.lockedInputs.authoring_plan_sha256 !== input.authoringPlan.planSha256) {
    throw new Error('Persisted Control artifact belongs to a different Authoring Plan.');
  }

  assertSameJson(
    contract.lockedInputs.governed_hard_gate_effects,
    input.authoringPlan.vocabulary.hardGateEffects,
    'hard-gate vocabulary'
  );
  assertSameJson(
    contract.lockedInputs.capability_findings,
    input.verifiedFindings.capability,
    'capability Findings'
  );
  assertSameJson(
    contract.lockedInputs.antipattern_findings,
    input.verifiedFindings.antipattern,
    'anti-pattern Findings'
  );
  assertSameJson(
    contract.lockedInputs.finding_logic_notes,
    input.verifiedFindings.findingLogicNotes,
    'Finding logic notes'
  );
  assertSameJson(
    contract.lockedInputs.capability_evidence_safety,
    input.verifiedEvidenceSafety.capabilityRules,
    'capability Evidence Safety'
  );
  assertSameJson(
    contract.lockedInputs.antipattern_evidence_safety,
    input.verifiedEvidenceSafety.antipatternRules,
    'anti-pattern Evidence Safety'
  );
  assertSameJson(
    contract.lockedInputs.ap_absence_contract,
    input.verifiedApAbsence,
    'AP absence contract'
  );

  const completed = new Set(contract.upstreamTaskTypes);
  const report = validateSirControlCompletion(
    contract,
    completed,
    input.output,
    { runId: 'persisted-control-artifact-verification', expectedPairId: input.authoringPlan.identity.pairId }
  );
  if (!report.passed) {
    const summary = report.findings
      .map((item) => `${item.checkId}@${item.objectPath}: ${item.issue}`)
      .join(' | ');
    throw new Error(`Persisted Control artifact failed deterministic re-validation: ${summary}`);
  }
}
