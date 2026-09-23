import { createSign } from 'node:crypto';
import { sha256Hex } from '../assets/load.js';
import { serializeManifest } from './manifest-format.js';
import type { DriveClient } from './ports.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type TokenCache = { accessToken: string; expiresAt: number };

let tokenCache: TokenCache | undefined;

function requiredDriveEnv(): { credentials: ServiceAccount; folderId: string; manifestFileId: string } {
  const raw = process.env.DRIVE_CREDENTIALS_JSON?.trim();
  const folderId = process.env.DRIVE_AUTHORITIES_FOLDER_ID?.trim();
  const manifestFileId = process.env.DRIVE_MANIFEST_FILE_ID?.trim();
  if (!raw) throw new Error('Missing required environment variable: DRIVE_CREDENTIALS_JSON');
  if (!folderId) throw new Error('Missing required environment variable: DRIVE_AUTHORITIES_FOLDER_ID');
  if (!manifestFileId) throw new Error('Missing required environment variable: DRIVE_MANIFEST_FILE_ID');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('DRIVE_CREDENTIALS_JSON is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('DRIVE_CREDENTIALS_JSON must be a service-account JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.client_email !== 'string' || typeof record.private_key !== 'string') {
    throw new Error('DRIVE_CREDENTIALS_JSON must include client_email and private_key.');
  }
  return {
    credentials: {
      client_email: record.client_email,
      private_key: record.private_key.replaceAll('\\n', '\n'),
      token_uri: typeof record.token_uri === 'string' ? record.token_uri : undefined
    },
    folderId,
    manifestFileId
  };
}

function base64Url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function serviceAccountAccessToken(credentials: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - 60 > now) return tokenCache.accessToken;

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: DRIVE_SCOPE,
      aud: credentials.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = base64Url(signer.sign(credentials.private_key));
  const assertion = `${unsigned}.${signature}`;

  const response = await fetch(credentials.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const json = (await response.json()) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
  if (response.status >= 400 || typeof json.access_token !== 'string') {
    throw new Error(`Google OAuth token request failed (${response.status}).`);
  }
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  tokenCache = { accessToken: json.access_token, expiresAt: now + expiresIn };
  return json.access_token;
}

async function driveFetch(
  accessToken: string,
  url: string,
  init: RequestInit = {}
): Promise<{ status: number; text: string }> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  return { status: response.status, text };
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${label} is not a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('JSON object.')) throw error;
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function findFileByName(
  accessToken: string,
  folderId: string,
  name: string
): Promise<{ fileId: string } | null> {
  const query = `name='${name.replaceAll("'", "\\'")}' and '${folderId}' in parents and trashed=false`;
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const { status, text } = await driveFetch(accessToken, url);
  if (status >= 400) throw new Error(`Drive list failed (${status}).`);
  const json = parseJsonObject(text, 'Drive list response');
  const files = Array.isArray(json.files) ? json.files : [];
  const first = files[0];
  if (!first || typeof first !== 'object') return null;
  const id = (first as { id?: unknown }).id;
  return typeof id === 'string' ? { fileId: id } : null;
}

async function downloadFile(accessToken: string, fileId: string): Promise<string> {
  const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const { status, text } = await driveFetch(accessToken, url);
  if (status >= 400) throw new Error(`Drive download failed (${status}).`);
  return text;
}

async function updateFileMedia(accessToken: string, fileId: string, content: string): Promise<void> {
  const url = `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true`;
  const { status } = await driveFetch(accessToken, url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: content
  });
  if (status >= 400) throw new Error(`Drive update failed (${status}).`);
}

async function createFile(
  accessToken: string,
  folderId: string,
  name: string,
  content: string
): Promise<{ fileId: string }> {
  const boundary = `register-${Date.now()}`;
  const metadata = JSON.stringify({
    name,
    parents: [folderId],
    mimeType: 'application/json'
  });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  const url = `${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true`;
  const { status, text } = await driveFetch(accessToken, url, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body
  });
  if (status >= 400) throw new Error(`Drive upload failed (${status}).`);
  const json = parseJsonObject(text, 'Drive upload response');
  if (typeof json.id !== 'string') throw new Error('Drive upload did not return a file id.');
  return { fileId: json.id };
}

export function createDriveClient(): DriveClient {
  return {
    async uploadVersionedFile(folderId: string, name: string, content: string): Promise<{ fileId: string }> {
      const env = requiredDriveEnv();
      const accessToken = await serviceAccountAccessToken(env.credentials);
      const existing = await findFileByName(accessToken, folderId, name);
      if (existing) {
        const current = await downloadFile(accessToken, existing.fileId);
        if (sha256Hex(current) === sha256Hex(content)) {
          return existing;
        }
        await updateFileMedia(accessToken, existing.fileId, content);
        return existing;
      }
      return createFile(accessToken, folderId, name, content);
    },

    async readManifest(): Promise<Record<string, unknown>> {
      const env = requiredDriveEnv();
      const accessToken = await serviceAccountAccessToken(env.credentials);
      const text = await downloadFile(accessToken, env.manifestFileId);
      return parseJsonObject(text, 'knowledge-base-manifest.json');
    },

    async writeManifest(manifest: Record<string, unknown>): Promise<void> {
      const env = requiredDriveEnv();
      const accessToken = await serviceAccountAccessToken(env.credentials);
      await updateFileMedia(accessToken, env.manifestFileId, serializeManifest(manifest));
    }
  };
}

export function driveAuthoritiesFolderId(): string {
  return requiredDriveEnv().folderId;
}
