import {
  formatArcpClaimsExportDate,
  resolveArcpBmApprovedAt,
  resolveArcpHoApprovedAt,
} from '@/lib/read-model/arcp/dates';

/** CRM: latest ARCP line per call for BM/HO approve resolution. */
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
  INNER JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
  WHERE CAST(tf.ncalls AS VARCHAR(50)) = CAST(tc.ncode AS VARCHAR(50))
    AND tf.nofficeid = tc.nofficeid
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
