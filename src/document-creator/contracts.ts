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
