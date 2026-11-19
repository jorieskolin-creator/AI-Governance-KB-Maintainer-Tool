import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import {
  addAjvFormats,
  creatorFindingsFromAjv,
  type CreatorFinding,
  type KbProfile,
  type ProfileInputRef,
  type ResolvedInputDescriptor,
  type StrictnessTier
} from './contracts.js';

export function computeSha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isWithinRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function isSafeRelativeWorkspacePath(rawPath: string): boolean {
  if (!rawPath || isAbsolute(rawPath) || /[\\:]/.test(rawPath)) {
    return false;
  }
  const segments = rawPath.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

async function resolveExistingInsideWorkspace(
  workspaceRealPath: string,
  relativePath: string
): Promise<{ ok: true; realPath: string } | { ok: false; code: string; message: string }> {
  if (!isSafeRelativeWorkspacePath(relativePath)) {
    return {
      ok: false,
      code: 'UNSAFE_PATH_REJECTED',
      message: `Expected a safe relative path inside workspace; received "${relativePath}".`
    };
  }
  const lexicalTarget = resolve(workspaceRealPath, relativePath);
  if (!isWithinRoot(workspaceRealPath, lexicalTarget)) {
    return {
      ok: false,
      code: 'PATH_OUTSIDE_WORKSPACE',
      message: `Path "${relativePath}" resolves outside the configured workspace.`
    };
  }
  let actualPath: string;
  try {
    actualPath = await realpath(lexicalTarget);
  } catch {
    return {
      ok: false,
      code: 'PATH_MISSING',
      message: `Required path "${relativePath}" does not exist or cannot be resolved.`
    };
  }
  if (!isWithinRoot(workspaceRealPath, actualPath)) {
    return {
      ok: false,
      code: 'PATH_ESCAPES_WORKSPACE',
      message: `Path "${relativePath}" escapes the configured workspace via symlink.`
    };
  }
  return { ok: true, realPath: actualPath };
}

async function validateWritableScopedDirectory(
  workspaceRealPath: string,
  relativePath: string,
  allowMissingChildUnderOutputRoot?: string
): Promise<{ ok: true; resolvedDir: string } | { ok: false; code: string; message: string }> {
  if (!isSafeRelativeWorkspacePath(relativePath)) {
    return {
      ok: false,
      code: 'DESTINATION_PATH_UNSAFE',
      message: `Destination path "${relativePath}" is not a safe relative workspace path.`
    };
  }
  const lexicalTarget = resolve(workspaceRealPath, relativePath);
  if (!isWithinRoot(workspaceRealPath, lexicalTarget)) {
    return {
      ok: false,
      code: 'DESTINATION_OUTSIDE_WORKSPACE',
      message: `Destination "${relativePath}" is outside the configured workspace.`
    };
  }

  try {
    const actual = await realpath(lexicalTarget);
    if (!isWithinRoot(workspaceRealPath, actual)) {
      return {
        ok: false,
        code: 'DESTINATION_ESCAPES_WORKSPACE',
        message: `Destination "${relativePath}" escapes the configured workspace via symlink.`
      };
    }
    const info = await stat(actual);
    if (!info.isDirectory()) {
      return {
        ok: false,
        code: 'DESTINATION_NOT_DIRECTORY',
        message: `Destination "${relativePath}" must be a directory.`
      };
    }
    await access(actual, constants.W_OK | constants.X_OK);
    return { ok: true, resolvedDir: actual };
  } catch (error) {
    if (allowMissingChildUnderOutputRoot) {
      const parentCandidate = dirname(lexicalTarget);
      try {
        const actualParent = await realpath(parentCandidate);
        if (
          isWithinRoot(workspaceRealPath, actualParent) &&
          (actualParent === allowMissingChildUnderOutputRoot ||
            isWithinRoot(allowMissingChildUnderOutputRoot, actualParent))
        ) {
          await access(actualParent, constants.W_OK | constants.X_OK);
          return { ok: true, resolvedDir: resolve(actualParent, relative(parentCandidate, lexicalTarget)) };
        }
      } catch {
        // Fall through to structured error below.
      }
    }
    const code =
      error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EACCES'
        ? 'DESTINATION_NOT_WRITABLE'
        : 'DESTINATION_UNAVAILABLE';
    return {
      ok: false,
      code,
      message: `Destination "${relativePath}" is missing, escaped, or not writable.`
    };
  }
}

export interface PinnedInputSnapshot {
  descriptors: ResolvedInputDescriptor[];
  destinationReady: boolean;
  findings: CreatorFinding[];
  hasRole(role: string): boolean;
  bytes(role: string): Uint8Array;
  text(role: string): string;
  json(role: string): { ok: true; value: unknown } | { ok: false; finding: CreatorFinding };
  /** Re-reads disk bytes to verify whether any pinned input drifted after pinning (I-07). */
  checkSourceDrift(): Promise<CreatorFinding[]>;
}

export async function pinProfileInputs(options: {
  workspaceRoot: string;
  profile: KbProfile;
  tier?: StrictnessTier;
}): Promise<PinnedInputSnapshot> {
  const tier = options.tier ?? 'DRAFT';
  const findings: CreatorFinding[] = [];
  const descriptors: ResolvedInputDescriptor[] = [];
  const capturedBytes = new Map<string, Uint8Array>();
  const resolvedPaths = new Map<string, string>();

  const workspaceRealPath = await realpath(options.workspaceRoot);

  // Remote storage or remote input refs never fall back silently to local files (I-08).
  if (options.profile.storage_ref.provider !== 'local') {
    findings.push({
      code: 'REMOTE_STORAGE_NOT_CONFIGURED',
      severity: 'ERROR',
      tier,
      path: '/storage_ref/provider',
      message: `Remote storage provider "${options.profile.storage_ref.provider}" is not active in the local pilot; refusing local fallback.`
    });
  }

  let outputDirReal: string | undefined;
  let destinationReady = false;

  if (options.profile.storage_ref.provider === 'local') {
    const outputCheck = await validateWritableScopedDirectory(
      workspaceRealPath,
      options.profile.storage_ref.output_root
    );
    if (!outputCheck.ok) {
      findings.push({
        code: outputCheck.code,
        severity: 'ERROR',
        tier,
        path: '/storage_ref/output_root',
        message: outputCheck.message
      });
    } else {
      outputDirReal = outputCheck.resolvedDir;
      const operationsCheck = await validateWritableScopedDirectory(
        workspaceRealPath,
        options.profile.storage_ref.operations_root,
        outputDirReal
      );
      if (!operationsCheck.ok) {
        findings.push({
          code: operationsCheck.code,
          severity: 'ERROR',
          tier,
          path: '/storage_ref/operations_root',
          message: operationsCheck.message
        });
      } else {
        destinationReady = true;
      }
    }
  }

  const seenRoles = new Set<string>();
  const allowedInputRoots = options.profile.source_policy.allowed_input_roots
    .filter(isSafeRelativeWorkspacePath)
    .map((entry) => resolve(workspaceRealPath, entry));

  for (let index = 0; index < options.profile.input_refs.length; index += 1) {
    const ref: ProfileInputRef = options.profile.input_refs[index]!;
    const refPath = `/input_refs/${index}`;

    if (seenRoles.has(ref.role)) {
      findings.push({
        code: 'DUPLICATE_INPUT_ROLE',
        severity: 'ERROR',
        tier,
        path: `${refPath}/role`,
        message: `Profile declares duplicate input role "${ref.role}".`
      });
      continue;
    }
    seenRoles.add(ref.role);

    if (ref.store !== 'local') {
      findings.push({
        code: 'REMOTE_INPUT_STORE_NOT_CONFIGURED',
        severity: 'ERROR',
        tier,
        path: `${refPath}/store`,
        message: `Input role "${ref.role}" requires remote store "${ref.store}"; local fallback is forbidden.`
      });
      continue;
    }

    const resolved = await resolveExistingInsideWorkspace(workspaceRealPath, ref.path);
    if (!resolved.ok) {
      findings.push({
        code: resolved.code === 'PATH_MISSING' ? 'INPUT_MISSING' : resolved.code,
        severity: ref.required ? 'ERROR' : 'WARNING',
        tier,
        path: `${refPath}/path`,
        message: `Input role "${ref.role}" (${ref.path}): ${resolved.message}`
      });
      continue;
    }

    if (
      allowedInputRoots.length > 0 &&
      !allowedInputRoots.some((allowed) => resolved.realPath === allowed || isWithinRoot(allowed, resolved.realPath))
    ) {
      findings.push({
        code: 'INPUT_OUTSIDE_ALLOWED_ROOT',
        severity: 'ERROR',
        tier,
        path: `${refPath}/path`,
        message: `Input role "${ref.role}" (${ref.path}) is outside source_policy.allowed_input_roots.`
      });
      continue;
    }

    if (outputDirReal && (resolved.realPath === outputDirReal || isWithinRoot(outputDirReal, resolved.realPath))) {
      findings.push({
        code: 'INPUT_OVERLAPS_OUTPUT_ROOT',
        severity: 'ERROR',
        tier,
        path: `${refPath}/path`,
        message: `Input role "${ref.role}" (${ref.path}) cannot reside inside the writable output_root.`
      });
      continue;
    }

    let rawBytes: Buffer;
    try {
      const info = await stat(resolved.realPath);
      if (!info.isFile()) {
        findings.push({
          code: 'INPUT_NOT_REGULAR_FILE',
          severity: 'ERROR',
          tier,
          path: `${refPath}/path`,
          message: `Input role "${ref.role}" (${ref.path}) is not a regular file.`
        });
        continue;
      }
      await access(resolved.realPath, constants.R_OK);
      rawBytes = await readFile(resolved.realPath);
    } catch {
      findings.push({
        code: 'INPUT_UNREADABLE',
        severity: ref.required ? 'ERROR' : 'WARNING',
        tier,
        path: `${refPath}/path`,
        message: `Input role "${ref.role}" (${ref.path}) could not be read.`
      });
      continue;
    }

    const actualHash = computeSha256(rawBytes);
    if (actualHash !== ref.sha256) {
      findings.push({
        code: 'INPUT_SHA256_MISMATCH',
        severity: 'ERROR',
        tier,
        path: `${refPath}/sha256`,
        message: `Input role "${ref.role}" (${ref.path}) SHA-256 mismatch: expected ${ref.sha256}, computed ${actualHash}.`
      });
      continue;
    }

    // Store an immutable copy in memory so later file edits on disk never alter active pinned bytes (I-07).
    const frozenCopy = new Uint8Array(rawBytes.byteLength);
    frozenCopy.set(rawBytes);
    capturedBytes.set(ref.role, frozenCopy);
    resolvedPaths.set(ref.role, resolved.realPath);
    descriptors.push({
      role: ref.role,
      kind: ref.kind,
      id: ref.id,
      version: ref.version,
      store: ref.store,
      path: ref.path,
      media_type: ref.media_type,
      byte_length: frozenCopy.byteLength,
      sha256: actualHash,
      provenance: ref.provenance
    });
  }

  return {
    descriptors,
    destinationReady,
    findings,
    hasRole(role: string): boolean {
      return capturedBytes.has(role);
    },
    bytes(role: string): Uint8Array {
      const stored = capturedBytes.get(role);
      if (!stored) {
        throw new Error(`Pinned input role "${role}" is not available.`);
      }
      const copy = new Uint8Array(stored.byteLength);
      copy.set(stored);
      return copy;
    },
    text(role: string): string {
      const stored = capturedBytes.get(role);
      if (!stored) {
        throw new Error(`Pinned input role "${role}" is not available.`);
      }
      return Buffer.from(stored).toString('utf8');
    },
    json(role: string) {
      const stored = capturedBytes.get(role);
      if (!stored) {
        return {
          ok: false,
          finding: {
            code: 'INPUT_ROLE_UNAVAILABLE',
            severity: 'ERROR',
            tier,
            path: `/inputs/${role}`,
            message: `Pinned input role "${role}" is unavailable.`
          }
        };
      }
      try {
        return { ok: true, value: JSON.parse(Buffer.from(stored).toString('utf8')) as unknown };
      } catch {
        return {
          ok: false,
          finding: {
            code: 'INVALID_JSON_INPUT',
            severity: 'ERROR',
            tier,
            path: `/inputs/${role}`,
            message: `Input role "${role}" is not valid UTF-8 JSON.`
          }
        };
      }
    },
    async checkSourceDrift(): Promise<CreatorFinding[]> {
      const driftFindings: CreatorFinding[] = [];
      for (const descriptor of descriptors) {
        const diskPath = resolvedPaths.get(descriptor.role);
        if (!diskPath) continue;
        try {
          const current = await readFile(diskPath);
          const currentHash = computeSha256(current);
          if (currentHash !== descriptor.sha256) {
            driftFindings.push({
              code: 'INPUT_DRIFT_DURING_RUN',
              severity: 'WARNING',
              tier,
              path: `/resolved_inputs/${descriptor.role}`,
              message: `Disk file for "${descriptor.role}" (${descriptor.path}) changed from ${descriptor.sha256} to ${currentHash}; active run continues using verified pinned bytes only.`
            });
          }
        } catch {
          driftFindings.push({
            code: 'INPUT_MISSING_AFTER_PIN',
            severity: 'WARNING',
            tier,
            path: `/resolved_inputs/${descriptor.role}`,
            message: `Disk file for "${descriptor.role}" (${descriptor.path}) became unreadable after pinning; active run continues only with captured verified bytes.`
          });
        }
      }
      return driftFindings;
    }
  };
}

export interface CompiledSchemaRegistry {
  findings: CreatorFinding[];
  validateAgainstRole(schemaRole: string, targetRole: string, candidate: unknown): CreatorFinding[];
}

export function compilePinnedSchemaFamily(
  schemas: ReadonlyArray<{ role: string; schema: unknown }>,
  tier: StrictnessTier = 'DRAFT'
): CompiledSchemaRegistry {
  const findings: CreatorFinding[] = [];
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addAjvFormats(ajv);

  const schemaIdByRole = new Map<string, string>();
  const roleBySchemaId = new Map<string, string>();

  for (const entry of schemas) {
    if (typeof entry.schema !== 'object' || entry.schema === null || Array.isArray(entry.schema)) {
      findings.push({
        code: 'SCHEMA_NOT_OBJECT',
        severity: 'ERROR',
        tier,
        path: `/schemas/${entry.role}`,
        message: `Schema role "${entry.role}" must be a JSON object.`
      });
      continue;
    }
    const rawId = (entry.schema as { $id?: unknown }).$id;
    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      findings.push({
        code: 'SCHEMA_MISSING_ID',
        severity: 'ERROR',
        tier,
        path: `/schemas/${entry.role}/$id`,
        message: `Schema role "${entry.role}" must declare a non-empty $id for offline reference resolution.`
      });
      continue;
    }
    const existingRole = roleBySchemaId.get(rawId);
    if (existingRole) {
      findings.push({
        code: 'SCHEMA_DUPLICATE_ID',
        severity: 'ERROR',
        tier,
        path: `/schemas/${entry.role}/$id`,
        message: `Schema role "${entry.role}" duplicates $id "${rawId}" already registered by "${existingRole}".`
      });
      continue;
    }
    try {
      ajv.addSchema(entry.schema, rawId);
      schemaIdByRole.set(entry.role, rawId);
      roleBySchemaId.set(rawId, entry.role);
    } catch (error) {
      findings.push({
        code: 'SCHEMA_REGISTRATION_FAILED',
        severity: 'ERROR',
        tier,
        path: `/schemas/${entry.role}`,
        message: error instanceof Error ? error.message : `Failed to register schema "${entry.role}".`
      });
    }
  }

  const validatorCache = new Map<string, ValidateFunction>();

  return {
    findings,
    validateAgainstRole(schemaRole: string, targetRole: string, candidate: unknown): CreatorFinding[] {
      const schemaId = schemaIdByRole.get(schemaRole);
      if (!schemaId) {
        return [
          {
            code: 'SCHEMA_UNAVAILABLE',
            severity: 'ERROR',
            tier,
            path: `/inputs/${targetRole}`,
            message: `Cannot validate "${targetRole}" because schema role "${schemaRole}" failed to load.`
          }
        ];
      }
      let validator = validatorCache.get(schemaRole);
      if (!validator) {
        try {
          validator = ajv.getSchema(schemaId);
        } catch (error) {
          return [
            {
              code: 'SCHEMA_UNRESOLVED_REF',
              severity: 'ERROR',
              tier,
              path: `/schemas/${schemaRole}`,
              message:
                error instanceof Error
                  ? `Offline schema compilation failed for "${schemaRole}": ${error.message}`
                  : `Offline schema compilation failed for "${schemaRole}".`
            }
          ];
        }
        if (!validator) {
          return [
            {
              code: 'SCHEMA_COMPILER_MISSING',
              severity: 'ERROR',
              tier,
              path: `/schemas/${schemaRole}`,
              message: `Schema "${schemaRole}" ($id "${schemaId}") could not be compiled offline.`
            }
          ];
        }
        validatorCache.set(schemaRole, validator);
      }

      const ok = validator(candidate) === true;
      if (ok) return [];
      return creatorFindingsFromAjv(validator.errors, tier).map((finding) => ({
        ...finding,
        code: 'PINNED_SCHEMA_VALIDATION_FAILED',
        path: `/inputs/${targetRole}${finding.path === '/' ? '' : finding.path}`,
        message: `[${targetRole} vs ${schemaRole}] ${finding.message}`
      }));
    }
  };
}
