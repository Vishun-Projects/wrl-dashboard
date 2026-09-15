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
  const pagination =
    typeof opts?.limit === 'number' && opts.limit > 0
      ? `OFFSET ${opts.offset ?? 0} ROWS FETCH NEXT ${opts.limit} ROWS ONLY`
      : '';

  const serialsCondition =
    opts?.serials && opts.serials.length > 0
      ? `AND tc.vserialno IN (${opts.serials.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')})`
      : '';

  return `
    SELECT 
      tc.vserialno as serial_number,
      COALESCE(
        NULLIF(LTRIM(RTRIM(tc.vtrnno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vtransfercallno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vmanualjobno)), '')
      ) as call_no,
      tc.ncode as call_ncode,
      tc.nofficeid as office_id,
      CONVERT(varchar(30), tc.dtrndate, 126) as call_date,
      CASE 
        WHEN tc.bsolved = 1 THEN CONVERT(varchar(30), tc.dsolvedatetime, 126)
        WHEN tc.bfastclose = 1 THEN CONVERT(varchar(30), tc.editedon, 126)
        ELSE CONVERT(varchar(30), tc.dsolvedatetime, 126)
      END as solve_date,
      CASE 
        WHEN (tc.vtransfercallno IS NOT NULL AND LTRIM(RTRIM(tc.vtransfercallno)) <> '') OR tc.ncancelreason = 2 THEN 'Transferred'
        WHEN ISNULL(tc.ncancelreason, 0) NOT IN (0, 2) THEN 'Cancelled'
        WHEN tc.bsolved = 1 THEN 'Closed'
        WHEN tc.bfastclose = 1 THEN 'Tech Solved'
        WHEN ISNULL(tc.nengineer, 0) <> 0 THEN 'Assigned'
        WHEN tc.callStatus IS NOT NULL AND LTRIM(RTRIM(tc.callStatus)) NOT IN ('', 'NULL') THEN LTRIM(RTRIM(tc.callStatus))
        ELSE 'Open'
      END as call_status,
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
      AND COALESCE(
        NULLIF(LTRIM(RTRIM(tc.vtrnno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vtransfercallno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vmanualjobno)), '')
      ) IS NOT NULL
      AND (new_i.vname IS NULL OR LOWER(new_i.vname) LIKE '%compressor%')
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%PRACTICE%'
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%WINMAX%'
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%WESTERN HEAD OFFICE - 1100%'
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
      AND COALESCE(
        NULLIF(LTRIM(RTRIM(tc.vtrnno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vtransfercallno)), ''),
        NULLIF(LTRIM(RTRIM(tc.vmanualjobno)), '')
      ) IS NOT NULL
      AND (new_i.vname IS NULL OR LOWER(new_i.vname) LIKE '%compressor%')
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%PRACTICE%'
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%WINMAX%'
      AND ISNULL(o.vcompanyname, '') NOT LIKE '%WESTERN HEAD OFFICE - 1100%'
  `;
}

