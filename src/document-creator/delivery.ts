import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  validateDeliveryReceipt,
  type CreatorFinding,
  type CreatorRunRecord,
  type DeliveredFileRecord,
  type DeliveryReceipt,
  type DocumentPlan,
  type KbProfile,
  type PlannedDocument
} from './contracts.js';
import { computeSha256, isSafeRelativeWorkspacePath } from './inputs.js';
import type { ResolvedProfileRuntime } from './profiles.js';
import { getActiveRunRevisions, type CreatorRunStorePort } from './store.js';

export class DeliveryStorageError extends Error {
  readonly code: string;
  readonly findings: CreatorFinding[];

  constructor(code: string, message: string, findings: CreatorFinding[] = []) {
    super(message);
    this.name = 'DeliveryStorageError';
    this.code = code;
    this.findings = findings;
  }
}

const EXCLUDED_NON_DOCUMENT_PREFIXES = new Set([
  '_operations',
  'operations',
  'drafts',
  'inputs',
  'references',
  'schemas',
  'golden-reference',
  'golden',
  'Samples',
  'samples'
]);

const activeVersionReservations = new Set<string>();

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function isValidDeliveryVersionToken(version: string): boolean {
  if (!version || version.length > 64) return false;
  if (version === '.' || version === '..' || version.includes('..')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version);
}

export function resolvePlannedDocumentRelativePath(
  plannedDoc: PlannedDocument,
  version: string
): string {
  if (!isValidDeliveryVersionToken(version)) {
    throw new DeliveryStorageError(
      'INVALID_DELIVERY_VERSION',
      `Invalid delivery version token "${version}"; expected safe semver/version token without path separators or "..".`
    );
  }
  const resolved = plannedDoc.destination_path_template.replaceAll('{version}', version);
  if (!isSafeRelativeWorkspacePath(resolved)) {
    throw new DeliveryStorageError(
      'UNSAFE_DELIVERY_PATH',
      `Resolved delivery path "${resolved}" is not a safe relative path.`
    );
  }
  const segments = resolved.split('/');
  const firstSegment = segments[0] ?? '';
  if (EXCLUDED_NON_DOCUMENT_PREFIXES.has(firstSegment) || firstSegment.startsWith('_')) {
    throw new DeliveryStorageError(
      'RESERVED_NON_DOCUMENT_PREFIX',
      `Document path "${resolved}" cannot use reserved non-document prefix "${firstSegment}".`
    );
  }
  return resolved;
}

export interface ValidatedLocalDeliveryConnection {
  connectionId: string;
  provider: 'local';
  workspaceRealPath: string;
  outputRootRelative: string;
  operationsRootRelative: string;
  outputDirRealPath: string;
  operationsDirRealPath: string;
}

