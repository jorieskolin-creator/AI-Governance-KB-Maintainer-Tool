export const FIX_SAVE_CONTINUE = 'Fix, save and continue';
export const MAINTAINER_FIX_THIS = 'Maintainer, fix this';
export const PARK_FIX_LATER = 'Park, fix after the rest is ready';

export function escapeReviewHtml(value: string): string {
  return value
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;')
    .replace(/'/g, '&#39;');
}

export function renderDispositionSelect(input: {
  defectId: string;
  severity: string;
  disposition: string;
}): string {
  const waivable = input.severity !== 'BLOCKING';
  const selected = input.disposition;
  const accepted = selected === 'ACCEPTED_RISK';
  return `<label class="field">Disposition for this revision
          <select data-disposition-finding="${escapeReviewHtml(input.defectId)}" name="disposition:${escapeReviewHtml(input.defectId)}">
            <option value="OPEN"${selected === 'OPEN' ? ' selected' : ''}>OPEN — still a finding on this revision</option>
            <option value="RESOLVED"${selected === 'RESOLVED' ? ' selected' : ''}>RESOLVED</option>
            ${
              waivable
                ? `<option value="WAIVED"${selected === 'WAIVED' ? ' selected' : ''}>WAIVED</option>`
                : ''
            }
            <option value="REJECTED"${selected === 'REJECTED' ? ' selected' : ''}>REJECTED — remains open</option>
          </select>
        </label>
        ${
          waivable
            ? `<details class="residual"${accepted ? ' open' : ''}>
          <summary>Ship with residual risk (rare)</summary>
          <p class="meta">ACCEPTED_RISK means this document may ship with that residual after a passing focused check. It is not a defer and cannot waive locked vocabulary, IDs, hashes, or publication. Park this pair if it must wait.</p>
          <label class="field"><input type="checkbox" data-accepted-risk-finding="${escapeReviewHtml(input.defectId)}"${accepted ? ' checked' : ''}> Mark ACCEPTED_RISK</label>
        </details>`
            : ''
        }`;
}

export function renderFindingActionButtons(input: {
  defectId: string;
  pairId: string;
  commandsEnabled: boolean;
}): string {
  const disabled = input.commandsEnabled ? '' : ' disabled';
  const defectId = escapeReviewHtml(input.defectId);
  const pairId = escapeReviewHtml(input.pairId);
  return `<div class="finding-actions">
        <button type="button" data-finding-action="fix" data-finding-id="${defectId}" data-pair-id="${pairId}"${disabled}>${FIX_SAVE_CONTINUE}</button>
        <button type="button" data-finding-action="maintainer" data-finding-id="${defectId}" data-pair-id="${pairId}"${disabled}>${MAINTAINER_FIX_THIS}</button>
        <button type="button" data-finding-action="park" data-finding-id="${defectId}" data-pair-id="${pairId}"${disabled}>${PARK_FIX_LATER}</button>
      </div>
      <div class="park-fields">
        <label class="field">Park owner / category
          <input type="text" data-park-owner-finding="${defectId}" placeholder="EXPERT_REVIEW">
        </label>
        <label class="field">Park reason
          <textarea class="rationale" data-park-reason-finding="${defectId}" placeholder="This pair waits on an expert. Other pairs can continue."></textarea>
        </label>
        <p class="meta">Park means this pair/object waits. It does not accept the defect. ACCEPTED_RISK is a rarer act after a passing focused check.</p>
      </div>`;
}

export function reviewPageSharedStyles(): string {
  return `
    .finding-actions { display:flex; gap:.6rem; align-items:center; flex-wrap:wrap; margin-top:1rem; }
    .park-fields { margin-top:.6rem; }
    details.residual { margin:.8rem 0; color:var(--subtle); }
    #review-issues { display:none; }
    #review-issues.is-visible { display:block; }
    button[disabled] { opacity:.5; cursor:not-allowed; }
`;
}

export function renderReviewClientScript(kind: 'pair' | 'domain'): string {
  const stayOnDomain = kind === 'domain';
  return `<script>
  (function () {
    var form = document.getElementById('${kind}-review-form');
    if (!form) return;
    var issuesEl = document.getElementById('review-issues');

    function showIssues(issues) {
      if (!issuesEl) return;
      issuesEl.replaceChildren();
      var list = Array.isArray(issues) ? issues.filter(Boolean) : [];
      if (!list.length) {
        issuesEl.classList.remove('is-visible');
        issuesEl.hidden = true;
        return;
      }
      list.forEach(function (issue) {
        var p = document.createElement('p');
        p.textContent = String(issue);
        issuesEl.appendChild(p);
      });
      issuesEl.hidden = false;
      issuesEl.classList.add('is-visible');
      issuesEl.scrollIntoView({ block: 'nearest' });
    }

    function readRationale(findingId) {
      var area = form.querySelector('textarea[data-rationale-finding="' + findingId + '"]');
      return area ? String(area.value || '') : '';
    }

    function dispositionFor(findingId, closingDefault) {
      var accepted = form.querySelector('input[data-accepted-risk-finding="' + findingId + '"]');
      if (accepted && accepted.checked) {
        return { findingId: findingId, disposition: 'ACCEPTED_RISK', authority: 'OPERATOR', rationale: readRationale(findingId) };
      }
      var select = form.querySelector('select[data-disposition-finding="' + findingId + '"]');
      var disposition = select ? select.value : 'OPEN';
      if (disposition === 'OPEN' && closingDefault) disposition = closingDefault;
      if (!findingId || disposition === 'OPEN') return null;
      return { findingId: findingId, disposition: disposition, authority: 'OPERATOR', rationale: readRationale(findingId) };
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

    function collectDispositions(findingId, closingDefault) {
      if (findingId) {
        var one = dispositionFor(findingId, closingDefault);
        return one ? [one] : [];
      }
      var dispositions = [];
      form.querySelectorAll('select[data-disposition-finding]').forEach(function (select) {
        var id = select.getAttribute('data-disposition-finding');
        var item = dispositionFor(id, '');
        if (item) dispositions.push(item);
      });
      return dispositions;
    }

    function post(body, onOk) {
      fetch('/api/operator/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (payload) {
          var issues = payload.gateIssues || [];
          if (!res.ok || payload.persisted === false) {
            var listed = issues.length ? issues : [payload.error || 'Focused check rejected the save. Park remains available.'];
            showIssues(listed);
            return;
          }
          onOk(payload);
        });
      }).catch(function () {
        showIssues(['Save failed. Stay on this finding; Park remains available.']);
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
        findingDispositions: collectDispositions('', ''),
        patches: collected.patches
      };
      var pairField = form.querySelector('[name="pairId"]');
      if (pairField) body.pairId = pairField.value;
      post(body, function (payload) {
        var domain = body.domain;
        var pairId = body.pairId;
        var notice = payload.pairValidated === false && payload.passed
          ? 'Human saved. Focused section check passed. VALIDATED and publication still require complete schemas, locked vocabulary, identity, and no unresolved parked items.'
          : payload.passed
            ? 'Human saved. Focused section check passed. Recorded dispositions are bound to this candidate revision.'
            : 'Human saved the edits. Focused section check passed. Open HIGH blockers still remain.';
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
          showIssues([collected.invalid]);
          return;
        }
        var body = {
          domain: domain,
          pairId: pairId,
          action: form.querySelector('[name="action"]').value,
          expectedCandidateHash: form.querySelector('[name="expectedCandidateHash"]').value,
          findingId: findingId,
          findingAction: 'fix',
          findingDispositions: collectDispositions(findingId, 'RESOLVED'),
          patches: collected.patches
        };
        post(body, function (payload) {
          var notice = payload.passed
            ? 'Focused check passed for this finding. Continue with remaining findings, or Park a pair that must wait.'
            : 'Focused check passed for the touched section. Open HIGH blockers still remain. Park remains available.';
          var url = ${stayOnDomain ? `'/review/' + encodeURIComponent(domain) + '?notice=' + encodeURIComponent(notice)` : `'/review/' + encodeURIComponent(domain) + '/' + encodeURIComponent(pairId) + '?notice=' + encodeURIComponent(notice)`};
          window.location.assign(url);
        });
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
            ? 'Maintainer fix: illegal minimumTechnicalAssurance was coerced to UNKNOWN. The finding stays open. Park remains available.'
            : 'Maintainer is fixing this finding. Stay on this defect until the focused check passes, or Park it.';
          var url = ${stayOnDomain ? `'/review/' + encodeURIComponent(domain) + '?notice=' + encodeURIComponent(notice)` : `'/review/' + encodeURIComponent(domain) + '/' + encodeURIComponent(pairId) + '?notice=' + encodeURIComponent(notice)`};
          window.location.assign(url);
        });
        return;
      }

      if (action === 'park') {
        if (!pairId) {
          showIssues(['This finding has no pair to park.']);
          return;
        }
        var ownerInput = form.querySelector('[data-park-owner-finding="' + findingId + '"]');
        var reasonArea = form.querySelector('[data-park-reason-finding="' + findingId + '"]');
        var owner = ownerInput ? String(ownerInput.value || '').trim() : '';
        var reason = reasonArea ? String(reasonArea.value || '').trim() : '';
        if (!owner) owner = 'EXPERT_REVIEW';
        if (reason.length < 5) {
          showIssues(['Park needs a reason of at least 5 characters. This parks the pair/object; it does not accept the defect.']);
          return;
        }
        post({
          domain: domain,
          pairId: pairId,
          action: 'finalize-later',
          owner: owner,
          reason: reason,
          findingId: findingId
        }, function () {
          var notice = 'Parked ' + pairId + '. That pair waits; remaining pairs can continue. Approval stays fail-closed until it is resolved.';
          var url = ${stayOnDomain ? `'/review/' + encodeURIComponent(domain) + '?notice=' + encodeURIComponent(notice)` : `'/?domain=' + encodeURIComponent(domain) + '&notice=' + encodeURIComponent(notice)`};
          window.location.assign(url);
        });
      }
    });
  })();
  </script>`;
}
