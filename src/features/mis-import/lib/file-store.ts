import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';

export function resolveImportDir(): string {
  if (process.env.MIS_CLIENT_IMPORT_DIR?.trim()) {
    return process.env.MIS_CLIENT_IMPORT_DIR.trim();
  }
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'mis-client-import');
  }
  return path.join(process.cwd(), '.cache', 'mis-client-import');
}

function sanitizeFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/[^\w.\-() ]+/g, '_');
  return base || 'upload.dat';
}

export function buildImportFilePath(
  sourceCode: string,
  batchId: string,
  fileName: string
): { absolutePath: string; storedFilePath: string } {
  const importDir = resolveImportDir();
  const safeName = sanitizeFileName(fileName);
  const storedFilePath = path.join(sourceCode.toLowerCase(), batchId, safeName);
  const absolutePath = path.join(importDir, storedFilePath);
  return { absolutePath, storedFilePath: storedFilePath.replace(/\\/g, '/') };
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
  const { readFile } = await import('fs/promises');
  const absolutePath = path.join(resolveImportDir(), storedFilePath);
  return readFile(absolutePath);
}

export async function deleteImportFile(storedFilePath: string | null | undefined): Promise<void> {
  if (!storedFilePath?.trim()) return;
  const absolutePath = path.join(resolveImportDir(), storedFilePath);
  try {
    await unlink(absolutePath);
  } catch {
    // file may already be gone
  }
}
