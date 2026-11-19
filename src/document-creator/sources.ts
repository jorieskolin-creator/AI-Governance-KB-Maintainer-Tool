import { lookup as dnsLookup } from 'node:dns/promises';
import { constants } from 'node:fs';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isIP } from 'node:net';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  validateSourcePreparationBundle,
  validateSourceUnit,
  type CreatorFinding,
  type DocumentPlan,
  type HumanVerifiedExtraction,
  type ModelReadyPassage,
  type ObjectCriterionSupport,
  type PreparedPairBaseline,
  type ReferencePdfBinding,
  type SourceExtractionStatus,
  type SourcePreparationBundle,
  type SourceUnit,
  type SourceUsagePolicy
} from './contracts.js';
import { computeSha256, isSafeRelativeWorkspacePath } from './inputs.js';
import { extractPairCriteriaFromPdf, extractPdfPages } from './pdf-extract.js';
import type { ResolvedProfileRuntime } from './profiles.js';

export const EXTRACTOR_VERSION = 'dc02-extractor-1.0.0';

export interface FetchResponseLike {
  status: number;
  headers: {
    get(name: string): string | null;
  };
  body?: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

export type HttpFetchPort = (
  url: string,
  init: {
    method: 'GET';
    redirect: 'manual';
    signal: AbortSignal;
    headers: Record<string, string>;
  }
) => Promise<FetchResponseLike>;

export type HostAddressResolver = (hostname: string) => Promise<string[]>;

export class SourcePreparationCache {
  private readonly unitsByKey = new Map<string, SourceUnit[]>();

  private key(inputSetId: string, sourceId: string): string {
    return `${inputSetId}:${sourceId}`;
  }

  get(inputSetId: string, sourceId: string): SourceUnit[] | undefined {
    const cached = this.unitsByKey.get(this.key(inputSetId, sourceId));
    if (!cached) return undefined;
    return JSON.parse(JSON.stringify(cached)) as SourceUnit[];
  }

  set(inputSetId: string, sourceId: string, units: SourceUnit[]): void {
    // Only checkpoint completed or partial-truncated usable units, or verified human/bound units,
    // so transient network errors can be retried without erasing already-succeeded sources.
    const shouldPersist = units.every(
      (u) => u.extraction_status !== 'INACCESSIBLE'
    );
    if (shouldPersist && units.length > 0) {
      this.unitsByKey.set(
        this.key(inputSetId, sourceId),
        JSON.parse(JSON.stringify(units)) as SourceUnit[]
      );
    }
  }

  sizeForInputSet(inputSetId: string): number {
    let count = 0;
    for (const k of this.unitsByKey.keys()) {
      if (k.startsWith(`${inputSetId}:`)) count += 1;
    }
    return count;
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.trim().toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const v4Part = normalized.slice('::ffff:'.length);
    if (isIP(v4Part) === 4) {
      return isPrivateOrReservedIp(v4Part);
    }
  }

  const version = isIP(normalized);
  if (version === 4) {
    const parts = normalized.split('.').map((p) => Number.parseInt(p, 10));
    const [a = 0, b = 0] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // Link-local & cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // Multicast / reserved
    return false;
  }

  if (version === 6) {
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local fc00::/7
    if (
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return true; // Link-local fe80::/10
    }
    return false;
  }

  return true;
}

export async function validateSourceFetchUrl(options: {
  rawUrl: string;
  allowedHosts: ReadonlySet<string>;
  resolveAddresses?: HostAddressResolver;
}): Promise<{ ok: true; url: URL } | { ok: false; code: string; reason: string }> {
  let parsed: URL;
  try {
    parsed = new URL(options.rawUrl);
  } catch {
    return { ok: false, code: 'FETCH_INVALID_URL', reason: `Malformed URL "${options.rawUrl}".` };
  }

  if (parsed.protocol !== 'https:') {
    return {
      ok: false,
      code: 'FETCH_NON_HTTPS_REJECTED',
      reason: `Only HTTPS registered source URLs are permitted; rejected protocol "${parsed.protocol}".`
    };
  }

  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: 'FETCH_CREDENTIALS_IN_URL_REJECTED',
      reason: 'Credentials in source URLs are prohibited.'
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host === 'metadata.google.internal'
  ) {
    return {
      ok: false,
      code: 'FETCH_PRIVATE_NETWORK_REJECTED',
      reason: `Rejected local/internal hostname "${parsed.hostname}".`
    };
  }

  if (isIP(host) !== 0 && isPrivateOrReservedIp(host)) {
    return {
      ok: false,
      code: 'FETCH_PRIVATE_NETWORK_REJECTED',
      reason: `Rejected private, loopback, or metadata IP "${host}".`
    };
  }

  if (options.allowedHosts.size > 0 && !options.allowedHosts.has(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      code: 'FETCH_HOST_OUTSIDE_POLICY',
      reason: `Host "${parsed.hostname}" is not in profile source_policy.allowed_publication_hosts.`
    };
  }

  if (options.resolveAddresses && isIP(host) === 0) {
    let addresses: string[];
    try {
      addresses = await options.resolveAddresses(parsed.hostname);
    } catch {
      return {
        ok: false,
        code: 'FETCH_DNS_RESOLUTION_FAILED',
        reason: `DNS lookup failed for "${parsed.hostname}".`
      };
    }
    if (addresses.length === 0 || addresses.some((ip) => isPrivateOrReservedIp(ip))) {
      return {
        ok: false,
        code: 'FETCH_PRIVATE_NETWORK_REJECTED',
        reason: `Hostname "${parsed.hostname}" resolved to a private or reserved network address.`
      };
    }
  }

  return { ok: true, url: parsed };
}

async function readBoundedBytes(
  response: FetchResponseLike,
  maxBytes: number
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (response.body && Symbol.asyncIterator in response.body) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (total + buf.byteLength > maxBytes) {
        const allowed = Math.max(0, maxBytes - total);
        if (allowed > 0) {
          chunks.push(buf.subarray(0, allowed));
          total += allowed;
        }
        truncated = true;
        break;
      }
      chunks.push(buf);
      total += buf.byteLength;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes: merged, truncated };
  }

  if (response.body && 'getReader' in response.body) {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        if (total + value.byteLength > maxBytes) {
          const allowed = Math.max(0, maxBytes - total);
          if (allowed > 0) {
            chunks.push(value.subarray(0, allowed));
            total += allowed;
          }
          truncated = true;
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
        total += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes: merged, truncated };
  }

  if (typeof response.arrayBuffer === 'function') {
    const full = new Uint8Array(await response.arrayBuffer());
    if (full.byteLength > maxBytes) {
      return { bytes: full.subarray(0, maxBytes), truncated: true };
    }
    return { bytes: full, truncated: false };
  }

  return { bytes: new Uint8Array(0), truncated: false };
}

