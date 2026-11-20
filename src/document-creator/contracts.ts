import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import formatsPlugin from 'ajv-formats';

export type StrictnessTier = 'DRAFT' | 'RELEASE';

export interface CreatorFinding {
  code: string;
  severity: 'ERROR' | 'WARNING';
  tier: StrictnessTier;
  path: string;
  message: string;
}

export interface InputConflict {
  conflict_id: string;
  sources: string[];
  affected_object_ids: string[];
  path: string;
  message: string;
  blocks_delivery: boolean;
}

export interface ProfileInputRef {
  role: string;
  kind:
    | 'source-register'
    | 'taxonomy'
    | 'id-register'
    | 'criteria-reference'
    | 'criteria-instrument'
    | 'cognitive-model'
    | 'tactic-playbook'
    | 'schema'
    | 'golden-capability'
    | 'golden-antipattern'
    | 'companion-reference';
  id: string;
  version: string;
  store: 'local' | 'vercel-blob';
  path: string;
  sha256: string;
  media_type: string;
  provenance: string;
  required: boolean;
}

export interface OwnerInputDecision {
  decision_id: string;
  role: string;
  target_id: string;
  version: string;
  sha256: string;
  effective_status: 'FINAL_OBJECT_LINKS_APPROVED';
  scope: string;
}

export interface ReferencePdfBinding {
  source_id: string;
  edition_version: string;
  path: string;
  sha256: string;
  usage_policy: 'PERMITTED_FULL' | 'PERMITTED_ATTRIBUTED_EXCERPT' | 'METADATA_LOCATOR_ONLY';
  rights_confirmed_for_model: boolean;
  provenance: string;
}

export interface HumanVerifiedExtraction {
  extraction_id: string;
  source_id: string;
  edition_version: string;
  locator_label: string;
  text: string;
  verified_by: string;
  verified_at: string;
  provenance_note: string;
  rights_confirmed_for_model: boolean;
}

export interface KbProfile {
  schema_version: '1.0.0';
  profile_id: string;
  profile_version: string;
  kb_id: string;
  kb_title: string;
  language: string;
  is_synthetic: boolean;
  domain_folder_tokens?: Record<string, string>;
  input_refs: ProfileInputRef[];
  owner_input_decisions: OwnerInputDecision[];
  reference_pdf_bindings?: ReferencePdfBinding[];
  human_verified_extractions?: HumanVerifiedExtraction[];
  output_spec: {
    document_types: Array<'capability' | 'antipattern' | 'tactic'>;
    required_sections: {
      capability: string[];
      antipattern: string[];
      tactic: string[];
    };
    primary_format: 'markdown';
    pdf_enabled: boolean;
    paired_work_unit: boolean;
    cross_domain_tactic_partition: string;
  };
  source_policy: {
    allowed_input_roots: string[];
    allowed_publication_hosts: string[];
    references_subdir: string;
    require_registered_sources: boolean;
    allow_model_egress_by_default: boolean;
    max_extract_bytes: number;
  };
  model_config_ref: {
    author_role: string;
    reviewer_role: string;
  };
  storage_ref: {
    connection_id: string;
    provider: 'local' | 'vercel-blob';
    location: string;
    output_root: string;
    operations_root: string;
    credential_secret_ref: string | null;
  };
  limits: {
    max_objects_per_run: number;
    provider_concurrency: number;
    request_timeout_ms: number;
    max_tokens_per_run: number;
    max_repair_iterations: number;
    max_extract_bytes: number;
  };
}

export interface ResolvedInputDescriptor {
  role: string;
  kind: ProfileInputRef['kind'];
  id: string;
  version: string;
  store: ProfileInputRef['store'];
  path: string;
  media_type: string;
  byte_length: number;
  sha256: string;
  provenance: string;
}

export interface AppliedOwnerDecision {
  decision_id: string;
  role: string;
  target_id: string;
  version: string;
  sha256: string;
  original_status_text: string;
  effective_status: string;
  scope: string;
}

export interface TacticAssociationSummary {
  tactic_id: string;
  title: string;
  version: string;
  owning_domain: string;
  related_domains: string[];
  linked_object_ids: string[];
  linked_question_ids: string[];
  reassessment_targets: string[];
  completion_effect: string;
  original_release_status: string;
  original_activation_status: string;
  effective_association_status: 'OBJECT_LINK_ASSOCIATED' | 'UNCONFIRMED_CANDIDATE';
  activation_authority: 'NONE_IN_CREATOR';
}

export interface ObjectCoverageEntry {
  kb_id: string;
  namespaced_object_id: string;
  object_id: string;
  object_type: 'capability' | 'antipattern';
  title: string;
  domain_id: string;
  domain_title: string;
  pair_id: string;
  paired_object_id: string;
  question_ids: string[];
  cognitive_requirements: string[];
  preset_source_ids: string[];
  unresolved_source_ids: string[];
  candidate_domain_source_ids: string[];
  source_coverage_level: 'PRESET_REGISTERED' | 'COARSE_DOMAIN_ONLY' | 'NONE';
  golden_role: 'GOLDEN_REFERENCE_PAIR' | 'TARGET_GENERATION_OBJECT';
  tactic_ids: string[];
  detail_gaps: string[];
  blocking_conflict_ids: string[];
}

export interface ResolvedInputSet {
  schema_version: '1.0.0';
  input_set_id: string;
  profile_id: string;
  profile_version: string;
  kb_id: string;
  kb_title: string;
  language: string;
  is_synthetic: boolean;
  storage: {
    connection_id: string;
    provider: 'local' | 'vercel-blob';
    output_root: string;
    operations_root: string;
    destination_ready: boolean;
  };
  resolved_inputs: ResolvedInputDescriptor[];
  applied_owner_decisions: AppliedOwnerDecision[];
  golden_reference: {
    pair_id: string;
    capability_id: string;
    antipattern_id: string;
    capability_version: string;
    antipattern_version: string;
  } | null;
  cognitive_model: {
    model_id: string;
    version: string;
    dimensions: string[];
    rules: string[];
  } | null;
  readiness: {
    tier: StrictnessTier;
    planning_ready: boolean;
    authoring_ready: boolean;
    delivery_ready: boolean;
    findings: CreatorFinding[];
  };
  conflicts: InputConflict[];
  source_summary: {
    registered_source_count: number;
    unused_registered_source_ids: string[];
    metadata_only_source_ids: string[];
  };
  coverage_matrix: ObjectCoverageEntry[];
}

export interface PlanQuestion {
  id: string;
  dimension: string;
  question: string;
}

export interface PlannedDocument {
  document_id: string;
  kb_id: string;
  object_id: string;
  object_type: 'capability' | 'antipattern' | 'tactic';
  storage_type: 'capabilities' | 'antipatterns' | 'tactics';
  domain_id: string;
  folder_token: string;
  title: string;
  paired_object_id: string | null;
  related_domains: string[];
  required_sections: string[];
  destination_path_template: string;
  questions: PlanQuestion[];
  tactic_associations: Array<{
    tactic_id: string;
    effective_association_status: TacticAssociationSummary['effective_association_status'];
    original_activation_status: string;
    activation_authority: 'NONE_IN_CREATOR';
  }>;
  preset_source_ids: string[];
  candidate_domain_source_ids: string[];
  detail_gaps: string[];
  blocking_conflict_ids: string[];
}

