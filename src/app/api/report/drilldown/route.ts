import { NextRequest, NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return NextResponse.json({ error: 'No authorization header' }, { status: 401 });

    const token = authHeader.split(' ')[1];
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { type, officeId, account, region, startDate, endDate, customQuery } = body;

    const agingDate = endDate ? `'${endDate} 23:59:59'` : 'GETDATE()';

    let sql = "";

    if (customQuery) {
      sql = customQuery;
    } else {
      let condition = "callsntrnno IS NOT NULL AND callsntrnno <> ''";
      if (type !== 'transferred_calls') {
        condition += " AND ISNULL(ncancelreason, 0) <> 2";
      }
      if (startDate) condition += ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) >= '${startDate}'`;
      if (endDate) condition += ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) <= '${endDate} 23:59:59'`;

      if (officeId && officeId !== 'All') {
        condition += ` AND nofficeid IN (SELECT ncode FROM mstoffice WHERE ncode = ${officeId} OR nunder = ${officeId})`;
      }

      if (region && region !== 'AI' && (!officeId || officeId === 'All')) {
        // Filter by region name only if no specific office is selected
        const zoneRes = await postQuery({
          fields: "ncode",
          tableName: "mstzones",
          condition: `vname LIKE '${region}%'`
        });

        if (zoneRes.data && zoneRes.data.length > 0) {
          const zoneId = zoneRes.data[0].ncode;
          condition += ` AND nofficeid IN (
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
            condition += ` AND npartyprofile IN (${partyIds})`;
          }
        }
      }

      // Add metric specific conditions
      switch (type) {
        case 'solved_calls':
        case 'total_solved':
          condition += ` AND (callsolved = '1' OR callsolved = 'True' OR callstatus = 'Solved' OR CAST(Status AS NVARCHAR(MAX)) = 'Closed')`;
          break;
        case 'cancelled_calls':
          condition += ` AND ISNULL(callstatus,'') = 'Cancel'`;
          break;
        case 'transferred_calls':
          condition += ` AND (ISNULL(ncancelreason, 0) = 2 OR (vtransfercallno IS NOT NULL AND vtransfercallno <> ''))`;
          break;
        case 'open_calls':
          condition += ` AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel'`;
          break;
        case 'age_2':
          condition += ` AND DATEDIFF(day, ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)), ${agingDate}) <= 2 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel'`;
          break;
        case 'age_3':
          condition += ` AND DATEDIFF(day, ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)), ${agingDate}) > 2 AND DATEDIFF(day, ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)), ${agingDate}) <= 7 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel'`;
          break;
        case 'age_7':
          condition += ` AND DATEDIFF(day, ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)), ${agingDate}) > 7 AND DATEDIFF(day, ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)), ${agingDate}) <= 15 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel'`;
          break;
        case 'age_15':
          condition += ` AND DATEDIFF(day, ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)), ${agingDate}) > 15 AND (callsolved = '0' OR callsolved = 'False') AND ISNULL(callstatus,'') != 'Cancel'`;
          break;
        case 'part_pending':
          condition += ` AND (vsolveremarks LIKE '%PART%' OR vcomplaint LIKE '%PART%')`;
          break;
        case 'discrepancy':
          // Identify calls handled by more than one branch
          condition += ` AND callsntrnno IN (
            SELECT callsntrnno 
            FROM view_c
            WHERE callsntrnno IS NOT NULL AND callsntrnno <> '' AND ISNULL(ncancelreason, 0) <> 2
            ${startDate ? ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) >= '${startDate}'` : ''}
            ${endDate ? ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) <= '${endDate} 23:59:59'` : ''}
            GROUP BY callsntrnno
            HAVING COUNT(DISTINCT nofficeid) > 1
          )`;
          break;
      }

      sql = `WITH view_c AS (
               SELECT 
                 tc.ntrnno as callsntrnno,
                 tc.dtrndate as callsdtrndate,
                 tc.vlocation as vlocation,
                 mstitems.vname as itemname,
                 tc.vserialno as callsvserialno,
                 u.vname as serviceman,
                 tc.vcomplaint as vcomplaint,
                 tc.callStatus as Status,
                 case when tc.bsolved=1 then 'Solved' else case when tc.ncancelreason Is not null and tc.ncancelreason <> 0 then 'Cancel' else case when (tc.bsolved=0 or tc.bsolved is null) and (tc.ncancelreason IS null or tc.ncancelreason = 0) then 'Open' end end end as callstatus,
                 tc.bsolved as callsolved,
                 tc.ncancelreason as ncancelreason,
                 tc.vtransfercallno as vtransfercallno,
                 tc.nofficeid as nofficeid,
                 tc.npartyprofile as npartyprofile,
                 tc.vsolveremarks as vsolveremarks
               FROM (SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY vtrnno ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC) as rn FROM trhcalls (NOLOCK)) s WHERE s.rn = 1) tc
               LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
               LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode
             )
             SELECT TOP 500 
                callsntrnno as [Ref No], 
                CONVERT(VARCHAR, callsdtrndate, 105) as [Date],
                vlocation as [Location],
                itemname as [Product],
                callsvserialno as [Serial],
                serviceman as [Engineer],
                vcomplaint as [Complaint],
                Status as [Status]
             FROM view_c
             WHERE ${condition}
             ORDER BY ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) DESC`;
    }

    const res = await postQuery({
      rawSql: sql
    });

    return NextResponse.json({
      data: res.data || [],
      sql: sql
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
