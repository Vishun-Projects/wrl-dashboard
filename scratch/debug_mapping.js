const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('querystring');

const DB_URL = 'https://westerncrm.com/wrl/OTHERS/DBQUERY.aspx';

async function query(fields, tableName, condition) {
    const res = await axios.get(DB_URL);
    const $ = cheerio.load(res.data);
    const viewState = $('#__VIEWSTATE').val();
    const viewStateGenerator = $('#__VIEWSTATEGENERATOR').val();

    const formData = qs.stringify({
        __VIEWSTATE: viewState,
        __VIEWSTATEGENERATOR: viewStateGenerator,
        txt_Fields: fields,
        txt_TableName: tableName,
        txt_Condition: condition,
        btn_View: 'Execute'
    });

    const postRes = await axios.post(DB_URL, formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const $2 = cheerio.load(postRes.data);
    const rows = $2('#ResultGrid tr');
    const data = [];
    const cols = [];
    rows.each((i, row) => {
        if (i === 0) {
            $2(row).find('td').each((j, cell) => cols.push($2(cell).text().trim()));
        } else {
            const item = {};
            $2(row).find('td').each((j, cell) => item[cols[j]] = $2(cell).text().trim());
            data.push(item);
        }
    });
    return data;
}

async function run() {
    console.log("Listing All Zones...");
    const zones = await query("ncode, vname", "mstzones", "1=1");
    console.log(zones);

    console.log("Checking Mumbai (ncode=29)...");
    const mumbai = await query("ncode, vcompanyname, nunder, nzone", "mstoffice", "ncode = 29");
    console.log(mumbai);
}

run();
