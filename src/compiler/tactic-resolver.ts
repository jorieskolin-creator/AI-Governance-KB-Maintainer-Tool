import type { ReferenceMappingOutput } from '../cognitive/final-pair-contracts.js';

export interface ApprovedTacticCatalogMapping {
  object_id: string;
  mapping_id: string;
  tactic_id: string;
  tactic_version: string;
  finding_id: string;
  relationship: string;
  mapping_status: 'APPROVED';
  catalog_version: string;
}

export interface CanonicalTacticRef {
  mapping_id: string;
  tactic_id: string;
  tactic_version: string;
  finding_id: string;
  relationship: string;
  mapping_status: 'APPROVED';
  catalog_version: string;
}

export interface ResolvedTacticReferences {
  capability: CanonicalTacticRef[];
  antipattern: CanonicalTacticRef[];
}

function resolveForObject(
  objectId: string,
  selectedTacticIds: string[],
  catalog: readonly ApprovedTacticCatalogMapping[] | null
): CanonicalTacticRef[] {
  if (selectedTacticIds.length === 0) return [];
  if (catalog === null) {
    throw new Error(
      `${objectId} requested tactic references but no approved machine-readable Tactic Catalog was supplied.`
    );
  }

  const selected = new Set(selectedTacticIds);
  const matched = catalog.filter(
    (mapping) =>
      mapping.object_id === objectId &&
      mapping.mapping_status === 'APPROVED' &&
      selected.has(mapping.tactic_id)
  );

  for (const tacticId of selected) {
    if (!matched.some((mapping) => mapping.tactic_id === tacticId)) {
      throw new Error(`No exact approved reciprocal tactic mapping exists for ${objectId} -> ${tacticId}.`);
    }
  }

  const uniqueMappings = new Set<string>();
  return matched
    .slice()
    .sort((a, b) => a.mapping_id.localeCompare(b.mapping_id))
    .map((mapping) => {
      if (uniqueMappings.has(mapping.mapping_id)) {
        throw new Error(`Duplicate approved tactic mapping ID ${mapping.mapping_id}.`);
      }
      uniqueMappings.add(mapping.mapping_id);
      return {
        mapping_id: mapping.mapping_id,
        tactic_id: mapping.tactic_id,
        tactic_version: mapping.tactic_version,
        finding_id: mapping.finding_id,
        relationship: mapping.relationship,
        mapping_status: mapping.mapping_status,
        catalog_version: mapping.catalog_version
      };
    });
}

export function resolveTacticReferences(
  references: ReferenceMappingOutput,
  catalog: readonly ApprovedTacticCatalogMapping[] | null
): ResolvedTacticReferences {
  return {
    capability: resolveForObject(
      references.capabilityId,
      references.capabilityTacticRefs,
      catalog
    ),
    antipattern: resolveForObject(
      references.antipatternId,
      references.antipatternTacticRefs,
      catalog
    )
  };
}
