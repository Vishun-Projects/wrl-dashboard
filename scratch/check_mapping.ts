import { postQuery } from './src/lib/db-proxy';

async function checkMapping() {
  const res = await postQuery({
    fields: "ncode, vcompanyname, nunder, nzone",
    tableName: "mstoffice",
    condition: "vcompanyname LIKE '%RAMPATI%' OR vcompanyname LIKE '%MUMBAI%'",
  });
  console.log(JSON.stringify(res.data, null, 2));

  const zones = await postQuery({
    fields: "ncode, vname",
    tableName: "mstzones",
  });
  console.log("Zones:", JSON.stringify(zones.data, null, 2));
}

checkMapping();