export async function validateDeliveryConnection(options: {
  workspaceRoot: string;
  profile: KbProfile;
}): Promise<ValidatedLocalDeliveryConnection> {
  const { profile } = options;
  const storageRef = profile.storage_ref;
  const rawProvider = String(storageRef.provider);

  if (/drive/i.test(rawProvider) || /drive/i.test(storageRef.connection_id)) {
    throw new DeliveryStorageError(
      'GOOGLE_DRIVE_EXCLUDED',
      'Google Drive storage connections, mirrors, and sync jobs are excluded from KB Document Creator.'
    );
  }

  if (storageRef.provider !== 'local') {
    throw new DeliveryStorageError(
      'REMOTE_STORAGE_NOT_CONFIGURED',
      `Remote storage provider "${storageRef.provider}" is not active in the local pilot; refusing local fallback.`
    );
  }

  // A pasted URL/link in location or output_root never grants write access (02-Contracts §5).
  if (
    /^https?:/i.test(storageRef.location) ||
    /^https?:/i.test(storageRef.output_root) ||
    /^https?:/i.test(storageRef.operations_root)
  ) {
    throw new DeliveryStorageError(
      'URL_LINK_DOES_NOT_GRANT_ACCESS',
      'A pasted URL/link in storage_ref does not configure or authorize a writable storage destination.'
    );
  }

  if (
    storageRef.credential_secret_ref !== null &&
    !/^[A-Z][A-Z0-9_]*$/.test(storageRef.credential_secret_ref)
  ) {
    throw new DeliveryStorageError(
      'INVALID_SECRET_REFERENCE',
      'storage_ref.credential_secret_ref must be null for local storage or an environment secret reference name (never a raw credential).'
    );
  }

  if (
    !isSafeRelativeWorkspacePath(storageRef.output_root) ||
    !isSafeRelativeWorkspacePath(storageRef.operations_root)
  ) {
    throw new DeliveryStorageError(
      'DESTINATION_PATH_UNSAFE',
      `Storage roots ("${storageRef.output_root}", "${storageRef.operations_root}") must be safe relative workspace paths.`
    );
  }

  const workspaceRealPath = await realpath(options.workspaceRoot);

  const ensureSafeDirectoryInsideWorkspace = async (
    relPath: string,
    allowCreateUnderParent?: string
  ): Promise<string> => {
    const lexical = resolve(workspaceRealPath, relPath);
    if (!isWithinRoot(workspaceRealPath, lexical)) {
      throw new DeliveryStorageError(
        'DESTINATION_OUTSIDE_WORKSPACE',
        `Destination "${relPath}" resolves outside workspace.`
      );
    }

    // Check every existing path segment for symlinks escaping workspaceRealPath.
    const segments = relPath.split('/');
    let currentLexical = workspaceRealPath;
    for (const seg of segments) {
      currentLexical = resolve(currentLexical, seg);
      const st = await lstat(currentLexical).catch(() => null);
      if (st) {
        const realSeg = await realpath(currentLexical);
        if (!isWithinRoot(workspaceRealPath, realSeg)) {
          throw new DeliveryStorageError(
            'DESTINATION_ESCAPES_WORKSPACE',
            `Destination "${relPath}" escapes workspace via symlink at "${seg}".`
          );
        }
      } else if (allowCreateUnderParent) {
        await mkdir(currentLexical, { recursive: true });
      } else {
        throw new DeliveryStorageError(
          'DESTINATION_UNAVAILABLE',
          `Destination directory "${relPath}" does not exist.`
        );
      }
    }

    const resolvedReal = await realpath(lexical);
    if (!isWithinRoot(workspaceRealPath, resolvedReal)) {
      throw new DeliveryStorageError(
        'DESTINATION_ESCAPES_WORKSPACE',
        `Destination "${relPath}" escapes workspace.`
      );
    }
    const info = await stat(resolvedReal);
    if (!info.isDirectory()) {
      throw new DeliveryStorageError(
        'DESTINATION_NOT_DIRECTORY',
        `Destination "${relPath}" is not a directory.`
      );
    }
    await access(resolvedReal, constants.W_OK | constants.X_OK);
    return resolvedReal;
  };

  const outputDirRealPath = await ensureSafeDirectoryInsideWorkspace(storageRef.output_root);
  const operationsDirRealPath = await ensureSafeDirectoryInsideWorkspace(
    storageRef.operations_root,
    outputDirRealPath
  );

  // Verify no configured input ref resides inside outputDirRealPath (O-07).
  for (const ref of profile.input_refs) {
    const refReal = await realpath(resolve(workspaceRealPath, ref.path)).catch(() => null);
    if (
      refReal &&
      (refReal === outputDirRealPath ||
        isWithinRoot(outputDirRealPath, refReal) ||
        refReal === operationsDirRealPath ||
        isWithinRoot(operationsDirRealPath, refReal))
    ) {
      throw new DeliveryStorageError(
        'INPUT_OVERLAPS_OUTPUT_ROOT',
        `Input role "${ref.role}" (${ref.path}) overlaps writable output/operations root.`
      );
    }
  }

  return {
    connectionId: storageRef.connection_id,
    provider: 'local',
    workspaceRealPath,
    outputRootRelative: storageRef.output_root,
    operationsRootRelative: storageRef.operations_root,
    outputDirRealPath,
    operationsDirRealPath
  };
}