async function fetchRegisteredUrlSafely(options: {
  initialUrl: string;
  allowedHosts: ReadonlySet<string>;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  fetchPort: HttpFetchPort;
  resolveAddresses?: HostAddressResolver;
}): Promise<
  | {
      ok: true;
      finalUrl: string;
      contentType: string;
      bytes: Uint8Array;
      truncated: boolean;
    }
  | {
      ok: false;
      status: 'INACCESSIBLE' | 'REJECTED_POLICY';
      code: string;
      reason: string;
    }
> {
  const maxRedirects = options.maxRedirects ?? 3;
  let currentUrl = options.initialUrl;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const urlCheck = await validateSourceFetchUrl({
      rawUrl: currentUrl,
      allowedHosts: options.allowedHosts,
      resolveAddresses: options.resolveAddresses
    });
    if (!urlCheck.ok) {
      return {
        ok: false,
        status: 'REJECTED_POLICY',
        code: urlCheck.code,
        reason: hop > 0 ? `Redirect hop ${hop} rejected: ${urlCheck.reason}` : urlCheck.reason
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: FetchResponseLike;
    try {
      response = await options.fetchPort(urlCheck.url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html, text/plain, text/markdown, application/pdf, application/json;q=0.9',
          'user-agent': 'KB-Document-Creator/1.0 (Source-Preparation; inert-read)'
        }
      });
    } catch (error) {
      clearTimeout(timer);
      const isAbort =
        error instanceof Error && (error.name === 'AbortError' || /abort|timeout/i.test(error.message));
      return {
        ok: false,
        status: 'INACCESSIBLE',
        code: isAbort ? 'FETCH_TIMEOUT' : 'FETCH_NETWORK_ERROR',
        reason: isAbort
          ? `Fetch timed out after ${options.timeoutMs}ms for "${currentUrl}".`
          : `Network error fetching "${currentUrl}": ${error instanceof Error ? error.message : String(error)}`
      };
    }

    try {
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          return {
            ok: false,
            status: 'INACCESSIBLE',
            code: 'FETCH_REDIRECT_MISSING_LOCATION',
            reason: `HTTP ${response.status} redirect without Location header from "${currentUrl}".`
          };
        }
        if (hop === maxRedirects) {
          return {
            ok: false,
            status: 'REJECTED_POLICY',
            code: 'FETCH_TOO_MANY_REDIRECTS',
            reason: `Exceeded maximum redirects (${maxRedirects}) starting from "${options.initialUrl}".`
          };
        }
        const nextUrl = new URL(location, urlCheck.url).toString();
        const redirectCheck = await validateSourceFetchUrl({
          rawUrl: nextUrl,
          allowedHosts: options.allowedHosts,
          resolveAddresses: options.resolveAddresses
        });
        if (!redirectCheck.ok) {
          return {
            ok: false,
            status: 'REJECTED_POLICY',
            code:
              redirectCheck.code === 'FETCH_HOST_OUTSIDE_POLICY'
                ? 'FETCH_REDIRECT_OUTSIDE_POLICY'
                : redirectCheck.code,
            reason: `Redirect target "${nextUrl}" rejected: ${redirectCheck.reason}`
          };
        }
        currentUrl = redirectCheck.url.toString();
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        return {
          ok: false,
          status: 'INACCESSIBLE',
          code: 'FETCH_HTTP_ERROR',
          reason: `HTTP ${response.status} returned by "${currentUrl}".`
        };
      }

      const contentType = (response.headers.get('content-type') ?? 'text/plain').split(';')[0]!.trim().toLowerCase();
      const { bytes, truncated } = await readBoundedBytes(response, options.maxBytes);
      return {
        ok: true,
        finalUrl: currentUrl,
        contentType,
        bytes,
        truncated
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    status: 'REJECTED_POLICY',
    code: 'FETCH_TOO_MANY_REDIRECTS',
    reason: `Exceeded maximum redirects (${maxRedirects}).`
  };
}

const UNTRUSTED_INJECTION_PATTERNS: ReadonlyArray<{ flag: string; pattern: RegExp }> = [
  { flag: 'PROMPT_OVERRIDE_INSTRUCTION', pattern: /\b(ignore|disregard|override)\s+(all\s+)?(previous|prior|system|developer)\s+instructions?\b/i },
  { flag: 'APPROVAL_OR_PUBLISH_INJECTION', pattern: /\b(publish\s+immediately|mark\s+as\s+approved|set\s+release_status|grant\s+hub\s+approval|auto[- ]?approve)\b/i },
  { flag: 'TOOL_OR_SECRET_DIRECTIVE', pattern: /\b(print\s+process\.env|reveal\s+secrets?|call\s+tool|execute\s+shell)\b/i },
  { flag: 'ACTIVE_SCRIPT_TAG_STRIPPED', pattern: /<\s*script\b/i }
];

export function detectUntrustedContentFlags(rawText: string): string[] {
  const flags: string[] = [];
  for (const rule of UNTRUSTED_INJECTION_PATTERNS) {
    if (rule.pattern.test(rawText)) {
      flags.push(rule.flag);
    }
  }
  return flags;
}

function sanitizeInertHtmlToSections(rawHtml: string): Array<{ section: string; text: string }> {
  const withoutActiveBlocks = rawHtml
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*(script|style|iframe|object|embed|noscript|svg)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ');

  const decodeEntities = (str: string) =>
    str
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&#x27;', "'")
      .replaceAll('&#39;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>');

  const headingRegex = /<\s*h([1-4])\b[^>]*>([\s\S]*?)<\s*\/\s*h\1\s*>/gi;
  const headings: Array<{ title: string; start: number; bodyStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(withoutActiveBlocks)) !== null) {
    const cleanTitle = decodeEntities(match[2]!.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanTitle) {
      headings.push({
        title: cleanTitle,
        start: match.index,
        bodyStart: match.index + match[0].length
      });
    }
  }

  const stripTags = (fragment: string) =>
    decodeEntities(
      fragment
        .replace(/<\s*(br|p|div|li|tr|section|article)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');

  if (headings.length === 0) {
    const text = stripTags(withoutActiveBlocks);
    return text ? [{ section: 'Document body', text }] : [];
  }

  const sections: Array<{ section: string; text: string }> = [];
  if (headings[0]!.start > 0) {
    const preamble = stripTags(withoutActiveBlocks.slice(0, headings[0]!.start));
    if (preamble.length > 0) {
      sections.push({ section: 'Preamble', text: preamble });
    }
  }

  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i]!;
    const end = i + 1 < headings.length ? headings[i + 1]!.start : withoutActiveBlocks.length;
    const body = stripTags(withoutActiveBlocks.slice(current.bodyStart, end));
    const combined = body ? `${current.title}\n${body}` : current.title;
    if (combined.trim().length > 0) {
      sections.push({ section: current.title, text: combined });
    }
  }

  return sections;
}

