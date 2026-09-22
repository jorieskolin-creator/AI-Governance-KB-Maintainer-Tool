export type Finding = {
  code: string;
  path: string;
  message: string;
};

export type StrictnessTier = 'DRAFT' | 'RELEASE';

export interface ValidationResult {
  ok: boolean;
  tier: StrictnessTier;
  findings: Finding[];
  warnings: Finding[];
}

export function applyTier(
  schemaFindings: Finding[],
  contractFindings: Finding[],
  tier: StrictnessTier
): ValidationResult {
  if (tier === 'DRAFT') {
    return {
      ok: schemaFindings.length === 0,
      tier,
      findings: schemaFindings,
      warnings: contractFindings
    };
  }
  return {
    ok: schemaFindings.length === 0 && contractFindings.length === 0,
    tier,
    findings: [...schemaFindings, ...contractFindings],
    warnings: []
  };
}
