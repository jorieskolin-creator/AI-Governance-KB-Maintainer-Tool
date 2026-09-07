import type { ValidationFinding } from '../validation/contracts.js';

export interface GoldenPair {
  capability: Record<string, any>;
  antipattern: Record<string, any>;
}

export interface GoldenRegressionResult {
  passed: boolean;
  findings: ValidationFinding[];
}

function defect(checkId: string, objectId: string, objectPath: string, issue: string): ValidationFinding {
  return {
    checkId,
    kind: 'GOLDEN_STANDARD',
    severity: 'BLOCKING',
    objectId,
    objectPath,
    issue,
    dependencyScope: []
  };
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateGoldenPair(pair: GoldenPair): GoldenRegressionResult {
  const findings: ValidationFinding[] = [];
  const capabilityId = String(pair.capability.id ?? '');
  const antipatternId = String(pair.antipattern.id ?? '');

  if (antipatternId !== `AP-${capabilityId}`) {
    findings.push(defect('GOLDEN_PAIR_ID', capabilityId, 'id', 'Capability and anti-pattern IDs are not an exact pair.'));
  }

  const capabilityQuestions = pair.capability.primary_questions ?? [];
  const antipatternQuestions = pair.antipattern.primary_questions ?? [];
  if (capabilityQuestions.length !== 3 || antipatternQuestions.length !== 3) {
    findings.push(defect('GOLDEN_QUESTION_COUNT', capabilityId, 'primary_questions', 'Both objects must contain exactly three primary questions.'));
  }

  const capAtomic = pair.capability.atomic_subcriteria ?? [];
  const apAtomic = pair.antipattern.atomic_tests ?? [];
  const capAtomicIds = capAtomic.map((item: any) => String(item.id));
  const apAtomicIds = apAtomic.map((item: any) => String(item.id));
  if (!unique(capAtomicIds) || !unique(apAtomicIds)) {
    findings.push(defect('GOLDEN_ATOMIC_ID_UNIQUENESS', capabilityId, 'atomic', 'Atomic IDs must be unique.'));
  }

  const capEvidence = new Set((pair.capability.required_evidence ?? []).map((item: any) => String(item.id)));
  const apEvidence = new Set((pair.antipattern.required_evidence ?? []).map((item: any) => String(item.id)));
  for (const item of capAtomic) {
    for (const evidenceId of item.required_evidence_ids ?? []) {
      if (!capEvidence.has(String(evidenceId))) {
        findings.push(defect('GOLDEN_CAP_EVIDENCE_REF', capabilityId, `atomic_subcriteria.${item.id}`, `Unknown evidence ID ${evidenceId}.`));
      }
    }
  }
  for (const item of apAtomic) {
    for (const evidenceId of item.required_evidence_ids ?? []) {
      if (!apEvidence.has(String(evidenceId))) {
        findings.push(defect('GOLDEN_AP_EVIDENCE_REF', antipatternId, `atomic_tests.${item.id}`, `Unknown evidence ID ${evidenceId}.`));
      }
    }
  }

  const absence = pair.antipattern.absence_test_contract;
  const requiredAbsenceFlags = ['scope_defined', 'executed', 'successful', 'current', 'independently_verified'];
  if (!absence || requiredAbsenceFlags.some((flag) => absence[flag] !== true)) {
    findings.push(defect('GOLDEN_ABSENCE_CONTRACT', antipatternId, 'absence_test_contract', 'TESTED_ABSENT requires the complete positive absence-test contract.'));
  }

  for (const object of [pair.capability, pair.antipattern]) {
    const rules = object.evidence_rules;
    for (const family of ['evidence_ceilings', 'false_positive_guards', 'prohibited_inferences', 'contradiction_handling', 'freshness_rules']) {
      if (!Array.isArray(rules?.[family]) || rules[family].length === 0) {
        findings.push(defect('GOLDEN_EVIDENCE_SAFETY', String(object.id), `evidence_rules.${family}`, `${family} must be non-empty.`));
      }
    }
  }

  const lifecycleStages = [
    'QUALIFICATION_AND_REGISTRATION',
    'DESIGN_AND_DEVELOPMENT',
    'VERIFICATION_AND_VALIDATION',
    'DEPLOYMENT',
    'OPERATION_AND_MONITORING',
    'REVIEW_AND_EVALUATION',
    'RETIREMENT'
  ];
  for (const object of [pair.capability, pair.antipattern]) {
    const stages = (object.target_assurance_by_lifecycle_stage ?? []).map((item: any) => item.lifecycle_stage);
    if (stages.length !== lifecycleStages.length || !lifecycleStages.every((stage) => stages.includes(stage))) {
      findings.push(defect('GOLDEN_LIFECYCLE_COVERAGE', String(object.id), 'target_assurance_by_lifecycle_stage', 'Golden objects must define exactly one target for every required lifecycle stage.'));
    }
  }

  return { passed: findings.length === 0, findings };
}

export interface GoldenMutation {
  name: string;
  mutate: (pair: GoldenPair) => GoldenPair;
  expectedCheckId: string;
}

function clone(pair: GoldenPair): GoldenPair {
  return JSON.parse(JSON.stringify(pair)) as GoldenPair;
}

export const GOLDEN_MUTATIONS: GoldenMutation[] = [
  {
    name: 'duplicate-capability-atomic-id',
    expectedCheckId: 'GOLDEN_ATOMIC_ID_UNIQUENESS',
    mutate: (pair) => {
      const next = clone(pair);
      if (next.capability.atomic_subcriteria?.[1]) next.capability.atomic_subcriteria[1].id = next.capability.atomic_subcriteria[0]?.id;
      return next;
    }
  },
  {
    name: 'broken-capability-evidence-reference',
    expectedCheckId: 'GOLDEN_CAP_EVIDENCE_REF',
    mutate: (pair) => {
      const next = clone(pair);
      if (next.capability.atomic_subcriteria?.[0]) next.capability.atomic_subcriteria[0].required_evidence_ids = ['EVD-A1-999'];
      return next;
    }
  },
  {
    name: 'incomplete-absence-contract',
    expectedCheckId: 'GOLDEN_ABSENCE_CONTRACT',
    mutate: (pair) => {
      const next = clone(pair);
      if (next.antipattern.absence_test_contract) next.antipattern.absence_test_contract.independently_verified = false;
      return next;
    }
  },
  {
    name: 'missing-lifecycle-stage',
    expectedCheckId: 'GOLDEN_LIFECYCLE_COVERAGE',
    mutate: (pair) => {
      const next = clone(pair);
      next.capability.target_assurance_by_lifecycle_stage = (next.capability.target_assurance_by_lifecycle_stage ?? []).slice(0, -1);
      return next;
    }
  },
  {
    name: 'empty-prohibited-inferences',
    expectedCheckId: 'GOLDEN_EVIDENCE_SAFETY',
    mutate: (pair) => {
      const next = clone(pair);
      next.antipattern.evidence_rules.prohibited_inferences = [];
      return next;
    }
  }
];

export function runGoldenMutationSuite(pair: GoldenPair): Array<{ name: string; passed: boolean; detectedCheckIds: string[] }> {
  return GOLDEN_MUTATIONS.map((mutation) => {
    const result = validateGoldenPair(mutation.mutate(pair));
    const ids = result.findings.map((finding) => finding.checkId);
    return { name: mutation.name, passed: ids.includes(mutation.expectedCheckId), detectedCheckIds: ids };
  });
}
