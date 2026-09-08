import { createHash } from 'node:crypto';
import {
  canonicalArtifactHash,
  sha256Bytes,
  sha256Utf8,
  utf8Bytes
} from '../orchestration/artifact-hash.js';
import { pairCandidateRevisionHash } from '../orchestration/candidate-revision.js';
import {
  STALE_REVISION_ISSUE,
  evaluateDomainGates,
  evaluateRenderParity
} from '../orchestration/named-gates.js';
import { compileGateResult, compileSirPair } from '../compiler/sir-compiler.js';
import { a2CompileAuthoringPlan, completeSirCompileSnapshot } from '../compiler/sir-compile-fixture.js';
import {
  renderCandidateObjectHtml,
  type DomainCandidateBundle
} from '../operator/candidate-documents.js';
import { renderApprovalReviewHtml } from '../operator/approval-review.js';
import {
  compareCanonicalSemantics,
  fingerprintCanonicalObject,
  fingerprintRenderedHtml,
  hashCanonicalJson,
  renderCanonicalObject,
  renderCanonicalObjectHtml
} from './canonical-render.js';
import {
  approvalBundleSha256,
  buildApprovalBundle,
  namedGateSetHash,
  releaseBaselineFromPlan
} from './approval-bundle.js';
import { proposedManifestSha256, validateReleaseManifest } from './manifest.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const plan = a2CompileAuthoringPlan();
const snapshot = completeSirCompileSnapshot();
const draft = await compileSirPair({
  authoringPlan: plan,
  snapshot,
  mode: 'DRAFT',
  reviewNotes: ['Pair coherence passed with remaining visible notes.']
});
assert(draft.ok && draft.capability && draft.antipattern, 'approval-bundle fixture must compile as DRAFT');
const compileGate = compileGateResult(draft);
assert(compileGate.outcome === 'CANONICAL_COMPILE_VALID', 'fixture compile gate must be CANONICAL_COMPILE_VALID');

const capabilityRender = renderCanonicalObject(draft.capability);
const antipatternRender = renderCanonicalObject(draft.antipattern);
assert(capabilityRender.parityDefects.length === 0, 'canonical JSON and HTML must have semantic parity');
assert(antipatternRender.parityDefects.length === 0, 'anti-pattern JSON and HTML must have semantic parity');
assert(
  capabilityRender.json.sha256 === hashCanonicalJson(draft.capability) &&
    capabilityRender.json.sha256 === canonicalArtifactHash(draft.capability) &&
    capabilityRender.json.sha256 === sha256Bytes(capabilityRender.json.bytes),
  'JSON render hash must be SHA-256 of the exact canonical UTF-8 bytes'
);
assert(
  capabilityRender.html.sha256 === sha256Utf8(capabilityRender.html.utf8) &&
    capabilityRender.html.sha256 === sha256Bytes(utf8Bytes(capabilityRender.html.utf8)),
  'HTML render hash must be SHA-256 of the exact HTML bytes'
);
for (const identity of ['A2-Q1', 'A2-SC-001', 'EVD-A2-001', 'FND-A2-001', 'SRCMAP-A2-001']) {
  assert(capabilityRender.html.utf8.includes(identity), `publication HTML must include canonical identity ${identity}`);
}

const editedCapability = { ...draft.capability, title: 'Edited title for hash drift' };
assert(
  hashCanonicalJson(editedCapability) !== capabilityRender.json.sha256,
  'editing canonical JSON must change the JSON render hash'
);
const driftedHtml = capabilityRender.html.utf8.replace(
  /data-title="[^"]*"/,
  'data-title="Drifted publication title"'
);
assert(sha256Utf8(driftedHtml) !== capabilityRender.html.sha256, 'editing publication HTML must change the HTML hash');
const driftedFingerprint = fingerprintRenderedHtml(driftedHtml);
const driftDefects = compareCanonicalSemantics(fingerprintCanonicalObject(draft.capability), driftedFingerprint);
assert(driftDefects.length > 0, 'HTML semantic drift must fail render parity');
assert(
  evaluateRenderParity(driftDefects).outcome === 'RENDER_PARITY_FAILED',
  'semantic drift records RENDER_PARITY_FAILED'
);
assert(
  evaluateRenderParity([]).outcome === 'RENDER_PARITY_VALID',
  'empty parity defects record RENDER_PARITY_VALID'
);

const domainGates = evaluateDomainGates({
  review: {
    passed: true,
    coherenceSummary: 'No material domain-coherence defects remain after bounded review.',
    defects: []
  }
});
assert(
  domainGates.some((gate) => gate.outcome === 'READY_FOR_APPROVAL'),
  'clean domain QC must derive READY_FOR_APPROVAL'
);

const pairCandidateHash = pairCandidateRevisionHash('A2_AP-A2', {
  SOURCE_CONTEXT: '1'.repeat(64),
  PAIR_BOUNDARY: '2'.repeat(64)
});
const domainCandidateHash = 'd'.repeat(64);
const sourcePacketHash = 'c'.repeat(64);
const baseline = releaseBaselineFromPlan(plan);
const pairInput = {
  pairId: 'A2_AP-A2',
  pairCandidateHash,
  sourceContextPacketSha256: sourcePacketHash,
  capability: draft.capability,
  antipattern: draft.antipattern,
  gates: [compileGate]
};