export interface PlannedWorkUnit {
  work_unit_id: string;
  unit_type: 'paired_capability_antipattern' | 'standalone_object' | 'tactic';
  pair_id: string | null;
  domain_id: string;
  document_ids: string[];
}

export interface DocumentPlanSelection {
  mode: 'pair' | 'domain' | 'explicit' | 'all';
  pair_ids?: string[];
  domain_ids?: string[];
  object_ids?: string[];
  include_tactics?: boolean;
  tactic_ids?: string[];
}

export interface DocumentPlan {
  schema_version: '1.0.0';
  plan_id: string;
  input_set_id: string;
  profile_id: string;
  kb_id: string;
  kb_title: string;
  is_synthetic: boolean;
  primary_format: 'markdown';
  pdf_enabled: boolean;
  selection: {
    mode: DocumentPlanSelection['mode'];
    pair_ids: string[];
    domain_ids: string[];
    object_ids: string[];
    include_tactics: boolean;
    tactic_ids: string[];
  };
  work_units: PlannedWorkUnit[];
  documents: PlannedDocument[];
  summary: {
    work_unit_count: number;
    capability_count: number;
    antipattern_count: number;
    tactic_count: number;
    total_documents: number;
    blocking_conflict_count: number;
  };
}

export type SourceExtractionStatus =
  | 'COMPLETE'
  | 'PARTIAL_TRUNCATED'
  | 'METADATA_ONLY'
  | 'SCANNED_UNSUPPORTED'
  | 'INACCESSIBLE'
  | 'REJECTED_POLICY';

export type SourceUsagePolicy =
  | 'PERMITTED_FULL'
  | 'PERMITTED_ATTRIBUTED_EXCERPT'
  | 'METADATA_LOCATOR_ONLY'
  | 'HUMAN_VERIFIED_EXTRACTION';

export interface SourceLocator {
  kind:
    | 'pdf_page_section'
    | 'html_section'
    | 'markdown_heading'
    | 'json_path'
    | 'plain_lines'
    | 'metadata_only';
  label: string;
  page: number | null;
  section: string | null;
}

export interface SourceUnit {
  source_unit_id: string;
  source_id: string;
  source_version: string;
  source_title: string;
  authority_tier: string;
  authority_type: string;
  origin_kind: 'registered_url' | 'bound_reference_pdf' | 'human_verified_excerpt' | 'register_metadata';
  original_sha256: string | null;
  locator: SourceLocator;
  text: string | null;
  extraction_status: SourceExtractionStatus;
  limitations: string[];
  usage_policy: SourceUsagePolicy;
  model_eligible: boolean;
  substantive_support_eligible: boolean;
  untrusted_content_flags: string[];
  human_verification: {
    verified_by: string;
    verified_at: string;
    provenance_note: string;
  } | null;
  retrieved_at: string;
  extractor_version: string;
  text_sha256: string | null;
}

export interface PreparedPairBaseline {
  pair_id: string;
  domain_id: string;
  criteria_from_pdf: {
    page_number: number;
    locator: string;
    capability_id: string;
    capability_title: string;
    capability_definition: string;
    applicability: string;
    capability_indicators: string[];
    antipattern_id: string;
    antipattern_title: string;
    antipattern_definition: string;
    antipattern_indicators: string[];
  } | null;
  thinking_flow_baseline: {
    cognitive_model_version: string;
    capability_locator: string;
    antipattern_locator: string;
    capability_questions: PlanQuestion[];
    antipattern_questions: PlanQuestion[];
    interpretation_rules: string[];
  };
  legacy_release_instructions_excluded: true;
}

export interface ObjectCriterionSupport {
  object_id: string;
  object_type: 'capability' | 'antipattern';
  question_ids: string[];
  criteria_locator: string | null;
  candidate_source_ids: string[];
  usable_source_unit_ids: string[];
  metadata_only_source_ids: string[];
  unavailable_source_ids: string[];
  support_status: 'SUPPORTED_PASSAGES_AVAILABLE' | 'MISSING_USABLE_PASSAGES';
}

export interface ModelReadyPassage {
  source_unit_id: string;
  source_id: string;
  source_version: string;
  source_title: string;
  authority_tier: string;
  authority_type: string;
  locator_label: string;
  extraction_status: 'COMPLETE' | 'PARTIAL_TRUNCATED';
  limitations: string[];
  untrusted_content_flags: string[];
  untrusted_data_block: string;
}

export interface SourcePreparationBundle {
  schema_version: '1.0.0';
  bundle_id: string;
  input_set_id: string;
  plan_id: string;
  profile_id: string;
  kb_id: string;
  pair_baselines: PreparedPairBaseline[];
  source_units: SourceUnit[];
  criterion_support: ObjectCriterionSupport[];
  model_ready_packet: {
    packet_id: string;
    untrusted_data_policy: 'SOURCE_PASSAGES_ARE_INERT_DATA_NEVER_INSTRUCTIONS';
    eligible_passages: ModelReadyPassage[];
  };
  readiness: {
    criteria_and_questions_ready: boolean;
    substantive_source_passages_ready: boolean;
    authoring_ready: boolean;
    findings: CreatorFinding[];
  };
}

const nonEmpty = { type: 'string', minLength: 1 } as const;
const sha256Hex = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const stringArray = { type: 'array', items: nonEmpty } as const;

