import { createHash } from 'crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'fs/promises';
import path from 'path';

const CACHE_DIR = path.join(process.cwd(), '.cache', 'corpus');

export type CorpusDiskEntry = {
  timestamp: number;
  callCount: number;
  calls: Record<string, unknown>[];
};

function cacheFilePath(cacheKey: string): string {
  const hash = createHash('sha256').update(cacheKey).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

export async function readCorpusDiskCache(cacheKey: string): Promise<CorpusDiskEntry | null> {
  try {
    const filePath = cacheFilePath(cacheKey);
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as CorpusDiskEntry;
    if (!parsed?.calls || !Array.isArray(parsed.calls) || parsed.calls.length === 0) {
      return null;
    }
    return {
      timestamp: parsed.timestamp ?? 0,
      callCount: parsed.callCount ?? parsed.calls.length,
      calls: parsed.calls,
    };
  } catch {
    return null;
  }
}

export async function writeCorpusDiskCache(
  cacheKey: string,
  calls: Record<string, unknown>[]
): Promise<void> {
  if (calls.length === 0) return;

  await mkdir(CACHE_DIR, { recursive: true });
  const filePath = cacheFilePath(cacheKey);
  const tempPath = `${filePath}.tmp`;
  const payload: CorpusDiskEntry = {
    timestamp: Date.now(),
    callCount: calls.length,
    calls,
  };

  await writeFile(tempPath, JSON.stringify(payload), 'utf8');
  try {
    await unlink(filePath);
  } catch {
    // first write — no existing file
  }
  await rename(tempPath, filePath);
}