const built = buildApprovalBundle({
  domain: 'A',
  domainCandidateHash,
  domainReleaseVersion: plan.targetVersion,
  baseline,
  pairCandidates: [pairInput],
  domainGates
});
const rebuilt = buildApprovalBundle({
  domain: 'A',
  domainCandidateHash,
  domainReleaseVersion: plan.targetVersion,
  baseline,
  pairCandidates: [pairInput],
  domainGates: [...domainGates].reverse(),
  expectedDomainCandidateHash: domainCandidateHash
});
assert(built.bundleSha256 === rebuilt.bundleSha256, 'approval bundle hash must be deterministic');
assert(built.bundleSha256 === approvalBundleSha256(built.bundle), 'bundleSha256 must hash the frozen document');
assert(built.bundle.documentKind === 'APPROVAL_BUNDLE', 'bundle kind must be APPROVAL_BUNDLE');
assert(built.bundle.approval === 'NOT_GRANTED' && built.bundle.releaseStatus === 'DRAFT', 'bundle must not grant approval');
assert(built.bundle.domainCandidateHash === domainCandidateHash, 'bundle must bind the domain candidate hash');
assert(built.bundle.pairCandidateHashes['A2_AP-A2'] === pairCandidateHash, 'bundle must bind the pair candidate hash');
assert(built.bundle.baseline.baselineSha256 === baseline.baseline_sha256, 'bundle must bind the sealed baseline hash');
assert(
  built.bundle.source.sourceRegisterSha256 === baseline.source_register_sha256 &&
    built.bundle.source.pairSourceContextPacketSha256['A2_AP-A2'] === sourcePacketHash,
  'bundle must bind source register and source-context packet hashes'
);
assert(
  built.bundle.gateResults.sha256 ===
    namedGateSetHash({
      domainCandidateHash,
      domainGates,
      pairs: [
        {
          pairId: 'A2_AP-A2',
          pairCandidateHash,
          gates: [...pairInput.gates, ...built.pairParityGates]
        }
      ]
    }),
  'gate-result hash must cover named outcomes bound to the candidate'
);
assert(
  built.bundle.proposedManifestSha256 === proposedManifestSha256(built.bundle.proposedManifest),
  'proposed manifest hash must match the hashed proposed document'
);
assert(
  built.bundle.proposedManifest.external_approval.status === 'NOT_GRANTED' &&
    !('approval_reference' in built.bundle.proposedManifest.external_approval) &&
    !('created_at' in built.bundle.proposedManifest),
  'proposed manifest must not invent approval or a wall-clock timestamp'
);

const jsonRender = built.bundle.renders.find((item) => item.objectId === 'A2' && item.format === 'JSON');
const htmlRender = built.bundle.renders.find((item) => item.objectId === 'A2' && item.format === 'HTML');
assert(jsonRender && htmlRender, 'bundle must include JSON and HTML renders for A2');
assert(jsonRender.sha256 === capabilityRender.json.sha256, 'bundle JSON hash must be the publication JSON bytes');
assert(htmlRender.sha256 === capabilityRender.html.sha256, 'bundle HTML hash must be the publication HTML bytes');
const jsonPayload = built.payloads[jsonRender.sha256];
const htmlPayload = built.payloads[htmlRender.sha256];
assert(jsonPayload && sha256Utf8(jsonPayload.utf8) === jsonRender.sha256, 'frozen JSON payload must match its sha256');
assert(htmlPayload && sha256Utf8(htmlPayload.utf8) === htmlRender.sha256, 'frozen HTML payload must match its sha256');
assert(jsonPayload.utf8 === capabilityRender.json.utf8, 'frozen JSON payload must be the exact publication bytes');

let approvalReferenceRequired = false;
try {
  validateReleaseManifest({
    manifest_version: '1.0.0',
    domain: built.bundle.proposedManifest.domain,
    domain_release_version: built.bundle.proposedManifest.domain_release_version,
    baseline: built.bundle.proposedManifest.baseline,
    external_approval: {
      approval_reference: '',
      approved_by_role: 'operator',
      approved_on: '2020-01-01',
      effective_from: '2020-01-01'
    },
    pairs: built.bundle.proposedManifest.pairs,
    created_at: '2020-01-01T00:00:00.000Z'
  });
} catch (error) {
  approvalReferenceRequired =
    error instanceof Error && error.message.includes('External approval reference is required');
}
assert(approvalReferenceRequired, 'publication manifest still requires an approval reference; the bundle must not skip that gate');

const baselineEdited = {
  ...baseline,
  baseline_sha256: 'b'.repeat(64)
};
const baselineDrift = buildApprovalBundle({
  domain: 'A',
  domainCandidateHash,
  domainReleaseVersion: plan.targetVersion,
  baseline: baselineEdited,
  pairCandidates: [pairInput],
  domainGates
});
assert(
  baselineDrift.bundle.proposedManifestSha256 !== built.bundle.proposedManifestSha256 &&
    baselineDrift.bundleSha256 !== built.bundleSha256,
  'changing the baseline hash must change the proposed manifest and bundle hashes'
);

