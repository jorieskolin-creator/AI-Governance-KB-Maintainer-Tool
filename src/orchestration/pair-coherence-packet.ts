import type { AuthoringPlan } from '../authoring/authoring-plan.js';
import type { SirApAbsenceOutput } from '../cognitive/sir-ap-absence-contract.js';
import type { SirControlBoundaryOutput } from '../cognitive/sir-control-contract.js';
import type { SirEvidenceSafetyOutput } from '../cognitive/sir-evidence-safety-contract.js';
import type {
  SirApFailureModelOutput,
  SirApplicabilityOutput,
  SirPairBoundaryOutput,
  SirPrimaryQuestionsOutput
} from '../cognitive/sir-initial-contracts.js';
import type { MaterializedSirAtomics } from '../sir/atomic-materializer.js';
import type { MaterializedSirEvidence } from '../sir/evidence-materializer.js';
import type { MaterializedSirFindings } from '../sir/finding-materializer.js';
import type { MaterializedSirLifecycleTargets } from '../sir/lifecycle-materializer.js';
import type { MaterializedSirReferenceMappings } from '../sir/reference-mapping-materializer.js';
import type { MaterializedSirSourceMappings } from '../sir/source-mapping-materializer.js';
import { canonicalArtifactHash } from './artifact-hash.js';

export type PairCoherencePathHandle = `path_${string}`;

export interface PairCoherencePathEntry {
  pathHandle: PairCoherencePathHandle;
  objectPath: string;
  label: string;
}

export interface PairCoherenceSnapshot {
  pairBoundary: SirPairBoundaryOutput;
  apFailureModel: SirApFailureModelOutput;
  applicability: SirApplicabilityOutput;
  primaryQuestions: SirPrimaryQuestionsOutput;
  atomics: MaterializedSirAtomics;
  evidence: MaterializedSirEvidence;
  evidenceSafety: SirEvidenceSafetyOutput;
  apAbsence: SirApAbsenceOutput;
  sourceMappings: MaterializedSirSourceMappings;
  findings: MaterializedSirFindings;
  controlBoundary: SirControlBoundaryOutput;
  lifecycleTargets: MaterializedSirLifecycleTargets;
  referenceMappings: MaterializedSirReferenceMappings;
}

export interface PairCoherencePacket {
  packetVersion: '1.0.0';
  pairId: string;
  authoringPlanSha256: string;
  snapshot: PairCoherenceSnapshot;
  pathRegistry: PairCoherencePathEntry[];
  packetSha256: string;
}

export interface PairCoherencePacketSeed extends PairCoherenceSnapshot {
  authoringPlan: AuthoringPlan;
}

interface PathDraft {
  objectPath: string;
  label: string;
}

function itemPath(base: string, handle: string): string {
  return `${base}[${handle}]`;
}

function sourcePath(base: string, sourceHandle: string, locatorHandle: string): string {
  return `${base}[${sourceHandle}/${locatorHandle}]`;
}

function lifecyclePath(base: string, stage: string): string {
  return `${base}[${stage}]`;
}