async function resolveSafeTargetFileInsideRoot(
  rootDirReal: string,
  relativeFilePath: string,
  createMissingDirs: boolean
): Promise<string> {
  if (!isSafeRelativeWorkspacePath(relativeFilePath)) {
    throw new DeliveryStorageError(
      'UNSAFE_DELIVERY_PATH',
      `Rejected unsafe relative file path "${relativeFilePath}".`
    );
  }

  const lexicalTarget = resolve(rootDirReal, relativeFilePath);
  if (!isWithinRoot(rootDirReal, lexicalTarget) || lexicalTarget === rootDirReal) {
    throw new DeliveryStorageError(
      'PATH_OUTSIDE_CONFIGURED_ROOT',
      `Target path "${relativeFilePath}" escapes configured root.`
    );
  }

  const segments = relativeFilePath.split('/');
  const dirSegments = segments.slice(0, -1);
  let currentDir = rootDirReal;

  for (const seg of dirSegments) {
    const nextDir = resolve(currentDir, seg);
    if (!isWithinRoot(rootDirReal, nextDir)) {
      throw new DeliveryStorageError(
        'PATH_OUTSIDE_CONFIGURED_ROOT',
        `Directory segment "${seg}" escapes configured root.`
      );
    }
    const existingStat = await lstat(nextDir).catch(() => null);
    if (existingStat) {
      if (existingStat.isSymbolicLink()) {
        const symlinkTarget = await realpath(nextDir);
        if (!isWithinRoot(rootDirReal, symlinkTarget)) {
          throw new DeliveryStorageError(
            'SYMLINK_ESCAPE_REJECTED',
            `Directory "${seg}" in "${relativeFilePath}" is a symlink escaping configured root.`
          );
        }
      } else if (!existingStat.isDirectory()) {
        throw new DeliveryStorageError(
          'INVALID_TARGET_DIRECTORY',
          `Path segment "${seg}" in "${relativeFilePath}" is not a directory.`
        );
      }
    } else if (createMissingDirs) {
      await mkdir(nextDir);
    }
    currentDir = nextDir;
  }

  const existingFileStat = await lstat(lexicalTarget).catch(() => null);
  if (existingFileStat?.isSymbolicLink()) {
    throw new DeliveryStorageError(
      'SYMLINK_ESCAPE_REJECTED',
      `Target file "${relativeFilePath}" cannot be a symbolic link.`
    );
  }

  return lexicalTarget;
}

export interface StorageWriteHookContext {
  scope: 'output' | 'operations';
  relativePath: string;
  fileIndex: number;
}

export interface LocalDeliveryAdapterOptions {
  connection: ValidatedLocalDeliveryConnection;
  beforeWriteHook?: (ctx: StorageWriteHookContext) => Promise<void> | void;
}

export class LocalFilesystemDeliveryAdapter {
  private readonly connection: ValidatedLocalDeliveryConnection;
  private readonly beforeWriteHook?: (ctx: StorageWriteHookContext) => Promise<void> | void;

  constructor(options: LocalDeliveryAdapterOptions) {
    this.connection = options.connection;
    this.beforeWriteHook = options.beforeWriteHook;
  }

  private rootForScope(scope: 'output' | 'operations'): {
    realDir: string;
    relPrefix: string;
  } {
    return scope === 'output'
      ? {
          realDir: this.connection.outputDirRealPath,
          relPrefix: this.connection.outputRootRelative
        }
      : {
          realDir: this.connection.operationsDirRealPath,
          relPrefix: this.connection.operationsRootRelative
        };
  }

  async inspectExisting(
    scope: 'output' | 'operations',
    relativePath: string
  ): Promise<
    | {
        exists: true;
        bytes: Uint8Array;
        byteCount: number;
        sha256: string;
        storedObjectId: string;
      }
    | { exists: false }
  > {
    const { realDir, relPrefix } = this.rootForScope(scope);
    const fullPath = await resolveSafeTargetFileInsideRoot(realDir, relativePath, false);
    const st = await stat(fullPath).catch(() => null);
    if (!st || !st.isFile()) {
      return { exists: false };
    }
    const raw = await readFile(fullPath);
    const bytes = new Uint8Array(raw.byteLength);
    bytes.set(raw);
    return {
      exists: true,
      bytes,
      byteCount: bytes.byteLength,
      sha256: computeSha256(bytes),
      storedObjectId: `local:${relPrefix}/${relativePath}`
    };
  }

