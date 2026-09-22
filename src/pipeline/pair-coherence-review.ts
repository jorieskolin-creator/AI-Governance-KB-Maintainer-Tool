import type { Finding, StrictnessTier, ValidationResult } from './finding.js';
import { applyTier } from './finding.js';
import { joinTaskPrompts, renderTaskPrompt, type PipelinePlan, type PromptContract } from './prompt.js';
import { schemaFindings } from './schema.js';

const meaningful = { type: 'string', minLength: 10 } as const;
const pathHandle = { type: 'string', pattern: '^path_[0-9]{3}$' } as const;

export const pairCoherenceReviewSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ai-governance-kb.local/pipeline/pair-coherence-review.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['defects', 'coherenceSummary'],
  properties: {
    defects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'severity',
          'coherenceDimension',
          'affectedPathHandles',
          'issue',
          'coherenceExpectation',
          'recommendedRepairPathHandles'
        ],
        properties: {
          severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'] },
          coherenceDimension: {
            type: 'string',
            enum: [
              'SEMANTIC_BOUNDARY',
              'CAPABILITY_ANTIPATTERN_RELATIONSHIP',
              'APPLICABILITY',
              'QUESTION_ATOMIC_ALIGNMENT',
              'EVIDENCE_INTERPRETATION',
              'SOURCE_INTERPRETATION',
              'FINDING_LOGIC',
              'CONTROL_AUTHORITY',
              'LIFECYCLE_ASSURANCE',
              'REFERENCE_OWNERSHIP',
              'CROSS_ARTIFACT_CONTRADICTION'
            ]
          },
          affectedPathHandles: { type: 'array', minItems: 1, items: pathHandle },
          issue: meaningful,
          coherenceExpectation: meaningful,
          recommendedRepairPathHandles: { type: 'array', minItems: 1, items: pathHandle }
        }
      }
    },
    coherenceSummary: meaningful
  }
} as const;

export interface PairCoherenceDefect {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKING';
  coherenceDimension:
    | 'SEMANTIC_BOUNDARY'
    | 'CAPABILITY_ANTIPATTERN_RELATIONSHIP'
    | 'APPLICABILITY'
    | 'QUESTION_ATOMIC_ALIGNMENT'
    | 'EVIDENCE_INTERPRETATION'
    | 'SOURCE_INTERPRETATION'
    | 'FINDING_LOGIC'
    | 'CONTROL_AUTHORITY'
    | 'LIFECYCLE_ASSURANCE'
    | 'REFERENCE_OWNERSHIP'
    | 'CROSS_ARTIFACT_CONTRADICTION';
  affectedPathHandles: string[];
  issue: string;
  coherenceExpectation: string;
  recommendedRepairPathHandles: string[];
}

export interface PairCoherenceReviewOutput {
  defects: PairCoherenceDefect[];
  coherenceSummary: string;
}

function duplicatePathFindings(output: unknown): Finding[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const defects = (output as { defects?: unknown }).defects;
  if (!Array.isArray(defects)) return [];
  const findings: Finding[] = [];
  defects.forEach((defect, defectIndex) => {
    if (!defect || typeof defect !== 'object' || Array.isArray(defect)) return;
    const handles = (defect as { affectedPathHandles?: unknown }).affectedPathHandles;
    if (!Array.isArray(handles)) return;
    const seen = new Set<unknown>();
    handles.forEach((handle, index) => {
      if (seen.has(handle)) {
        findings.push({
          code: 'PATH_HANDLES_RESOLVE_TO_LOCKED_REGISTRY',
          path: `/defects/${String(defectIndex)}/affectedPathHandles/${String(index)}`,
          message: `Duplicate path handle ${String(handle)} in one defect.`
        });
      }
      seen.add(handle);
    });
  });
  return findings;
}

export function validatePairCoherenceReview(
  output: unknown,
  tier: StrictnessTier = 'RELEASE'
): ValidationResult {
  return applyTier(schemaFindings(pairCoherenceReviewSchema, output), duplicatePathFindings(output), tier);
}

