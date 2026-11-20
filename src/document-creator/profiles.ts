import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  validateKbProfile,
  validateResolvedInputSet,
  type AppliedOwnerDecision,
  type CognitiveStateVocabularies,
  type CreatorFinding,
  type InputConflict,
  type KbProfile,
  type ObjectCoverageEntry,
  type PlanQuestion,
  type ProfileInputRef,
  type ResolvedInputSet,
  type StrictnessTier,
  type TacticAssociationSummary
} from './contracts.js';
import {
  compilePinnedSchemaFamily,
  computeSha256,
  pinProfileInputs,
  type PinnedInputSnapshot
} from './inputs.js';

export const DEFAULT_CAPABILITY_SECTIONS = [
  'DEF:Identity, definition, purpose, and scope',
  'APP:Applicability and exclusions',
  'CRI:Criteria, primary questions, and interpretation dimensions',
  'EVI:Evidence requirements and sufficiency boundaries',
  'INT:Interpretation rules, unknown/conflict handling, false-positive guards, and prohibited inferences',
  'LIF:Lifecycle assurance expectations',
  'REL:Related capability and anti-pattern links',
  'TAC:Associated tactics and non-activation boundary',
  'SRC:Source-supported claims vs methodology interpretation',
  'REV:Unresolved items and creation-review metadata'
] as const;

export const DEFAULT_ANTIPATTERN_SECTIONS = [
  'DEF:Identity, definition, failure mechanism, and scope',
  'IND:Observable indicators, triggering conditions, non-examples, and false-positive guards',
  'CRI:Criteria, primary questions, and evidence requirements',
  'ABS:Presence interpretation, tested-absence requirements, and unknown handling',
  'CON:Contradictions, applicability/exclusions, and prohibited inferences',
  'REL:Paired capability relationship (non-inverse semantics)',
  'LIF:Lifecycle assurance expectations',
  'TAC:Associated tactics and non-activation boundary',
  'SRC:Source support, methodology interpretation, and unresolved items',
  'REV:Creation-review and version metadata'
] as const;

export const DEFAULT_TACTIC_SECTIONS = [
  'ID:Identity, version, and intended outcome',
  'MAP:Linked capabilities/anti-patterns and mapping scope/status',
  'PRE:Prerequisites and do-not-use conditions',
  'ACT:Activities, principal outputs, and accountable roles',
  'VER:Verification, reassessment boundary, and source support',
  'REV:Unresolved mappings and creation-review metadata'
] as const;

interface RawInventoryFile {
  role: string;
  path: string;
  version: string;
  sha256: string;
  origin?: string;
  usage?: string;
}

interface RawInventory {
  purpose?: string;
  status?: string;
  is_synthetic?: boolean;
  kb_id?: string;
  kb_title?: string;
  profile_id?: string;
  profile_version?: string;
  output_root?: string;
  operations_root?: string;
  files: RawInventoryFile[];
  owner_decision?: {
    role: string;
    version: string;
    sha256: string;
    scope: string;
  };
}

const REQUIRED_PROFILE_ROLES: ReadonlyArray<{
  role: string;
  kind: ProfileInputRef['kind'];
  mediaType: string;
  required: boolean;
}> = [
  { role: 'source-register', kind: 'source-register', mediaType: 'application/json', required: true },
  { role: 'source-register-reference', kind: 'companion-reference', mediaType: 'application/pdf', required: false },
  { role: 'source-register-schema', kind: 'schema', mediaType: 'application/schema+json', required: true },
  { role: 'taxonomy', kind: 'taxonomy', mediaType: 'application/json', required: true },
  { role: 'id-register', kind: 'id-register', mediaType: 'application/json', required: true },
  { role: 'criteria-reference', kind: 'criteria-reference', mediaType: 'application/pdf', required: true },
  { role: 'criteria-instrument', kind: 'criteria-instrument', mediaType: 'application/json', required: true },
  { role: 'cognitive-model', kind: 'cognitive-model', mediaType: 'text/html', required: true },
  { role: 'tactic-playbook', kind: 'tactic-playbook', mediaType: 'application/json', required: true },
  { role: 'tactic-playbook-schema', kind: 'schema', mediaType: 'application/schema+json', required: true },
  { role: 'tactic-source-snapshot', kind: 'companion-reference', mediaType: 'application/pdf', required: false },
  { role: 'capability-schema', kind: 'schema', mediaType: 'application/schema+json', required: true },
  { role: 'antipattern-schema', kind: 'schema', mediaType: 'application/schema+json', required: true },
  { role: 'shared-definitions', kind: 'schema', mediaType: 'application/schema+json', required: true },
  { role: 'golden-capability', kind: 'golden-capability', mediaType: 'application/json', required: true },
  { role: 'golden-antipattern', kind: 'golden-antipattern', mediaType: 'application/json', required: true },
  { role: 'golden-human-reference', kind: 'companion-reference', mediaType: 'application/pdf', required: false }
];

export async function buildProfileFromInventoryFile(options: {
  workspaceRoot: string;
  inventoryPath: string;
  profileId: string;
  profileVersion?: string;
  kbId: string;
  kbTitle: string;
  outputRoot: string;
  operationsRoot?: string;
  isSynthetic?: boolean;
  allowedInputRoots?: string[];
  referencesSubdir?: string;
}): Promise<KbProfile> {
  const rawText = await readFile(resolve(options.workspaceRoot, options.inventoryPath), 'utf8');
  const raw = JSON.parse(rawText) as RawInventory;
  const byRole = new Map(raw.files.map((entry) => [entry.role, entry]));

  let publicationHosts: string[] = [];
  const registerEntry = byRole.get('source-register');
  if (registerEntry) {
    try {
      const registerJson = JSON.parse(
        await readFile(resolve(options.workspaceRoot, registerEntry.path), 'utf8')
      ) as { sources?: Array<{ official_location?: string }> };
      const hostSet = new Set<string>();
      for (const source of registerJson.sources ?? []) {
        if (typeof source.official_location === 'string') {
          try {
            const parsed = new URL(source.official_location);
            if (parsed.protocol === 'https:' && parsed.hostname) {
              const host = parsed.hostname.toLowerCase();
              hostSet.add(host);
              // Official NIST DOI prefix (10.6028) resolves via 302 redirect to nvlpubs.nist.gov / csrc.nist.gov.
              if (host === 'doi.org' && /^\/10\.6028\//i.test(parsed.pathname)) {
                hostSet.add('nvlpubs.nist.gov');
                hostSet.add('csrc.nist.gov');
              }
            }
          } catch {
            // Invalid URLs will be flagged during validation.
          }
        }
      }
      publicationHosts = [...hostSet].sort();
    } catch {
      publicationHosts = [];
    }
  }

  const inputRefs: ProfileInputRef[] = [];
  for (const spec of REQUIRED_PROFILE_ROLES) {
    const found = byRole.get(spec.role);
    if (!found) continue;
    inputRefs.push({
      role: spec.role,
      kind: spec.kind,
      id: `${options.kbId}:${spec.role}`,
      version: found.version,
      store: 'local',
      path: found.path,
      sha256: found.sha256,
      media_type: spec.mediaType,
      provenance: found.origin ?? 'Pinned local inventory reference',
      required: spec.required
    });
  }

  const ownerDecisions: KbProfile['owner_input_decisions'] = raw.owner_decision
    ? [
        {
          decision_id: `${options.profileId}:final-playbook-decision`,
          role: raw.owner_decision.role,
          target_id: `${options.kbId}:${raw.owner_decision.role}`,
          version: raw.owner_decision.version,
          sha256: raw.owner_decision.sha256,
          effective_status: 'FINAL_OBJECT_LINKS_APPROVED',
          scope: raw.owner_decision.scope
        }
      ]
    : [];

  return {
    schema_version: '1.0.0',
    profile_id: options.profileId,
    profile_version: options.profileVersion ?? raw.profile_version ?? '1.0.0',
    kb_id: options.kbId,
    kb_title: options.kbTitle,
    language: 'en',
    is_synthetic: options.isSynthetic ?? Boolean(raw.is_synthetic),
    input_refs: inputRefs,
    owner_input_decisions: ownerDecisions,
    output_spec: {
      document_types: ['capability', 'antipattern', 'tactic'],
      required_sections: {
        capability: [...DEFAULT_CAPABILITY_SECTIONS],
        antipattern: [...DEFAULT_ANTIPATTERN_SECTIONS],
        tactic: [...DEFAULT_TACTIC_SECTIONS]
      },
      primary_format: 'markdown',
      pdf_enabled: false,
      paired_work_unit: true,
      cross_domain_tactic_partition: 'shared'
    },
    source_policy: {
      allowed_input_roots: options.allowedInputRoots ?? [
        'AI_Governance_Global_Source_Register_v1.5.0.json',
        'baseline',
        'schemas'
      ],
      allowed_publication_hosts: publicationHosts,
      references_subdir: options.referencesSubdir ?? 'baseline/sae-training/references',
      require_registered_sources: true,
      allow_model_egress_by_default: false,
      max_extract_bytes: 2_097_152
    },
    model_config_ref: {
      author_role: 'WORKHORSE',
      reviewer_role: 'QUALITY_CHECKER'
    },
    storage_ref: {
      connection_id: `${options.profileId}-local-fs`,
      provider: 'local',
      location: options.outputRoot,
      output_root: options.outputRoot,
      operations_root: options.operationsRoot ?? `${options.outputRoot}/_operations`,
      credential_secret_ref: null
    },
    limits: {
      max_objects_per_run: 10,
      provider_concurrency: 2,
      request_timeout_ms: 120_000,
      max_tokens_per_run: 64_000,
      max_repair_iterations: 1,
      max_extract_bytes: 2_097_152
    }
  };
}