  async writeImmutableAndVerify(params: {
    scope: 'output' | 'operations';
    relativePath: string;
    bytes: Uint8Array;
    expectedSha256: string;
    fileIndex: number;
  }): Promise<{
    outcome: 'WRITTEN_AND_VERIFIED' | 'IDEMPOTENT_EXISTING';
    byteCount: number;
    sha256: string;
    storedObjectId: string;
  }> {
    const computedBefore = computeSha256(params.bytes);
    if (computedBefore !== params.expectedSha256) {
      throw new DeliveryStorageError(
        'PRE_WRITE_HASH_MISMATCH',
        `Pre-write SHA-256 mismatch for "${params.relativePath}": expected ${params.expectedSha256}, computed ${computedBefore}.`
      );
    }

    const { realDir, relPrefix } = this.rootForScope(params.scope);
    const reservationKey = `${realDir}:${params.relativePath}`;
    if (activeVersionReservations.has(reservationKey)) {
      throw new DeliveryStorageError(
        'CONCURRENT_VERSION_COLLISION',
        `Concurrent version reservation conflict for "${params.relativePath}".`
      );
    }

    activeVersionReservations.add(reservationKey);
    try {
      const existing = await this.inspectExisting(params.scope, params.relativePath);
      if (existing.exists) {
        if (
          existing.sha256 === params.expectedSha256 &&
          existing.byteCount === params.bytes.byteLength
        ) {
          return {
            outcome: 'IDEMPOTENT_EXISTING',
            byteCount: existing.byteCount,
            sha256: existing.sha256,
            storedObjectId: existing.storedObjectId
          };
        }
        throw new DeliveryStorageError(
          'VERSION_CONFLICT_EXISTING_BYTES_DIFFER',
          `Immutable version conflict at "${params.relativePath}": existing stored SHA-256 (${existing.sha256}) differs from candidate (${params.expectedSha256}). A new document version is required.`
        );
      }

      if (this.beforeWriteHook) {
        await this.beforeWriteHook({
          scope: params.scope,
          relativePath: params.relativePath,
          fileIndex: params.fileIndex
        });
      }

      const fullTarget = await resolveSafeTargetFileInsideRoot(realDir, params.relativePath, true);
      await writeFile(fullTarget, params.bytes, { flag: 'wx' });

      // Post-write readback verification (O-01): read actual stored bytes from destination!
      const readbackBuffer = await readFile(fullTarget);
      const readbackSha256 = computeSha256(readbackBuffer);
      if (
        readbackBuffer.byteLength !== params.bytes.byteLength ||
        readbackSha256 !== params.expectedSha256
      ) {
        throw new DeliveryStorageError(
          'POST_WRITE_READBACK_MISMATCH',
          `Post-write readback verification failed for "${params.relativePath}".`
        );
      }

      return {
        outcome: 'WRITTEN_AND_VERIFIED',
        byteCount: readbackBuffer.byteLength,
        sha256: readbackSha256,
        storedObjectId: `local:${relPrefix}/${params.relativePath}`
      };
    } finally {
      activeVersionReservations.delete(reservationKey);
    }
  }
}

function assertNoRestrictedSourceLeakage(
  markdown: string,
  objectId: string,
  runtime: ResolvedProfileRuntime,
  run: CreatorRunRecord
): void {
  const sourceBundle = run.checkpoints.source_bundle;
  if (!sourceBundle) return;

  for (const unit of sourceBundle.source_units) {
    if (!unit.model_eligible && unit.text && unit.text.trim().length >= 24) {
      const restrictedSnippet = unit.text.trim().slice(0, 120);
      if (markdown.includes(restrictedSnippet)) {
        throw new DeliveryStorageError(
          'RESTRICTED_SOURCE_WRITE_BLOCKED',
          `Refusing to deliver "${objectId}" because rendered Markdown contains restricted non-egress source text from "${unit.source_id}" (${unit.locator.label}) (S-06).`
        );
      }
    }
  }

  for (const binding of runtime.profile.reference_pdf_bindings ?? []) {
    if (!binding.rights_confirmed_for_model && markdown.includes(binding.path)) {
      throw new DeliveryStorageError(
        'RESTRICTED_SOURCE_WRITE_BLOCKED',
        `Refusing to deliver "${objectId}" referencing restricted local-only PDF "${binding.path}" (S-06).`
      );
    }
  }
}

