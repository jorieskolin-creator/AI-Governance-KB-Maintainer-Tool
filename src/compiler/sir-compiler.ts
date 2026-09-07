import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { HumanAssurance, TechnicalAssurance } from '../cognitive/content-contracts.js';
import type { PairCoherenceSnapshot } from '../orchestration/pair-coherence-packet.js';
import {
  evaluateCanonicalCompile,
  type NamedGateResult
} from '../orchestration/named-gates.js';
import type { ValidationFinding, ValidationKind } from '../validation/contracts.js';
import { schemaGateSnapshotIssues } from '../validation/sir-snapshot-schema.js';
import { validateCanonicalPair } from '../validation/canonical-pair.js';
import {
  antipatternAtomicId,
  capabilityAtomicId,
  evidenceId,
  findingId,
  handleOrdinal,
  questionId,
  sourceMappingId
} from './canonical-ids.js';

export type SirCompileMode = 'DRAFT' | 'RELEASE';

export interface SirCompileInput {
  authoringPlan: AuthoringPlan;
  snapshot: unknown;
  mode: SirCompileMode;
  reviewNotes?: readonly string[];
}

export interface SirCompileReport {
  ok: boolean;
  outcome: 'CANONICAL_COMPILE_VALID' | 'COMPILE_FAILED';
  defects: ValidationFinding[];
  notes: string[];
  capability?: Record<string, unknown>;
  antipattern?: Record<string, unknown>;
}

const TECHNICAL: readonly TechnicalAssurance[] = [
  'UNKNOWN',
  'DECLARED',
  'IMPLEMENTED',
  'TESTED',
  'OPERATIONALLY_OBSERVED'
];
const HUMAN: readonly HumanAssurance[] = ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'];
const TECHNICAL_RANK: Record<TechnicalAssurance, number> = {
  UNKNOWN: 0,
  DECLARED: 1,
  IMPLEMENTED: 2,
  TESTED: 3,
  OPERATIONALLY_OBSERVED: 4
};
const HUMAN_RANK: Record<HumanAssurance, number> = {
  PENDING: 0,
  HUMAN_VALIDATED: 1,
  FORMALLY_APPROVED: 2
};
const SOURCE_ID_PATTERN = /^SRC-/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function snapshotRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function parsePersistedSirSnapshot(
  value: unknown
): { ok: true; snapshot: PairCoherenceSnapshot } | { ok: false; issues: string[] } {
  const record = snapshotRecord(value);
  if (!record) {
    return { ok: false, issues: ['Persisted SIR snapshot is missing or is not an object.'] };
  }
  const issues = schemaGateSnapshotIssues(record);
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, snapshot: record as unknown as PairCoherenceSnapshot };
}

function finding(
  checkId: string,
  kind: ValidationKind,
  objectId: string,
  objectPath: string,
  issue: string
): ValidationFinding {
  return {
    checkId,
    kind,
    severity: 'BLOCKING',
    objectId,
    objectPath,
    issue,
    dependencyScope: []
  };
}

function asTechnical(value: string): TechnicalAssurance | undefined {
  return (TECHNICAL as readonly string[]).includes(value) ? (value as TechnicalAssurance) : undefined;
}

function asHuman(value: string): HumanAssurance | undefined {
  return (HUMAN as readonly string[]).includes(value) ? (value as HumanAssurance) : undefined;
}

function highestTechnical(values: TechnicalAssurance[]): TechnicalAssurance | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((highest, value) =>
    TECHNICAL_RANK[value] > TECHNICAL_RANK[highest] ? value : highest
  );
}

function highestHuman(values: HumanAssurance[]): HumanAssurance | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((highest, value) => (HUMAN_RANK[value] > HUMAN_RANK[highest] ? value : highest));
}

interface CompiledEvidence {
  id: string;
  handle: string;
  title: string;
  claim_supported: string;
  evidence_class: string;
  minimum_technical_assurance: TechnicalAssurance;
  required_human_assurance: HumanAssurance;
  acceptance_conditions: string[];
  limitations: string[];
  supportsAtomicHandles: string[];
}

