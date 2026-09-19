export const FIX_SAVE_CONTINUE = 'Fix, save and continue';
export const MAINTAINER_FIX_THIS = 'Maintainer, fix this';
export const PARK_FIX_LATER = 'Park, fix after the rest is ready';
export const DEFAULT_PARK_OWNER = 'EXPERT_REVIEW';
export const DEFAULT_PARK_REASON = 'This pair waits on an expert. Other pairs can continue.';

export type FindingActionStatus = 'OPEN' | 'FIXED' | 'PARKED';

export function escapeReviewHtml(value: string): string {
  return value
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;')
    .replace(/'/g, '&#39;');
}

export function parkReasonAndOwner(reason: string, owner: string): { reason: string; owner: string } {
  const trimmedReason = reason.trim();
  const trimmedOwner = owner.trim();
  return {
    reason: trimmedReason.length >= 5 ? trimmedReason : DEFAULT_PARK_REASON,
    owner: trimmedOwner || DEFAULT_PARK_OWNER
  };
}

export function findingActionStatus(input: {
  pairParked: boolean;
  disposition: string;
}): FindingActionStatus {
  if (input.pairParked) return 'PARKED';
  if (input.disposition === 'RESOLVED' || input.disposition === 'WAIVED' || input.disposition === 'ACCEPTED_RISK') {
    return 'FIXED';
  }
  return 'OPEN';
}

export function renderFindingStatus(input: {
  status: FindingActionStatus;
  parkReason?: string;
}): string {
  if (input.status === 'PARKED') {
    const reason = input.parkReason?.trim() || DEFAULT_PARK_REASON;
    return `<p class="status-pill parked" data-finding-status="PARKED">Parked</p>
        <p class="meta">This pair/object waits. It is not approved and the defect is not accepted.</p>
        <p class="meta">Why: ${escapeReviewHtml(reason)}</p>`;
  }
  if (input.status === 'FIXED') {
    return `<p class="status-pill fixed" data-finding-status="FIXED">Fixed</p>
        <p class="meta">Focused check passed. This finding is closed. VALIDATED, READY_FOR_APPROVAL, and publication still require complete schemas, locked vocabulary, identity, and no unresolved parked items.</p>`;
  }
  return `<p class="status-pill open" data-finding-status="OPEN">Needs action</p>
        <p class="meta">Fix it here, ask the Maintainer to fix it, or Park this pair with a reason. There is no separate Rejected/Resolved status to pick.</p>`;
}

export function renderFindingActionButtons(input: {
  defectId: string;
  pairId: string;
  commandsEnabled: boolean;
  status?: FindingActionStatus;
  parkReason?: string;
}): string {
  const status = input.status ?? 'OPEN';
  if (status === 'PARKED' || status === 'FIXED') return '';
  const disabled = input.commandsEnabled ? '' : ' disabled';
  const defectId = escapeReviewHtml(input.defectId);
  const pairId = escapeReviewHtml(input.pairId);
  const reason = escapeReviewHtml(input.parkReason?.trim() || DEFAULT_PARK_REASON);
  return `<div class="finding-actions">
        <button type="button" data-finding-action="fix" data-finding-id="${defectId}" data-pair-id="${pairId}"${disabled}>${FIX_SAVE_CONTINUE}</button>
        <button type="button" data-finding-action="maintainer" data-finding-id="${defectId}" data-pair-id="${pairId}"${disabled}>${MAINTAINER_FIX_THIS}</button>
        <button type="button" data-finding-action="park" data-finding-id="${defectId}" data-pair-id="${pairId}"${disabled}>${PARK_FIX_LATER}</button>
      </div>
      <p class="finding-signal" data-finding-signal="${defectId}" hidden></p>
      <div class="park-fields">
        <label class="field">Why this pair is parked
          <textarea class="rationale" data-park-reason-finding="${defectId}">${reason}</textarea>
        </label>
      </div>`;
}

export function reviewPageSharedStyles(): string {
  return `
    .finding-actions { display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; margin-top:1rem; }
    .park-fields { margin-top:.6rem; }
    #review-issues { display:none; }
    #review-issues.is-visible { display:block; }
    button[disabled] { opacity:.5; cursor:not-allowed; }
    .status-pill { display:inline-block; font: 700 0.72rem/1 ui-monospace, Menlo, monospace; letter-spacing:.14em; text-transform:uppercase; margin:.6rem 0; border:1px solid var(--line); border-radius:999px; padding:.28rem .75rem; }
    .status-pill.open { color:var(--brass); border-color:var(--brass); }
    .status-pill.fixed { color:#8fb58a; border-color:#8fb58a; }
    .status-pill.parked { color:var(--brass); border-color:var(--brass); }
    .finding-signal { color:var(--fail); display:none; }
    .finding-signal.is-visible { display:block; }
    .defect.is-parked { border-color: var(--brass); }
`;
}

export function renderReviewClientScript(kind: 'pair' | 'domain'): string {
  const stayOnDomain = kind === 'domain';
  return `<script>
  (function () {
    var form = document.getElementById('${kind}-review-form');
    if (!form) return;
    var issuesEl = document.getElementById('review-issues');
    var defaultParkReason = ${JSON.stringify(DEFAULT_PARK_REASON)};
    var defaultParkOwner = ${JSON.stringify(DEFAULT_PARK_OWNER)};

    function showIssues(issues, findingId) {
      var list = Array.isArray(issues) ? issues.filter(Boolean) : [];
      if (issuesEl) {
        issuesEl.replaceChildren();
        if (!list.length) {
          issuesEl.classList.remove('is-visible');
          issuesEl.hidden = true;
        } else {
          list.forEach(function (issue) {
            var p = document.createElement('p');
            p.textContent = String(issue);
            issuesEl.appendChild(p);
          });
          issuesEl.hidden = false;
          issuesEl.classList.add('is-visible');
        }
      }
      if (findingId) {
        var signal = form.querySelector('[data-finding-signal="' + findingId + '"]');
        if (signal) {
          signal.hidden = list.length === 0;
          signal.classList.toggle('is-visible', list.length > 0);
          signal.textContent = list.join(' ');
          if (list.length) signal.scrollIntoView({ block: 'nearest' });
        }
      } else if (issuesEl && list.length) {
        issuesEl.scrollIntoView({ block: 'nearest' });
      }
    }

    function patchFromArea(area) {
      var path = area.getAttribute('data-path');
      if (!path) return { error: 'Missing path.' };
      var pairId = area.getAttribute('data-pair-id') || (form.querySelector('[name="pairId"]') || {}).value;
      var raw = String(area.value || '').trim();
      if (!raw) return { patch: null };
      try {
        var value = JSON.parse(raw);
        var patch = pairId ? { pairId: pairId, path: path, value: value } : { path: path, value: value };
        return { patch: patch };
      } catch (error) {
        return { error: 'Content at ' + path + ' is not valid JSON. Keep IDs and sections machine-readable.' };
      }
    }

    function collectPatches(findingId) {
      var patches = [];
      var areas = findingId
        ? form.querySelectorAll('textarea[data-path][name="content:' + findingId + '"]')
        : form.querySelectorAll('textarea[data-path]');
      var invalid = '';
      areas.forEach(function (area) {
        var parsed = patchFromArea(area);
        if (parsed.error) invalid = parsed.error;
        else if (parsed.patch) patches.push(parsed.patch);
      });
      return { patches: patches, invalid: invalid };
    }

    function post(body, onOk, findingId) {
      fetch('/api/operator/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (payload) {
          var issues = payload.gateIssues || [];
          var parked = payload.state === 'DEFERRED' || payload.status === 'PARKED';
          if (!res.ok || payload.persisted === false) {
            var listed = issues.length ? issues : [payload.error || 'The action did not complete. Park remains available.'];
            showIssues(listed, findingId);
            return;
          }
          onOk(payload, parked);
        });
      }).catch(function () {
        showIssues(['Save failed. Stay on this finding; Park remains available.'], findingId);
      });
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var collected = collectPatches('');
      if (collected.invalid) {
        showIssues([collected.invalid]);
        return;
      }
      var body = {
        domain: form.querySelector('[name="domain"]').value,
        action: form.querySelector('[name="action"]').value,
        expectedCandidateHash: form.querySelector('[name="expectedCandidateHash"]').value,
        findingAction: 'fix',
        patches: collected.patches
      };
      var pairField = form.querySelector('[name="pairId"]');
      if (pairField) body.pairId = pairField.value;
      post(body, function (payload) {
        var domain = body.domain;
        var pairId = body.pairId;
        var notice = payload.passed
          ? 'Fixed. Focused check passed. Remaining open findings still need Fix, Maintainer, or Park.'
          : 'Saved. Focused check passed for the touched section. Remaining findings stay open until they are fixed or parked.';
        var url = ${stayOnDomain ? `'/review/' + encodeURIComponent(domain) + '?notice=' + encodeURIComponent(notice)` : `'/review/' + encodeURIComponent(domain) + '/' + encodeURIComponent(pairId) + '?notice=' + encodeURIComponent(notice)`};
        window.location.assign(url);
      });
    });

    form.addEventListener('click', function (event) {
      var button = event.target.closest('[data-finding-action]');
      if (!button || button.disabled) return;
      event.preventDefault();
      var action = button.getAttribute('data-finding-action');
      var findingId = button.getAttribute('data-finding-id');
      var pairId = button.getAttribute('data-pair-id') || (form.querySelector('[name="pairId"]') || {}).value;
      var domain = form.querySelector('[name="domain"]').value;
      if (!findingId) return;

      if (action === 'fix') {
        var collected = collectPatches(findingId);
        if (collected.invalid) {
          showIssues([collected.invalid], findingId);
          return;
        }
        var body = {
          domain: domain,
          pairId: pairId,
          action: form.querySelector('[name="action"]').value,
          expectedCandidateHash: form.querySelector('[name="expectedCandidateHash"]').value,
          findingId: findingId,
          findingAction: 'fix',
          patches: collected.patches
        };
        post(body, function (payload) {
          var notice = payload.passed
            ? 'Fixed ' + findingId + '. Focused check passed. Status: Fixed. Continue with remaining findings, or Park a pair that must wait.'
            : 'Focused check passed for the touched section. Remaining HIGH findings stay open. Park remains available.';
          var url = ${stayOnDomain ? `'/review/' + encodeURIComponent(domain) + '?notice=' + encodeURIComponent(notice)` : `'/review/' + encodeURIComponent(domain) + '/' + encodeURIComponent(pairId) + '?notice=' + encodeURIComponent(notice)`};
          window.location.assign(url);
        }, findingId);
        return;
      }

      if (action === 'maintainer') {
        post({
          domain: domain,
          pairId: pairId,
          action: 'maintainer-fix-finding',
          findingId: findingId
        }, function (payload) {
          var notice = payload.coercedPaths && payload.coercedPaths.length
            ? 'Maintainer fix started on ' + findingId + '. Illegal minimumTechnicalAssurance was coerced to UNKNOWN. Status: Needs action until the focused check passes, or Park it.'
            : 'Maintainer is fixing ' + findingId + '. Status: Needs action until that fix passes the focused check, or Park it.';
          var url = ${stayOnDomain ? `'/review/' + encodeURIComponent(domain) + '?notice=' + encodeURIComponent(notice)` : `'/review/' + encodeURIComponent(domain) + '/' + encodeURIComponent(pairId) + '?notice=' + encodeURIComponent(notice)`};
          window.location.assign(url);
        }, findingId);
        return;
      }

      if (action === 'park') {
        if (!pairId) {
          showIssues(['This finding has no pair to park.'], findingId);
          return;
        }
        var reasonArea = form.querySelector('[data-park-reason-finding="' + findingId + '"]');
        var reason = reasonArea ? String(reasonArea.value || '').trim() : '';
        if (!reason) reason = defaultParkReason;
        post({
          domain: domain,
          pairId: pairId,
          action: 'finalize-later',
          owner: defaultParkOwner,
          reason: reason,
          findingId: findingId
        }, function (payload) {
          var parkedReason = payload.reason || reason;
          if (payload.domainReady) {
            window.location.assign('/?domain=' + encodeURIComponent(domain) + '&notice=' + encodeURIComponent(
              'Parked ' + pairId + '. Status: Parked. Why: ' + parkedReason + '. Remaining HIGH defects are parked. Domain is READY_FOR_APPROVAL. Finalize ready documents for VALIDATED pairs. Parked pairs stay parked for later.'
            ));
            return;
          }
          var notice = 'Parked ' + pairId + '. Status: Parked. Why: ' + parkedReason + '. Remaining pairs can continue. Finalize ready documents for VALIDATED pairs. This pair stays parked for later.';
          var url = ${stayOnDomain ? `'/review/' + encodeURIComponent(domain) + '?notice=' + encodeURIComponent(notice)` : `'/review/' + encodeURIComponent(domain) + '/' + encodeURIComponent(pairId) + '?notice=' + encodeURIComponent(notice)`};
          window.location.assign(url);
        }, findingId);
      }
    });
  })();
  </script>`;
}
