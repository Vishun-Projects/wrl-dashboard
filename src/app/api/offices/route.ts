import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { postQuery } from '@/lib/db-proxy';
import { prisma } from '@/lib/prisma';

// Global cache to optimize mstoffice retrieval and avoid slow remote DB scans
let cachedAllOffices: any[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const permissions = await (prisma as any).getUserPermissions(user.id);

    const result = await prisma.$queryRawUnsafe(
      'SELECT office_ids, role FROM public.app_users WHERE id = $1 LIMIT 1',
      user.id
    );
    const profile = (result as any[])?.[0];
    const assignedOffices = (profile?.office_ids || []).map(String);

    const isHod = 
      permissions.includes('view_all_offices') || 
      ['super_admin', 'hod', 'Super Admin', 'Office Administrator', 'Account Auditor'].includes(profile?.role || '');

    const now = Date.now();
    if (!cachedAllOffices || now - lastCacheTime > CACHE_TTL) {
      const officesRes = await postQuery({
        fields: 'ncode, vcompanyname, nunder',
        tableName: 'mstoffice',
        condition: '1=1',
        orderBy: 'vcompanyname ASC'
      });
      if (officesRes && officesRes.data) {
        cachedAllOffices = officesRes.data;
        lastCacheTime = now;
      }
    }

    const allOffices = cachedAllOffices || [];
    const filteredOffices = isHod 
      ? allOffices 
      : allOffices.filter((o: any) => assignedOffices.includes(String(o.ncode)) || assignedOffices.includes(String(o.nunder)));

    return NextResponse.json(filteredOffices);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
