import {
  formatArcpClaimsExportDate,
  resolveArcpBmApprovedAt,
  resolveArcpHoApprovedAt,
} from '@/lib/read-model/arcp/dates';

/** CRM: latest ARCP line per call — prefer Service Order (vucnno = vtrnno); ncode only if vucnno blank. */
export const REGISTER_ARCP_PICK_OUTER_APPLY = `
OUTER APPLY (
  SELECT TOP 1
    arcp.dbmapproveddate,
    arcp.dhoapproveddate,
    CONVERT(varchar(30), arcp.dapproval1on, 126) AS dapproval1on,
    CONVERT(varchar(30), arcp.dapproval2on, 126) AS dapproval2on,
    arcp.bapproved,
    arcp.bapprovedho,
    arcp.nbmapprovedamt,
    arcp.nhoapprovedamt,
    arcp.napproval1amount,
    arcp.napproval2amount
  FROM trdcalls10ARCP arcp (NOLOCK)
  LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
  WHERE (
      NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') IS NOT NULL
      AND UPPER(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))))
        = UPPER(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))))
    )
    OR (
      NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') IS NULL
      AND CAST(tf.ncalls AS VARCHAR(50)) = CAST(tc.ncode AS VARCHAR(50))
      AND tf.nofficeid = tc.nofficeid
    )
  ORDER BY
    CASE
      WHEN NULLIF(LTRIM(RTRIM(CAST(arcp.dhoapproveddate AS VARCHAR(50)))), '') IS NOT NULL THEN 1
      ELSE 0
    END DESC,
    arcp.dhoapproveddate DESC,
    arcp.dbmapproveddate DESC,
    arcp.ncode DESC
) arcp_pick`;

export const REGISTER_ARCP_PICK_FIELDS_SQL = `
  arcp_pick.dbmapproveddate,
  arcp_pick.dhoapproveddate,
  arcp_pick.dapproval1on,
  arcp_pick.dapproval2on,
  arcp_pick.bapproved,
  arcp_pick.bapprovedho,
  arcp_pick.nbmapprovedamt,
  arcp_pick.nhoapprovedamt,
  arcp_pick.napproval1amount,
  arcp_pick.napproval2amount`;

/** Postgres: latest non-rejected ARCP line per call (mirrors REGISTER_ARCP_PICK_OUTER_APPLY). */
export const REGISTER_ARCP_PICK_LATERAL_SQL = `
LEFT JOIN LATERAL (
  SELECT a.bm_approved_at, a.ho_approved_at
  FROM arcp_lines_hot a
  WHERE NOT a.is_rejected
    AND (
      (
        NULLIF(trim(a.vucnno), '') IS NOT NULL
        AND upper(trim(a.vucnno)) = upper(trim(h.vtrnno))
      )
      OR (
        NULLIF(trim(a.vucnno), '') IS NULL
        AND a.call_no = CAST(h.ncode AS TEXT)
      )
    )
  ORDER BY
    CASE WHEN a.ho_approved_at IS NOT NULL THEN 1 ELSE 0 END DESC,
    a.ho_approved_at DESC NULLS LAST,
    a.bm_approved_at DESC NULLS LAST,
    a.ncode DESC
  LIMIT 1
) arcp_pick ON true`;

export const REGISTER_ARCP_PICK_HOT_FIELDS_SQL = `
  arcp_pick.bm_approved_at,
  arcp_pick.ho_approved_at`;

/** Call ↔ ARCP match used by register BM Approved Date (same as pick / column). */
export const REGISTER_ARCP_HOT_CALL_MATCH_SQL = `
  (
    (
      NULLIF(trim(a.vucnno), '') IS NOT NULL
      AND upper(trim(a.vucnno)) = upper(trim(h.vtrnno))
    )
    OR (
      NULLIF(trim(a.vucnno), '') IS NULL
      AND a.call_no = CAST(h.ncode AS TEXT)
    )
  )`;