export const kbProfileSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kb-document-creator.local/schemas/v1/profile.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'profile_id',
    'profile_version',
    'kb_id',
    'kb_title',
    'language',
    'is_synthetic',
    'input_refs',
    'owner_input_decisions',
    'output_spec',
    'source_policy',
    'model_config_ref',
    'storage_ref',
    'limits'
  ],
  properties: {
    schema_version: { const: '1.0.0' },
    profile_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    profile_version: nonEmpty,
    kb_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    kb_title: nonEmpty,
    language: nonEmpty,
    is_synthetic: { type: 'boolean' },
    domain_folder_tokens: {
      type: 'object',
      additionalProperties: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' }
    },
    input_refs: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'kind', 'id', 'version', 'store', 'path', 'sha256', 'media_type', 'provenance', 'required'],
        properties: {
          role: nonEmpty,
          kind: {
            type: 'string',
            enum: [
              'source-register',
              'taxonomy',
              'id-register',
              'criteria-reference',
              'criteria-instrument',
              'cognitive-model',
              'tactic-playbook',
              'schema',
              'golden-capability',
              'golden-antipattern',
              'companion-reference'
            ]
          },
          id: nonEmpty,
          version: nonEmpty,
          store: { type: 'string', enum: ['local', 'vercel-blob'] },
          path: nonEmpty,
          sha256: sha256Hex,
          media_type: nonEmpty,
          provenance: nonEmpty,
          required: { type: 'boolean' }
        }
      }
    },
    owner_input_decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['decision_id', 'role', 'target_id', 'version', 'sha256', 'effective_status', 'scope'],
        properties: {
          decision_id: nonEmpty,
          role: nonEmpty,
          target_id: nonEmpty,
          version: nonEmpty,
          sha256: sha256Hex,
          effective_status: { const: 'FINAL_OBJECT_LINKS_APPROVED' },
          scope: nonEmpty
        }
      }
    },
    reference_pdf_bindings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'source_id',
          'edition_version',
          'path',
          'sha256',
          'usage_policy',
          'rights_confirmed_for_model',
          'provenance'
        ],
        properties: {
          source_id: nonEmpty,
          edition_version: nonEmpty,
          path: nonEmpty,
          sha256: sha256Hex,
          usage_policy: {
            type: 'string',
            enum: ['PERMITTED_FULL', 'PERMITTED_ATTRIBUTED_EXCERPT', 'METADATA_LOCATOR_ONLY']
          },
          rights_confirmed_for_model: { type: 'boolean' },
          provenance: nonEmpty
        }
      }
    },
    human_verified_extractions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'extraction_id',
          'source_id',
          'edition_version',
          'locator_label',
          'text',
          'verified_by',
          'verified_at',
          'provenance_note',
          'rights_confirmed_for_model'
        ],
        properties: {
          extraction_id: nonEmpty,
          source_id: nonEmpty,
          edition_version: nonEmpty,
          locator_label: nonEmpty,
          text: nonEmpty,
          verified_by: nonEmpty,
          verified_at: nonEmpty,
          provenance_note: nonEmpty,
          rights_confirmed_for_model: { type: 'boolean' }
        }
      }
    },
    output_spec: {
      type: 'object',
      additionalProperties: false,
      required: [
        'document_types',
        'required_sections',
        'primary_format',
        'pdf_enabled',
        'paired_work_unit',
        'cross_domain_tactic_partition'
      ],
      properties: {
        document_types: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string', enum: ['capability', 'antipattern', 'tactic'] }
        },
        required_sections: {
          type: 'object',
          additionalProperties: false,
          required: ['capability', 'antipattern', 'tactic'],
          properties: {
            capability: { type: 'array', minItems: 1, items: nonEmpty },
            antipattern: { type: 'array', minItems: 1, items: nonEmpty },
            tactic: { type: 'array', minItems: 1, items: nonEmpty }
          }
        },
        primary_format: { const: 'markdown' },
        pdf_enabled: { type: 'boolean' },
        paired_work_unit: { type: 'boolean' },
        cross_domain_tactic_partition: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' }
      }
    },
    source_policy: {
      type: 'object',
      additionalProperties: false,
      required: [
        'allowed_input_roots',
        'allowed_publication_hosts',
        'references_subdir',
        'require_registered_sources',
        'allow_model_egress_by_default',
        'max_extract_bytes'
      ],
      properties: {
        allowed_input_roots: stringArray,
        allowed_publication_hosts: { type: 'array', items: nonEmpty },
        references_subdir: nonEmpty,
        require_registered_sources: { type: 'boolean' },
        allow_model_egress_by_default: { type: 'boolean' },
        max_extract_bytes: { type: 'integer', minimum: 1024 }
      }
    },
    model_config_ref: {
      type: 'object',
      additionalProperties: false,
      required: ['author_role', 'reviewer_role'],
      properties: {
        author_role: nonEmpty,
        reviewer_role: nonEmpty
      }
    },
    storage_ref: {
      type: 'object',
      additionalProperties: false,
      required: ['connection_id', 'provider', 'location', 'output_root', 'operations_root', 'credential_secret_ref'],
      properties: {
        connection_id: nonEmpty,
        provider: { type: 'string', enum: ['local', 'vercel-blob'] },
        location: nonEmpty,
        output_root: nonEmpty,
        operations_root: nonEmpty,
        credential_secret_ref: { type: ['string', 'null'] }
      }
    },
    limits: {
      type: 'object',
      additionalProperties: false,
      required: [
        'max_objects_per_run',
        'provider_concurrency',
        'request_timeout_ms',
        'max_tokens_per_run',
        'max_repair_iterations',
        'max_extract_bytes'
      ],
      properties: {
        max_objects_per_run: { type: 'integer', minimum: 1 },
        provider_concurrency: { type: 'integer', minimum: 1 },
        request_timeout_ms: { type: 'integer', minimum: 1000 },
        max_tokens_per_run: { type: 'integer', minimum: 100 },
        max_repair_iterations: { type: 'integer', minimum: 0 },
        max_extract_bytes: { type: 'integer', minimum: 1024 }
      }
    }
  }
} as const;

