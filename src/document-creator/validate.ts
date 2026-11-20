import {
  validateCreatorDocument,
  type CreatorDocument,
  type CreatorFinding,
  type DocumentPlan,
  type PlannedDocument,
  type SourcePreparationBundle,
  type StrictnessTier
} from './contracts.js';
import {
  DEFAULT_ANTIPATTERN_SECTIONS,
  DEFAULT_CAPABILITY_SECTIONS,
  type ResolvedProfileRuntime
} from './profiles.js';

export interface SectionSpec {
  code: string;
  title: string;
}

export function parseSectionSpec(raw: string): SectionSpec {
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) {
    const trimmed = raw.trim();
    return { code: trimmed, title: trimmed };
  }
  const code = raw.slice(0, colonIdx).trim();
  const title = raw.slice(colonIdx + 1).trim();
  return {
    code: code || 'SEC',
    title: title || code || 'Section'
  };
}

export function defaultCatalogForObjectType(
  objectType: 'capability' | 'antipattern'
): SectionSpec[] {
  const specs =
    objectType === 'capability' ? DEFAULT_CAPABILITY_SECTIONS : DEFAULT_ANTIPATTERN_SECTIONS;
  return specs.map(parseSectionSpec);
}

export interface DocumentValidationResult {
  document_id: string;
  object_id: string;
  object_type: 'capability' | 'antipattern';
  tier: StrictnessTier;
  draft_valid: boolean;
  delivery_ready: boolean;
  findings: CreatorFinding[];
}

export interface PairValidationResult {
  work_unit_id: string;
  pair_id: string;
  tier: StrictnessTier;
  draft_valid: boolean;
  delivery_ready: boolean;
  capability: DocumentValidationResult;
  antipattern: DocumentValidationResult;
  pair_findings: CreatorFinding[];
}

