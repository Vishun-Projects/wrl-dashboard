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
      let condition = "callsntrnno IS NOT NULL AND callsntrnno <> '' AND ISNULL(ncancelreason, 0) <> 2";
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
        // Find party ID for account name
        const pRes = await postQuery({
            fields: "ncode",
            tableName: "mstpartyprofile",
            condition: `vname = '${account}'`
        });
        if (pRes.data && pRes.data.length > 0) {
            condition += ` AND npartyprofile = ${pRes.data[0].ncode}`;
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
            FROM uv_findtrhcalls_callsearch (NOLOCK)
            WHERE callsntrnno IS NOT NULL AND callsntrnno <> '' AND ISNULL(ncancelreason, 0) <> 2
            ${startDate ? ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) >= '${startDate}'` : ''}
            ${endDate ? ` AND ISNULL(TRY_CAST(callsdtrndate AS DATETIME), TRY_CONVERT(DATETIME, LEFT(CAST(callsdtrndate AS NVARCHAR(50)), 10), 104)) <= '${endDate} 23:59:59'` : ''}
            GROUP BY callsntrnno
            HAVING COUNT(DISTINCT nofficeid) > 1
          )`;
          break;
      }

      sql = `SELECT TOP 500 
                callsntrnno as [Ref No], 
                CONVERT(VARCHAR, callsdtrndate, 105) as [Date],
                vlocation as [Location],
                itemname as [Product],
                callsvserialno as [Serial],
                serviceman as [Engineer],
                vcomplaint as [Complaint],
                Status as [Status]
             FROM uv_findtrhcalls_callsearch (NOLOCK)
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