export const resolvedInputSetSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kb-document-creator.local/schemas/v1/input-set.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'input_set_id',
    'profile_id',
    'profile_version',
    'kb_id',
    'kb_title',
    'language',
    'is_synthetic',
    'storage',
    'resolved_inputs',
    'applied_owner_decisions',
    'golden_reference',
    'cognitive_model',
    'readiness',
    'conflicts',
    'source_summary',
    'coverage_matrix'
  ],
  properties: {
    schema_version: { const: '1.0.0' },
    input_set_id: sha256Hex,
    profile_id: nonEmpty,
    profile_version: nonEmpty,
    kb_id: nonEmpty,
    kb_title: nonEmpty,
    language: nonEmpty,
    is_synthetic: { type: 'boolean' },
    storage: {
      type: 'object',
      additionalProperties: false,
      required: ['connection_id', 'provider', 'output_root', 'operations_root', 'destination_ready'],
      properties: {
        connection_id: nonEmpty,
        provider: { type: 'string', enum: ['local', 'vercel-blob'] },
        output_root: nonEmpty,
        operations_root: nonEmpty,
        destination_ready: { type: 'boolean' }
      }
    },
    resolved_inputs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['role', 'kind', 'id', 'version', 'store', 'path', 'media_type', 'byte_length', 'sha256', 'provenance'],
        properties: {
          role: nonEmpty,
          kind: nonEmpty,
          id: nonEmpty,
          version: nonEmpty,
          store: { type: 'string', enum: ['local', 'vercel-blob'] },
          path: nonEmpty,
          media_type: nonEmpty,
          byte_length: { type: 'integer', minimum: 0 },
          sha256: sha256Hex,
          provenance: nonEmpty
        }
      }
    },
    applied_owner_decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'decision_id',
          'role',
          'target_id',
          'version',
          'sha256',
          'original_status_text',
          'effective_status',
          'scope'
        ],
        properties: {
          decision_id: nonEmpty,
          role: nonEmpty,
          target_id: nonEmpty,
          version: nonEmpty,
          sha256: sha256Hex,
          original_status_text: nonEmpty,
          effective_status: nonEmpty,
          scope: nonEmpty
        }
      }
    },
    golden_reference: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['pair_id', 'capability_id', 'antipattern_id', 'capability_version', 'antipattern_version'],
      properties: {
        pair_id: nonEmpty,
        capability_id: nonEmpty,
        antipattern_id: nonEmpty,
        capability_version: nonEmpty,
        antipattern_version: nonEmpty
      }
    },
    cognitive_model: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['model_id', 'version', 'dimensions', 'rules'],
      properties: {
        model_id: nonEmpty,
        version: nonEmpty,
        dimensions: stringArray,
        rules: stringArray
      }
    },
    readiness: {
      type: 'object',
      additionalProperties: false,
      required: ['tier', 'planning_ready', 'authoring_ready', 'delivery_ready', 'findings'],
      properties: {
        tier: { type: 'string', enum: ['DRAFT', 'RELEASE'] },
        planning_ready: { type: 'boolean' },
        authoring_ready: { type: 'boolean' },
        delivery_ready: { type: 'boolean' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'severity', 'tier', 'path', 'message'],
            properties: {
              code: nonEmpty,
              severity: { type: 'string', enum: ['ERROR', 'WARNING'] },
              tier: { type: 'string', enum: ['DRAFT', 'RELEASE'] },
              path: nonEmpty,
              message: nonEmpty
            }
          }
        }
      }
    },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['conflict_id', 'sources', 'affected_object_ids', 'path', 'message', 'blocks_delivery'],
        properties: {
          conflict_id: nonEmpty,
          sources: stringArray,
          affected_object_ids: { type: 'array', items: nonEmpty },
          path: nonEmpty,
          message: nonEmpty,
          blocks_delivery: { type: 'boolean' }
        }
      }
    },
    source_summary: {
      type: 'object',
      additionalProperties: false,
      required: ['registered_source_count', 'unused_registered_source_ids', 'metadata_only_source_ids'],
      properties: {
        registered_source_count: { type: 'integer', minimum: 0 },
        unused_registered_source_ids: { type: 'array', items: nonEmpty },
        metadata_only_source_ids: { type: 'array', items: nonEmpty }
      }
    },
    coverage_matrix: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'kb_id',
          'namespaced_object_id',
          'object_id',
          'object_type',
          'title',
          'domain_id',
          'domain_title',
          'pair_id',
          'paired_object_id',
          'question_ids',
          'cognitive_requirements',
          'preset_source_ids',
          'unresolved_source_ids',
          'candidate_domain_source_ids',
          'source_coverage_level',
          'golden_role',
          'tactic_ids',
          'detail_gaps',
          'blocking_conflict_ids'
        ],
        properties: {
          kb_id: nonEmpty,
          namespaced_object_id: nonEmpty,
          object_id: nonEmpty,
          object_type: { type: 'string', enum: ['capability', 'antipattern'] },
          title: nonEmpty,
          domain_id: nonEmpty,
          domain_title: nonEmpty,
          pair_id: nonEmpty,
          paired_object_id: nonEmpty,
          question_ids: stringArray,
          cognitive_requirements: stringArray,
          preset_source_ids: { type: 'array', items: nonEmpty },
          unresolved_source_ids: { type: 'array', items: nonEmpty },
          candidate_domain_source_ids: { type: 'array', items: nonEmpty },
          source_coverage_level: {
            type: 'string',
            enum: ['PRESET_REGISTERED', 'COARSE_DOMAIN_ONLY', 'NONE']
          },
          golden_role: {
            type: 'string',
            enum: ['GOLDEN_REFERENCE_PAIR', 'TARGET_GENERATION_OBJECT']
          },
          tactic_ids: { type: 'array', items: nonEmpty },
          detail_gaps: { type: 'array', items: nonEmpty },
          blocking_conflict_ids: { type: 'array', items: nonEmpty }
        }
      }
    }
  }
} as const;

export const documentPlanSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kb-document-creator.local/schemas/v1/output-plan.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'plan_id',
    'input_set_id',
    'profile_id',
    'kb_id',
    'kb_title',
    'is_synthetic',
    'primary_format',
    'pdf_enabled',
    'selection',
    'work_units',
    'documents',
    'summary'
  ],
  properties: {
    schema_version: { const: '1.0.0' },
    plan_id: sha256Hex,
    input_set_id: sha256Hex,
    profile_id: nonEmpty,
    kb_id: nonEmpty,
    kb_title: nonEmpty,
    is_synthetic: { type: 'boolean' },
    primary_format: { const: 'markdown' },
    pdf_enabled: { type: 'boolean' },
    selection: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'pair_ids', 'domain_ids', 'object_ids', 'include_tactics', 'tactic_ids'],
      properties: {
        mode: { type: 'string', enum: ['pair', 'domain', 'explicit', 'all'] },
        pair_ids: { type: 'array', items: nonEmpty },
        domain_ids: { type: 'array', items: nonEmpty },
        object_ids: { type: 'array', items: nonEmpty },
        include_tactics: { type: 'boolean' },
        tactic_ids: { type: 'array', items: nonEmpty }
      }
    },
    work_units: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['work_unit_id', 'unit_type', 'pair_id', 'domain_id', 'document_ids'],
        properties: {
          work_unit_id: nonEmpty,
          unit_type: { type: 'string', enum: ['paired_capability_antipattern', 'standalone_object', 'tactic'] },
          pair_id: { type: ['string', 'null'] },
          domain_id: nonEmpty,
          document_ids: { type: 'array', minItems: 1, items: nonEmpty }
        }
      }
    },
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'document_id',
          'kb_id',
          'object_id',
          'object_type',
          'storage_type',
          'domain_id',
          'folder_token',
          'title',
          'paired_object_id',
          'related_domains',
          'required_sections',
          'destination_path_template',
          'questions',
          'tactic_associations',
          'preset_source_ids',
          'candidate_domain_source_ids',
          'detail_gaps',
          'blocking_conflict_ids'
        ],
        properties: {
          document_id: nonEmpty,
          kb_id: nonEmpty,
          object_id: nonEmpty,
          object_type: { type: 'string', enum: ['capability', 'antipattern', 'tactic'] },
          storage_type: { type: 'string', enum: ['capabilities', 'antipatterns', 'tactics'] },
          domain_id: nonEmpty,
          folder_token: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' },
          title: nonEmpty,
          paired_object_id: { type: ['string', 'null'] },
          related_domains: { type: 'array', items: nonEmpty },
          required_sections: { type: 'array', minItems: 1, items: nonEmpty },
          destination_path_template: nonEmpty,
          questions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'dimension', 'question'],
              properties: {
                id: nonEmpty,
                dimension: nonEmpty,
                question: nonEmpty
              }
            }
          },
          tactic_associations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'tactic_id',
                'effective_association_status',
                'original_activation_status',
                'activation_authority'
              ],
              properties: {
                tactic_id: nonEmpty,
                effective_association_status: {
                  type: 'string',
                  enum: ['OBJECT_LINK_ASSOCIATED', 'UNCONFIRMED_CANDIDATE']
                },
                original_activation_status: nonEmpty,
                activation_authority: { const: 'NONE_IN_CREATOR' }
              }
            }
          },
          preset_source_ids: { type: 'array', items: nonEmpty },
          candidate_domain_source_ids: { type: 'array', items: nonEmpty },
          detail_gaps: { type: 'array', items: nonEmpty },
          blocking_conflict_ids: { type: 'array', items: nonEmpty }
        }
      }
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'work_unit_count',
        'capability_count',
        'antipattern_count',
        'tactic_count',
        'total_documents',
        'blocking_conflict_count'
      ],
      properties: {
        work_unit_count: { type: 'integer', minimum: 0 },
        capability_count: { type: 'integer', minimum: 0 },
        antipattern_count: { type: 'integer', minimum: 0 },
        tactic_count: { type: 'integer', minimum: 0 },
        total_documents: { type: 'integer', minimum: 0 },
        blocking_conflict_count: { type: 'integer', minimum: 0 }
      }
    }
  }
} as const;

