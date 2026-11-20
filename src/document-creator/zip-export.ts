import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { CreatorRunRecord, DocumentPlan } from './contracts.js';
import { resolvePlannedDocumentRelativePath } from './delivery.js';
import { computeSha256, isSafeRelativeWorkspacePath } from './inputs.js';
import { getActiveRunRevisions } from './store.js';

export interface ZipInputEntry {
  path: string;
  content: string | Uint8Array;
  mtime?: Date;
}

export interface ZipDecodedEntry {
  path: string;
  compressed_size: number;
  uncompressed_size: number;
  crc32: number;
  sha256: string;
  content: Buffer;
  text: string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

function normalizeZipEntryPath(rawPath: string): string {
  const normalized = rawPath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!isSafeRelativeWorkspacePath(normalized)) {
    throw new Error(`Unsafe ZIP entry path "${rawPath}".`);
  }
  return normalized;
}

/**
 * Creates a deterministic, standards-compliant PKZIP archive buffer using DEFLATE (method 8)
 * and UTF-8 filename encoding (`0x0800`), with zero external npm dependencies.
 */
export function createZipArchive(entries: ReadonlyArray<ZipInputEntry>): Buffer {
  if (entries.length === 0) {
    throw new Error('Cannot create an empty ZIP archive; at least one file entry is required.');
  }
  if (entries.length > 65535) {
    throw new Error('ZIP archive exceeds standard 65,535 entry limit.');
  }

  const seenPaths = new Set<string>();
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;

  const defaultMtime = new Date('2026-11-20T00:00:00.000Z');

  for (const entry of entries) {
    const entryPath = normalizeZipEntryPath(entry.path);
    if (seenPaths.has(entryPath)) {
      throw new Error(`Duplicate ZIP entry path "${entryPath}".`);
    }
    seenPaths.add(entryPath);

    const nameBuf = Buffer.from(entryPath, 'utf8');
    const rawBuf =
      typeof entry.content === 'string'
        ? Buffer.from(entry.content, 'utf8')
        : Buffer.from(entry.content);
    const compressedBuf = deflateRawSync(rawBuf, { level: 9 });
    const crc = computeCrc32(rawBuf);
    const { dosTime, dosDate } = toDosDateTime(entry.mtime ?? defaultMtime);
    const utf8Flag = 0x0800;
    const compressionMethod = 8; // DEFLATE
    const versionNeeded = 20; // 2.0
    const versionMadeBy = 20;

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(versionNeeded, 4);
    localHeader.writeUInt16LE(utf8Flag, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedBuf.length, 18);
    localHeader.writeUInt32LE(rawBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(localHeader, 30);

    localChunks.push(localHeader, compressedBuf);

    // Central directory file header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(versionMadeBy, 4);
    centralHeader.writeUInt16LE(versionNeeded, 6);
    centralHeader.writeUInt16LE(utf8Flag, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedBuf.length, 20);
    centralHeader.writeUInt32LE(rawBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(localOffset, 42);
    nameBuf.copy(centralHeader, 46);

    centralChunks.push(centralHeader);
    localOffset += localHeader.length + compressedBuf.length;
  }

  const centralDirSize = centralChunks.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

/**
 * Reads and verifies a PKZIP archive buffer (checking EOCD, Central Directory, Local Headers, and CRC-32).
 */
export function readZipArchive(zipBuffer: Uint8Array): ZipDecodedEntry[] {
  const buf = Buffer.from(zipBuffer);
  if (buf.length < 22) {
    throw new Error('Invalid ZIP archive: buffer shorter than 22-byte EOCD record.');
  }

  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid ZIP archive: End of Central Directory signature not found.');
  }

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buf.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);

  if (centralDirOffset + centralDirSize > eocdOffset) {
    throw new Error('Invalid ZIP archive: Central Directory bounds exceed EOCD offset.');
  }

  const decoded: ZipDecodedEntry[] = [];
  let cursor = centralDirOffset;

  for (let idx = 0; idx < totalEntries; idx += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid Central Directory header signature at offset ${cursor}.`);
    }
    const method = buf.readUInt16LE(cursor + 10);
    const expectedCrc = buf.readUInt32LE(cursor + 16);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const path = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');

    if (buf.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Invalid Local File Header signature for "${path}".`);
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedSlice = buf.subarray(dataStart, dataStart + compressedSize);

    const content =
      method === 0
        ? Buffer.from(compressedSlice)
        : method === 8
          ? inflateRawSync(compressedSlice)
          : (() => {
              throw new Error(`Unsupported ZIP compression method ${method} for "${path}".`);
            })();

    if (content.length !== uncompressedSize) {
      throw new Error(
        `Uncompressed size mismatch for "${path}": expected ${uncompressedSize}, got ${content.length}.`
      );
    }
    const actualCrc = computeCrc32(content);
    if (actualCrc !== expectedCrc) {
      throw new Error(
        `CRC-32 mismatch for "${path}": expected ${expectedCrc.toString(16)}, got ${actualCrc.toString(16)}.`
      );
    }

    decoded.push({
      path,
      compressed_size: compressedSize,
      uncompressed_size: uncompressedSize,
      crc32: actualCrc,
      sha256: computeSha256(content),
      content,
      text: content.toString('utf8')
    });

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  return decoded;
}

export interface ZipExportResult {
  filename: string;
  zip_buffer: Buffer;
  zip_sha256: string;
  byte_count: number;
  entries: Array<{
    path: string;
    document_id?: string;
    object_id?: string;
    version?: string;
    byte_count: number;
    sha256: string;
  }>;
}

export function buildCreatorRunsZipExport(options: {
  runs: ReadonlyArray<CreatorRunRecord>;
  planByRunId: ReadonlyMap<string, DocumentPlan>;
  targetVersion?: string;
  requireApprovedSignoff?: boolean;
  exportedAt?: string;
}): ZipExportResult {
  const { runs, planByRunId } = options;
  if (runs.length === 0) {
    throw new Error('At least one Creator run is required to generate a ZIP export.');
  }

  const requireApproved = options.requireApprovedSignoff ?? true;
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const zipInputs: ZipInputEntry[] = [];
  const manifestFiles: ZipExportResult['entries'] = [];

  for (const run of runs) {
    const { capability, antipattern } = getActiveRunRevisions(run);
    if (!capability || !antipattern) {
      throw new Error(`Run "${run.run_id}" (${run.pair_id}) does not have active capability and anti-pattern revisions.`);
    }

    const signoff = run.checkpoints.human_review_signoff;
    if (requireApproved) {
      if (!signoff || signoff.invalidated_at) {
        throw new Error(
          `Run "${run.run_id}" (${run.pair_id}) must be human-reviewed and approved before generating an approved ZIP package.`
        );
      }
      if (
        signoff.capability_revision_id !== capability.revision_id ||
        signoff.antipattern_revision_id !== antipattern.revision_id
      ) {
        throw new Error(
          `Run "${run.run_id}" (${run.pair_id}) review sign-off does not match the active revisions.`
        );
      }
    }

    const plan = planByRunId.get(run.run_id);
    if (!plan) {
      throw new Error(`Missing DocumentPlan for run "${run.run_id}".`);
    }

    const capPlanDoc = plan.documents.find(
      (d) => d.object_type === 'capability' && d.object_id === capability.object_id
    );
    const apPlanDoc = plan.documents.find(
      (d) => d.object_type === 'antipattern' && d.object_id === antipattern.object_id
    );
    if (!capPlanDoc || !apPlanDoc) {
      throw new Error(`Planned document templates missing for "${run.pair_id}".`);
    }

    const capVersion = options.targetVersion ?? capability.document.document_version;
    const apVersion = options.targetVersion ?? antipattern.document.document_version;

    const capPath = resolvePlannedDocumentRelativePath(capPlanDoc, capVersion);
    const apPath = resolvePlannedDocumentRelativePath(apPlanDoc, apVersion);

    for (const item of [
      { path: capPath, rev: capability, version: capVersion },
      { path: apPath, rev: antipattern, version: apVersion }
    ]) {
      const mdBytes = Buffer.from(item.rev.rendered.markdown, 'utf8');
      zipInputs.push({
        path: item.path,
        content: mdBytes
      });
      manifestFiles.push({
        path: item.path,
        document_id: item.rev.document.document_id,
        object_id: item.rev.object_id,
        version: item.version,
        byte_count: mdBytes.length,
        sha256: item.rev.rendered.markdown_sha256
      });
    }

    if (run.checkpoints.completion_receipt) {
      const receiptPath = `_operations/${run.run_id}/completion-receipt.json`;
      const receiptText = `${JSON.stringify(run.checkpoints.completion_receipt, null, 2)}\n`;
      const receiptBytes = Buffer.from(receiptText, 'utf8');
      zipInputs.push({
        path: receiptPath,
        content: receiptBytes
      });
      manifestFiles.push({
        path: receiptPath,
        byte_count: receiptBytes.length,
        sha256: computeSha256(receiptBytes)
      });
    }
  }

  const firstRun = runs[0]!;
  const exportManifest = {
    export_schema_version: '1.0.0',
    exported_at: exportedAt,
    kb_id: firstRun.kb_id,
    profile_id: firstRun.profile_id,
    run_ids: runs.map((r) => r.run_id),
    pair_ids: runs.map((r) => r.pair_id),
    creation_review_status: requireApproved ? 'REVIEWED_FOR_DELIVERY' : 'DRAFT_EXPORT',
    hub_approval_status: 'NOT_GRANTED_BY_CREATOR',
    files: manifestFiles
  };

  const manifestPath = `_operations/zip-export-manifest.json`;
  const manifestBytes = Buffer.from(`${JSON.stringify(exportManifest, null, 2)}\n`, 'utf8');
  zipInputs.push({
    path: manifestPath,
    content: manifestBytes
  });
  manifestFiles.push({
    path: manifestPath,
    byte_count: manifestBytes.length,
    sha256: computeSha256(manifestBytes)
  });

  const zipBuffer = createZipArchive(zipInputs);
  const pairSlug =
    runs.length === 1 ? firstRun.pair_id : `${firstRun.profile_id}-${runs.length}-pairs`;

  return {
    filename: `${pairSlug}-markdown-documents.zip`,
    zip_buffer: zipBuffer,
    zip_sha256: computeSha256(zipBuffer),
    byte_count: zipBuffer.length,
    entries: manifestFiles
  };
}
