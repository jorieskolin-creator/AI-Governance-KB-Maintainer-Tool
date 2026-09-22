import type { Finding, StrictnessTier, ValidationResult } from './finding.js';
import { applyTier } from './finding.js';
import { canonicalArtifactHash } from './hash.js';
import { joinTaskPrompts, renderTaskPrompt, type PipelinePlan, type PromptContract } from './prompt.js';
import { schemaFindings } from './schema.js';

const meaningful = { type: 'string', minLength: 10 } as const;
const nonEmpty = { type: 'string', minLength: 1 } as const;
const short = { type: 'string', minLength: 3 } as const;
const sourceHandle = { type: 'string', pattern: '^source_[0-9]{3}$' } as const;
const locatorHandle = { type: 'string', pattern: '^locator_[0-9]{3}$' } as const;
const atomicHandle = { type: 'string', pattern: '^atomic_[0-9]{3}$' } as const;
const evidenceHandle = { type: 'string', pattern: '^evidence_[0-9]{3}$' } as const;
const criterionHandle = { type: 'string', pattern: '^criterion_[0-9]{3}$' } as const;
const technical = {
  type: 'string',
  enum: ['UNKNOWN', 'DECLARED', 'IMPLEMENTED', 'TESTED', 'OPERATIONALLY_OBSERVED']
} as const;
const human = { type: 'string', enum: ['PENDING', 'HUMAN_VALIDATED', 'FORMALLY_APPROVED'] } as const;
const severity = { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'BLOCKING'] } as const;
const gate = { type: 'string', enum: ['NONE', 'WARN', 'BLOCK', 'CONSTRAIN'] } as const;

