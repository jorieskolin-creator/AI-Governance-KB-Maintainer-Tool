import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const decision = z.object({ role: z.literal('tactic-playbook'), version: z.string().min(1), sha256: hash, scope: z.string().min(1) });
const inventory = z.object({
  files: z.array(z.object({ role: z.string().min(1), path: z.string().min(1), version: z.string().min(1), sha256: hash })),
  owner_decision: decision
});

export interface LocalSelection {
  /** Trusted workspace directory; never a client-supplied path. */
  workspace: string;
  inventoryPath: string;
  outputPath: string;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

async function selectedPath(root: string, path: string, label: string): Promise<string> {
  if (!path || isAbsolute(path) || /[\\:]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`${label}: expected a relative path inside the selected workspace (${path})`);
  }
  const actual = await realpath(resolve(root, path)).catch(() => {
    throw new Error(`${label}: missing or unreadable path ${path}`);
  });
  if (!within(root, actual)) throw new Error(`${label}: path escapes the selected workspace (${path})`);
  return actual;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label}: expected readable JSON`);
  }
}

export async function pinLocalInputs<Role extends string>(selection: LocalSelection, requiredRoles: readonly Role[]) {
  const root = await realpath(selection.workspace);
  const manifestPath = await selectedPath(root, selection.inventoryPath, 'input inventory');
  if (!(await stat(manifestPath)).isFile()) throw new Error('input inventory must be a regular file');
  const output = await selectedPath(root, selection.outputPath, 'output destination');
  if (!(await stat(output)).isDirectory() || within(output, manifestPath)) {
    throw new Error('output destination must be a separate directory, outside the selected inventory files');
  }
  await access(output, constants.W_OK | constants.X_OK).catch(() => {
    throw new Error(`output destination is not writable: ${selection.outputPath}`);
  });
  const spec = inventory.parse(parseJson(await readFile(manifestPath), 'input inventory'));
  const entries = new Map(spec.files.map(ref => [ref.role, ref]));
  if (entries.size !== spec.files.length) throw new Error('input inventory contains duplicate roles');
  const inputs = new Map<Role, Buffer>();
  const files = [];
  for (const role of requiredRoles) {
    const ref = entries.get(role);
    if (!ref) throw new Error(`input inventory is missing required role ${role}`);
    const target = await selectedPath(root, ref.path, role);
    if (within(output, target)) throw new Error(`${role}: input is inside the output destination (${ref.path})`);
    if (!(await stat(target)).isFile()) throw new Error(`${role}: not a regular input file (${ref.path})`);
    const bytes = await readFile(target);
    if (sha256(bytes) !== ref.sha256) throw new Error(`${role}: SHA-256 mismatch (${ref.path})`);
    inputs.set(role, bytes);
    files.push(ref);
  }
  const playbook = entries.get(spec.owner_decision.role);
  if (playbook?.version !== spec.owner_decision.version || playbook.sha256 !== spec.owner_decision.sha256) {
    throw new Error('owner decision does not bind to the selected playbook version and SHA-256');
  }
  const inputSetId = sha256(JSON.stringify([
    files.map(({ role, version, sha256 }) => [role, version, sha256]).sort(),
    spec.owner_decision
  ]));
  return {
    inputSetId,
    outputPath: selection.outputPath,
    files,
    ownerDecision: spec.owner_decision,
    text(role: Role): string { return inputs.get(role)!.toString('utf8'); },
    json(role: Role): unknown { return parseJson(inputs.get(role)!, role); }
  };
}
