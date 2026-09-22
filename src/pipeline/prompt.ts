const SYSTEM_BOUNDARY = `You are executing one bounded cognitive task inside the AI Governance Knowledge Authoring pipeline.

The application, not the conversation, owns pipeline state. Treat every LOCKED INPUT as immutable. Perform only the stated OBJECTIVE. Do not broaden the task, repair unrelated content, invent missing upstream decisions, or make approval/legal/lifecycle decisions that are outside the task contract.

AUTHORITY HIERARCHY:
- Normative requirements come from the active Production Contract, active schemas, category/taxonomy baseline, sealed Source Register and approved Tactic Catalog when supplied.
- A1/AP-A1 Golden material is a non-normative reference exemplar only. It may calibrate semantic depth, traceability, evidence discipline, human/machine boundaries and publication completeness.
- Never infer a mandatory rule merely because the Golden reference contains a particular count, wording, source, tactic, severity, assurance value or category-specific structure. If the normative baseline and the Golden reference differ, follow the normative baseline.

Return only JSON that matches OUTPUT SHAPE exactly. Use only the keys shown there. Do not emit pairId, pair_id, capabilityId, capability_id, antipatternId, antipattern_id, domain, schemaVersion, releaseStatus, criterionId, or any other canonical identity field. Adjacent criteria may be referenced only by criterionHandle values supplied in locked inputs.`;

