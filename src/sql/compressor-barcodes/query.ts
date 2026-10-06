export type RepeatCallKind = 'compressor' | 'gas';
export type RepeatKindFilter = RepeatCallKind | 'all';
export type RepeatDateColumn = 'call_date' | 'solve_date';

export function parseRepeatCallKind(raw: string | null | undefined): RepeatKindFilter {
  if (raw === 'gas' || raw === 'all') return raw;
  return 'compressor';
}

export function parseRepeatDateColumn(raw: string | null | undefined): RepeatDateColumn {
  return raw === 'solve_date' ? 'solve_date' : 'call_date';
}

/** Safe to interpolate: kind is allowlisted. */
export function repeatKindFilterSql(kind: RepeatKindFilter): string {
  if (kind === 'all') return 'TRUE';
  return `COALESCE(repair_kind, 'compressor') = '${kind}'`;
}

/** One CRM visit = one call_no. Compressor + gas on the same visit is not two repeats. */
export const REPEAT_VISIT_COUNT_SQL = 'COUNT(DISTINCT call_no)';
export const REPEAT_VISIT_COUNT_ACTIVE_SQL =
  "COUNT(DISTINCT call_no) FILTER (WHERE call_status IS DISTINCT FROM 'Cancelled')";

/**
 * Same cancel rule as Call Register (`isRegisterRowCancelled`): ncancelreason and
 * CRM `callStatus` text. Assigned must not win when the call is already cancelled.
 */
export const REPEAT_CRM_CALL_STATUS_SQL = `CASE
        WHEN ISNULL(tc.ncancelreason, 0) NOT IN (0, 2) THEN 'Cancelled'
        WHEN (tc.vtransfercallno IS NOT NULL AND LTRIM(RTRIM(tc.vtransfercallno)) <> '') OR tc.ncancelreason = 2 THEN 'Transferred'
        WHEN tc.callStatus IS NOT NULL AND LOWER(LTRIM(RTRIM(tc.callStatus))) LIKE '%cancel%' THEN 'Cancelled'
        WHEN tc.bsolved = 1 THEN 'Closed'
        WHEN tc.bfastclose = 1 THEN 'Tech Solved'
        WHEN ISNULL(tc.nengineer, 0) <> 0 THEN 'Assigned'
        WHEN tc.callStatus IS NOT NULL AND LTRIM(RTRIM(tc.callStatus)) NOT IN ('', 'NULL') THEN LTRIM(RTRIM(tc.callStatus))
        ELSE 'Open'
      END`;

/**
 * GET/stats source: Register/hot cancelled overlays a stale Assigned snapshot so
 * cancelled visits drop out of repeat counts without waiting for CRM resync.
 */
export const REPEAT_BARCODES_FROM_SQL = `(
  SELECT
    cb.id,
    cb.serial_number,
    cb.call_no,
    cb.call_date,
    cb.office_name,
    cb.derived_old_barcode,
    cb.derived_new_barcode,
    CASE
      WHEN h.status_bucket = 'cancelled'
        OR COALESCE(h.status_label, '') ILIKE '%cancel%'
      THEN 'Cancelled'
      ELSE cb.call_status
    END AS call_status,
    COALESCE(NULLIF(BTRIM(cb.cancel_reason), ''), h.cancel_reason) AS cancel_reason,
    cb.is_continuity_broken,
    cb.expected_old_barcode,
    cb.branch_name,
    cb.sap_vendor_code,
    cb.old_item_code,
    cb.old_item_name,
    cb.new_item_code,
    cb.new_item_name,
    cb.solve_date,
    cb.days_gap,
    cb.repair_kind,
    cb.created_at,
    cb.updated_at
  FROM compressor_barcodes cb
  LEFT JOIN calls_latest_hot h ON h.vtrnno = cb.call_no
) compressor_barcodes`;

/** Pushes date params and returns a SQL predicate, or '' when unbounded. */
export function pushRepeatDateRangeSql(
  dateColumn: RepeatDateColumn,
  startDate: string,
  endDate: string,
  params: unknown[]
): string {
  if (startDate && endDate) {
    params.push(startDate, endDate);
    const s = params.length - 1;
    const e = params.length;
    return `${dateColumn} >= $${s}::timestamptz AND ${dateColumn} <= ($${e}::date + INTERVAL '1 day')`;
  }
  if (startDate) {
    params.push(startDate);
    return `${dateColumn} >= $${params.length}::timestamptz`;
  }
  if (endDate) {
    params.push(endDate);
    return `${dateColumn} <= ($${params.length}::date + INTERVAL '1 day')`;
  }
  return '';
}