function classifyRegisterLicensingPolicy(boundaryText: string): {
  usagePolicy: SourceUsagePolicy;
  defaultModelEligible: boolean;
  allowsUrlAcquisition: boolean;
} {
  if (/metadata and locator only/i.test(boundaryText)) {
    return {
      usagePolicy: 'METADATA_LOCATOR_ONLY',
      defaultModelEligible: false,
      allowsUrlAcquisition: false
    };
  }
  if (/public legal source|cc by-sa|synthetic test text permitted/i.test(boundaryText)) {
    return {
      usagePolicy: 'PERMITTED_ATTRIBUTED_EXCERPT',
      defaultModelEligible: true,
      allowsUrlAcquisition: true
    };
  }
  // Publisher terms ("Store official metadata and permitted content subject to publisher terms."):
  // Acquire locally only when explicitly permitted; model egress requires explicit confirmation!
  return {
    usagePolicy: 'PERMITTED_ATTRIBUTED_EXCERPT',
    defaultModelEligible: false,
    allowsUrlAcquisition: true
  };
}

function buildSourceUnit(params: {
  sourceId: string;
  sourceVersion: string;
  sourceTitle: string;
  authorityTier: string;
  authorityType: string;
  originKind: SourceUnit['origin_kind'];
  originalSha256: string | null;
  locator: SourceUnit['locator'];
  text: string | null;
  extractionStatus: SourceExtractionStatus;
  limitations: string[];
  usagePolicy: SourceUsagePolicy;
  modelEligible: boolean;
  untrustedFlags?: string[];
  humanVerification?: SourceUnit['human_verification'];
  retrievedAt: string;
}): SourceUnit {
  const cleanText = params.text && params.text.trim().length > 0 ? params.text.trim() : null;
  const substantiveSupportEligible =
    cleanText !== null &&
    (params.extractionStatus === 'COMPLETE' || params.extractionStatus === 'PARTIAL_TRUNCATED') &&
    params.usagePolicy !== 'METADATA_LOCATOR_ONLY';

  const effectiveModelEligible = params.modelEligible && substantiveSupportEligible;
  const flags = [
    ...new Set([
      ...(params.untrustedFlags ?? []),
      ...(cleanText ? detectUntrustedContentFlags(cleanText) : [])
    ])
  ];

  const sourceUnitId = computeSha256(
    JSON.stringify([
      params.sourceId,
      params.sourceVersion,
      params.originKind,
      params.locator.kind,
      params.locator.label
    ])
  );

  const unit: SourceUnit = {
    source_unit_id: sourceUnitId,
    source_id: params.sourceId,
    source_version: params.sourceVersion,
    source_title: params.sourceTitle,
    authority_tier: params.authorityTier,
    authority_type: params.authorityType,
    origin_kind: params.originKind,
    original_sha256: params.originalSha256,
    locator: params.locator,
    text: cleanText,
    extraction_status: params.extractionStatus,
    limitations: params.limitations,
    usage_policy: params.usagePolicy,
    model_eligible: effectiveModelEligible,
    substantive_support_eligible: substantiveSupportEligible,
    untrusted_content_flags: flags,
    human_verification: params.humanVerification ?? null,
    retrieved_at: params.retrievedAt,
    extractor_version: EXTRACTOR_VERSION,
    text_sha256: cleanText ? computeSha256(cleanText) : null
  };

  const errors = validateSourceUnit(unit);
  if (errors.length > 0) {
    throw new Error(`Constructed SourceUnit failed contract validation: ${JSON.stringify(errors)}`);
  }
  return unit;
}

function formatUntrustedDataBlock(unit: SourceUnit): string {
  const safeBody = (unit.text ?? '').replaceAll(
    '---END UNTRUSTED REGISTERED SOURCE DATA---',
    '[ESCAPED-DELIMITER]'
  );
  return [
    `---BEGIN UNTRUSTED REGISTERED SOURCE DATA (source_id=${unit.source_id}; version=${unit.source_version}; locator=${unit.locator.label})---`,
    safeBody,
    '---END UNTRUSTED REGISTERED SOURCE DATA---'
  ].join('\n');
}

interface RegisterSourceEntry {
  id: string;
  title: string;
  version_or_date: string;
  authority_tier: string;
  authority_type: string;
  official_location: string;
  licensing_storage_boundary: string;
  domain_coverage: string[];
}

function parseRegisterSources(runtime: ResolvedProfileRuntime): Map<string, RegisterSourceEntry> {
  const map = new Map<string, RegisterSourceEntry>();
  const parsed = runtime.pinned.json('source-register');
  if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null) return map;
  const rawSources = (parsed.value as { sources?: unknown }).sources;
  if (!Array.isArray(rawSources)) return map;

  for (const item of rawSources) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec.id === 'string' ? rec.id : '';
    if (!id) continue;
    map.set(id, {
      id,
      title: typeof rec.title === 'string' ? rec.title : id,
      version_or_date:
        typeof rec.version_or_date === 'string'
          ? rec.version_or_date
          : typeof rec.version === 'string'
            ? rec.version
            : 'unspecified',
      authority_tier: typeof rec.authority_tier === 'string' ? rec.authority_tier : 'UNSPECIFIED',
      authority_type: typeof rec.authority_type === 'string' ? rec.authority_type : 'UNSPECIFIED',
      official_location: typeof rec.official_location === 'string' ? rec.official_location : '',
      licensing_storage_boundary:
        typeof rec.licensing_storage_boundary === 'string' ? rec.licensing_storage_boundary : '',
      domain_coverage: Array.isArray(rec.domain_coverage)
        ? rec.domain_coverage.filter((d): d is string => typeof d === 'string')
        : []
    });
  }
  return map;
}

const defaultHostResolver: HostAddressResolver = async (hostname: string) => {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((r) => r.address);
};

export interface PrepareSourcesOptions {
  workspaceRoot?: string;
  runtime: ResolvedProfileRuntime;
  plan: DocumentPlan;
  cache?: SourcePreparationCache;
  /** Default false in offline verification; set true only for an explicit pilot or when supplying a mock fetchPort. */
  enableUrlAcquisition?: boolean;
  /** Confirm publisher-terms sources may enter model packets; default false (fail-closed on ambiguous terms). */
  allowPublisherTermsModelEgress?: boolean;
  fetchPort?: HttpFetchPort;
  resolveAddresses?: HostAddressResolver;
  now?: () => Date;
}