const OUTPUT_SHAPES: Record<string, unknown> = {
  PAIR_BOUNDARY: {
    capability: {
      canonicalDefinition: 'string, min 10 characters, semantic definition only',
      governancePurpose: 'string, min 10 characters',
      distinctClaim: 'string, min 10 characters, what this capability uniquely owns versus adjacent handles',
      ownedTopics: ['string'],
      excludedTopics: [{ criterionHandle: 'criterion_001', ownershipBoundary: 'string, min 10 characters' }]
    },
    antipattern: {
      canonicalDefinition: 'string, min 10 characters',
      pairedRelationship: 'string, min 10 characters'
    },
    boundaryRationale: 'string, min 10 characters'
  },
  AP_FAILURE_MODEL: {
    failureMechanism: 'string, min 10 characters, semantic failure mechanism only',
    triggeringConditions: ['string'],
    observableFailureSurfaces: ['string'],
    nonExamples: ['string'],
    distinctionFromCapabilityGap: 'string, min 10 characters, how this failure differs from a mere capability gap'
  },
  APPLICABILITY: {
    capability: {
      statement: 'string, min 10 characters',
      conditions: ['string'],
      exclusions: ['string'],
      reassessmentTriggers: ['string']
    },
    antipattern: {
      statement: 'string, min 10 characters',
      conditions: ['string'],
      exclusions: ['string'],
      reassessmentTriggers: ['string']
    },
    consistencyNotes: ['string']
  },
  PRIMARY_QUESTIONS: {
    capabilityQuestions: [
      { slot: 1, question: 'string, min 10 characters, slot 1 wording only' },
      { slot: 2, question: 'string, min 10 characters, slot 2 wording only' },
      { slot: 3, question: 'string, min 10 characters, slot 3 wording only' }
    ],
    antipatternQuestions: [
      { slot: 1, question: 'string, min 10 characters, slot 1 wording only' },
      { slot: 2, question: 'string, min 10 characters, slot 2 wording only' },
      { slot: 3, question: 'string, min 10 characters, slot 3 wording only' }
    ],
    coverageRationale: 'string, min 10 characters'
  },
  ATOMIC_DECOMPOSITION: {
    capabilitySubcriteria: [
      { questionSlot: 1, criterion: 'string, min 10 characters', evidenceNeed: 'string, min 10 characters' },
      { questionSlot: 2, criterion: 'string, min 10 characters', evidenceNeed: 'string, min 10 characters' },
      { questionSlot: 3, criterion: 'string, min 10 characters', evidenceNeed: 'string, min 10 characters' }
    ],
    antipatternTests: [
      { questionSlot: 1, test: 'string, min 10 characters', evidenceNeed: 'string, min 10 characters' },
      { questionSlot: 2, test: 'string, min 10 characters', evidenceNeed: 'string, min 10 characters' },
      { questionSlot: 3, test: 'string, min 10 characters', evidenceNeed: 'string, min 10 characters' }
    ],
    coverageNotes: ['string']
  },
  EVIDENCE_ARCHITECTURE: {
    capabilityEvidence: [
      {
        title: 'string, min 3 characters',
        claimSupported: 'string, min 10 characters',
        evidenceClass: 'string from locked evidence class vocabulary',
        minimumTechnicalAssurance: 'string from locked technical assurance vocabulary',
        requiredHumanAssurance: 'string from locked human assurance vocabulary',
        acceptanceConditions: ['string'],
        limitations: ['string'],
        supportsAtomicHandles: ['atomic_001']
      }
    ],
    antipatternEvidence: [
      {
        title: 'string, min 3 characters',
        claimSupported: 'string, min 10 characters',
        evidenceClass: 'string from locked evidence class vocabulary',
        minimumTechnicalAssurance: 'string from locked technical assurance vocabulary',
        requiredHumanAssurance: 'string from locked human assurance vocabulary',
        acceptanceConditions: ['string'],
        limitations: ['string'],
        supportsAtomicHandles: ['atomic_001']
      }
    ],
    sufficiencyNotes: ['string']
  },
  EVIDENCE_SAFETY: {
    capabilityRules: {
      evidenceCeilings: ['string'],
      falsePositiveGuards: ['string'],
      prohibitedInferences: ['string'],
      contradictionHandling: ['string'],
      freshnessRules: ['string']
    },
    antipatternRules: {
      evidenceCeilings: ['string'],
      falsePositiveGuards: ['string'],
      prohibitedInferences: ['string'],
      contradictionHandling: ['string'],
      freshnessRules: ['string']
    },
    crossPairSafetyNotes: ['string']
  },
  AP_ABSENCE_CONTRACT: {
    requiredArtifacts: ['string'],
    interpretationBoundary: 'string, min 10 characters'
  },
  SOURCE_MAPPING: {
    capabilityMappings: [
      {
        sourceHandle: 'source_001 from locked inputs',
        locatorHandle: 'locator_001 from locked inputs',
        relationship: 'string',
        supportedClaim: 'string, min 10 characters',
        categoryRationale: 'string, min 10 characters',
        applicabilityConditions: ['string'],
        exclusions: ['string']
      }
    ],
    antipatternMappings: [
      {
        sourceHandle: 'source_001 from locked inputs',
        locatorHandle: 'locator_001 from locked inputs',
        relationship: 'string',
        supportedClaim: 'string, min 10 characters',
        categoryRationale: 'string, min 10 characters',
        applicabilityConditions: ['string'],
        exclusions: ['string']
      }
    ],
    unmappedClaims: [
      {
        objectKind: 'CAPABILITY or ANTIPATTERN',
        claim: 'string, min 10 characters',
        reason:
          'INSUFFICIENT_SOURCE_CONTEXT | NO_ALLOWED_SOURCE_SUPPORT | APPLICABILITY_AMBIGUOUS | RIGHTS_RESTRICTED_SOURCE_CONTEXT',
        consideredSourceHandles: ['source_001']
      }
    ],
    mappingNotes: ['string']
  },
  FINDING_ARCHITECTURE: {
    capabilityFindings: [
      {
        title: 'string, min 10 characters',
        eligibleConclusionStates: ['SATISFIED', 'PARTIALLY_SATISFIED', 'NOT_SATISFIED', 'UNKNOWN', 'NOT_APPLICABLE'],
        atomicHandles: ['atomic_001'],
        evidenceHandles: ['evidence_001'],
        defaultSeverity: 'LOW | MEDIUM | HIGH | BLOCKING',
        lifecycleConsequence: 'string, min 10 characters',
        humanLockRequired: true
      }
    ],
    antipatternFindings: [
      {
        title: 'string, min 10 characters',
        eligibleConclusionStates: ['CONFIRMED_PRESENT', 'PARTIALLY_PRESENT', 'TESTED_ABSENT', 'UNKNOWN', 'NOT_APPLICABLE'],
        atomicHandles: ['atomic_001'],
        evidenceHandles: ['evidence_001'],
        defaultSeverity: 'LOW | MEDIUM | HIGH | BLOCKING',
        lifecycleConsequence: 'string, min 10 characters',
        humanLockRequired: true
      }
    ],
    findingLogicNotes: ['string']
  },
  CONTROL_BOUNDARY: {
    capabilityHardGate: {
      effect: 'NONE | WARN | BLOCK | CONSTRAIN',
      conditions: ['string, min 3 characters'],
      overrideAuthority: 'string or null'
    },
    antipatternHardGate: {
      effect: 'NONE | WARN | BLOCK | CONSTRAIN',
      conditions: ['string, min 3 characters'],
      overrideAuthority: 'string or null'
    },
    capabilityRuntimeBoundary: {
      machineMay: ['string, min 3 characters'],
      machineMustNot: ['string, min 3 characters'],
      humanAuthorityRequiredFor: ['string, min 3 characters']
    },
    antipatternRuntimeBoundary: {
      machineMay: ['string, min 3 characters'],
      machineMustNot: ['string, min 3 characters'],
      humanAuthorityRequiredFor: ['string, min 3 characters']
    },
    controlNotes: ['string']
  },
  LIFECYCLE_ASSURANCE: {
    capabilityTargets: [
      {
        minimumTechnicalAssurance: 'UNKNOWN | DECLARED | IMPLEMENTED | TESTED | OPERATIONALLY_OBSERVED',
        requiredHumanAssurance: 'PENDING | HUMAN_VALIDATED | FORMALLY_APPROVED'
      }
    ],
    antipatternTargets: [
      {
        minimumTechnicalAssurance: 'UNKNOWN | DECLARED | IMPLEMENTED | TESTED | OPERATIONALLY_OBSERVED',
        requiredHumanAssurance: 'PENDING | HUMAN_VALIDATED | FORMALLY_APPROVED'
      }
    ],
    rationaleNotes: ['string']
  },
  REFERENCE_MAPPING: {
    capabilityRelatedCriterionHandles: ['criterion_001 from locked adjacent criteria'],
    antipatternRelatedCriterionHandles: ['criterion_001 from locked adjacent criteria'],
    referenceNotes: ['string']
  },
  PAIR_COHERENCE_REVIEW: {
    defects: [
      {
        severity: 'LOW | MEDIUM | HIGH | BLOCKING',
        coherenceDimension:
          'SEMANTIC_BOUNDARY | CAPABILITY_ANTIPATTERN_RELATIONSHIP | APPLICABILITY | QUESTION_ATOMIC_ALIGNMENT | EVIDENCE_INTERPRETATION | SOURCE_INTERPRETATION | FINDING_LOGIC | CONTROL_AUTHORITY | LIFECYCLE_ASSURANCE | REFERENCE_OWNERSHIP | CROSS_ARTIFACT_CONTRADICTION',
        affectedPathHandles: ['path_001 from locked pair coherence packet'],
        issue: 'string, min 10 characters',
        coherenceExpectation: 'string, min 10 characters',
        recommendedRepairPathHandles: ['path_001 from locked pair coherence packet']
      }
    ],
    coherenceSummary: 'string, min 10 characters. An empty defects array is a valid pass-shaped completion.'
  }
};