export interface PairCoherencePromptSeed {
  plan: PipelinePlan;
  pairCoherencePacket: { pairId: string; authoringPlanSha256: string; packetSha256: string };
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
}

export function pairCoherenceContract(seed: PairCoherencePromptSeed): PromptContract {
  if (seed.pairCoherencePacket.pairId !== seed.plan.identity.pairId) {
    throw new Error('Pair Coherence Packet pair does not match the Authoring Plan pair.');
  }
  if (seed.pairCoherencePacket.authoringPlanSha256 !== seed.plan.planSha256) {
    throw new Error('Pair Coherence Packet belongs to a different Authoring Plan.');
  }
  return {
    contractVersion: '2.0.0',
    failureMode: 'FAIL_CLOSED',
    taskType: 'PAIR_COHERENCE_REVIEW',
    objective:
      'Independently review the complete verified pair snapshot for semantic cross-artifact coherence. Identify contradictions, boundary leakage, unsupported semantic progression, evidence-to-finding inconsistencies, control/authority inconsistencies, lifecycle-assurance inconsistencies and related-criterion ownership problems. Return defects only. Structural identity, reference resolution, source metadata integrity, tactic reciprocity and artifact hashes are deterministic upstream gates and must not be re-decided here.',
    lockedInputs: {
      authoring_plan_id: seed.plan.planId,
      authoring_plan_sha256: seed.plan.planSha256,
      pair_coherence_packet_sha256: seed.pairCoherencePacket.packetSha256,
      pair_coherence_packet: seed.pairCoherencePacket,
      category_baseline: seed.categoryBaseline,
      golden_reference: seed.goldenReference,
      deterministic_preflight_status: 'PASSED_BEFORE_PAIR_COHERENCE_QC'
    },
    allowedReferences: [
      'VERIFIED_PAIR_COHERENCE_PACKET',
      'CATEGORY_BASELINE',
      'GOLDEN_REFERENCE_AS_QUALITY_EXEMPLAR'
    ],
    doNot: [
      'Do not output pair ID, capability ID, anti-pattern ID, defect IDs, pass/fail status or canonical IDs.',
      'Do not output free-form object paths; select only supplied path_* handles.',
      'Do not rewrite, normalize, improve or silently repair any production content.',
      'Do not propose replacement text or return corrected artifacts.',
      'Do not create sources, source locators, evidence, findings, tactics, controls, lifecycle targets or related criteria.',
      'Do not re-run deterministic identity, schema, hash, source-metadata or tactic-reciprocity validation as a model judgment.',
      'Do not claim factual source support beyond the bounded source interpretation already present in the verified packet.',
      'Do not grant approval, legal compliance, residual-risk acceptance or lifecycle authorization.',
      'Do not treat the Golden reference as a normative rulebook or require category-specific counts or wording to match it.',
      'Do not suppress a material defect merely because repairing it affects multiple upstream paths.'
    ],
    outputContract: {
      format: 'JSON',
      schemaName: 'SirPairCoherenceOutput',
      requiredFields: ['defects', 'coherenceSummary'],
      additionalProperties: false
    },
    validationProfile: [
      'DEFECT_ONLY_OUTPUT',
      'NO_MODEL_OWNED_PAIR_OR_DEFECT_IDENTITY',
      'NO_MODEL_OWNED_PASS_STATUS',
      'PATH_HANDLES_RESOLVE_TO_LOCKED_REGISTRY',
      'AFFECTED_PATHS_NONEMPTY_PER_DEFECT',
      'REPAIR_PATHS_NONEMPTY_PER_DEFECT',
      'SEVERITY_AND_COHERENCE_DIMENSION_GOVERNED',
      'NO_REWRITTEN_PRODUCTION_CONTENT',
      'PASS_STATUS_DERIVED_DETERMINISTICALLY_AFTER_VALIDATION'
    ]
  };
}

export function buildPairCoherenceReviewPrompt(seed: PairCoherencePromptSeed): string {
  return joinTaskPrompts([renderTaskPrompt(pairCoherenceContract(seed))]);
}
