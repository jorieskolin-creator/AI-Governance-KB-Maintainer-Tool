import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAuthoringPlan } from '../../src/authoring/authoring-plan.js';
import { compileSirPair } from '../../src/compiler/sir-compiler.js';
import { loadSourceRegister } from '../../src/assets/load.js';
import { stableSha256 } from '../../src/pipeline/hash.js';
import { validateEvidenceAndSafety } from '../../src/pipeline/evidence-and-safety.js';
import { validateMappings } from '../../src/pipeline/mappings.js';
import { validatePairCoherenceReview } from '../../src/pipeline/pair-coherence-review.js';
import { validatePairFrame } from '../../src/pipeline/pair-frame.js';
import { validateSourceContext } from '../../src/pipeline/source-context.js';
import type { AuthoringSourceRegisterRecord } from '../../src/pipeline/source-context.js';

/**
 * P2A-FIX2 — derive A1 recordings from the immutable golden fixtures.
 * Semantics are copied verbatim. supportedClaim is unrecoverable and becomes
 * an unmappedClaims entry per the brief. No model-authored content.
 */

const RECORDING_DIR = resolve(process.cwd(), 'tests/pipeline/recordings/A1');
const STRUCTURAL_NOTE =
  'Derived from golden fixtures A1_v1.0.0.json and AP-A1_v1.0.0.json; those fixtures attest no separate note for this slot.';
const UNMAPPED_NOTE =
  'Golden normative_source_mappings have no supported_claim. Each golden mapping is an unmappedClaims entry with reason INSUFFICIENT_SOURCE_CONTEXT. The claim string is the golden source_id and exact_locator only.';

interface GoldenQuestion {
  id: string;
  dimension: 'DEFINITION_AND_INTENT' | 'IMPLEMENTATION_AND_OPERATION' | 'EVIDENCE_AND_EFFECTIVENESS';
  question: string;
}
interface GoldenEvidence {
  id: string;
  title: string;
  claim_supported: string;
  evidence_class: string;
  minimum_technical_assurance: 'UNKNOWN' | 'DECLARED' | 'IMPLEMENTED' | 'TESTED' | 'OPERATIONALLY_OBSERVED';
  required_human_assurance: 'PENDING' | 'HUMAN_VALIDATED' | 'FORMALLY_APPROVED';
  acceptance_conditions: string[];
  limitations: string[];
}
interface GoldenAtomic {
  id: string;
  question_id: string;
  criterion?: string;
  test?: string;
  required_evidence_ids: string[];
}
interface GoldenFinding {
  id: string;
  title: string;
  eligible_conclusion_states: string[];
  mapped_atomic_item_ids: string[];
  required_evidence_ids: string[];
  default_severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';
  lifecycle_consequence: string;
  human_lock_required: boolean;
}
interface GoldenMapping {
  mapping_id: string;
  source_id: string;
  source_version_or_date: string;
  exact_locator: string;
  relationship: string;
  category_rationale: string;
  verification_status: string;
  last_verified_date: string;
}
interface GoldenRules {
  evidence_ceilings: string[];
  false_positive_guards: string[];
  prohibited_inferences: string[];
  contradiction_handling: string[];
  freshness_rules: string[];
}
interface GoldenGate {
  effect: 'NONE' | 'WARN' | 'BLOCK' | 'CONSTRAIN';
  conditions: string[];
  override_authority: string;
}
interface GoldenRuntime {
  machine_may: string[];
  machine_must_not: string[];
  human_authority_required_for: string[];
}
interface GoldenApplicability {
  statement: string;
  conditions: string[];
  exclusions: string[];
  reassessment_triggers: string[];
}
interface GoldenStage {
  lifecycle_stage: string;
  minimum_technical_assurance: 'UNKNOWN' | 'DECLARED' | 'IMPLEMENTED' | 'TESTED' | 'OPERATIONALLY_OBSERVED';
  required_human_assurance: 'PENDING' | 'HUMAN_VALIDATED' | 'FORMALLY_APPROVED';
}
interface GoldenCapability {
  id: string;
  version: string;
  schema_version: string;
  release_status: string;
  approval_record?: unknown;
  domain: 'A';
  domain_title: string;
  title: string;
  canonical_definition: string;
  governance_purpose: string;
  distinct_claim: string;
  applicability: GoldenApplicability;
  primary_questions: GoldenQuestion[];
  required_evidence: GoldenEvidence[];
  evidence_rules: GoldenRules;
  hard_gate_effect: GoldenGate;
  normative_source_mappings: GoldenMapping[];
  finding_definitions: GoldenFinding[];
  candidate_tactic_refs: unknown[];
  runtime_decision_boundary: GoldenRuntime;
  related_criteria: string[];
  atomic_subcriteria: GoldenAtomic[];
  target_assurance_by_lifecycle_stage: GoldenStage[];
}
interface GoldenAntipattern {
  id: string;
  version: string;
  title: string;
  canonical_definition: string;
  applicability: GoldenApplicability;
  primary_questions: GoldenQuestion[];
  required_evidence: GoldenEvidence[];
  evidence_rules: GoldenRules;
  hard_gate_effect: GoldenGate;
  normative_source_mappings: GoldenMapping[];
  finding_definitions: GoldenFinding[];
  candidate_tactic_refs: unknown[];
  runtime_decision_boundary: GoldenRuntime;
  related_criteria: string[];
  failure_mechanism: string;
  atomic_tests: GoldenAtomic[];
  absence_test_contract: { required_artifacts: string[] };
  target_assurance_by_lifecycle_stage: GoldenStage[];
}

