import axios from 'axios';
import * as cheerio from 'cheerio';
// Cache bust: 1032

const DB_URL = 'https://westerncrm.com/wrl/OTHERS/DBQUERY.aspx';

let cachedState: any = null;
let lastFetch = 0;

export async function getAppState() {
    const now = Date.now();
    if (cachedState && (now - lastFetch < 5000)) {
        return cachedState;
    }


    const res = await axios.get(DB_URL);
    const $ = cheerio.load(res.data);
    cachedState = {
        viewState: $('#__VIEWSTATE').val() as string || '',
        viewStateGenerator: $('#__VIEWSTATEGENERATOR').val() as string || '',
        eventValidation: $('#__EVENTVALIDATION').val() as string || '',
    };
    lastFetch = now;
    return cachedState;
}

async function executePostWithRetry(params: any) {
    const { viewState, viewStateGenerator, eventValidation } = await getAppState();
    
    const formData = new URLSearchParams();
    formData.append('__VIEWSTATE', viewState);
    formData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
    if (eventValidation) formData.append('__EVENTVALIDATION', eventValidation);
    
    formData.append('txt_Top', params.top || '');
    formData.append('txt_Fields', params.fields || '');
    formData.append('txt_TableName', params.tableName);
    formData.append('txt_Condition', params.condition || '1=1');
    formData.append('txt_OrderBy', params.orderBy || '');
    formData.append('btn_View', 'Execute');


    
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        attempts++;
        try {
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
                const errText = error.trim();
                if (errText.includes("No record found")) {
                    return { $, data: [], columns: [], message: "No record found" };
                }
                
                // Deadlock retry logic with exponential backoff
                if (errText.includes("deadlocked") || errText.includes("chosen as the deadlock victim")) {
                    await new Promise(r => setTimeout(r, attempts * 5000));
                    continue;
                }

                throw new Error(errText);
            }

            return { $ };
        } catch (err: any) {
            if (attempts === maxAttempts) throw err;
            
            // Handle 503 or Reset with longer wait
            const isOverloaded = err.message.includes('503') || err.message.includes('ECONNRESET');
            await new Promise(r => setTimeout(r, isOverloaded ? 10000 : 3000));
        }
    }
    throw new Error("Maximum retry attempts reached");
}

export async function postQuery(params: {
    top?: string;
    fields?: string;
    tableName: string;
    condition?: string;
    orderBy?: string;
}) {
    const result = await executePostWithRetry(params);
    if ('data' in result) return result; // Return if no records found early exit

    const { $ } = result as { $: any };
    let resultTable = $('#ResultGrid');
    if (!resultTable.length) {
        resultTable = $('fieldset legend:contains("Result")').parent().find('table');
    }

    if (!resultTable.length) {
        return { data: [], columns: [], message: "No data returned" };
    }

    const data: any[] = [];
    const columns: string[] = [];
    const rows = resultTable.find('tr').filter((i: number, el: any) => $(el).closest('table').is(resultTable));

    rows.each((i: number, row: any) => {
        if (i === 0) {
            $(row).find('td, th').each((j: number, cell: any) => {
                const colName = $(cell).text().trim();
                if (colName) columns.push(colName);
            });
        } else {
            const rowData: any = {};
            $(row).find('td').each((j: number, cell: any) => {
                const colName = columns[j] || `Col${j}`;
                rowData[colName] = $(cell).text().trim();
            });
            if (Object.keys(rowData).length > 0) data.push(rowData);
        }
    });

    return { data, columns };
}
