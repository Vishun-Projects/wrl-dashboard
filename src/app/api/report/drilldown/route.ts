import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db/proxy';
import { resolveRequestReportSecurity } from '@/lib/auth/resolve-bearer-security';
import { readSummaryFromPostgres } from '@/lib/read-model/flags';
import { querySummaryDrilldown } from '@/lib/read-model/queries/drilldown';
import { appendCallTypeFilter } from '@/lib/trhcalls/query';
import { appendOfficeSecurityFilter } from '@/lib/trhcalls/office-security';
import {
  assertIsoDate,
  assertNumericId,
  escapeSqlLiteral,
  sqlDateLiteral,
  sqlDateTimeEndLiteral,
} from '@/lib/crm/sql-builder';
import { drilldownBodySchema } from '@/lib/api/schemas/report-query';

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveRequestReportSecurity(req, {
      pageId: 'mis_reports',
      tabId: 'register',
    });
    if (!auth.ok) return auth.response;
    const { security } = auth;

    const body = await req.json();
    const parsed = drilldownBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 });
    }

    const { type, officeId, account, region, startDate, endDate, callType, agingAsOf } = parsed.data;

    if (readSummaryFromPostgres()) {
      const data = await querySummaryDrilldown({
        type,
        officeId,
        region,
        startDate,
        endDate,
        agingAsOf,
        callType,
        assignedOffices: security.assignedOffices.map(String),
        isHod: security.isHod,
      });
      return NextResponse.json({ data });
    }

    const safeStart = startDate ? assertIsoDate(startDate, 'startDate') : null;
    const safeEnd = endDate ? assertIsoDate(endDate, 'endDate') : null;
    const agingAnchor = agingAsOf || safeEnd;
    const safeAging = agingAnchor ? assertIsoDate(agingAnchor, 'agingAsOf') : null;
    const agingDate = safeAging ? sqlDateTimeEndLiteral(safeAging) : 'GETDATE()';

    let sql = "";
    let condition = "(view_c.vtrnno IS NOT NULL AND view_c.vtrnno <> '' OR (view_c.vtransfercallno IS NOT NULL AND view_c.vtransfercallno <> ''))";
      if (type !== 'transferred_calls') {
        condition += " AND ISNULL(view_c.ncancelreason, 0) <> 2";
      }
      if (safeStart) condition += ` AND view_c.callsdtrndate >= ${sqlDateLiteral(safeStart)}`;
      if (safeEnd) condition += ` AND view_c.callsdtrndate <= ${sqlDateTimeEndLiteral(safeEnd)}`;

      let innerCondition = "1=1";
      if (safeStart) innerCondition += ` AND dtrndate >= ${sqlDateLiteral(safeStart)}`;
      if (safeEnd) innerCondition += ` AND dtrndate <= ${sqlDateTimeEndLiteral(safeEnd)}`;

      if (officeId && officeId !== 'All') {
        const officeNum = assertNumericId(officeId, 'officeId');
        condition += ` AND view_c.nofficeid IN (SELECT ncode FROM mstoffice WHERE ncode = ${officeNum} OR nunder = ${officeNum})`;
        innerCondition += ` AND nofficeid IN (SELECT ncode FROM mstoffice WHERE ncode = ${officeNum} OR nunder = ${officeNum})`;
      }

      if (region && region !== 'AI' && (!officeId || officeId === 'All')) {
        const cleanRegion = region.trim().replace(/\s+ZONE$/i, '').trim();
        const zoneRes = await postQuery({
          fields: "ncode",
          tableName: "mstzones",
          condition: `vname LIKE '${cleanRegion}%'`
        });

        if (zoneRes.data && zoneRes.data.length > 0) {
          const zoneId = zoneRes.data[0].ncode;
          const zoneFilterStr = `nofficeid IN (
            SELECT ncode FROM mstoffice 
            WHERE nzone = ${zoneId} 
            OR nunder IN (SELECT ncode FROM mstoffice WHERE nzone = ${zoneId})
          )`;
          condition += ` AND view_c.${zoneFilterStr}`;
          innerCondition += ` AND ${zoneFilterStr}`;
        }
      }

      if (account && account !== 'All India') {
        const accountNames = account.split(',').map((a: string) => a.trim()).filter((a: string) => a.length > 0);
        if (accountNames.length > 0) {
          const conditionString = accountNames.map((a: string) => `vname = '${a.replace(/'/g, "''")}'`).join(' OR ');
          const pRes = await postQuery({
            fields: "ncode",
            tableName: "mstpartyprofile",
            condition: conditionString
          });
          if (pRes.data && pRes.data.length > 0) {
            const partyIds = pRes.data.map((p: any) => p.ncode).join(',');
            condition += ` AND view_c.npartyprofile IN (${partyIds})`;
            innerCondition += ` AND npartyprofile IN (${partyIds})`;
          }
        }
      }

      if (callType && callType !== 'All' && callType !== '') {
        condition = appendCallTypeFilter(condition, callType, 'view_c.ncalltype');
        innerCondition = appendCallTypeFilter(innerCondition, callType, 'ncalltype');
      }

      switch (type) {
        case 'solved_calls':
        case 'total_solved':
          condition += ` AND (view_c.callsolved = '1' OR view_c.callsolved = 'True' OR view_c.callstatus = 'Solved' OR CAST(view_c.Status AS NVARCHAR(MAX)) = 'Closed' OR EXISTS (SELECT 1 FROM trhcalls tc2 WHERE tc2.vtrnno = view_c.vtrnno AND tc2.vtrnno IS NOT NULL AND tc2.vtrnno <> '' AND (tc2.bfastclose = 1)))`;
          break;
        case 'cancelled_calls':
          condition += ` AND ISNULL(view_c.callstatus,'') = 'Cancel'`;
          break;
        case 'transferred_calls':
          condition += ` AND (ISNULL(view_c.ncancelreason, 0) = 2 OR (view_c.vtransfercallno IS NOT NULL AND view_c.vtransfercallno <> ''))`;
          break;
        case 'open_calls':
          condition += ` AND (view_c.callsolved = '0' OR view_c.callsolved = 'False') AND (view_c.bfastclose = 0 OR view_c.bfastclose IS NULL) AND ISNULL(view_c.callstatus,'') != 'Cancel'`;
          break;
        case 'age_2':
          condition += ` AND DATEDIFF(day, view_c.callsdtrndate, ${agingDate}) <= 2 AND (view_c.callsolved = '0' OR view_c.callsolved = 'False') AND (view_c.bfastclose = 0 OR view_c.bfastclose IS NULL) AND ISNULL(view_c.callstatus,'') != 'Cancel'`;
          break;
        case 'age_3':
          condition += ` AND DATEDIFF(day, view_c.callsdtrndate, ${agingDate}) > 2 AND DATEDIFF(day, view_c.callsdtrndate, ${agingDate}) <= 7 AND (view_c.callsolved = '0' OR view_c.callsolved = 'False') AND (view_c.bfastclose = 0 OR view_c.bfastclose IS NULL) AND ISNULL(view_c.callstatus,'') != 'Cancel'`;
          break;
        case 'age_7':
          condition += ` AND DATEDIFF(day, view_c.callsdtrndate, ${agingDate}) > 7 AND DATEDIFF(day, view_c.callsdtrndate, ${agingDate}) <= 15 AND (view_c.callsolved = '0' OR view_c.callsolved = 'False') AND (view_c.bfastclose = 0 OR view_c.bfastclose IS NULL) AND ISNULL(view_c.callstatus,'') != 'Cancel'`;
          break;
        case 'age_15':
          condition += ` AND DATEDIFF(day, view_c.callsdtrndate, ${agingDate}) > 15 AND (view_c.callsolved = '0' OR view_c.callsolved = 'False') AND (view_c.bfastclose = 0 OR view_c.bfastclose IS NULL) AND ISNULL(view_c.callstatus,'') != 'Cancel'`;
          break;
        case 'part_pending':
          condition += ` AND (view_c.callsolved = '0' OR view_c.callsolved = 'False') AND (view_c.bfastclose = 0 OR view_c.bfastclose IS NULL) AND ISNULL(view_c.callstatus,'') != 'Cancel' AND (view_c.vsolveremarks LIKE '%PART%' OR (view_c.vcomplaint LIKE '%PART%' AND (view_c.vcomplaint NOT LIKE 'Cut off, cooling, part problem%' OR EXISTS(SELECT 1 FROM trdcalls1visit v (NOLOCK) WHERE v.ncalls = view_c.call_ncode))))`;
          break;
        case 'discrepancy':
          let discrepancyCondition = `1=1`;
          if (startDate) discrepancyCondition += ` AND dtrndate >= '${startDate}'`;
          if (endDate) discrepancyCondition += ` AND dtrndate <= '${endDate} 23:59:59'`;
          if (callType && callType !== 'All' && callType !== '') {
            discrepancyCondition = appendCallTypeFilter(discrepancyCondition, callType, 'ncalltype');
          }
          condition += ` AND view_c.vtrnno IN (
            SELECT vtrnno 
            FROM (
              SELECT 
                tc.ncode as call_ncode,
                    tc.vtrnno as vtrnno,
                tc.dtrndate as callsdtrndate,
                    p.vname as customername,
                    p.vname as customername,
                tc.nofficeid as nofficeid,
                tc.ncancelreason as ncancelreason,
                tc.ncalltype as ncalltype
              FROM (SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC) as rn FROM trhcalls (NOLOCK) WHERE ${innerCondition}) s WHERE s.rn = 1) tc
            ) inner_vc
            WHERE inner_vc.vtrnno IS NOT NULL AND inner_vc.vtrnno <> '' AND ISNULL(inner_vc.ncancelreason, 0) <> 2
            GROUP BY inner_vc.vtrnno
            HAVING COUNT(DISTINCT inner_vc.nofficeid) > 1
          )`;
          break;
      }

      const innerSubquery = `(SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC) as rn FROM trhcalls (NOLOCK) WHERE ${innerCondition}) s WHERE s.rn = 1)`;

      if (type === 'transferred_calls') {
        // Flatten the query entirely to avoid evaluating the subquery for non-matching rows
        let condition = "tc.ntrnno IS NOT NULL AND tc.ntrnno <> ''";
        condition += " AND (ISNULL(tc.ncancelreason, 0) = 2 OR (tc.vtransfercallno IS NOT NULL AND tc.vtransfercallno <> ''))";
        if (startDate) condition += ` AND tc.dtrndate >= '${startDate}'`;
        if (endDate) condition += ` AND tc.dtrndate <= '${endDate} 23:59:59'`;

        if (officeId && officeId !== 'All') {
          condition += ` AND tc.nofficeid IN (SELECT ncode FROM mstoffice WHERE ncode = ${officeId} OR nunder = ${officeId})`;
        }

        if (region && region !== 'AI' && (!officeId || officeId === 'All')) {
          const cleanRegion = region.trim().replace(/\s+ZONE$/i, '').trim();
          const zoneRes = await postQuery({
            fields: "ncode",
            tableName: "mstzones",
            condition: `vname LIKE '${cleanRegion}%'`
          });

          if (zoneRes.data && zoneRes.data.length > 0) {
            const zoneId = zoneRes.data[0].ncode;
            condition += ` AND tc.nofficeid IN (
              SELECT ncode FROM mstoffice 
              WHERE nzone = ${zoneId} 
              OR nunder IN (SELECT ncode FROM mstoffice WHERE nzone = ${zoneId})
            )`;
          }
        }

        if (account && account !== 'All India') {
          const accountNames = account.split(',').map((a: string) => a.trim()).filter((a: string) => a.length > 0);
          if (accountNames.length > 0) {
            const conditionString = accountNames.map((a: string) => `vname = '${a.replace(/'/g, "''")}'`).join(' OR ');
            const pRes = await postQuery({
              fields: "ncode",
              tableName: "mstpartyprofile",
              condition: conditionString
            });
            if (pRes.data && pRes.data.length > 0) {
              const partyIds = pRes.data.map((p: any) => p.ncode).join(',');
              condition += ` AND tc.npartyprofile IN (${partyIds})`;
            }
          }
        }

        if (callType && callType !== 'All' && callType !== '') {
          condition = appendCallTypeFilter(condition, callType);
        }

        sql = `SELECT TOP 500 
                  CASE 
                    WHEN o.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND o.nunder IS NOT NULL THEN bo.vcompanyname + ' - ' + o.vcompanyname 
                    ELSE o.vcompanyname 
                  END as [Branch], 
                  CASE 
                    WHEN ISNULL(tc.vtransfercallno, '') <> '' THEN
                      COALESCE(
                        (SELECT TOP 1 
                           CASE 
                             WHEN dest_o.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND dest_o.nunder IS NOT NULL THEN dest_bo.vcompanyname + ' - ' + dest_o.vcompanyname 
                             ELSE dest_o.vcompanyname 
                           END
                         FROM trhcalls dest_tc (NOLOCK)
                         JOIN mstoffice dest_o (NOLOCK) ON dest_tc.nofficeid = dest_o.ncode
                         LEFT JOIN mstoffice dest_bo (NOLOCK) ON dest_o.nunder = dest_bo.ncode
                         WHERE dest_tc.vtrnno = tc.vtransfercallno),
                        CASE 
                          WHEN transferoffice.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND transferoffice.nunder IS NOT NULL THEN trans_bo.vcompanyname + ' - ' + transferoffice.vcompanyname 
                          ELSE transferoffice.vcompanyname 
                        END,
                        '—'
                      )
                    ELSE 
                      COALESCE(
                        CASE 
                          WHEN transferoffice.nunder NOT IN (605, 606, 607, 608, 612, 1, 0) AND transferoffice.nunder IS NOT NULL THEN trans_bo.vcompanyname + ' - ' + transferoffice.vcompanyname 
                          ELSE transferoffice.vcompanyname 
                        END,
                        '—'
                      )
                  END as [Franchisee],
                  COALESCE(NULLIF(tc.vtrnno, ''), tc.vtransfercallno, '—') as [vtrnno], 
                  ISNULL(p.vname, '—') as [Customer Name],
                  tc.callStatus as [Status]
               FROM ${innerSubquery} tc
               JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
               LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
               LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
               LEFT JOIN mstoffice trans_bo (NOLOCK) ON transferoffice.nunder = trans_bo.ncode
               LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
               LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
               WHERE ${appendOfficeSecurityFilter(condition, security.isHod, security.assignedOffices, { officeCol: 'tc.nofficeid', underCol: 'o.nunder' })}
               ORDER BY tc.dtrndate DESC`;
      } else {
        sql = `SELECT TOP 500 
                  COALESCE(NULLIF(view_c.vtrnno, ''), view_c.vtransfercallno, '—') as [Ref No], 
                  CONVERT(VARCHAR, view_c.callsdtrndate, 105) as [Date],
                  view_c.customername as [Customer Name],
                  view_c.itemname as [Product],
                  view_c.callsvserialno as [Serial],
                  view_c.serviceman as [Engineer],
                  view_c.vcomplaint as [Complaint],
                  view_c.Status as [Status]
               FROM (
                 SELECT 
                   tc.ncode as call_ncode,
                    tc.vtrnno as vtrnno,
                   tc.dtrndate as callsdtrndate,
                    p.vname as customername,
                   tc.vlocation as vlocation,
                   mstitems.vname as itemname,
                   tc.vserialno as callsvserialno,
                   u.vname as serviceman,
                   tc.vcomplaint as vcomplaint,
                   tc.callStatus as Status,
                   CASE WHEN tc.bsolved=1 then 'Solved' else case when tc.ncancelreason Is not null and tc.ncancelreason <> 0 then 'Cancel' else case when (tc.bsolved=0 or tc.bsolved is null) and (tc.ncancelreason IS null or tc.ncancelreason = 0) then 'Open' end end end as callstatus,
                   tc.bsolved as callsolved,
                   tc.ncancelreason as ncancelreason,
                   tc.vtransfercallno as vtransfercallno,
                   tc.nofficeid as nofficeid,
                   tc.npartyprofile as npartyprofile,
                   tc.vsolveremarks as vsolveremarks,
                   tc.ncalltype as ncalltype,
                   tc.bfastclose as bfastclose
                 FROM ${innerSubquery} tc
                 LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
                 LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode\r\n                  LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
               ) view_c
               WHERE ${appendOfficeSecurityFilter(condition, security.isHod, security.assignedOffices, { officeCol: 'view_c.nofficeid' })}
               ORDER BY view_c.callsdtrndate DESC`;
      }

    const res = await postQuery({
      rawSql: sql
    });

    return NextResponse.json({
      data: res.data || [],
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
