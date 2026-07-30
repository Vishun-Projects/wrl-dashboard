import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import {
  logAccessDenied,
  logAction,
  type SecurityAuditResult,
} from '@/lib/security/audit';

const ALLOWED_ACTIONS = new Set([
  'report.export.start',
  'report.export.complete',
  'report.export.cancelled',
  'report.export.failure',
]);

const ALLOWED_RESULTS = new Set<SecurityAuditResult>([
  'started',
  'completed',
  'cancelled',
  'failure',
  'success',
]);

/** Authenticated beacon for browser-side exports that never hit a server export route. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'client_audit_unauthorized' });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Action not allowed' }, { status: 400 });
  }

  const resultRaw = String(body.result ?? 'completed') as SecurityAuditResult;
  const result = ALLOWED_RESULTS.has(resultRaw) ? resultRaw : 'completed';
  const reportName = typeof body.reportName === 'string' ? body.reportName : null;
  const format = typeof body.format === 'string' ? body.format : null;
  const filename = typeof body.filename === 'string' ? body.filename : null;
  const summary =
    typeof body.summary === 'string' && body.summary.trim()
      ? body.summary.trim()
      : null;
  const rowCount =
    typeof body.rowCount === 'number' && Number.isFinite(body.rowCount)
      ? body.rowCount
      : null;
  const filters =
    body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
      ? (body.filters as Record<string, unknown>)
      : null;
  const metadataExtra =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  const userAuth = await loadUserAuth(user.id);
  await logAction({
    request,
    action,
    actor: {
      userId: user.id,
      email: userAuth?.profile?.email ?? user.email ?? null,
      name: userAuth?.profile?.name ?? null,
    },
    result,
    statusCode: result === 'failure' ? 500 : result === 'cancelled' ? 499 : 200,
    target: {
      type: 'client_export',
      label: filename ?? reportName,
    },
    summary:
      summary ??
      (filename ? `Client export ${filename}` : `Client export (${action})`),
    metadata: {
      reportName,
      format,
      rowCount,
      filters,
      clientSide: true,
      ...metadataExtra,
    },
  });

  return NextResponse.json({ ok: true });
}
