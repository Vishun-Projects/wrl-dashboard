import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireRequestUser } from '@/lib/auth/server-user';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { listRepairMaster } from '@/lib/read-model/crm-masters';
import {
  filterRepairMasterForPicker,
  repairMasterToPicker,
  type RepairPickerItem,
} from '@/sql/repair/options';
import { jsonSafeError } from '@/lib/api/safe-error';

const REPAIR_CACHE_TTL = 60 * 60 * 1000;

let repairCache: { data: RepairPickerItem[]; timestamp: number } | null = null;
let repairInflight: Promise<RepairPickerItem[]> | null = null;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireRequestUser(req, supabase);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Shared by Serial Audit + Call Register Repair done picker.
    const serialAudit = await resolveReportSecurity(user.id, { pageId: 'serial_audit' });
    const register =
      serialAudit.forbidden
        ? await resolveReportSecurity(user.id, { pageId: 'mis_reports', tabId: 'register' })
        : null;
    if (serialAudit.forbidden && register?.forbidden) {
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
        source: 'crm_mstrepair',
        cached: true,
      });
    }

    if (!repairInflight) {
      repairInflight = (async () => {
        const master = await listRepairMaster();
        return repairMasterToPicker(filterRepairMasterForPicker(master));
      })();
    }
    try {
      const repairs = await repairInflight;
      repairCache = { data: repairs, timestamp: now };
      return NextResponse.json({
        repairs,
        source: 'crm_mstrepair',
        cached: false,
      });
    } finally {
      repairInflight = null;
    }
  } catch (err: unknown) {
    repairInflight = null;
    console.error('Serial Audit repairs API Error:', err);
    return jsonSafeError(err, 500, 'Failed to load repair types');
  }
}