export const mappingsSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://ai-governance-kb.local/pipeline/mappings.schema.json',
  type: 'object',
  additionalProperties: false,
  required: ['sourceMapping', 'findingArchitecture', 'controlBoundary', 'lifecycleAssurance', 'referenceMapping'],
  properties: {
    sourceMapping: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilityMappings', 'antipatternMappings', 'unmappedClaims', 'mappingNotes'],
      properties: {
        capabilityMappings: { $ref: '#/$defs/mappings' },
        antipatternMappings: { $ref: '#/$defs/mappings' },
        unmappedClaims: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['objectKind', 'claim', 'reason', 'consideredSourceHandles'],
            properties: {
              objectKind: { type: 'string', enum: ['CAPABILITY', 'ANTIPATTERN'] },
              claim: meaningful,
              reason: {
                type: 'string',
                enum: [
                  'INSUFFICIENT_SOURCE_CONTEXT',
                  'NO_ALLOWED_SOURCE_SUPPORT',
                  'APPLICABILITY_AMBIGUOUS',
                  'RIGHTS_RESTRICTED_SOURCE_CONTEXT'
                ]
              },
              consideredSourceHandles: { type: 'array', items: sourceHandle }
            }
          }
        },
        mappingNotes: { type: 'array', items: nonEmpty }
      }
    },
    findingArchitecture: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilityFindings', 'antipatternFindings', 'findingLogicNotes'],
      properties: {
        capabilityFindings: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'title',
              'eligibleConclusionStates',
              'atomicHandles',
              'evidenceHandles',
              'defaultSeverity',
              'lifecycleConsequence',
              'humanLockRequired'
            ],
            properties: {
              title: meaningful,
              eligibleConclusionStates: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'string',
                  enum: ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE']
                }
              },
              atomicHandles: { type: 'array', minItems: 1, items: atomicHandle },
              evidenceHandles: { type: 'array', minItems: 1, items: evidenceHandle },
              defaultSeverity: severity,
              lifecycleConsequence: meaningful,
              humanLockRequired: { type: 'boolean' }
            }
          }
        },
        antipatternFindings: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'title',
              'eligibleConclusionStates',
              'atomicHandles',
              'evidenceHandles',
              'defaultSeverity',
              'lifecycleConsequence',
              'humanLockRequired'
            ],
            properties: {
              title: meaningful,
              eligibleConclusionStates: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'string',
                  enum: ['CONFIRMED_PRESENT', 'PARTIALLY_PRESENT', 'TESTED_ABSENT', 'UNKNOWN', 'NOT_APPLICABLE']
                }
              },
              atomicHandles: { type: 'array', minItems: 1, items: atomicHandle },
              evidenceHandles: { type: 'array', minItems: 1, items: evidenceHandle },
              defaultSeverity: severity,
              lifecycleConsequence: meaningful,
              humanLockRequired: { type: 'boolean' }
            }
          }
        },
        findingLogicNotes: { type: 'array', items: nonEmpty }
      }
    },
    controlBoundary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'capabilityHardGate',
        'antipatternHardGate',
        'capabilityRuntimeBoundary',
        'antipatternRuntimeBoundary',
        'controlNotes'
      ],
      properties: {
        capabilityHardGate: { $ref: '#/$defs/gate' },
        antipatternHardGate: { $ref: '#/$defs/gate' },
        capabilityRuntimeBoundary: { $ref: '#/$defs/runtime' },
        antipatternRuntimeBoundary: { $ref: '#/$defs/runtime' },
        controlNotes: { type: 'array', items: nonEmpty }
      }
    },
    lifecycleAssurance: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilityTargets', 'antipatternTargets', 'rationaleNotes'],
      properties: {
        capabilityTargets: { $ref: '#/$defs/targets' },
        antipatternTargets: { $ref: '#/$defs/targets' },
        rationaleNotes: { type: 'array', items: nonEmpty }
      }
    },
    referenceMapping: {
      type: 'object',
      additionalProperties: false,
      required: ['capabilityRelatedCriterionHandles', 'antipatternRelatedCriterionHandles', 'referenceNotes'],
      properties: {
        capabilityRelatedCriterionHandles: { type: 'array', items: criterionHandle },
        antipatternRelatedCriterionHandles: { type: 'array', items: criterionHandle },
        referenceNotes: { type: 'array', items: nonEmpty }
      }
    }
  },
  $defs: {
    mapping: {
      type: 'object',
      additionalProperties: false,
      required: [
        'sourceHandle',
        'locatorHandle',
        'relationship',
        'supportedClaim',
        'categoryRationale',
        'applicabilityConditions',
        'exclusions'
      ],
      properties: {
        sourceHandle,
        locatorHandle,
        relationship: nonEmpty,
        supportedClaim: meaningful,
        categoryRationale: meaningful,
        applicabilityConditions: { type: 'array', items: nonEmpty },
        exclusions: { type: 'array', items: nonEmpty }
      }
    },
    mappings: { type: 'array', items: { $ref: '#/$defs/mapping' } },
    gate: {
      type: 'object',
      additionalProperties: false,
      required: ['effect', 'conditions', 'overrideAuthority'],
      properties: {
        effect: gate,
        conditions: { type: 'array', minItems: 1, items: short },
        overrideAuthority: { type: ['string', 'null'] }
      }
    },
    runtime: {
      type: 'object',
      additionalProperties: false,
      required: ['machineMay', 'machineMustNot', 'humanAuthorityRequiredFor'],
      properties: {
        machineMay: { type: 'array', minItems: 1, items: short },
        machineMustNot: { type: 'array', minItems: 1, items: short },
        humanAuthorityRequiredFor: { type: 'array', minItems: 1, items: short }
      }
    },
    targets: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['minimumTechnicalAssurance', 'requiredHumanAssurance'],
        properties: { minimumTechnicalAssurance: technical, requiredHumanAssurance: human }
      }
    }
  }
} as const;

function arrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function lifecycleCountFindings(output: unknown): Finding[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const lifecycle = (output as { lifecycleAssurance?: unknown }).lifecycleAssurance;
  if (!lifecycle || typeof lifecycle !== 'object' || Array.isArray(lifecycle)) return [];
  const record = lifecycle as Record<string, unknown>;
  const capability = arrayLength(record.capabilityTargets);
  const antipattern = arrayLength(record.antipatternTargets);
  if (capability === undefined || antipattern === undefined || capability === antipattern) return [];
  return [
    {
      code: 'TARGET_COUNT_EQUALS_GOVERNED_LIFECYCLE_STAGE_COUNT',
      path: '/lifecycleAssurance',
      message: `Capability targets (${String(capability)}) and anti-pattern targets (${String(antipattern)}) must follow the same governed lifecycle stage order.`
    }
  ];
}

function duplicateHandleFindings(output: unknown): Finding[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const mapping = (output as { referenceMapping?: unknown }).referenceMapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) return [];
  const record = mapping as Record<string, unknown>;
  const findings: Finding[] = [];
  for (const key of ['capabilityRelatedCriterionHandles', 'antipatternRelatedCriterionHandles'] as const) {
    const handles = record[key];
    if (!Array.isArray(handles)) continue;
    const seen = new Set<unknown>();
    handles.forEach((handle, index) => {
      if (seen.has(handle)) {
        findings.push({
          code: 'RELATED_CRITERION_HANDLES_UNIQUE_PER_OBJECT',
          path: `/referenceMapping/${key}/${String(index)}`,
          message: `Duplicate related-criterion handle ${String(handle)}.`
        });
      }
      seen.add(handle);
    });
  }
  return findings;
}

