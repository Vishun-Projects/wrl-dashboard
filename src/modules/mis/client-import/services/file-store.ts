import { mkdir, readdir, rmdir, stat, unlink, writeFile, readFile } from 'fs/promises';
import path from 'path';

export function resolveImportDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MIS_CLIENT_IMPORT_DIR?.trim()) {
    return env.MIS_CLIENT_IMPORT_DIR.trim();
  }
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'mis-client-import');
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), '.cache', 'mis-client-import');
}

function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^\w.\-() ]+/g, '_');
  return base || 'upload.dat';
}

/** Join under import dir without NFT-walking the whole repo for dynamic segments. */
function absoluteUnderImportDir(...segments: string[]): string {
  return path.join(/*turbopackIgnore: true*/ resolveImportDir(), ...segments);
}

export function absoluteFromStoredPath(storedFilePath: string): string {
  const parts = storedFilePath
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '..')) {
    throw new Error('Invalid stored file path');
  }
  return absoluteUnderImportDir(...parts);
}

export function buildImportFilePath(
  sourceCode: string,
  batchId: string,
  fileName: string
): { absolutePath: string; storedFilePath: string } {
  const safeName = sanitizeFileName(fileName);
  const source = sourceCode.toLowerCase();
  const storedFilePath = path.posix.join(source, batchId, safeName);
  const absolutePath = absoluteUnderImportDir(source, batchId, safeName);
  return { absolutePath, storedFilePath };
}

export async function saveImportFile(params: {
  sourceCode: string;
  batchId: string;
  fileName: string;
  buffer: Buffer;
}): Promise<string> {
  const { absolutePath, storedFilePath } = buildImportFilePath(
    params.sourceCode,
    params.batchId,
    params.fileName
  );
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, params.buffer);
  return storedFilePath;
}

export async function readImportFile(storedFilePath: string): Promise<Buffer> {
  return readFile(absoluteFromStoredPath(storedFilePath));
}

export async function deleteImportFile(storedFilePath: string | null | undefined): Promise<void> {
  if (!storedFilePath?.trim()) return;
  const absolutePath = absoluteFromStoredPath(storedFilePath);
  try {
    await unlink(absolutePath);
  } catch {
    // file may already be gone
  }
  const batchDir = path.dirname(absolutePath);
  const sourceDir = path.dirname(batchDir);
  try {
    await rmdir(batchDir);
  } catch {
    /* not empty or already gone */
  }
  try {
    await rmdir(sourceDir);
  } catch {
    /* not empty or already gone */
  }
}

function extraSweepDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MIS_CLIENT_IMPORT_SWEEP_DIRS ?? '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}

async function sweepDirOlderThan(root: string, cutoffMs: number): Promise<number> {
  let deleted = 0;
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      deleted += await sweepDirOlderThan(full, cutoffMs);
      try {
        await rmdir(full);
      } catch {
        /* not empty */
      }
    } else if (ent.isFile()) {
      const st = await stat(full).catch(() => null);
      if (st && st.mtimeMs < cutoffMs) {
        await unlink(full).catch(() => undefined);
        deleted += 1;
      }
    }
  }
  return deleted;
}

/** Drop original upload files whose mtime is past retention. Catches orphans the DB no longer points at. */
export async function sweepImportFilesOlderThan(
  retentionDays: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const cutoffMs = Date.now() - retentionDays * 86_400_000;
  const roots = [...new Set([resolveImportDir(env), ...extraSweepDirs(env)])];
  let deleted = 0;
  for (const root of roots) {
    deleted += await sweepDirOlderThan(root, cutoffMs);
  }
  return deleted;
}
