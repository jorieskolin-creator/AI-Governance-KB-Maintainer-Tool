import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirApAbsenceOutput } from '../cognitive/sir-ap-absence-contract.js';
import type { SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type { SirEvidenceSafetyOutput } from '../cognitive/sir-evidence-safety-contract.js';
import type { SirPairBoundaryOutput } from '../cognitive/sir-initial-contracts.js';
import type { SirLifecycleAssuranceOutput } from '../cognitive/sir-lifecycle-contract.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import type { MaterializedSirLifecycleTargets } from '../sir/lifecycle-materializer.js';
import { validateSirLifecycleCompletion } from '../validation/sir-lifecycle-completion.js';
import { canonicalArtifactHash } from './artifact-hash.js';

function assertSameJson(left: unknown, right: unknown, label: string): void {
  if (canonicalArtifactHash(left) !== canonicalArtifactHash(right)) {
    throw new Error(`Persisted Lifecycle contract ${label} drifted from the verified upstream artifact.`);
  }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} contains unexpected or missing fields.`);
  }
}

function parseTargetGroup(
  value: unknown,
  stages: readonly string[],
  technicalVocabulary: ReadonlySet<string>,
  humanVocabulary: ReadonlySet<string>,
  label: string
): Array<{ minimumTechnicalAssurance: string; requiredHumanAssurance: string }> {
  if (!Array.isArray(value) || value.length !== stages.length) {
    throw new Error(`Persisted Lifecycle ${label} target count must equal governed lifecycle stage count ${stages.length}.`);
  }

  return value.map((raw, index) => {
    const item = objectRecord(raw, `Persisted Lifecycle ${label}[${index}]`);
    exactKeys(
      item,
      ['lifecycleStage', 'minimumTechnicalAssurance', 'requiredHumanAssurance'],
      `Persisted Lifecycle ${label}[${index}]`
    );
    const expectedStage = stages[index];
    if (item.lifecycleStage !== expectedStage) {
      throw new Error(
        `Persisted Lifecycle ${label}[${index}] stage identity drifted: expected ${expectedStage}, received ${String(item.lifecycleStage)}.`
      );
    }
    if (typeof item.minimumTechnicalAssurance !== 'string' || !technicalVocabulary.has(item.minimumTechnicalAssurance)) {
      throw new Error(`Persisted Lifecycle ${label}[${index}] technical assurance is outside the Authoring Plan vocabulary.`);
    }
    if (typeof item.requiredHumanAssurance !== 'string' || !humanVocabulary.has(item.requiredHumanAssurance)) {
      throw new Error(`Persisted Lifecycle ${label}[${index}] human assurance is outside the Authoring Plan vocabulary.`);
    }
    return {
      minimumTechnicalAssurance: item.minimumTechnicalAssurance,
      requiredHumanAssurance: item.requiredHumanAssurance
    };
  });
}

export function verifyPersistedLifecycleArtifact(input: {
  output: unknown;
  lifecycleTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedPairBoundary: SirPairBoundaryOutput;
  verifiedEvidence: MaterializedSirEvidence;
  verifiedEvidenceSafety: SirEvidenceSafetyOutput;
  verifiedApAbsence: SirApAbsenceOutput;
  verifiedFindings: MaterializedSirFindings;
  verifiedControl: SirControlBoundaryOutput;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}): asserts input is {
  output: MaterializedSirLifecycleTargets;
  lifecycleTaskContract: TaskContract;
  authoringPlan: AuthoringPlan;
  verifiedPairBoundary: SirPairBoundaryOutput;
  verifiedEvidence: MaterializedSirEvidence;
  verifiedEvidenceSafety: SirEvidenceSafetyOutput;
  verifiedApAbsence: SirApAbsenceOutput;
  verifiedFindings: MaterializedSirFindings;
  verifiedControl: SirControlBoundaryOutput;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
} {
  const contract = input.lifecycleTaskContract;
  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'LIFECYCLE_ASSURANCE') {
    throw new Error('Persisted Lifecycle artifact verifier requires LIFECYCLE_ASSURANCE contractVersion 2.0.0.');
  }
  if (contract.targetObjectId !== input.authoringPlan.identity.pairId) {
    throw new Error('Persisted Lifecycle artifact target does not match the Authoring Plan pair.');
  }
  if (contract.lockedInputs.authoring_plan_sha256 !== input.authoringPlan.planSha256) {
    throw new Error('Persisted Lifecycle artifact belongs to a different Authoring Plan.');
  }

  assertSameJson(contract.lockedInputs.lifecycle_stage_order, input.authoringPlan.vocabulary.lifecycleStages, 'lifecycle stage order');
  assertSameJson(contract.lockedInputs.governed_technical_assurance_vocabulary, input.authoringPlan.vocabulary.technicalAssurance, 'technical-assurance vocabulary');
  assertSameJson(contract.lockedInputs.governed_human_assurance_vocabulary, input.authoringPlan.vocabulary.humanAssurance, 'human-assurance vocabulary');
  assertSameJson(contract.lockedInputs.pair_boundary, input.verifiedPairBoundary, 'Pair Boundary');
  assertSameJson(contract.lockedInputs.capability_evidence, input.verifiedEvidence.capability, 'capability Evidence');
  assertSameJson(contract.lockedInputs.antipattern_evidence, input.verifiedEvidence.antipattern, 'anti-pattern Evidence');
  assertSameJson(contract.lockedInputs.capability_evidence_safety, input.verifiedEvidenceSafety.capabilityRules, 'capability Evidence Safety');
  assertSameJson(contract.lockedInputs.antipattern_evidence_safety, input.verifiedEvidenceSafety.antipatternRules, 'anti-pattern Evidence Safety');
  assertSameJson(contract.lockedInputs.ap_absence_contract, input.verifiedApAbsence, 'AP absence contract');
  assertSameJson(contract.lockedInputs.capability_findings, input.verifiedFindings.capability, 'capability Findings');
  assertSameJson(contract.lockedInputs.antipattern_findings, input.verifiedFindings.antipattern, 'anti-pattern Findings');
  assertSameJson(contract.lockedInputs.control_boundary, input.verifiedControl, 'Control Boundary');
  assertSameJson(contract.lockedInputs.category_baseline, input.categoryBaseline, 'category baseline');
  assertSameJson(contract.lockedInputs.golden_reference, input.goldenReference, 'Golden reference');

  const output = objectRecord(input.output, 'Persisted Lifecycle artifact');
  exactKeys(output, ['capability', 'antipattern', 'rationaleNotes'], 'Persisted Lifecycle artifact');
  if (!Array.isArray(output.rationaleNotes) || output.rationaleNotes.some((note) => typeof note !== 'string' || !note.trim())) {
    throw new Error('Persisted Lifecycle rationaleNotes must be an array of non-empty strings.');
  }

  const stages = input.authoringPlan.vocabulary.lifecycleStages;
  const technical = new Set<string>(input.authoringPlan.vocabulary.technicalAssurance);
  const human = new Set<string>(input.authoringPlan.vocabulary.humanAssurance);
  const capabilityTargets = parseTargetGroup(output.capability, stages, technical, human, 'capability');
  const antipatternTargets = parseTargetGroup(output.antipattern, stages, technical, human, 'anti-pattern');

  const semanticOutput: SirLifecycleAssuranceOutput = {
    capabilityTargets: capabilityTargets as SirLifecycleAssuranceOutput['capabilityTargets'],
    antipatternTargets: antipatternTargets as SirLifecycleAssuranceOutput['antipatternTargets'],
    rationaleNotes: [...(output.rationaleNotes as string[])]
  };
  const report = validateSirLifecycleCompletion(
    contract,
    new Set(contract.upstreamTaskTypes),
    semanticOutput,
    { runId: 'persisted-lifecycle-artifact-verification', expectedPairId: input.authoringPlan.identity.pairId }
  );
  if (!report.passed) {
    const summary = report.findings
      .map((item) => `${item.checkId}@${item.objectPath}: ${item.issue}`)
      .join(' | ');
    throw new Error(`Persisted Lifecycle artifact failed deterministic re-validation: ${summary}`);
  }
}
