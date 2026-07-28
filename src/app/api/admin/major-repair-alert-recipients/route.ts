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

async function requireAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const auth = await loadUserAuth(user.id);
  if (!auth) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  if (!canAccessPage(auth.permissions, 'major_repair_alerts')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { auth };
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
    const message = err instanceof Error ? err.message : 'Failed to load recipients';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    return NextResponse.json({ recipient }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create recipient';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
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
    return NextResponse.json({ recipient });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update recipient';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const access = await requireAccess(request);
  if (access.error) return access.error;

  try {
    const { searchParams } = new URL(request.url);
    await deleteMajorRepairRepeatRecipient(searchParams.get('id') ?? '');
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete recipient';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