export type CompressorBarcodeRow = {
  serial_number: string;
  call_no: string;
  call_date: string;
  solve_date?: string;
  new_barcode: string;
  old_barcode: string;
  office_name: string;
  branch_name?: string;
  sap_vendor_code?: string;
  old_item_code?: string;
  old_item_name?: string;
  new_item_code?: string;
  new_item_name?: string;
  call_status?: string;
  cancel_reason?: string;
  call_ncode?: string | number;
  office_id?: string | number;
  p_newbarcode?: string;
  p_oldbarcode?: string;
  s_newbarcode?: string;
  s_oldbarcode?: string;
  s_serialno?: string;
};

const REPEAT_CALL_NO_EXPR = `COALESCE(
        NULLIF(LTRIM(RTRIM(tc.vtrnno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vtransfercallno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vmanualjobno)), '')
      )`;

const REPEAT_OFFICE_EXCLUDE_SQL = `
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%PRACTICE%'
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%WINMAX%'
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%WESTERN HEAD OFFICE - 1100%'`;

function crmListPaging(opts?: { limit?: number; offset?: number; serials?: string[] }): {
  pagination: string;
  serialsCondition: string;
} {
  const pagination =
    typeof opts?.limit === 'number' && opts.limit > 0
      ? `OFFSET ${opts.offset ?? 0} ROWS FETCH NEXT ${opts.limit} ROWS ONLY`
      : '';
  const serialsCondition =
    opts?.serials && opts.serials.length > 0
      ? `AND tc.vserialno IN (${opts.serials.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')})`
      : '';
  return { pagination, serialsCondition };
}

