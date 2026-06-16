import fs from 'fs/promises';
import path from 'path';
import type { PerformanceLogEntry } from '@/lib/performance/log-types';
import { performanceLogDir, performanceLogEnabledServer } from '@/lib/performance/log-config';

function dailyLogPath(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return path.join(process.cwd(), performanceLogDir(), `metrics-${y}-${m}-${d}.jsonl`);
}

async function ensureLogDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function appendPerformanceLogEntries(
  entries: PerformanceLogEntry[]
): Promise<{ written: number; file: string }> {
  if (!performanceLogEnabledServer() || entries.length === 0) {
    return { written: 0, file: '' };
  }

  const file = dailyLogPath();
  await ensureLogDir(file);

  const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  await fs.appendFile(file, lines, 'utf8');

  return { written: entries.length, file };
}

export async function readRecentPerformanceLogEntries(
  limit = 100
): Promise<{ file: string | null; entries: PerformanceLogEntry[] }> {
  const file = dailyLogPath();
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const slice = lines.slice(-limit);
    const entries = slice.map((line) => JSON.parse(line) as PerformanceLogEntry);
    return { file, entries };
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'ENOENT'
    ) {
      return { file: null, entries: [] };
    }
    throw err;
  }
}
