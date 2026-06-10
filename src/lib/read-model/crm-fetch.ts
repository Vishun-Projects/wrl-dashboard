import { postQuery, isCrmOutOfMemoryError } from '@/lib/db/proxy';
import {
  buildCorpusFieldsSql,
  buildCorpusTableName,
  looksLikeBranchOffice,
  TRHCALLS_EXCLUDE_TRANSFERRED,
} from '@/lib/trhcalls/query';
import { splitDateRangeByDays, formatCrmDateTime, todayLocalDate } from '@/lib/read-model/dates';
import { formatLocalDate } from '@/lib/report/filters';

const FETCH_GAP_MS = 800;
const RETRY_DELAYS_MS = [3000, 10000, 30000];

const SYNC_EXTRA_FIELDS = `
  COALESCE(NULLIF(p.vlatlong, ''), NULLIF(p.mlatlong, '')) AS latlong
`;

function buildSyncFieldsSql(): string {
  return `${buildCorpusFieldsSql().trim()},\n${SYNC_EXTRA_FIELDS.trim()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCrmChunk(params: {
  tableName: string;
  condition: string;
  orderBy?: string;
  timeoutMs?: number;
}): Promise<Record<string, string>[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const result = await postQuery(
        {
          fields: buildSyncFieldsSql(),
          tableName: params.tableName,
          condition: params.condition,
          orderBy: params.orderBy ?? 'tc.dtrndate ASC',
          timeoutMs: params.timeoutMs ?? 120000,
        },
        undefined
      );
      return (result.data ?? []) as Record<string, string>[];
    } catch (err) {
      lastErr = err;
      if (isCrmOutOfMemoryError(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchCrmRowsForRange(
  startDate: string,
  endDate: string,
  onProgress?: (info: { chunk: string; rows: number }) => void
): Promise<Record<string, unknown>[]> {
  const tableName = buildCorpusTableName({ startDate, endDate });
  const condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${TRHCALLS_EXCLUDE_TRANSFERRED}`;
  const chunks = splitDateRangeByDays(startDate, endDate, 7);
  const allRows: Record<string, unknown>[] = [];

  for (const chunk of chunks) {
    const chunkTable =
      chunk.start === startDate && chunk.end === endDate
        ? tableName
        : buildCorpusTableName({ startDate: chunk.start, endDate: chunk.end });
    const rows = await fetchCrmChunk({
      tableName: chunkTable,
      condition,
    });
    allRows.push(...rows);
    onProgress?.({ chunk: `${chunk.start}..${chunk.end}`, rows: rows.length });
    await sleep(FETCH_GAP_MS);
  }

  return allRows;
}

export async function fetchCrmIncrementalRows(
  watermarkStart: Date,
  onProgress?: (info: { chunk: string; rows: number; total: number }) => void
): Promise<Record<string, unknown>[]> {
  const watermark = formatCrmDateTime(watermarkStart);
  const startDate = formatLocalDate(watermarkStart);
  const endDate = todayLocalDate();
  const chunks = splitDateRangeByDays(startDate, endDate, 7);
  const condition = `(tc.vtrnno IS NOT NULL AND tc.vtrnno <> '')${TRHCALLS_EXCLUDE_TRANSFERRED}`;
  const allRows: Record<string, unknown>[] = [];

  const catchUpDays = Math.max(
    0,
    Math.ceil((Date.now() - watermarkStart.getTime()) / (24 * 60 * 60 * 1000))
  );
  if (catchUpDays > 1) {
    console.log(
      `[sync-worker] CRM catch-up mode: ~${catchUpDays} day(s), ${chunks.length} chunk(s) (${startDate}..${endDate})`
    );
  }

  for (const chunk of chunks) {
    const tableName = buildCorpusTableName({
      lastSync: watermark,
      startDate: chunk.start,
      endDate: chunk.end,
    });
    const rows = await fetchCrmChunk({
      tableName,
      condition,
      orderBy: 'ISNULL(tc.editedon, tc.addedon) ASC',
      timeoutMs: 180000,
    });
    allRows.push(...rows);
    onProgress?.({
      chunk: `${chunk.start}..${chunk.end}`,
      rows: rows.length,
      total: allRows.length,
    });
    await sleep(FETCH_GAP_MS);
  }

  return allRows;
}