export function buildCompressorBarcodesModifiedSerialsSql(sinceDate: string): string {
  const safeDate = sinceDate.replace(/'/g, "''");
  return `
    SELECT DISTINCT tc.vserialno as serial_number
    FROM trdcalls2fault f (NOLOCK)
    INNER JOIN trhcalls tc (NOLOCK) ON tc.ncode = f.ncalls AND tc.nofficeid = f.nofficeid
    WHERE f.nrepair = 19
      AND ISNULL(tc.vserialno, '') <> ''
      AND ISNULL(tc.editedon, tc.addedon) >= '${safeDate}'
  `;
}

export function buildCompressorBarcodesListRawSql(opts?: {
  limit?: number;
  offset?: number;
  serials?: string[];
}): string {
  const { pagination, serialsCondition } = crmListPaging(opts);

  return `
    SELECT 
      tc.vserialno as serial_number,
      ${REPEAT_CALL_NO_EXPR} as call_no,
      tc.ncode as call_ncode,
      tc.nofficeid as office_id,
      CONVERT(varchar(30), tc.dtrndate, 126) as call_date,
      CASE 
        WHEN tc.bsolved = 1 THEN CONVERT(varchar(30), tc.dsolvedatetime, 126)
        WHEN tc.bfastclose = 1 THEN CONVERT(varchar(30), tc.editedon, 126)
        ELSE CONVERT(varchar(30), tc.dsolvedatetime, 126)
      END as solve_date,
      ${REPEAT_CRM_CALL_STATUS_SQL} as call_status,
      cr.vname as cancel_reason,
      p.vnewbarcode as p_newbarcode,
      p.voldbarcode as p_oldbarcode,
      s.vnewserialno as s_newbarcode,
      s.voldserialno as s_oldbarcode,
      s.vserialno as s_serialno,
      o.vcompanyname as office_name,
      o.vsapvendorcode as sap_vendor_code,
      ISNULL(parent.vcompanyname, o.vcompanyname) as branch_name,
      new_i.vitemcode as new_item_code,
      new_i.vname as new_item_name,
      old_i.vitemcode as old_item_code,
      old_i.vname as old_item_name
    FROM trdcalls2fault f (NOLOCK)
    INNER JOIN trhcalls tc (NOLOCK) ON tc.ncode = f.ncalls AND tc.nofficeid = f.nofficeid
    LEFT JOIN trdcalls3parts p (NOLOCK) ON tc.ncode = p.ncalls AND tc.nofficeid = p.nofficeid
    LEFT JOIN mstitems new_i (NOLOCK) ON p.nitem = new_i.ncode
    LEFT JOIN mstitems old_i (NOLOCK) ON p.noldnitemcode = old_i.ncode
    LEFT JOIN trdcalls3parts1serialno s (NOLOCK) ON p.ncode = s.ncalls3 AND p.nofficeid = s.nofficeid
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice parent (NOLOCK) ON o.nunder = parent.ncode
    LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
    WHERE f.nrepair = 19
      AND ISNULL(tc.vserialno, '') <> ''
      AND ${REPEAT_CALL_NO_EXPR} IS NOT NULL
      AND (new_i.vname IS NULL OR LOWER(new_i.vname) LIKE '%compressor%')
      ${REPEAT_OFFICE_EXCLUDE_SQL}
      ${serialsCondition}
    ORDER BY tc.vserialno, tc.dtrndate ASC
    ${pagination}
  `;
}

export function buildCompressorBarcodesCountRawSql(): string {
  return `
    SELECT COUNT(1) as total
    FROM trdcalls2fault f (NOLOCK)
    INNER JOIN trhcalls tc (NOLOCK) ON tc.ncode = f.ncalls AND tc.nofficeid = f.nofficeid
    LEFT JOIN trdcalls3parts p (NOLOCK) ON tc.ncode = p.ncalls AND tc.nofficeid = p.nofficeid
    LEFT JOIN mstitems new_i (NOLOCK) ON p.nitem = new_i.ncode
    LEFT JOIN trdcalls3parts1serialno s (NOLOCK) ON p.ncode = s.ncalls3 AND p.nofficeid = s.nofficeid
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    WHERE f.nrepair = 19
      AND ISNULL(tc.vserialno, '') <> ''
      AND ${REPEAT_CALL_NO_EXPR} IS NOT NULL
      AND (new_i.vname IS NULL OR LOWER(new_i.vname) LIKE '%compressor%')
      ${REPEAT_OFFICE_EXCLUDE_SQL}
  `;
}

export function buildGasChargingSerialsSql(): string {
  return `
    SELECT DISTINCT tc.vserialno as serial_number
    FROM trdcalls2fault f (NOLOCK)
    INNER JOIN trhcalls tc (NOLOCK) ON tc.ncode = f.ncalls AND tc.nofficeid = f.nofficeid
    INNER JOIN mstrepair r (NOLOCK) ON f.nrepair = r.ncode
    WHERE LTRIM(RTRIM(r.vname)) = 'Gas Charging Done'
      AND ISNULL(tc.vserialno, '') <> ''
  `;
}

export function buildGasChargingModifiedSerialsSql(sinceDate: string): string {
  const safeDate = sinceDate.replace(/'/g, "''");
  return `
    SELECT DISTINCT tc.vserialno as serial_number
    FROM trdcalls2fault f (NOLOCK)
    INNER JOIN trhcalls tc (NOLOCK) ON tc.ncode = f.ncalls AND tc.nofficeid = f.nofficeid
    INNER JOIN mstrepair r (NOLOCK) ON f.nrepair = r.ncode
    WHERE LTRIM(RTRIM(r.vname)) = 'Gas Charging Done'
      AND ISNULL(tc.vserialno, '') <> ''
      AND ISNULL(tc.editedon, tc.addedon) >= '${safeDate}'
  `;
}

export function buildRepeatCallsModifiedSerialsSql(sinceDate: string): string {
  return `
    SELECT DISTINCT serial_number FROM (
      ${buildCompressorBarcodesModifiedSerialsSql(sinceDate)}
      UNION
      ${buildGasChargingModifiedSerialsSql(sinceDate)}
    ) u
  `;
}

export function buildGasChargingListRawSql(opts?: {
  limit?: number;
  offset?: number;
  serials?: string[];
}): string {
  const { pagination, serialsCondition } = crmListPaging(opts);

  return `
    SELECT
      tc.vserialno as serial_number,
      ${REPEAT_CALL_NO_EXPR} as call_no,
      tc.ncode as call_ncode,
      tc.nofficeid as office_id,
      CONVERT(varchar(30), tc.dtrndate, 126) as call_date,
      CASE
        WHEN tc.bsolved = 1 THEN CONVERT(varchar(30), tc.dsolvedatetime, 126)
        WHEN tc.bfastclose = 1 THEN CONVERT(varchar(30), tc.editedon, 126)
        ELSE CONVERT(varchar(30), tc.dsolvedatetime, 126)
      END as solve_date,
      ${REPEAT_CRM_CALL_STATUS_SQL} as call_status,
      cr.vname as cancel_reason,
      o.vcompanyname as office_name,
      o.vsapvendorcode as sap_vendor_code,
      ISNULL(parent.vcompanyname, o.vcompanyname) as branch_name
    FROM trdcalls2fault f (NOLOCK)
    INNER JOIN trhcalls tc (NOLOCK) ON tc.ncode = f.ncalls AND tc.nofficeid = f.nofficeid
    INNER JOIN mstrepair r (NOLOCK) ON f.nrepair = r.ncode
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice parent (NOLOCK) ON o.nunder = parent.ncode
    LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
    WHERE LTRIM(RTRIM(r.vname)) = 'Gas Charging Done'
      AND ISNULL(tc.vserialno, '') <> ''
      AND ${REPEAT_CALL_NO_EXPR} IS NOT NULL
      ${REPEAT_OFFICE_EXCLUDE_SQL}
      ${serialsCondition}
    ORDER BY tc.vserialno, tc.dtrndate ASC
    ${pagination}
  `;
}

