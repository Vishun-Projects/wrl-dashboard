import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { readDimsFromPostgres } from '@/lib/read-model/flags';
import { queryOfficesFromPostgres } from '@/sql/read-model/dims';
import { createClient } from '@/lib/supabase/server';
import { resolveRequestUserId } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isHodUser } from '@/lib/auth/report-security';
import { resolveApiAccess } from '@/lib/auth/rbac-catalog';
import { safeErrorMessage } from '@/lib/api/safe-error';

// Process-local cache: remote mstoffice scans are slow.
type OfficeRow = { ncode: string; nunder: string };

let cachedAllOffices: OfficeRow[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000;

export async function GET(request: Request) {
  const supabase = await createClient();
  const userId = await resolveRequestUserId(request, supabase);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userAuth = await loadUserAuth(userId);
  const permissions = userAuth?.permissions ?? [];
  const canLoadOffices =
    permissions.includes('manage_users') ||
    resolveApiAccess(permissions, { pageId: 'mis_reports', shared: true });
  if (!canLoadOffices) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const profile = userAuth?.profile;
    const assignedOffices = (profile?.office_ids || []).map(String);
    const isHod = isHodUser(profile, permissions);

    if (readDimsFromPostgres()) {
      const offices = await queryOfficesFromPostgres(assignedOffices, isHod);
      return NextResponse.json(offices);
    }

    const now = Date.now();
    if (!cachedAllOffices || now - lastCacheTime > CACHE_TTL) {
      const officesRes = await postQuery({
        fields: 'ncode, vcompanyname, nunder',
        tableName: 'mstoffice',
        condition: '1=1',
        orderBy: 'vcompanyname ASC'
      });
      if (officesRes && officesRes.data) {
        cachedAllOffices = officesRes.data as OfficeRow[];
        lastCacheTime = now;
      }
    }

    const allOffices = cachedAllOffices || [];
    // Empty office_ids means unrestricted (same as HOD), not "no offices".
    const seeAllOffices = isHod || assignedOffices.length === 0;
    const filteredOffices = seeAllOffices
      ? allOffices
      : allOffices.filter(
          (office) =>
            assignedOffices.includes(String(office.ncode)) ||
            assignedOffices.includes(String(office.nunder))
        );

    return NextResponse.json(filteredOffices);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to load offices') },
      { status: 500 }
    );
  }
}