function pathDrafts(snapshot: PairCoherenceSnapshot): PathDraft[] {
  const paths: PathDraft[] = [
    { objectPath: 'pairBoundary.capability', label: 'Capability semantic boundary' },
    { objectPath: 'pairBoundary.antipattern', label: 'Anti-pattern semantic boundary' },
    { objectPath: 'apFailureModel', label: 'Anti-pattern failure model' },
    { objectPath: 'applicability.capability', label: 'Capability applicability' },
    { objectPath: 'applicability.antipattern', label: 'Anti-pattern applicability' },
    { objectPath: 'primaryQuestions.capabilityQuestions', label: 'Capability primary questions' },
    { objectPath: 'primaryQuestions.antipatternQuestions', label: 'Anti-pattern primary questions' },
    { objectPath: 'atomics.capability', label: 'Capability atomic decomposition' }
  ];

  for (const item of snapshot.atomics.capability) {
    paths.push({
      objectPath: itemPath('atomics.capability', item.handle),
      label: `Capability atomic ${item.handle}`
    });
  }
  paths.push({ objectPath: 'atomics.antipattern', label: 'Anti-pattern atomic decomposition' });
  for (const item of snapshot.atomics.antipattern) {
    paths.push({
      objectPath: itemPath('atomics.antipattern', item.handle),
      label: `Anti-pattern atomic ${item.handle}`
    });
  }

  paths.push({ objectPath: 'evidence.capability', label: 'Capability evidence architecture' });
  for (const item of snapshot.evidence.capability) {
    paths.push({
      objectPath: itemPath('evidence.capability', item.handle),
      label: `Capability evidence ${item.handle}`
    });
  }
  paths.push({ objectPath: 'evidence.antipattern', label: 'Anti-pattern evidence architecture' });
  for (const item of snapshot.evidence.antipattern) {
    paths.push({
      objectPath: itemPath('evidence.antipattern', item.handle),
      label: `Anti-pattern evidence ${item.handle}`
    });
  }

  paths.push(
    { objectPath: 'evidenceSafety.capabilityRules', label: 'Capability evidence safety rules' },
    { objectPath: 'evidenceSafety.antipatternRules', label: 'Anti-pattern evidence safety rules' },
    { objectPath: 'apAbsence', label: 'Anti-pattern tested-absence contract' },
    { objectPath: 'sourceMappings.capability', label: 'Capability source mappings' }
  );
  for (const item of snapshot.sourceMappings.capability) {
    paths.push({
      objectPath: sourcePath('sourceMappings.capability', item.sourceHandle, item.locatorHandle),
      label: `Capability source ${item.sourceHandle}/${item.locatorHandle}`
    });
  }
  paths.push({ objectPath: 'sourceMappings.antipattern', label: 'Anti-pattern source mappings' });
  for (const item of snapshot.sourceMappings.antipattern) {
    paths.push({
      objectPath: sourcePath('sourceMappings.antipattern', item.sourceHandle, item.locatorHandle),
      label: `Anti-pattern source ${item.sourceHandle}/${item.locatorHandle}`
    });
  }

  paths.push({ objectPath: 'findings.capability', label: 'Capability findings' });
  for (const item of snapshot.findings.capability) {
    paths.push({
      objectPath: itemPath('findings.capability', item.handle),
      label: `Capability finding ${item.handle}`
    });
  }
  paths.push({ objectPath: 'findings.antipattern', label: 'Anti-pattern findings' });
  for (const item of snapshot.findings.antipattern) {
    paths.push({
      objectPath: itemPath('findings.antipattern', item.handle),
      label: `Anti-pattern finding ${item.handle}`
    });
  }

  paths.push(
    { objectPath: 'controlBoundary.capabilityHardGate', label: 'Capability hard-gate semantics' },
    { objectPath: 'controlBoundary.capabilityRuntimeBoundary', label: 'Capability machine/human boundary' },
    { objectPath: 'controlBoundary.antipatternHardGate', label: 'Anti-pattern hard-gate semantics' },
    { objectPath: 'controlBoundary.antipatternRuntimeBoundary', label: 'Anti-pattern machine/human boundary' },
    { objectPath: 'lifecycleTargets.capability', label: 'Capability lifecycle assurance targets' }
  );
  for (const item of snapshot.lifecycleTargets.capability) {
    paths.push({
      objectPath: lifecyclePath('lifecycleTargets.capability', item.lifecycleStage),
      label: `Capability lifecycle ${item.lifecycleStage}`
    });
  }
  paths.push({ objectPath: 'lifecycleTargets.antipattern', label: 'Anti-pattern lifecycle assurance targets' });
  for (const item of snapshot.lifecycleTargets.antipattern) {
    paths.push({
      objectPath: lifecyclePath('lifecycleTargets.antipattern', item.lifecycleStage),
      label: `Anti-pattern lifecycle ${item.lifecycleStage}`
    });
  }

  paths.push({ objectPath: 'referenceMappings.capabilityRelatedCriteria', label: 'Capability related criteria' });
  for (const item of snapshot.referenceMappings.capabilityRelatedCriteria) {
    paths.push({
      objectPath: itemPath('referenceMappings.capabilityRelatedCriteria', item.criterionHandle),
      label: `Capability related criterion ${item.criterionHandle}`
    });
  }
  paths.push({ objectPath: 'referenceMappings.antipatternRelatedCriteria', label: 'Anti-pattern related criteria' });
  for (const item of snapshot.referenceMappings.antipatternRelatedCriteria) {
    paths.push({
      objectPath: itemPath('referenceMappings.antipatternRelatedCriteria', item.criterionHandle),
      label: `Anti-pattern related criterion ${item.criterionHandle}`
    });
  }

  return paths;
}

function materializePathRegistry(snapshot: PairCoherenceSnapshot): PairCoherencePathEntry[] {
  const drafts = pathDrafts(snapshot);
  const objectPaths = new Set<string>();
  for (const draft of drafts) {
    if (!draft.objectPath.trim() || !draft.label.trim()) {
      throw new Error('Pair Coherence path registry cannot contain empty paths or labels.');
    }
    if (objectPaths.has(draft.objectPath)) {
      throw new Error(`Pair Coherence path registry contains duplicate object path ${draft.objectPath}.`);
    }
    objectPaths.add(draft.objectPath);
  }
  return drafts.map((draft, index) => ({
    pathHandle: `path_${String(index + 1).padStart(3, '0')}` as PairCoherencePathHandle,
    objectPath: draft.objectPath,
    label: draft.label
  }));
}

export function buildPairCoherencePacket(seed: PairCoherencePacketSeed): PairCoherencePacket {
  const snapshot: PairCoherenceSnapshot = {
    pairBoundary: seed.pairBoundary,
    apFailureModel: seed.apFailureModel,
    applicability: seed.applicability,
    primaryQuestions: seed.primaryQuestions,
    atomics: seed.atomics,
    evidence: seed.evidence,
    evidenceSafety: seed.evidenceSafety,
    apAbsence: seed.apAbsence,
    sourceMappings: seed.sourceMappings,
    findings: seed.findings,
    controlBoundary: seed.controlBoundary,
    lifecycleTargets: seed.lifecycleTargets,
    referenceMappings: seed.referenceMappings
  };
  const withoutHash = {
    packetVersion: '1.0.0' as const,
    pairId: seed.authoringPlan.identity.pairId,
    authoringPlanSha256: seed.authoringPlan.planSha256,
    snapshot,
    pathRegistry: materializePathRegistry(snapshot)
  };
  return {
    ...withoutHash,
    packetSha256: canonicalArtifactHash(withoutHash)
  };
}