export async function buildSaeLocalPilotProfile(workspaceRoot = process.cwd()): Promise<KbProfile> {
  return buildProfileFromInventoryFile({
    workspaceRoot,
    inventoryPath: 'baseline/sae-training/input-inventory.json',
    profileId: 'sae-local-pilot',
    profileVersion: '1.0.0',
    kbId: 'solution-assurance-engine',
    kbTitle: 'Solution Assurance Engine Knowledge Base',
    outputRoot: 'baseline/sae-training/knowledge-base',
    operationsRoot: 'baseline/sae-training/knowledge-base/_operations',
    isSynthetic: false
  });
}

export interface NormalizedPairModel {
  pair_id: string;
  domain_id: string;
  domain_title: string;
  folder_token: string;
  capability: {
    id: string;
    title: string;
    questions: PlanQuestion[];
    preset_source_ids: string[];
    candidate_domain_source_ids: string[];
    detail_gaps: string[];
    blocking_conflict_ids: string[];
  };
  antipattern: {
    id: string;
    title: string;
    questions: PlanQuestion[];
    preset_source_ids: string[];
    candidate_domain_source_ids: string[];
    detail_gaps: string[];
    blocking_conflict_ids: string[];
  };
  instrument_metadata?: {
    capability_applicability: string | null;
    capability_human_authority: string | null;
    capability_target_state: string | null;
    capability_severity: string | null;
    antipattern_severity: string | null;
    antipattern_signals: string[];
    related_object_ids: string[];
    lifecycle_stages: string[];
  };
}

export interface ResolvedProfileRuntime {
  profile: KbProfile;
  pinned: PinnedInputSnapshot;
  inputSet: ResolvedInputSet;
  pairs: NormalizedPairModel[];
  tactics: TacticAssociationSummary[];
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) return null;
    out.push(item);
  }
  return out;
}

