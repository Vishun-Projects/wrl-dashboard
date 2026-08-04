import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import {
  canManageMisEmailRouting,
  createMisEmailRoutingRule,
  deleteMisEmailRoutingRule,
  listMisEmailRoutingRules,
  updateMisEmailRoutingRule,
  type MisEmailRoutingRule,
} from '@/modules/mis-email/services/routing-rules';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logSecurityEventBestEffort, requestAuditContext } from '@/lib/security/audit';

function routingRuleSnapshot(rule: MisEmailRoutingRule) {
  const toEmails = rule.toEmails ?? [];
  const ccEmails = rule.ccEmails ?? [];
  return {
    zone: rule.zone ?? '',
    branch: rule.branch ?? '',
    client: rule.client ?? '',
    clientSourceMode: rule.clientSourceMode,
    scheduleAnchorTimeIst: rule.scheduleAnchorTimeIst,
    scheduleIntervalMinutes: rule.scheduleIntervalMinutes,
    scheduleDaysOfWeek: rule.scheduleDaysOfWeek ?? [],
    autoSendEnabled: rule.autoSendEnabled === true,
    toCount: toEmails.length,
    ccCount: ccEmails.length,
    toEmails,
    ccEmails,
  };
}

async function findRoutingRule(id: string): Promise<MisEmailRoutingRule | null> {
  const key = id.trim();
  if (!key) return null;
  const rules = await listMisEmailRoutingRules();
  return rules.find((r) => r.id === key) ?? null;
}

async function requireHodRoutingAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'mis_email_routing_unauthorized' });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const auth = await loadUserAuth(user.id);
  if (!auth) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 401,
      reason: 'mis_email_routing_unauthorized',
    });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (
    !canManageMisEmailRouting({
      role: auth.profile.role,
      office_ids: auth.profile.office_ids ?? [],
      permissions: auth.permissions,
    })
  ) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 403,
      reason: 'mis_email_routing_forbidden',
    });
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { auth, user };
}

export async function GET(request: Request) {
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;

  try {
    const rules = await listMisEmailRoutingRules();
    return NextResponse.json({ rules });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load routing rules');
  }
}

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;
  const audit = requestAuditContext(request);

  try {
    const body = await request.json();
    const rule = await createMisEmailRoutingRule({
      zone: body.zone,
      branch: body.branch,
      client: body.client,
      clientSourceMode: body.clientSourceMode,
      scheduleAnchorTimeIst: body.scheduleAnchorTimeIst,
      scheduleIntervalMinutes: body.scheduleIntervalMinutes,
      scheduleDaysOfWeek: body.scheduleDaysOfWeek,
      scheduleWindowStartIst: body.scheduleWindowStartIst,
      scheduleWindowEndIst: body.scheduleWindowEndIst,
      toEmailsCsv: String(body.toEmailsCsv ?? ''),
      ccEmailsCsv: String(body.ccEmailsCsv ?? ''),
      autoSendEnabled: body.autoSendEnabled === true,
    });
    const snap = routingRuleSnapshot(rule);
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_routing.create',
      result: 'success',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 201,
      targetType: 'mis_email_routing_rule',
      targetId: String(rule.id ?? ''),
      metadata: {
        summary: `Created routing rule · To ${snap.toCount} · Cc ${snap.ccCount}`,
        actionLabel: 'Created MIS email routing rule',
        after: snap,
      },
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create routing rule';
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_routing.create',
      result: 'failure',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 400,
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to create routing rule') }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;
  const audit = requestAuditContext(request);

  try {
    const body = await request.json();
    const ruleId = String(body.id ?? '');
    const before = await findRoutingRule(ruleId);
    const rule = await updateMisEmailRoutingRule({
      id: ruleId,
      zone: body.zone,
      branch: body.branch,
      client: body.client,
      clientSourceMode: body.clientSourceMode,
      scheduleAnchorTimeIst: body.scheduleAnchorTimeIst,
      scheduleIntervalMinutes: body.scheduleIntervalMinutes,
      scheduleDaysOfWeek: body.scheduleDaysOfWeek,
      scheduleWindowStartIst: body.scheduleWindowStartIst,
      scheduleWindowEndIst: body.scheduleWindowEndIst,
      toEmailsCsv: String(body.toEmailsCsv ?? ''),
      ccEmailsCsv: String(body.ccEmailsCsv ?? ''),
      autoSendEnabled: body.autoSendEnabled === true,
    });
    const after = routingRuleSnapshot(rule);
    const beforeSnap = before ? routingRuleSnapshot(before) : null;
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_routing.update',
      result: 'success',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'mis_email_routing_rule',
      targetId: ruleId,
      metadata: {
        summary: `Updated routing rule · To ${beforeSnap?.toCount ?? '?'} → ${after.toCount} · Cc ${beforeSnap?.ccCount ?? '?'} → ${after.ccCount}`,
        actionLabel: 'Updated MIS email routing rule',
        before: beforeSnap,
        after,
      },
    });
    return NextResponse.json({ rule });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update routing rule';
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_routing.update',
      result: 'failure',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 400,
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to update routing rule') }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;
  const audit = requestAuditContext(request);

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') ?? '';
    const before = await findRoutingRule(id);
    await deleteMisEmailRoutingRule(id);
    const beforeSnap = before ? routingRuleSnapshot(before) : null;
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_routing.delete',
      result: 'success',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 200,
      targetType: 'mis_email_routing_rule',
      targetId: id,
      metadata: {
        summary: beforeSnap
          ? `Deleted routing rule · To ${beforeSnap.toCount} · Cc ${beforeSnap.ccCount}`
          : 'Deleted MIS email routing rule',
        actionLabel: 'Deleted MIS email routing rule',
        before: beforeSnap,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete routing rule';
    await logSecurityEventBestEffort({
      eventType: 'admin.mis_email_routing.delete',
      result: 'failure',
      actorUserId: access.user.id,
      actorEmail: access.user.email ?? null,
      sessionId: audit.sessionId,
      route: audit.route,
      method: audit.method,
      ip: audit.ip,
      userAgent: audit.userAgent,
      statusCode: 400,
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to delete routing rule') }, { status: 400 });
  }
}
