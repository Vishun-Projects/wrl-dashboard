/** Escape a value for safe embedding in CRM rawSql literals. */
function sqlLit(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * One row per part line on a call (trdcalls3parts), with the serial CRM stored
 * against that line. Old/new barcodes on the part row fill in when the serial
 * row is empty. The machine serial (vserialno) is not the new part serial.
 */
export function buildCallPartsCrmSql(opts: {
  /** Inclusive lower bound on ISNULL(editedon, addedon). */
  editedFrom?: string | null;
  /** After this ncode when the timestamp equals editedFrom. */
  afterNcode?: string | null;
  /** Inclusive call date, YYYY-MM-DD. Paired with callTo. */
  callFrom?: string | null;
  /** Exclusive call date, YYYY-MM-DD. */
  callTo?: string | null;
  /** Exclusive upper bound on ISNULL(editedon, addedon). */
  editedTo?: string | null;
  top?: number;
}): string {
  const top = Math.min(Math.max(opts.top ?? 500, 1), 2000);
  const stamp = 'ISNULL(p.editedon, p.addedon)';
  const parts: string[] = [];

  if (opts.callFrom && opts.callTo) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.callFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(opts.callTo)) {
      throw new Error('call window must be YYYY-MM-DD');
    }
    parts.push(`tc.dtrndate >= '${opts.callFrom}' AND tc.dtrndate < '${opts.callTo}'`);
  }

  if (opts.editedTo) {
    parts.push(`${stamp} < '${sqlLit(opts.editedTo.slice(0, 23))}'`);
  }

  if (opts.editedFrom) {
    const t = sqlLit(opts.editedFrom.slice(0, 23));
    if (opts.afterNcode) {
      const n = sqlLit(opts.afterNcode);
      parts.push(
        `(${stamp} > '${t}' OR (${stamp} = '${t}' AND CONVERT(varchar(50), p.ncode) > '${n}'))`
      );
    } else {
      parts.push(`${stamp} >= '${t}'`);
    }
  }

  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  return `
SELECT TOP ${top}
  CONVERT(varchar(50), p.ncode) AS ncode,
  CONVERT(varchar(50), p.nofficeid) AS nofficeid,
  CONVERT(varchar(50), p.ncalls) AS ncalls,
  tc.vtrnno AS call_no,
  vis.vVisitTrnNo AS visit_no,
  CONVERT(varchar(10), vis.dvisitdatetime, 23) AS visit_at,
  i.vitemcode AS part_code,
  i.vname AS part_name,
  CONVERT(varchar(50), p.nquantity) AS qty,
  COALESCE(NULLIF(LTRIM(RTRIM(ser.old_serial)), ''), NULLIF(LTRIM(RTRIM(p.voldbarcode)), '')) AS old_barcode,
  COALESCE(NULLIF(LTRIM(RTRIM(ser.new_serial)), ''), NULLIF(LTRIM(RTRIM(p.vnewbarcode)), '')) AS new_barcode,
  p.vremarks AS remarks,
  CONVERT(varchar(20), p.bclaimed) AS claimed,
  CONVERT(varchar(50), o.nunder) AS office_under,
  CONVERT(varchar(30), ${stamp}, 126) AS editedon
FROM trdcalls3parts p (NOLOCK)
INNER JOIN trhcalls tc (NOLOCK)
  ON p.ncalls = tc.ncode AND p.nofficeid = tc.nofficeid
LEFT JOIN mstitems i (NOLOCK) ON p.nitem = i.ncode
LEFT JOIN mstoffice o (NOLOCK) ON p.nofficeid = o.ncode
LEFT JOIN trdcalls1visit vis (NOLOCK)
  ON vis.ncode = p.ncalls1 AND vis.nofficeid = p.nofficeid
OUTER APPLY (
  SELECT TOP 1 s.voldserialno AS old_serial, s.vnewserialno AS new_serial
  FROM trdcalls3parts1serialno s (NOLOCK)
  WHERE s.ncalls3 = p.ncode AND s.nofficeid = p.nofficeid
  ORDER BY s.ncode
) ser
${where}
ORDER BY ${stamp} ASC, p.ncode ASC
`.trim();
}
