import { sha256Utf8 } from '../orchestration/artifact-hash.js';
import type { ApprovalBundle, ApprovalBundlePayload } from '../release/approval-bundle.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&' + 'amp;')
    .replaceAll('<', '&' + 'lt;')
    .replaceAll('>', '&' + 'gt;')
    .replaceAll('"', '&' + 'quot;')
    .replaceAll("'", '&#39;');
}

export function renderApprovalReviewHtml(input: {
  domain: string;
  domainCandidateHash?: string;
  issues?: readonly string[];
  bundle?: ApprovalBundle;
  bundleSha256?: string;
}): string {
  const ready = Boolean(input.bundle && input.bundleSha256 && (!input.issues || input.issues.length === 0));
  const bundle = input.bundle;
  const hashes = bundle
    ? `<dl>
        <div><dt>Domain candidate</dt><dd><code>${escapeHtml(bundle.domainCandidateHash)}</code></dd></div>
        <div><dt>Baseline</dt><dd><code>${escapeHtml(bundle.baseline.baselineSha256)}</code></dd></div>
        <div><dt>Source register</dt><dd><code>${escapeHtml(bundle.source.sourceRegisterSha256)}</code></dd></div>
        <div><dt>Gate-result set</dt><dd><code>${escapeHtml(bundle.gateResults.sha256)}</code></dd></div>
        <div><dt>Proposed manifest</dt><dd><code>${escapeHtml(bundle.proposedManifestSha256)}</code></dd></div>
        <div><dt>Approval bundle</dt><dd><code>${escapeHtml(input.bundleSha256 ?? '')}</code></dd></div>
      </dl>`
    : '';
  const pairHashes = bundle
    ? `<ul>${Object.entries(bundle.pairCandidateHashes)
        .map(
          ([pairId, hash]) =>
            `<li><code>${escapeHtml(pairId)}</code> · pair candidate <code>${escapeHtml(hash)}</code> · source packet <code>${escapeHtml(bundle.source.pairSourceContextPacketSha256[pairId] ?? 'none')}</code></li>`
        )
        .join('')}</ul>`
    : '';
  const renders = bundle
    ? `<ul>${bundle.renders
        .map(
          (item) =>
            `<li><code>${escapeHtml(item.objectId)}</code> ${escapeHtml(item.format)}
              · <code>${escapeHtml(item.sha256)}</code>
              · <a href="/api/operator/approval/${escapeHtml(bundle.domain)}/bytes/${escapeHtml(item.sha256)}">${escapeHtml(item.path)}</a></li>`
        )
        .join('')}</ul>`
    : '';
  const issues =
    input.issues && input.issues.length > 0
      ? `<ul class="fail">${input.issues.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Domain ${escapeHtml(input.domain)} approval bundle</title>
  <style>
    :root { --ink:#16130f; --paper:#f3eee4; --muted:#5d5348; --brass:#8a6a3b; --line:rgba(22,19,15,.12); }
    body { margin:0; background:var(--paper); color:var(--ink); font: 18px/1.5 "Iowan Old Style", Palatino, Georgia, serif; }
    main { width:min(860px, calc(100% - 2rem)); margin:0 auto; padding:2.5rem 0 5rem; }
    .kicker { font: 700 0.72rem/1 ui-monospace, Menlo, monospace; letter-spacing:.16em; text-transform:uppercase; color:var(--brass); }
    h1 { font-weight:500; font-size:2.2rem; margin:.35rem 0 1rem; }
    .banner { padding:.8rem 1rem; border:1px solid var(--line); background:#fff8ea; margin:0 0 1.5rem; }
    a { color:var(--brass); }
    code { font-family: ui-monospace, Menlo, monospace; font-size:.78rem; word-break:break-all; }
    dt { font-size:.85rem; color:var(--muted); }
    dd { margin:0 0 .8rem; }
    .fail { color:#8a3b2a; }
    pre { overflow:auto; background:#fff; padding:1rem; border:1px solid var(--line); font-size:.78rem; }
  </style>
</head>
<body>
  <main>
    <p class="kicker">Immutable approval bundle · not APPROVED · not published</p>
    <h1>Domain ${escapeHtml(input.domain)} hash-bound preview</h1>
    <p class="banner">${
      ready
        ? 'These are the exact bytes and hashes publication would release. Operator approval and versioned publication stay closed.'
        : 'No current approval bundle is available. DRAFT documents can still show unresolved issues. This page does not grant APPROVED.'
    }</p>
    ${issues}
    ${
      input.domainCandidateHash
        ? `<p class="meta">Current domain candidate <code>${escapeHtml(input.domainCandidateHash)}</code></p>`
        : ''
    }
    ${hashes}
    ${pairHashes ? `<h2>Pair and source hashes</h2>${pairHashes}` : ''}
    ${renders ? `<h2>Rendered publication bytes</h2>${renders}` : ''}
    ${
      bundle
        ? `<h2>Proposed manifest</h2>
      <p>Kind <code>${escapeHtml(bundle.proposedManifest.manifest_kind)}</code> · approval <code>${escapeHtml(bundle.proposedManifest.external_approval.status)}</code></p>
      <pre>${escapeHtml(JSON.stringify(bundle.proposedManifest, null, 2))}</pre>`
        : ''
    }
    <p><a href="/documents/${escapeHtml(input.domain)}">DRAFT documents</a>
      · <a href="/?domain=${escapeHtml(input.domain)}">Operator board</a></p>
  </main>
</body>
</html>`;
}

export function approvalBytesResponse(
  payloads: Record<string, ApprovalBundlePayload>,
  sha256: string
): { contentType: string; utf8: string } | undefined {
  if (!/^[a-f0-9]{64}$/.test(sha256)) return undefined;
  const payload = payloads[sha256];
  if (!payload) return undefined;
  if (sha256Utf8(payload.utf8) !== sha256) return undefined;
  return payload;
}