const compiledValidators = new Map<string, ValidateFunction>();

export function addAjvFormats(ajv: Ajv2020): void {
  const plugin =
    typeof formatsPlugin === 'function'
      ? formatsPlugin
      : (formatsPlugin as unknown as { default: (instance: Ajv2020) => void }).default;
  plugin(ajv);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ajvFindingPath(error: ErrorObject): string {
  const base = error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/';
  if (error.keyword === 'required' && isRecord(error.params) && typeof error.params.missingProperty === 'string') {
    return base === '/' ? `/${error.params.missingProperty}` : `${base}/${error.params.missingProperty}`;
  }
  if (
    error.keyword === 'additionalProperties' &&
    isRecord(error.params) &&
    typeof error.params.additionalProperty === 'string'
  ) {
    return base === '/' ? `/${error.params.additionalProperty}` : `${base}/${error.params.additionalProperty}`;
  }
  return base;
}

export function creatorFindingsFromAjv(
  errors: ErrorObject[] | null | undefined,
  tier: StrictnessTier = 'DRAFT'
): CreatorFinding[] {
  if (!errors?.length) return [];
  return errors.map((error) => ({
    code: `SCHEMA_${error.keyword.toUpperCase()}`,
    severity: 'ERROR',
    tier,
    path: ajvFindingPath(error),
    message: error.message ?? 'schema validation failed'
  }));
}

function getCompiledSchema(schema: object & { $id: string }): ValidateFunction {
  const cached = compiledValidators.get(schema.$id);
  if (cached) return cached;
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addAjvFormats(ajv);
  const validator = ajv.compile(schema);
  compiledValidators.set(schema.$id, validator);
  return validator;
}

export function collectIllustrativePlaceholderFindings(
  value: unknown,
  currentPath = '/',
  tier: StrictnessTier = 'DRAFT'
): CreatorFinding[] {
  const findings: CreatorFinding[] = [];
  if (typeof value === 'string') {
    if (/\bEXAMPLE\b/.test(value) || /[<>]/.test(value)) {
      findings.push({
        code: 'ILLUSTRATIVE_PLACEHOLDER_REJECTED',
        severity: 'ERROR',
        tier,
        path: currentPath,
        message: 'Illustrative EXAMPLE or angle-bracket placeholders are not valid Creator inputs.'
      });
    }
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findings.push(...collectIllustrativePlaceholderFindings(entry, `${currentPath === '/' ? '' : currentPath}/${index}`, tier));
    });
    return findings;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      findings.push(...collectIllustrativePlaceholderFindings(entry, `${currentPath === '/' ? '' : currentPath}/${key}`, tier));
    }
  }
  return findings;
}

export function validateKbProfile(candidate: unknown, tier: StrictnessTier = 'DRAFT'): CreatorFinding[] {
  const validator = getCompiledSchema(kbProfileSchema);
  const ok = validator(candidate) === true;
  return [
    ...(ok ? [] : creatorFindingsFromAjv(validator.errors, tier)),
    ...collectIllustrativePlaceholderFindings(candidate, '/', tier)
  ];
}

export function validateResolvedInputSet(candidate: unknown, tier: StrictnessTier = 'DRAFT'): CreatorFinding[] {
  const validator = getCompiledSchema(resolvedInputSetSchema);
  const ok = validator(candidate) === true;
  return ok ? [] : creatorFindingsFromAjv(validator.errors, tier);
}

export function validateDocumentPlan(candidate: unknown, tier: StrictnessTier = 'DRAFT'): CreatorFinding[] {
  const validator = getCompiledSchema(documentPlanSchema);
  const ok = validator(candidate) === true;
  return ok ? [] : creatorFindingsFromAjv(validator.errors, tier);
}

export const sourceUnitSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kb-document-creator.local/schemas/v1/source-unit.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'source_unit_id',
    'source_id',
    'source_version',
    'source_title',
    'authority_tier',
    'authority_type',
    'origin_kind',
    'original_sha256',
    'locator',
    'text',
    'extraction_status',
    'limitations',
    'usage_policy',
    'model_eligible',
    'substantive_support_eligible',
    'untrusted_content_flags',
    'human_verification',
    'retrieved_at',
    'extractor_version',
    'text_sha256'
  ],
  properties: {
    source_unit_id: sha256Hex,
    source_id: nonEmpty,
    source_version: nonEmpty,
    source_title: nonEmpty,
    authority_tier: nonEmpty,
    authority_type: nonEmpty,
    origin_kind: {
      type: 'string',
      enum: ['registered_url', 'bound_reference_pdf', 'human_verified_excerpt', 'register_metadata']
    },
    original_sha256: { anyOf: [sha256Hex, { type: 'null' }] },
    locator: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'label', 'page', 'section'],
      properties: {
        kind: {
          type: 'string',
          enum: [
            'pdf_page_section',
            'html_section',
            'markdown_heading',
            'json_path',
            'plain_lines',
            'metadata_only'
          ]
        },
        label: nonEmpty,
        page: { type: ['integer', 'null'], minimum: 1 },
        section: { type: ['string', 'null'] }
      }
    },
    text: { type: ['string', 'null'] },
    extraction_status: {
      type: 'string',
      enum: [
        'COMPLETE',
        'PARTIAL_TRUNCATED',
        'METADATA_ONLY',
        'SCANNED_UNSUPPORTED',
        'INACCESSIBLE',
        'REJECTED_POLICY'
      ]
    },
    limitations: { type: 'array', items: nonEmpty },
    usage_policy: {
      type: 'string',
      enum: [
        'PERMITTED_FULL',
        'PERMITTED_ATTRIBUTED_EXCERPT',
        'METADATA_LOCATOR_ONLY',
        'HUMAN_VERIFIED_EXTRACTION'
      ]
    },
    model_eligible: { type: 'boolean' },
    substantive_support_eligible: { type: 'boolean' },
    untrusted_content_flags: { type: 'array', items: nonEmpty },
    human_verification: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['verified_by', 'verified_at', 'provenance_note'],
      properties: {
        verified_by: nonEmpty,
        verified_at: nonEmpty,
        provenance_note: nonEmpty
      }
    },
    retrieved_at: nonEmpty,
    extractor_version: nonEmpty,
    text_sha256: { anyOf: [sha256Hex, { type: 'null' }] }
  }
} as const;