export function validateMappings(output: unknown, tier: StrictnessTier = 'RELEASE'): ValidationResult {
  return applyTier(
    schemaFindings(mappingsSchema, output),
    [...lifecycleCountFindings(output), ...duplicateHandleFindings(output)],
    tier
  );
}

export interface MappingsPromptSeed {
  plan: PipelinePlan;
  categoryBaseline: Record<string, unknown>;
  goldenReference: Record<string, unknown>;
  pairBoundary: unknown;
  apFailureModel: unknown;
  applicability: unknown;
  primaryQuestions: unknown;
  atomics: { capability: unknown; antipattern: unknown };
  evidence: { capability: unknown; antipattern: unknown };
  evidenceSafety: { capabilityRules: unknown; antipatternRules: unknown };
  apAbsence: unknown;
  sourceContextPacket: { packetSha256: string };
  sourceMappings: unknown;
  findings: { capability: unknown; antipattern: unknown; findingLogicNotes: unknown };
  controlBoundary: unknown;
}

function contract(partial: Omit<PromptContract, 'contractVersion' | 'failureMode'>): PromptContract {
  return { contractVersion: '2.0.0', failureMode: 'FAIL_CLOSED', ...partial };
}

function assertReferenceMappingTacticMode(plan: PipelinePlan): void {
  const hasCatalog = plan.baseline.tacticCatalogVersion !== null || plan.baseline.tacticCatalogSha256 !== null;
  if (hasCatalog || plan.tacticUniverse.length > 0) {
    throw new Error(
      'REFERENCE_MAPPING SIR v2 requires an approved reciprocal tactic-mapping packet when a sealed Tactic Catalog is present; tactic identity alone is insufficient.'
    );
  }
}

