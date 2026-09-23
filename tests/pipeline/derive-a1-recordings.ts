import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileSirPair } from '../../src/compiler/sir-compiler.js';
import { a2CompileAuthoringPlan, completeSirCompileSnapshot } from '../../src/compiler/sir-compile-fixture.js';

const RECORDING_DIR = resolve(process.cwd(), 'tests/pipeline/recordings/A1');
const FORBIDDEN_OUTPUTS = [
  'SOURCE_CONTEXT.json',
  'PAIR_FRAME.json',
  'EVIDENCE_AND_SAFETY.json',
  'MAPPINGS.json',
  'PAIR_COHERENCE_REVIEW.json',
  'authoring-plan.json',
  'snapshot.json'
] as const;

const GOLDEN_SOURCE_KEYS = [
  'mapping_id',
  'source_id',
  'source_version_or_date',
  'exact_locator',
  'relationship',
  'category_rationale',
  'verification_status',
  'last_verified_date'
] as const;

const COMPILER_SOURCE_KEYS = [
  'mapping_id',
  'source_id',
  'source_version_or_date',
  'exact_locator',
  'relationship',
  'supported_claim',
  'category_rationale',
  'applicability_conditions',
  'exclusions',
  'verification_status',
  'last_verified_date'
] as const;

interface GoldenObject {
  schema_version?: unknown;
  release_status?: unknown;
  approval_record?: unknown;
  candidate_tactic_refs?: unknown;
  normative_source_mappings?: unknown;
}

function loadGolden(name: string): GoldenObject {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'golden/fixtures', name), 'utf8')) as GoldenObject;
}

function sourceMappings(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
}

function mappingIds(value: unknown): string[] {
  return sourceMappings(value).map((item) => String(item.mapping_id ?? ''));
}

function keysOf(items: Array<Record<string, unknown>>): string[] {
  return [...new Set(items.flatMap((item) => Object.keys(item)))].sort();
}

const capability = loadGolden('A1_v1.0.0.json');
const antipattern = loadGolden('AP-A1_v1.0.0.json');
const capabilitySources = sourceMappings(capability.normative_source_mappings);
const antipatternSources = sourceMappings(antipattern.normative_source_mappings);

const authoringPlan = a2CompileAuthoringPlan();
const completeSnapshot = completeSirCompileSnapshot();
const release = await compileSirPair({
  authoringPlan,
  snapshot: completeSnapshot,
  mode: 'RELEASE'
});
const mappedSnapshot = {
  ...completeSnapshot,
  sourceMappings: {
    ...completeSnapshot.sourceMappings,
    unmappedClaims: []
  }
};
const releaseWithoutUnmapped = await compileSirPair({
  authoringPlan,
  snapshot: mappedSnapshot,
  mode: 'RELEASE'
});

