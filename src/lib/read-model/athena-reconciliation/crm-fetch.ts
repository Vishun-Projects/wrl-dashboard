import { postQuery } from '@/lib/db/proxy';
import type { CrmAthenaFailedRow } from './types';

const CRM_TIMEOUT_MS = Number(process.env.ATHENA_CRM_TIMEOUT_MS ?? 180_000) || 180_000;

export type FetchAthenaFailedCallsOptions = {
  dateFrom?: string | null;
  dateTo?: string | null;
  watermarkAddedon?: Date | null;
  fullBackfill?: boolean;
  top?: number;
};

export function buildAthenaFetchSql(opts?: FetchAthenaFailedCallsOptions): string {
  const conditions: string[] = ['1=1'];

  if (opts?.watermarkAddedon) {
    const iso = opts.watermarkAddedon.toISOString().slice(0, 19).replace('T', ' ');
    conditions.push(
      `TRY_CONVERT(DATETIME, addedon, 103) >= TRY_CONVERT(DATETIME, '${iso}', 120)`
    );
  } else if (opts?.dateFrom) {
    conditions.push(
      `TRY_CONVERT(DATETIME, addedon, 103) >= TRY_CONVERT(DATETIME, '${opts.dateFrom}', 120)`
    );
    if (opts?.dateTo) {
      conditions.push(
        `TRY_CONVERT(DATETIME, addedon, 103) <= TRY_CONVERT(DATETIME, '${opts.dateTo} 23:59:59', 120)`
      );
    }
  } else if (!opts?.fullBackfill) {
    // Default initial window: YTD 2026 to ensure instant sync without loading years of cold history at once
    conditions.push(
      `TRY_CONVERT(DATETIME, addedon, 103) >= TRY_CONVERT(DATETIME, '2026-01-01', 120)`
    );
  }

  const topClause = opts?.top ? `TOP ${opts.top}` : '';

  return `
    SELECT ${topClause}
      ClientCaption,
      BRANCHNAME,
      CLIENTTICKETNO,
      MCSTATUS,
      CALLTYPE,
      NATUREOFCOMPLAINT,
      RECEIVEDDATE,
      ASPOFFICEID,
      OUTLETNAME,
      CLIENTCODE1,
      CLIENT,
      TOWN,
      AREANAME,
      OUTLETNAMEADDRESS,
      PINCODE,
      PHONE,
      MODEL,
      SERIALNO,
      ASSETNO1,
      INVOICENO,
      Product_Status,
      INVOICEDATE,
      RESULT,
      RESULT_VALUE,
      addedon
    FROM rpt_failedathenacalls
    WHERE ${conditions.join(' AND ')}
  `;
}

export async function fetchCrmAthenaFailedCalls(
  opts?: FetchAthenaFailedCallsOptions
): Promise<CrmAthenaFailedRow[]> {
  const sql = buildAthenaFetchSql(opts);
  const result = await postQuery({
    rawSql: sql,
    timeoutMs: CRM_TIMEOUT_MS,
  });

  const rawRows = (result.data || []) as Record<string, string>[];
  return rawRows as CrmAthenaFailedRow[];
}
