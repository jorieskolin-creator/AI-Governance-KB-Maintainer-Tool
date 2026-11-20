import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCreatorApp } from '../../src/document-creator/app.js';
import { parseStandaloneDeliveredMarkdown } from '../../src/document-creator/handoff-reader.js';
import { createSaePilotReferenceAuthorPort } from '../../src/document-creator/pilot-reference.js';
import { buildSaeLocalPilotProfile } from '../../src/document-creator/profiles.js';
import type { FetchResponseLike, HttpFetchPort } from '../../src/document-creator/sources.js';
import { InMemoryCreatorRunStore } from '../../src/document-creator/store.js';
import { readZipArchive } from '../../src/document-creator/zip-export.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function sha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildTestTextPdf(pageLinesArray: string[][]): Buffer {
  const objects: Array<{ num: number; body: string; streamBytes: Buffer | null }> = [];
  const addObj = (body: string, streamBytes: Buffer | null = null): number => {
    const num = objects.length + 1;
    objects.push({ num, body, streamBytes });
    return num;
  };

  const fontNum = addObj(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );
  const pageNums: number[] = [];

  for (const lines of pageLinesArray) {
    let y = 740;
    const ops = ['BT', '/F1 11 Tf'];
    for (const line of lines) {
      const escaped = line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
      ops.push(`1 0 0 1 50 ${y} Tm (${escaped}) Tj`);
      y -= 18;
    }
    ops.push('ET');
    const compressed = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
    const contentNum = addObj(
      `<< /Length ${compressed.length} /Filter /FlateDecode >>`,
      compressed
    );
    const pageNum = addObj(
      `<< /Type /Page /Parent PAGES_REF 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
    );
    pageNums.push(pageNum);
  }

  const pagesNum = addObj(
    `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`
  );
  const catalogNum = addObj(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  for (const obj of objects) {
    const dict = obj.body.replaceAll('PAGES_REF', String(pagesNum));
    chunks.push(Buffer.from(`${obj.num} 0 obj\n${dict}\n`, 'latin1'));
    if (obj.streamBytes) {
      chunks.push(Buffer.from('stream\n', 'latin1'));
      chunks.push(obj.streamBytes);
      chunks.push(Buffer.from('\nendstream\n', 'latin1'));
    }
    chunks.push(Buffer.from('endobj\n', 'latin1'));
  }
  chunks.push(Buffer.from(`trailer\n<< /Root ${catalogNum} 0 R >>\n%%EOF\n`, 'latin1'));
  return Buffer.concat(chunks);
}

function mockHtmlResponse(
  status: number,
  body: string,
  headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }
): FetchResponseLike {
  const bytes = Buffer.from(body, 'utf8');
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    status,
    headers: {
      get(name: string) {
        return lowerHeaders[name.toLowerCase()] ?? null;
      }
    },
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
    body: {
      async *[Symbol.asyncIterator]() {
        yield bytes;
      }
    }
  };
}

async function createInteractiveSandbox() {
  const workspace = await mkdtemp(join(tmpdir(), 'dc08-interactive-'));
  tempDirs.push(workspace);

  const profile = await buildSaeLocalPilotProfile(process.cwd());
  for (const ref of profile.input_refs) {
    const dest = join(workspace, ref.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(ref.path, dest);
  }
  await copyFile(
    'baseline/sae-training/input-inventory.json',
    join(workspace, 'baseline/sae-training/input-inventory.json')
  );
  await mkdir(join(workspace, profile.source_policy.references_subdir), { recursive: true });
  await mkdir(join(workspace, profile.storage_ref.output_root), { recursive: true });
  await mkdir(join(workspace, 'custom-storage-out'), { recursive: true });

  const pages: string[][] = Array.from({ length: 37 }, (_, i) => [
    `NIST AI 100-1 AI RMF 1.0 Page ${i + 1}`
  ]);
  pages[30] = [
    'MAP 1.3: Organization mission and AI goals are understood.',
    'MAP 1.4: Business value or context of business use has been clearly defined.'
  ];
  pages[31] = [
    'MAP 3.1: Potential benefits of intended AI functionality are examined.',
    'MAP 3.2: Potential costs of AI errors are examined against benchmarks.'
  ];
  pages[36] = [
    'MANAGE 1.1: Determination is made whether the AI system achieves its stated objectives.',
    'MANAGE 2.1: Viable non-AI alternative systems are taken into account.',
    'MANAGE 2.4: Mechanisms are in place to supersede, disengage, or deactivate AI systems.'
  ];

  const nistPdf = buildTestTextPdf(pages);
  const nistRelPath = 'baseline/sae-training/references/NIST_AI_RMF_1.0.pdf';
  await writeFile(join(workspace, nistRelPath), nistPdf);

  profile.reference_pdf_bindings = [
    {
      source_id: 'SRC-NIST-AI-RMF',
      edition_version: 'NIST AI 100-1, January 2023',
      path: nistRelPath,
      sha256: sha256(nistPdf),
      usage_policy: 'PERMITTED_ATTRIBUTED_EXCERPT',
      rights_confirmed_for_model: true,
      provenance: 'Pinned local test PDF in references/'
    }
  ];

  const mockFetch: HttpFetchPort = async (url) => {
    if (url.includes('finlex.fi/fi/lainsaadanto/2003/434')) {
      return mockHtmlResponse(
        200,
        '<html><body><h2>434/2003 — Hallintolaki</h2><p>Automated administrative decision-making requires defined rules and human accountability.</p></body></html>'
      );
    }
    if (url.includes('oecd.org')) {
      return mockHtmlResponse(
        200,
        '<html><body><h2>OECD AI Principles</h2><p>Human-centered values and accountability.</p></body></html>'
      );
    }
    return mockHtmlResponse(404, 'Not found');
  };

  return { workspace, profile, mockFetch };
}

describe('DC-08: White-background UI, default last-run status vs two-mode reset, .md manual edit/approve, review cadences, and .zip export', () => {
  it('Enforces pure white background (#ffffff), supports browser session cookie login, starts empty when zero runs exist, defaults to last-run status after work starts, and resets back to zero on Reset', async () => {
    const { workspace, profile, mockFetch } = await createInteractiveSandbox();
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc08-interactive-token';

    const app = await buildCreatorApp({
      workspaceRoot: workspace,
      operatorToken: authToken,
      profiles: [profile],
      runStore,
      fetchPort: mockFetch,
      allowLiveSourceFetch: true,
      authorProviderPort: createSaePilotReferenceAuthorPort()
    });

    // 1. Browser login page has white background and sets HttpOnly creator_session cookie on valid token.
    const loginPage = await app.inject({
      method: 'GET',
      url: '/creator/login'
    });
    expect(loginPage.statusCode).toBe(200);
    expect(loginPage.body).toContain('background: #ffffff;');
    expect(loginPage.body).not.toContain('#f9fafb');
    expect(loginPage.body).not.toContain('#f3f4f6');

    const loginPost = await app.inject({
      method: 'POST',
      url: '/creator/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `token=${encodeURIComponent(authToken)}`
    });
    expect(loginPost.statusCode).toBe(302);
    const setCookie = String(loginPost.headers['set-cookie'] ?? '');
    expect(setCookie).toContain('creator_session=');
    expect(setCookie).toContain('HttpOnly');
    const cookieHeader = setCookie.split(';')[0]!;

    // 2. Initial open with zero runs starts in EMPTY_SETUP mode ("Start from Zero").
    const initialOpen = await app.inject({
      method: 'GET',
      url: '/creator',
      headers: { cookie: cookieHeader }
    });
    expect(initialOpen.statusCode).toBe(200);
    expect(initialOpen.body).toContain('background: #ffffff;');
    expect(initialOpen.body).not.toContain('#f9fafb');
    expect(initialOpen.body).toContain('Empty Setup (Starting from Zero)');
    expect(initialOpen.body).toContain(
      'Start from Zero — Configure Input Materials, Storage &amp; Review Mode'
    );

    // 3. Author a pair (PAIR-A2) via UI form POST -> now opening /creator or /creator/documents defaults to LAST_RUN_STATUS!
    const authorFormRes = await app.inject({
      method: 'POST',
      url: '/creator/documents/author',
      headers: {
        cookie: cookieHeader,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload:
        'profileId=sae-local-pilot&pairId=PAIR-A2&reviewCadence=PAUSE_AFTER_PAIR&deliveryMode=ZIP'
    });
    expect(authorFormRes.statusCode).toBe(200);
    expect(authorFormRes.body).toContain('Last Run Status (PAIR-A2 · REVIEW_REQUIRED)');
    expect(authorFormRes.body).toContain('3. Review after each pair');
    expect(authorFormRes.body).toContain('Local .zip archive');
    expect(authorFormRes.body).toContain('Approve &amp; Generate .zip');
    expect(authorFormRes.body).toContain('Create new (Re-generate pair)');
    expect(authorFormRes.body).toContain('Save manual .md edit (A2)');

    // Re-opening /creator without query params shows Last Run Status banner to continue/review latest documents!
    const reopenHome = await app.inject({
      method: 'GET',
      url: '/creator',
      headers: { cookie: cookieHeader }
    });
    expect(reopenHome.statusCode).toBe(200);
    expect(reopenHome.body).toContain('Last Run Status — Ready to Resume or Review');
    expect(reopenHome.body).toContain('Continue / Review Latest .md Documents');

    // 4. Clicking Reset (POST /creator/reset) cancels the active un-delivered draft run, clears UI items, and returns to EMPTY_SETUP!
    const resetRes = await app.inject({
      method: 'POST',
      url: '/creator/reset',
      headers: { cookie: cookieHeader }
    });
    expect(resetRes.statusCode).toBe(302);

    const afterResetHome = await app.inject({
      method: 'GET',
      url: '/creator',
      headers: { cookie: cookieHeader }
    });
    expect(afterResetHome.statusCode).toBe(200);
    expect(afterResetHome.body).toContain('Empty Setup (Starting from Zero)');
    expect(afterResetHome.body).toContain(
      'Start from Zero — Configure Input Materials, Storage &amp; Review Mode'
    );

    const afterResetDocs = await app.inject({
      method: 'GET',
      url: '/creator/documents',
      headers: { cookie: cookieHeader }
    });
    expect(afterResetDocs.statusCode).toBe(200);
    expect(afterResetDocs.body).toContain(
      'No draft authored in this session for the selected pair yet.'
    );

    // 5. Register custom input-inventory and storage output root via POST /api/creator/setup!
    const setupRes = await app.inject({
      method: 'POST',
      url: '/api/creator/setup',
      headers: { cookie: cookieHeader },
      payload: {
        customProfileId: 'custom-sae-workspace',
        inventoryPath: 'baseline/sae-training/input-inventory.json',
        outputRoot: 'custom-storage-out',
        reviewCadence: 'FINAL_REVIEW_ONLY',
        deliveryMode: 'STORAGE'
      }
    });
    expect(setupRes.statusCode).toBe(200);
    const setupBody = setupRes.json();
    expect(setupBody.profile_id).toBe('custom-sae-workspace');
    expect(setupBody.inputSet.storage.output_root).toBe('custom-storage-out');
    expect(setupBody.workspace.review_cadence).toBe('FINAL_REVIEW_ONLY');
    expect(setupBody.workspace.delivery_mode).toBe('STORAGE');

    await app.close();
  });

  it('Supports .md manual editing with validation and R-03 sign-off invalidation, and generates a verified .zip archive on Approve when deliveryMode=ZIP or stores to KB Storage when deliveryMode=STORAGE', async () => {
    const { workspace, profile, mockFetch } = await createInteractiveSandbox();
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc08-md-zip-token';
    const headers = { authorization: `Bearer ${authToken}` };

    const app = await buildCreatorApp({
      workspaceRoot: workspace,
      operatorToken: authToken,
      profiles: [profile],
      runStore,
      fetchPort: mockFetch,
      allowLiveSourceFetch: true,
      authorProviderPort: createSaePilotReferenceAuthorPort()
    });

    // 1. Author PAIR-A2
    const authorRes = await app.inject({
      method: 'POST',
      url: '/api/creator/documents/author',
      headers,
      payload: {
        profileId: 'sae-local-pilot',
        pairId: 'PAIR-A2',
        documentVersion: '1.0.0',
        enableUrlAcquisition: true,
        autoRunSemanticReview: true
      }
    });
    expect(authorRes.statusCode).toBe(200);
    const runId = authorRes.json().run.run_id as string;
    const originalA2Md = authorRes.json().authoredPair.rendered.capability.markdown as string;

    // 2. Edit A2.md manually via POST /api/creator/runs/:runId/edit-markdown
    const editedA2Md = originalA2Md.replace(
      '## A2.DEF — Identity, definition, purpose, and scope\n\n',
      '## A2.DEF — Identity, definition, purpose, and scope\n\n[Operator Manual .md Edit] '
    );
    const editRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${encodeURIComponent(runId)}/edit-markdown`,
      headers,
      payload: {
        objectId: 'A2',
        editedMarkdown: editedA2Md
      }
    });
    expect(editRes.statusCode).toBe(200);
    const editedRun = editRes.json().run;
    expect(editedRun.checkpoints.active_capability_revision_id).toContain(':A2:r2');
    expect(editedRun.checkpoints.latest_diffs.capability.changed_section_ids).toEqual([
      'A2.DEF'
    ]);
    expect(editedRun.checkpoints.latest_diffs.capability.unchanged_section_ids).toHaveLength(9);
    expect(editRes.json().authoredPair.rendered.capability.markdown).toContain(
      '[Operator Manual .md Edit]'
    );

    // Reject manual .md edit that removes a required section heading!
    const brokenMd = editedA2Md.replace(
      '## A2.DEF — Identity, definition, purpose, and scope',
      '## UNKNOWN_HEADING'
    );
    const badEditRes = await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${encodeURIComponent(runId)}/edit-markdown`,
      headers,
      payload: {
        objectId: 'A2',
        editedMarkdown: brokenMd
      }
    });
    expect(badEditRes.statusCode).toBe(422);
    expect(badEditRes.json().error).toBe('MARKDOWN_EDIT_INVALID');

    // 3. Re-run semantic review on r2, then click Approve with deliveryMode=ZIP -> returns valid .zip archive!
    await app.inject({
      method: 'POST',
      url: `/api/creator/runs/${encodeURIComponent(runId)}/review`,
      headers
    });

    const approveZipRes = await app.inject({
      method: 'POST',
      url: '/creator/documents/approve',
      headers: {
        ...headers,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: `runId=${encodeURIComponent(runId)}&profileId=sae-local-pilot&pairId=PAIR-A2&deliveryMode=ZIP&reviewedBy=jori.eskolin%40sujuva.co.site&targetVersion=1.0.0`
    });
    expect(approveZipRes.statusCode).toBe(200);
    expect(approveZipRes.headers['content-type']).toBe('application/zip');
    expect(approveZipRes.headers['content-disposition']).toContain(
      'PAIR-A2-markdown-documents.zip'
    );

    // Decode and verify the .zip buffer!
    const zipEntries = readZipArchive(approveZipRes.rawPayload);
    expect(zipEntries.map((e) => e.path)).toEqual([
      'A/capabilities/A2/1.0.0/document.md',
      'A/antipatterns/AP-A2/1.0.0/document.md',
      '_operations/zip-export-manifest.json'
    ]);

    const zippedA2 = parseStandaloneDeliveredMarkdown(zipEntries[0]!.text);
    expect(zippedA2.front_matter.creation_review_state).toBe('READY_TO_DELIVER');
    expect(zippedA2.sections[0]?.prose).toContain('[Operator Manual .md Edit]');

    // Because deliveryMode was ZIP, KB storage directory in sandbox is still empty!
    expect(await readdir(join(workspace, profile.storage_ref.output_root))).toEqual([]);

    // 4. Now click Approve with deliveryMode=STORAGE -> stores the reviewed .md files + completion receipt to KB storage!
    const approveStorageRes = await app.inject({
      method: 'POST',
      url: '/creator/documents/approve',
      headers: {
        ...headers,
        'content-type': 'application/x-www-form-urlencoded'
      },
      payload: `runId=${encodeURIComponent(runId)}&profileId=sae-local-pilot&pairId=PAIR-A2&deliveryMode=STORAGE&reviewedBy=jori.eskolin%40sujuva.co.site&targetVersion=1.0.0`
    });
    expect(approveStorageRes.statusCode).toBe(302);
    expect(approveStorageRes.headers.location).toContain('/creator/delivery');

    const storedA2Disk = await readFile(
      join(workspace, profile.storage_ref.output_root, 'A/capabilities/A2/1.0.0/document.md'),
      'utf8'
    );
    expect(storedA2Disk).toContain('[Operator Manual .md Edit]');
    expect(storedA2Disk).toContain('creation_review_state: "READY_TO_DELIVER"');

    await app.close();
  });

  it('Executes all 3 review cadences (PAUSE_AFTER_PAIR, PAUSE_AFTER_DOMAIN, FINAL_REVIEW_ONLY) with full automated validation and semantic QC', async () => {
    const { workspace, profile, mockFetch } = await createInteractiveSandbox();
    const runStore = new InMemoryCreatorRunStore();
    const authToken = 'dc08-cadence-token';
    const headers = { authorization: `Bearer ${authToken}` };

    const app = await buildCreatorApp({
      workspaceRoot: workspace,
      operatorToken: authToken,
      profiles: [profile],
      runStore,
      fetchPort: mockFetch,
      allowLiveSourceFetch: true,
      authorProviderPort: createSaePilotReferenceAuthorPort()
    });

    // 1. PAUSE_AFTER_PAIR on [PAIR-A2, PAIR-A3] -> authors only PAIR-A2, runs semantic QC, and pauses with remaining_pair_ids=['PAIR-A3']
    const pausePairRes = await app.inject({
      method: 'POST',
      url: '/api/creator/batches/execute',
      headers,
      payload: {
        profileId: 'sae-local-pilot',
        selection: {
          mode: 'pair',
          pair_ids: ['PAIR-A2', 'PAIR-A3'],
          include_tactics: false
        },
        reviewCadence: 'PAUSE_AFTER_PAIR',
        deliveryMode: 'STORAGE',
        enableUrlAcquisition: true
      }
    });
    expect(pausePairRes.statusCode).toBe(200);
    const pausePairBatch = pausePairRes.json().batch;
    expect(pausePairBatch.review_cadence).toBe('PAUSE_AFTER_PAIR');
    expect(pausePairBatch.review_checkpoint).toBe('AWAITING_PAIR_REVIEW');
    expect(pausePairBatch.paused_after_pair_id).toBe('PAIR-A2');
    expect(pausePairBatch.remaining_pair_ids).toEqual(['PAIR-A3']);
    expect(pausePairBatch.summary.requested_documents).toBe(2);

    // Confirm automated semantic QC ran during the batch!
    const pairRun = await runStore.getRun(pausePairBatch.pair_run_ids[0]);
    expect(pairRun?.checkpoints.latest_semantic_review).not.toBeNull();

    // 2. FINAL_REVIEW_ONLY on [PAIR-A2] -> completes and sets review_checkpoint='AWAITING_FINAL_CONFIRMATION'
    const finalOnlyRes = await app.inject({
      method: 'POST',
      url: '/api/creator/batches/execute',
      headers,
      payload: {
        profileId: 'sae-local-pilot',
        selection: {
          mode: 'pair',
          pair_ids: ['PAIR-A2'],
          include_tactics: false
        },
        reviewCadence: 'FINAL_REVIEW_ONLY',
        deliveryMode: 'ZIP',
        enableUrlAcquisition: true
      }
    });
    expect(finalOnlyRes.statusCode).toBe(200);
    const finalOnlyBatch = finalOnlyRes.json().batch;
    expect(finalOnlyBatch.review_cadence).toBe('FINAL_REVIEW_ONLY');
    expect(finalOnlyBatch.delivery_mode).toBe('ZIP');
    expect(finalOnlyBatch.review_checkpoint).toBe('AWAITING_FINAL_CONFIRMATION');
    expect(finalOnlyBatch.remaining_pair_ids).toEqual([]);

    await app.close();
  });
});