const finding = {
  briefId: 'P2A-FIX',
  status: 'STOP_AND_REPORT',
  recordingsWritten: false,
  reason:
    'A faithful derivation cannot make compileSirPair RELEASE output deep-equal golden/fixtures/A1_v1.0.0.json and AP-A1_v1.0.0.json. Task recordings were not synthesized.',
  inputs: [
    'golden/fixtures/A1_v1.0.0.json',
    'golden/fixtures/AP-A1_v1.0.0.json',
    'golden/golden-reference.manifest.json',
    'src/compiler/sir-compiler.ts compileSirPair',
    'src/compiler/canonical-ids.ts sourceMappingId'
  ],
  releaseGate: {
    control: 'complete A2 compile fixture, mode RELEASE, unmodified compileSirPair',
    ok: release.ok,
    outcome: release.outcome,
    capabilityEmitted: release.capability !== undefined,
    antipatternEmitted: release.antipattern !== undefined,
    defectCheckIds: release.defects.map((item) => item.checkId),
    approvalRecord: release.defects
      .filter((item) => item.checkId === 'APPROVAL_RECORD')
      .map((item) => ({ path: item.objectPath, issue: item.issue })),
    withoutUnmappedClaims: {
      note: 'Same A2 snapshot with sourceMappings.unmappedClaims cleared. SOURCE_UNMAPPED_CLAIM is fixture-specific. APPROVAL_RECORD remains.',
      ok: releaseWithoutUnmapped.ok,
      capabilityEmitted: releaseWithoutUnmapped.capability !== undefined,
      antipatternEmitted: releaseWithoutUnmapped.antipattern !== undefined,
      defectCheckIds: releaseWithoutUnmapped.defects.map((item) => item.checkId)
    }
  },
  golden: {
    capability: {
      schema_version: capability.schema_version,
      release_status: capability.release_status,
      approval_record: capability.approval_record !== undefined,
      candidate_tactic_refs: Array.isArray(capability.candidate_tactic_refs) ? capability.candidate_tactic_refs.length : null,
      sourceMappingIds: mappingIds(capability.normative_source_mappings),
      sourceMappingKeys: keysOf(capabilitySources)
    },
    antipattern: {
      schema_version: antipattern.schema_version,
      release_status: antipattern.release_status,
      approval_record: antipattern.approval_record !== undefined,
      candidate_tactic_refs: Array.isArray(antipattern.candidate_tactic_refs) ? antipattern.candidate_tactic_refs.length : null,
      sourceMappingIds: mappingIds(antipattern.normative_source_mappings),
      sourceMappingKeys: keysOf(antipatternSources)
    }
  },
  compilerOwnedMismatches: [
    {
      field: 'compile.ok / capability / antipattern',
      compiler: 'RELEASE always pushes APPROVAL_RECORD and returns documents only when defects.length === 0',
      golden: 'authorOfflineA1 requires compile.ok and both documents'
    },
    {
      field: 'schema_version',
      compiler: 'plan.schemaVersion; active production family 2.1.0',
      golden: '2.0.0'
    },
    {
      field: 'release_status',
      compiler: 'DRAFT',
      golden: 'APPROVED'
    },
    {
      field: 'approval_record',
      compiler: 'omitted',
      golden: 'present'
    },
    {
      field: 'candidate_tactic_refs',
      compiler: '[]',
      golden: 'non-empty APPROVED tactic mappings'
    },
    {
      field: 'normative_source_mappings[].mapping_id',
      compiler: 'SRCMAP-<objectId>-<ordinal> via sourceMappingId',
      golden: 'SRCMAP-A1-EU-AIA-001, SRCMAP-A1-NIST-AI-RMF-002, SRCMAP-AP-A1-EU-AIA-001, SRCMAP-AP-A1-NIST-AI-RMF-002'
    }
  ],
  unrecoverableCompilerInputs: [
    {
      snapshotField: 'sourceMappings.capability[].supportedClaim',
      compilerOutputField: 'normative_source_mappings[].supported_claim',
      goldenKeysPresent: GOLDEN_SOURCE_KEYS,
      compilerKeysEmitted: COMPILER_SOURCE_KEYS
    },
    {
      snapshotField: 'sourceMappings.capability[].applicabilityConditions',
      compilerOutputField: 'normative_source_mappings[].applicability_conditions',
      goldenKeysPresent: GOLDEN_SOURCE_KEYS,
      compilerKeysEmitted: COMPILER_SOURCE_KEYS
    },
    {
      snapshotField: 'sourceMappings.capability[].exclusions',
      compilerOutputField: 'normative_source_mappings[].exclusions',
      goldenKeysPresent: GOLDEN_SOURCE_KEYS,
      compilerKeysEmitted: COMPILER_SOURCE_KEYS
    },
    {
      snapshotField: 'sourceMappings.antipattern[].supportedClaim',
      compilerOutputField: 'normative_source_mappings[].supported_claim',
      goldenKeysPresent: GOLDEN_SOURCE_KEYS,
      compilerKeysEmitted: COMPILER_SOURCE_KEYS
    },
    {
      snapshotField: 'sourceMappings.antipattern[].applicabilityConditions',
      compilerOutputField: 'normative_source_mappings[].applicability_conditions',
      goldenKeysPresent: GOLDEN_SOURCE_KEYS,
      compilerKeysEmitted: COMPILER_SOURCE_KEYS
    },
    {
      snapshotField: 'sourceMappings.antipattern[].exclusions',
      compilerOutputField: 'normative_source_mappings[].exclusions',
      goldenKeysPresent: GOLDEN_SOURCE_KEYS,
      compilerKeysEmitted: COMPILER_SOURCE_KEYS
    }
  ],
  proposedTestContractChange:
    'Do not deep-equal compileSirPair RELEASE output to the schema 2.0.0 APPROVED golden bytes. A follow-up brief should specify a DRAFT-mode compiler regression against a 2.1.0 image the unmodified compiler can emit, and keep the 2.0.0 fixtures as the semantic calibration reference. This brief forbids editing the test, the compiler, and golden/.'
};

const present = readdirSync(RECORDING_DIR);
const leaked = FORBIDDEN_OUTPUTS.filter((name) => present.includes(name));
if (leaked.length > 0) {
  throw new Error(`Derivation must not write recordings while stopped. Found ${leaked.join(', ')}.`);
}

console.log(JSON.stringify(finding, null, 2));
process.exitCode = 2;