export const sourcePreparationBundleSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kb-document-creator.local/schemas/v1/source-preparation.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'bundle_id',
    'input_set_id',
    'plan_id',
    'profile_id',
    'kb_id',
    'pair_baselines',
    'source_units',
    'criterion_support',
    'model_ready_packet',
    'readiness'
  ],
  properties: {
    schema_version: { const: '1.0.0' },
    bundle_id: sha256Hex,
    input_set_id: sha256Hex,
    plan_id: sha256Hex,
    profile_id: nonEmpty,
    kb_id: nonEmpty,
    pair_baselines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'pair_id',
          'domain_id',
          'criteria_from_pdf',
          'thinking_flow_baseline',
          'legacy_release_instructions_excluded'
        ],
        properties: {
          pair_id: nonEmpty,
          domain_id: nonEmpty,
          criteria_from_pdf: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: [
              'page_number',
              'locator',
              'capability_id',
              'capability_title',
              'capability_definition',
              'applicability',
              'capability_indicators',
              'antipattern_id',
              'antipattern_title',
              'antipattern_definition',
              'antipattern_indicators'
            ],
            properties: {
              page_number: { type: 'integer', minimum: 1 },
              locator: nonEmpty,
              capability_id: nonEmpty,
              capability_title: nonEmpty,
              capability_definition: nonEmpty,
              applicability: nonEmpty,
              capability_indicators: { type: 'array', items: nonEmpty },
              antipattern_id: nonEmpty,
              antipattern_title: nonEmpty,
              antipattern_definition: nonEmpty,
              antipattern_indicators: { type: 'array', items: nonEmpty }
            }
          },
          thinking_flow_baseline: {
            type: 'object',
            additionalProperties: false,
            required: [
              'cognitive_model_version',
              'capability_locator',
              'antipattern_locator',
              'capability_questions',
              'antipattern_questions',
              'interpretation_rules'
            ],
            properties: {
              cognitive_model_version: nonEmpty,
              capability_locator: nonEmpty,
              antipattern_locator: nonEmpty,
              capability_questions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'dimension', 'question'],
                  properties: {
                    id: nonEmpty,
                    dimension: nonEmpty,
                    question: nonEmpty
                  }
                }
              },
              antipattern_questions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['id', 'dimension', 'question'],
                  properties: {
                    id: nonEmpty,
                    dimension: nonEmpty,
                    question: nonEmpty
                  }
                }
              },
              interpretation_rules: stringArray
            }
          },
          legacy_release_instructions_excluded: { const: true }
        }
      }
    },
    source_units: {
      type: 'array',
      items: {
        type: 'object',
        required: sourceUnitSchema.required,
        additionalProperties: false,
        properties: sourceUnitSchema.properties
      }
    },
    criterion_support: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'object_id',
          'object_type',
          'question_ids',
          'criteria_locator',
          'candidate_source_ids',
          'usable_source_unit_ids',
          'metadata_only_source_ids',
          'unavailable_source_ids',
          'support_status'
        ],
        properties: {
          object_id: nonEmpty,
          object_type: { type: 'string', enum: ['capability', 'antipattern'] },
          question_ids: stringArray,
          criteria_locator: { type: ['string', 'null'] },
          candidate_source_ids: { type: 'array', items: nonEmpty },
          usable_source_unit_ids: { type: 'array', items: nonEmpty },
          metadata_only_source_ids: { type: 'array', items: nonEmpty },
          unavailable_source_ids: { type: 'array', items: nonEmpty },
          support_status: {
            type: 'string',
            enum: ['SUPPORTED_PASSAGES_AVAILABLE', 'MISSING_USABLE_PASSAGES']
          }
        }
      }
    },
    model_ready_packet: {
      type: 'object',
      additionalProperties: false,
      required: ['packet_id', 'untrusted_data_policy', 'eligible_passages'],
      properties: {
        packet_id: sha256Hex,
        untrusted_data_policy: { const: 'SOURCE_PASSAGES_ARE_INERT_DATA_NEVER_INSTRUCTIONS' },
        eligible_passages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'source_unit_id',
              'source_id',
              'source_version',
              'source_title',
              'authority_tier',
              'authority_type',
              'locator_label',
              'extraction_status',
              'limitations',
              'untrusted_content_flags',
              'untrusted_data_block'
            ],
            properties: {
              source_unit_id: sha256Hex,
              source_id: nonEmpty,
              source_version: nonEmpty,
              source_title: nonEmpty,
              authority_tier: nonEmpty,
              authority_type: nonEmpty,
              locator_label: nonEmpty,
              extraction_status: { type: 'string', enum: ['COMPLETE', 'PARTIAL_TRUNCATED'] },
              limitations: { type: 'array', items: nonEmpty },
              untrusted_content_flags: { type: 'array', items: nonEmpty },
              untrusted_data_block: nonEmpty
            }
          }
        }
      }
    },
    readiness: {
      type: 'object',
      additionalProperties: false,
      required: [
        'criteria_and_questions_ready',
        'substantive_source_passages_ready',
        'authoring_ready',
        'findings'
      ],
      properties: {
        criteria_and_questions_ready: { type: 'boolean' },
        substantive_source_passages_ready: { type: 'boolean' },
        authoring_ready: { type: 'boolean' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'severity', 'tier', 'path', 'message'],
            properties: {
              code: nonEmpty,
              severity: { type: 'string', enum: ['ERROR', 'WARNING'] },
              tier: { type: 'string', enum: ['DRAFT', 'RELEASE'] },
              path: nonEmpty,
              message: nonEmpty
            }
          }
        }
      }
    }
  }
} as const;

export function validateSourceUnit(candidate: unknown, tier: StrictnessTier = 'DRAFT'): CreatorFinding[] {
  const validator = getCompiledSchema(sourceUnitSchema);
  const ok = validator(candidate) === true;
  return ok ? [] : creatorFindingsFromAjv(validator.errors, tier);
}

export function validateSourcePreparationBundle(
  candidate: unknown,
  tier: StrictnessTier = 'DRAFT'
): CreatorFinding[] {
  const validator = getCompiledSchema(sourcePreparationBundleSchema);
  const ok = validator(candidate) === true;
  return ok ? [] : creatorFindingsFromAjv(validator.errors, tier);
}

export type CreationReviewState =
  | 'DRAFT_UNREVIEWED'
  | 'DRAFT_BLOCKED_VALIDATION'
  | 'REVIEW_REQUIRED';

export interface CreatorDocumentSection {
  section_id: string;
  section_code: string;
  title: string;
  required: boolean;
  status: 'POPULATED' | 'MISSING_REQUIRED';
  prose: string;
  bullets: string[];
  question_refs: string[];
  source_unit_refs: string[];
}

export interface CreatorOmittedOptionalSection {
  section_id: string;
  section_code: string;
  title: string;
  reason: string;
}

export interface CreatorDocumentQuestion {
  id: string;
  dimension: string;
  question: string;
  assessment_guidance: string;
}

export interface CreatorAssessmentBoundaries {
  unknown_handling: string[];
  contradiction_handling: string[];
  false_positive_guards: string[];
  prohibited_inferences: string[];
  human_decision_boundaries: string[];
  evidence_ceilings: string[];
  paired_independence_rule: string;
  failure_mechanism: string | null;
  observable_indicators: string[];
  non_examples: string[];
  tested_absence_requirements: string[];
}

