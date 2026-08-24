import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DomainId } from '../authoring/authoring-plan.js';
import { expectedDomainPairIds } from '../orchestration/pipeline.js';

export const CATEGORY_DOMAINS: readonly DomainId[] = ['A', 'B', 'C', 'D', 'E', 'F'];

export interface CategoryPairIdentity {
  capabilityId: string;
  antipatternId: string;
  pairId: string;
  capabilityTitle: string;
  antipatternTitle: string;
  capabilityBoundarySummary: string;
  antipatternBoundarySummary: string;
}

export interface CategoryDomainIdentity {
  domain: DomainId;
  title: string;
  pairs: CategoryPairIdentity[];
}

export interface CategoriesBaseline {
  id: string;
  version: string;
  status: string;
  source_document: string;
  domains: CategoryDomainIdentity[];
}

function isDomainId(value: string): value is DomainId {
  return (CATEGORY_DOMAINS as readonly string[]).includes(value);
}

export function loadCategoriesBaseline(
  path = resolve(process.cwd(), 'baseline/categories-baseline.json')
): CategoriesBaseline {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as CategoriesBaseline;
  if (parsed.id !== 'AI-GOV-CATEGORIES-BASELINE') {
    throw new Error('Categories baseline id is not the sealed authoring baseline.');
  }
  if (parsed.version !== '1.1.0') {
    throw new Error(`Unexpected categories baseline version ${parsed.version}.`);
  }
  if (parsed.status !== 'APPROVED_AUTHORING_REFERENCE') {
    throw new Error('Categories baseline is not an approved authoring reference.');
  }
  if (parsed.domains.length !== CATEGORY_DOMAINS.length) {
    throw new Error('Categories baseline must declare exactly six domains.');
  }

  for (const domain of CATEGORY_DOMAINS) {
    const entry = parsed.domains.find((item) => item.domain === domain);
    if (!entry || !isDomainId(entry.domain)) {
      throw new Error(`Categories baseline is missing domain ${domain}.`);
    }
    const expected = expectedDomainPairIds(domain);
    const actual = entry.pairs.map((pair) => pair.pairId);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Categories baseline pair set for domain ${domain} drifted from pipeline.ts.`);
    }
    for (const pair of entry.pairs) {
      if (pair.antipatternId !== `AP-${pair.capabilityId}`) {
        throw new Error(`Anti-pattern ${pair.antipatternId} is not paired with ${pair.capabilityId}.`);
      }
      if (pair.pairId !== `${pair.capabilityId}_${pair.antipatternId}`) {
        throw new Error(`Pair id ${pair.pairId} is not deterministic.`);
      }
      if (!pair.capabilityTitle.trim() || !pair.antipatternTitle.trim()) {
        throw new Error(`Pair ${pair.pairId} is missing a sealed title.`);
      }
    }
  }

  return parsed;
}

export function categoryPair(baseline: CategoriesBaseline, pairId: string): CategoryPairIdentity {
  for (const domain of baseline.domains) {
    const match = domain.pairs.find((pair) => pair.pairId === pairId);
    if (match) return match;
  }
  throw new Error(`Unknown pair ${pairId} in the categories baseline.`);
}

export function categoryDomain(baseline: CategoriesBaseline, domain: DomainId): CategoryDomainIdentity {
  const match = baseline.domains.find((entry) => entry.domain === domain);
  if (!match) throw new Error(`Unknown domain ${domain} in the categories baseline.`);
  return match;
}
