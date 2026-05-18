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

async function postQuery(rawSql) {
    const { viewState, viewStateGenerator, eventValidation } = await getAppState();
    
    const formData = new URLSearchParams();
    formData.append('__VIEWSTATE', viewState);
    formData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
    if (eventValidation) formData.append('__EVENTVALIDATION', eventValidation);
    
    let sql = rawSql.trim();
    if (sql.toUpperCase().includes('ORDER BY') && !sql.toUpperCase().includes('TOP ')) {
        sql = sql.replace(/^(\s*SELECT)\b/i, '$1 TOP 100 PERCENT');
    }
    formData.append('txt_Fields', '*');
    formData.append('txt_TableName', `(${sql}) as t`);
    formData.append('txt_Condition', '1=1');
    formData.append('txt_OrderBy', '');
    formData.append('btn_View', 'Execute');

    const res = await axios.post(DB_URL, formData, {
        timeout: 100000,
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

    if (!resultTable.length) {
        return { data: [], columns: [] };
    }

    const data = [];
    const columns = [];
    const rows = resultTable.find('tr').filter((i, el) => $(el).closest('table').is(resultTable));

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
        console.log("Checking raw trhcalls table size...");
        const resTableSize = await postQuery("SELECT COUNT(*) as cnt FROM trhcalls (NOLOCK)");
        console.log("Total rows in trhcalls:", resTableSize.data[0].cnt);
        
        console.log("Checking unique calls count (vtrnno is not null and not empty)...");
        const resUniqueSize = await postQuery("SELECT COUNT(DISTINCT vtrnno) as cnt FROM trhcalls (NOLOCK) WHERE vtrnno IS NOT NULL AND vtrnno <> ''");
        console.log("Unique vtrnno count:", resUniqueSize.data[0].cnt);
    } catch (e) {
        console.error("Error:", e.message);
    }
}

run();
