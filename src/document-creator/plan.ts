import {
  collectIllustrativePlaceholderFindings,
  validateDocumentPlan,
  type CreatorFinding,
  type DocumentPlan,
  type DocumentPlanSelection,
  type PlannedDocument,
  type PlannedWorkUnit,
  type TacticAssociationSummary
} from './contracts.js';
import { computeSha256 } from './inputs.js';
import type { NormalizedPairModel, ResolvedProfileRuntime } from './profiles.js';

export class DocumentPlanError extends Error {
  readonly code: string;
  readonly findings: CreatorFinding[];

  constructor(code: string, message: string, findings: CreatorFinding[] = []) {
    super(message);
    this.name = 'DocumentPlanError';
    this.code = code;
    this.findings = findings;
  }
}

function assertSafePathToken(token: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(token)) {
    throw new DocumentPlanError('UNSAFE_PATH_TOKEN', `Unsafe ${label} token for output path: "${token}".`);
  }
  return token;
}

function buildObjectDocument(options: {
  kbId: string;
  pair: NormalizedPairModel;
  objectType: 'capability' | 'antipattern';
  requiredSections: string[];
  tacticsByObjectId: Map<string, TacticAssociationSummary[]>;
}): PlannedDocument {
  const sourceObj =
    options.objectType === 'capability' ? options.pair.capability : options.pair.antipattern;
  const pairedId =
    options.objectType === 'capability' ? options.pair.antipattern.id : options.pair.capability.id;
  const storageType = options.objectType === 'capability' ? 'capabilities' : 'antipatterns';

  const safeKbId = assertSafePathToken(options.kbId, 'kb_id');
  const safeFolder = assertSafePathToken(options.pair.folder_token, 'folder_token');
  const safeObjectId = assertSafePathToken(sourceObj.id, 'object_id');

  const associatedTactics = (options.tacticsByObjectId.get(sourceObj.id) ?? []).map((tac) => ({
    tactic_id: tac.tactic_id,
    effective_association_status: tac.effective_association_status,
    original_activation_status: tac.original_activation_status,
    activation_authority: 'NONE_IN_CREATOR' as const
  }));

  return {
    document_id: `${safeKbId}:${safeObjectId}`,
    kb_id: safeKbId,
    object_id: safeObjectId,
    object_type: options.objectType,
    storage_type: storageType,
    domain_id: options.pair.domain_id,
    folder_token: safeFolder,
    title: sourceObj.title,
    paired_object_id: pairedId,
    related_domains: [options.pair.domain_id],
    required_sections: [...options.requiredSections],
    destination_path_template: `${safeFolder}/${storageType}/${safeObjectId}/{version}/document.md`,
    questions: sourceObj.questions,
    tactic_associations: associatedTactics,
    preset_source_ids: sourceObj.preset_source_ids,
    candidate_domain_source_ids: sourceObj.candidate_domain_source_ids,
    detail_gaps: sourceObj.detail_gaps,
    blocking_conflict_ids: sourceObj.blocking_conflict_ids
  };
}

function buildTacticDocument(options: {
  kbId: string;
  tactic: TacticAssociationSummary;
  domainFolderTokens: Record<string, string> | undefined;
  requiredSections: string[];
}): PlannedDocument {
  const safeKbId = assertSafePathToken(options.kbId, 'kb_id');
  const folderToken = options.domainFolderTokens?.[options.tactic.owning_domain] ?? options.tactic.owning_domain;
  const safeFolder = assertSafePathToken(folderToken, 'tactic_folder_token');
  const safeTacticId = assertSafePathToken(options.tactic.tactic_id, 'tactic_id');

  return {
    document_id: `${safeKbId}:${safeTacticId}`,
    kb_id: safeKbId,
    object_id: safeTacticId,
    object_type: 'tactic',
    storage_type: 'tactics',
    domain_id: options.tactic.owning_domain,
    folder_token: safeFolder,
    title: options.tactic.title,
    paired_object_id: null,
    related_domains: options.tactic.related_domains,
    required_sections: [...options.requiredSections],
    destination_path_template: `${safeFolder}/tactics/${safeTacticId}/{version}/document.md`,
    questions: [],
    tactic_associations: [
      {
        tactic_id: options.tactic.tactic_id,
        effective_association_status: options.tactic.effective_association_status,
        original_activation_status: options.tactic.original_activation_status,
        activation_authority: 'NONE_IN_CREATOR'
      }
    ],
    preset_source_ids: [],
    candidate_domain_source_ids: [],
    detail_gaps: [],
    blocking_conflict_ids: []
  };
}

