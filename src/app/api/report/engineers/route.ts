import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { readDimsFromPostgres } from '@/lib/read-model/flags';
import { resolveReportSecurity } from '@/lib/auth/report-security';
import { resolveUserIdFromAccessToken } from '@/lib/auth/server-user';
import {
  queryEngineerRowsFromPostgres,
  queryEngineersFromPostgres,
} from '@/lib/read-model/queries/dims';

export type EngineerRosterEntry = {
  ncode: string;
  vname: string;
  nofficeid?: string | null;
};

async function queryRosterEngineersFromCrm(params: {
  branchId?: string | null;
  branchName?: string | null;
}): Promise<EngineerRosterEntry[]> {
  const { branchId, branchName } = params;

  let officeCondition: string;
  if (branchId) {
    const idSafe = branchId.replace(/'/g, "''");
    officeCondition = `(o.ncode = '${idSafe}' OR o.nunder = '${idSafe}')`;
  } else if (branchName) {
    const branchSafe = branchName.replace(/'/g, "''");
    officeCondition = `o.vcompanyname = '${branchSafe}'`;
  } else {
    return [];
  }

  const res = await postQuery({
    fields: 'DISTINCT u.ncode, u.vname, u.nofficeid',
    tableName: 'mstusers u (NOLOCK) JOIN mstoffice o (NOLOCK) ON u.nofficeid = o.ncode',
    condition: `${officeCondition} AND u.bactive = 'True' AND u.vname IS NOT NULL AND u.vname <> '' ORDER BY u.vname ASC`,
  });

  const byCode = new Map<string, EngineerRosterEntry>();
  for (const row of res.data || []) {
    const ncode = row.ncode != null ? String(row.ncode) : '';
    if (!ncode) continue;
    const vname = String(row.vname ?? '').trim();
    if (!vname) continue;
    byCode.set(ncode, {
      ncode,
      vname,
      nofficeid: row.nofficeid != null ? String(row.nofficeid) : null,
    });
  }
  return Array.from(byCode.values());
}

async function queryEngineersFromCallsCrm(params: {
  branchId?: string | null;
  branchName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<EngineerRosterEntry[]> {
  const { branchId, branchName, startDate, endDate } = params;

  let officeCondition: string;
  if (branchId) {
    const idSafe = branchId.replace(/'/g, "''");
    officeCondition = `(o.ncode = '${idSafe}' OR o.nunder = '${idSafe}')`;
  } else if (branchName) {
    const branchSafe = branchName.replace(/'/g, "''");
    officeCondition = `o.vcompanyname = '${branchSafe}'`;
  } else {
    return [];
  }

  let condition = `${officeCondition} AND u.vname IS NOT NULL AND u.vname <> ''`;
  if (startDate && endDate) {
    condition += ` AND tc.dtrndate >= '${startDate}' AND tc.dtrndate <= '${endDate} 23:59:59'`;
  }

  const res = await postQuery({
    fields: 'DISTINCT u.ncode, u.vname as serviceman, u.nofficeid',
    tableName:
      'trhcalls tc (NOLOCK) JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode',
    condition: `${condition} ORDER BY serviceman ASC`,
  });

  const byCode = new Map<string, EngineerRosterEntry>();
  for (const row of res.data || []) {
    const ncode = row.ncode != null ? String(row.ncode) : '';
    if (!ncode) continue;
    const vname = String(row.serviceman ?? '').trim();
    if (!vname) continue;
    byCode.set(ncode, {
      ncode,
      vname,
      nofficeid: row.nofficeid != null ? String(row.nofficeid) : null,
    });
  }
  return Array.from(byCode.values());
}

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'No authorization header' }, { status: 401 });

    const token = authHeader.split(' ')[1];
    const userId = await resolveUserIdFromAccessToken(token);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const security = await resolveReportSecurity(userId, { pagePermission: 'page_mis_reports' });
    if (security.forbidden || (!security.isHod && security.assignedOffices.length === 0)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const branch = searchParams.get('branch');
    const branchId = searchParams.get('branchId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const roster = searchParams.get('roster') === '1' || searchParams.get('roster') === 'true';

    if (!branch && !branchId) {
      return NextResponse.json({ error: 'Branch or branchId is required' }, { status: 400 });
    }

    if (readDimsFromPostgres()) {
      if (branchId || roster) {
        const engineers = await queryEngineerRowsFromPostgres({
          branchId: branchId ?? undefined,
          branchName: branch ?? undefined,
        });
        return NextResponse.json(engineers);
      }
      const engineers = await queryEngineersFromPostgres(branch!);
      return NextResponse.json(engineers);
    }

    if (branchId || roster) {
      const engineers = await queryRosterEngineersFromCrm({
        branchId,
        branchName: branch,
      });
      return NextResponse.json(engineers);
    }

    const engineers = await queryEngineersFromCallsCrm({
      branchId: null,
      branchName: branch,
      startDate,
      endDate,
    });
    return NextResponse.json(engineers.map((e) => e.vname));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Engineers query failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
