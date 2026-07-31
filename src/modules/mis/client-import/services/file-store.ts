import { mkdir, rmdir, unlink, writeFile, readFile } from 'fs/promises';
import path from 'path';

export function resolveImportDir(): string {
  if (process.env.MIS_CLIENT_IMPORT_DIR?.trim()) {
    return process.env.MIS_CLIENT_IMPORT_DIR.trim();
  }
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
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
