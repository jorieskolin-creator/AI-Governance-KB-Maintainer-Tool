import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type DecisionAuthority =
  | 'AUTHORING_PLAN'
  | 'GENAI_SEMANTIC'
  | 'DETERMINISTIC_DERIVED'
  | 'EXTERNAL_HUMAN'
  | 'RELEASE_SYSTEM';

export type CanonicalMaterializer = 'CANONICAL_COMPILER' | 'RELEASE_FINALIZER';

export interface FieldResponsibility {
  path: string;
  authority: DecisionAuthority;
  materializer: CanonicalMaterializer;
}

export interface SemanticRelationshipResponsibility {
  relationship: string;
  authority: 'GENAI_SEMANTIC';
  canonical_materialization: string;
  constraint?: string;
}

export interface ResponsibilityMap {
  version: string;
  purpose: string;
  principles: string[];
  decision_authorities: DecisionAuthority[];
  materializers: CanonicalMaterializer[];
  common_fields: FieldResponsibility[];
  capability_fields: FieldResponsibility[];
  antipattern_fields: FieldResponsibility[];
  semantic_relationships: SemanticRelationshipResponsibility[];
}

type JsonSchema = Record<string, any>;

async function readJson<T>(path: string): Promise<T> {
  const text = await readFile(resolve(process.cwd(), path), 'utf8');
  return JSON.parse(text) as T;
}

function pointerJoin(base: string, key: string): string {
  return `${base}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function resolveRef(ref: string, shared: JsonSchema): JsonSchema {
  const marker = '#/$defs/';
  const markerIndex = ref.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Unsupported schema reference in ownership validator: ${ref}`);
  const defName = ref.slice(markerIndex + marker.length);
  const resolved = shared.$defs?.[defName];
  if (!resolved) throw new Error(`Shared schema definition not found for ${ref}`);
  return resolved as JsonSchema;
}

function isPrimitiveLeafSchema(
  schema: JsonSchema,
  shared: JsonSchema,
  seenRefs: Set<string> = new Set()
): boolean {
  if (schema.$ref) {
    const ref = String(schema.$ref);
    if (seenRefs.has(ref)) return false;
    const next = new Set(seenRefs);
    next.add(ref);
    return isPrimitiveLeafSchema(resolveRef(ref, shared), shared, next);
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.every((child: JsonSchema) => isPrimitiveLeafSchema(child, shared, new Set(seenRefs)));
  }
  if (schema.properties && typeof schema.properties === 'object') return false;
  if (schema.type === 'array' || schema.items !== undefined || schema.prefixItems !== undefined) return false;
  return true;
}

function collectLeafPaths(
  schema: JsonSchema,
  path: string,
  shared: JsonSchema,
  output: Set<string>,
  seenRefs: Set<string> = new Set()
): void {
  if (schema.$ref) {
    const ref = String(schema.$ref);
    const refKey = `${path}:${ref}`;
    if (seenRefs.has(refKey)) return;
    seenRefs.add(refKey);
    collectLeafPaths(resolveRef(ref, shared), path, shared, output, seenRefs);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const child of schema.allOf) collectLeafPaths(child, path, shared, output, new Set(seenRefs));
    return;
  }

  if (schema.type === 'array' || schema.items !== undefined || schema.prefixItems !== undefined) {
    const itemPath = `${path}/*`;
    let structuredItemTraversed = false;

    if (Array.isArray(schema.prefixItems)) {
      for (const child of schema.prefixItems) {
        if (isPrimitiveLeafSchema(child, shared, new Set(seenRefs))) {
          output.add(path);
        } else {
          collectLeafPaths(child, itemPath, shared, output, new Set(seenRefs));
          structuredItemTraversed = true;
        }
      }
    }

    if (schema.items && schema.items !== true && schema.items !== false) {
      if (isPrimitiveLeafSchema(schema.items, shared, new Set(seenRefs))) {
        output.add(path);
      } else {
        collectLeafPaths(schema.items, itemPath, shared, output, new Set(seenRefs));
        structuredItemTraversed = true;
      }
    }

    if (!structuredItemTraversed && !output.has(path)) output.add(path);
    return;
  }

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, child] of Object.entries(schema.properties as Record<string, JsonSchema>)) {
      collectLeafPaths(child, pointerJoin(path, key), shared, output, new Set(seenRefs));
    }
    return;
  }

  output.add(path);
}

