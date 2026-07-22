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
} from '@/features/mis-email/lib/routing-rules';

async function requireHodRoutingAccess(request: Request) {
  const supabase = await createClient();
  const user = await requireRequestUser(request, supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const auth = await loadUserAuth(user.id);
  if (!auth) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  if (
    !canManageMisEmailRouting({
      role: auth.profile.role,
      office_ids: auth.profile.office_ids ?? [],
      permissions: auth.permissions,
    })
  ) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { auth };
}

export async function GET(request: Request) {
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;

  try {
    const rules = await listMisEmailRoutingRules();
    return NextResponse.json({ rules });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load routing rules';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;

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
      autoSendEnabled: body.autoSendEnabled !== false,
    });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create routing rule';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;

  try {
    const body = await request.json();
    const rule = await updateMisEmailRoutingRule({
      id: String(body.id ?? ''),
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
      autoSendEnabled: body.autoSendEnabled !== false,
    });
    return NextResponse.json({ rule });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update routing rule';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const access = await requireHodRoutingAccess(request);
  if (access.error) return access.error;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') ?? '';
    await deleteMisEmailRoutingRule(id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to delete routing rule';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