interface CompiledAtomic {
  id: string;
  handle: string;
  question_id: string;
  statement: string;
  required_evidence_ids: string[];
  minimum_technical_assurance: TechnicalAssurance;
  required_human_assurance: HumanAssurance;
}

function compileEvidence(
  objectId: string,
  path: string,
  items: PairCoherenceSnapshot['evidence']['capability'],
  defects: ValidationFinding[]
): CompiledEvidence[] {
  const compiled: CompiledEvidence[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const ordinal = handleOrdinal(item.handle, 'evidence');
    if (ordinal === undefined) {
      defects.push(
        finding('EVIDENCE_HANDLE', 'IDENTIFIER', objectId, `${path}[${index}].handle`, `Invalid evidence handle ${item.handle}.`)
      );
      continue;
    }
    const id = evidenceId(objectId, ordinal);
    if (seen.has(id)) {
      defects.push(finding('EVIDENCE_ID_UNIQUE', 'IDENTIFIER', objectId, `${path}[${index}].handle`, `Duplicate evidence ID ${id}.`));
    }
    seen.add(id);
    const technical = asTechnical(item.minimumTechnicalAssurance);
    const human = asHuman(item.requiredHumanAssurance);
    if (!technical) {
      defects.push(
        finding(
          'EVIDENCE_TECHNICAL_VOCABULARY',
          'SCHEMA',
          objectId,
          `${path}[${index}].minimumTechnicalAssurance`,
          `Unknown technical assurance ${item.minimumTechnicalAssurance}.`
        )
      );
    }
    if (!human) {
      defects.push(
        finding(
          'EVIDENCE_HUMAN_VOCABULARY',
          'SCHEMA',
          objectId,
          `${path}[${index}].requiredHumanAssurance`,
          `Unknown human assurance ${item.requiredHumanAssurance}.`
        )
      );
    }
    if (!technical || !human) continue;
    compiled.push({
      id,
      handle: item.handle,
      title: item.title,
      claim_supported: item.claimSupported,
      evidence_class: item.evidenceClass,
      minimum_technical_assurance: technical,
      required_human_assurance: human,
      acceptance_conditions: [...item.acceptanceConditions],
      limitations: [...item.limitations],
      supportsAtomicHandles: [...item.supportsAtomicHandles]
    });
  }
  return compiled;
}

function invertEvidenceBindings(
  objectId: string,
  path: string,
  evidence: CompiledEvidence[],
  atomicHandles: Set<string>,
  defects: ValidationFinding[]
): Map<string, string[]> {
  const bindings = new Map<string, string[]>();
  for (const item of evidence) {
    for (const atomicHandle of item.supportsAtomicHandles) {
      if (!atomicHandles.has(atomicHandle)) {
        defects.push(
          finding(
            'EVIDENCE_ATOMIC_REFERENCE',
            'REFERENCE',
            objectId,
            `${path}[${item.handle}].supportsAtomicHandles`,
            `Evidence ${item.id} references unknown atomic ${atomicHandle}.`
          )
        );
        continue;
      }
      const current = bindings.get(atomicHandle) ?? [];
      if (!current.includes(item.id)) current.push(item.id);
      bindings.set(atomicHandle, current);
    }
  }
  return bindings;
}

