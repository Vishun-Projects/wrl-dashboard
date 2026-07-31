import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { canAccessPage } from '@/lib/auth/rbac-catalog';
import {
  createMajorRepairRepeatRecipient,
  deleteMajorRepairRepeatRecipient,
  listBranchOptionsForRecipients,
  listMajorRepairRepeatRecipients,
  updateMajorRepairRepeatRecipient,
} from '@/lib/read-model/major-repair-repeat-recipients';
import { assertSameOriginMutation } from '@/lib/api/same-origin';
import { jsonSafeError, safeErrorMessage } from '@/lib/api/safe-error';
import { logAccessDenied, logAction } from '@/lib/security/audit';

async function requireAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) {
    await logAccessDenied({ request, statusCode: 401, reason: 'major_repair_recipients_unauthorized' });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const auth = await loadUserAuth(user.id);
  if (!auth) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      statusCode: 401,
      reason: 'major_repair_recipients_unauthorized',
    });
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!canAccessPage(auth.permissions, 'major_repair_alerts')) {
    await logAccessDenied({
      request,
      actorUserId: user.id,
      actorEmail: auth.profile.email ?? null,
      statusCode: 403,
      reason: 'major_repair_recipients_forbidden',
    });
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return {
    auth,
    user,
    actor: {
      userId: user.id,
      email: auth.profile.email ?? user.email ?? null,
      name: auth.profile.name ?? null,
    },
  };
}

export async function GET(request: Request) {
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get('options') === '1') {
      const branches = await listBranchOptionsForRecipients();
      return NextResponse.json({ branches });
    }
    const recipients = await listMajorRepairRepeatRecipients();
    return NextResponse.json({ recipients });
  } catch (err: unknown) {
    return jsonSafeError(err, 500, 'Failed to load recipients');
  }
}

export async function POST(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const body = await request.json();
    const recipient = await createMajorRepairRepeatRecipient({
      branch: String(body.branch ?? ''),
      recipientName: String(body.recipientName ?? ''),
      email: String(body.email ?? ''),
      enabled: body.enabled === true,
    });
    await logAction({
      request,
      action: 'admin.major_repair_recipient.create',
      actor: access.actor,
      result: 'success',
      statusCode: 201,
      target: {
        type: 'major_repair_recipient',
        id: String((recipient as { id?: string }).id ?? ''),
        label: String(body.email ?? ''),
      },
      summary: `Created major-repair recipient ${String(body.email ?? '')}`,
      metadata: { branch: body.branch ?? null },
    });
    return NextResponse.json({ recipient }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create recipient';
    await logAction({
      request,
      action: 'admin.major_repair_recipient.create',
      actor: access.actor,
      result: 'failure',
      statusCode: 400,
      summary: 'Failed to create major-repair recipient',
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to create recipient') }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const body = await request.json();
    const recipient = await updateMajorRepairRepeatRecipient({
      id: String(body.id ?? ''),
      branch: String(body.branch ?? ''),
      recipientName: String(body.recipientName ?? ''),
      email: String(body.email ?? ''),
      enabled: body.enabled === true,
    });
    await logAction({
      request,
      action: 'admin.major_repair_recipient.update',
      actor: access.actor,
      result: 'success',
      statusCode: 200,
      target: {
        type: 'major_repair_recipient',
        id: String(body.id ?? ''),
        label: String(body.email ?? ''),
      },
      summary: `Updated major-repair recipient ${String(body.email ?? '')}`,
    });
    return NextResponse.json({ recipient });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update recipient';
    await logAction({
      request,
      action: 'admin.major_repair_recipient.update',
      actor: access.actor,
      result: 'failure',
      statusCode: 400,
      summary: 'Failed to update major-repair recipient',
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to update recipient') }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const originDenied = assertSameOriginMutation(request);
  if (originDenied) return originDenied;
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') ?? '';
    await deleteMajorRepairRepeatRecipient(id);
    await logAction({
      request,
      action: 'admin.major_repair_recipient.delete',
      actor: access.actor,
      result: 'success',
      statusCode: 200,
      target: { type: 'major_repair_recipient', id },
      summary: `Deleted major-repair recipient ${id}`,
    });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete recipient';
    await logAction({
      request,
      action: 'admin.major_repair_recipient.delete',
      actor: access.actor,
      result: 'failure',
      statusCode: 400,
      summary: 'Failed to delete major-repair recipient',
      metadata: { message },
    });
    return NextResponse.json({ error: safeErrorMessage(err, 'Failed to delete recipient') }, { status: 400 });
  }
}
