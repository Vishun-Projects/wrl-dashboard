import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  clearAddressGeocodeCache,
  getAddressGeocodeCacheCount,
} from '@/lib/geo/nominatim';
import { resolveLocationAuditSecurity } from '@/lib/location-audit/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const security = await resolveLocationAuditSecurity(user.id);
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const security = await resolveLocationAuditSecurity(user.id);
    if (security.forbidden) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const deleted = await clearAddressGeocodeCache();
    return NextResponse.json({ cleared: true, deleted });
  } catch (err) {
    console.error('[location-audit/cache DELETE]', err);
    return NextResponse.json({ error: 'Failed to clear cache' }, { status: 500 });
  }
}
