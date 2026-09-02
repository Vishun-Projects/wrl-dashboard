import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAccessPage } from '@/lib/auth/rbac-catalog';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logAction } from '@/lib/security/audit';
import type { BranchRecipient } from '@/modules/mis-email/server/sync/branch-recipient-store';
import { listBranchOptionsForRecipients } from '@/modules/mis-email/server/sync/branch-recipient-store';

export type BranchRecipientRouteConfig = {
  pageId: string;
  unauthorizedReason: string;
  forbiddenReason: string;
  auditType: string;
  auditLabel: string;
  list: () => Promise<BranchRecipient[]>;
  get: (id: string) => Promise<BranchRecipient | null>;
  create: (input: {
    branch: string;
    recipientName: string;
    email: string;
    enabled?: boolean;
  }) => Promise<BranchRecipient>;
  update: (input: {
    id: string;
    branch: string;
    recipientName: string;
    email: string;
    enabled: boolean;
  }) => Promise<BranchRecipient>;
  remove: (id: string) => Promise<void>;
};

function recipientSnapshot(r: BranchRecipient) {
  return {
    branch: r.branch,
    recipientName: r.recipientName,
    email: r.email,
    enabled: r.enabled,
  };
}

export function createBranchRecipientRouteHandlers(config: BranchRecipientRouteConfig) {
  async function requireAccess(request: Request) {
    const supabase = await createClient();
    const user = await requireRequestUser(request, supabase);
    if (!user) {
      await logAccessDenied({ request, statusCode: 401, reason: config.unauthorizedReason });
      return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    const auth = await loadUserAuth(user.id);
    if (!auth) {
      await logAccessDenied({
        request,
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        statusCode: 401,
        reason: config.unauthorizedReason,
      });
      return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }

    if (!canAccessPage(auth.permissions, config.pageId)) {
      await logAccessDenied({
        request,
        actorUserId: user.id,
        actorEmail: auth.profile.email ?? null,
        statusCode: 403,
        reason: config.forbiddenReason,
      });
      return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }

    return {
      actor: {
        userId: user.id,
        email: auth.profile.email ?? user.email ?? null,
        name: auth.profile.name ?? null,
      },
    };
  }

  async function GET(request: Request) {
    const access = await requireAccess(request);
    if (access.error) return access.error;

    try {
      const { searchParams } = new URL(request.url);
      if (searchParams.get('options') === '1') {
        const branches = await listBranchOptionsForRecipients();
        return NextResponse.json({ branches });
      }
      const recipients = await config.list();
      return NextResponse.json({ recipients });
    } catch (err: unknown) {
      return jsonSafeError(err, 500, 'Failed to load recipients');
    }
  }

  async function POST(request: Request) {
    const originDenied = assertSameOriginMutation(request);
    if (originDenied) return originDenied;
    const access = await requireAccess(request);
    if (access.error) return access.error;

    try {
      const body = await request.json();
      const recipient = await config.create({
        branch: String(body.branch ?? ''),
        recipientName: String(body.recipientName ?? ''),
        email: String(body.email ?? ''),
        enabled: body.enabled === true,
      });
      await logAction({
        request,
        action: `admin.${config.auditType}.create`,
        actor: access.actor,
        result: 'success',
        statusCode: 201,
        target: {
          type: config.auditType,
          id: String(recipient.id ?? ''),
          label: recipient.email,
        },
        summary: `Created ${config.auditLabel} ${recipient.email}`,
        metadata: { after: recipientSnapshot(recipient) },
      });
      return NextResponse.json({ recipient }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create recipient';
      await logAction({
        request,
        action: `admin.${config.auditType}.create`,
        actor: access.actor,
        result: 'failure',
        statusCode: 400,
        summary: `Failed to create ${config.auditLabel}`,
        metadata: { message },
      });
      return NextResponse.json({ error: safeErrorMessage(err, 'Failed to create recipient') }, { status: 400 });
    }
  }

  async function PUT(request: Request) {
    const originDenied = assertSameOriginMutation(request);
    if (originDenied) return originDenied;
    const access = await requireAccess(request);
    if (access.error) return access.error;

    try {
      const body = await request.json();
      const id = String(body.id ?? '');
      const before = await config.get(id);
      const recipient = await config.update({
        id,
        branch: String(body.branch ?? ''),
        recipientName: String(body.recipientName ?? ''),
        email: String(body.email ?? ''),
        enabled: body.enabled === true,
      });
      const beforeSnap = before ? recipientSnapshot(before) : null;
      const afterSnap = recipientSnapshot(recipient);
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      if (beforeSnap) {
        for (const key of Object.keys(afterSnap) as (keyof typeof afterSnap)[]) {
          if (JSON.stringify(beforeSnap[key]) !== JSON.stringify(afterSnap[key])) {
            changes[key] = { old: beforeSnap[key], new: afterSnap[key] };
          }
        }
      }
      await logAction({
        request,
        action: `admin.${config.auditType}.update`,
        actor: access.actor,
        result: 'success',
        statusCode: 200,
        target: { type: config.auditType, id, label: recipient.email },
        summary: `Updated ${config.auditLabel} ${recipient.email}`,
        metadata: { before: beforeSnap, after: afterSnap, changes },
      });
      return NextResponse.json({ recipient });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update recipient';
      await logAction({
        request,
        action: `admin.${config.auditType}.update`,
        actor: access.actor,
        result: 'failure',
        statusCode: 400,
        summary: `Failed to update ${config.auditLabel}`,
        metadata: { message },
      });
      return NextResponse.json({ error: safeErrorMessage(err, 'Failed to update recipient') }, { status: 400 });
    }
  }

  async function DELETE(request: Request) {
    const originDenied = assertSameOriginMutation(request);
    if (originDenied) return originDenied;
    const access = await requireAccess(request);
    if (access.error) return access.error;

    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id') ?? '';
      const before = await config.get(id);
      await config.remove(id);
      const beforeSnap = before ? recipientSnapshot(before) : null;
      await logAction({
        request,
        action: `admin.${config.auditType}.delete`,
        actor: access.actor,
        result: 'success',
        statusCode: 200,
        target: { type: config.auditType, id, label: beforeSnap?.email ?? id },
        summary: beforeSnap
          ? `Deleted ${config.auditLabel} ${beforeSnap.email} (${beforeSnap.branch})`
          : `Deleted ${config.auditLabel} ${id}`,
        metadata: { before: beforeSnap },
      });
      return NextResponse.json({ success: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete recipient';
      await logAction({
        request,
        action: `admin.${config.auditType}.delete`,
        actor: access.actor,
        result: 'failure',
        statusCode: 400,
        summary: `Failed to delete ${config.auditLabel}`,
        metadata: { message },
      });
      return NextResponse.json({ error: safeErrorMessage(err, 'Failed to delete recipient') }, { status: 400 });
    }
  }

  return { GET, POST, PUT, DELETE };
}
