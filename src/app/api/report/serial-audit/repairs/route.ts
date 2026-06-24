import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { postQuery } from '@/lib/db/proxy';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import {
  filterRepairMasterForPicker,
  repairMasterToPicker,
  type RepairMasterItem,
  type RepairPickerItem,
} from '@/lib/serial-audit/repair-options';
import { buildMstRepairMasterListSql } from '@/lib/trhcalls/query';

const REPAIR_CACHE_TTL = 60 * 60 * 1000;
const QUERY_TIMEOUT_MS = 60000;

let repairCache: { data: RepairPickerItem[]; timestamp: number } | null = null;
let repairInflight: Promise<RepairPickerItem[]> | null = null;

async function fetchMstRepairMaster(): Promise<RepairMasterItem[]> {
  const res = await postQuery({
    rawSql: buildMstRepairMasterListSql(),
    timeoutMs: QUERY_TIMEOUT_MS,
  });
  const rows = (res.data || []) as Record<string, unknown>[];
  const byKey = new Map<string, RepairMasterItem>();
  for (const row of rows) {
    const ncode = String(row.ncode ?? '').trim();
    const vname = String(row.vname ?? '').trim();
    if (!ncode || !vname) continue;
    const key = vname.trim().toLowerCase();
    if (!byKey.has(key)) byKey.set(key, { ncode, vname });
  }
  return [...byKey.values()];
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const security = await resolveReportSecurity(user.id, { pageId: 'serial_audit' });
    if (security.forbidden) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const bypassCache = new URL(req.url).searchParams.get('refresh') === 'true';
    const now = Date.now();
    if (bypassCache) repairCache = null;

    if (
      !bypassCache &&
      repairCache &&
      now - repairCache.timestamp < REPAIR_CACHE_TTL
    ) {
      return NextResponse.json({
        repairs: repairCache.data,
        source: 'mstrepair',
        cached: true,
      });
    }

    if (!repairInflight) {
      repairInflight = (async () => {
        const master = await fetchMstRepairMaster();
        return repairMasterToPicker(filterRepairMasterForPicker(master));
      })();
    }
    const repairs = await repairInflight;
    repairInflight = null;
    repairCache = { data: repairs, timestamp: now };

    return NextResponse.json({
      repairs,
      source: 'mstrepair',
      cached: false,
    });
  } catch (err: unknown) {
    console.error('Serial Audit repairs API Error:', err);
    const message = err instanceof Error ? err.message : 'Failed to load repair types';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