function compileAtomics(
  objectId: string,
  path: string,
  kind: 'capability' | 'antipattern',
  items: PairCoherenceSnapshot['atomics']['capability'],
  questionIds: Map<1 | 2 | 3, string>,
  bindings: Map<string, string[]>,
  evidenceById: Map<string, CompiledEvidence>,
  defects: ValidationFinding[]
): CompiledAtomic[] {
  const compiled: CompiledAtomic[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const ordinal = handleOrdinal(item.handle, 'atomic');
    if (ordinal === undefined) {
      defects.push(
        finding('ATOMIC_HANDLE', 'IDENTIFIER', objectId, `${path}[${index}].handle`, `Invalid atomic handle ${item.handle}.`)
      );
      continue;
    }
    const id = kind === 'capability' ? capabilityAtomicId(objectId, ordinal) : antipatternAtomicId(objectId, ordinal);
    if (seen.has(id)) {
      defects.push(finding('ATOMIC_ID_UNIQUE', 'IDENTIFIER', objectId, `${path}[${index}].handle`, `Duplicate atomic ID ${id}.`));
    }
    seen.add(id);
    const question = questionIds.get(item.questionSlot);
    if (!question) {
      defects.push(
        finding(
          'ATOMIC_QUESTION_SLOT',
          'REFERENCE',
          objectId,
          `${path}[${index}].questionSlot`,
          `Atomic ${item.handle} references missing question slot ${item.questionSlot}.`
        )
      );
    }
    const required = bindings.get(item.handle) ?? [];
    if (required.length === 0) {
      defects.push(
        finding(
          'ATOMIC_EVIDENCE_BINDING',
          'REFERENCE',
          objectId,
          `${path}[${index}]`,
          `Atomic ${item.handle} has no inverted evidence binding.`
        )
      );
    }
    const technicalValues: TechnicalAssurance[] = [];
    const humanValues: HumanAssurance[] = [];
    for (const evidenceItemId of required) {
      const requirement = evidenceById.get(evidenceItemId);
      if (!requirement) continue;
      technicalValues.push(requirement.minimum_technical_assurance);
      humanValues.push(requirement.required_human_assurance);
    }
    const technical = highestTechnical(technicalValues);
    const human = highestHuman(humanValues);
    if (!question || required.length === 0 || !technical || !human) continue;
    compiled.push({
      id,
      handle: item.handle,
      question_id: question,
      statement: item.statement,
      required_evidence_ids: required,
      minimum_technical_assurance: technical,
      required_human_assurance: human
    });
  }
  return compiled;
}

function compileFindings(
  objectId: string,
  path: string,
  items: PairCoherenceSnapshot['findings']['capability'],
  atomicByHandle: Map<string, string>,
  evidenceByHandle: Map<string, string>,
  defects: ValidationFinding[]
): Record<string, unknown>[] {
  const compiled: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    const ordinal = handleOrdinal(item.handle, 'finding');
    if (ordinal === undefined) {
      defects.push(
        finding('FINDING_HANDLE', 'IDENTIFIER', objectId, `${path}[${index}].handle`, `Invalid finding handle ${item.handle}.`)
      );
      continue;
    }
    const id = findingId(objectId, ordinal);
    if (seen.has(id)) {
      defects.push(finding('FINDING_ID_UNIQUE', 'IDENTIFIER', objectId, `${path}[${index}].handle`, `Duplicate finding ID ${id}.`));
    }
    seen.add(id);
    const atomicIds: string[] = [];
    for (const atomicHandle of item.atomicHandles) {
      const resolved = atomicByHandle.get(atomicHandle);
      if (!resolved) {
        defects.push(
          finding(
            'FINDING_ATOMIC_REFERENCE',
            'REFERENCE',
            objectId,
            `${path}[${index}].atomicHandles`,
            `Finding ${item.handle} references unknown atomic ${atomicHandle}.`
          )
        );
        continue;
      }
      if (!atomicIds.includes(resolved)) atomicIds.push(resolved);
    }
    const evidenceIds: string[] = [];
    for (const evidenceHandle of item.evidenceHandles) {
      const resolved = evidenceByHandle.get(evidenceHandle);
      if (!resolved) {
        defects.push(
          finding(
            'FINDING_EVIDENCE_REFERENCE',
            'REFERENCE',
            objectId,
            `${path}[${index}].evidenceHandles`,
            `Finding ${item.handle} references unknown evidence ${evidenceHandle}.`
          )
        );
        continue;
      }
      if (!evidenceIds.includes(resolved)) evidenceIds.push(resolved);
    }
    if (atomicIds.length === 0 || evidenceIds.length === 0) continue;
    compiled.push({
      id,
      title: item.title,
      eligible_conclusion_states: [...item.eligibleConclusionStates],
      mapped_atomic_item_ids: atomicIds,
      required_evidence_ids: evidenceIds,
      default_severity: item.defaultSeverity,
      lifecycle_consequence: item.lifecycleConsequence,
      human_lock_required: item.humanLockRequired
    });
  }
  return compiled;
}