function loadGolden<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/fixtures', name), 'utf8')) as T;
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ordinal(id: string): number {
  const match = /(\d+)$/.exec(id);
  if (!match) throw new Error(`No trailing ordinal on ${id}.`);
  return Number(match[1]);
}

function handle(kind: string, n: number): string {
  return `${kind}_${String(n).padStart(3, '0')}`;
}

function questionSlot(id: string): 1 | 2 | 3 {
  const match = /-Q([123])$/.exec(id);
  if (!match) throw new Error(`Question id ${id} is not a governed slot.`);
  return Number(match[1]) as 1 | 2 | 3;
}

function rulesOf(rules: GoldenRules) {
  return {
    evidenceCeilings: [...rules.evidence_ceilings],
    falsePositiveGuards: [...rules.false_positive_guards],
    prohibitedInferences: [...rules.prohibited_inferences],
    contradictionHandling: [...rules.contradiction_handling],
    freshnessRules: [...rules.freshness_rules]
  };
}

function applicabilityOf(item: GoldenApplicability) {
  return {
    statement: item.statement,
    conditions: [...item.conditions],
    exclusions: [...item.exclusions],
    reassessmentTriggers: [...item.reassessment_triggers]
  };
}

function gateOf(item: GoldenGate) {
  return {
    effect: item.effect,
    conditions: [...item.conditions],
    overrideAuthority: item.override_authority
  };
}

function runtimeOf(item: GoldenRuntime) {
  return {
    machineMay: [...item.machine_may],
    machineMustNot: [...item.machine_must_not],
    humanAuthorityRequiredFor: [...item.human_authority_required_for]
  };
}

function questionsOf(items: GoldenQuestion[]) {
  return items.map((item) => ({ slot: questionSlot(item.id), question: item.question }));
}

function evidenceNeed(atomic: GoldenAtomic, byId: Map<string, GoldenEvidence>): string {
  const titles = atomic.required_evidence_ids.map((id) => {
    const evidence = byId.get(id);
    if (!evidence) throw new Error(`Atomic ${atomic.id} cites missing evidence ${id}.`);
    return evidence.title;
  });
  const text = titles.join('; ');
  if (text.trim().length >= 10) return text;
  const claims = atomic.required_evidence_ids.map((id) => byId.get(id)?.claim_supported ?? '');
  return [...titles, ...claims].join('; ');
}

