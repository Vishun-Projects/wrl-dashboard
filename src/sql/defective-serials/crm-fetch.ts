/** Escape a value for safe embedding in CRM rawSql literals. */
function sqlLit(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * CRM pull for defective part serials + call dims.
 * Keyset page on (editedon, ncode) to avoid DBQUERY OOM and same-second skips.
 */
export function buildDefectiveSerialsCrmSql(opts: {
  /** Inclusive lower bound on editedon (ISO-ish datetime string). */
  editedFrom?: string | null;
  /** After this ncode when editedon equals editedFrom (keyset). */
  afterNcode?: string | null;
  top?: number;
}): string {
  const top = Math.min(Math.max(opts.top ?? 500, 1), 2000);
  const parts: string[] = [];

  if (opts.editedFrom) {
    const t = sqlLit(opts.editedFrom.slice(0, 23));
    if (opts.afterNcode) {
      const n = sqlLit(opts.afterNcode);
      // Keep ncode as varchar — CRM user/item codes are often decimals like 8.180000000; never CAST to int.
      parts.push(
        `(s.editedon > '${t}' OR (s.editedon = '${t}' AND CONVERT(varchar(50), s.ncode) > '${n}'))`
      );
    } else {
      parts.push(`s.editedon >= '${t}'`);
    }
  }

  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  return `
SELECT TOP ${top}
  s.ncode,
  s.ncalls,
  s.nitem,
  s.vserialno,
  s.nitemserialno,
  s.noldnitem,
  s.voldserialno,
  s.nnewnitem,
  s.vnewserialno,
  s.nofficeid,
  CONVERT(varchar(30), s.editedon, 126) AS editedon,
  s.breturntobranch,
  CONVERT(varchar(30), s.dreturntobranchdate, 126) AS dreturntobranchdate,
  s.nreturntobranch,
  retuser.vname AS return_by_name,
  tc.vtrnno,
  CONVERT(varchar(30), tc.dtrndate, 126) AS dtrndate,
  p.vname AS party_name,
  pprof.vname AS client_name,
  model.vname AS model,
  tc.vserialno AS machine_serial,
  cty.vname AS city,
  tc.vmanualjobno AS call_centre_call_id,
  o.vcompanyname AS branch_name,
  COALESCE(defitem.vitemcode, curitem.vitemcode) AS defective_item_code,
  COALESCE(defitem.vname, curitem.vname) AS defective_item_name
FROM trdcalls3parts1serialno s (NOLOCK)
INNER JOIN trhcalls tc (NOLOCK)
  ON s.ncalls = tc.ncode AND s.nofficeid = tc.nofficeid
LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
LEFT JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
LEFT JOIN mstitems model (NOLOCK) ON tc.nitem = model.ncode
LEFT JOIN mstitems defitem (NOLOCK) ON s.noldnitem = defitem.ncode
LEFT JOIN mstitems curitem (NOLOCK) ON s.nitem = curitem.ncode
LEFT JOIN mstusers retuser (NOLOCK)
  ON CONVERT(varchar(50), s.nreturntobranch) = CONVERT(varchar(50), retuser.ncode)
${where}
ORDER BY s.editedon ASC, s.ncode ASC
`.trim();
}