export interface CitedSourceAssertion {
  source_unit_id: string;
  asserted_source_id: string | null;
  asserted_source_version: string | null;
  asserted_locator: string | null;
}

export interface CreatorSourcedClaim {
  claim_id: string;
  section_id: string;
  statement: string;
  support_state: 'SOURCE_SUPPORTED' | 'UNRESOLVED';
  source_unit_ids: string[];
  authority_distinction:
    | 'BINDING_LEGISLATION_WHEN_APPLICABLE'
    | 'AUTHORITATIVE_STANDARD_OR_GUIDANCE'
    | 'UNRESOLVED_SOURCE_BASIS';
  applicability_note: string;
  unresolved_reason: string | null;
  cited_source_assertions: CitedSourceAssertion[];
}

export interface CreatorMethodologyInterpretation {
  interpretation_id: string;
  section_id: string;
  statement: string;
  cognitive_rule_refs: string[];
  question_ids: string[];
}

export interface CreatorRelatedObjectLink {
  target_object_id: string;
  relationship_kind: 'PAIRED_CAPABILITY' | 'PAIRED_ANTIPATTERN' | 'RELATED_TAXONOMY_OBJECT';
  non_inverse_meaning: string;
}

export interface CreatorTacticAssociationRef {
  tactic_id: string;
  title: string;
  version: string;
  effective_association_status: TacticAssociationSummary['effective_association_status'];
  original_release_status: string;
  original_activation_status: string;
  completion_effect: string;
  activation_authority: 'NONE_IN_CREATOR';
  scope_and_boundary_note: string;
}

export interface CreatorBibliographyEntry {
  source_unit_id: string;
  source_id: string;
  source_title: string;
  edition_version: string;
  authority_tier: string;
  authority_type: string;
  origin_kind: SourceUnit['origin_kind'];
  locator_label: string;
  extraction_status: 'COMPLETE' | 'PARTIAL_TRUNCATED';
  usage_policy: SourceUsagePolicy;
  limitations: string[];
}

export interface CreatorUnresolvedItem {
  item_id: string;
  category:
    | 'MISSING_SOURCE_SUPPORT'
    | 'UNRESOLVED_REFERENCE_HANDLE'
    | 'SOURCE_TRUNCATION_WARNING'
    | 'UNCONFIRMED_TACTIC_CANDIDATE'
    | 'INPUT_CONFLICT';
  section_id: string;
  summary: string;
  blocks_delivery: boolean;
}

export interface CreatorDocument {
  schema_version: '1.0.0';
  document_id: string;
  kb_id: string;
  kb_title: string;
  is_synthetic: boolean;
  object_id: string;
  object_type: 'capability' | 'antipattern';
  document_version: string;
  title: string;
  domain_id: string;
  domain_title: string;
  pair_id: string;
  paired_object_id: string;
  language: string;
  destination_path_template: string;
  input_set_id: string;
  plan_id: string;
  source_bundle_id: string;
  creation_review_state: CreationReviewState;
  hub_approval_status: 'NOT_GRANTED_BY_CREATOR';
  provenance: {
    profile_id: string;
    profile_version: string;
    criteria_locator: string | null;
    thinking_flow_locator: string;
    cognitive_model_version: string;
    golden_calibration_pair_id: string | null;
    applied_owner_decision_ids: string[];
    authored_at: string;
    provider: string;
    model: string;
    prompt_hash: string;
    content_sha256: string;
  };
  sections: CreatorDocumentSection[];
  omitted_optional_sections: CreatorOmittedOptionalSection[];
  questions: CreatorDocumentQuestion[];
  assessment_boundaries: CreatorAssessmentBoundaries;
  sourced_claims: CreatorSourcedClaim[];
  methodology_interpretations: CreatorMethodologyInterpretation[];
  related_object_links: CreatorRelatedObjectLink[];
  tactic_associations: CreatorTacticAssociationRef[];
  bibliography: CreatorBibliographyEntry[];
  unresolved_items: CreatorUnresolvedItem[];
  rejected_authoring_attempts: CreatorFinding[];
}