function supportsHandles(evidenceId: string, atomics: GoldenAtomic[]): string[] {
  return atomics
    .filter((atomic) => atomic.required_evidence_ids.includes(evidenceId))
    .map((atomic) => handle('atomic', ordinal(atomic.id)));
}

function evidenceItems(items: GoldenEvidence[], atomics: GoldenAtomic[]) {
  return items.map((item) => ({
    handle: handle('evidence', ordinal(item.id)),
    title: item.title,
    claimSupported: item.claim_supported,
    evidenceClass: item.evidence_class,
    minimumTechnicalAssurance: item.minimum_technical_assurance,
    requiredHumanAssurance: item.required_human_assurance,
    acceptanceConditions: [...item.acceptance_conditions],
    limitations: [...item.limitations],
    supportsAtomicHandles: supportsHandles(item.id, atomics)
  }));
}

function atomicItems(items: GoldenAtomic[], statementKey: 'criterion' | 'test', evidence: GoldenEvidence[]) {
  const byId = new Map(evidence.map((item) => [item.id, item]));
  return items.map((item) => ({
    handle: handle('atomic', ordinal(item.id)),
    questionSlot: questionSlot(item.question_id),
    statement: statementKey === 'criterion' ? item.criterion ?? '' : item.test ?? '',
    evidenceNeed: evidenceNeed(item, byId)
  }));
}

function findingItems(items: GoldenFinding[]) {
  return items.map((item) => ({
    handle: handle('finding', ordinal(item.id)),
    title: item.title,
    eligibleConclusionStates: [...item.eligible_conclusion_states],
    atomicHandles: item.mapped_atomic_item_ids.map((id) => handle('atomic', ordinal(id))),
    evidenceHandles: item.required_evidence_ids.map((id) => handle('evidence', ordinal(id))),
    defaultSeverity: item.default_severity,
    lifecycleConsequence: item.lifecycle_consequence,
    humanLockRequired: item.human_lock_required
  }));
}

function lifecycleItems(items: GoldenStage[]) {
  return items.map((item) => ({
    lifecycleStage: item.lifecycle_stage,
    minimumTechnicalAssurance: item.minimum_technical_assurance,
    requiredHumanAssurance: item.required_human_assurance
  }));
}

function unmappedClaim(objectKind: 'CAPABILITY' | 'ANTIPATTERN', mapping: GoldenMapping, sourceHandle: string) {
  return {
    objectKind,
    claim: `Golden-attested mapping without recorded supported claim: ${mapping.source_id} — ${mapping.exact_locator}`,
    reason: 'INSUFFICIENT_SOURCE_CONTEXT' as const,
    consideredSourceHandles: [sourceHandle]
  };
}

function projectGolden(value: Record<string, unknown>): Record<string, unknown> {
  const projected = structuredClone(value);
  projected.schema_version = '2.1.0';
  projected.release_status = 'DRAFT';
  delete projected.approval_record;
  projected.candidate_tactic_refs = [];
  projected.normative_source_mappings = [];
  return projected;
}