const NEGATION_CUE =
  /\b(?:not|never|no|neither|nor|cannot|can't|do\s+not|does\s+not|must\s+not|may\s+not|without|insufficient|prohibited|forbid|forbidden|invalid|reject|rejected|refuse)\b/i;

function splitIntoClauses(text: string): string[] {
  return text
    .split(/[.;\n]+|\b(?:however|whereas|but|although|though)\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function hasAffirmativeSilenceAsAbsenceClaim(text: string): boolean {
  const silenceSubject =
    /\b(?:silence|silent\s+logs?|missing\s+incidents?|no\s+(?:reported\s+)?incidents?|zero\s+(?:reported\s+)?incidents?|absence\s+of\s+(?:reported\s+)?(?:incidents?|complaints?|violations?|detections?|findings?)|no\s+(?:reported\s+)?(?:complaints?|violations?|detections?)|lack\s+of\s+(?:reported\s+)?(?:incidents?|complaints?|evidence|findings?)|empty\s+(?:audit\s+)?logs?|unexecuted\s+discovery)\b/i;
  const absenceConclusion =
    /\b(?:proves?|establishes?|confirms?|demonstrates?|suffices?\s+(?:for|as)|constitutes?|is\s+proof\s+of|counts?\s+as|satisfies)\b[\s\S]{0,80}\b(?:tested[_\s-]?absent|anti-?pattern\s+absence|absence\s+of\s+(?:the\s+)?anti-?pattern|is\s+absent|ap-[a-z0-9_-]+\s+is\s+absent)\b/i;

  for (const clause of splitIntoClauses(text)) {
    if (!silenceSubject.test(clause)) continue;
    // Strip the allowed noun phrases like "no reported incidents" / "no complaints" before checking verb negation!
    const strippedForNegationCheck = clause.replace(
      /\b(?:no|missing|zero|without)\s+(?:reported\s+|detected\s+|observed\s+)?(?:incidents?|complaints?|violations?|detections?|findings?|alerts?|issues?)\b/gi,
      'SILENCE_SIGNAL'
    );
    if (NEGATION_CUE.test(strippedForNegationCheck)) continue;
    if (absenceConclusion.test(clause)) {
      return true;
    }
  }
  return false;
}

export function hasAffirmativeInversePairInference(text: string): boolean {
  const capGapImpliesApPresence =
    /\b(?:capability\s+gap|not[_\s-]?satisfied|(?:failing|unsatisfied|missing)\s+capability(?:\s+[a-z0-9_-]+)?)\b[\s\S]{0,80}\b(?:proves?|establishes?|confirms?|implies?|means?|renders?|results?\s+in)\b[\s\S]{0,60}\b(?:confirmed[_\s-]?present|anti-?pattern(?:\s+[a-z0-9_-]+)?\s+(?:is\s+)?present|presence\s+of\s+(?:the\s+)?anti-?pattern|ap-[a-z0-9_-]+\s+is\s+present)\b/i;
  const conditionalCapGapToApPresence =
    /\b(?:when|if|whenever|where)\b[\s\S]{0,60}\b(?:capability\s+gap|not[_\s-]?satisfied|(?:failing|unsatisfied)\s+capability)\b[\s\S]{0,80}\b(?:confirmed[_\s-]?present|anti-?pattern(?:\s+[a-z0-9_-]+)?\s+(?:is|becomes)\s+present|ap-[a-z0-9_-]+\s+(?:is|becomes)\s+present)\b/i;
  const apAbsenceImpliesCapSatisfied =
    /\b(?:tested[_\s-]?absent|anti-?pattern\s+absence|absence\s+of\s+(?:the\s+)?anti-?pattern|anti-?pattern\s+is\s+unknown)\b[\s\S]{0,80}\b(?:proves?|establishes?|confirms?|implies?)\b[\s\S]{0,60}\b(?:capability\s+(?:is\s+)?satisfied|satisfies\s+capability)\b/i;

  for (const clause of splitIntoClauses(text)) {
    // Preserve NOT_SATISFIED token while testing whether the verb is negated.
    const normalized = clause.replace(/\bNOT_SATISFIED\b/gi, 'CAPABILITY_GAP_STATE');
    if (NEGATION_CUE.test(normalized)) continue;
    if (
      capGapImpliesApPresence.test(clause) ||
      conditionalCapGapToApPresence.test(clause) ||
      apAbsenceImpliesCapSatisfied.test(clause)
    ) {
      return true;
    }
  }
  return false;
}

export function hasAffirmativeTacticActivationClaim(text: string): boolean {
  const activationPattern =
    /\b(?:tactic(?:\s+selection|\s+completion)?|completing\s+(?:this|a|the)\s+tactic|selecting\s+(?:this|a|the)\s+tactic)\b[\s\S]{0,80}\b(?:automatically\s+closes?|directly\s+closes?|closes?\s+(?:the\s+|a\s+)?(?:locked\s+)?finding|clears?\s+(?:the\s+|a\s+)?hard\s+gate|activates?\s+customer\s+remediation|grants?\s+(?:hub\s+approval|legal\s+compliance|activation))\b/i;

  for (const clause of splitIntoClauses(text)) {
    if (NEGATION_CUE.test(clause)) continue;
    if (activationPattern.test(clause)) {
      return true;
    }
  }
  return false;
}

function collectDocumentAuthoredTexts(doc: CreatorDocument): Array<{ path: string; text: string }> {
  const segments: Array<{ path: string; text: string }> = [];
  doc.sections.forEach((sec, idx) => {
    if (sec.prose) segments.push({ path: `/sections/${idx}/prose`, text: sec.prose });
    sec.bullets.forEach((b, bIdx) => {
      segments.push({ path: `/sections/${idx}/bullets/${bIdx}`, text: b });
    });
  });
  doc.questions.forEach((q, idx) => {
    segments.push({ path: `/questions/${idx}/assessment_guidance`, text: q.assessment_guidance });
  });
  const ab = doc.assessment_boundaries;
  ab.unknown_handling.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/unknown_handling/${i}`, text: t })
  );
  ab.contradiction_handling.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/contradiction_handling/${i}`, text: t })
  );
  ab.false_positive_guards.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/false_positive_guards/${i}`, text: t })
  );
  ab.prohibited_inferences.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/prohibited_inferences/${i}`, text: t })
  );
  ab.human_decision_boundaries.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/human_decision_boundaries/${i}`, text: t })
  );
  ab.evidence_ceilings.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/evidence_ceilings/${i}`, text: t })
  );
  segments.push({
    path: '/assessment_boundaries/paired_independence_rule',
    text: ab.paired_independence_rule
  });
  if (ab.failure_mechanism) {
    segments.push({
      path: '/assessment_boundaries/failure_mechanism',
      text: ab.failure_mechanism
    });
  }
  ab.observable_indicators.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/observable_indicators/${i}`, text: t })
  );
  ab.non_examples.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/non_examples/${i}`, text: t })
  );
  ab.tested_absence_requirements.forEach((t, i) =>
    segments.push({ path: `/assessment_boundaries/tested_absence_requirements/${i}`, text: t })
  );
  doc.sourced_claims.forEach((c, i) => {
    segments.push({ path: `/sourced_claims/${i}/statement`, text: c.statement });
    segments.push({ path: `/sourced_claims/${i}/applicability_note`, text: c.applicability_note });
  });
  doc.methodology_interpretations.forEach((m, i) => {
    segments.push({ path: `/methodology_interpretations/${i}/statement`, text: m.statement });
  });
  doc.related_object_links.forEach((r, i) => {
    segments.push({ path: `/related_object_links/${i}/non_inverse_meaning`, text: r.non_inverse_meaning });
  });
  doc.tactic_associations.forEach((t, i) => {
    segments.push({
      path: `/tactic_associations/${i}/scope_and_boundary_note`,
      text: t.scope_and_boundary_note
    });
  });
  return segments;
}

function extractGoldenContaminationSignatures(runtime: ResolvedProfileRuntime): {
  goldenPairId: string | null;
  verbatimSnippets: string[];
  internalHandlePatterns: RegExp[];
} {
  const goldenRef = runtime.inputSet.golden_reference;
  if (!goldenRef) {
    return { goldenPairId: null, verbatimSnippets: [], internalHandlePatterns: [] };
  }

  const verbatimSnippets: string[] = [];
  const activeTacticIds = new Set(runtime.tactics.map((t) => t.tactic_id));
  const goldenOnlyTacticIds = new Set<string>();

  for (const role of ['golden-capability', 'golden-antipattern'] as const) {
    if (!runtime.pinned.hasRole(role)) continue;
    const parsed = runtime.pinned.json(role);
    if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) continue;
    const obj = parsed.value as Record<string, unknown>;
    for (const field of ['canonical_definition', 'governance_purpose', 'distinct_claim', 'failure_mechanism']) {
      const val = obj[field];
      if (typeof val === 'string' && val.trim().length >= 36) {
        verbatimSnippets.push(val.trim());
      }
    }
    if (Array.isArray(obj.candidate_tactic_refs)) {
      for (const ref of obj.candidate_tactic_refs) {
        if (ref && typeof ref === 'object' && typeof (ref as { tactic_id?: unknown }).tactic_id === 'string') {
          const tId = (ref as { tactic_id: string }).tactic_id;
          if (!activeTacticIds.has(tId)) {
            goldenOnlyTacticIds.add(tId);
          }
        }
      }
    }
  }

  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const capEsc = escapeRe(goldenRef.capability_id);
  const apEsc = escapeRe(goldenRef.antipattern_id);

  const internalHandlePatterns: RegExp[] = [
    new RegExp(`\\b${capEsc}-SC-\\d+\\b`),
    new RegExp(`\\b${apEsc}-AT-\\d+\\b`),
    new RegExp(`\\bEVD-(?:${capEsc}|${apEsc})-\\d+\\b`),
    new RegExp(`\\bFND-(?:${capEsc}|${apEsc})-\\d+\\b`),
    new RegExp(`\\bSRCMAP-(?:${capEsc}|${apEsc})-[A-Za-z0-9_-]+\\b`)
  ];

  for (const legacyTacId of goldenOnlyTacticIds) {
    internalHandlePatterns.push(new RegExp(`\\b${escapeRe(legacyTacId)}\\b`));
  }

  return {
    goldenPairId: goldenRef.pair_id,
    verbatimSnippets,
    internalHandlePatterns
  };
}