/** Open calls logged more than 90 days ago (~1,801 TRNs). */
export async function fetchCrmOpenOldRows(): Promise<Record<string, unknown>[]> {
  const tableName = `
    (
      SELECT *
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
            ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
          ) AS rn
        FROM trhcalls (NOLOCK)
        WHERE dtrndate < DATEADD(day, -90, GETDATE())
          AND ISNULL(bsolved, 0) = 0
          AND ISNULL(bfastclose, 0) = 0
          AND (ncancelreason IS NULL OR ncancelreason = 0)
          AND vtrnno IS NOT NULL AND vtrnno <> ''
          AND ISNULL(vtransfercallno, '') = ''
          AND ISNULL(CAST(ncancelreason AS INT), 0) <> 2
      ) s
      WHERE s.rn = 1
    ) tc
    LEFT JOIN mstparty p (NOLOCK) ON tc.nparty = p.ncode
    LEFT JOIN mstpartyprofile pprof (NOLOCK) ON tc.npartyprofile = pprof.ncode
    LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
    LEFT JOIN mstoffice bo (NOLOCK) ON o.nunder = bo.ncode
    LEFT JOIN mstoffice op (NOLOCK) ON o.nunder = op.ncode AND o.nunder <> 0
    LEFT JOIN mstzones z (NOLOCK) ON (CASE WHEN ISNULL(o.nunder, 0) = 0 THEN o.nzone ELSE op.nzone END) = z.ncode
    LEFT JOIN (
      SELECT nofficeid, COUNT(DISTINCT ncode) AS branch_headcount
      FROM mstusers (NOLOCK)
      WHERE bactive = 'True'
      GROUP BY nofficeid
    ) hc ON o.ncode = hc.nofficeid
    LEFT JOIN mstusers u (NOLOCK) ON tc.nengineer = u.ncode
    LEFT JOIN mstoffice f (NOLOCK) ON u.nofficeid = f.ncode
    LEFT JOIN mstoffice transferoffice (NOLOCK) ON tc.ntransfertooffice = transferoffice.ncode
    LEFT JOIN mstcity cty (NOLOCK) ON COALESCE(NULLIF(p.ncity, ''), o.ncity) = cty.ncode
    LEFT JOIN mststate st (NOLOCK) ON cty.nstate = st.ncode
    LEFT JOIN mstitems (NOLOCK) ON tc.nitem = mstitems.ncode
    LEFT JOIN mstfixedselection calltype_fs (NOLOCK) ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
    LEFT JOIN mstcallcancelreasons cr (NOLOCK) ON tc.ncancelreason = cr.ncode
  `;

  return fetchCrmChunk({
    tableName,
    condition: '1=1',
    orderBy: 'tc.dtrndate ASC',
    timeoutMs: 180000,
  });
}

export async function fetchDimOffices(): Promise<Record<string, string>[]> {
  const result = await postQuery({
    fields: 'ncode, vcompanyname, nunder, nzone',
    tableName: 'mstoffice (NOLOCK)',
    condition: '1=1',
    orderBy: 'ncode ASC',
  });
  return (result.data ?? []) as Record<string, string>[];
}

export async function fetchDimEngineers(): Promise<Record<string, string>[]> {
  const result = await postQuery({
    fields: 'ncode, vname, nofficeid',
    tableName: 'mstusers (NOLOCK)',
    condition: "bactive = 'True'",
    orderBy: 'vname ASC',
  });
  return (result.data ?? []) as Record<string, string>[];
}

export async function fetchDimCallTypes(): Promise<Record<string, string>[]> {
  const result = await postQuery({
    fields: 'ncode, vdisplayvalue',
    tableName: 'mstfixedselection (NOLOCK)',
    condition: "vfieldname = 'ncalltype'",
    orderBy: 'vdisplayvalue ASC',
  });
  return (result.data ?? []) as Record<string, string>[];
}

export { looksLikeBranchOffice };
