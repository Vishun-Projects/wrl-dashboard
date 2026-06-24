import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireSupabaseUser } from '@/lib/auth/server-user';
import {
  clearAddressGeocodeCache,
  getAddressGeocodeCacheCount,
} from '@/lib/geo/nominatim';
import { resolveReportSecurity } from '@/lib/auth/report-security';

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await requireSupabaseUser(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const security = await resolveReportSecurity(user.id, { pageId: 'location_audit' });
    if (security.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const count = await getAddressGeocodeCacheCount();
    return NextResponse.json({ count });
  } catch (err) {
    console.error('[location-audit/cache GET]', err);
    return NextResponse.json({ error: 'Failed to read cache' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient();
    const user = await requireSupabaseUser(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const security = await resolveReportSecurity(user.id, { pageId: 'location_audit' });
    if (security.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const deleted = await clearAddressGeocodeCache();
    return NextResponse.json({ cleared: true, deleted });
  } catch (err) {
    console.error('[location-audit/cache DELETE]', err);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
}