const titleDrift = buildApprovalBundle({
  domain: 'A',
  domainCandidateHash,
  domainReleaseVersion: plan.targetVersion,
  baseline,
  pairCandidates: [{ ...pairInput, capability: editedCapability, antipattern: draft.antipattern }],
  domainGates
});
assert(titleDrift.bundleSha256 !== built.bundleSha256, 'changing canonical JSON must change the approval bundle hash');
const driftedJson = titleDrift.bundle.renders.find((item) => item.objectId === 'A2' && item.format === 'JSON');
assert(driftedJson && driftedJson.sha256 !== jsonRender.sha256, 'changed canonical JSON must change the JSON render hash in the bundle');

let staleRejected = false;
try {
  buildApprovalBundle({
    domain: 'A',
    domainCandidateHash,
    domainReleaseVersion: plan.targetVersion,
    baseline,
    pairCandidates: [pairInput],
    domainGates,
    expectedDomainCandidateHash: 'e'.repeat(64)
  });
} catch (error) {
  staleRejected = error instanceof Error && error.message === STALE_REVISION_ISSUE;
}
assert(staleRejected, 'a stale domain candidate hash cannot be presented as the current approval bundle');

let missingReadinessRejected = false;
try {
  buildApprovalBundle({
    domain: 'A',
    domainCandidateHash,
    domainReleaseVersion: plan.targetVersion,
    baseline,
    pairCandidates: [pairInput],
    domainGates: domainGates.filter((gate) => gate.outcome !== 'READY_FOR_APPROVAL')
  });
} catch (error) {
  missingReadinessRejected = error instanceof Error && error.message.includes('READY_FOR_APPROVAL');
}
assert(missingReadinessRejected, 'approval bundle construction stays closed without READY_FOR_APPROVAL');

const draftBundle: DomainCandidateBundle = {
  documentKind: 'DOMAIN_PRODUCTION_CANDIDATE_BUNDLE',
  domain: 'A',
  domainTitle: plan.identity.domainTitle,
  domainState: 'IN_PROGRESS',
  domainCoherence: 'NONE',
  releaseStatus: 'DRAFT',
  approval: 'NOT_GRANTED',
  unresolvedIssues: draft.notes,
  pairs: [
    {
      pairId: 'A2_AP-A2',
      status: 'COMPILED',
      notes: draft.notes,
      capability: draft.capability,
      antipattern: draft.antipattern
    }
  ],
  documents: [
    {
      pairId: 'A2_AP-A2',
      objectId: 'A2',
      objectType: 'CAPABILITY',
      title: plan.identity.capabilityTitle,
      status: 'COMPILED',
      href: '/documents/A/A2',
      htmlHref: '/documents/A/A2',
      jsonHref: '/api/operator/documents/A/A2.json',
      notes: draft.notes
    }
  ]
};
const draftHtml = renderCandidateObjectHtml({ domain: 'A', bundle: draftBundle, objectId: 'A2' });
assert(draftHtml.includes('DRAFT'), 'draft rendering must remain labeled DRAFT');
assert(draftHtml.includes('Unresolved issues'), 'draft rendering must identify unresolved issues');
assert(
  draft.notes.every((note) => draftHtml.includes(note)),
  'draft rendering must keep compile notes and source gaps visible'
);
assert(!draftHtml.includes('APPROVAL_BUNDLE'), 'draft documents must not be the immutable approval bundle');

const reviewHtml = renderApprovalReviewHtml({
  domain: 'A',
  domainCandidateHash,
  bundle: built.bundle,
  bundleSha256: built.bundleSha256
});
assert(reviewHtml.includes(built.bundleSha256), 'approval review must show the frozen bundle hash');
assert(reviewHtml.includes(built.bundle.proposedManifestSha256), 'approval review must show the proposed manifest hash');
assert(reviewHtml.includes(capabilityRender.json.sha256), 'approval review must show the publication JSON hash');
assert(reviewHtml.includes('not APPROVED'), 'approval review must not claim APPROVED');
assert(!reviewHtml.includes('recordApproval'), 'approval review must not expose recordApproval');

const encoderHash = createHash('sha256').update(utf8Bytes(capabilityRender.json.utf8)).digest('hex');
assert(encoderHash === capabilityRender.json.sha256, 'TextEncoder bytes must match the JSON publication hash');

console.log(
  JSON.stringify({
    jsonSha256: capabilityRender.json.sha256,
    htmlSha256: capabilityRender.html.sha256,
    proposedManifestSha256: built.bundle.proposedManifestSha256,
    gateResultSha256: built.bundle.gateResults.sha256,
    bundleSha256: built.bundleSha256,
    renderCount: built.bundle.renders.length,
    approval: built.bundle.approval,
    staleRejected: 'PASS',
    draftUnresolved: 'PASS'
  })
);
console.log('APPROVAL_BUNDLE_CHECK_PASS');
