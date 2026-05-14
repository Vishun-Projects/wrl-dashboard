import { NextResponse } from 'next/server';
import { postQuery } from '@/lib/db-proxy';

export async function GET() {
  try {
    // 1. Check call header first
    const callRes = await postQuery({
      fields: "ncode, vtrnno, vtransfercallno, nofficeid, bsolved",
      tableName: "trhcalls (NOLOCK)",
      condition: "vtrnno = '26E13266' OR vtransfercallno = '26E13266'"
    });

    const ncodes = callRes.data?.map((c: any) => `'${c.ncode}'`).join(',');

    // 2. Fetch parts using found ncodes
    const partsRes = await postQuery({
      fields: "p.*, i.vname, i.vitemcode",
      tableName: "trdcalls3parts p (NOLOCK) LEFT JOIN mstitems i (NOLOCK) ON p.nitem = i.ncode",
      condition: ncodes ? `p.ncalls IN (${ncodes})` : "p.ncalls IN (SELECT ncode FROM trhcalls WHERE vtrnno = '26E13266' OR vtransfercallno = '26E13266')"
    });

    // 3. Also check visits for hidden barcode info
    const visitsRes = await postQuery({
      fields: "vvisitremark, vcustomerRemarks, vPartsReplacedDetails, ncalls",
      tableName: "trdcalls1visit (NOLOCK)",
      condition: ncodes ? `ncalls IN (${ncodes})` : "1=0"
    });
    
    return NextResponse.json({
      call: callRes.data,
      parts: partsRes.data,
      visits: visitsRes.data,
      debug: { ncodes }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message });
  }
}