export const creatorDocumentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://kb-document-creator.local/schemas/v1/document.schema.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'document_id',
    'kb_id',
    'kb_title',
    'is_synthetic',
    'object_id',
    'object_type',
    'document_version',
    'title',
    'domain_id',
    'domain_title',
    'pair_id',
    'paired_object_id',
    'language',
    'destination_path_template',
    'input_set_id',
    'plan_id',
    'source_bundle_id',
    'creation_review_state',
    'hub_approval_status',
    'provenance',
    'sections',
    'omitted_optional_sections',
    'questions',
    'assessment_boundaries',
    'sourced_claims',
    'methodology_interpretations',
    'related_object_links',
    'tactic_associations',
    'bibliography',
    'unresolved_items',
    'rejected_authoring_attempts'
  ],
  properties: {
    schema_version: { const: '1.0.0' },
    document_id: nonEmpty,
    kb_id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]*$' },
    kb_title: nonEmpty,
    is_synthetic: { type: 'boolean' },
    object_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' },
    object_type: { type: 'string', enum: ['capability', 'antipattern'] },
    document_version: nonEmpty,
    title: nonEmpty,
    domain_id: nonEmpty,
    domain_title: nonEmpty,
    pair_id: nonEmpty,
    paired_object_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' },
    language: nonEmpty,
    destination_path_template: nonEmpty,
    input_set_id: sha256Hex,
    plan_id: sha256Hex,
    source_bundle_id: sha256Hex,
    creation_review_state: {
      type: 'string',
      enum: ['DRAFT_UNREVIEWED', 'DRAFT_BLOCKED_VALIDATION', 'REVIEW_REQUIRED']
    },
    hub_approval_status: { const: 'NOT_GRANTED_BY_CREATOR' },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: [
        'profile_id',
        'profile_version',
        'criteria_locator',
        'thinking_flow_locator',
        'cognitive_model_version',
        'golden_calibration_pair_id',
        'applied_owner_decision_ids',
        'authored_at',
        'provider',
        'model',
        'prompt_hash',
        'content_sha256'
      ],
      properties: {
        profile_id: nonEmpty,
        profile_version: nonEmpty,
        criteria_locator: { type: ['string', 'null'] },
        thinking_flow_locator: nonEmpty,
        cognitive_model_version: nonEmpty,
        golden_calibration_pair_id: { type: ['string', 'null'] },
        applied_owner_decision_ids: { type: 'array', items: nonEmpty },
        authored_at: nonEmpty,
        provider: nonEmpty,
        model: nonEmpty,
        prompt_hash: sha256Hex,
        content_sha256: sha256Hex
      }
    },
    sections: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'section_id',
          'section_code',
          'title',
          'required',
          'status',
          'prose',
          'bullets',
          'question_refs',
          'source_unit_refs'
        ],
        properties: {
          section_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+$' },
          section_code: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
          title: nonEmpty,
          required: { type: 'boolean' },
          status: { type: 'string', enum: ['POPULATED', 'MISSING_REQUIRED'] },
          prose: { type: 'string' },
          bullets: { type: 'array', items: nonEmpty },
          question_refs: { type: 'array', items: nonEmpty },
          source_unit_refs: { type: 'array', items: nonEmpty }
        }
      }
    },
    omitted_optional_sections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section_id', 'section_code', 'title', 'reason'],
        properties: {
          section_id: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+$' },
          section_code: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' },
          title: nonEmpty,
          reason: nonEmpty
        }
      }
    },
    questions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'dimension', 'question', 'assessment_guidance'],
        properties: {
          id: nonEmpty,
          dimension: nonEmpty,
          question: nonEmpty,
          assessment_guidance: nonEmpty
        }
      }
    },
    assessment_boundaries: {
      type: 'object',
      additionalProperties: false,
      required: [
        'unknown_handling',
        'contradiction_handling',
        'false_positive_guards',
        'prohibited_inferences',
        'human_decision_boundaries',
        'evidence_ceilings',
        'paired_independence_rule',
        'failure_mechanism',
        'observable_indicators',
        'non_examples',
        'tested_absence_requirements'
      ],
      properties: {
        unknown_handling: { type: 'array', items: nonEmpty },
        contradiction_handling: { type: 'array', items: nonEmpty },
        false_positive_guards: { type: 'array', items: nonEmpty },
        prohibited_inferences: { type: 'array', items: nonEmpty },
        human_decision_boundaries: { type: 'array', items: nonEmpty },
        evidence_ceilings: { type: 'array', items: nonEmpty },
        paired_independence_rule: nonEmpty,
        failure_mechanism: { type: ['string', 'null'] },
        observable_indicators: { type: 'array', items: nonEmpty },
        non_examples: { type: 'array', items: nonEmpty },
        tested_absence_requirements: { type: 'array', items: nonEmpty }
      }
    },
    sourced_claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'claim_id',
          'section_id',
          'statement',
          'support_state',
          'source_unit_ids',
          'authority_distinction',
          'applicability_note',
          'unresolved_reason',
          'cited_source_assertions'
        ],
        properties: {
          claim_id: nonEmpty,
          section_id: nonEmpty,
          statement: nonEmpty,
          support_state: { type: 'string', enum: ['SOURCE_SUPPORTED', 'UNRESOLVED'] },
          source_unit_ids: { type: 'array', items: nonEmpty },
          authority_distinction: {
            type: 'string',
            enum: [
              'BINDING_LEGISLATION_WHEN_APPLICABLE',
              'AUTHORITATIVE_STANDARD_OR_GUIDANCE',
              'UNRESOLVED_SOURCE_BASIS'
            ]
          },
          applicability_note: nonEmpty,
          unresolved_reason: { type: ['string', 'null'] },
          cited_source_assertions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'source_unit_id',
                'asserted_source_id',
                'asserted_source_version',
                'asserted_locator'
              ],
              properties: {
                source_unit_id: nonEmpty,
                asserted_source_id: { type: ['string', 'null'] },
                asserted_source_version: { type: ['string', 'null'] },
                asserted_locator: { type: ['string', 'null'] }
              }
            }
          }
        }
      }
    },
    methodology_interpretations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'interpretation_id',
          'section_id',
          'statement',
          'cognitive_rule_refs',
          'question_ids'
        ],
        properties: {
          interpretation_id: nonEmpty,
          section_id: nonEmpty,
          statement: nonEmpty,
          cognitive_rule_refs: { type: 'array', items: nonEmpty },
          question_ids: { type: 'array', items: nonEmpty }
        }
      }
    },
    related_object_links: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['target_object_id', 'relationship_kind', 'non_inverse_meaning'],
        properties: {
          target_object_id: nonEmpty,
          relationship_kind: {
            type: 'string',
            enum: ['PAIRED_CAPABILITY', 'PAIRED_ANTIPATTERN', 'RELATED_TAXONOMY_OBJECT']
          },
          non_inverse_meaning: nonEmpty
        }
      }
    },
    tactic_associations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'tactic_id',
          'title',
          'version',
          'effective_association_status',
          'original_release_status',
          'original_activation_status',
          'completion_effect',
          'activation_authority',
          'scope_and_boundary_note'
        ],
        properties: {
          tactic_id: nonEmpty,
          title: nonEmpty,
          version: nonEmpty,
          effective_association_status: {
            type: 'string',
            enum: ['OBJECT_LINK_ASSOCIATED', 'UNCONFIRMED_CANDIDATE']
          },
          original_release_status: nonEmpty,
          original_activation_status: nonEmpty,
          completion_effect: nonEmpty,
          activation_authority: { const: 'NONE_IN_CREATOR' },
          scope_and_boundary_note: nonEmpty
        }
      }
    },
    bibliography: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'source_unit_id',
          'source_id',
          'source_title',
          'edition_version',
          'authority_tier',
          'authority_type',
          'origin_kind',
          'locator_label',
          'extraction_status',
          'usage_policy',
          'limitations'
        ],
        properties: {
          source_unit_id: sha256Hex,
          source_id: nonEmpty,
          source_title: nonEmpty,
          edition_version: nonEmpty,
          authority_tier: nonEmpty,
          authority_type: nonEmpty,
          origin_kind: {
            type: 'string',
            enum: [
              'registered_url',
              'bound_reference_pdf',
              'human_verified_excerpt',
              'register_metadata'
            ]
          },
          locator_label: nonEmpty,
          extraction_status: { type: 'string', enum: ['COMPLETE', 'PARTIAL_TRUNCATED'] },
          usage_policy: {
            type: 'string',
            enum: [
              'PERMITTED_FULL',
              'PERMITTED_ATTRIBUTED_EXCERPT',
              'METADATA_LOCATOR_ONLY',
              'HUMAN_VERIFIED_EXTRACTION'
            ]
          },
          limitations: { type: 'array', items: nonEmpty }
        }
      }
    },
    unresolved_items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['item_id', 'category', 'section_id', 'summary', 'blocks_delivery'],
        properties: {
          item_id: nonEmpty,
          category: {
            type: 'string',
            enum: [
              'MISSING_SOURCE_SUPPORT',
              'UNRESOLVED_REFERENCE_HANDLE',
              'SOURCE_TRUNCATION_WARNING',
              'UNCONFIRMED_TACTIC_CANDIDATE',
              'INPUT_CONFLICT'
            ]
          },
          section_id: nonEmpty,
          summary: nonEmpty,
          blocks_delivery: { type: 'boolean' }
        }
      }
    },
    rejected_authoring_attempts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'severity', 'tier', 'path', 'message'],
        properties: {
          code: nonEmpty,
          severity: { type: 'string', enum: ['ERROR', 'WARNING'] },
          tier: { type: 'string', enum: ['DRAFT', 'RELEASE'] },
          path: nonEmpty,
          message: nonEmpty
        }
      }
    }
  }
} as const;

export function validateCreatorDocument(
  candidate: unknown,
  tier: StrictnessTier = 'DRAFT'
): CreatorFinding[] {
  const validator = getCompiledSchema(creatorDocumentSchema);
  const ok = validator(candidate) === true;
  return ok ? [] : creatorFindingsFromAjv(validator.errors, tier);
}