function diffValues(left: unknown, right: unknown, path: string, out: string[]): void {
  if (Object.is(left, right)) return;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      out.push(`${path} length ${String(left.length)} vs ${String(right.length)}`);
      return;
    }
    left.forEach((item, index) => diffValues(item, right[index], `${path}[${String(index)}]`, out));
    return;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      if (!(key in leftRecord)) out.push(`${next} missing on compiled`);
      else if (!(key in rightRecord)) out.push(`${next} missing on projected golden`);
      else diffValues(leftRecord[key], rightRecord[key], next, out);
    }
    return;
  }
  out.push(`${path} compiled=${JSON.stringify(left)} projected=${JSON.stringify(right)}`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const capability = loadGolden<GoldenCapability>('A1_v1.0.0.json');
const antipattern = loadGolden<GoldenAntipattern>('AP-A1_v1.0.0.json');
const stages = capability.target_assurance_by_lifecycle_stage.map((item) => item.lifecycle_stage);
if (
  JSON.stringify(stages) !==
  JSON.stringify(antipattern.target_assurance_by_lifecycle_stage.map((item) => item.lifecycle_stage))
) {
  fail('Capability and anti-pattern lifecycle stage order differ. Derivation stopped.');
}
const dimensions = capability.primary_questions.map((item) => item.dimension);
if (JSON.stringify(dimensions) !== JSON.stringify(antipattern.primary_questions.map((item) => item.dimension))) {
  fail('Capability and anti-pattern question dimensions differ. Derivation stopped.');
}

const seenSourceIds: string[] = [];
for (const mapping of [...capability.normative_source_mappings, ...antipattern.normative_source_mappings]) {
  if (!seenSourceIds.includes(mapping.source_id)) seenSourceIds.push(mapping.source_id);
}
const sourceHandleById = new Map(seenSourceIds.map((id, index) => [id, handle('source', index + 1)]));

const loadedRegister = loadSourceRegister();
const registerById = new Map(loadedRegister.register.sources.map((item) => [item.id, item]));

function authorityFor(sourceId: string): AuthoringSourceRegisterRecord {
  const record = registerById.get(sourceId);
  if (!record) fail(`Sealed source register has no record for golden source ${sourceId}.`);
  const conditions = record.roles_or_applicability_conditions;
  const applicabilityBoundary = Array.isArray(conditions) ? conditions.join(' ') : '';
  if (
    typeof record.authority_tier !== 'string' ||
    typeof record.authority_type !== 'string' ||
    typeof record.official_location !== 'string' ||
    typeof record.licensing_storage_boundary !== 'string' ||
    typeof record.effective_status !== 'string' ||
    applicabilityBoundary.trim().length === 0
  ) {
    fail(`Sealed source register record ${sourceId} is missing authority or boundary metadata.`);
  }
  if (record.effective_status !== 'IN_FORCE' && record.effective_status !== 'PUBLISHED') {
    fail(`Sealed source register record ${sourceId} is not decision-eligible.`);
  }
  const golden = [...capability.normative_source_mappings, ...antipattern.normative_source_mappings].find(
    (item) => item.source_id === sourceId
  );
  if (!golden || golden.verification_status !== 'VERIFIED') {
    fail(`Golden mapping for ${sourceId} is not VERIFIED.`);
  }
  return {
    sourceId,
    versionOrDate: golden.source_version_or_date,
    verificationStatus: 'VERIFIED',
    lastVerifiedDate: golden.last_verified_date,
    effectiveStatus: record.effective_status,
    authorityTier: record.authority_tier,
    authorityType: record.authority_type,
    officialLocation: record.official_location,
    applicabilityBoundary,
    licensingBoundary: record.licensing_storage_boundary,
    domainCoverage: Array.isArray(record.domain_coverage) ? record.domain_coverage.map(String) : [],
    modelContextPolicy: 'METADATA_LOCATOR_ONLY',
    usageRightsReference: null
  };
}

const allowedSources = seenSourceIds.map((sourceId) => {
  const golden = [...capability.normative_source_mappings, ...antipattern.normative_source_mappings].find(
    (item) => item.source_id === sourceId
  );
  if (!golden) fail(`Missing golden mapping for ${sourceId}.`);
  return {
    sourceHandle: sourceHandleById.get(sourceId) ?? '',
    sourceId,
    versionOrDate: golden.source_version_or_date,
    verificationStatus: 'VERIFIED' as const,
    lastVerifiedDate: golden.last_verified_date
  };
});

const criterionHandleById = new Map<string, string>();
for (const id of [...capability.related_criteria, ...antipattern.related_criteria]) {
  if (!criterionHandleById.has(id)) criterionHandleById.set(id, handle('criterion', criterionHandleById.size + 1));
}
const adjacentCriteria = [...criterionHandleById.entries()].map(([criterionId, criterionHandle]) => ({
  criterionHandle,
  criterionId,
  boundarySummary: `Golden-attested related criterion: ${criterionId}`
}));

const schemaDir = resolve(process.cwd(), 'schemas');
const goldenDir = resolve(process.cwd(), 'golden/fixtures');
const goldenBytes = Buffer.concat([
  readFileSync(resolve(goldenDir, 'A1_v1.0.0.json')),
  readFileSync(resolve(goldenDir, 'AP-A1_v1.0.0.json'))
]);
const goldenSha256 = createHash('sha256').update(goldenBytes).digest('hex');

const authoringPlan = buildAuthoringPlan({
  identity: {
    capabilityId: 'A1',
    antipatternId: 'AP-A1',
    pairId: 'A1_AP-A1',
    domain: 'A',
    domainTitle: capability.domain_title,
    capabilityTitle: capability.title,
    antipatternTitle: antipattern.title
  },
  targetVersion: capability.version,
  schemaVersion: '2.1.0',
  baseline: {
    baselineSnapshotId: 'golden-a1-ap-a1-v1.0.0',
    baselineSha256: goldenSha256,
    productionContractVersion: '2.1.0',
    productionContractSha256: fileSha256(resolve(schemaDir, 'capability.schema.json')),
    capabilitySchemaVersion: '2.1.0',
    capabilitySchemaSha256: fileSha256(resolve(schemaDir, 'capability.schema.json')),
    antipatternSchemaVersion: '2.1.0',
    antipatternSchemaSha256: fileSha256(resolve(schemaDir, 'antipattern.schema.json')),
    sharedDefinitionsVersion: '2.1.0',
    sharedDefinitionsSha256: fileSha256(resolve(schemaDir, 'shared-definitions.schema.json')),
    sourceRegisterVersion: loadedRegister.version,
    sourceRegisterSha256: loadedRegister.sha256,
    tacticCatalogVersion: null,
    tacticCatalogSha256: null,
    goldenReferenceId: 'A1_AP-A1',
    goldenReferenceVersion: capability.version,
    goldenReferenceSha256: goldenSha256
  },
  questionDimensions: [dimensions[0]!, dimensions[1]!, dimensions[2]!],
  vocabulary: {
    technicalAssurance: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED'],
    humanAssurance: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'],
    capabilityConclusionStates: ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE'],
    antipatternConclusionStates: ['CONFIRMED_PRESENT', 'PARTIALLY_PRESENT', 'TESTED_ABSENT', 'UNKNOWN', 'NOT_APPLICABLE'],
    hardGateEffects: ['NONE', 'WARN', 'BLOCK', 'CONSTRAIN'],
    lifecycleStages: stages
  },
  allowedSources,
  allowedTactics: [],
  adjacentCriteria
});

const seenLocators = new Set<string>();
const locatorsBySource = new Map<string, Array<{ exactLocator: string; locatorHandle: string }>>();
let locatorOrdinal = 0;
for (const mapping of [...capability.normative_source_mappings, ...antipattern.normative_source_mappings]) {
  const key = `${mapping.source_id}\u0000${mapping.exact_locator}`;
  if (seenLocators.has(key)) continue;
  seenLocators.add(key);
  locatorOrdinal += 1;
  const list = locatorsBySource.get(mapping.source_id) ?? [];
  list.push({ exactLocator: mapping.exact_locator, locatorHandle: handle('locator', locatorOrdinal) });
  locatorsBySource.set(mapping.source_id, list);
}

const registerRecords = seenSourceIds.map((sourceId) => authorityFor(sourceId));
const sources = registerRecords
  .map((record) => ({ record, sourceHandle: sourceHandleById.get(record.sourceId) ?? '' }))
  .sort((left, right) => left.sourceHandle.localeCompare(right.sourceHandle))
  .map(({ record, sourceHandle }) => {
    const locatorContexts = (locatorsBySource.get(record.sourceId) ?? []).map((locator) => ({
      locatorHandle: locator.locatorHandle,
      exactLocator: locator.exactLocator,
      locatorLabel: null,
      contextMode: 'LOCATOR_METADATA_ONLY' as const,
      contextText: null,
      contextSha256: stableSha256({
        sourceId: record.sourceId,
        versionOrDate: record.versionOrDate,
        locator: locator.exactLocator,
        locatorLabel: null,
        contextText: null
      })
    }));
    return {
      sourceHandle,
      sourceId: record.sourceId,
      versionOrDate: record.versionOrDate,
      verificationStatus: 'VERIFIED' as const,
      lastVerifiedDate: record.lastVerifiedDate,
      effectiveStatus: record.effectiveStatus,
      authorityTier: record.authorityTier,
      authorityType: record.authorityType,
      officialLocation: record.officialLocation,
      applicabilityBoundary: record.applicabilityBoundary,
      licensingBoundary: record.licensingBoundary,
      modelContextPolicy: 'METADATA_LOCATOR_ONLY' as const,
      usageRightsReference: null,
      locatorContexts,
      mappingContextAvailable: locatorContexts.length > 0
    };
  });

const sourceContextWithoutHash = {
  packetVersion: '1.0.0' as const,
  pairId: authoringPlan.identity.pairId,
  authoringPlanSha256: authoringPlan.planSha256,
  sourceRegisterVersion: loadedRegister.version,
  sourceRegisterSha256: loadedRegister.sha256,
  sources,
  missingContextSourceHandles: sources.filter((item) => !item.mappingContextAvailable).map((item) => item.sourceHandle),
  mappingContextAvailable: sources.some((item) => item.mappingContextAvailable)
};
const sourceContext = { ...sourceContextWithoutHash, packetSha256: stableSha256(sourceContextWithoutHash) };

const capabilityEvidenceById = new Map(capability.required_evidence.map((item) => [item.id, item]));
const antipatternEvidenceById = new Map(antipattern.required_evidence.map((item) => [item.id, item]));

const pairBoundary = {
  capability: {
    canonicalDefinition: capability.canonical_definition,
    governancePurpose: capability.governance_purpose,
    distinctClaim: capability.distinct_claim,
    ownedTopics: [capability.title],
    excludedTopics: []
  },
  antipattern: {
    canonicalDefinition: antipattern.canonical_definition,
    pairedRelationship: `${antipattern.id} is the paired anti-pattern of ${capability.id}: ${antipattern.title}.`
  },
  boundaryRationale: capability.distinct_claim
};
const apFailureModel = {
  failureMechanism: antipattern.failure_mechanism,
  triggeringConditions: [antipattern.failure_mechanism],
  observableFailureSurfaces: [antipattern.failure_mechanism],
  nonExamples: [antipattern.failure_mechanism],
  distinctionFromCapabilityGap: capability.distinct_claim
};
const applicability = {
  capability: applicabilityOf(capability.applicability),
  antipattern: applicabilityOf(antipattern.applicability),
  consistencyNotes: []
};
const primaryQuestions = {
  capabilityQuestions: questionsOf(capability.primary_questions),
  antipatternQuestions: questionsOf(antipattern.primary_questions),
  coverageRationale: capability.primary_questions.map((item) => item.question).join(' ')
};
const capabilityAtomics = atomicItems(capability.atomic_subcriteria, 'criterion', capability.required_evidence);
const antipatternAtomics = atomicItems(antipattern.atomic_tests, 'test', antipattern.required_evidence);
const capabilityEvidence = evidenceItems(capability.required_evidence, capability.atomic_subcriteria);
const antipatternEvidence = evidenceItems(antipattern.required_evidence, antipattern.atomic_tests);
const unmappedClaims = [
  ...capability.normative_source_mappings.map((mapping) =>
    unmappedClaim('CAPABILITY', mapping, sourceHandleById.get(mapping.source_id) ?? '')
  ),
  ...antipattern.normative_source_mappings.map((mapping) =>
    unmappedClaim('ANTIPATTERN', mapping, sourceHandleById.get(mapping.source_id) ?? '')
  )
];
const findings = {
  capability: findingItems(capability.finding_definitions),
  antipattern: findingItems(antipattern.finding_definitions),
  findingLogicNotes: [STRUCTURAL_NOTE]
};
const controlBoundary = {
  capabilityHardGate: gateOf(capability.hard_gate_effect),
  antipatternHardGate: gateOf(antipattern.hard_gate_effect),
  capabilityRuntimeBoundary: runtimeOf(capability.runtime_decision_boundary),
  antipatternRuntimeBoundary: runtimeOf(antipattern.runtime_decision_boundary),
  controlNotes: [STRUCTURAL_NOTE]
};
const lifecycleTargets = {
  capability: lifecycleItems(capability.target_assurance_by_lifecycle_stage),
  antipattern: lifecycleItems(antipattern.target_assurance_by_lifecycle_stage),
  rationaleNotes: [STRUCTURAL_NOTE]
};
const referenceMappings = {
  capabilityRelatedCriteria: capability.related_criteria.map((id) => ({
    criterionHandle: criterionHandleById.get(id) ?? '',
    criterionId: id,
    boundarySummary: `Golden-attested related criterion: ${id}`
  })),
  antipatternRelatedCriteria: antipattern.related_criteria.map((id) => ({
    criterionHandle: criterionHandleById.get(id) ?? '',
    criterionId: id,
    boundarySummary: `Golden-attested related criterion: ${id}`
  })),
  capabilityTacticRefs: [],
  antipatternTacticRefs: [],
  referenceNotes: [STRUCTURAL_NOTE]
};

const pairFrame = { pairBoundary, apFailureModel, applicability, primaryQuestions };
const evidenceAndSafety = {
  atomicDecomposition: {
    capabilitySubcriteria: capability.atomic_subcriteria.map((item) => ({
      questionSlot: questionSlot(item.question_id),
      criterion: item.criterion ?? '',
      evidenceNeed: evidenceNeed(item, capabilityEvidenceById)
    })),
    antipatternTests: antipattern.atomic_tests.map((item) => ({
      questionSlot: questionSlot(item.question_id),
      test: item.test ?? '',
      evidenceNeed: evidenceNeed(item, antipatternEvidenceById)
    })),
    coverageNotes: []
  },
  evidenceArchitecture: {
    capabilityEvidence: capabilityEvidence.map(({ handle: _handle, ...item }) => item),
    antipatternEvidence: antipatternEvidence.map(({ handle: _handle, ...item }) => item),
    sufficiencyNotes: []
  },
  evidenceSafety: {
    capabilityRules: rulesOf(capability.evidence_rules),
    antipatternRules: rulesOf(antipattern.evidence_rules),
    crossPairSafetyNotes: []
  },
  apAbsenceContract: {
    requiredArtifacts: [...antipattern.absence_test_contract.required_artifacts],
    interpretationBoundary: antipattern.absence_test_contract.required_artifacts.join('; ')
  }
};
const mappings = {
  sourceMapping: {
    capabilityMappings: [],
    antipatternMappings: [],
    unmappedClaims,
    mappingNotes: [UNMAPPED_NOTE]
  },
  findingArchitecture: {
    capabilityFindings: findings.capability.map(({ handle: _handle, ...item }) => item),
    antipatternFindings: findings.antipattern.map(({ handle: _handle, ...item }) => item),
    findingLogicNotes: findings.findingLogicNotes
  },
  controlBoundary,
  lifecycleAssurance: {
    capabilityTargets: lifecycleTargets.capability.map(({ lifecycleStage: _stage, ...item }) => item),
    antipatternTargets: lifecycleTargets.antipattern.map(({ lifecycleStage: _stage, ...item }) => item),
    rationaleNotes: lifecycleTargets.rationaleNotes
  },
  referenceMapping: {
    capabilityRelatedCriterionHandles: referenceMappings.capabilityRelatedCriteria.map((item) => item.criterionHandle),
    antipatternRelatedCriterionHandles: referenceMappings.antipatternRelatedCriteria.map((item) => item.criterionHandle),
    referenceNotes: referenceMappings.referenceNotes
  }
};
const pairCoherenceReview = {
  defects: [],
  coherenceSummary: 'Golden fixtures A1_v1.0.0 and AP-A1_v1.0.0 record no pair-coherence defects.'
};
const snapshot = {
  pairBoundary,
  apFailureModel,
  applicability,
  primaryQuestions,
  atomics: { capability: capabilityAtomics, antipattern: antipatternAtomics },
  evidence: { capability: capabilityEvidence, antipattern: antipatternEvidence },
  evidenceSafety: evidenceAndSafety.evidenceSafety,
  apAbsence: evidenceAndSafety.apAbsenceContract,
  sourceMappings: {
    sourceContextPacketSha256: sourceContext.packetSha256,
    capability: [],
    antipattern: [],
    unmappedClaims,
    mappingNotes: [UNMAPPED_NOTE]
  },
  findings,
  controlBoundary,
  lifecycleTargets,
  referenceMappings
};

const recordingChecks = [
  ['SOURCE_CONTEXT', validateSourceContext(sourceContext, 'RELEASE')],
  ['PAIR_FRAME', validatePairFrame(pairFrame, 'RELEASE')],
  ['EVIDENCE_AND_SAFETY', validateEvidenceAndSafety(evidenceAndSafety, 'RELEASE')],
  ['MAPPINGS', validateMappings(mappings, 'RELEASE')],
  ['PAIR_COHERENCE_REVIEW', validatePairCoherenceReview(pairCoherenceReview, 'RELEASE')]
] as const;
for (const [name, result] of recordingChecks) {
  if (!result.ok) {
    const detail = result.findings.map((item) => `${item.code} ${item.path} ${item.message}`).join('\n');
    fail(`${name} failed RELEASE validation:\n${detail}`);
  }
}

const draft = await compileSirPair({
  authoringPlan,
  snapshot,
  mode: 'DRAFT'
});
if (!draft.ok || !draft.capability || !draft.antipattern) {
  const detail = draft.defects.map((item) => `${item.checkId} ${item.objectPath} ${item.issue}`).join('\n');
  fail(`DRAFT compile of the derived A1 image failed:\n${detail}`);
}
for (const [label, compiled] of [
  ['capability', draft.capability],
  ['antipattern', draft.antipattern]
] as const) {
  const mappingsOut = compiled.normative_source_mappings;
  if (Array.isArray(mappingsOut) && mappingsOut.length > 0) {
    fail(`${label} compiled normative_source_mappings is not empty. Derivation stopped.`);
  }
}
const capabilityDiff: string[] = [];
const antipatternDiff: string[] = [];
diffValues(draft.capability, projectGolden(capability as unknown as Record<string, unknown>), '', capabilityDiff);
diffValues(draft.antipattern, projectGolden(antipattern as unknown as Record<string, unknown>), '', antipatternDiff);
if (capabilityDiff.length > 0 || antipatternDiff.length > 0) {
  fail(
    [
      'Compiled DRAFT image differs from projected golden outside the five declared deltas.',
      'capability:',
      ...capabilityDiff.map((item) => `  ${item}`),
      'antipattern:',
      ...antipatternDiff.map((item) => `  ${item}`)
    ].join('\n')
  );
}

const files: Record<string, unknown> = {
  'authoring-plan.json': authoringPlan,
  'SOURCE_CONTEXT.json': sourceContext,
  'PAIR_FRAME.json': pairFrame,
  'EVIDENCE_AND_SAFETY.json': evidenceAndSafety,
  'MAPPINGS.json': mappings,
  'PAIR_COHERENCE_REVIEW.json': pairCoherenceReview,
  'snapshot.json': snapshot
};
mkdirSync(RECORDING_DIR, { recursive: true });
const hashes: Record<string, string> = {};
for (const [name, value] of Object.entries(files)) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(resolve(RECORDING_DIR, name), text);
  hashes[name] = createHash('sha256').update(text).digest('hex');
}

console.log(
  JSON.stringify(
    {
      briefId: 'P2A-FIX2',
      status: 'EMITTED',
      draft: { ok: draft.ok, outcome: draft.outcome, defects: draft.defects.length },
      undeclaredDiffs: 0,
      files: hashes
    },
    null,
    2
  )
);
