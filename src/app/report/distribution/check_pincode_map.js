const pincodeMapData = require('./pincode_map.json');
const axios = require('axios');
const cheerio = require('cheerio');

const DB_URL = 'https://westerncrm.com/wrl/OTHERS/DBQUERY.aspx';

async function getAppState() {
    const res = await axios.get(DB_URL);
    const $ = cheerio.load(res.data);
    return {
        viewState: $('#__VIEWSTATE').val() || '',
        viewStateGenerator: $('#__VIEWSTATEGENERATOR').val() || '',
        eventValidation: $('#__EVENTVALIDATION').val() || '',
    };
}

async function postQuery(params) {
    const { viewState, viewStateGenerator, eventValidation } = await getAppState();
    const formData = new URLSearchParams();
    formData.append('__VIEWSTATE', viewState);
    formData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
    if (eventValidation) formData.append('__EVENTVALIDATION', eventValidation);
    
    if (params.rawSql) {
        let sql = params.rawSql.trim();
        formData.append('txt_Fields', '*');
        formData.append('txt_TableName', `(${sql}) as t`);
        formData.append('txt_Condition', '1=1');
        formData.append('txt_OrderBy', '');
    }
    formData.append('btn_View', 'Execute');

    const res = await axios.post(DB_URL, formData, {
        timeout: 100000,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    const $ = cheerio.load(res.data);
    let resultTable = $('#ResultGrid');
    if (!resultTable.length) {
        resultTable = $('fieldset legend:contains("Result")').parent().find('table');
    }

    if (!resultTable.length) return { data: [] };

    const data = [];
    const columns = [];
    const rows = resultTable.find('tr');

    rows.each((i, row) => {
        if (i === 0) {
            $(row).find('td, th').each((j, cell) => {
                const colName = $(cell).text().trim();
                if (colName) columns.push(colName);
            });
        } else {
            const rowData = {};
            $(row).find('td').each((j, cell) => {
                const colName = columns[j] || `Col${j}`;
                rowData[colName] = $(cell).text().trim();
            });
            if (Object.keys(rowData).length > 0) data.push(rowData);
        }
    });

    return { data };
}

async function main() {
  console.log("Fetching last 30 days calls to match with pincode map...");
  const sql = `
    SELECT 
      tc.ntrnno,
      p.vinstpostalcode as pincode,
      COALESCE(NULLIF(p.vlatlong, ''), NULLIF(p.mlatlong, '')) as latlong,
      cty.vname as db_city,
      st.vname as db_state
    FROM trhcalls tc (NOLOCK)
    JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
    LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    WHERE tc.ncancelreason IS NULL
      AND tc.dtrndate >= DATEADD(day, -30, GETDATE())
  `;
  const res = await postQuery({ rawSql: sql });
  const calls = res.data || [];
  console.log(`Total calls found: ${calls.length}`);

  let maharashtraCalls = [];
  calls.forEach(c => {
    const pin = String(c.pincode || '').trim();
    let resolvedState = '';
    const mapped = pincodeMapData[pin];
    if (mapped) {
      resolvedState = mapped.s || '';
    }
    if (!resolvedState) {
      resolvedState = c.db_state || '';
    }
    resolvedState = resolvedState.toUpperCase().trim();
    if (resolvedState === 'MAHARASHTRA') {
      maharashtraCalls.push({
        ntrnno: c.ntrnno,
        pincode: c.pincode,
        latlong: c.latlong,
        db_city: c.db_city,
        db_state: c.db_state,
        mapped: mapped
      });
    }
  });

  console.log(`Resolved Maharashtra calls count: ${maharashtraCalls.length}`);
  console.log("Sample resolved Maharashtra calls:", JSON.stringify(maharashtraCalls.slice(0, 15), null, 2));
}

main().catch(console.error);
