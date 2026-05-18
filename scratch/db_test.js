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
    
    let sql = params.rawSql.trim();
    formData.append('txt_Fields', '*');
    formData.append('txt_TableName', `(${sql}) as t`);
    formData.append('txt_Condition', '1=1');
    formData.append('txt_OrderBy', '');
    formData.append('btn_View', 'Execute');

    const res = await axios.post(DB_URL, formData, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0'
        }
    });

    const $ = cheerio.load(res.data);
    const error = $('#lbl_Error').text();
    if (error && error.trim()) {
        throw new Error(error.trim());
    }

    let resultTable = $('#ResultGrid');
    if (!resultTable.length) {
        resultTable = $('fieldset legend:contains("Result")').parent().find('table');
    }

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

    return { data, columns };
}

async function run() {
    try {
        console.log("Executing test query...");
        const rawSql = `
          SELECT TOP 5 ncode, vtrnno, editedon, addedon
          FROM (
            SELECT *,
                   ROW_NUMBER() OVER (
                     PARTITION BY vtrnno 
                     ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
                   ) as rn
            FROM trhcalls (NOLOCK)
            WHERE vtrnno IS NOT NULL AND vtrnno <> ''
          ) sub
          WHERE sub.rn = 1
        `;
        const res = await postQuery({ rawSql });
        console.log("Success! Returned " + res.data.length + " rows.");
        console.log("Samples:", JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error("Query failed:", err.message);
    }
}

run();
