import { z } from 'zod';
import type { CognitiveTaskType } from '../domain/states.js';
import type { TaskContract } from '../domain/task-contract.js';
import type { SirEvidenceItem } from '../sir/model.js';
import type { ValidationFinding, ValidationReport } from './contracts.js';

const meaningful = z.string().trim().min(10);
const atomicHandle = z.string().regex(/^atomic_[A-Za-z0-9._-]+$/);
const evidenceHandle = z.string().regex(/^evidence_[A-Za-z0-9._-]+$/);
const severity = z.enum(['LOW','MEDIUM','HIGH','BLOCKING']);

const capabilityFinding = z.object({
  title: meaningful,
  eligibleConclusionStates: z.array(z.enum([
    'SATISFIED','PARTIALLY_SATISFIED','NOT_SATISFIED','UNKNOWN','NOT_APPLICABLE'
  ])).min(1),
  atomicHandles: z.array(atomicHandle).min(1),
  evidenceHandles: z.array(evidenceHandle).min(1),
  defaultSeverity: severity,
  lifecycleConsequence: meaningful,
  humanLockRequired: z.boolean()
}).strict();

const antipatternFinding = z.object({
  title: meaningful,
  eligibleConclusionStates: z.array(z.enum([
    'CONFIRMED_PRESENT','PARTIALLY_PRESENT','TESTED_ABSENT','UNKNOWN','NOT_APPLICABLE'
  ])).min(1),
  atomicHandles: z.array(atomicHandle).min(1),
  evidenceHandles: z.array(evidenceHandle).min(1),
  defaultSeverity: severity,
  lifecycleConsequence: meaningful,
  humanLockRequired: z.boolean()
}).strict();

const outputSchema = z.object({
  capabilityFindings: z.array(capabilityFinding).min(1),
  antipatternFindings: z.array(antipatternFinding).min(1),
  findingLogicNotes: z.array(z.string().trim().min(1))
}).strict();

export interface SirFindingCompletionContext {
  runId: string;
  expectedPairId: string;
}

function finding(
  context:SirFindingCompletionContext,
  checkId:string,
  objectPath:string,
  issue:string,
  kind:ValidationFinding['kind']='REFERENCE'
):ValidationFinding {
  return {
    checkId, kind, severity:'BLOCKING', objectId:context.expectedPairId,
    objectPath, issue, dependencyScope:[]
  };
}

function report(context:SirFindingCompletionContext, findings:ValidationFinding[]):ValidationReport {
  return { runId:context.runId, objectId:context.expectedPairId, passed:findings.length===0, findings };
}

function validatePrerequisites(
  contract:TaskContract,
  completed:ReadonlySet<CognitiveTaskType>,
  context:SirFindingCompletionContext,
  findings:ValidationFinding[]
):void {
  for (const prerequisite of contract.upstreamTaskTypes) {
    if (!completed.has(prerequisite)) {
      findings.push(finding(context,'SIR_PREREQUISITE_MISSING','/',`${contract.taskType} requires validated ${prerequisite}.`,'SCHEMA'));
    }
  }
}

function unique(values:string[]):boolean {
  return new Set(values).size === values.length;
}

function validateFindingGroup(input:{
  path:'capabilityFindings'|'antipatternFindings';
  items:Array<{
    title:string;
    eligibleConclusionStates:string[];
    atomicHandles:string[];
    evidenceHandles:string[];
  }>;
  atomics:Array<{handle:string}>;
  evidence:SirEvidenceItem[];
  context:SirFindingCompletionContext;
  findings:ValidationFinding[];
}):void {
  const atomicSet = new Set<string>(input.atomics.map((item)=>item.handle));
  const evidenceByHandle = new Map<string,SirEvidenceItem>(
    input.evidence.map((item)=>[item.handle,item] as const)
  );
  const titles = new Set<string>();

  input.items.forEach((item,index)=>{
    const base = `/${input.path}/${index}`;
    const titleKey = item.title.trim().toLowerCase();
    if (titles.has(titleKey)) {
      input.findings.push(finding(input.context,'SIR_FINDING_DUPLICATE_TITLE',`${base}/title`,'Finding titles must be unique within the object.','SEMANTIC'));
    }
    titles.add(titleKey);

    if (!unique(item.eligibleConclusionStates)) {
      input.findings.push(finding(input.context,'SIR_FINDING_DUPLICATE_CONCLUSION_STATE',`${base}/eligibleConclusionStates`,'Finding conclusion states must be unique.','SCHEMA'));
    }
    if (!unique(item.atomicHandles)) {
      input.findings.push(finding(input.context,'SIR_FINDING_DUPLICATE_ATOMIC_HANDLE',`${base}/atomicHandles`,'Finding atomic handles must be unique.'));
    }
    if (!unique(item.evidenceHandles)) {
      input.findings.push(finding(input.context,'SIR_FINDING_DUPLICATE_EVIDENCE_HANDLE',`${base}/evidenceHandles`,'Finding evidence handles must be unique.'));
    }

    const selectedAtomicSet = new Set<string>(item.atomicHandles);
    const selectedEvidence:SirEvidenceItem[] = [];

    for (const handle of item.atomicHandles) {
      if (!atomicSet.has(handle)) {
        input.findings.push(finding(input.context,'SIR_FINDING_UNKNOWN_ATOMIC_HANDLE',`${base}/atomicHandles`,`${handle} is not a validated atomic handle for this object.`));
      }
    }

    for (const handle of item.evidenceHandles) {
      const evidence = evidenceByHandle.get(handle);
      if (!evidence) {
        input.findings.push(finding(input.context,'SIR_FINDING_UNKNOWN_EVIDENCE_HANDLE',`${base}/evidenceHandles`,`${handle} is not a validated evidence handle for this object.`));
      } else {
        selectedEvidence.push(evidence);
      }
    }

    for (const atomic of selectedAtomicSet) {
      if (!atomicSet.has(atomic)) continue;
      const covered = selectedEvidence.some((evidence)=>
        evidence.supportsAtomicHandles.some((handle)=>String(handle)===atomic)
      );
      if (!covered) {
        input.findings.push(finding(
          input.context,
          'SIR_FINDING_ATOMIC_NOT_COVERED_BY_SELECTED_EVIDENCE',
          `${base}/evidenceHandles`,
          `Selected finding evidence does not cover selected atomic handle ${atomic}.`
        ));
      }
    }

    for (const evidence of selectedEvidence) {
      if (!evidence.supportsAtomicHandles.some((handle)=>selectedAtomicSet.has(String(handle)))) {
        input.findings.push(finding(
          input.context,
          'SIR_FINDING_EVIDENCE_NOT_RELEVANT_TO_SELECTED_ATOMICS',
          `${base}/evidenceHandles`,
          `${evidence.handle} does not support any atomic handle selected by this finding.`
        ));
      }
    }
  });
}