export function createDocumentPlan(
  runtime: ResolvedProfileRuntime,
  selection: DocumentPlanSelection
): DocumentPlan {
  if (!runtime.inputSet.readiness.planning_ready) {
    throw new DocumentPlanError(
      'INPUT_SET_NOT_READY',
      `Cannot create document plan for "${runtime.profile.profile_id}" while planning_ready is false.`,
      runtime.inputSet.readiness.findings
    );
  }

  const placeholderFindings = collectIllustrativePlaceholderFindings(selection, '/selection');
  if (placeholderFindings.length > 0) {
    throw new DocumentPlanError(
      'INVALID_PLAN_SELECTION',
      'Plan selection contains illustrative placeholders.',
      placeholderFindings
    );
  }

  const pairById = new Map(runtime.pairs.map((p) => [p.pair_id, p]));
  const pairByObjectId = new Map<string, { pair: NormalizedPairModel; objectType: 'capability' | 'antipattern' }>();
  for (const p of runtime.pairs) {
    pairByObjectId.set(p.capability.id, { pair: p, objectType: 'capability' });
    pairByObjectId.set(p.antipattern.id, { pair: p, objectType: 'antipattern' });
  }
  const tacticById = new Map(runtime.tactics.map((t) => [t.tactic_id, t]));

  const tacticsByObjectId = new Map<string, TacticAssociationSummary[]>();
  for (const tac of runtime.tactics) {
    for (const objId of tac.linked_object_ids) {
      const list = tacticsByObjectId.get(objId) ?? [];
      list.push(tac);
      tacticsByObjectId.set(objId, list);
    }
  }

  const requestedPairIds = [...new Set(selection.pair_ids ?? [])];
  const requestedDomainIds = [...new Set(selection.domain_ids ?? [])];
  const requestedObjectIds = [...new Set(selection.object_ids ?? [])];
  const requestedTacticIds = [...new Set(selection.tactic_ids ?? [])];
  const includeTactics = Boolean(selection.include_tactics) || requestedTacticIds.length > 0;

  const documents: PlannedDocument[] = [];
  const workUnits: PlannedWorkUnit[] = [];
  const plannedDocumentIds = new Set<string>();
  const selectedObjectIdsForTactics = new Set<string>();

  const addPairedUnit = (pair: NormalizedPairModel) => {
    const capDoc = buildObjectDocument({
      kbId: runtime.profile.kb_id,
      pair,
      objectType: 'capability',
      requiredSections: runtime.profile.output_spec.required_sections.capability,
      tacticsByObjectId
    });
    const apDoc = buildObjectDocument({
      kbId: runtime.profile.kb_id,
      pair,
      objectType: 'antipattern',
      requiredSections: runtime.profile.output_spec.required_sections.antipattern,
      tacticsByObjectId
    });
    if (plannedDocumentIds.has(capDoc.document_id) || plannedDocumentIds.has(apDoc.document_id)) {
      return;
    }
    plannedDocumentIds.add(capDoc.document_id);
    plannedDocumentIds.add(apDoc.document_id);
    selectedObjectIdsForTactics.add(capDoc.object_id);
    selectedObjectIdsForTactics.add(apDoc.object_id);
    documents.push(capDoc, apDoc);

    if (runtime.profile.output_spec.paired_work_unit) {
      workUnits.push({
        work_unit_id: `${runtime.profile.kb_id}:unit:${pair.pair_id}`,
        unit_type: 'paired_capability_antipattern',
        pair_id: pair.pair_id,
        domain_id: pair.domain_id,
        document_ids: [capDoc.document_id, apDoc.document_id]
      });
    } else {
      workUnits.push(
        {
          work_unit_id: `${runtime.profile.kb_id}:unit:${capDoc.object_id}`,
          unit_type: 'standalone_object',
          pair_id: pair.pair_id,
          domain_id: pair.domain_id,
          document_ids: [capDoc.document_id]
        },
        {
          work_unit_id: `${runtime.profile.kb_id}:unit:${apDoc.object_id}`,
          unit_type: 'standalone_object',
          pair_id: pair.pair_id,
          domain_id: pair.domain_id,
          document_ids: [apDoc.document_id]
        }
      );
    }
  };

  if (selection.mode === 'pair') {
    if (requestedPairIds.length === 0) {
      throw new DocumentPlanError('EMPTY_SELECTION', 'Mode "pair" requires at least one pair_id.');
    }
    for (const pairId of requestedPairIds) {
      const pair = pairById.get(pairId);
      if (!pair) {
        throw new DocumentPlanError('UNKNOWN_PAIR_ID', `Unknown pair_id "${pairId}" for profile "${runtime.profile.profile_id}".`);
      }
      addPairedUnit(pair);
    }
  } else if (selection.mode === 'domain') {
    if (requestedDomainIds.length === 0) {
      throw new DocumentPlanError('EMPTY_SELECTION', 'Mode "domain" requires at least one domain_id.');
    }
    const availableDomains = new Set(runtime.pairs.map((p) => p.domain_id));
    for (const domId of requestedDomainIds) {
      if (!availableDomains.has(domId)) {
        throw new DocumentPlanError('UNKNOWN_DOMAIN_ID', `Unknown domain_id "${domId}" for profile "${runtime.profile.profile_id}".`);
      }
      for (const pair of runtime.pairs.filter((p) => p.domain_id === domId)) {
        addPairedUnit(pair);
      }
    }
  } else if (selection.mode === 'all') {
    for (const pair of runtime.pairs) {
      addPairedUnit(pair);
    }
  } else if (selection.mode === 'explicit') {
    if (requestedPairIds.length === 0 && requestedObjectIds.length === 0 && requestedTacticIds.length === 0) {
      throw new DocumentPlanError(
        'EMPTY_SELECTION',
        'Mode "explicit" requires at least one pair_id, object_id, or tactic_id.'
      );
    }
    for (const pairId of requestedPairIds) {
      const pair = pairById.get(pairId);
      if (!pair) {
        throw new DocumentPlanError('UNKNOWN_PAIR_ID', `Unknown pair_id "${pairId}".`);
      }
      addPairedUnit(pair);
    }
    for (const objectId of requestedObjectIds) {
      const match = pairByObjectId.get(objectId);
      if (!match) {
        throw new DocumentPlanError('UNKNOWN_OBJECT_ID', `Unknown capability or anti-pattern id "${objectId}".`);
      }
      const doc = buildObjectDocument({
        kbId: runtime.profile.kb_id,
        pair: match.pair,
        objectType: match.objectType,
        requiredSections:
          match.objectType === 'capability'
            ? runtime.profile.output_spec.required_sections.capability
            : runtime.profile.output_spec.required_sections.antipattern,
        tacticsByObjectId
      });
      if (!plannedDocumentIds.has(doc.document_id)) {
        plannedDocumentIds.add(doc.document_id);
        selectedObjectIdsForTactics.add(doc.object_id);
        documents.push(doc);
        workUnits.push({
          work_unit_id: `${runtime.profile.kb_id}:unit:${doc.object_id}`,
          unit_type: 'standalone_object',
          pair_id: match.pair.pair_id,
          domain_id: match.pair.domain_id,
          document_ids: [doc.document_id]
        });
      }
    }
  }

  // Optional tactic rendering: only when requested in output selection (T-03).
  if (includeTactics) {
    if (!runtime.profile.output_spec.document_types.includes('tactic')) {
      throw new DocumentPlanError(
        'TACTICS_NOT_ENABLED_IN_PROFILE',
        `Profile "${runtime.profile.profile_id}" does not enable tactic document generation.`
      );
    }
    const candidateTactics: TacticAssociationSummary[] = [];
    if (requestedTacticIds.length > 0) {
      for (const tacId of requestedTacticIds) {
        const tac = tacticById.get(tacId);
        if (!tac) {
          throw new DocumentPlanError('UNKNOWN_TACTIC_ID', `Unknown tactic_id "${tacId}".`);
        }
        candidateTactics.push(tac);
      }
    } else {
      for (const tac of runtime.tactics) {
        if (tac.linked_object_ids.some((objId) => selectedObjectIdsForTactics.has(objId))) {
          candidateTactics.push(tac);
        }
      }
    }

    const seenPlannedTactics = new Set<string>();
    for (const tac of candidateTactics) {
      if (seenPlannedTactics.has(tac.tactic_id)) continue;
      seenPlannedTactics.add(tac.tactic_id);
      const tacDoc = buildTacticDocument({
        kbId: runtime.profile.kb_id,
        tactic: tac,
        domainFolderTokens: runtime.profile.domain_folder_tokens,
        requiredSections: runtime.profile.output_spec.required_sections.tactic
      });
      if (!plannedDocumentIds.has(tacDoc.document_id)) {
        plannedDocumentIds.add(tacDoc.document_id);
        documents.push(tacDoc);
        workUnits.push({
          work_unit_id: `${runtime.profile.kb_id}:unit:${tacDoc.object_id}`,
          unit_type: 'tactic',
          pair_id: null,
          domain_id: tacDoc.domain_id,
          document_ids: [tacDoc.document_id]
        });
      }
    }
  }

  const normalizedSelection: DocumentPlan['selection'] = {
    mode: selection.mode,
    pair_ids: requestedPairIds,
    domain_ids: requestedDomainIds,
    object_ids: requestedObjectIds,
    include_tactics: Boolean(selection.include_tactics),
    tactic_ids: requestedTacticIds
  };

  const planId = computeSha256(
    JSON.stringify({
      input_set_id: runtime.inputSet.input_set_id,
      selection: normalizedSelection,
      document_ids: documents.map((d) => d.document_id)
    })
  );

  const capabilityCount = documents.filter((d) => d.object_type === 'capability').length;
  const antipatternCount = documents.filter((d) => d.object_type === 'antipattern').length;
  const tacticCount = documents.filter((d) => d.object_type === 'tactic').length;
  const blockingConflictIds = new Set(documents.flatMap((d) => d.blocking_conflict_ids));

  const plan: DocumentPlan = {
    schema_version: '1.0.0',
    plan_id: planId,
    input_set_id: runtime.inputSet.input_set_id,
    profile_id: runtime.profile.profile_id,
    kb_id: runtime.profile.kb_id,
    kb_title: runtime.profile.kb_title,
    is_synthetic: runtime.profile.is_synthetic,
    primary_format: runtime.profile.output_spec.primary_format,
    pdf_enabled: runtime.profile.output_spec.pdf_enabled,
    selection: normalizedSelection,
    work_units: workUnits,
    documents,
    summary: {
      work_unit_count: workUnits.length,
      capability_count: capabilityCount,
      antipattern_count: antipatternCount,
      tactic_count: tacticCount,
      total_documents: documents.length,
      blocking_conflict_count: blockingConflictIds.size
    }
  };

  const planErrors = validateDocumentPlan(plan);
  if (planErrors.length > 0) {
    throw new DocumentPlanError(
      'PLAN_CONTRACT_VIOLATION',
      `Generated DocumentPlan failed schema validation: ${JSON.stringify(planErrors)}`,
      planErrors
    );
  }

  return plan;
}
