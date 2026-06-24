import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { clearPortalAuditServerCache } from '@/lib/report/portal-audit-server';
import { requireBearerUser } from '@/lib/api/security';
import { flagPostSchema } from '@/lib/api/schemas/mutations';
import { canAccessOffice } from '@/lib/trhcalls/office-security';

export async function POST(request: NextRequest) {
  const auth = await requireBearerUser(request, {
    rbac: { pageId: 'mis_reports', tabId: 'register' },
  });
  if (!auth.ok) return auth.response;
  const { userId, security } = auth;

  if (security.forbidden || (!security.isHod && security.assignedOffices.length === 0)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = flagPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
    }

    const { call_id, office_id, flag_type, vtrnno } = parsed.data;

    if (!canAccessOffice(security.isHod, security.assignedOffices, office_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error: upsertError } = await supabaseAdmin
      .from('call_flags')
      .upsert(
        {
          call_id: String(call_id),
          office_id: String(office_id),
          vtrnno: vtrnno || null,
          flag_type,
          set_by: userId,
          set_at: new Date().toISOString(),
          is_active: true,
        },
        { onConflict: 'call_id' }
      );

    if (upsertError) {
      throw upsertError;
    }

    const { error: logError } = await supabaseAdmin.from('flag_audit_log').insert({
      call_id: String(call_id),
      office_id: String(office_id),
      new_flag: flag_type,
      changed_by: userId,
    });

    if (logError) {
      /* audit log failure is non-fatal */
    }

    clearPortalAuditServerCache();

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to set flag';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