export interface PromptContract {
  contractVersion: string;
  taskType: string;
  objective: string;
  lockedInputs: Record<string, unknown>;
  allowedReferences: string[];
  doNot: string[];
  outputContract: {
    format: 'JSON';
    schemaName: string;
    requiredFields: string[];
    additionalProperties: false;
  };
  validationProfile: string[];
  failureMode: 'FAIL_CLOSED';
}

function stripIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIdentity);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (
      key === 'pair_identity' ||
      key === 'pairId' ||
      key === 'pair_id' ||
      key === 'capabilityId' ||
      key === 'capability_id' ||
      key === 'antipatternId' ||
      key === 'antipattern_id' ||
      key === 'criterionId'
    ) {
      continue;
    }
    next[key] = stripIdentity(child);
  }
  return next;
}

function modelFacingLockedInputs(lockedInputs: Record<string, unknown>): Record<string, unknown> {
  const stripped = stripIdentity(lockedInputs) as Record<string, unknown>;
  if (Array.isArray(lockedInputs.adjacent_criteria)) {
    stripped.adjacent_criteria = lockedInputs.adjacent_criteria.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        criterionHandle: row.criterionHandle,
        boundarySummary: row.boundarySummary
      };
    });
  }
  return stripped;
}

export function renderTaskPrompt(contract: PromptContract): string {
  const userPayload = {
    contract_version: contract.contractVersion,
    task_type: contract.taskType,
    objective: contract.objective,
    locked_inputs: modelFacingLockedInputs(contract.lockedInputs),
    allowed_references: contract.allowedReferences,
    do_not: contract.doNot,
    output_contract: contract.outputContract,
    output_shape: OUTPUT_SHAPES[contract.taskType],
    validation_profile: contract.validationProfile,
    failure_mode: contract.failureMode
  };
  return `${SYSTEM_BOUNDARY}\n\n${JSON.stringify(userPayload, null, 2)}`;
}

export function joinTaskPrompts(prompts: readonly string[]): string {
  return prompts.join('\n\n');
}

export interface PipelinePlan {
  planId: string;
  planSha256: string;
  identity: {
    pairId: string;
    capabilityId: string;
    antipatternId: string;
    domain: string;
  };
  adjacentCriteria: ReadonlyArray<Record<string, unknown>>;
  fixedQuestionSlots: ReadonlyArray<Record<string, unknown>>;
  vocabulary: {
    technicalAssurance: readonly string[];
    humanAssurance: readonly string[];
    capabilityConclusionStates: readonly string[];
    antipatternConclusionStates: readonly string[];
    hardGateEffects: readonly string[];
    lifecycleStages: readonly string[];
  };
  baseline: {
    tacticCatalogVersion: string | null;
    tacticCatalogSha256: string | null;
    sourceRegisterVersion: string;
    sourceRegisterSha256: string;
  };
  tacticUniverse: readonly unknown[];
}

export function governedInputs(plan: PipelinePlan): Record<string, unknown> {
  return {
    authoring_plan_id: plan.planId,
    authoring_plan_sha256: plan.planSha256,
    pair_identity: {
      pair_id: plan.identity.pairId,
      capability_id: plan.identity.capabilityId,
      antipattern_id: plan.identity.antipatternId,
      domain: plan.identity.domain
    }
  };
}
