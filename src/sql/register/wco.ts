/**
 * CRM WCO (Warranty / Contract / Out / Void) derived from mstprorg.
 * Join: LEFT JOIN mstprorg po ON tc.nitemserialno = po.ncode
 * As-of: call log date tc.dtrndate
 */

const PO_WARR_START = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(po.dwarrstartdate AS VARCHAR(30)))), ''), 103)`;
const PO_WARR_END = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(po.dwarrenddate AS VARCHAR(30)))), ''), 103)`;
const PO_CONT_START = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(po.dcontstartdate AS VARCHAR(30)))), ''), 103)`;
const PO_CONT_END = `TRY_CONVERT(DATETIME, NULLIF(LTRIM(RTRIM(CAST(po.dcontenddate AS VARCHAR(30)))), ''), 103)`;
const AS_OF = `TRY_CONVERT(DATETIME, tc.dtrndate)`;

export const REGISTER_MSTPRORG_JOIN_SQL = `
      LEFT JOIN mstprorg po (NOLOCK) ON tc.nitemserialno = po.ncode`;

/**
 * W / C / O / V; NULL when no mstprorg row (no serial link).
 * Warranty preferred over contract when both apply.
 */
export const SQL_WCO_EXPR = `CASE
      WHEN po.ncode IS NULL THEN NULL
      WHEN ISNULL(CAST(po.bwvoid AS VARCHAR(10)), '') IN ('1', 'True', 'true') THEN 'V'
      WHEN ${AS_OF} IS NOT NULL
        AND ${PO_WARR_START} IS NOT NULL
        AND ${PO_WARR_END} IS NOT NULL
        AND ${AS_OF} >= ${PO_WARR_START}
        AND ${AS_OF} <= ${PO_WARR_END}
        THEN 'W'
      WHEN ${AS_OF} IS NOT NULL
        AND ${PO_CONT_START} IS NOT NULL
        AND ${PO_CONT_END} IS NOT NULL
        AND ${AS_OF} >= ${PO_CONT_START}
        AND ${AS_OF} <= ${PO_CONT_END}
        THEN 'C'
      ELSE 'O'
    END`;