export interface DeliverReviewedRunOptions {
  store: CreatorRunStorePort;
  workspaceRoot?: string;
  runtime: ResolvedProfileRuntime;
  plan: DocumentPlan;
  runId: string;
  targetVersion?: string;
  beforeWriteHook?: (ctx: StorageWriteHookContext) => Promise<void> | void;
  now?: () => Date;
}

export async function deliverReviewedCreatorRun(
  options: DeliverReviewedRunOptions
): Promise<{
  run: CreatorRunRecord;
  receipt: DeliveryReceipt;
  fileOutcomes: Array<{
    document_id: string;
    path: string;
    outcome: 'WRITTEN_AND_VERIFIED' | 'IDEMPOTENT_EXISTING';
  }>;
}> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const { store, runtime, plan } = options;

  const run = await store.getRun(options.runId);
  if (!run) {
    throw new DeliveryStorageError('RUN_NOT_FOUND', `Unknown Creator run "${options.runId}".`);
  }

  const { capability, antipattern } = getActiveRunRevisions(run);
  if (!capability || !antipattern) {
    throw new DeliveryStorageError(
      'MISSING_ACTIVE_REVISIONS',
      `Run "${run.run_id}" does not have active capability and anti-pattern revisions.`
    );
  }

  // Verify human creation review sign-off is present, not invalidated, and matches exact revision hashes (R-03).
  const signoff = run.checkpoints.human_review_signoff;
  if (!signoff) {
    throw new DeliveryStorageError(
      'REVIEW_REQUIRED_BEFORE_DELIVERY',
      `Run "${run.run_id}" cannot be delivered before human creation review sign-off is recorded.`
    );
  }
  if (signoff.invalidated_at) {
    throw new DeliveryStorageError(
      'STALE_REVIEW_INVALIDATED',
      `Run "${run.run_id}" human review was invalidated (${signoff.invalidation_reason ?? 'content modified'}); fresh review is required before delivery (R-03).`
    );
  }
  if (
    signoff.capability_revision_id !== capability.revision_id ||
    signoff.antipattern_revision_id !== antipattern.revision_id ||
    signoff.capability_content_sha256 !== capability.document.provenance.content_sha256 ||
    signoff.antipattern_content_sha256 !== antipattern.document.provenance.content_sha256
  ) {
    throw new DeliveryStorageError(
      'REVIEW_HASH_MISMATCH',
      `Run "${run.run_id}" active document revisions do not match the signed-off review hashes.`
    );
  }

  if (
    !capability.deterministic_validation.draft_valid ||
    !antipattern.deterministic_validation.draft_valid ||
    !capability.deterministic_validation.delivery_ready ||
    !antipattern.deterministic_validation.delivery_ready
  ) {
    throw new DeliveryStorageError(
      'DETERMINISTIC_BLOCKERS_OPEN',
      `Run "${run.run_id}" has open deterministic validation or unresolved blockers.`
    );
  }

  // O-07: Verify pinned input, schema, and Golden Reference files on disk are unchanged before delivery.
  const driftBefore = await runtime.pinned.checkSourceDrift();
  if (driftBefore.length > 0) {
    throw new DeliveryStorageError(
      'INPUT_INTEGRITY_VIOLATION',
      `Pinned input files drifted on disk before delivery: ${driftBefore.map((d) => d.message).join('; ')}`,
      driftBefore
    );
  }

  const connection = await validateDeliveryConnection({
    workspaceRoot,
    profile: runtime.profile
  });
  const adapter = new LocalFilesystemDeliveryAdapter({
    connection,
    beforeWriteHook: options.beforeWriteHook
  });

  const plannedCap = plan.documents.find((d) => d.object_id === capability.object_id);
  const plannedAp = plan.documents.find((d) => d.object_id === antipattern.object_id);
  if (!plannedCap || !plannedAp) {
    throw new DeliveryStorageError(
      'PLANNED_DOCUMENT_MISSING',
      `PlannedDocument records missing for "${capability.object_id}" / "${antipattern.object_id}".`
    );
  }

  const capVersion = options.targetVersion?.trim() || capability.document.document_version;
  const apVersion = options.targetVersion?.trim() || antipattern.document.document_version;

  const capRelPath = resolvePlannedDocumentRelativePath(plannedCap, capVersion);
  const apRelPath = resolvePlannedDocumentRelativePath(plannedAp, apVersion);

  // S-06: Verify neither rendered Markdown contains restricted non-egress source text.
  assertNoRestrictedSourceLeakage(
    capability.rendered.markdown,
    capability.object_id,
    runtime,
    run
  );
  assertNoRestrictedSourceLeakage(
    antipattern.rendered.markdown,
    antipattern.object_id,
    runtime,
    run
  );

  const itemsToDeliver = [
    {
      rev: capability,
      planned: plannedCap,
      version: capVersion,
      relativePath: capRelPath,
      bytes: new Uint8Array(Buffer.from(capability.rendered.markdown, 'utf8')),
      sha256: capability.rendered.markdown_sha256
    },
    {
      rev: antipattern,
      planned: plannedAp,
      version: apVersion,
      relativePath: apRelPath,
      bytes: new Uint8Array(Buffer.from(antipattern.rendered.markdown, 'utf8')),
      sha256: antipattern.rendered.markdown_sha256
    }
  ] as const;

  // Pre-check all target paths for version conflicts BEFORE writing any file (O-04).
  for (const item of itemsToDeliver) {
    const existing = await adapter.inspectExisting('output', item.relativePath);
    if (
      existing.exists &&
      (existing.sha256 !== item.sha256 || existing.byteCount !== item.bytes.byteLength)
    ) {
      throw new DeliveryStorageError(
        'VERSION_CONFLICT_EXISTING_BYTES_DIFFER',
        `Cannot deliver "${item.rev.object_id}" v${item.version} to "${item.relativePath}": existing stored bytes (${existing.sha256}) differ from reviewed bytes (${item.sha256}).`
      );
    }
  }

  run.state = 'DELIVERING';
  run.interruption_state = 'NONE';
  run.interruption_detail = null;
  run.checkpoints.delivered_files = run.checkpoints.delivered_files ?? [];
  run.checkpoints.completion_receipt = null;
  run.updated_at = now().toISOString();
  await store.saveRun(run);

  const deliveredFiles: DeliveredFileRecord[] = [];
  const fileOutcomes: Array<{
    document_id: string;
    path: string;
    outcome: 'WRITTEN_AND_VERIFIED' | 'IDEMPOTENT_EXISTING';
  }> = [];

  try {
    for (let i = 0; i < itemsToDeliver.length; i += 1) {
      const item = itemsToDeliver[i]!;
      const writeRes = await adapter.writeImmutableAndVerify({
        scope: 'output',
        relativePath: item.relativePath,
        bytes: item.bytes,
        expectedSha256: item.sha256,
        fileIndex: i
      });

      const fileRecord: DeliveredFileRecord = {
        document_id: item.planned.document_id,
        object_id: item.planned.object_id,
        object_type: item.planned.object_type,
        version: item.version,
        rendition: 'markdown',
        path: item.relativePath,
        media_type: 'text/markdown; charset=utf-8',
        byte_count: writeRes.byteCount,
        sha256: writeRes.sha256,
        stored_object_id: writeRes.storedObjectId,
        source_revision_id: item.rev.revision_id
      };

      deliveredFiles.push(fileRecord);
      fileOutcomes.push({
        document_id: item.planned.document_id,
        path: item.relativePath,
        outcome: writeRes.outcome
      });

      run.checkpoints.delivered_files = [...deliveredFiles];
      run.updated_at = now().toISOString();
      await store.saveRun(run);
    }
  } catch (error) {
    // O-02: Partial failure leaves previously uploaded file intact on disk, writes NO completion receipt,
    // and keeps run resumable/retryable!
    run.state = 'FAILED';
    run.interruption_detail =
      error instanceof Error
        ? `Partial delivery interrupted before completion receipt: ${error.message}`
        : 'Partial delivery interrupted before completion receipt.';
    run.checkpoints.completion_receipt = null;
    run.updated_at = now().toISOString();
    await store.saveRun(run);

    if (error instanceof DeliveryStorageError) {
      throw error;
    }
    throw new DeliveryStorageError(
      'PARTIAL_DELIVERY_FAILED',
      error instanceof Error ? error.message : String(error)
    );
  }

  // Write completion receipt LAST under operations_root/<run_id>/completion-receipt.json
  // (or <run_id>/<version>/completion-receipt.json if an earlier version receipt already exists for this run) (O-01, O-02, O-03, O-04, O-08).
  let receiptRelPath = `${run.run_id}/completion-receipt.json`;
  let existingReceiptOnDisk = await adapter.inspectExisting('operations', receiptRelPath);
  let preservedDeliveredAt: string | undefined;

  if (existingReceiptOnDisk.exists) {
    try {
      const parsedExisting = JSON.parse(
        Buffer.from(existingReceiptOnDisk.bytes).toString('utf8')
      ) as Partial<DeliveryReceipt>;
      if (
        typeof parsedExisting.delivered_at === 'string' &&
        JSON.stringify(parsedExisting.files) === JSON.stringify(deliveredFiles)
      ) {
        preservedDeliveredAt = parsedExisting.delivered_at;
      } else {
        // Earlier version receipt exists at root of <run_id>; store successor version receipt under <run_id>/<version>/completion-receipt.json!
        receiptRelPath = `${run.run_id}/${capVersion}/completion-receipt.json`;
        existingReceiptOnDisk = await adapter.inspectExisting('operations', receiptRelPath);
        if (existingReceiptOnDisk.exists) {
          const parsedVersioned = JSON.parse(
            Buffer.from(existingReceiptOnDisk.bytes).toString('utf8')
          ) as Partial<DeliveryReceipt>;
          if (
            typeof parsedVersioned.delivered_at === 'string' &&
            JSON.stringify(parsedVersioned.files) === JSON.stringify(deliveredFiles)
          ) {
            preservedDeliveredAt = parsedVersioned.delivered_at;
          }
        }
      }
    } catch {
      // Ignore malformed file; writeImmutableAndVerify will report conflict.
    }
  }

  const deliveredAt = preservedDeliveredAt ?? now().toISOString();
  const receipt: DeliveryReceipt = {
    receipt_schema_version: '1.0.0',
    run_id: run.run_id,
    kb_id: run.kb_id,
    profile_id: run.profile_id,
    input_set_id: run.input_set_id,
    plan_id: run.plan_id,
    reviewed_by: signoff.reviewed_by,
    reviewed_at: signoff.reviewed_at,
    delivered_at: deliveredAt,
    creation_review_status: 'REVIEWED_FOR_DELIVERY',
    hub_approval_status: 'NOT_GRANTED_BY_CREATOR',
    expected_document_ids: itemsToDeliver.map((item) => item.planned.document_id),
    files: deliveredFiles
  };

  const receiptValidation = validateDeliveryReceipt(receipt);
  if (receiptValidation.length > 0) {
    throw new DeliveryStorageError(
      'RECEIPT_CONTRACT_VIOLATION',
      `Constructed DeliveryReceipt failed schema validation: ${JSON.stringify(receiptValidation)}`,
      receiptValidation
    );
  }

  const receiptJsonBytes = new Uint8Array(
    Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  );
  const receiptSha256 = computeSha256(receiptJsonBytes);

  await adapter.writeImmutableAndVerify({
    scope: 'operations',
    relativePath: receiptRelPath,
    bytes: receiptJsonBytes,
    expectedSha256: receiptSha256,
    fileIndex: itemsToDeliver.length
  });

  // O-07: Verify pinned input, schema, and Golden Reference bytes remain untouched after delivery.
  const driftAfter = await runtime.pinned.checkSourceDrift();
  if (driftAfter.length > 0) {
    throw new DeliveryStorageError(
      'INPUT_INTEGRITY_VIOLATION',
      `Pinned input files were modified during delivery: ${driftAfter.map((d) => d.message).join('; ')}`,
      driftAfter
    );
  }

  run.checkpoints.completion_receipt = receipt;
  run.state = 'DELIVERED';
  run.interruption_state = 'NONE';
  run.interruption_detail = null;
  run.updated_at = deliveredAt;
  await store.saveRun(run);

  return {
    run,
    receipt,
    fileOutcomes
  };
}