export function validateCreatorDocumentAgainstContext(options: {
  document: CreatorDocument;
  plannedDocument: PlannedDocument;
  runtime: ResolvedProfileRuntime;
  plan: DocumentPlan;
  sourceBundle: SourcePreparationBundle;
  tier?: StrictnessTier;
}): DocumentValidationResult {
  const tier = options.tier ?? 'DRAFT';
  const { document: doc, plannedDocument, runtime, plan, sourceBundle } = options;
  const findings: CreatorFinding[] = [
    ...validateCreatorDocument(doc, tier),
    ...doc.rejected_authoring_attempts
  ];

  // 1. Code-owned identity, paths, state, and baseline hashes (D-02).
  if (doc.document_id !== plannedDocument.document_id) {
    findings.push({
      code: 'DOCUMENT_IDENTITY_MISMATCH',
      severity: 'ERROR',
      tier,
      path: '/document_id',
      message: `Document ID "${doc.document_id}" disagrees with planned document_id "${plannedDocument.document_id}".`
    });
  }
  if (
    doc.kb_id !== plannedDocument.kb_id ||
    doc.object_id !== plannedDocument.object_id ||
    doc.object_type !== plannedDocument.object_type ||
    doc.domain_id !== plannedDocument.domain_id ||
    doc.paired_object_id !== plannedDocument.paired_object_id
  ) {
    findings.push({
      code: 'DOCUMENT_METADATA_MISMATCH',
      severity: 'ERROR',
      tier,
      path: '/object_id',
      message: `Document metadata for "${doc.object_id}" disagrees with code-owned PlannedDocument.`
    });
  }
  if (doc.destination_path_template !== plannedDocument.destination_path_template) {
    findings.push({
      code: 'DESTINATION_PATH_MISMATCH',
      severity: 'ERROR',
      tier,
      path: '/destination_path_template',
      message: `Destination path template "${doc.destination_path_template}" disagrees with planned "${plannedDocument.destination_path_template}".`
    });
  }
  if (
    doc.input_set_id !== runtime.inputSet.input_set_id ||
    doc.plan_id !== plan.plan_id ||
    doc.source_bundle_id !== sourceBundle.bundle_id
  ) {
    findings.push({
      code: 'BASELINE_BINDING_MISMATCH',
      severity: 'ERROR',
      tier,
      path: '/input_set_id',
      message: `Document "${doc.document_id}" baseline IDs do not match pinned inputSet, plan, or sourceBundle.`
    });
  }

  // 2. Required vs profile-optional sections & stable section IDs (D-07, D-02).
  const requiredSpecs = plannedDocument.required_sections.map(parseSectionSpec);
  const requiredByCode = new Map(requiredSpecs.map((s) => [s.code, s]));
  const sectionByCode = new Map<string, { index: number; section: CreatorDocument['sections'][number] }>();

  doc.sections.forEach((sec, idx) => {
    const expectedSectionId = `${doc.object_id}.${sec.section_code}`;
    if (sec.section_id !== expectedSectionId) {
      findings.push({
        code: 'SECTION_ID_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `/sections/${idx}/section_id`,
        message: `Section ID "${sec.section_id}" must equal code-owned "${expectedSectionId}".`
      });
    }
    if (sectionByCode.has(sec.section_code)) {
      findings.push({
        code: 'DUPLICATE_SECTION_CODE',
        severity: 'ERROR',
        tier,
        path: `/sections/${idx}/section_code`,
        message: `Duplicate section_code "${sec.section_code}" in document "${doc.object_id}".`
      });
    } else {
      sectionByCode.set(sec.section_code, { index: idx, section: sec });
    }
  });

  const omittedByCode = new Map(doc.omitted_optional_sections.map((o) => [o.section_code, o]));

  for (const reqSpec of requiredSpecs) {
    if (omittedByCode.has(reqSpec.code)) {
      findings.push({
        code: 'REQUIRED_SECTION_CANNOT_BE_OMITTED',
        severity: 'ERROR',
        tier,
        path: `/omitted_optional_sections/${reqSpec.code}`,
        message: `Required section "${doc.object_id}.${reqSpec.code}" (${reqSpec.title}) cannot be marked omitted.`
      });
    }
    const found = sectionByCode.get(reqSpec.code);
    if (!found || found.section.status === 'MISSING_REQUIRED' || found.section.prose.trim().length === 0) {
      findings.push({
        code: 'REQUIRED_SECTION_MISSING',
        severity: 'ERROR',
        tier,
        path: found ? `/sections/${found.index}/prose` : `/sections/${reqSpec.code}`,
        message: `Required section "${doc.object_id}.${reqSpec.code}" (${reqSpec.title}) is absent or empty.`
      });
    }
  }

  for (const stdSpec of defaultCatalogForObjectType(doc.object_type)) {
    if (requiredByCode.has(stdSpec.code)) continue;
    const populated = sectionByCode.get(stdSpec.code);
    const omitted = omittedByCode.get(stdSpec.code);
    if (!populated && !omitted) {
      findings.push({
        code: 'IMPLICIT_OPTIONAL_OMISSION',
        severity: 'ERROR',
        tier,
        path: `/omitted_optional_sections/${stdSpec.code}`,
        message: `Profile-optional section "${doc.object_id}.${stdSpec.code}" (${stdSpec.title}) was omitted without an explicit optional-omission record.`
      });
    }
  }

  doc.omitted_optional_sections.forEach((omitted, idx) => {
    const expectedId = `${doc.object_id}.${omitted.section_code}`;
    if (omitted.section_id !== expectedId) {
      findings.push({
        code: 'SECTION_ID_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `/omitted_optional_sections/${idx}/section_id`,
        message: `Omitted section_id "${omitted.section_id}" must equal "${expectedId}".`
      });
    }
  });

  // 3. Question baseline & question/cognitive handle checks (D-02, S-08).
  const expectedQKeys = plannedDocument.questions.map((q) => `${q.id}|${q.dimension}|${q.question}`);
  const actualQKeys = doc.questions.map((q) => `${q.id}|${q.dimension}|${q.question}`);
  if (JSON.stringify(expectedQKeys) !== JSON.stringify(actualQKeys)) {
    findings.push({
      code: 'QUESTION_BASELINE_MISMATCH',
      severity: 'ERROR',
      tier,
      path: '/questions',
      message: `Questions on "${doc.object_id}" disagree with verified Thinking Flow / instrument baseline.`
    });
  }

  const allowedQuestionIds = new Set(plannedDocument.questions.map((q) => q.id));
  const allowedCognitiveRules = new Set(runtime.inputSet.cognitive_model?.rules ?? []);
  const allSectionIds = new Set(doc.sections.map((s) => s.section_id));

  doc.sections.forEach((sec, idx) => {
    sec.question_refs.forEach((qId, qIdx) => {
      if (!allowedQuestionIds.has(qId)) {
        findings.push({
          code: 'INVENTED_OR_FOREIGN_QUESTION_ID',
          severity: 'ERROR',
          tier,
          path: `/sections/${idx}/question_refs/${qIdx}`,
          message: `Section "${sec.section_id}" references invalid or foreign question_id "${qId}".`
        });
      }
    });
  });

  doc.methodology_interpretations.forEach((interp, idx) => {
    if (!allSectionIds.has(interp.section_id)) {
      findings.push({
        code: 'UNKNOWN_SECTION_ID_REFERENCE',
        severity: 'ERROR',
        tier,
        path: `/methodology_interpretations/${idx}/section_id`,
        message: `Methodology interpretation "${interp.interpretation_id}" references unknown section_id "${interp.section_id}".`
      });
    }
    interp.question_ids.forEach((qId, qIdx) => {
      if (!allowedQuestionIds.has(qId)) {
        findings.push({
          code: 'INVENTED_OR_FOREIGN_QUESTION_ID',
          severity: 'ERROR',
          tier,
          path: `/methodology_interpretations/${idx}/question_ids/${qIdx}`,
          message: `Methodology interpretation "${interp.interpretation_id}" references invalid question_id "${qId}".`
        });
      }
    });
    interp.cognitive_rule_refs.forEach((rule, rIdx) => {
      if (allowedCognitiveRules.size > 0 && !allowedCognitiveRules.has(rule)) {
        findings.push({
          code: 'INVENTED_COGNITIVE_RULE_REF',
          severity: 'ERROR',
          tier,
          path: `/methodology_interpretations/${idx}/cognitive_rule_refs/${rIdx}`,
          message: `Methodology interpretation "${interp.interpretation_id}" references unknown cognitive rule "${rule}".`
        });
      }
    });
  });

  // 4. Source handles, locators, source-version bindings, and unresolved support (D-02, S-02).
  const eligiblePassagesById = new Map(
    sourceBundle.model_ready_packet.eligible_passages.map((p) => [p.source_unit_id, p])
  );
  const allUnitsById = new Map(sourceBundle.source_units.map((u) => [u.source_unit_id, u]));
  const objectSupport = sourceBundle.criterion_support.find((c) => c.object_id === doc.object_id);
  const usableForObject = new Set(
    objectSupport?.usable_source_unit_ids ?? [...eligiblePassagesById.keys()]
  );

  const requiredBibliographyUnitIds = new Set<string>();

  doc.sections.forEach((sec, idx) => {
    sec.source_unit_refs.forEach((unitId, uIdx) => {
      if (!eligiblePassagesById.has(unitId) || !usableForObject.has(unitId)) {
        findings.push({
          code: 'INVENTED_OR_INELIGIBLE_SOURCE_HANDLE',
          severity: 'ERROR',
          tier,
          path: `/sections/${idx}/source_unit_refs/${uIdx}`,
          message: `Section "${sec.section_id}" cites source_unit_id "${unitId}" which is absent from usable model_ready_packet passages.`
        });
      } else {
        requiredBibliographyUnitIds.add(unitId);
      }
    });
  });

  const hasMissingSupportUnresolvedRecord = doc.unresolved_items.some(
    (u) => u.category === 'MISSING_SOURCE_SUPPORT' || u.category === 'UNRESOLVED_REFERENCE_HANDLE'
  );

  doc.sourced_claims.forEach((claim, idx) => {
    if (!allSectionIds.has(claim.section_id)) {
      findings.push({
        code: 'UNKNOWN_SECTION_ID_REFERENCE',
        severity: 'ERROR',
        tier,
        path: `/sourced_claims/${idx}/section_id`,
        message: `Claim "${claim.claim_id}" references unknown section_id "${claim.section_id}".`
      });
    }

    claim.cited_source_assertions.forEach((assertion, aIdx) => {
      const unit = allUnitsById.get(assertion.source_unit_id);
      if (!unit || !eligiblePassagesById.has(assertion.source_unit_id) || !usableForObject.has(assertion.source_unit_id)) {
        findings.push({
          code: 'INVENTED_OR_INELIGIBLE_SOURCE_HANDLE',
          severity: 'ERROR',
          tier,
          path: `/sourced_claims/${idx}/cited_source_assertions/${aIdx}/source_unit_id`,
          message: `Claim "${claim.claim_id}" cites non-existent or ineligible source_unit_id "${assertion.source_unit_id}".`
        });
        return;
      }
      if (assertion.asserted_source_id && assertion.asserted_source_id !== unit.source_id) {
        findings.push({
          code: 'SOURCE_ID_BINDING_MISMATCH',
          severity: 'ERROR',
          tier,
          path: `/sourced_claims/${idx}/cited_source_assertions/${aIdx}/asserted_source_id`,
          message: `Claim "${claim.claim_id}" asserts source_id "${assertion.asserted_source_id}" for unit bound to "${unit.source_id}".`
        });
      }
      if (assertion.asserted_source_version && assertion.asserted_source_version !== unit.source_version) {
        findings.push({
          code: 'SOURCE_VERSION_BINDING_MISMATCH',
          severity: 'ERROR',
          tier,
          path: `/sourced_claims/${idx}/cited_source_assertions/${aIdx}/asserted_source_version`,
          message: `Claim "${claim.claim_id}" asserts source version "${assertion.asserted_source_version}", expected pinned "${unit.source_version}".`
        });
      }
      if (assertion.asserted_locator && assertion.asserted_locator !== unit.locator.label) {
        findings.push({
          code: 'INVENTED_SOURCE_LOCATOR_REJECTED',
          severity: 'ERROR',
          tier,
          path: `/sourced_claims/${idx}/cited_source_assertions/${aIdx}/asserted_locator`,
          message: `Claim "${claim.claim_id}" asserts locator "${assertion.asserted_locator}", expected "${unit.locator.label}".`
        });
      }
    });

    if (claim.support_state === 'SOURCE_SUPPORTED') {
      if (claim.source_unit_ids.length === 0) {
        findings.push({
          code: 'FABRICATED_SOURCE_SUPPORT',
          severity: 'ERROR',
          tier,
          path: `/sourced_claims/${idx}/source_unit_ids`,
          message: `Claim "${claim.claim_id}" is marked SOURCE_SUPPORTED without any source_unit_ids.`
        });
      }
      if (claim.authority_distinction === 'UNRESOLVED_SOURCE_BASIS') {
        findings.push({
          code: 'INVALID_CLAIM_AUTHORITY_DISTINCTION',
          severity: 'ERROR',
          tier,
          path: `/sourced_claims/${idx}/authority_distinction`,
          message: `SOURCE_SUPPORTED claim "${claim.claim_id}" must distinguish legislation vs standard/guidance.`
        });
      }
      for (const unitId of claim.source_unit_ids) {
        if (!eligiblePassagesById.has(unitId) || !usableForObject.has(unitId)) {
          findings.push({
            code: 'FABRICATED_SOURCE_SUPPORT',
            severity: 'ERROR',
            tier,
            path: `/sourced_claims/${idx}/source_unit_ids`,
            message: `Claim "${claim.claim_id}" claims SOURCE_SUPPORTED using unavailable/ineligible unit "${unitId}".`
          });
        } else {
          requiredBibliographyUnitIds.add(unitId);
        }
      }
    } else {
      // UNRESOLVED claim (S-02).
      if (!hasMissingSupportUnresolvedRecord) {
        findings.push({
          code: 'UNTRACKED_UNRESOLVED_CLAIM',
          severity: 'ERROR',
          tier,
          path: `/sourced_claims/${idx}`,
          message: `UNRESOLVED claim "${claim.claim_id}" has no corresponding entry in unresolved_items.`
        });
      }
      findings.push({
        code: 'UNRESOLVED_SOURCE_SUPPORT',
        severity: tier === 'RELEASE' ? 'ERROR' : 'WARNING',
        tier: 'RELEASE',
        path: `/sourced_claims/${idx}`,
        message: `Claim "${claim.claim_id}" remains UNRESOLVED pending usable registered source passage support (${claim.unresolved_reason ?? 'no usable passage'}).`
      });
    }
  });

  if (
    objectSupport?.support_status === 'MISSING_USABLE_PASSAGES' &&
    doc.sourced_claims.length === 0 &&
    !hasMissingSupportUnresolvedRecord
  ) {
    findings.push({
      code: 'MISSING_SOURCE_SUPPORT_UNRECORDED',
      severity: 'ERROR',
      tier,
      path: '/unresolved_items',
      message: `Object "${doc.object_id}" has MISSING_USABLE_PASSAGES but does not record the source-support gap in unresolved_items.`
    });
  }

  const bibByUnitId = new Map<string, CreatorDocument['bibliography'][number]>();
  doc.bibliography.forEach((entry, idx) => {
    const unit = allUnitsById.get(entry.source_unit_id);
    if (!unit || !eligiblePassagesById.has(entry.source_unit_id)) {
      findings.push({
        code: 'INELIGIBLE_BIBLIOGRAPHY_SOURCE',
        severity: 'ERROR',
        tier,
        path: `/bibliography/${idx}/source_unit_id`,
        message: `Bibliography entry "${entry.source_unit_id}" does not resolve to an eligible passage in model_ready_packet.`
      });
      return;
    }
    if (entry.source_id !== unit.source_id) {
      findings.push({
        code: 'SOURCE_ID_BINDING_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `/bibliography/${idx}/source_id`,
        message: `Bibliography source_id "${entry.source_id}" disagrees with unit source_id "${unit.source_id}".`
      });
    }
    if (entry.edition_version !== unit.source_version) {
      findings.push({
        code: 'SOURCE_VERSION_BINDING_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `/bibliography/${idx}/edition_version`,
        message: `Bibliography edition_version "${entry.edition_version}" disagrees with pinned source_version "${unit.source_version}".`
      });
    }
    if (entry.locator_label !== unit.locator.label) {
      findings.push({
        code: 'INVENTED_SOURCE_LOCATOR_REJECTED',
        severity: 'ERROR',
        tier,
        path: `/bibliography/${idx}/locator_label`,
        message: `Bibliography locator "${entry.locator_label}" disagrees with extracted unit locator "${unit.locator.label}".`
      });
    }
    bibByUnitId.set(entry.source_unit_id, entry);
  });

  for (const unitId of requiredBibliographyUnitIds) {
    if (!bibByUnitId.has(unitId)) {
      findings.push({
        code: 'MISSING_BIBLIOGRAPHY_ENTRY',
        severity: 'ERROR',
        tier,
        path: '/bibliography',
        message: `Referenced source_unit_id "${unitId}" is missing from document bibliography.`
      });
    }
  }

  // 5. Related object links (D-02, D-03).
  const validObjectIds = new Set<string>();
  const objectTypeById = new Map<string, 'capability' | 'antipattern'>();
  const questionIdsByObject = new Map<string, Set<string>>();
  for (const pair of runtime.pairs) {
    validObjectIds.add(pair.capability.id);
    validObjectIds.add(pair.antipattern.id);
    objectTypeById.set(pair.capability.id, 'capability');
    objectTypeById.set(pair.antipattern.id, 'antipattern');
    questionIdsByObject.set(pair.capability.id, new Set(pair.capability.questions.map((q) => q.id)));
    questionIdsByObject.set(pair.antipattern.id, new Set(pair.antipattern.questions.map((q) => q.id)));
  }

  const expectedPairRelKind =
    doc.object_type === 'capability' ? 'PAIRED_ANTIPATTERN' : 'PAIRED_CAPABILITY';
  let hasPairedLink = false;

  doc.related_object_links.forEach((link, idx) => {
    if (!validObjectIds.has(link.target_object_id) || link.target_object_id === doc.object_id) {
      findings.push({
        code: 'INVENTED_RELATED_OBJECT_ID',
        severity: 'ERROR',
        tier,
        path: `/related_object_links/${idx}/target_object_id`,
        message: `Document "${doc.object_id}" links to invalid or self related object "${link.target_object_id}".`
      });
      return;
    }
    if (
      link.target_object_id === doc.paired_object_id &&
      link.relationship_kind === expectedPairRelKind
    ) {
      hasPairedLink = true;
    }
  });

  if (!hasPairedLink) {
    findings.push({
      code: 'MISSING_PAIRED_OBJECT_LINK',
      severity: 'ERROR',
      tier,
      path: '/related_object_links',
      message: `Document "${doc.object_id}" must link to paired object "${doc.paired_object_id}" (${expectedPairRelKind}).`
    });
  }

  // 6. Independent unknown handling, tested absence, and prohibited-inference guards (D-03, D-04).
  const ab = doc.assessment_boundaries;
  if (ab.unknown_handling.length === 0) {
    findings.push({
      code: 'MISSING_UNKNOWN_HANDLING_RULES',
      severity: 'ERROR',
      tier,
      path: '/assessment_boundaries/unknown_handling',
      message: `Document "${doc.object_id}" must declare explicit unknown_handling rules.`
    });
  }
  if (ab.prohibited_inferences.length === 0 || ab.false_positive_guards.length === 0) {
    findings.push({
      code: 'MISSING_INFERENCE_GUARDS',
      severity: 'ERROR',
      tier,
      path: '/assessment_boundaries/prohibited_inferences',
      message: `Document "${doc.object_id}" must declare explicit false_positive_guards and prohibited_inferences.`
    });
  }
  if (ab.human_decision_boundaries.length === 0) {
    findings.push({
      code: 'MISSING_HUMAN_DECISION_BOUNDARIES',
      severity: 'ERROR',
      tier,
      path: '/assessment_boundaries/human_decision_boundaries',
      message: `Document "${doc.object_id}" must declare explicit human_decision_boundaries.`
    });
  }

  if (doc.object_type === 'antipattern') {
    if (!ab.failure_mechanism || ab.failure_mechanism.trim().length === 0) {
      findings.push({
        code: 'MISSING_FAILURE_MECHANISM',
        severity: 'ERROR',
        tier,
        path: '/assessment_boundaries/failure_mechanism',
        message: `Anti-pattern "${doc.object_id}" must define a non-empty failure_mechanism.`
      });
    }
    if (ab.observable_indicators.length === 0) {
      findings.push({
        code: 'MISSING_OBSERVABLE_INDICATORS',
        severity: 'ERROR',
        tier,
        path: '/assessment_boundaries/observable_indicators',
        message: `Anti-pattern "${doc.object_id}" must include observable_indicators.`
      });
    }
    if (ab.tested_absence_requirements.length === 0) {
      findings.push({
        code: 'MISSING_TESTED_ABSENCE_REQUIREMENTS',
        severity: 'ERROR',
        tier,
        path: '/assessment_boundaries/tested_absence_requirements',
        message: `Anti-pattern "${doc.object_id}" must specify tested_absence_requirements.`
      });
    }
    const mentionsUnknown = ab.unknown_handling.some((rule) => /\bunknown\b/i.test(rule));
    if (!mentionsUnknown) {
      findings.push({
        code: 'MISSING_INDEPENDENT_AP_UNKNOWN_HANDLING',
        severity: 'ERROR',
        tier,
        path: '/assessment_boundaries/unknown_handling',
        message: `Anti-pattern "${doc.object_id}" unknown_handling must preserve independent UNKNOWN state when anti-pattern evidence is missing.`
      });
    }
  }

  const authoredSegments = collectDocumentAuthoredTexts(doc);
  for (const seg of authoredSegments) {
    if (hasAffirmativeInversePairInference(seg.text)) {
      findings.push({
        code: 'PROHIBITED_INVERSE_PAIR_INFERENCE',
        severity: 'ERROR',
        tier,
        path: seg.path,
        message: `Prohibited inverse pair inference in "${doc.object_id}" (${seg.path}): capability gaps do not establish anti-pattern presence and anti-pattern absence does not establish capability satisfaction.`
      });
    }
    if (hasAffirmativeSilenceAsAbsenceClaim(seg.text)) {
      findings.push({
        code: 'PROHIBITED_SILENCE_AS_ABSENCE_INFERENCE',
        severity: 'ERROR',
        tier,
        path: seg.path,
        message: `Prohibited inference in "${doc.object_id}" (${seg.path}): silence, missing incidents, or absence of complaints is never proof of anti-pattern absence.`
      });
    }
    if (hasAffirmativeTacticActivationClaim(seg.text)) {
      findings.push({
        code: 'PROHIBITED_TACTIC_ACTIVATION_CLAIM',
        severity: 'ERROR',
        tier,
        path: seg.path,
        message: `Prohibited tactic activation/finding-closure claim in "${doc.object_id}" (${seg.path}): Creator tactic associations never activate remediation or close findings.`
      });
    }
  }

  // 7. Golden Reference domain-wording contamination guard (D-06).
  const goldenSignatures = extractGoldenContaminationSignatures(runtime);
  if (goldenSignatures.goldenPairId && doc.pair_id !== goldenSignatures.goldenPairId) {
    for (const seg of authoredSegments) {
      for (const snippet of goldenSignatures.verbatimSnippets) {
        if (seg.text.includes(snippet)) {
          findings.push({
            code: 'GOLDEN_CONTAMINATION_DETECTED',
            severity: 'ERROR',
            tier,
            path: seg.path,
            message: `Non-Golden document "${doc.object_id}" copied verbatim domain-specific wording from Golden Reference pair "${goldenSignatures.goldenPairId}".`
          });
          break;
        }
      }
      for (const handleRe of goldenSignatures.internalHandlePatterns) {
        if (handleRe.test(seg.text)) {
          findings.push({
            code: 'GOLDEN_CONTAMINATION_DETECTED',
            severity: 'ERROR',
            tier,
            path: seg.path,
            message: `Non-Golden document "${doc.object_id}" contains Golden-specific internal handle matching ${String(handleRe)}.`
          });
          break;
        }
      }
    }
  }

  // 8. Tactic associations: honor version-bound SAE playbook decision (T-01) & catch broken/incompatible links (T-02).
  const tacticById = new Map(runtime.tactics.map((t) => [t.tactic_id, t]));
  const seenDocTactics = new Set<string>();

  doc.tactic_associations.forEach((assoc, idx) => {
    if (seenDocTactics.has(assoc.tactic_id)) {
      findings.push({
        code: 'TACTIC_LINK_AMBIGUOUS',
        severity: 'ERROR',
        tier,
        path: `/tactic_associations/${idx}/tactic_id`,
        message: `Duplicate/ambiguous tactic association "${assoc.tactic_id}" on "${doc.object_id}".`
      });
      return;
    }
    seenDocTactics.add(assoc.tactic_id);

    const pbTac = tacticById.get(assoc.tactic_id);
    if (!pbTac) {
      findings.push({
        code: 'INVENTED_TACTIC_ID',
        severity: 'ERROR',
        tier,
        path: `/tactic_associations/${idx}/tactic_id`,
        message: `Document "${doc.object_id}" references unknown tactic_id "${assoc.tactic_id}".`
      });
      return;
    }

    if (!pbTac.linked_object_ids.includes(doc.object_id)) {
      findings.push({
        code: 'INCOMPATIBLE_TACTIC_TARGET_LINK',
        severity: 'ERROR',
        tier,
        path: `/tactic_associations/${idx}/tactic_id`,
        message: `Tactic "${assoc.tactic_id}" links to [${pbTac.linked_object_ids.join(', ')}] in playbook, which is incompatible with "${doc.object_id}".`
      });
    }

    if (new Set(pbTac.linked_object_ids).size !== pbTac.linked_object_ids.length) {
      findings.push({
        code: 'TACTIC_LINK_AMBIGUOUS',
        severity: 'ERROR',
        tier,
        path: `/tactic_associations/${idx}/tactic_id`,
        message: `Playbook tactic "${assoc.tactic_id}" contains duplicate/ambiguous linked_object_ids.`
      });
    }

    for (const targetObj of [...pbTac.linked_object_ids, ...pbTac.reassessment_targets]) {
      if (!validObjectIds.has(targetObj) || !objectTypeById.has(targetObj)) {
        findings.push({
          code: 'TACTIC_LINK_MISSING_TARGET',
          severity: 'ERROR',
          tier,
          path: `/tactic_associations/${idx}/tactic_id`,
          message: `Playbook tactic "${assoc.tactic_id}" references nonexistent target object "${targetObj}".`
        });
      }
    }

    for (const qId of pbTac.linked_question_ids) {
      const belongsToLinkedObject = pbTac.linked_object_ids.some((objId) =>
        questionIdsByObject.get(objId)?.has(qId)
      );
      if (!belongsToLinkedObject) {
        findings.push({
          code: 'TACTIC_LINK_INCOMPATIBLE_QUESTION',
          severity: 'ERROR',
          tier,
          path: `/tactic_associations/${idx}/tactic_id`,
          message: `Playbook tactic "${assoc.tactic_id}" links question "${qId}" incompatible with its linked objects.`
        });
      }
    }

    if (
      assoc.effective_association_status !== pbTac.effective_association_status ||
      assoc.original_activation_status !== pbTac.original_activation_status
    ) {
      findings.push({
        code: 'TACTIC_STATUS_PROVENANCE_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `/tactic_associations/${idx}`,
        message: `Tactic "${assoc.tactic_id}" status provenance disagrees with resolved playbook state.`
      });
    }

    // T-01: PENDING_KB_FINDING_MAPPING does NOT block when effective_association_status === OBJECT_LINK_ASSOCIATED!
    if (pbTac.effective_association_status === 'UNCONFIRMED_CANDIDATE') {
      findings.push({
        code: 'UNCONFIRMED_TACTIC_ASSOCIATION',
        severity: tier === 'RELEASE' ? 'ERROR' : 'WARNING',
        tier: 'RELEASE',
        path: `/tactic_associations/${idx}`,
        message: `Tactic "${assoc.tactic_id}" lacks approved release status or version-bound owner decision.`
      });
    }
  });

  for (const plannedAssoc of plannedDocument.tactic_associations) {
    if (
      plannedAssoc.effective_association_status === 'OBJECT_LINK_ASSOCIATED' &&
      !seenDocTactics.has(plannedAssoc.tactic_id)
    ) {
      findings.push({
        code: 'MISSING_DECLARED_TACTIC_ASSOCIATION',
        severity: 'ERROR',
        tier,
        path: '/tactic_associations',
        message: `Document "${doc.object_id}" omitted explicit playbook tactic association "${plannedAssoc.tactic_id}".`
      });
    }
  }

  // 9. Cross-input blocking conflicts on this object.
  for (const conflictId of plannedDocument.blocking_conflict_ids) {
    findings.push({
      code: 'BLOCKING_INPUT_CONFLICT',
      severity: tier === 'RELEASE' ? 'ERROR' : 'WARNING',
      tier: 'RELEASE',
      path: '/unresolved_items',
      message: `Object "${doc.object_id}" has unresolved input conflict "${conflictId}" blocking final delivery.`
    });
  }

  const hasErrors = findings.some((f) => f.severity === 'ERROR');
  const hasReleaseBlockers =
    hasErrors ||
    findings.some((f) => f.tier === 'RELEASE') ||
    doc.unresolved_items.some((u) => u.blocks_delivery);

  return {
    document_id: doc.document_id,
    object_id: doc.object_id,
    object_type: doc.object_type,
    tier,
    draft_valid: !hasErrors,
    delivery_ready: !hasReleaseBlockers,
    findings
  };
}