function collectCanonicalLeafPaths(schema: JsonSchema, shared: JsonSchema): Set<string> {
  const result = new Set<string>();
  if (!schema.properties) throw new Error('Canonical schema has no top-level properties.');
  for (const [key, child] of Object.entries(schema.properties as Record<string, JsonSchema>)) {
    collectLeafPaths(child, `/${key}`, shared, result);
  }
  return result;
}

function assertUniqueResponsibilities(entries: FieldResponsibility[], label: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.path.startsWith('/')) throw new Error(`${label}: invalid JSON-pointer-like path ${entry.path}`);
    if (seen.has(entry.path)) throw new Error(`${label}: duplicate responsibility for ${entry.path}`);
    seen.add(entry.path);
  }
}

function compareCoverage(
  expected: Set<string>,
  responsibilities: FieldResponsibility[],
  label: string
): void {
  assertUniqueResponsibilities(responsibilities, label);
  const actual = new Set(responsibilities.map((entry) => entry.path));
  const missing = [...expected].filter((path) => !actual.has(path)).sort();
  const extra = [...actual].filter((path) => !expected.has(path)).sort();
  if (missing.length || extra.length) {
    throw new Error(
      `${label} responsibility coverage mismatch.` +
        `${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}` +
        `${extra.length ? ` Extra: ${extra.join(', ')}.` : ''}`
    );
  }
}

function validateVocabulary(map: ResponsibilityMap): void {
  const authorities = new Set<DecisionAuthority>(map.decision_authorities);
  const materializers = new Set<CanonicalMaterializer>(map.materializers);
  const allFields = [...map.common_fields, ...map.capability_fields, ...map.antipattern_fields];

  for (const entry of allFields) {
    if (!authorities.has(entry.authority)) {
      throw new Error(`Unknown decision authority ${entry.authority} at ${entry.path}.`);
    }
    if (!materializers.has(entry.materializer)) {
      throw new Error(`Unknown canonical materializer ${entry.materializer} at ${entry.path}.`);
    }
  }

  const relationshipNames = new Set<string>();
  for (const relationship of map.semantic_relationships) {
    if (relationship.authority !== 'GENAI_SEMANTIC') {
      throw new Error(`${relationship.relationship} must remain a semantic relationship decision.`);
    }
    if (relationshipNames.has(relationship.relationship)) {
      throw new Error(`Duplicate semantic relationship responsibility ${relationship.relationship}.`);
    }
    relationshipNames.add(relationship.relationship);
  }
}

export interface ResponsibilityValidationSummary {
  version: string;
  capabilityLeafFields: number;
  antipatternLeafFields: number;
  commonResponsibilities: number;
  semanticRelationships: number;
}

export async function validateResponsibilityMap(): Promise<ResponsibilityValidationSummary> {
  const [map, capabilitySchema, antipatternSchema, sharedSchema] = await Promise.all([
    readJson<ResponsibilityMap>('architecture/responsibility-map.json'),
    readJson<JsonSchema>('schemas/capability.schema.json'),
    readJson<JsonSchema>('schemas/antipattern.schema.json'),
    readJson<JsonSchema>('schemas/shared-definitions.schema.json')
  ]);

  validateVocabulary(map);
  assertUniqueResponsibilities(map.common_fields, 'COMMON');
  assertUniqueResponsibilities(map.capability_fields, 'CAPABILITY_ONLY');
  assertUniqueResponsibilities(map.antipattern_fields, 'ANTIPATTERN_ONLY');

  const capabilityExpected = collectCanonicalLeafPaths(capabilitySchema, sharedSchema);
  const antipatternExpected = collectCanonicalLeafPaths(antipatternSchema, sharedSchema);

  compareCoverage(
    capabilityExpected,
    [...map.common_fields, ...map.capability_fields],
    'CAPABILITY'
  );
  compareCoverage(
    antipatternExpected,
    [...map.common_fields, ...map.antipattern_fields],
    'ANTIPATTERN'
  );

  return {
    version: map.version,
    capabilityLeafFields: capabilityExpected.size,
    antipatternLeafFields: antipatternExpected.size,
    commonResponsibilities: map.common_fields.length,
    semanticRelationships: map.semantic_relationships.length
  };
}
