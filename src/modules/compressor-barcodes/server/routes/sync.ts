import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { loadUserAuth } from '@/lib/auth/load-user-auth';
import { isSuperAdmin } from '@/lib/auth/rbac-catalog';
import { syncCompressorBarcodesToPostgres } from '@/modules/compressor-barcodes/server/sync/postgres-sync';
import { toUserFacingError } from '@/lib/utils/user-facing-errors';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const auth = await loadUserAuth(user.id);
    const permissions = auth?.permissions || [];
    const hasAccess =
      isSuperAdmin(permissions) ||
      permissions.includes('page_mis_reports') ||
      permissions.includes('manage_roles');

    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden - Insufficient permissions to run sync' }, { status: 403 });
    }

    const result = await syncCompressorBarcodesToPostgres();

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('Sync API Error:', err);
    return NextResponse.json({ error: toUserFacingError(err) }, { status: 500 });
  }
}
