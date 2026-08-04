import { randomUUID } from 'crypto';
import { withAppClient } from '@/lib/read-model/db';
import { actionLabelFor } from '@/lib/security/audit-labels';
import { REQUEST_ID_HEADER } from '@/lib/observability/request-id';

export { ACTION_LABELS, actionLabelFor } from '@/lib/security/audit-labels';

export const AUDIT_SESSION_COOKIE = 'wrl_session_id';
const AUDIT_REDACT_KEYS = /(password|token|secret|cookie|authorization|apikey|api_key|refresh)/i;

export type SecurityAuditResult =
  | 'success'
  | 'failure'
  | 'denied'
  | 'started'
  | 'completed'
  | 'cancelled';

export type SecurityAuditEventInput = {
  eventType: string;
  result: SecurityAuditResult;
  actorUserId?: string | null;
  actorEmail?: string | null;
  sessionId?: string | null;
  route?: string | null;
  method?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type SessionAuditStartInput = {
  userId?: string | null;
  userEmail?: string | null;
  authMethod?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type RequestAuditContext = {
  route: string | null;
  method: string | null;
  ip: string | null;
  userAgent: string | null;
  sessionId: string | null;
  requestId: string | null;
};

function sanitizeText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

/** Skip DB writes under Vitest so route unit tests stay side-effect free. */
function auditWritesEnabled(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true';
}

function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = String(header ?? '');
  if (!raw) return out;
  for (const chunk of raw.split(';')) {
    const idx = chunk.indexOf('=');
    if (idx <= 0) continue;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}

function redactValue(value: unknown): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(redactValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = AUDIT_REDACT_KEYS.test(key) ? '[REDACTED]' : redactValue(raw);
  }
  return out;
}

/** Only accept UUID session cookies — ignore garbage / injection in Cookie header. */
function validSessionId(value: string | null | undefined): string | null {
  const text = sanitizeText(value);
  return text && /^[0-9a-f-]{36}$/i.test(text) ? text : null;
}

export function requestAuditContext(request: Request): RequestAuditContext {
  const url = new URL(request.url);
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip = sanitizeText(forwardedFor?.split(',')[0] ?? request.headers.get('x-real-ip'));
  const userAgent = sanitizeText(request.headers.get('user-agent'));
  const requestId = sanitizeText(request.headers.get(REQUEST_ID_HEADER));
  const cookieMap = parseCookieHeader(request.headers.get('cookie'));
  return {
    route: sanitizeText(url.pathname),
    method: sanitizeText(request.method),
    ip,
    userAgent,
    sessionId: validSessionId(cookieMap[AUDIT_SESSION_COOKIE]),
    requestId,
  };
}

export async function setAuditSessionCookie(sessionId: string): Promise<void> {
  // Dynamic import keeps next/headers out of the audit module graph for Vitest/route tests.
  const { cookies } = await import('next/headers');
  const { SESSION_MAX_AGE_SEC } = await import('@/lib/auth/session-policy');
  const cookieStore = await cookies();
  cookieStore.set(AUDIT_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export async function clearAuditSessionCookie(): Promise<void> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  cookieStore.set(AUDIT_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function logSecurityEvent(input: SecurityAuditEventInput): Promise<void> {
  if (!auditWritesEnabled()) return;
  const metadata = redactValue(input.metadata ?? {}) as Record<string, unknown>;
  await withAppClient(async (client) => {
    await client.query(
      `INSERT INTO public.security_audit_events (
        event_type, result, actor_user_id, actor_email, session_id, route, method, ip, user_agent,
        target_type, target_id, target_label, status_code, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        input.eventType,
        input.result,
        input.actorUserId ?? null,
        input.actorEmail ?? null,
        validSessionId(input.sessionId) ?? null,
        input.route ?? null,
        input.method ?? null,
        input.ip ?? null,
        input.userAgent ?? null,
        input.targetType ?? null,
        input.targetId ?? null,
        input.targetLabel ?? null,
        input.statusCode ?? null,
        JSON.stringify(metadata),
      ]
    );
  });
}

export async function logSecurityEventBestEffort(input: SecurityAuditEventInput): Promise<void> {
  try {
    await logSecurityEvent(input);
  } catch (err) {
    console.error('[security-audit] log failed:', err instanceof Error ? err.message : err);
  }
}

export async function startSessionAudit(input: SessionAuditStartInput): Promise<string> {
  const sessionId = randomUUID();
  if (!auditWritesEnabled()) return sessionId;
  const metadata = redactValue(input.metadata ?? {}) as Record<string, unknown>;
  await withAppClient(async (client) => {
    await client.query(
      `INSERT INTO public.auth_sessions (
        session_id, user_id, user_email, auth_method, ip, user_agent, status, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,'active',$7::jsonb)`,
      [
        sessionId,
        input.userId ?? null,
        input.userEmail ?? null,
        input.authMethod ?? 'password',
        input.ip ?? null,
        input.userAgent ?? null,
        JSON.stringify(metadata),
      ]
    );
  });
  return sessionId;
}

export async function finishSessionAudit(opts: {
  sessionId?: string | null;
  userId?: string | null;
  endedReason?: string | null;
  status?: string | null;
}): Promise<void> {
  const sessionId = validSessionId(opts.sessionId);
  if (!sessionId || !auditWritesEnabled()) return;
  await withAppClient(async (client) => {
    await client.query(
      `UPDATE public.auth_sessions
       SET ended_at = COALESCE(ended_at, now()),
           last_seen_at = now(),
           status = COALESCE($2, status),
           ended_reason = COALESCE($3, ended_reason),
           user_id = COALESCE($4, user_id)
       WHERE session_id = $1`,
      [sessionId, opts.status ?? 'ended', opts.endedReason ?? null, opts.userId ?? null]
    );
  });
}

export async function touchSessionAudit(sessionId?: string | null): Promise<void> {
  const normalized = validSessionId(sessionId);
  if (!normalized || !auditWritesEnabled()) return;
  await withAppClient(async (client) => {
    await client.query(
      `UPDATE public.auth_sessions SET last_seen_at = now() WHERE session_id = $1`,
      [normalized]
    );
  });
}

export async function logAccessDenied(opts: {
  request: Request;
  actorUserId?: string | null;
  actorEmail?: string | null;
  statusCode: 401 | 403;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const ctx = requestAuditContext(opts.request);
  await logSecurityEventBestEffort({
    eventType: 'auth.access.denied',
    result: 'denied',
    actorUserId: opts.actorUserId ?? null,
    actorEmail: opts.actorEmail ?? null,
    sessionId: ctx.sessionId,
    route: ctx.route,
    method: ctx.method,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    statusCode: opts.statusCode,
    metadata: {
      requestId: ctx.requestId,
      reason: opts.reason,
      ...(opts.metadata ?? {}),
    },
  });
}

export type AuditActor = {
  userId?: string | null;
  email?: string | null;
  name?: string | null;
};

export type AuditTarget = {
  type?: string | null;
  id?: string | null;
  label?: string | null;
};

export type LogActionInput = {
  /** Prefer a real Request; when omitted, pass route/method (e.g. VPS upload server). */
  request?: Request | null;
  action: string;
  actor: AuditActor;
  result: SecurityAuditResult;
  statusCode?: number | null;
  target?: AuditTarget | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  route?: string | null;
  method?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

/** Consistent who/what/when activity write for mutations, exports, and ops. */
export async function logAction(input: LogActionInput): Promise<void> {
  const ctx = input.request
    ? requestAuditContext(input.request)
    : {
        route: sanitizeText(input.route) ?? null,
        method: sanitizeText(input.method) ?? null,
        ip: sanitizeText(input.ip) ?? null,
        userAgent: sanitizeText(input.userAgent) ?? null,
        sessionId: null as string | null,
        requestId: null as string | null,
      };
  const summary =
    sanitizeText(input.summary) ??
    actionLabelFor(input.action);
  await logSecurityEventBestEffort({
    eventType: input.action,
    result: input.result,
    actorUserId: input.actor.userId ?? null,
    actorEmail: input.actor.email ?? null,
    sessionId: ctx.sessionId,
    route: ctx.route,
    method: ctx.method,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    targetLabel: input.target?.label ?? null,
    statusCode: input.statusCode ?? null,
    metadata: {
      requestId: ctx.requestId,
      summary,
      actorName: input.actor.name ?? null,
      actionLabel: actionLabelFor(input.action),
      ...(input.metadata ?? {}),
    },
  });
}

export type SecurityAuditListFilters = {
  eventType?: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  result?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number | null;
};

export async function listSecurityAuditEvents(filters: SecurityAuditListFilters) {
  if (!auditWritesEnabled()) return [];
  const clauses = ['1=1'];
  const values: unknown[] = [];
  let i = 1;

  if (sanitizeText(filters.eventType)) {
    clauses.push(`event_type = $${i++}`);
    values.push(sanitizeText(filters.eventType));
  }
  if (sanitizeText(filters.actorUserId)) {
    clauses.push(`actor_user_id = $${i++}`);
    values.push(sanitizeText(filters.actorUserId));
  }
  if (sanitizeText(filters.actorEmail)) {
    clauses.push(`lower(actor_email) = lower($${i++})`);
    values.push(sanitizeText(filters.actorEmail));
  }
  if (sanitizeText(filters.result)) {
    clauses.push(`result = $${i++}`);
    values.push(sanitizeText(filters.result));
  }
  if (sanitizeText(filters.from)) {
    clauses.push(`created_at >= $${i++}::timestamptz`);
    values.push(sanitizeText(filters.from));
  }
  if (sanitizeText(filters.to)) {
    clauses.push(`created_at <= $${i++}::timestamptz`);
    values.push(sanitizeText(filters.to));
  }

  const limit = Math.min(500, Math.max(1, Number(filters.limit ?? 100) || 100));
  values.push(limit);

  return withAppClient(async (client) => {
    const result = await client.query(
      `SELECT *
       FROM public.security_audit_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length}`,
      values
    );
    return result.rows;
  });
}

export async function deleteExpiredSecurityAuditData(retentionDays = 180): Promise<number> {
  if (!auditWritesEnabled()) return 0;
  return withAppClient(async (client) => {
    const result = await client.query(
      `DELETE FROM public.security_audit_events
       WHERE created_at < now() - ($1::text || ' days')::interval`,
      [retentionDays]
    );
    return result.rowCount ?? 0;
  });
}