export async function prepareSourcesForPlan(
  options: PrepareSourcesOptions
): Promise<SourcePreparationBundle> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const workspaceRealPath = await realpath(workspaceRoot);
  const { runtime, plan } = options;
  const nowIso = (options.now ?? (() => new Date()))().toISOString();
  const findings: CreatorFinding[] = [];
  const registerById = parseRegisterSources(runtime);

  // 1. Inspect references/ directory for unbound PDFs and validate profile.reference_pdf_bindings (S-07).
  const companionPaths = new Set(
    runtime.profile.input_refs
      .filter((ref) => ref.kind === 'companion-reference')
      .map((ref) => ref.path)
  );
  const refsSubdir = runtime.profile.source_policy.references_subdir;
  let refsDirReal: string | null = null;
  if (isSafeRelativeWorkspacePath(refsSubdir)) {
    const candidate = resolve(workspaceRealPath, refsSubdir);
    if (isWithinRoot(workspaceRealPath, candidate)) {
      refsDirReal = await realpath(candidate).catch(() => null);
    }
  }

  const validBindingsBySourceId = new Map<string, { binding: ReferencePdfBinding; realPath: string }>();
  const configuredBoundPaths = new Set<string>();

  for (let i = 0; i < (runtime.profile.reference_pdf_bindings ?? []).length; i += 1) {
    const binding = runtime.profile.reference_pdf_bindings![i]!;
    const findingPath = `/reference_pdf_bindings/${i}`;

    if (!registerById.has(binding.source_id)) {
      findings.push({
        code: 'UNREGISTERED_REFERENCE_PDF_SOURCE',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `${findingPath}/source_id`,
        message: `Reference PDF binding "${binding.path}" points to unregistered source_id "${binding.source_id}".`
      });
      continue;
    }

    if (companionPaths.has(binding.path)) {
      findings.push({
        code: 'COMPANION_PDF_NOT_SOURCE_PUBLICATION',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `${findingPath}/path`,
        message: `Companion input PDF "${binding.path}" cannot be bound as a supporting source publication.`
      });
      continue;
    }

    if (!isSafeRelativeWorkspacePath(binding.path) || !binding.path.toLowerCase().endsWith('.pdf')) {
      findings.push({
        code: 'INVALID_REFERENCE_PDF_PATH',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `${findingPath}/path`,
        message: `Reference PDF binding "${binding.path}" must be a safe relative .pdf path.`
      });
      continue;
    }

    if (!refsDirReal) {
      findings.push({
        code: 'REFERENCES_SUBDIR_UNAVAILABLE',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `${findingPath}/path`,
        message: `Configured references_subdir "${refsSubdir}" does not exist for binding "${binding.path}".`
      });
      continue;
    }

    const resolvedPdf = await realpath(resolve(workspaceRealPath, binding.path)).catch(() => null);
    if (!resolvedPdf || !isWithinRoot(refsDirReal, resolvedPdf)) {
      findings.push({
        code: 'REFERENCE_PDF_OUTSIDE_REFERENCES_DIR',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `${findingPath}/path`,
        message: `Bound PDF "${binding.path}" must reside inside "${refsSubdir}" without escaping via symlink.`
      });
      continue;
    }

    const info = await stat(resolvedPdf).catch(() => null);
    if (!info?.isFile()) {
      findings.push({
        code: 'REFERENCE_PDF_NOT_FILE',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `${findingPath}/path`,
        message: `Bound PDF "${binding.path}" is not a regular file.`
      });
      continue;
    }

    await access(resolvedPdf, constants.R_OK);
    const bytes = await readFile(resolvedPdf);
    const computedHash = computeSha256(bytes);
    if (computedHash !== binding.sha256) {
      findings.push({
        code: 'REFERENCE_PDF_SHA256_MISMATCH',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `${findingPath}/sha256`,
        message: `Bound PDF "${binding.path}" SHA-256 mismatch: expected ${binding.sha256}, computed ${computedHash}.`
      });
      continue;
    }

    configuredBoundPaths.add(resolvedPdf);
    validBindingsBySourceId.set(binding.source_id, { binding, realPath: resolvedPdf });
  }

  // Scan references/ directory to detect any unbound .pdf files sitting in references/ (S-07).
  if (refsDirReal) {
    const companionRealPaths = new Set<string>();
    for (const compRel of companionPaths) {
      const rp = await realpath(resolve(workspaceRealPath, compRel)).catch(() => null);
      if (rp) companionRealPaths.add(rp);
    }

    const entries = await readdir(refsDirReal, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) continue;
      const entryReal = await realpath(resolve(refsDirReal, entry.name)).catch(() => null);
      if (!entryReal) continue;
      if (!companionRealPaths.has(entryReal) && !configuredBoundPaths.has(entryReal)) {
        findings.push({
          code: 'UNBOUND_PDF_IN_REFERENCES',
          severity: 'WARNING',
          tier: 'RELEASE',
          path: `${refsSubdir}/${entry.name}`,
          message: `PDF "${entry.name}" in "${refsSubdir}" has no Source Register binding and will not be used as claim support.`
        });
      }
    }
  }

  // Validate human-verified extractions against Source Register.
  const humanExtractionsBySourceId = new Map<string, HumanVerifiedExtraction[]>();
  for (let i = 0; i < (runtime.profile.human_verified_extractions ?? []).length; i += 1) {
    const hv = runtime.profile.human_verified_extractions![i]!;
    if (!registerById.has(hv.source_id)) {
      findings.push({
        code: 'UNREGISTERED_HUMAN_EXTRACTION_SOURCE',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `/human_verified_extractions/${i}/source_id`,
        message: `Human-verified extraction "${hv.extraction_id}" references unknown source_id "${hv.source_id}".`
      });
      continue;
    }
    const list = humanExtractionsBySourceId.get(hv.source_id) ?? [];
    list.push(hv);
    humanExtractionsBySourceId.set(hv.source_id, list);
  }

  // 2. Extract per-pair baselines from Criteria PDF + Thinking Flow / Instrument (S-08).
  const criteriaPdfBytes = runtime.pinned.bytes('criteria-reference');
  const plannedPairIds = new Set<string>();
  const pairByObjectId = new Map(
    runtime.pairs.flatMap((p) => [
      [p.capability.id, p] as const,
      [p.antipattern.id, p] as const
    ])
  );

  for (const doc of plan.documents) {
    if (doc.object_type === 'capability' || doc.object_type === 'antipattern') {
      const pair = pairByObjectId.get(doc.object_id);
      if (pair) plannedPairIds.add(pair.pair_id);
    }
  }

  const pairBaselines: PreparedPairBaseline[] = [];
  const criteriaLocatorByObjectId = new Map<string, string | null>();
  let allCriteriaAndQuestionsReady = true;

  for (const pairId of plannedPairIds) {
    const pairModel = runtime.pairs.find((p) => p.pair_id === pairId);
    if (!pairModel) continue;

    const { extraction, criteria } = extractPairCriteriaFromPdf({
      pdfBytes: criteriaPdfBytes,
      pairId: pairModel.pair_id,
      capabilityId: pairModel.capability.id,
      antipatternId: pairModel.antipattern.id,
      maxExtractBytes: runtime.profile.source_policy.max_extract_bytes
    });

    if (!criteria) {
      allCriteriaAndQuestionsReady = false;
      findings.push({
        code:
          extraction.status === 'SCANNED_UNSUPPORTED'
            ? 'CRITERIA_PDF_SCANNED_UNSUPPORTED'
            : 'CRITERIA_PAIR_SECTION_MISSING',
        severity: 'ERROR',
        tier: 'DRAFT',
        path: `/inputs/criteria-reference/${pairModel.pair_id}`,
        message: `Could not extract criteria section for "${pairModel.pair_id}" (${pairModel.capability.id} / ${pairModel.antipattern.id}) from criteria-reference PDF (${extraction.status}).`
      });
      criteriaLocatorByObjectId.set(pairModel.capability.id, null);
      criteriaLocatorByObjectId.set(pairModel.antipattern.id, null);
    } else {
      if (extraction.status === 'PARTIAL_TRUNCATED') {
        findings.push({
          code: 'CRITERIA_PDF_TRUNCATED',
          severity: 'WARNING',
          tier: 'RELEASE',
          path: `/inputs/criteria-reference/${pairModel.pair_id}`,
          message: extraction.warnings.join('; ') || 'Criteria PDF extraction was truncated.'
        });
      }
      criteriaLocatorByObjectId.set(pairModel.capability.id, criteria.locator);
      criteriaLocatorByObjectId.set(pairModel.antipattern.id, criteria.locator);
    }

    if (pairModel.capability.questions.length === 0 || pairModel.antipattern.questions.length === 0) {
      allCriteriaAndQuestionsReady = false;
    }

    pairBaselines.push({
      pair_id: pairModel.pair_id,
      domain_id: pairModel.domain_id,
      criteria_from_pdf: criteria
        ? {
            page_number: criteria.page_number,
            locator: criteria.locator,
            capability_id: criteria.capability_id,
            capability_title: criteria.capability_title,
            capability_definition: criteria.capability_definition,
            applicability: criteria.applicability,
            capability_indicators: criteria.capability_indicators,
            antipattern_id: criteria.antipattern_id,
            antipattern_title: criteria.antipattern_title,
            antipattern_definition: criteria.antipattern_definition,
            antipattern_indicators: criteria.antipattern_indicators
          }
        : null,
      thinking_flow_baseline: {
        cognitive_model_version: runtime.inputSet.cognitive_model?.version ?? 'unknown',
        capability_locator: `cognitive-model#${pairModel.capability.id} (${pairModel.capability.questions.map((q) => q.id).join(', ')})`,
        antipattern_locator: `cognitive-model#${pairModel.capability.id} (${pairModel.antipattern.questions.map((q) => q.id).join(', ')})`,
        capability_questions: pairModel.capability.questions,
        antipattern_questions: pairModel.antipattern.questions,
        interpretation_rules: runtime.inputSet.cognitive_model?.rules ?? []
      },
      legacy_release_instructions_excluded: true
    });
  }

  // 3. Determine candidate Source Register IDs for the planned documents.
  const candidateSourcesByObject = new Map<string, string[]>();
  const allCandidateSourceIds = new Set<string>();

  for (const doc of plan.documents) {
    if (doc.object_type !== 'capability' && doc.object_type !== 'antipattern') continue;
    const candidates =
      doc.preset_source_ids.length > 0
        ? doc.preset_source_ids
        : doc.candidate_domain_source_ids;
    const registeredCandidates = candidates.filter((id) => registerById.has(id));
    candidateSourcesByObject.set(doc.object_id, registeredCandidates);
    for (const id of registeredCandidates) allCandidateSourceIds.add(id);
  }
  // Also include any bound PDFs or human extractions explicitly configured on the profile.
  for (const id of validBindingsBySourceId.keys()) allCandidateSourceIds.add(id);
  for (const id of humanExtractionsBySourceId.keys()) allCandidateSourceIds.add(id);

  const allowedHosts = new Set(
    runtime.profile.source_policy.allowed_publication_hosts.map((h) => h.toLowerCase())
  );
  const maxBytes = runtime.profile.source_policy.max_extract_bytes;
  const timeoutMs = Math.min(runtime.profile.limits.request_timeout_ms, 30_000);
  const enableUrlAcquisition = Boolean(options.enableUrlAcquisition);
  const fetchPort: HttpFetchPort | undefined =
    options.fetchPort ??
    (enableUrlAcquisition ? ((url, init) => fetch(url, init) as unknown as Promise<FetchResponseLike>) : undefined);
  const resolveAddresses =
    options.resolveAddresses ?? (options.fetchPort ? undefined : defaultHostResolver);

  const unitsBySourceId = new Map<string, SourceUnit[]>();

  for (const sourceId of [...allCandidateSourceIds].sort()) {
    // Check run/input-set scoped checkpoint cache first.
    const cached = options.cache?.get(runtime.inputSet.input_set_id, sourceId);
    if (cached) {
      unitsBySourceId.set(sourceId, cached);
      continue;
    }

    const regEntry = registerById.get(sourceId);
    if (!regEntry) continue;

    const policyClass = classifyRegisterLicensingPolicy(regEntry.licensing_storage_boundary);
    const producedUnits: SourceUnit[] = [];

    // Priority A: Human-verified extractions (explicitly attributed provenance).
    const humanItems = humanExtractionsBySourceId.get(sourceId) ?? [];
    for (const hv of humanItems) {
      producedUnits.push(
        buildSourceUnit({
          sourceId,
          sourceVersion: hv.edition_version,
          sourceTitle: regEntry.title,
          authorityTier: regEntry.authority_tier,
          authorityType: regEntry.authority_type,
          originKind: 'human_verified_excerpt',
          originalSha256: null,
          locator: {
            kind: 'plain_lines',
            label: hv.locator_label,
            page: null,
            section: hv.locator_label
          },
          text: hv.text,
          extractionStatus: 'COMPLETE',
          limitations: [
            `Human-verified excerpt (${hv.verified_by} at ${hv.verified_at}); original full-file bytes not attached.`
          ],
          usagePolicy: 'HUMAN_VERIFIED_EXTRACTION',
          modelEligible: hv.rights_confirmed_for_model,
          humanVerification: {
            verified_by: hv.verified_by,
            verified_at: hv.verified_at,
            provenance_note: hv.provenance_note
          },
          retrievedAt: nowIso
        })
      );
      if (!hv.rights_confirmed_for_model) {
        findings.push({
          code: 'SOURCE_MODEL_EGRESS_BLOCKED',
          severity: 'WARNING',
          tier: 'DRAFT',
          path: `/sources/${sourceId}`,
          message: `Human-verified excerpt "${hv.extraction_id}" for "${sourceId}" has rights_confirmed_for_model=false; excluded from model packet.`
        });
      }
    }

    // Priority B: Bound PDF in references/ (S-01, S-03, S-06, S-07).
    const boundPdf = validBindingsBySourceId.get(sourceId);
    if (boundPdf) {
      const { binding, realPath } = boundPdf;
      const pdfBytes = await readFile(realPath);

      if (binding.usage_policy === 'METADATA_LOCATOR_ONLY') {
        producedUnits.push(
          buildSourceUnit({
            sourceId,
            sourceVersion: binding.edition_version,
            sourceTitle: regEntry.title,
            authorityTier: regEntry.authority_tier,
            authorityType: regEntry.authority_type,
            originKind: 'bound_reference_pdf',
            originalSha256: binding.sha256,
            locator: { kind: 'metadata_only', label: `${binding.path} (metadata only)`, page: null, section: null },
            text: null,
            extractionStatus: 'METADATA_ONLY',
            limitations: ['Bound PDF policy restricts usage to metadata and locator only.'],
            usagePolicy: 'METADATA_LOCATOR_ONLY',
            modelEligible: false,
            retrievedAt: nowIso
          })
        );
      } else {
        const pdfResult = extractPdfPages(pdfBytes, { maxExtractBytes: maxBytes });
        if (pdfResult.status === 'SCANNED_UNSUPPORTED' || pdfResult.status === 'FAILED') {
          findings.push({
            code: 'SOURCE_EXTRACTION_UNSUPPORTED',
            severity: 'WARNING',
            tier: 'RELEASE',
            path: binding.path,
            message: `Bound PDF "${binding.path}" (${sourceId}): ${pdfResult.warnings.join('; ')}`
          });
          producedUnits.push(
            buildSourceUnit({
              sourceId,
              sourceVersion: binding.edition_version,
              sourceTitle: regEntry.title,
              authorityTier: regEntry.authority_tier,
              authorityType: regEntry.authority_type,
              originKind: 'bound_reference_pdf',
              originalSha256: binding.sha256,
              locator: { kind: 'pdf_page_section', label: `${binding.path} (unreadable/scanned)`, page: 1, section: null },
              text: null,
              extractionStatus: 'SCANNED_UNSUPPORTED',
              limitations: pdfResult.warnings,
              usagePolicy: binding.usage_policy,
              modelEligible: false,
              retrievedAt: nowIso
            })
          );
        } else {
          if (pdfResult.status === 'PARTIAL_TRUNCATED') {
            findings.push({
              code: 'SOURCE_TRUNCATED',
              severity: 'WARNING',
              tier: 'RELEASE',
              path: binding.path,
              message: `Bound PDF "${binding.path}" (${sourceId}) was truncated: ${pdfResult.warnings.join('; ')}`
            });
          }
          if (!binding.rights_confirmed_for_model) {
            findings.push({
              code: 'SOURCE_MODEL_EGRESS_BLOCKED',
              severity: 'WARNING',
              tier: 'DRAFT',
              path: binding.path,
              message: `Bound PDF "${binding.path}" (${sourceId}) has rights_confirmed_for_model=false; retained locally for human inspection and excluded from model requests.`
            });
          }
          for (const page of pdfResult.pages) {
            if (page.characterCount === 0) continue;
            producedUnits.push(
              buildSourceUnit({
                sourceId,
                sourceVersion: binding.edition_version,
                sourceTitle: regEntry.title,
                authorityTier: regEntry.authority_tier,
                authorityType: regEntry.authority_type,
                originKind: 'bound_reference_pdf',
                originalSha256: binding.sha256,
                locator: {
                  kind: 'pdf_page_section',
                  label: `${binding.path}#page=${page.pageNumber}`,
                  page: page.pageNumber,
                  section: `Page ${page.pageNumber}`
                },
                text: page.text,
                extractionStatus: pdfResult.status === 'PARTIAL_TRUNCATED' ? 'PARTIAL_TRUNCATED' : 'COMPLETE',
                limitations:
                  pdfResult.status === 'PARTIAL_TRUNCATED'
                    ? [...pdfResult.warnings]
                    : [],
                usagePolicy: binding.usage_policy,
                modelEligible: binding.rights_confirmed_for_model,
                retrievedAt: nowIso
              })
            );
          }
        }
      }
    }

    // Priority C: Official Source Register URL acquisition when no bound PDF/human excerpt already supplied passages.
    if (producedUnits.length === 0) {
      if (!policyClass.allowsUrlAcquisition) {
        // Metadata-only standard (e.g. ISO without explicit bound rights): never fetch or send to AI!
        producedUnits.push(
          buildSourceUnit({
            sourceId,
            sourceVersion: regEntry.version_or_date,
            sourceTitle: regEntry.title,
            authorityTier: regEntry.authority_tier,
            authorityType: regEntry.authority_type,
            originKind: 'register_metadata',
            originalSha256: null,
            locator: {
              kind: 'metadata_only',
              label: `${regEntry.official_location} (metadata-only boundary)`,
              page: null,
              section: null
            },
            text: null,
            extractionStatus: 'METADATA_ONLY',
            limitations: [regEntry.licensing_storage_boundary || 'Metadata and locator only; content acquisition prohibited without explicit rights.'],
            usagePolicy: 'METADATA_LOCATOR_ONLY',
            modelEligible: false,
            retrievedAt: nowIso
          })
        );
      } else if (!enableUrlAcquisition || !fetchPort) {
        producedUnits.push(
          buildSourceUnit({
            sourceId,
            sourceVersion: regEntry.version_or_date,
            sourceTitle: regEntry.title,
            authorityTier: regEntry.authority_tier,
            authorityType: regEntry.authority_type,
            originKind: 'register_metadata',
            originalSha256: null,
            locator: {
              kind: 'metadata_only',
              label: `${regEntry.official_location} (URL acquisition disabled)`,
              page: null,
              section: null
            },
            text: null,
            extractionStatus: 'METADATA_ONLY',
            limitations: [
              'URL acquisition was not enabled for this offline run; register metadata alone cannot support substantive claims.'
            ],
            usagePolicy: 'METADATA_LOCATOR_ONLY',
            modelEligible: false,
            retrievedAt: nowIso
          })
        );
      } else {
        const fetched = await fetchRegisteredUrlSafely({
          initialUrl: regEntry.official_location,
          allowedHosts,
          maxBytes,
          timeoutMs,
          fetchPort,
          resolveAddresses
        });

        if (!fetched.ok) {
          findings.push({
            code: fetched.code,
            severity: 'WARNING',
            tier: 'RELEASE',
            path: `/sources/${sourceId}/official_location`,
            message: `[${sourceId}] ${fetched.reason}`
          });
          producedUnits.push(
            buildSourceUnit({
              sourceId,
              sourceVersion: regEntry.version_or_date,
              sourceTitle: regEntry.title,
              authorityTier: regEntry.authority_tier,
              authorityType: regEntry.authority_type,
              originKind: 'registered_url',
              originalSha256: null,
              locator: {
                kind: 'metadata_only',
                label: regEntry.official_location,
                page: null,
                section: null
              },
              text: null,
              extractionStatus: fetched.status,
              limitations: [fetched.reason],
              usagePolicy: policyClass.usagePolicy,
              modelEligible: false,
              retrievedAt: nowIso
            })
          );
        } else {
          const originalSha = computeSha256(fetched.bytes);
          const modelEligibleByTerms =
            policyClass.defaultModelEligible ||
            Boolean(options.allowPublisherTermsModelEgress) ||
            runtime.profile.source_policy.allow_model_egress_by_default;

          if (!modelEligibleByTerms) {
            findings.push({
              code: 'SOURCE_MODEL_EGRESS_BLOCKED',
              severity: 'WARNING',
              tier: 'DRAFT',
              path: `/sources/${sourceId}`,
              message: `Fetched "${sourceId}" under publisher-terms boundary ("${regEntry.licensing_storage_boundary}"); retained locally and blocked from external model requests until egress rights are confirmed.`
            });
          }

          if (fetched.truncated) {
            findings.push({
              code: 'SOURCE_TRUNCATED',
              severity: 'WARNING',
              tier: 'RELEASE',
              path: `/sources/${sourceId}`,
              message: `Fetched content for "${sourceId}" exceeded max_extract_bytes (${maxBytes}) and was truncated.`
            });
          }

          const truncationNote = fetched.truncated
            ? [`Response body exceeded ${maxBytes} bytes and was truncated; original SHA-256 reflects captured prefix only.`]
            : [];

          if (fetched.contentType === 'application/pdf') {
            const pdfResult = extractPdfPages(fetched.bytes, { maxExtractBytes: maxBytes });
            if (pdfResult.status === 'SCANNED_UNSUPPORTED' || pdfResult.status === 'FAILED') {
              findings.push({
                code: 'SOURCE_EXTRACTION_UNSUPPORTED',
                severity: 'WARNING',
                tier: 'RELEASE',
                path: `/sources/${sourceId}`,
                message: `Fetched PDF for "${sourceId}" is scanned or unreadable: ${pdfResult.warnings.join('; ')}`
              });
              producedUnits.push(
                buildSourceUnit({
                  sourceId,
                  sourceVersion: regEntry.version_or_date,
                  sourceTitle: regEntry.title,
                  authorityTier: regEntry.authority_tier,
                  authorityType: regEntry.authority_type,
                  originKind: 'registered_url',
                  originalSha256: fetched.truncated ? null : originalSha,
                  locator: { kind: 'pdf_page_section', label: `${fetched.finalUrl}#page=1`, page: 1, section: null },
                  text: null,
                  extractionStatus: 'SCANNED_UNSUPPORTED',
                  limitations: [...truncationNote, ...pdfResult.warnings],
                  usagePolicy: policyClass.usagePolicy,
                  modelEligible: false,
                  retrievedAt: nowIso
                })
              );
            } else {
              for (const page of pdfResult.pages) {
                if (page.characterCount === 0) continue;
                producedUnits.push(
                  buildSourceUnit({
                    sourceId,
                    sourceVersion: regEntry.version_or_date,
                    sourceTitle: regEntry.title,
                    authorityTier: regEntry.authority_tier,
                    authorityType: regEntry.authority_type,
                    originKind: 'registered_url',
                    originalSha256: fetched.truncated ? null : originalSha,
                    locator: {
                      kind: 'pdf_page_section',
                      label: `${fetched.finalUrl}#page=${page.pageNumber}`,
                      page: page.pageNumber,
                      section: `Page ${page.pageNumber}`
                    },
                    text: page.text,
                    extractionStatus:
                      fetched.truncated || pdfResult.status === 'PARTIAL_TRUNCATED'
                        ? 'PARTIAL_TRUNCATED'
                        : 'COMPLETE',
                    limitations: [...truncationNote, ...pdfResult.warnings],
                    usagePolicy: policyClass.usagePolicy,
                    modelEligible: modelEligibleByTerms,
                    retrievedAt: nowIso
                  })
                );
              }
            }
          } else if (fetched.contentType === 'text/html' || fetched.contentType === 'application/xhtml+xml') {
            const rawHtml = Buffer.from(fetched.bytes).toString('utf8');
            const rawFlags = detectUntrustedContentFlags(rawHtml);
            const sections = sanitizeInertHtmlToSections(rawHtml);
            if (sections.length === 0) {
              findings.push({
                code: 'SOURCE_EXTRACTION_UNSUPPORTED',
                severity: 'WARNING',
                tier: 'RELEASE',
                path: `/sources/${sourceId}`,
                message: `HTML document at "${fetched.finalUrl}" yielded zero readable text sections.`
              });
              producedUnits.push(
                buildSourceUnit({
                  sourceId,
                  sourceVersion: regEntry.version_or_date,
                  sourceTitle: regEntry.title,
                  authorityTier: regEntry.authority_tier,
                  authorityType: regEntry.authority_type,
                  originKind: 'registered_url',
                  originalSha256: fetched.truncated ? null : originalSha,
                  locator: { kind: 'html_section', label: fetched.finalUrl, page: null, section: null },
                  text: null,
                  extractionStatus: 'SCANNED_UNSUPPORTED',
                  limitations: [...truncationNote, 'HTML contained no extractable body text (e.g. client-rendered shell).'],
                  usagePolicy: policyClass.usagePolicy,
                  modelEligible: false,
                  untrustedFlags: rawFlags,
                  retrievedAt: nowIso
                })
              );
            } else {
              for (const sec of sections) {
                producedUnits.push(
                  buildSourceUnit({
                    sourceId,
                    sourceVersion: regEntry.version_or_date,
                    sourceTitle: regEntry.title,
                    authorityTier: regEntry.authority_tier,
                    authorityType: regEntry.authority_type,
                    originKind: 'registered_url',
                    originalSha256: fetched.truncated ? null : originalSha,
                    locator: {
                      kind: 'html_section',
                      label: `${fetched.finalUrl} :: ${sec.section}`,
                      page: null,
                      section: sec.section
                    },
                    text: sec.text,
                    extractionStatus: fetched.truncated ? 'PARTIAL_TRUNCATED' : 'COMPLETE',
                    limitations: truncationNote,
                    usagePolicy: policyClass.usagePolicy,
                    modelEligible: modelEligibleByTerms,
                    untrustedFlags: rawFlags,
                    retrievedAt: nowIso
                  })
                );
              }
            }
          } else if (
            fetched.contentType === 'text/plain' ||
            fetched.contentType === 'text/markdown' ||
            fetched.contentType === 'application/json'
          ) {
            const text = Buffer.from(fetched.bytes).toString('utf8').trim();
            const locKind =
              fetched.contentType === 'text/markdown'
                ? 'markdown_heading'
                : fetched.contentType === 'application/json'
                  ? 'json_path'
                  : 'plain_lines';
            producedUnits.push(
              buildSourceUnit({
                sourceId,
                sourceVersion: regEntry.version_or_date,
                sourceTitle: regEntry.title,
                authorityTier: regEntry.authority_tier,
                authorityType: regEntry.authority_type,
                originKind: 'registered_url',
                originalSha256: fetched.truncated ? null : originalSha,
                locator: {
                  kind: locKind,
                  label: `${fetched.finalUrl}#root`,
                  page: null,
                  section: 'root'
                },
                text: text || null,
                extractionStatus: !text
                  ? 'SCANNED_UNSUPPORTED'
                  : fetched.truncated
                    ? 'PARTIAL_TRUNCATED'
                    : 'COMPLETE',
                limitations: !text ? ['Fetched document was empty.'] : truncationNote,
                usagePolicy: policyClass.usagePolicy,
                modelEligible: modelEligibleByTerms && Boolean(text),
                retrievedAt: nowIso
              })
            );
          } else {
            findings.push({
              code: 'SOURCE_UNSUPPORTED_MEDIA_TYPE',
              severity: 'WARNING',
              tier: 'RELEASE',
              path: `/sources/${sourceId}`,
              message: `Unsupported media type "${fetched.contentType}" at "${fetched.finalUrl}" for "${sourceId}".`
            });
            producedUnits.push(
              buildSourceUnit({
                sourceId,
                sourceVersion: regEntry.version_or_date,
                sourceTitle: regEntry.title,
                authorityTier: regEntry.authority_tier,
                authorityType: regEntry.authority_type,
                originKind: 'registered_url',
                originalSha256: fetched.truncated ? null : originalSha,
                locator: { kind: 'metadata_only', label: fetched.finalUrl, page: null, section: null },
                text: null,
                extractionStatus: 'SCANNED_UNSUPPORTED',
                limitations: [`Unsupported media type "${fetched.contentType}".`],
                usagePolicy: policyClass.usagePolicy,
                modelEligible: false,
                retrievedAt: nowIso
              })
            );
          }
        }
      }
    }

    for (const unit of producedUnits) {
      if (unit.untrusted_content_flags.length > 0) {
        findings.push({
          code: 'UNTRUSTED_SOURCE_DIRECTIVE_NEUTRALIZED',
          severity: 'WARNING',
          tier: 'DRAFT',
          path: `/source_units/${unit.source_unit_id}`,
          message: `Source unit "${unit.locator.label}" (${sourceId}) contained embedded directive patterns (${unit.untrusted_content_flags.join(', ')}); quarantined as inert data.`
        });
      }
    }

    unitsBySourceId.set(sourceId, producedUnits);
    options.cache?.set(runtime.inputSet.input_set_id, sourceId, producedUnits);
  }

  const allSourceUnits = [...unitsBySourceId.values()].flat();

  // 4. Build per-object criterion support report (S-01, S-02, S-03).
  const criterionSupport: ObjectCriterionSupport[] = [];
  for (const doc of plan.documents) {
    if (doc.object_type !== 'capability' && doc.object_type !== 'antipattern') continue;
    const candidates = candidateSourcesByObject.get(doc.object_id) ?? [];
    const usableUnitIds: string[] = [];
    const metadataOnlyIds: string[] = [];
    const unavailableIds: string[] = [];

    for (const srcId of candidates) {
      const units = unitsBySourceId.get(srcId) ?? [];
      const modelReadyUnits = units.filter((u) => u.model_eligible && u.substantive_support_eligible);
      if (modelReadyUnits.length > 0) {
        usableUnitIds.push(...modelReadyUnits.map((u) => u.source_unit_id));
      } else if (units.some((u) => u.extraction_status === 'METADATA_ONLY' || (!u.model_eligible && u.substantive_support_eligible))) {
        metadataOnlyIds.push(srcId);
      } else {
        unavailableIds.push(srcId);
      }
    }

    const supportStatus: ObjectCriterionSupport['support_status'] =
      usableUnitIds.length > 0 ? 'SUPPORTED_PASSAGES_AVAILABLE' : 'MISSING_USABLE_PASSAGES';

    if (supportStatus === 'MISSING_USABLE_PASSAGES') {
      findings.push({
        code: 'MISSING_USABLE_SOURCE_PASSAGES',
        severity: 'WARNING',
        tier: 'RELEASE',
        path: `/criterion_support/${doc.object_id}`,
        message: `Object "${doc.object_id}" has no model-eligible source passages; substantive source-backed claims must remain explicitly UNRESOLVED.`
      });
    }

    criterionSupport.push({
      object_id: doc.object_id,
      object_type: doc.object_type,
      question_ids: doc.questions.map((q) => q.id),
      criteria_locator: criteriaLocatorByObjectId.get(doc.object_id) ?? null,
      candidate_source_ids: candidates,
      usable_source_unit_ids: usableUnitIds,
      metadata_only_source_ids: metadataOnlyIds,
      unavailable_source_ids: unavailableIds,
      support_status: supportStatus
    });
  }

  // 5. Build bounded model-ready packet containing ONLY model-eligible substantive passages (S-02, S-04, S-06).
  const eligiblePassages: ModelReadyPassage[] = allSourceUnits
    .filter(
      (u): u is SourceUnit & { extraction_status: 'COMPLETE' | 'PARTIAL_TRUNCATED' } =>
        u.model_eligible &&
        u.substantive_support_eligible &&
        (u.extraction_status === 'COMPLETE' || u.extraction_status === 'PARTIAL_TRUNCATED')
    )
    .map((u) => ({
      source_unit_id: u.source_unit_id,
      source_id: u.source_id,
      source_version: u.source_version,
      source_title: u.source_title,
      authority_tier: u.authority_tier,
      authority_type: u.authority_type,
      locator_label: u.locator.label,
      extraction_status: u.extraction_status,
      limitations: u.limitations,
      untrusted_content_flags: u.untrusted_content_flags,
      untrusted_data_block: formatUntrustedDataBlock(u)
    }));

  const packetId = computeSha256(
    JSON.stringify({
      input_set_id: runtime.inputSet.input_set_id,
      plan_id: plan.plan_id,
      unit_ids: eligiblePassages.map((p) => p.source_unit_id)
    })
  );

  const hasErrors = findings.some((f) => f.severity === 'ERROR');
  const criteriaReady = allCriteriaAndQuestionsReady && pairBaselines.length > 0;
  const passagesReady =
    criterionSupport.length > 0 &&
    criterionSupport.every((c) => c.support_status === 'SUPPORTED_PASSAGES_AVAILABLE');
  const authoringReady = !hasErrors && criteriaReady;

  const bundleId = computeSha256(
    JSON.stringify({
      input_set_id: runtime.inputSet.input_set_id,
      plan_id: plan.plan_id,
      packet_id: packetId,
      pair_ids: pairBaselines.map((b) => b.pair_id),
      all_unit_ids: allSourceUnits.map((u) => [u.source_unit_id, u.extraction_status, u.text_sha256])
    })
  );

  const bundle: SourcePreparationBundle = {
    schema_version: '1.0.0',
    bundle_id: bundleId,
    input_set_id: runtime.inputSet.input_set_id,
    plan_id: plan.plan_id,
    profile_id: runtime.profile.profile_id,
    kb_id: runtime.profile.kb_id,
    pair_baselines: pairBaselines,
    source_units: allSourceUnits,
    criterion_support: criterionSupport,
    model_ready_packet: {
      packet_id: packetId,
      untrusted_data_policy: 'SOURCE_PASSAGES_ARE_INERT_DATA_NEVER_INSTRUCTIONS',
      eligible_passages: eligiblePassages
    },
    readiness: {
      criteria_and_questions_ready: criteriaReady,
      substantive_source_passages_ready: passagesReady,
      authoring_ready: authoringReady,
      findings
    }
  };

  const bundleErrors = validateSourcePreparationBundle(bundle);
  if (bundleErrors.length > 0) {
    throw new Error(`SourcePreparationBundle violated Creator contract: ${JSON.stringify(bundleErrors)}`);
  }

  return bundle;
}