function compileSourceMappings(
  objectId: string,
  path: string,
  items: PairCoherenceSnapshot['sourceMappings']['capability'],
  defects: ValidationFinding[]
): Record<string, unknown>[] {
  const compiled: Record<string, unknown>[] = [];
  items.forEach((item, index) => {
    const id = sourceMappingId(objectId, index + 1);
    if (!SOURCE_ID_PATTERN.test(item.sourceId)) {
      defects.push(
        finding(
          'SOURCE_ID',
          'SOURCE',
          objectId,
          `${path}[${index}].sourceId`,
          `Source ID ${item.sourceId} is not a canonical SRC-* identifier.`
        )
      );
      return;
    }
    if (!ISO_DATE.test(item.lastVerifiedDate)) {
      defects.push(
        finding(
          'SOURCE_VERIFIED_DATE',
          'SOURCE',
          objectId,
          `${path}[${index}].lastVerifiedDate`,
          `Source lastVerifiedDate ${item.lastVerifiedDate} is not an ISO date.`
        )
      );
      return;
    }
    compiled.push({
      mapping_id: id,
      source_id: item.sourceId,
      source_version_or_date: item.sourceVersionOrDate,
      exact_locator: item.exactLocator,
      relationship: item.relationship,
      supported_claim: item.supportedClaim,
      category_rationale: item.categoryRationale,
      applicability_conditions: [...item.applicabilityConditions],
      exclusions: [...item.exclusions],
      verification_status: item.verificationStatus,
      last_verified_date: item.lastVerifiedDate
    });
  });
  return compiled;
}

function compileQuestions(
  objectId: string,
  path: string,
  items: PairCoherenceSnapshot['primaryQuestions']['capabilityQuestions'],
  slots: AuthoringPlan['fixedQuestionSlots'],
  defects: ValidationFinding[]
): { questions: Record<string, unknown>[]; ids: Map<1 | 2 | 3, string> } {
  const ids = new Map<1 | 2 | 3, string>();
  const questions: Record<string, unknown>[] = [];
  for (const slot of [1, 2, 3] as const) {
    const item = items.find((question) => question.slot === slot);
    const dimension = slots[slot - 1]?.dimension;
    if (!item || !dimension) {
      defects.push(
        finding('QUESTION_SLOT', 'IDENTIFIER', objectId, `${path}`, `Governed question slot ${slot} is missing.`)
      );
      continue;
    }
    const id = questionId(objectId, slot);
    ids.set(slot, id);
    questions.push({
      id,
      dimension,
      question: item.question
    });
  }
  return { questions, ids };
}

function compileLifecycle(
  objectId: string,
  path: string,
  items: PairCoherenceSnapshot['lifecycleTargets']['capability'],
  stages: readonly string[],
  defects: ValidationFinding[]
): Record<string, unknown>[] {
  const byStage = new Map(items.map((item) => [item.lifecycleStage, item]));
  const compiled: Record<string, unknown>[] = [];
  for (const [index, stage] of stages.entries()) {
    const item = byStage.get(stage);
    if (!item) {
      defects.push(
        finding(
          'LIFECYCLE_STAGE',
          'SCHEMA',
          objectId,
          `${path}[${index}]`,
          `Missing lifecycle target for governed stage ${stage}.`
        )
      );
      continue;
    }
    const technical = asTechnical(item.minimumTechnicalAssurance);
    const human = asHuman(item.requiredHumanAssurance);
    if (!technical || !human) {
      defects.push(
        finding(
          'LIFECYCLE_VOCABULARY',
          'SCHEMA',
          objectId,
          `${path}[${stage}]`,
          `Lifecycle target ${stage} uses unknown assurance vocabulary.`
        )
      );
      continue;
    }
    compiled.push({
      lifecycle_stage: stage,
      minimum_technical_assurance: technical,
      required_human_assurance: human
    });
  }
  for (const item of items) {
    if (!stages.includes(item.lifecycleStage)) {
      defects.push(
        finding(
          'LIFECYCLE_STAGE_UNKNOWN',
          'SCHEMA',
          objectId,
          path,
          `Lifecycle target ${item.lifecycleStage} is not in the Authoring Plan stage order.`
        )
      );
    }
  }
  return compiled;
}

function relatedCriteria(
  objectId: string,
  items: PairCoherenceSnapshot['referenceMappings']['capabilityRelatedCriteria']
): string[] {
  return unique(items.map((item) => item.criterionId).filter((id) => id !== objectId));
}

