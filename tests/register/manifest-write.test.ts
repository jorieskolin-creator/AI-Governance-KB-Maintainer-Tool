import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDriveClient } from '../../src/register/drive.js';
import { serializeManifest } from '../../src/register/manifest-format.js';

const MANIFEST_FILE_ID = 'manifest-file-under-test';

function serviceAccountCredentials(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  return JSON.stringify({
    client_email: 'register-writer@example.iam.gserviceaccount.com',
    private_key: typeof pem === 'string' ? pem : pem.toString('utf8'),
    token_uri: 'https://oauth2.googleapis.com/token'
  });
}

describe('writeManifest byte format', () => {
  const previous = {
    credentials: process.env.DRIVE_CREDENTIALS_JSON,
    folderId: process.env.DRIVE_AUTHORITIES_FOLDER_ID,
    manifestFileId: process.env.DRIVE_MANIFEST_FILE_ID
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    if (previous.credentials === undefined) delete process.env.DRIVE_CREDENTIALS_JSON;
    else process.env.DRIVE_CREDENTIALS_JSON = previous.credentials;
    if (previous.folderId === undefined) delete process.env.DRIVE_AUTHORITIES_FOLDER_ID;
    else process.env.DRIVE_AUTHORITIES_FOLDER_ID = previous.folderId;
    if (previous.manifestFileId === undefined) delete process.env.DRIVE_MANIFEST_FILE_ID;
    else process.env.DRIVE_MANIFEST_FILE_ID = previous.manifestFileId;
  });

  it('uploads fetch body bytes identical to serializeManifest', async () => {
    process.env.DRIVE_CREDENTIALS_JSON = serviceAccountCredentials();
    process.env.DRIVE_AUTHORITIES_FOLDER_ID = 'authorities-folder';
    process.env.DRIVE_MANIFEST_FILE_ID = MANIFEST_FILE_ID;

    const captured: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      captured.push({ url: String(url), body: init?.body });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });

    const manifest: Record<string, unknown> = {
      zebra: { inner: true, alpha: 1 },
      machine_authority: [{ version: '1.0.0', canonical_identity: 'AI-GOV-SOURCE-REGISTER', sha256: 'ab' }],
      manifest_version: '2.0.0'
    };
    const expected = serializeManifest(manifest);

    await createDriveClient().writeManifest(manifest);

    const upload = captured.find((call) => call.url.includes(`/files/${MANIFEST_FILE_ID}`) && call.url.includes('uploadType=media'));
    expect(upload).toBeDefined();
    expect(typeof upload?.body).toBe('string');
    const body = upload?.body as string;
    expect(Buffer.from(body, 'utf8').equals(Buffer.from(expected, 'utf8'))).toBe(true);
    expect(body).toBe(expected);
    expect(body).not.toContain('": ');
    expect(body).not.toMatch(/\n[ \t]/);
    expect(body.endsWith('\n')).toBe(true);
    expect(body.endsWith('\n\n')).toBe(false);
    expect(body.slice(0, -1)).not.toContain('\n');
  });
});