function decodeBasicHtmlEntities(raw: string): string {
  return raw
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function detectDomainContainmentCycle(
  domains: ReadonlyArray<{ domain_id: string; parent_domain_id?: string | null }>
): string[] | null {
  const parentByDomain = new Map<string, string>();
  for (const domain of domains) {
    if (typeof domain.parent_domain_id === 'string' && domain.parent_domain_id.length > 0) {
      parentByDomain.set(domain.domain_id, domain.parent_domain_id);
    }
  }
  for (const startId of parentByDomain.keys()) {
    const visited: string[] = [startId];
    let current = parentByDomain.get(startId);
    while (current) {
      if (visited.includes(current)) {
        return [...visited, current];
      }
      visited.push(current);
      current = parentByDomain.get(current);
    }
  }
  return null;
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  return Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-';
}

export async function resolveProfileInputSet(options: {
  workspaceRoot: string;
  profile: KbProfile;
  tier?: StrictnessTier;
}): Promise<ResolvedProfileRuntime> {
  const tier = options.tier ?? 'DRAFT';
  const findings: CreatorFinding[] = [...validateKbProfile(options.profile, tier)];
  const conflicts: InputConflict[] = [];

  for (const spec of REQUIRED_PROFILE_ROLES) {
    if (!spec.required) continue;
    const existsInProfile = options.profile.input_refs.some((ref) => ref.role === spec.role);
    if (!existsInProfile) {
      findings.push({
        code: 'REQUIRED_ROLE_MISSING',
        severity: 'ERROR',
        tier,
        path: `/input_refs/${spec.role}`,
        message: `Required input role "${spec.role}" (${spec.kind}) is missing from profile "${options.profile.profile_id}".`
      });
    }
  }

  const pinned = await pinProfileInputs({
    workspaceRoot: options.workspaceRoot,
    profile: options.profile,
    tier
  });
  findings.push(...pinned.findings);

  const descriptorByRole = new Map(pinned.descriptors.map((item) => [item.role, item]));

  // Verify PDF binary header for any pinned PDF role (I-10).
  for (const descriptor of pinned.descriptors) {
    if (descriptor.media_type === 'application/pdf') {
      const pdfBytes = pinned.bytes(descriptor.role);
      if (!hasPdfHeader(pdfBytes)) {
        findings.push({
          code: 'INVALID_PDF_HEADER',
          severity: 'ERROR',
          tier,
          path: `/inputs/${descriptor.role}`,
          message: `Input role "${descriptor.role}" (${descriptor.path}) does not begin with a %PDF- header.`
        });
      }
    }
  }

  const schemaRoles = [
    'source-register-schema',
    'tactic-playbook-schema',
    'shared-definitions',
    'capability-schema',
    'antipattern-schema'
  ] as const;

  const loadedSchemas: Array<{ role: string; schema: unknown }> = [];
  for (const role of schemaRoles) {
    if (!pinned.hasRole(role)) continue;
    const parsed = pinned.json(role);
    if (!parsed.ok) {
      findings.push(parsed.finding);
      continue;
    }
    loadedSchemas.push({ role, schema: parsed.value });
  }

  const schemaRegistry = compilePinnedSchemaFamily(loadedSchemas, tier);
  findings.push(...schemaRegistry.findings);

  const parseAndValidateJsonRole = (role: string, schemaRole?: string): Record<string, unknown> | null => {
    if (!pinned.hasRole(role)) return null;
    const parsed = pinned.json(role);
    if (!parsed.ok) {
      findings.push(parsed.finding);
      return null;
    }
    if (!isObjectRecord(parsed.value)) {
      findings.push({
        code: 'INPUT_JSON_NOT_OBJECT',
        severity: 'ERROR',
        tier,
        path: `/inputs/${role}`,
        message: `Input role "${role}" must contain a top-level JSON object.`
      });
      return null;
    }
    if (schemaRole) {
      const schemaErrors = schemaRegistry.validateAgainstRole(schemaRole, role, parsed.value);
      findings.push(...schemaErrors);
      if (schemaErrors.length > 0 && (role === 'golden-capability' || role === 'golden-antipattern')) {
        conflicts.push({
          conflict_id: `schema-conflict:${role}`,
          sources: [role, schemaRole],
          affected_object_ids: typeof parsed.value.id === 'string' ? [parsed.value.id] : [],
          path: `/inputs/${role}`,
          message: `Golden Reference role "${role}" failed validation against pinned schema family (${schemaRole}).`,
          blocks_delivery: true
        });
      }
    }
    const declaredVersion = parsed.value.version;
    const expectedVersion = descriptorByRole.get(role)?.version;
    if (typeof declaredVersion === 'string' && expectedVersion && declaredVersion !== expectedVersion) {
      findings.push({
        code: 'DECLARED_VERSION_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `/inputs/${role}/version`,
        message: `Input role "${role}" declares version "${declaredVersion}" but profile pinned "${expectedVersion}".`
      });
    }
    return parsed.value;
  };

  const taxonomyDoc = parseAndValidateJsonRole('taxonomy');
  const idRegisterDoc = parseAndValidateJsonRole('id-register');
  const instrumentDoc = parseAndValidateJsonRole('criteria-instrument');
  const sourceRegisterDoc = parseAndValidateJsonRole('source-register', 'source-register-schema');
  const playbookDoc = parseAndValidateJsonRole('tactic-playbook', 'tactic-playbook-schema');
  const goldenCapDoc = parseAndValidateJsonRole('golden-capability', 'capability-schema');
  const goldenApDoc = parseAndValidateJsonRole('golden-antipattern', 'antipattern-schema');

  // Verify owner decisions against exact resolved version and SHA-256 (T-01).
  const appliedOwnerDecisions: AppliedOwnerDecision[] = [];
  for (let i = 0; i < options.profile.owner_input_decisions.length; i += 1) {
    const decision = options.profile.owner_input_decisions[i]!;
    const targetDescriptor = descriptorByRole.get(decision.role);
    if (!targetDescriptor) {
      findings.push({
        code: 'OWNER_DECISION_TARGET_MISSING',
        severity: 'ERROR',
        tier,
        path: `/owner_input_decisions/${i}`,
        message: `Owner decision "${decision.decision_id}" references unavailable role "${decision.role}".`
      });
      continue;
    }
    if (targetDescriptor.version !== decision.version || targetDescriptor.sha256 !== decision.sha256) {
      findings.push({
        code: 'OWNER_DECISION_HASH_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `/owner_input_decisions/${i}/sha256`,
        message: `Owner decision "${decision.decision_id}" does not bind to "${decision.role}" version ${targetDescriptor.version} (${targetDescriptor.sha256}); refusing to apply override to unconfirmed bytes.`
      });
      continue;
    }
    let originalStatusText = 'UNSPECIFIED';
    if (decision.role === 'tactic-playbook' && playbookDoc) {
      const releaseStatus = typeof playbookDoc.release_status === 'string' ? playbookDoc.release_status : 'UNKNOWN';
      const tacticsArr = Array.isArray(playbookDoc.tactics) ? playbookDoc.tactics : [];
      const activationStatuses = [
        ...new Set(
          tacticsArr
            .filter(isObjectRecord)
            .map((t) => (typeof t.activation_mapping_status === 'string' ? t.activation_mapping_status : 'UNKNOWN'))
        )
      ];
      originalStatusText = `release_status=${releaseStatus}; activation_mapping_status=${activationStatuses.join(',') || 'NONE'}`;
    }
    appliedOwnerDecisions.push({
      decision_id: decision.decision_id,
      role: decision.role,
      target_id: decision.target_id,
      version: decision.version,
      sha256: decision.sha256,
      original_status_text: originalStatusText,
      effective_status: decision.effective_status,
      scope: decision.scope
    });
  }

  // Verify companion tactic source snapshot hash if both playbook and snapshot are pinned.
  if (playbookDoc && descriptorByRole.has('tactic-source-snapshot')) {
    const sourceDoc = isObjectRecord(playbookDoc.source_document) ? playbookDoc.source_document : null;
    const expectedSnapshotSha = descriptorByRole.get('tactic-source-snapshot')!.sha256;
    if (sourceDoc && typeof sourceDoc.sha256 === 'string' && sourceDoc.sha256 !== expectedSnapshotSha) {
      findings.push({
        code: 'PLAYBOOK_SNAPSHOT_HASH_MISMATCH',
        severity: 'ERROR',
        tier,
        path: '/inputs/tactic-playbook/source_document/sha256',
        message: `Tactic playbook source_document.sha256 (${sourceDoc.sha256}) disagrees with pinned tactic-source-snapshot (${expectedSnapshotSha}).`
      });
    }
  }

  let goldenReference: ResolvedInputSet['golden_reference'] = null;
  let cognitiveSummary: ResolvedInputSet['cognitive_model'] = null;
  const pairs: NormalizedPairModel[] = [];
  const tactics: TacticAssociationSummary[] = [];
  const coverageMatrix: ObjectCoverageEntry[] = [];
  const registeredSourceIds = new Set<string>();
  const metadataOnlySourceIds: string[] = [];
  const usedSourceIds = new Set<string>();

  if (taxonomyDoc && idRegisterDoc && instrumentDoc && sourceRegisterDoc && playbookDoc) {
    // 1. Validate domains and containment (I-03).
    const rawDomains = Array.isArray(taxonomyDoc.domains) ? taxonomyDoc.domains.filter(isObjectRecord) : [];
    const domainMap = new Map<
      string,
      {
        domain_id: string;
        title: string;
        capability_ids: string[];
        antipattern_ids: string[];
        parent_domain_id?: string | null;
      }
    >();

    for (let i = 0; i < rawDomains.length; i += 1) {
      const dom = rawDomains[i]!;
      const domainId = typeof dom.domain_id === 'string' ? dom.domain_id : '';
      const title = typeof dom.title === 'string' ? dom.title : domainId;
      const capIds = asStringArray(dom.capability_ids) ?? [];
      const apIds = asStringArray(dom.antipattern_ids) ?? [];
      if (!domainId) {
        findings.push({
          code: 'INVALID_DOMAIN_RECORD',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/domains/${i}`,
          message: 'Domain record is missing a valid domain_id.'
        });
        continue;
      }
      if (domainMap.has(domainId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/domains/${i}/domain_id`,
          message: `Duplicate taxonomy domain_id "${domainId}".`
        });
        continue;
      }
      domainMap.set(domainId, {
        domain_id: domainId,
        title,
        capability_ids: capIds,
        antipattern_ids: apIds,
        parent_domain_id: typeof dom.parent_domain_id === 'string' ? dom.parent_domain_id : null
      });
    }

    for (const dom of domainMap.values()) {
      if (dom.parent_domain_id && !domainMap.has(dom.parent_domain_id)) {
        findings.push({
          code: 'UNRESOLVED_DOMAIN_REFERENCE',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/domains/${dom.domain_id}/parent_domain_id`,
          message: `Domain "${dom.domain_id}" references unknown parent_domain_id "${dom.parent_domain_id}".`
        });
      }
    }

    const cycle = detectDomainContainmentCycle([...domainMap.values()]);
    if (cycle) {
      findings.push({
        code: 'CONTAINMENT_CYCLE',
        severity: 'ERROR',
        tier,
        path: '/inputs/taxonomy/domains',
        message: `Circular domain containment detected: ${cycle.join(' -> ')}.`
      });
    }

    // 2. Validate category pairs and capability/anti-pattern identities (I-03).
    const rawPairs = Array.isArray(taxonomyDoc.category_pairs)
      ? taxonomyDoc.category_pairs.filter(isObjectRecord)
      : [];
    const pairMap = new Map<
      string,
      {
        pair_id: string;
        domain_id: string;
        capability: { id: string; title: string };
        antipattern: { id: string; title: string };
      }
    >();
    const capOwnerPair = new Map<string, string>();
    const apOwnerPair = new Map<string, string>();
    const objectDomain = new Map<string, string>();

    for (let i = 0; i < rawPairs.length; i += 1) {
      const p = rawPairs[i]!;
      const pairId = typeof p.pair_id === 'string' ? p.pair_id : '';
      const domainId = typeof p.domain === 'string' ? p.domain : '';
      const cap = isObjectRecord(p.capability) ? p.capability : null;
      const ap = isObjectRecord(p.antipattern) ? p.antipattern : null;
      const capId = cap && typeof cap.id === 'string' ? cap.id : '';
      const capTitle = cap && typeof cap.title === 'string' ? cap.title : '';
      const apId = ap && typeof ap.id === 'string' ? ap.id : '';
      const apTitle = ap && typeof ap.title === 'string' ? ap.title : '';

      if (!pairId || !domainId || !capId || !capTitle || !apId || !apTitle) {
        findings.push({
          code: 'INVALID_PAIR_RECORD',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/category_pairs/${i}`,
          message: 'Category pair record is missing pair_id, domain, capability, or antipattern.'
        });
        continue;
      }
      if (!domainMap.has(domainId)) {
        findings.push({
          code: 'UNRESOLVED_DOMAIN_REFERENCE',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/category_pairs/${i}/domain`,
          message: `Pair "${pairId}" references unknown domain "${domainId}".`
        });
      }
      if (pairMap.has(pairId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/category_pairs/${i}/pair_id`,
          message: `Duplicate pair_id "${pairId}".`
        });
        continue;
      }
      if (capId === apId || apOwnerPair.has(capId) || capOwnerPair.has(apId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/category_pairs/${i}`,
          message: `Capability "${capId}" and anti-pattern "${apId}" collide across object types.`
        });
      }
      if (capOwnerPair.has(capId)) {
        findings.push({
          code: 'AMBIGUOUS_PAIR_MEMBERSHIP',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/category_pairs/${i}/capability/id`,
          message: `Capability "${capId}" is claimed by both "${capOwnerPair.get(capId)}" and "${pairId}".`
        });
      }
      if (apOwnerPair.has(apId)) {
        findings.push({
          code: 'AMBIGUOUS_PAIR_MEMBERSHIP',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/category_pairs/${i}/antipattern/id`,
          message: `Anti-pattern "${apId}" is claimed by both "${apOwnerPair.get(apId)}" and "${pairId}".`
        });
      }
      capOwnerPair.set(capId, pairId);
      apOwnerPair.set(apId, pairId);
      objectDomain.set(capId, domainId);
      objectDomain.set(apId, domainId);
      pairMap.set(pairId, {
        pair_id: pairId,
        domain_id: domainId,
        capability: { id: capId, title: capTitle },
        antipattern: { id: apId, title: apTitle }
      });
    }

    for (const dom of domainMap.values()) {
      const pairsInDomain = [...pairMap.values()].filter((p) => p.domain_id === dom.domain_id);
      const expectedCaps = pairsInDomain.map((p) => p.capability.id).sort();
      const declaredCaps = [...dom.capability_ids].sort();
      if (JSON.stringify(expectedCaps) !== JSON.stringify(declaredCaps)) {
        findings.push({
          code: 'DOMAIN_MEMBERSHIP_MISMATCH',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/domains/${dom.domain_id}/capability_ids`,
          message: `Domain "${dom.domain_id}" capability_ids disagree with category_pairs.`
        });
      }
      const expectedAps = pairsInDomain.map((p) => p.antipattern.id).sort();
      const declaredAps = [...dom.antipattern_ids].sort();
      if (JSON.stringify(expectedAps) !== JSON.stringify(declaredAps)) {
        findings.push({
          code: 'DOMAIN_MEMBERSHIP_MISMATCH',
          severity: 'ERROR',
          tier,
          path: `/inputs/taxonomy/domains/${dom.domain_id}/antipattern_ids`,
          message: `Domain "${dom.domain_id}" antipattern_ids disagree with category_pairs.`
        });
      }
    }

    // 3. Cross-check ID register reserved IDs & question dimensions.
    const reserved = isObjectRecord(idRegisterDoc.reserved_object_ids) ? idRegisterDoc.reserved_object_ids : null;
    const questionDimensions = isObjectRecord(idRegisterDoc.question_dimensions)
      ? (idRegisterDoc.question_dimensions as Record<string, unknown>)
      : {};
    if (reserved) {
      const regPairs = (asStringArray(reserved.pairs) ?? []).sort();
      const regCaps = (asStringArray(reserved.capabilities) ?? []).sort();
      const regAps = (asStringArray(reserved.antipatterns) ?? []).sort();
      if (JSON.stringify([...pairMap.keys()].sort()) !== JSON.stringify(regPairs)) {
        findings.push({
          code: 'ID_REGISTER_MISMATCH',
          severity: 'ERROR',
          tier,
          path: '/inputs/id-register/reserved_object_ids/pairs',
          message: 'Taxonomy pair IDs disagree with id-register reserved_object_ids.pairs.'
        });
      }
      if (JSON.stringify([...capOwnerPair.keys()].sort()) !== JSON.stringify(regCaps)) {
        findings.push({
          code: 'ID_REGISTER_MISMATCH',
          severity: 'ERROR',
          tier,
          path: '/inputs/id-register/reserved_object_ids/capabilities',
          message: 'Taxonomy capability IDs disagree with id-register reserved_object_ids.capabilities.'
        });
      }
      if (JSON.stringify([...apOwnerPair.keys()].sort()) !== JSON.stringify(regAps)) {
        findings.push({
          code: 'ID_REGISTER_MISMATCH',
          severity: 'ERROR',
          tier,
          path: '/inputs/id-register/reserved_object_ids/antipatterns',
          message: 'Taxonomy anti-pattern IDs disagree with id-register reserved_object_ids.antipatterns.'
        });
      }
    }

    // 4. Validate Golden Reference pair identity against taxonomy (I-01, I-02).
    if (goldenCapDoc && goldenApDoc) {
      const gCapId = typeof goldenCapDoc.id === 'string' ? goldenCapDoc.id : '';
      const gApId = typeof goldenApDoc.id === 'string' ? goldenApDoc.id : '';
      const gCapVer = typeof goldenCapDoc.version === 'string' ? goldenCapDoc.version : '1.0.0';
      const gApVer = typeof goldenApDoc.version === 'string' ? goldenApDoc.version : '1.0.0';
      const matchingPair = [...pairMap.values()].find(
        (p) => p.capability.id === gCapId && p.antipattern.id === gApId
      );
      if (!matchingPair) {
        findings.push({
          code: 'GOLDEN_PAIR_MISMATCH',
          severity: 'ERROR',
          tier,
          path: '/inputs/golden-capability',
          message: `Golden capability "${gCapId}" and anti-pattern "${gApId}" are not a paired taxonomy entry.`
        });
      } else {
        goldenReference = {
          pair_id: matchingPair.pair_id,
          capability_id: gCapId,
          antipattern_id: gApId,
          capability_version: gCapVer,
          antipattern_version: gApVer
        };
      }
    }

    // 5. Validate Source Register entries and domain coverage (I-03, I-12, I-13).
    const rawSources = Array.isArray(sourceRegisterDoc.sources)
      ? sourceRegisterDoc.sources.filter(isObjectRecord)
      : [];
    const domainSources = new Map<string, string[]>();

    for (let i = 0; i < rawSources.length; i += 1) {
      const src = rawSources[i]!;
      const srcId = typeof src.id === 'string' ? src.id : '';
      if (!srcId) continue;
      if (registeredSourceIds.has(srcId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/source-register/sources/${i}/id`,
          message: `Duplicate source_id "${srcId}" in Source Register.`
        });
        continue;
      }
      registeredSourceIds.add(srcId);
      const boundary = typeof src.licensing_storage_boundary === 'string' ? src.licensing_storage_boundary : '';
      if (/metadata and locator only/i.test(boundary)) {
        metadataOnlySourceIds.push(srcId);
      }
      const coveredDomains = asStringArray(src.domain_coverage) ?? [];
      for (const domId of coveredDomains) {
        if (!domainMap.has(domId)) {
          findings.push({
            code: 'UNRESOLVED_DOMAIN_REFERENCE',
            severity: 'ERROR',
            tier,
            path: `/inputs/source-register/sources/${i}/domain_coverage`,
            message: `Source "${srcId}" references unknown domain "${domId}".`
          });
          continue;
        }
        const list = domainSources.get(domId) ?? [];
        list.push(srcId);
        domainSources.set(domId, list);
      }
    }

    // 6. Validate assessment instrument requirements, controls, anti-patterns, and questions (I-03, I-12, I-13).
    const rawReqs = Array.isArray(instrumentDoc.requirements)
      ? instrumentDoc.requirements.filter(isObjectRecord)
      : [];
    const rawControls = Array.isArray(instrumentDoc.controls)
      ? instrumentDoc.controls.filter(isObjectRecord)
      : [];
    const rawAps = Array.isArray(instrumentDoc.antipatterns)
      ? instrumentDoc.antipatterns.filter(isObjectRecord)
      : [];

    const reqById = new Map<
      string,
      {
        id: string;
        domain: string;
        authoringObjectId: string;
        sourceIds: string[];
        applicability: string | null;
        humanAuthority: string | null;
        lifecycleStages: string[];
      }
    >();
    for (let i = 0; i < rawReqs.length; i += 1) {
      const req = rawReqs[i]!;
      const id = typeof req.id === 'string' ? req.id : '';
      const domain = typeof req.domain === 'string' ? req.domain : '';
      const authoringObjectId = typeof req.authoringObjectId === 'string' ? req.authoringObjectId : '';
      const sourceIds = Array.isArray(req.sourceIds)
        ? req.sourceIds.filter((s): s is string => typeof s === 'string' && s.length > 0)
        : [];
      const applicability = typeof req.applicability === 'string' ? req.applicability : null;
      const humanAuthority = typeof req.humanAuthority === 'string' ? req.humanAuthority : null;
      const lifecycleStages = asStringArray(req.lifecycleStages) ?? [];
      if (!id || reqById.has(id)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/requirements/${i}/id`,
          message: `Invalid or duplicate requirement id "${id}".`
        });
        continue;
      }
      if (!capOwnerPair.has(authoringObjectId)) {
        findings.push({
          code: 'ORPHAN_CRITERION',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/requirements/${i}/authoringObjectId`,
          message: `Requirement "${id}" points to unknown capability "${authoringObjectId}".`
        });
      }
      reqById.set(id, {
        id,
        domain,
        authoringObjectId,
        sourceIds,
        applicability,
        humanAuthority,
        lifecycleStages
      });
    }

    const controlById = new Map<string, Record<string, unknown>>();
    const controlByObjectId = new Map<string, Record<string, unknown>>();
    const apByObjectId = new Map<string, Record<string, unknown>>();
    const questionRegistry = new Map<string, { id: string; dimension: string; question: string; objectId: string }>();

    const registerObjectQuestions = (
      objectId: string,
      rawQuestions: unknown,
      basePath: string
    ): PlanQuestion[] => {
      if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
        findings.push({
          code: 'MISSING_OBJECT_QUESTIONS',
          severity: 'ERROR',
          tier,
          path: basePath,
          message: `Object "${objectId}" has no primary questions in criteria-instrument.`
        });
        return [];
      }
      const parsedQuestions: PlanQuestion[] = [];
      for (let qIdx = 0; qIdx < rawQuestions.length; qIdx += 1) {
        const q = rawQuestions[qIdx];
        if (!isObjectRecord(q) || typeof q.id !== 'string' || typeof q.dimension !== 'string' || typeof q.question !== 'string') {
          findings.push({
            code: 'INVALID_QUESTION_RECORD',
            severity: 'ERROR',
            tier,
            path: `${basePath}/${qIdx}`,
            message: `Invalid question record on "${objectId}".`
          });
          continue;
        }
        if (questionRegistry.has(q.id)) {
          findings.push({
            code: 'DUPLICATE_ID',
            severity: 'ERROR',
            tier,
            path: `${basePath}/${qIdx}/id`,
            message: `Duplicate question id "${q.id}" across criteria-instrument.`
          });
          continue;
        }
        questionRegistry.set(q.id, { id: q.id, dimension: q.dimension, question: q.question, objectId });
        parsedQuestions.push({ id: q.id, dimension: q.dimension, question: q.question });
      }

      const expectedDimEntries = Object.entries(questionDimensions).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      );
      if (expectedDimEntries.length > 0) {
        const expectedKeys = expectedDimEntries.map(([suffix, dim]) => `${objectId}-${suffix}:${dim}`).sort();
        const actualKeys = parsedQuestions.map((q) => `${q.id}:${q.dimension}`).sort();
        if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
          findings.push({
            code: 'QUESTION_DIMENSION_MISMATCH',
            severity: 'ERROR',
            tier,
            path: basePath,
            message: `Questions for "${objectId}" do not match id-register question_dimensions.`
          });
        }
      }
      return parsedQuestions;
    };

    const parsedQuestionsByObject = new Map<string, PlanQuestion[]>();

    for (let i = 0; i < rawControls.length; i += 1) {
      const ctrl = rawControls[i]!;
      const ctrlId = typeof ctrl.id === 'string' ? ctrl.id : '';
      const objId = typeof ctrl.authoringObjectId === 'string' ? ctrl.authoringObjectId : '';
      if (!ctrlId || controlById.has(ctrlId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/controls/${i}/id`,
          message: `Invalid or duplicate control id "${ctrlId}".`
        });
        continue;
      }
      if (!capOwnerPair.has(objId)) {
        findings.push({
          code: 'ORPHAN_CRITERION',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/controls/${i}/authoringObjectId`,
          message: `Control "${ctrlId}" points to unknown capability "${objId}".`
        });
        continue;
      }
      if (controlByObjectId.has(objId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/controls/${i}/authoringObjectId`,
          message: `Multiple controls claim capability "${objId}".`
        });
        continue;
      }
      controlById.set(ctrlId, ctrl);
      controlByObjectId.set(objId, ctrl);
      parsedQuestionsByObject.set(
        objId,
        registerObjectQuestions(objId, ctrl.questions, `/inputs/criteria-instrument/controls/${i}/questions`)
      );
    }

    for (let i = 0; i < rawAps.length; i += 1) {
      const ap = rawAps[i]!;
      const apId = typeof ap.id === 'string' ? ap.id : '';
      if (!apId || apByObjectId.has(apId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/antipatterns/${i}/id`,
          message: `Invalid or duplicate anti-pattern id "${apId}" in instrument.`
        });
        continue;
      }
      if (!apOwnerPair.has(apId)) {
        findings.push({
          code: 'ORPHAN_CRITERION',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/antipatterns/${i}/id`,
          message: `Instrument anti-pattern "${apId}" is missing from taxonomy.`
        });
        continue;
      }
      const relatedControls = asStringArray(ap.relatedControlIds) ?? [];
      for (const relCtrlId of relatedControls) {
        // Cross-domain relatedControlIds are permitted when the target control exists (02-Contracts §2.1).
        if (!controlById.has(relCtrlId)) {
          findings.push({
            code: 'UNRESOLVED_REFERENCE',
            severity: 'ERROR',
            tier,
            path: `/inputs/criteria-instrument/antipatterns/${i}/relatedControlIds`,
            message: `Anti-pattern "${apId}" references unknown control "${relCtrlId}".`
          });
        }
      }
      apByObjectId.set(apId, ap);
      parsedQuestionsByObject.set(
        apId,
        registerObjectQuestions(apId, ap.questions, `/inputs/criteria-instrument/antipatterns/${i}/questions`)
      );
    }

    // 7. Parse cognitive model HTML inertly and check agreement with instrument questions (I-06, I-10).
    if (pinned.hasRole('cognitive-model')) {
      const html = pinned.text('cognitive-model');
      const versionMatch = html.match(/Cognitive contract\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
      const modelVersion = versionMatch?.[1] ?? descriptorByRole.get('cognitive-model')?.version ?? 'unknown';
      const dimensionValues = Object.values(questionDimensions).filter((v): v is string => typeof v === 'string');

      let stateVocabularies: CognitiveStateVocabularies | undefined;
      if (pinned.hasRole('shared-definitions')) {
        const sharedParsed = pinned.json('shared-definitions');
        if (sharedParsed.ok && isObjectRecord(sharedParsed.value) && isObjectRecord(sharedParsed.value.$defs)) {
          const defs = sharedParsed.value.$defs;
          const readEnum = (key: string): string[] => {
            const node = defs[key];
            return isObjectRecord(node) ? asStringArray(node.enum) ?? [] : [];
          };
          const capConc = readEnum('capabilityConclusion');
          const apConc = readEnum('antipatternConclusion');
          const techAssur = readEnum('technicalAssurance');
          const humAssur = readEnum('humanAssurance');
          const lifeStages = readEnum('lifecycleStage');
          if (
            capConc.length > 0 ||
            apConc.length > 0 ||
            techAssur.length > 0 ||
            humAssur.length > 0 ||
            lifeStages.length > 0
          ) {
            const boundaryNotes: string[] = [];
            if (/Isolated Sandbox is (?:an|the)[\s\S]{0,60}operating[- ]boundary/i.test(html)) {
              boundaryNotes.push(
                'ISOLATED_SANDBOX and CONTROLLED_PILOT are operating-boundary environments, not lifecycle stages; material change is a reassessment trigger, not a lifecycle stage.'
              );
            }
            stateVocabularies = {
              capability_conclusions: capConc,
              antipattern_conclusions: apConc,
              technical_assurance: techAssur,
              human_assurance: humAssur,
              lifecycle_stages: lifeStages,
              boundary_notes: boundaryNotes
            };
          }
        }
      }

      cognitiveSummary = {
        model_id: `${options.profile.kb_id}:cognitive-model`,
        version: modelVersion,
        dimensions: dimensionValues.length > 0 ? dimensionValues : ['DEFINITION_AND_INTENT', 'IMPLEMENTATION_AND_OPERATION', 'EVIDENCE_AND_EFFECTIVENESS'],
        rules: [
          'evidence_admissibility_and_ceilings',
          'unknown_is_valid_non_compliant_result',
          'contradictions_preserved_not_smoothed',
          'antipattern_tested_absence_required',
          'false_positive_guards_and_prohibited_inferences',
          'human_authority_remains_outside_engine'
        ],
        ...(stateVocabularies ? { state_vocabularies: stateVocabularies } : {})
      };

      const htmlQuestionMatches = [...html.matchAll(/<code class="qid">([^<]+)<\/code><div>([^<]+)<\/div>/g)];
      const htmlQuestionMap = new Map<string, string>();
      for (const match of htmlQuestionMatches) {
        const qId = match[1]!.trim();
        const qText = decodeBasicHtmlEntities(match[2]!.trim());
        htmlQuestionMap.set(qId, qText);
      }

      for (const [qId, registeredQ] of questionRegistry.entries()) {
        const htmlText = htmlQuestionMap.get(qId);
        if (htmlText === undefined) {
          const conflictId = `cognitive-missing-question:${qId}`;
          conflicts.push({
            conflict_id: conflictId,
            sources: ['cognitive-model', 'criteria-instrument'],
            affected_object_ids: [registeredQ.objectId],
            path: `/inputs/cognitive-model/questions/${qId}`,
            message: `Cognitive model HTML omits question "${qId}" present in criteria-instrument.`,
            blocks_delivery: true
          });
          findings.push({
            code: 'COGNITIVE_QUESTION_MISSING',
            severity: 'WARNING',
            tier: 'RELEASE',
            path: `/inputs/cognitive-model/questions/${qId}`,
            message: `Cognitive model omits question "${qId}"; draft planning stays available, delivery blocked.`
          });
        } else if (htmlText !== registeredQ.question) {
          const conflictId = `cognitive-question-mismatch:${qId}`;
          conflicts.push({
            conflict_id: conflictId,
            sources: ['cognitive-model', 'criteria-instrument'],
            affected_object_ids: [registeredQ.objectId],
            path: `/inputs/cognitive-model/questions/${qId}`,
            message: `Question "${qId}" wording disagrees between cognitive-model ("${htmlText}") and criteria-instrument ("${registeredQ.question}").`,
            blocks_delivery: true
          });
          findings.push({
            code: 'COGNITIVE_QUESTION_CONFLICT',
            severity: 'WARNING',
            tier: 'RELEASE',
            path: `/inputs/cognitive-model/questions/${qId}`,
            message: `Question "${qId}" wording differs between cognitive-model and criteria-instrument; delivery of "${registeredQ.objectId}" is blocked until resolved.`
          });
        }
      }

      for (const htmlQId of htmlQuestionMap.keys()) {
        if (!questionRegistry.has(htmlQId)) {
          conflicts.push({
            conflict_id: `cognitive-extra-question:${htmlQId}`,
            sources: ['cognitive-model', 'criteria-instrument'],
            affected_object_ids: [],
            path: `/inputs/cognitive-model/questions/${htmlQId}`,
            message: `Cognitive model HTML declares question "${htmlQId}" absent from criteria-instrument.`,
            blocks_delivery: true
          });
          findings.push({
            code: 'COGNITIVE_EXTRA_QUESTION',
            severity: 'ERROR',
            tier,
            path: `/inputs/cognitive-model/questions/${htmlQId}`,
            message: `Cognitive model declares unknown question "${htmlQId}".`
          });
        }
      }
    }

    // 8. Validate Tactic Playbook links, associations vs activation, and cross-domain partition (T-01).
    const playbookDecisionApplied = appliedOwnerDecisions.some((d) => d.role === 'tactic-playbook');
    const rawTactics = Array.isArray(playbookDoc.tactics) ? playbookDoc.tactics.filter(isObjectRecord) : [];
    const seenTacticIds = new Set<string>();
    const tacticsByObjectId = new Map<string, string[]>();

    for (let i = 0; i < rawTactics.length; i += 1) {
      const tac = rawTactics[i]!;
      const tacId = typeof tac.id === 'string' ? tac.id : '';
      const tacTitle = typeof tac.title === 'string' ? tac.title : tacId;
      const tacVersion = typeof tac.version === 'string' ? tac.version : '1.0.0';
      if (!tacId || seenTacticIds.has(tacId)) {
        findings.push({
          code: 'DUPLICATE_ID',
          severity: 'ERROR',
          tier,
          path: `/inputs/tactic-playbook/tactics/${i}/id`,
          message: `Invalid or duplicate tactic id "${tacId}".`
        });
        continue;
      }
      seenTacticIds.add(tacId);

      const primaryMappings = asStringArray(tac.primary_object_mappings) ?? [];
      if (new Set(primaryMappings).size !== primaryMappings.length) {
        findings.push({
          code: 'DUPLICATE_TACTIC_OBJECT_LINK',
          severity: 'ERROR',
          tier,
          path: `/inputs/tactic-playbook/tactics/${i}/primary_object_mappings`,
          message: `Tactic "${tacId}" contains duplicate entries in primary_object_mappings.`
        });
      }

      const assessment = isObjectRecord(tac.assessment_mappings) ? tac.assessment_mappings : {};
      const mappedCaps = asStringArray(assessment.capabilities) ?? [];
      const mappedAps = asStringArray(assessment.antipatterns) ?? [];
      const mappedQuestions = asStringArray(assessment.question_ids) ?? [];
      const reassessmentTargets = asStringArray(tac.reassessment_targets) ?? [];
      const prereqIds = asStringArray(tac.prerequisite_tactic_ids) ?? [];

      for (const cId of mappedCaps) {
        if (!capOwnerPair.has(cId)) {
          findings.push({
            code: 'UNRESOLVED_PLAYBOOK_LINK',
            severity: 'ERROR',
            tier,
            path: `/inputs/tactic-playbook/tactics/${i}/assessment_mappings/capabilities`,
            message: `Tactic "${tacId}" links to unknown capability "${cId}".`
          });
        }
      }
      for (const aId of mappedAps) {
        if (!apOwnerPair.has(aId)) {
          findings.push({
            code: 'UNRESOLVED_PLAYBOOK_LINK',
            severity: 'ERROR',
            tier,
            path: `/inputs/tactic-playbook/tactics/${i}/assessment_mappings/antipatterns`,
            message: `Tactic "${tacId}" links to unknown anti-pattern "${aId}".`
          });
        }
      }
      if (JSON.stringify([...primaryMappings].sort()) !== JSON.stringify([...mappedCaps, ...mappedAps].sort())) {
        findings.push({
          code: 'PLAYBOOK_MAPPING_MISMATCH',
          severity: 'ERROR',
          tier,
          path: `/inputs/tactic-playbook/tactics/${i}/primary_object_mappings`,
          message: `Tactic "${tacId}" primary_object_mappings disagree with assessment_mappings.`
        });
      }

      for (const qId of mappedQuestions) {
        const qTarget = questionRegistry.get(qId);
        if (!qTarget) {
          findings.push({
            code: 'UNRESOLVED_PLAYBOOK_LINK',
            severity: 'ERROR',
            tier,
            path: `/inputs/tactic-playbook/tactics/${i}/assessment_mappings/question_ids`,
            message: `Tactic "${tacId}" links to unknown question "${qId}".`
          });
        } else if (!primaryMappings.includes(qTarget.objectId)) {
          findings.push({
            code: 'INCOMPATIBLE_PLAYBOOK_QUESTION_LINK',
            severity: 'ERROR',
            tier,
            path: `/inputs/tactic-playbook/tactics/${i}/assessment_mappings/question_ids`,
            message: `Tactic "${tacId}" question "${qId}" belongs to "${qTarget.objectId}", outside its primary_object_mappings.`
          });
        }
      }

      for (const targetId of reassessmentTargets) {
        if (!objectDomain.has(targetId)) {
          findings.push({
            code: 'UNRESOLVED_PLAYBOOK_LINK',
            severity: 'ERROR',
            tier,
            path: `/inputs/tactic-playbook/tactics/${i}/reassessment_targets`,
            message: `Tactic "${tacId}" references unknown reassessment target "${targetId}".`
          });
        }
      }

      for (const prereq of prereqIds) {
        if (!rawTactics.some((candidate) => candidate.id === prereq)) {
          findings.push({
            code: 'UNRESOLVED_PLAYBOOK_LINK',
            severity: 'ERROR',
            tier,
            path: `/inputs/tactic-playbook/tactics/${i}/prerequisite_tactic_ids`,
            message: `Tactic "${tacId}" references unknown prerequisite tactic "${prereq}".`
          });
        }
      }

      const relatedDomains = [
        ...new Set(
          primaryMappings
            .map((objId) => objectDomain.get(objId))
            .filter((d): d is string => typeof d === 'string')
        )
      ].sort();
      const explicitOwningDomain = typeof tac.owning_domain === 'string' ? tac.owning_domain : null;
      const owningDomain =
        explicitOwningDomain ??
        (relatedDomains.length === 1
          ? relatedDomains[0]!
          : options.profile.output_spec.cross_domain_tactic_partition);

      const originalReleaseStatus = typeof tac.release_status === 'string' ? tac.release_status : 'UNKNOWN';
      const originalActivationStatus =
        typeof tac.activation_mapping_status === 'string' ? tac.activation_mapping_status : 'UNKNOWN';
      const completionEffect =
        typeof tac.completion_effect === 'string'
          ? tac.completion_effect
          : 'NEW_EVIDENCE_AND_REASSESSMENT_REQUIRED';

      const effectiveAssociationStatus: TacticAssociationSummary['effective_association_status'] =
        originalReleaseStatus === 'APPROVED' || playbookDecisionApplied
          ? 'OBJECT_LINK_ASSOCIATED'
          : 'UNCONFIRMED_CANDIDATE';

      if (effectiveAssociationStatus === 'UNCONFIRMED_CANDIDATE') {
        findings.push({
          code: 'PLAYBOOK_DECISION_REQUIRED',
          severity: 'WARNING',
          tier: 'RELEASE',
          path: `/inputs/tactic-playbook/tactics/${i}`,
          message: `Tactic "${tacId}" has non-final status "${originalReleaseStatus}" without a version-bound owner decision.`
        });
      }

      tactics.push({
        tactic_id: tacId,
        title: tacTitle,
        version: tacVersion,
        owning_domain: owningDomain,
        related_domains: relatedDomains,
        linked_object_ids: primaryMappings,
        linked_question_ids: mappedQuestions,
        reassessment_targets: reassessmentTargets,
        completion_effect: completionEffect,
        original_release_status: originalReleaseStatus,
        original_activation_status: originalActivationStatus,
        effective_association_status: effectiveAssociationStatus,
        activation_authority: 'NONE_IN_CREATOR',
        function_label: typeof tac.function === 'string' ? tac.function : null,
        control_purpose: typeof tac.control_purpose === 'string' ? tac.control_purpose : null,
        principal_outputs: asStringArray(tac.principal_outputs) ?? [],
        reassessment_text: typeof tac.reassessment_text === 'string' ? tac.reassessment_text : null,
        prerequisite_tactic_ids: prereqIds,
        operationalization_status:
          typeof tac.operationalization_status === 'string'
            ? tac.operationalization_status
            : 'UNSPECIFIED'
      });

      for (const objId of primaryMappings) {
        const list = tacticsByObjectId.get(objId) ?? [];
        list.push(tacId);
        tacticsByObjectId.set(objId, list);
      }
    }

    // 9. Build per-pair normalized models and coverage matrix (I-01, I-04, I-05, I-12, I-13).
    const resolveRequirementSources = (ctrl: Record<string, unknown>, ownerObjectId: string) => {
      const reqIds = asStringArray(ctrl.requirementIds) ?? [];
      const presetRegistered: string[] = [];
      const unresolved: string[] = [];
      for (const reqId of reqIds) {
        const req = reqById.get(reqId);
        if (!req) {
          findings.push({
            code: 'UNRESOLVED_REFERENCE',
            severity: 'ERROR',
            tier,
            path: `/inputs/criteria-instrument/controls/${ownerObjectId}/requirementIds`,
            message: `Control for "${ownerObjectId}" references unknown requirement "${reqId}".`
          });
          continue;
        }
        for (const srcId of req.sourceIds) {
          if (registeredSourceIds.has(srcId)) {
            presetRegistered.push(srcId);
            usedSourceIds.add(srcId);
          } else {
            unresolved.push(srcId);
          }
        }
      }
      return {
        presetRegistered: [...new Set(presetRegistered)],
        unresolved: [...new Set(unresolved)]
      };
    };

    for (const pair of pairMap.values()) {
      const domainInfo = domainMap.get(pair.domain_id);
      const domainTitle = domainInfo?.title ?? pair.domain_id;
      const folderToken = options.profile.domain_folder_tokens?.[pair.domain_id] ?? pair.domain_id;
      const ctrl = controlByObjectId.get(pair.capability.id);
      const ap = apByObjectId.get(pair.antipattern.id);

      if (!ctrl || !ap) {
        findings.push({
          code: 'INSTRUMENT_OBJECT_MISSING',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/${pair.pair_id}`,
          message: `Instrument is missing control or anti-pattern record for pair "${pair.pair_id}".`
        });
        continue;
      }

      if (ctrl.title !== pair.capability.title || ctrl.domain !== pair.domain_id || ctrl.pairedObjectId !== pair.antipattern.id) {
        findings.push({
          code: 'TAXONOMY_INSTRUMENT_MISMATCH',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/controls/${pair.capability.id}`,
          message: `Capability "${pair.capability.id}" title, domain, or pairedObjectId disagrees between taxonomy and instrument.`
        });
      }

      if (ap.title !== pair.antipattern.title || ap.domain !== pair.domain_id || ap.pairedObjectId !== pair.capability.id) {
        findings.push({
          code: 'TAXONOMY_INSTRUMENT_MISMATCH',
          severity: 'ERROR',
          tier,
          path: `/inputs/criteria-instrument/antipatterns/${pair.antipattern.id}`,
          message: `Anti-pattern "${pair.antipattern.id}" title, domain, or pairedObjectId disagrees between taxonomy and instrument.`
        });
      }

      const capSources = resolveRequirementSources(ctrl, pair.capability.id);
      const apRelatedControls = (asStringArray(ap.relatedControlIds) ?? [])
        .map((id) => controlById.get(id))
        .filter((c): c is Record<string, unknown> => Boolean(c));
      const apPresetSet = new Set<string>();
      const apUnresolvedSet = new Set<string>();
      for (const relCtrl of apRelatedControls) {
        const relSources = resolveRequirementSources(relCtrl, pair.antipattern.id);
        for (const s of relSources.presetRegistered) apPresetSet.add(s);
        for (const s of relSources.unresolved) apUnresolvedSet.add(s);
      }

      // Flag any nonempty unresolved sourceIds explicitly without substituting another source (I-13).
      for (const [objectId, unresolvedList] of [
        [pair.capability.id, capSources.unresolved],
        [pair.antipattern.id, [...apUnresolvedSet]]
      ] as const) {
        for (const missingSrc of unresolvedList) {
          const conflictId = `unresolved-source:${objectId}:${missingSrc}`;
          conflicts.push({
            conflict_id: conflictId,
            sources: ['criteria-instrument', 'source-register'],
            affected_object_ids: [objectId],
            path: `/inputs/criteria-instrument/${objectId}/sourceIds`,
            message: `Object "${objectId}" references source "${missingSrc}" absent from the selected Source Register.`,
            blocks_delivery: true
          });
          findings.push({
            code: 'UNRESOLVED_SOURCE_ID',
            severity: 'ERROR',
            tier,
            path: `/inputs/criteria-instrument/${objectId}/sourceIds`,
            message: `Object "${objectId}" references unregistered source "${missingSrc}"; refusing silent substitution.`
          });
        }
      }

      const candidateDomainSources = [...(domainSources.get(pair.domain_id) ?? [])];
      for (const domSrc of candidateDomainSources) usedSourceIds.add(domSrc);

      const capDetailGaps = [
        Array.isArray(ctrl.atomicSubcriteria) && ctrl.atomicSubcriteria.length > 0 ? null : 'atomic_subcriteria',
        Array.isArray(ctrl.findingDefinitions) && ctrl.findingDefinitions.length > 0 ? null : 'finding_definitions',
        Array.isArray(ctrl.evidenceRules) && ctrl.evidenceRules.length > 0 ? null : 'evidence_rules'
      ].filter((item): item is string => item !== null);

      const apDetailGaps = [
        Array.isArray(ap.atomicTests) && ap.atomicTests.length > 0 ? null : 'atomic_tests',
        Array.isArray(ap.findingDefinitions) && ap.findingDefinitions.length > 0 ? null : 'finding_definitions',
        Array.isArray(ap.evidenceRules) && ap.evidenceRules.length > 0 ? null : 'evidence_rules'
      ].filter((item): item is string => item !== null);

      const capConflicts = conflicts
        .filter((c) => c.blocks_delivery && c.affected_object_ids.includes(pair.capability.id))
        .map((c) => c.conflict_id);
      const apConflicts = conflicts
        .filter((c) => c.blocks_delivery && c.affected_object_ids.includes(pair.antipattern.id))
        .map((c) => c.conflict_id);

      const isGoldenPair = goldenReference?.pair_id === pair.pair_id;
      const capQuestions = parsedQuestionsByObject.get(pair.capability.id) ?? [];
      const apQuestions = parsedQuestionsByObject.get(pair.antipattern.id) ?? [];

      const buildCoverageEntry = (
        objectId: string,
        objectType: 'capability' | 'antipattern',
        title: string,
        pairedObjectId: string,
        questions: PlanQuestion[],
        presetSources: string[],
        unresolvedSources: string[],
        detailGaps: string[],
        blockingConflicts: string[]
      ): ObjectCoverageEntry => ({
        kb_id: options.profile.kb_id,
        namespaced_object_id: `${options.profile.kb_id}:${objectId}`,
        object_id: objectId,
        object_type: objectType,
        title,
        domain_id: pair.domain_id,
        domain_title: domainTitle,
        pair_id: pair.pair_id,
        paired_object_id: pairedObjectId,
        question_ids: questions.map((q) => q.id),
        cognitive_requirements: cognitiveSummary?.rules ?? [],
        preset_source_ids: presetSources,
        unresolved_source_ids: unresolvedSources,
        candidate_domain_source_ids: candidateDomainSources,
        source_coverage_level:
          presetSources.length > 0
            ? 'PRESET_REGISTERED'
            : candidateDomainSources.length > 0
              ? 'COARSE_DOMAIN_ONLY'
              : 'NONE',
        golden_role: isGoldenPair ? 'GOLDEN_REFERENCE_PAIR' : 'TARGET_GENERATION_OBJECT',
        tactic_ids: tacticsByObjectId.get(objectId) ?? [],
        detail_gaps: detailGaps,
        blocking_conflict_ids: blockingConflicts
      });

      coverageMatrix.push(
        buildCoverageEntry(
          pair.capability.id,
          'capability',
          pair.capability.title,
          pair.antipattern.id,
          capQuestions,
          capSources.presetRegistered,
          capSources.unresolved,
          capDetailGaps,
          capConflicts
        ),
        buildCoverageEntry(
          pair.antipattern.id,
          'antipattern',
          pair.antipattern.title,
          pair.capability.id,
          apQuestions,
          [...apPresetSet],
          [...apUnresolvedSet],
          apDetailGaps,
          apConflicts
        )
      );

      const ctrlReqRecords = (asStringArray(ctrl.requirementIds) ?? [])
        .map((id) => reqById.get(id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      const primaryReq = ctrlReqRecords[0];
      const relatedObjIds = [
        ...new Set(
          apRelatedControls
            .map((c) => (typeof c.authoringObjectId === 'string' ? c.authoringObjectId : ''))
            .filter((id) => id.length > 0)
        )
      ];
      const lifecycleStages =
        asStringArray(ctrl.lifecycleStages) ??
        primaryReq?.lifecycleStages ??
        asStringArray(ap.lifecycleStages) ??
        [];

      pairs.push({
        pair_id: pair.pair_id,
        domain_id: pair.domain_id,
        domain_title: domainTitle,
        folder_token: folderToken,
        capability: {
          id: pair.capability.id,
          title: pair.capability.title,
          questions: capQuestions,
          preset_source_ids: capSources.presetRegistered,
          candidate_domain_source_ids: candidateDomainSources,
          detail_gaps: capDetailGaps,
          blocking_conflict_ids: capConflicts
        },
        antipattern: {
          id: pair.antipattern.id,
          title: pair.antipattern.title,
          questions: apQuestions,
          preset_source_ids: [...apPresetSet],
          candidate_domain_source_ids: candidateDomainSources,
          detail_gaps: apDetailGaps,
          blocking_conflict_ids: apConflicts
        },
        instrument_metadata: {
          capability_applicability: primaryReq?.applicability ?? null,
          capability_human_authority: primaryReq?.humanAuthority ?? null,
          capability_target_state: typeof ctrl.targetState === 'string' ? ctrl.targetState : null,
          capability_severity: typeof ctrl.severity === 'string' ? ctrl.severity : null,
          antipattern_severity: typeof ap.severity === 'string' ? ap.severity : null,
          antipattern_signals: asStringArray(ap.signals) ?? [],
          related_object_ids: relatedObjIds,
          lifecycle_stages: lifecycleStages
        }
      });
    }
  }

  // DC-01 prepares pinned inputs and plans; source-passage preparation happens in DC-02.
  findings.push({
    code: 'SOURCE_PASSAGES_NOT_PREPARED',
    severity: 'WARNING',
    tier: 'RELEASE',
    path: '/source_summary',
    message:
      'Source Register metadata and coverage are validated, but permitted source passages with locators have not been acquired yet (DC-02).'
  });

  const hasDraftBlockingErrors = findings.some((f) => f.severity === 'ERROR');
  const hasDeliveryBlockers =
    hasDraftBlockingErrors ||
    conflicts.some((c) => c.blocks_delivery) ||
    !pinned.destinationReady;

  const planningReady = !hasDraftBlockingErrors && pairs.length > 0 && pinned.destinationReady;
  const authoringReady = false;
  const deliveryReady = !hasDeliveryBlockers && authoringReady;

  const inputSetId = computeSha256(
    JSON.stringify({
      profile_id: options.profile.profile_id,
      profile_version: options.profile.profile_version,
      kb_id: options.profile.kb_id,
      inputs: pinned.descriptors
        .map((d) => [d.role, d.version, d.sha256])
        .sort(([a], [b]) => a!.localeCompare(b!)),
      decisions: appliedOwnerDecisions
        .map((d) => [d.decision_id, d.version, d.sha256])
        .sort(([a], [b]) => a!.localeCompare(b!))
    })
  );

  const unusedRegisteredSources = [...registeredSourceIds].filter((id) => !usedSourceIds.has(id)).sort();

  const inputSet: ResolvedInputSet = {
    schema_version: '1.0.0',
    input_set_id: inputSetId,
    profile_id: options.profile.profile_id,
    profile_version: options.profile.profile_version,
    kb_id: options.profile.kb_id,
    kb_title: options.profile.kb_title,
    language: options.profile.language,
    is_synthetic: options.profile.is_synthetic,
    storage: {
      connection_id: options.profile.storage_ref.connection_id,
      provider: options.profile.storage_ref.provider,
      output_root: options.profile.storage_ref.output_root,
      operations_root: options.profile.storage_ref.operations_root,
      destination_ready: pinned.destinationReady
    },
    resolved_inputs: pinned.descriptors,
    applied_owner_decisions: appliedOwnerDecisions,
    golden_reference: goldenReference,
    cognitive_model: cognitiveSummary,
    readiness: {
      tier,
      planning_ready: planningReady,
      authoring_ready: authoringReady,
      delivery_ready: deliveryReady,
      findings
    },
    conflicts,
    source_summary: {
      registered_source_count: registeredSourceIds.size,
      unused_registered_source_ids: unusedRegisteredSources,
      metadata_only_source_ids: metadataOnlySourceIds.sort()
    },
    coverage_matrix: coverageMatrix
  };

  const contractCheck = validateResolvedInputSet(inputSet, tier);
  if (contractCheck.length > 0) {
    throw new Error(`ResolvedInputSet violated Creator contract: ${JSON.stringify(contractCheck)}`);
  }

  return {
    profile: options.profile,
    pinned,
    inputSet,
    pairs,
    tactics
  };
}