function evidenceRequirement(item: CompiledEvidence): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    claim_supported: item.claim_supported,
    evidence_class: item.evidence_class,
    minimum_technical_assurance: item.minimum_technical_assurance,
    required_human_assurance: item.required_human_assurance,
    acceptance_conditions: item.acceptance_conditions,
    limitations: item.limitations
  };
}

function evidenceRules(rules: PairCoherenceSnapshot['evidenceSafety']['capabilityRules']): Record<string, unknown> {
  return {
    evidence_ceilings: [...rules.evidenceCeilings],
    false_positive_guards: [...rules.falsePositiveGuards],
    prohibited_inferences: [...rules.prohibitedInferences],
    contradiction_handling: [...rules.contradictionHandling],
    freshness_rules: [...rules.freshnessRules]
  };
}

function hardGate(item: PairCoherenceSnapshot['controlBoundary']['capabilityHardGate']): Record<string, unknown> {
  return {
    effect: item.effect,
    conditions: [...item.conditions],
    override_authority: item.overrideAuthority
  };
}

function runtimeBoundary(
  item: PairCoherenceSnapshot['controlBoundary']['capabilityRuntimeBoundary']
): Record<string, unknown> {
  return {
    machine_may: [...item.machineMay],
    machine_must_not: [...item.machineMustNot],
    human_authority_required_for: [...item.humanAuthorityRequiredFor]
  };
}

function unmappedNotes(snapshot: PairCoherenceSnapshot): string[] {
  return snapshot.sourceMappings.unmappedClaims.map(
    (claim) => `Unmapped ${claim.objectKind} claim (${claim.reason}): ${claim.claim}`
  );
}

export function compileGateResult(report: SirCompileReport): NamedGateResult {
  return evaluateCanonicalCompile(report.defects);
}