export function validateAuthoredPair(options: {
  workUnitId: string;
  pairId: string;
  capability: CreatorDocument;
  antipattern: CreatorDocument;
  generatedTacticDocuments?: ReadonlyArray<unknown>;
  runtime: ResolvedProfileRuntime;
  plan: DocumentPlan;
  sourceBundle: SourcePreparationBundle;
  tier?: StrictnessTier;
}): PairValidationResult {
  const tier = options.tier ?? 'DRAFT';
  const { capability, antipattern, runtime, plan, sourceBundle } = options;
  const pairFindings: CreatorFinding[] = [];

  const plannedCap = plan.documents.find(
    (d) => d.object_id === capability.object_id && d.object_type === 'capability'
  );
  const plannedAp = plan.documents.find(
    (d) => d.object_id === antipattern.object_id && d.object_type === 'antipattern'
  );

  if (!plannedCap || !plannedAp) {
    throw new Error(
      `Planned capability/antipattern records not found in DocumentPlan for pair "${options.pairId}".`
    );
  }

  if (
    capability.document_id === antipattern.document_id ||
    capability.destination_path_template === antipattern.destination_path_template
  ) {
    pairFindings.push({
      code: 'PAIR_DOCUMENTS_NOT_INDEPENDENT',
      severity: 'ERROR',
      tier,
      path: '/pair',
      message: 'Capability and anti-pattern documents must have distinct document_ids and destination paths.'
    });
  }

  // T-03: Zero unsolicited tactic document generation when tactics were not requested in plan.
  const tacticsRequestedInPlan =
    plan.selection.include_tactics || plan.selection.tactic_ids.length > 0;
  if (!tacticsRequestedInPlan) {
    const plannedTacticCount = plan.documents.filter((d) => d.object_type === 'tactic').length;
    const generatedTacticCount = options.generatedTacticDocuments?.length ?? 0;
    if (plannedTacticCount > 0 || generatedTacticCount > 0) {
      pairFindings.push({
        code: 'UNSOLICITED_TACTIC_DOCUMENT_GENERATED',
        severity: 'ERROR',
        tier,
        path: '/tactic_documents',
        message: 'Unsolicited tactic document generation is prohibited when tactics are not requested in the output plan.'
      });
    }
  }

  const capResult = validateCreatorDocumentAgainstContext({
    document: capability,
    plannedDocument: plannedCap,
    runtime,
    plan,
    sourceBundle,
    tier
  });

  const apResult = validateCreatorDocumentAgainstContext({
    document: antipattern,
    plannedDocument: plannedAp,
    runtime,
    plan,
    sourceBundle,
    tier
  });

  const hasPairErrors = pairFindings.some((f) => f.severity === 'ERROR');

  return {
    work_unit_id: options.workUnitId,
    pair_id: options.pairId,
    tier,
    draft_valid: capResult.draft_valid && apResult.draft_valid && !hasPairErrors,
    delivery_ready: capResult.delivery_ready && apResult.delivery_ready && !hasPairErrors,
    capability: capResult,
    antipattern: apResult,
    pair_findings: pairFindings
  };
}