export interface HandoffInspectionResult {
  completed_receipts: DeliveryReceipt[];
  ready_documents: DeliveredFileRecord[];
  excluded_non_document_prefixes: string[];
  unreceipted_partial_paths: string[];
}

/**
 * Inspects the configured output and operations roots for downstream handoff (`O-02`, `O-06`, `O-08`).
 * Admits ONLY documents listed in a verified completion receipt whose stored bytes match the receipt SHA-256,
 * and explicitly excludes `_operations/`, `drafts/`, `inputs/`, `schemas/`, `golden-reference/`, and unreceipted files.
 */
export async function inspectDeliveredHandoff(options: {
  workspaceRoot?: string;
  profile: KbProfile;
}): Promise<HandoffInspectionResult> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const connection = await validateDeliveryConnection({
    workspaceRoot,
    profile: options.profile
  });

  const completedReceipts: DeliveryReceipt[] = [];
  const receiptedByPath = new Map<string, DeliveredFileRecord>();

  const receiptFiles: string[] = [];
  const collectReceiptFiles = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        await collectReceiptFiles(full);
      } else if (entry.isFile() && entry.name === 'completion-receipt.json') {
        receiptFiles.push(full);
      }
    }
  };
  await collectReceiptFiles(connection.operationsDirRealPath);

  for (const receiptFile of receiptFiles) {
    const rawText = await readFile(receiptFile, 'utf8').catch(() => null);
    if (!rawText) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      continue;
    }

    if (validateDeliveryReceipt(parsed).length > 0) continue;
    const receipt = parsed as DeliveryReceipt;

    // Verify every expected_document_id is present and every file's stored bytes match receipt SHA-256.
    const fileDocIds = new Set(receipt.files.map((f) => f.document_id));
    if (!receipt.expected_document_ids.every((id) => fileDocIds.has(id))) {
      continue;
    }

    let allFilesVerified = true;
    for (const f of receipt.files) {
      const firstSeg = f.path.split('/')[0] ?? '';
      if (EXCLUDED_NON_DOCUMENT_PREFIXES.has(firstSeg) || firstSeg.startsWith('_')) {
        allFilesVerified = false;
        break;
      }
      const diskPath = resolve(connection.outputDirRealPath, f.path);
      const diskBytes = await readFile(diskPath).catch(() => null);
      if (
        !diskBytes ||
        diskBytes.byteLength !== f.byte_count ||
        computeSha256(diskBytes) !== f.sha256
      ) {
        allFilesVerified = false;
        break;
      }
    }

    if (allFilesVerified) {
      completedReceipts.push(receipt);
      for (const f of receipt.files) {
        receiptedByPath.set(f.path, f);
      }
    }
  }

  const excludedPrefixesFound = new Set<string>();
  const unreceiptedPartialPaths: string[] = [];

  const walkOutputDir = async (currentDir: string, relPrefix = ''): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const topSegment = relPath.split('/')[0] ?? '';

      if (EXCLUDED_NON_DOCUMENT_PREFIXES.has(topSegment) || topSegment.startsWith('_')) {
        excludedPrefixesFound.add(topSegment);
        continue;
      }

      const fullPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walkOutputDir(fullPath, relPath);
      } else if (entry.isFile()) {
        if (!receiptedByPath.has(relPath)) {
          unreceiptedPartialPaths.push(relPath);
        }
      }
    }
  };

  await walkOutputDir(connection.outputDirRealPath);

  return {
    completed_receipts: completedReceipts,
    ready_documents: [...receiptedByPath.values()],
    excluded_non_document_prefixes: [...excludedPrefixesFound].sort(),
    unreceipted_partial_paths: unreceiptedPartialPaths.sort()
  };
}