export async function compileSirPair(input: SirCompileInput): Promise<SirCompileReport> {
  const defects: ValidationFinding[] = [];
  const notes: string[] = [...(input.reviewNotes ?? [])];
  const parsed = parsePersistedSirSnapshot(input.snapshot);
  if (!parsed.ok) {
    for (const issue of parsed.issues) {
      defects.push(finding('SIR_SNAPSHOT_SCHEMA', 'SCHEMA', input.authoringPlan.identity.pairId, '/', issue));
    }
    return {
      ok: false,
      outcome: 'COMPILE_FAILED',
      defects,
      notes
    };
  }

  const snapshot = parsed.snapshot;
  const plan = input.authoringPlan;
  const capabilityId = plan.identity.capabilityId;
  const antipatternId = plan.identity.antipatternId;
  if (antipatternId !== `AP-${capabilityId}` || plan.identity.pairId !== `${capabilityId}_${antipatternId}`) {
    defects.push(
      finding(
        'PAIR_IDENTITY',
        'IDENTIFIER',
        plan.identity.pairId,
        '/identity',
        `Authoring Plan pair identity ${plan.identity.pairId} is not a canonical capability/anti-pattern pair.`
      )
    );
  }

  const capabilityQuestions = compileQuestions(
    capabilityId,
    'primaryQuestions.capabilityQuestions',
    snapshot.primaryQuestions.capabilityQuestions,
    plan.fixedQuestionSlots,
    defects
  );
  const antipatternQuestions = compileQuestions(
    antipatternId,
    'primaryQuestions.antipatternQuestions',
    snapshot.primaryQuestions.antipatternQuestions,
    plan.fixedQuestionSlots,
    defects
  );

  const capabilityEvidence = compileEvidence(capabilityId, 'evidence.capability', snapshot.evidence.capability, defects);
  const antipatternEvidence = compileEvidence(
    antipatternId,
    'evidence.antipattern',
    snapshot.evidence.antipattern,
    defects
  );
  const capabilityAtomicHandles = new Set(snapshot.atomics.capability.map((item) => item.handle));
  const antipatternAtomicHandles = new Set(snapshot.atomics.antipattern.map((item) => item.handle));
  const capabilityBindings = invertEvidenceBindings(
    capabilityId,
    'evidence.capability',
    capabilityEvidence,
    capabilityAtomicHandles,
    defects
  );
  const antipatternBindings = invertEvidenceBindings(
    antipatternId,
    'evidence.antipattern',
    antipatternEvidence,
    antipatternAtomicHandles,
    defects
  );
  const capabilityEvidenceById = new Map(capabilityEvidence.map((item) => [item.id, item]));
  const antipatternEvidenceById = new Map(antipatternEvidence.map((item) => [item.id, item]));
  const capabilityAtomics = compileAtomics(
    capabilityId,
    'atomics.capability',
    'capability',
    snapshot.atomics.capability,
    capabilityQuestions.ids,
    capabilityBindings,
    capabilityEvidenceById,
    defects
  );
  const antipatternAtomics = compileAtomics(
    antipatternId,
    'atomics.antipattern',
    'antipattern',
    snapshot.atomics.antipattern,
    antipatternQuestions.ids,
    antipatternBindings,
    antipatternEvidenceById,
    defects
  );
  const capabilityAtomicByHandle = new Map(capabilityAtomics.map((item) => [item.handle, item.id]));
  const antipatternAtomicByHandle = new Map(antipatternAtomics.map((item) => [item.handle, item.id]));
  const capabilityEvidenceByHandle = new Map(capabilityEvidence.map((item) => [item.handle, item.id]));
  const antipatternEvidenceByHandle = new Map(antipatternEvidence.map((item) => [item.handle, item.id]));
  const capabilityFindings = compileFindings(
    capabilityId,
    'findings.capability',
    snapshot.findings.capability,
    capabilityAtomicByHandle,
    capabilityEvidenceByHandle,
    defects
  );
  const antipatternFindings = compileFindings(
    antipatternId,
    'findings.antipattern',
    snapshot.findings.antipattern,
    antipatternAtomicByHandle,
    antipatternEvidenceByHandle,
    defects
  );
  const capabilitySources = compileSourceMappings(
    capabilityId,
    'sourceMappings.capability',
    snapshot.sourceMappings.capability,
    defects
  );
  const antipatternSources = compileSourceMappings(
    antipatternId,
    'sourceMappings.antipattern',
    snapshot.sourceMappings.antipattern,
    defects
  );

  const sourceGaps = unmappedNotes(snapshot);
  notes.push(...sourceGaps);
  notes.push(...snapshot.sourceMappings.mappingNotes);
  if (snapshot.referenceMappings.capabilityTacticRefs.length === 0) {
    notes.push('Tactic catalog is not sealed; candidate tactic refs stay empty.');
  }
  if (input.mode === 'RELEASE' && snapshot.sourceMappings.unmappedClaims.length > 0) {
    for (const claim of snapshot.sourceMappings.unmappedClaims) {
      defects.push(
        finding(
          'SOURCE_UNMAPPED_CLAIM',
          'SOURCE',
          plan.identity.pairId,
          'sourceMappings.unmappedClaims',
          `Release compilation blocked by unmapped ${claim.objectKind} claim: ${claim.claim}`
        )
      );
    }
  }
  if (input.mode === 'RELEASE') {
    defects.push(
      finding(
        'APPROVAL_RECORD',
        'SCHEMA',
        plan.identity.pairId,
        '/approval_record',
        'Release compilation requires operator approval records owned by the release finalizer.'
      )
    );
  }

  const capability: Record<string, unknown> = {
    schema_version: plan.schemaVersion,
    id: capabilityId,
    version: plan.targetVersion,
    release_status: 'DRAFT',
    domain: plan.identity.domain,
    domain_title: plan.identity.domainTitle,
    object_type: 'CAPABILITY',
    title: plan.identity.capabilityTitle,
    canonical_definition: snapshot.pairBoundary.capability.canonicalDefinition,
    applicability: {
      statement: snapshot.applicability.capability.statement,
      conditions: [...snapshot.applicability.capability.conditions],
      exclusions: [...snapshot.applicability.capability.exclusions],
      reassessment_triggers: [...snapshot.applicability.capability.reassessmentTriggers]
    },
    primary_questions: capabilityQuestions.questions,
    required_evidence: capabilityEvidence.map(evidenceRequirement),
    evidence_rules: evidenceRules(snapshot.evidenceSafety.capabilityRules),
    hard_gate_effect: hardGate(snapshot.controlBoundary.capabilityHardGate),
    normative_source_mappings: capabilitySources,
    finding_definitions: capabilityFindings,
    candidate_tactic_refs: [],
    runtime_decision_boundary: runtimeBoundary(snapshot.controlBoundary.capabilityRuntimeBoundary),
    related_criteria: relatedCriteria(capabilityId, snapshot.referenceMappings.capabilityRelatedCriteria),
    governance_purpose: snapshot.pairBoundary.capability.governancePurpose,
    distinct_claim: snapshot.pairBoundary.capability.distinctClaim,
    atomic_subcriteria: capabilityAtomics.map((item) => ({
      id: item.id,
      question_id: item.question_id,
      criterion: item.statement,
      required_evidence_ids: item.required_evidence_ids,
      minimum_technical_assurance: item.minimum_technical_assurance,
      required_human_assurance: item.required_human_assurance
    })),
    target_assurance_by_lifecycle_stage: compileLifecycle(
      capabilityId,
      'lifecycleTargets.capability',
      snapshot.lifecycleTargets.capability,
      plan.vocabulary.lifecycleStages,
      defects
    )
  };

  const antipattern: Record<string, unknown> = {
    schema_version: plan.schemaVersion,
    id: antipatternId,
    version: plan.targetVersion,
    release_status: 'DRAFT',
    domain: plan.identity.domain,
    domain_title: plan.identity.domainTitle,
    object_type: 'ANTIPATTERN',
    title: plan.identity.antipatternTitle,
    canonical_definition: snapshot.pairBoundary.antipattern.canonicalDefinition,
    applicability: {
      statement: snapshot.applicability.antipattern.statement,
      conditions: [...snapshot.applicability.antipattern.conditions],
      exclusions: [...snapshot.applicability.antipattern.exclusions],
      reassessment_triggers: [...snapshot.applicability.antipattern.reassessmentTriggers]
    },
    primary_questions: antipatternQuestions.questions,
    required_evidence: antipatternEvidence.map(evidenceRequirement),
    evidence_rules: evidenceRules(snapshot.evidenceSafety.antipatternRules),
    hard_gate_effect: hardGate(snapshot.controlBoundary.antipatternHardGate),
    normative_source_mappings: antipatternSources,
    finding_definitions: antipatternFindings,
    candidate_tactic_refs: [],
    runtime_decision_boundary: runtimeBoundary(snapshot.controlBoundary.antipatternRuntimeBoundary),
    related_criteria: relatedCriteria(antipatternId, snapshot.referenceMappings.antipatternRelatedCriteria),
    failure_mechanism: snapshot.apFailureModel.failureMechanism,
    atomic_tests: antipatternAtomics.map((item) => ({
      id: item.id,
      question_id: item.question_id,
      test: item.statement,
      required_evidence_ids: item.required_evidence_ids,
      minimum_technical_assurance: item.minimum_technical_assurance,
      required_human_assurance: item.required_human_assurance
    })),
    absence_test_contract: {
      scope_defined: true,
      executed: true,
      successful: true,
      current: true,
      independently_verified: true,
      required_artifacts: [...snapshot.apAbsence.requiredArtifacts]
    },
    target_assurance_by_lifecycle_stage: compileLifecycle(
      antipatternId,
      'lifecycleTargets.antipattern',
      snapshot.lifecycleTargets.antipattern,
      plan.vocabulary.lifecycleStages,
      defects
    )
  };

  const schemaReport = await validateCanonicalPair(capability, antipattern, {
    activeSchemaVersion: plan.schemaVersion,
    requiredLifecycleStages: plan.vocabulary.lifecycleStages,
    draft: input.mode === 'DRAFT'
  });
  for (const issue of schemaReport.issues) {
    defects.push(
      finding(issue.checkId, 'SCHEMA', issue.objectId, issue.objectPath, issue.issue)
    );
  }

  const ok = defects.length === 0;
  return {
    ok,
    outcome: ok ? 'CANONICAL_COMPILE_VALID' : 'COMPILE_FAILED',
    defects,
    notes,
    ...(ok ? { capability, antipattern } : {})
  };
}
