import { postQuery } from '../../../lib/db-proxy';

async function main() {
  console.log("Querying calls in Maharashtra to inspect coordinates and regions...");

  const res = await postQuery({
    rawSql: `
      SELECT TOP 50
        tc.ntrnno,
        o.vcompanyname as office_name,
        cty.vname as office_city,
        st.vname as office_state,
        p.vname as party_name,
        p.vinstpostalcode as party_pincode,
        p.vlatlong as party_vlatlong,
        p.mlatlong as party_mlatlong,
        c_party.vname as party_city,
        s_party.vname as party_state
      FROM trhcalls tc (NOLOCK)
      JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
      LEFT JOIN mstcity cty (NOLOCK) ON o.ncity = cty.ncode
      LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
      LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
      LEFT JOIN mstcity c_party (NOLOCK) ON p.ncity = c_party.ncode
      LEFT JOIN mststate s_party (NOLOCK) ON c_party.nstate = s_party.ncode
      WHERE st.vname = 'MAHARASHTRA'
        AND tc.ncancelreason IS NULL
        AND tc.dtrndate >= '2026-04-19' AND tc.dtrndate <= '2026-05-19 23:59:59'
    `
  });

  console.log(`Found ${res.data?.length || 0} records.`);
  if (res.data && res.data.length > 0) {
    console.log("Sample records:");
    res.data.slice(0, 15).forEach((row: any) => {
      console.log(`- Call: ${row.ntrnno} | Office: ${row.office_name} (${row.office_city}, ${row.office_state}) | Party: ${row.party_name} | City/State: ${row.party_city}/${row.party_state} | Pin: ${row.party_pincode} | Lat/Lng: ${row.party_vlatlong || row.party_mlatlong}`);
    });

    // Let's count how many have coords outside of Maharashtra
    const nonMah = res.data.filter((row: any) => row.party_state && row.party_state.toUpperCase() !== 'MAHARASHTRA');
    console.log(`\nOut of 50 samples, ${nonMah.length} have a party state different from Maharashtra:`);
    nonMah.forEach((row: any) => {
      console.log(`  -> Party in ${row.party_state} (${row.party_city}), handled by Office: ${row.office_name} in ${row.office_city}`);
    });
  }
}

main().catch(console.error);