/** Scalar: BM date shown on Call Register (ARCP pick, not call-level bapproval). */
export function sqlRegisterArcpBmPickDatePg(callAlias = 'h'): string {
  const match = REGISTER_ARCP_HOT_CALL_MATCH_SQL.replaceAll('h.', `${callAlias}.`);
  return `(
    SELECT a.bm_approved_at
    FROM arcp_lines_hot a
    WHERE NOT a.is_rejected
      AND ${match}
    ORDER BY
      CASE WHEN a.ho_approved_at IS NOT NULL THEN 1 ELSE 0 END DESC,
      a.ho_approved_at DESC NULLS LAST,
      a.bm_approved_at DESC NULLS LAST,
      a.ncode DESC
    LIMIT 1
  )`;
}

/**
 * Filter calls whose displayed BM Approved Date falls in range.
 * Uses the same ARCP pick as the register column (not calls_latest_hot.bm_approved_at).
 */
export function sqlRegisterArcpBmPickInRangeExistsPg(opts: {
  startParam?: number;
  endParam?: number;
  callAlias?: string;
}): string {
  const callAlias = opts.callAlias ?? 'h';
  const match = REGISTER_ARCP_HOT_CALL_MATCH_SQL.replaceAll('h.', `${callAlias}.`);
  const bounds: string[] = ['pick.bm IS NOT NULL'];
  if (opts.startParam != null) {
    bounds.push(`pick.bm >= $${opts.startParam}::timestamptz`);
  }
  if (opts.endParam != null) {
    bounds.push(`pick.bm <= $${opts.endParam}::timestamptz`);
  }
  return `EXISTS (
    SELECT 1 FROM (
      SELECT a.bm_approved_at AS bm
      FROM arcp_lines_hot a
      WHERE NOT a.is_rejected
        AND ${match}
      ORDER BY
        CASE WHEN a.ho_approved_at IS NOT NULL THEN 1 ELSE 0 END DESC,
        a.ho_approved_at DESC NULLS LAST,
        a.bm_approved_at DESC NULLS LAST,
        a.ncode DESC
      LIMIT 1
    ) pick
    WHERE ${bounds.join(' AND ')}
  )`;
}

/** CRM: ARCP line BM date in range for call `callRef` (table/alias with vtrnno + ncode). */
export function sqlRegisterCrmArcpBmExists(opts: {
  callRef: string;
  startDate?: string | null;
  endDate?: string | null;
}): string {
  const ref = opts.callRef;
  const start = opts.startDate?.replace(/'/g, "''");
  const end = opts.endDate?.replace(/'/g, "''");
  const dateParts: string[] = [];
  if (start) {
    dateParts.push(
      `(NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(50)))), '') IS NOT NULL AND arcp.dbmapproveddate >= '${start}')`
    );
  }
  if (end) {
    dateParts.push(
      `(NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(50)))), '') IS NOT NULL AND arcp.dbmapproveddate <= '${end} 23:59:59')`
    );
  }
  const dateSql = dateParts.length
    ? dateParts.join(' AND ')
    : `NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(50)))), '') IS NOT NULL`;

  return `EXISTS (
    SELECT 1
    FROM trdcalls10ARCP arcp (NOLOCK)
    LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
    WHERE (
        NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') IS NOT NULL
        AND UPPER(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))))
          = UPPER(LTRIM(RTRIM(CAST(${ref}.vtrnno AS VARCHAR(50)))))
      )
      OR (
        NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') IS NULL
        AND CAST(tf.ncalls AS VARCHAR(50)) = CAST(${ref}.ncode AS VARCHAR(50))
        AND tf.nofficeid = ${ref}.nofficeid
      )
    )
    AND ${dateSql}
  )`;
}

export function enrichRegisterRowArcpApproveDates(
  row: Record<string, unknown>
): Record<string, unknown> {
  const bm = resolveArcpBmApprovedAt(row);
  const ho = resolveArcpHoApprovedAt(row);
  return {
    ...row,
    bm_approved_date: bm ? formatArcpClaimsExportDate(bm) : '',
    ho_approved_date: ho ? formatArcpClaimsExportDate(ho) : '',
  };
}