export function mappingsContracts(seed: MappingsPromptSeed): PromptContract[] {
  assertReferenceMappingTacticMode(seed.plan);
  const base = {
    authoring_plan_id: seed.plan.planId,
    authoring_plan_sha256: seed.plan.planSha256
  };
  return [
    contract({
      taskType: 'SOURCE_MAPPING',
      objective:
        'Create category-specific semantic source-mapping candidates using only the sealed Source Context Packet. Select supplied source and locator handles and state the bounded relationship, supported claim, rationale, applicability conditions and exclusions. Factual verification remains a separate downstream quality gate.',
      lockedInputs: {
        ...base,
        source_context_packet_sha256: seed.sourceContextPacket.packetSha256,
        source_context_packet: seed.sourceContextPacket,
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        applicability: seed.applicability,
        primary_questions: seed.primaryQuestions,
        capability_atomics: seed.atomics.capability,
        antipattern_atomics: seed.atomics.antipattern,
        capability_evidence: seed.evidence.capability,
        antipattern_evidence: seed.evidence.antipattern,
        capability_evidence_safety: seed.evidenceSafety.capabilityRules,
        antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
        ap_absence_contract: seed.apAbsence,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_PAIR_SIR_THROUGH_AP_ABSENCE',
        'SEALED_SOURCE_CONTEXT_PACKET',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not output source IDs, source versions/dates, verification status/dates, mapping IDs or canonical reference strings.',
        'Do not output an exact locator string; select only a supplied locatorHandle. Deterministic code materializes exact_locator.',
        'Do not invent a sourceHandle or locatorHandle that is absent from the Source Context Packet.',
        'Do not use general model memory to fill a missing article, clause, paragraph, control or source statement.',
        'Do not treat Source Register inclusion or domain coverage as proof that a category mapping is correct.',
        'Do not infer legal applicability, compliance, control satisfaction, residual-risk acceptance or decision authority from source registration or mapping.',
        'Do not represent voluntary guidance or a published standard as binding legislation.',
        'Do not infer protected licensed-source content that was withheld by the Source Context Packet.',
        'If the supplied source context is insufficient, return an unmappedClaims item with a governed reason instead of inventing support.',
        'Do not rewrite upstream category content, evidence, findings, controls, tactics or lifecycle consequences.',
        'Do not mark a mapping factually verified; factual/source support is checked by a separate quality gate.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirSourceMappingOutput',
        requiredFields: ['capabilityMappings', 'antipatternMappings', 'unmappedClaims', 'mappingNotes'],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'SOURCE_CONTEXT_PACKET_HASH_MATCH',
        'SOURCE_HANDLES_RESOLVE',
        'LOCATOR_HANDLES_RESOLVE_WITHIN_SELECTED_SOURCE',
        'NO_FREEFORM_EXACT_LOCATORS',
        'NO_CANONICAL_SOURCE_METADATA_IN_MODEL_OUTPUT',
        'SUPPORTED_CLAIM_AND_RATIONALE_NONEMPTY',
        'UNMAPPED_CLAIMS_USE_GOVERNED_REASONS',
        'NO_REGISTRATION_EQUALS_APPLICABILITY_OR_COMPLIANCE',
        'FACTUAL_VERIFICATION_REMAINS_DOWNSTREAM'
      ]
    }),
    contract({
      taskType: 'FINDING_ARCHITECTURE',
      objective:
        'Define semantic finding definitions for the validated capability and anti-pattern graphs. Each finding must select supplied same-object atomic and evidence handles, use only the governed conclusion-state vocabulary, and state severity, lifecycle consequence and human-lock semantics. Deterministic code assigns finding handles and later canonical FND-* IDs.',
      lockedInputs: {
        ...base,
        capability_conclusion_states: seed.plan.vocabulary.capabilityConclusionStates,
        antipattern_conclusion_states: seed.plan.vocabulary.antipatternConclusionStates,
        pair_boundary: seed.pairBoundary,
        ap_failure_model: seed.apFailureModel,
        applicability: seed.applicability,
        primary_questions: seed.primaryQuestions,
        capability_atomics: seed.atomics.capability,
        antipattern_atomics: seed.atomics.antipattern,
        capability_evidence: seed.evidence.capability,
        antipattern_evidence: seed.evidence.antipattern,
        capability_evidence_safety: seed.evidenceSafety.capabilityRules,
        antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
        ap_absence_contract: seed.apAbsence,
        source_mappings: seed.sourceMappings,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_PAIR_SIR_THROUGH_AP_ABSENCE',
        'VALIDATED_MATERIALIZED_SOURCE_MAPPINGS',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not create finding IDs or local finding handles; deterministic code assigns them after validation.',
        'Do not invent atomic or evidence handles. Use only supplied handles from the same capability or anti-pattern object.',
        'Do not reference capability atomic/evidence handles from an anti-pattern finding or vice versa.',
        'Do not use capability conclusion states for anti-pattern findings or anti-pattern conclusion states for capability findings.',
        'Do not treat a source mapping candidate as assessment-time evidence or as proof of control satisfaction.',
        'Do not hide or repair an unresolved source mapping inside a finding definition.',
        'Do not permit TESTED_ABSENT semantics to bypass the validated AP absence contract.',
        'Do not create hard gates, runtime authority, lifecycle assurance targets, tactic mappings or approvals.',
        'Do not assess a real system or create a locked finding instance; this task authors reusable Knowledge Base finding definitions.',
        'Do not infer legal compliance, residual-risk acceptance or lifecycle authorization.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirFindingArchitectureOutput',
        requiredFields: ['capabilityFindings', 'antipatternFindings', 'findingLogicNotes'],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'NO_MODEL_OWNED_FINDING_IDS_OR_HANDLES',
        'FINDING_ATOMIC_HANDLES_RESOLVE_TO_SAME_OBJECT',
        'FINDING_EVIDENCE_HANDLES_RESOLVE_TO_SAME_OBJECT',
        'FINDING_EVIDENCE_COVERS_SELECTED_ATOMICS',
        'OBJECT_SPECIFIC_CONCLUSION_STATE_VOCABULARY',
        'TESTED_ABSENT_REQUIRES_VALIDATED_ABSENCE_CONTRACT',
        'NO_SOURCE_MAPPING_SUBSTITUTES_FOR_EVIDENCE',
        'NO_CONTROL_OR_AUTHORITY_CONTENT'
      ]
    }),
    contract({
      taskType: 'CONTROL_BOUNDARY',
      objective:
        'Define only knowledge-level hard-gate semantics and machine/human decision boundaries for the validated capability and anti-pattern findings. Preserve all upstream findings. Use only the governed hard-gate vocabulary. State what machine reasoning may support, what it must never decide, and which decisions require human authority. Do not authorize any real-system lifecycle transition or approval.',
      lockedInputs: {
        ...base,
        governed_hard_gate_effects: seed.plan.vocabulary.hardGateEffects,
        pair_boundary: seed.pairBoundary,
        capability_findings: seed.findings.capability,
        antipattern_findings: seed.findings.antipattern,
        finding_logic_notes: seed.findings.findingLogicNotes,
        capability_evidence_safety: seed.evidenceSafety.capabilityRules,
        antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
        ap_absence_contract: seed.apAbsence,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_PAIR_BOUNDARY',
        'VERIFIED_MATERIALIZED_FINDINGS',
        'VALIDATED_SIR_EVIDENCE_SAFETY',
        'VALIDATED_SIR_AP_ABSENCE',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not create or return capability IDs, anti-pattern IDs, finding IDs or finding handles.',
        'Do not rewrite, merge, remove or reinterpret validated findings.',
        'Do not create new findings, evidence requirements, source mappings, tactic mappings or related criteria.',
        'Do not define lifecycle assurance targets or lifecycle-stage requirements; LIFECYCLE_ASSURANCE owns those semantics.',
        'Do not grant legal compliance, residual-risk acceptance, approval, exception approval, deployment authorization, continued-operation authorization or retirement authorization to a model.',
        'Do not permit machine reasoning to override a human-locked finding or a deterministic gate.',
        'Do not treat source registration, document presence or missing incidents as control satisfaction.',
        'Do not infer TESTED_ABSENT outside the validated AP absence contract.',
        'Do not copy hard-gate effect choices from the Golden reference without category-specific justification.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirControlBoundaryOutput',
        requiredFields: [
          'capabilityHardGate',
          'antipatternHardGate',
          'capabilityRuntimeBoundary',
          'antipatternRuntimeBoundary',
          'controlNotes'
        ],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'HARD_GATE_EFFECT_FROM_AUTHORING_PLAN',
        'RUNTIME_BOUNDARY_FAMILIES_NONEMPTY',
        'RUNTIME_BOUNDARY_ENTRIES_UNIQUE',
        'NO_EXACT_MACHINE_MAY_MUST_NOT_CONTRADICTION',
        'NO_EXACT_MACHINE_MAY_HUMAN_AUTHORITY_CONTRADICTION',
        'NO_MODEL_OWNED_CANONICAL_IDENTITY',
        'NO_LIFECYCLE_ASSURANCE_CONTENT',
        'NO_UPSTREAM_FINDING_REWRITE'
      ]
    }),
    contract({
      taskType: 'LIFECYCLE_ASSURANCE',
      objective:
        'Define minimum technical assurance and required human assurance for the capability and anti-pattern at every governed lifecycle stage. Return assurance values only, in exactly the same positional order as the locked lifecycle_stage_order. Deterministic code owns lifecycle-stage identity and will materialize stage names after validation. These are reusable knowledge targets, not approval or authorization decisions for a real system.',
      lockedInputs: {
        ...base,
        lifecycle_stage_order: seed.plan.vocabulary.lifecycleStages,
        governed_technical_assurance_vocabulary: seed.plan.vocabulary.technicalAssurance,
        governed_human_assurance_vocabulary: seed.plan.vocabulary.humanAssurance,
        pair_boundary: seed.pairBoundary,
        capability_evidence: seed.evidence.capability,
        antipattern_evidence: seed.evidence.antipattern,
        capability_evidence_sha256: canonicalArtifactHash(seed.evidence.capability),
        antipattern_evidence_sha256: canonicalArtifactHash(seed.evidence.antipattern),
        evidence_output_sha256: canonicalArtifactHash(seed.evidence),
        capability_evidence_safety: seed.evidenceSafety.capabilityRules,
        antipattern_evidence_safety: seed.evidenceSafety.antipatternRules,
        ap_absence_contract: seed.apAbsence,
        capability_findings: seed.findings.capability,
        antipattern_findings: seed.findings.antipattern,
        control_boundary: seed.controlBoundary,
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_PAIR_BOUNDARY',
        'VALIDATED_MATERIALIZED_SIR_EVIDENCE',
        'VALIDATED_SIR_EVIDENCE_SAFETY',
        'VALIDATED_SIR_AP_ABSENCE',
        'VERIFIED_MATERIALIZED_FINDINGS',
        'VERIFIED_PERSISTED_CONTROL_BOUNDARY',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not output capability IDs, anti-pattern IDs, lifecycle-stage names, indexes or canonical references.',
        'Do not add, remove, reorder or rename lifecycle stages.',
        'Do not create hard-gate semantics or runtime decision boundaries; CONTROL_BOUNDARY owns those semantics.',
        'Do not create findings, evidence requirements, source mappings, tactics or related-criteria relationships.',
        'Do not treat an assurance target as proof that the assurance has been achieved in a real system.',
        'Do not grant approval, deployment authorization, continued-operation authorization, residual-risk acceptance, legal compliance or retirement authorization.',
        'Do not weaken the AP tested-absence evidence boundary or infer absence from silence.',
        'Do not copy assurance values or progression patterns from the Golden reference without category-specific justification.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirLifecycleAssuranceOutput',
        requiredFields: ['capabilityTargets', 'antipatternTargets', 'rationaleNotes'],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'TARGET_COUNT_EQUALS_GOVERNED_LIFECYCLE_STAGE_COUNT',
        'TECHNICAL_ASSURANCE_FROM_AUTHORING_PLAN',
        'HUMAN_ASSURANCE_FROM_AUTHORING_PLAN',
        'NO_MODEL_OWNED_LIFECYCLE_STAGE_IDENTITY',
        'NO_MODEL_OWNED_CANONICAL_IDENTITY',
        'NO_LIFECYCLE_AUTHORIZATION_INFERENCE'
      ]
    }),
    contract({
      taskType: 'REFERENCE_MAPPING',
      objective:
        'Select only semantically justified related-criterion handles from the Authoring Plan adjacent-criterion universe for the capability and paired anti-pattern. Return handle selections and concise rationale notes only. Canonical criterion IDs are materialized deterministically. Tactic mappings are not model-authored and remain empty when no approved reciprocal tactic-mapping catalog is available.',
      lockedInputs: {
        ...base,
        pair_boundary: seed.pairBoundary,
        capability_findings: seed.findings.capability,
        antipattern_findings: seed.findings.antipattern,
        adjacent_criteria: seed.plan.adjacentCriteria,
        tactic_resolution_mode: 'NO_APPROVED_TACTIC_AVAILABLE',
        category_baseline: seed.categoryBaseline,
        golden_reference: seed.goldenReference
      },
      allowedReferences: [
        'AUTHORING_PLAN',
        'VALIDATED_PAIR_BOUNDARY',
        'VALIDATED_MATERIALIZED_FINDINGS',
        'AUTHORING_PLAN_ADJACENT_CRITERIA',
        'CATEGORY_BASELINE',
        'GOLDEN_REFERENCE'
      ],
      doNot: [
        'Do not output capability IDs, anti-pattern IDs, canonical criterion IDs or canonical references.',
        'Do not output tactic IDs, tactic handles, tactic versions, mapping IDs, finding IDs, relationship values, mapping status or catalog versions.',
        'Do not infer a tactic mapping from domain, keyword, semantic similarity, finding wording or the Golden reference.',
        'Do not select a criterion handle that is absent from adjacent_criteria.',
        'Do not add the target object itself as its own related criterion.',
        'Do not rewrite findings, boundaries, evidence, controls, lifecycle targets or source mappings.',
        'Do not treat the paired capability or anti-pattern as a mandatory related criterion merely because the Golden reference contains a paired link.',
        'Do not create approval facts or imply that a related-criterion selection proves compliance, control satisfaction or lifecycle authorization.'
      ],
      outputContract: {
        format: 'JSON',
        schemaName: 'SirReferenceMappingOutput',
        requiredFields: [
          'capabilityRelatedCriterionHandles',
          'antipatternRelatedCriterionHandles',
          'referenceNotes'
        ],
        additionalProperties: false
      },
      validationProfile: [
        'SIR_CONTENT_ONLY',
        'CRITERION_HANDLES_RESOLVE_IN_AUTHORING_PLAN',
        'RELATED_CRITERION_HANDLES_UNIQUE_PER_OBJECT',
        'NO_SELF_REFERENCE',
        'NO_MODEL_AUTHORED_CANONICAL_CRITERION_IDS',
        'NO_MODEL_AUTHORED_TACTIC_REFERENCES',
        'NO_APPROVED_TACTIC_AVAILABLE_FAIL_SAFE'
      ]
    })
  ];
}

export function buildMappingsPrompt(seed: MappingsPromptSeed): string {
  return joinTaskPrompts(mappingsContracts(seed).map((item) => renderTaskPrompt(item)));
}
