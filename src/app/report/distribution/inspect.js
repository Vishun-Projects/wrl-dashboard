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
  console.log("Counting calls in database...");
  try {
    const res = await postQuery({
      rawSql: `
        SELECT 
          COUNT(1) as total_calls,
          SUM(CASE WHEN dtrndate >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) as last_30_days_calls
        FROM trhcalls tc (NOLOCK)
        WHERE tc.ncancelreason IS NULL
      `
    });
    console.log("Result:", JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error("Error querying:", err);
  }
}

main().catch(console.error);