export function validateSirFindingCompletion(
  contract:TaskContract,
  completed:ReadonlySet<CognitiveTaskType>,
  output:unknown,
  context:SirFindingCompletionContext
):ValidationReport {
  const findings:ValidationFinding[] = [];

  if (contract.contractVersion !== '2.0.0' || contract.taskType !== 'FINDING_ARCHITECTURE') {
    findings.push(finding(context,'SIR_FINDING_CONTRACT_IDENTITY','/','Finding SIR completion requires FINDING_ARCHITECTURE contractVersion 2.0.0.','SCHEMA'));
    return report(context,findings);
  }

  validatePrerequisites(contract,completed,context,findings);

  const capabilityAtomics = contract.lockedInputs.capability_atomics as Array<{handle:string}> | undefined;
  const antipatternAtomics = contract.lockedInputs.antipattern_atomics as Array<{handle:string}> | undefined;
  const capabilityEvidence = contract.lockedInputs.capability_evidence as SirEvidenceItem[] | undefined;
  const antipatternEvidence = contract.lockedInputs.antipattern_evidence as SirEvidenceItem[] | undefined;
  const sourceMappings = contract.lockedInputs.source_mappings as {sourceContextPacketSha256?:unknown} | undefined;
  const absence = contract.lockedInputs.ap_absence_contract as {requiredArtifacts?:unknown;interpretationBoundary?:unknown} | undefined;

  if (!Array.isArray(capabilityAtomics) || capabilityAtomics.length===0 || !Array.isArray(antipatternAtomics) || antipatternAtomics.length===0) {
    findings.push(finding(context,'SIR_FINDING_ATOMIC_GRAPH_REQUIRED','/','Finding authoring requires materialized capability and anti-pattern atomics.'));
  }
  if (!Array.isArray(capabilityEvidence) || capabilityEvidence.length===0 || !Array.isArray(antipatternEvidence) || antipatternEvidence.length===0) {
    findings.push(finding(context,'SIR_FINDING_EVIDENCE_GRAPH_REQUIRED','/','Finding authoring requires materialized capability and anti-pattern evidence.'));
  }
  if (!sourceMappings || typeof sourceMappings.sourceContextPacketSha256 !== 'string' || !sourceMappings.sourceContextPacketSha256) {
    findings.push(finding(context,'SIR_FINDING_SOURCE_MAPPING_ARTIFACT_REQUIRED','/source_mappings','Finding authoring requires the persisted materialized Source Mapping artifact.','SOURCE'));
  }

  const parsed = outputSchema.safeParse(output);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(finding(context,'SIR_FINDING_OUTPUT_CONTRACT',`/${issue.path.join('/')}`,issue.message,'SCHEMA'));
    }
    return report(context,findings);
  }

  if (capabilityAtomics && capabilityEvidence) {
    validateFindingGroup({
      path:'capabilityFindings', items:parsed.data.capabilityFindings,
      atomics:capabilityAtomics, evidence:capabilityEvidence, context, findings
    });
  }
  if (antipatternAtomics && antipatternEvidence) {
    validateFindingGroup({
      path:'antipatternFindings', items:parsed.data.antipatternFindings,
      atomics:antipatternAtomics, evidence:antipatternEvidence, context, findings
    });
  }

  const testedAbsentUsed = parsed.data.antipatternFindings.some((item)=>
    item.eligibleConclusionStates.includes('TESTED_ABSENT')
  );
  if (testedAbsentUsed) {
    if (
      !absence ||
      !Array.isArray(absence.requiredArtifacts) ||
      absence.requiredArtifacts.length===0 ||
      typeof absence.interpretationBoundary !== 'string' ||
      absence.interpretationBoundary.trim().length<10
    ) {
      findings.push(finding(
        context,
        'SIR_FINDING_TESTED_ABSENT_WITHOUT_ABSENCE_CONTRACT',
        '/antipatternFindings',
        'TESTED_ABSENT eligibility requires a validated AP absence contract with required artifacts and interpretation boundary.'
      ));
    }
  }

  return report(context,findings);
}
