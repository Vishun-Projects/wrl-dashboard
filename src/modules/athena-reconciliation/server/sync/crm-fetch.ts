import { postQuery } from '@/lib/db/proxy';
import { formatCrmDateTime } from '@/lib/read-model/dates';
import type { CrmAthenaFailedRow } from '@/modules/athena-reconciliation/types';

const CRM_TIMEOUT_MS = Number(process.env.ATHENA_CRM_TIMEOUT_MS ?? 180_000) || 180_000;

export type FetchAthenaFailedCallsOptions = {
  dateFrom?: string | null;
  dateTo?: string | null;
  watermarkAddedon?: Date | null;
  watermarkToExclusive?: Date | null;
  fullBackfill?: boolean;
  top?: number;
};

function crmDateTimeLiteral(d: Date): string {
  return formatCrmDateTime(d).replace(/'/g, "''");
}

export function buildAthenaFetchSql(opts?: FetchAthenaFailedCallsOptions): string {
  const conditions: string[] = ['1=1'];

  if (opts?.watermarkAddedon) {
    conditions.push(
      `TRY_CONVERT(DATETIME, addedon, 103) >= TRY_CONVERT(DATETIME, '${crmDateTimeLiteral(opts.watermarkAddedon)}', 120)`
    );
    if (opts?.watermarkToExclusive) {
      conditions.push(
        `TRY_CONVERT(DATETIME, addedon, 103) < TRY_CONVERT(DATETIME, '${crmDateTimeLiteral(opts.watermarkToExclusive)}', 120)`
      );
    }
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
    const startYear = Number(process.env.ATHENA_SYNC_START_YEAR ?? new Date().getFullYear());
    conditions.push(
      `TRY_CONVERT(DATETIME, addedon, 103) >= TRY_CONVERT(DATETIME, '${startYear}-01-01', 120)`
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

/**
 * Split open-ended incremental catch-up into local-day windows.
 * Open `>= watermark` queries OOM CRM after a few days ("Date range too large").
 */
export function athenaIncrementalWindows(
  watermark: Date,
  end: Date = new Date()
): Array<{ from: Date; toExclusive: Date }> {
  const endMs = end.getTime();
  if (!(watermark instanceof Date) || Number.isNaN(watermark.getTime()) || !(endMs > watermark.getTime())) {
    return [];
  }
  const overlapMs = Math.max(
    0,
    Number(process.env.ATHENA_WATERMARK_OVERLAP_MS ?? 3_600_000) || 3_600_000
  );
  const windows: Array<{ from: Date; toExclusive: Date }> = [];
  let cursor = new Date(Math.max(0, watermark.getTime() - overlapMs));
  while (cursor.getTime() < endMs) {
    const nextMidnight = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    const toExclusive = nextMidnight.getTime() > endMs ? new Date(endMs) : nextMidnight;
    if (toExclusive.getTime() <= cursor.getTime()) break;
    windows.push({ from: new Date(cursor.getTime()), toExclusive });
    cursor = toExclusive;
  }
  return windows;
}

function rowDedupeKey(row: CrmAthenaFailedRow): string {
  return [
    row.CLIENTTICKETNO ?? '',
    row.SERIALNO ?? '',
    row.addedon ?? '',
    row.OUTLETNAME ?? '',
    row.CALLTYPE ?? '',
  ].join('|');
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

/** Watermark pull split into daily CRM windows (nightly + daemon when watermark is stale). */
export async function fetchCrmAthenaFailedCallsIncremental(
  watermark: Date,
  end: Date = new Date()
): Promise<CrmAthenaFailedRow[]> {
  const windows = athenaIncrementalWindows(watermark, end);
  if (windows.length === 0) {
    return fetchCrmAthenaFailedCalls({ watermarkAddedon: watermark });
  }
  if (windows.length === 1) {
    return fetchCrmAthenaFailedCalls({
      watermarkAddedon: windows[0]!.from,
      watermarkToExclusive: windows[0]!.toExclusive,
    });
  }

  const seen = new Set<string>();
  const merged: CrmAthenaFailedRow[] = [];
  for (const w of windows) {
    console.log(
      `[athena-sync] Fetching chunk ${formatCrmDateTime(w.from)} → ${formatCrmDateTime(w.toExclusive)}`
    );
    const chunk = await fetchCrmAthenaFailedCalls({
      watermarkAddedon: w.from,
      watermarkToExclusive: w.toExclusive,
    });
    for (const row of chunk) {
      const key = rowDedupeKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
}
