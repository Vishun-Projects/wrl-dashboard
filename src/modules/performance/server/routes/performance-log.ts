import { NextRequest, NextResponse } from 'next/server';
import { getUserInfo } from '@/lib/auth/session';
import { canAccessPerformanceInsights } from '@/lib/auth/insights-access';
import { performanceLogEnabledServer } from '@/modules/performance/lib/log-config';
import {
  appendPerformanceLogEntries,
  readRecentPerformanceLogEntries,
} from '@/modules/performance/lib/log-server';
import type { PerformanceLogBatch, PerformanceLogEntry } from '@/modules/performance/lib/log-types';

function sanitizeEntry(entry: PerformanceLogEntry, userEmail: string | null): PerformanceLogEntry {
  return {
    ...entry,
    loggedAt: entry.loggedAt || new Date().toISOString(),
    userEmail: entry.userEmail ?? userEmail,
    environment:
      entry.environment ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV ||
      'unknown',
  };
}

export async function POST(req: NextRequest) {
  if (!performanceLogEnabledServer()) {
    return NextResponse.json({ ok: false, disabled: true, written: 0 });
  }

  const userInfo = await getUserInfo();
  if (!userInfo || !canAccessPerformanceInsights(userInfo.permissions)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: PerformanceLogBatch;
  try {
    body = (await req.json()) as PerformanceLogBatch;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const entries = (body.entries ?? [])
    .filter((e): e is PerformanceLogEntry => e != null && typeof e === 'object')
    .slice(0, 50)
    .map((entry) => sanitizeEntry(entry, userInfo.email ?? null));

  if (entries.length === 0) {
    return NextResponse.json({ ok: true, written: 0 });
  }

  const { written, file } = await appendPerformanceLogEntries(entries);
  return NextResponse.json({ ok: true, written, file });
}

export async function GET(req: NextRequest) {
  const userInfo = await getUserInfo();
  if (!userInfo || !canAccessPerformanceInsights(userInfo.permissions)) {
    // 404 (not 403): hide insights endpoints from non-privileged callers.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const limit = Math.min(
    Number(new URL(req.url).searchParams.get('limit') ?? 50) || 50,
    500
  );
  const { file, entries } = await readRecentPerformanceLogEntries(limit);

  return NextResponse.json({ file, entries });
}
