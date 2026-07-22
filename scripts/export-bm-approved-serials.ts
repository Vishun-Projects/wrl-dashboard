/**
 * Export serial numbers for BM-approved ARCP claims and linked trhcalls (live CRM).
 *
 * Usage:
 *   npx tsx scripts/export-bm-approved-serials.ts [startDate] [endDate] [franchiseeNcode]
 *
 * Example (Abhijeet Refrigeration, April 2026):
 *   npx tsx scripts/export-bm-approved-serials.ts 2026-04-01 2026-04-30 152
 *
 * Writes:
 *   exports/arcp-bm-approved-serials_<start>_<end>.csv
 *   exports/trhcalls-bm-approved-serials_<start>_<end>.csv
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { postQuery, isCrmOutOfMemoryError } from '../src/lib/db/proxy';
import { queryArcpClaimsDetailRows } from '../src/features/arcp/lib/server/postgres';
import {
  buildArcpClaimsFilterCondition,
  splitArcpDateRange,
  type ArcpClaimsDetailRow,
} from '../src/features/arcp/lib/query';
import { escapeCsvCell } from '../src/lib/utils/csv';

const startDate = process.argv[2] || '2026-04-01';
const endDate = process.argv[3] || '2026-04-30';
const franchisee = process.argv[4]?.trim() || '';

const ARCP_NOT_REJECTED = `
  AND ISNULL(arcp.breject, '0') NOT IN ('1', 'True', 'true')
  AND ISNULL(arcp.brejectho, '0') NOT IN ('1', 'True', 'true')`;

const ARCP_INCLUDED_LINES = `
  AND (
    (ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0')
    OR (
      ISNULL(arcp.nitemcategory, '') <> ''
      AND arcp.nitemcategory <> '0'
      AND EXISTS (
        SELECT 1 FROM mstitemcategory ic (NOLOCK)
        WHERE CAST(ic.ncode AS VARCHAR(50)) = CAST(arcp.nitemcategory AS VARCHAR(50))
          AND COALESCE(
            NULLIF(LTRIM(RTRIM(ic.vname)), ''),
            NULLIF(LTRIM(RTRIM(ic.vshortname)), '')
          ) IS NOT NULL
      )
    )
  )`;

const SERIAL_EXPR = `COALESCE(
  NULLIF(LTRIM(RTRIM(CAST(arcp.vitemserialno AS VARCHAR(80)))), ''),
  NULLIF(LTRIM(RTRIM(CAST(arcp.nitemserialno AS VARCHAR(80)))), ''),
  NULLIF(LTRIM(RTRIM(CAST(tc.vserialno AS VARCHAR(80)))), '')
)`;

function buildWhere(chunkStart: string, chunkEnd: string): string {
  const base = buildArcpClaimsFilterCondition({
    startDate: chunkStart,
    endDate: chunkEnd,
    dateFilterColumn: 'bm_approved_at',
    franchisee: franchisee || undefined,
    isHod: true,
  });
  return `${base}${ARCP_NOT_REJECTED}${ARCP_INCLUDED_LINES}`;
}

function buildArcpSerialsByNcodesSql(ncodes: string[]): string {
  const inList = ncodes.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(', ');
  return `
SELECT
  CAST(arcp.ncode AS VARCHAR(50)) AS arcp_line_code,
  NULLIF(LTRIM(RTRIM(CAST(arcp.vitemserialno AS VARCHAR(80)))), '') AS arcp_vitemserialno,
  NULLIF(LTRIM(RTRIM(CAST(arcp.nitemserialno AS VARCHAR(80)))), '') AS arcp_nitemserialno,
  CAST(tf.ncalls AS VARCHAR(50)) AS call_ncode
FROM trdcalls10ARCP arcp (NOLOCK)
LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
WHERE CAST(arcp.ncode AS VARCHAR(50)) IN (${inList})
`.trim();
}

function buildArcpSerialsSql(chunkStart: string, chunkEnd: string): string {
  const where = buildWhere(chunkStart, chunkEnd);
  return `
SELECT
  arcp.ncode AS arcp_line_code,
  NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') AS ucn,
  CAST(tf.ncalls AS VARCHAR(50)) AS call_ncode,
  NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') AS call_no,
  CAST(arcp.nofficeid AS VARCHAR(50)) AS franchisee_code,
  COALESCE(NULLIF(LTRIM(RTRIM(o.vcompanyname)), ''), NULLIF(LTRIM(RTRIM(o.valiasname)), '')) AS franchisee_name,
  ${SERIAL_EXPR} AS serial_no,
  NULLIF(LTRIM(RTRIM(CAST(arcp.vitemserialno AS VARCHAR(80)))), '') AS arcp_vitemserialno,
  NULLIF(LTRIM(RTRIM(CAST(arcp.nitemserialno AS VARCHAR(80)))), '') AS arcp_nitemserialno,
  NULLIF(LTRIM(RTRIM(CAST(tc.vserialno AS VARCHAR(80)))), '') AS trhcalls_vserialno,
  NULLIF(LTRIM(RTRIM(CAST(arcp.dbmapproveddate AS VARCHAR(30)))), '') AS bm_approved_date,
  ${`TRY_CAST(NULLIF(LTRIM(RTRIM(REPLACE(REPLACE(CAST(arcp.nbmapprovedamt AS VARCHAR(50)), ',', ''), ' ', ''))), '') AS FLOAT)`} AS bm_approved_amount,
  CASE
    WHEN ISNULL(arcp.ntraveltype, '') <> '' AND arcp.ntraveltype <> '0' THEN 'Travel'
    ELSE 'Service'
  END AS line_type,
  CONVERT(varchar(30), arcp.dcalllogdatetime, 103) AS call_log_date,
  CONVERT(varchar(30), arcp.dsolveddatetime, 103) AS solve_date
FROM trdcalls10ARCP arcp (NOLOCK)
LEFT JOIN mstoffice o (NOLOCK) ON arcp.nofficeid = o.ncode
LEFT JOIN trdcalls2fault tf (NOLOCK) ON arcp.ncalls2fault = tf.ncode
LEFT JOIN trhcalls tc (NOLOCK) ON (
  NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') IS NOT NULL
  AND NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '')
    = NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '')
)
OR (
  NULLIF(LTRIM(RTRIM(CAST(arcp.vucnno AS VARCHAR(50)))), '') IS NULL
  AND CAST(tf.ncalls AS VARCHAR(50)) = CAST(tc.ncode AS VARCHAR(50))
)
WHERE ${where}
ORDER BY tc.editedon, arcp.ncode
`.trim();
}

function sqlInList(values: string[]): string {
  return values.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(', ');
}

function buildTrhcallsLookupSql(ncodes: string[], callNos: string[]): string {
  const parts: string[] = [];
  if (ncodes.length > 0) {
    parts.push(`CAST(tc.ncode AS VARCHAR(50)) IN (${sqlInList(ncodes)})`);
  }
  if (callNos.length > 0) {
    parts.push(`NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') IN (${sqlInList(callNos)})`);
  }
  const where = parts.length > 0 ? parts.join(' OR ') : '1=0';
  return `
SELECT
  CAST(tc.ncode AS VARCHAR(50)) AS call_ncode,
  NULLIF(LTRIM(RTRIM(CAST(tc.vtrnno AS VARCHAR(50)))), '') AS call_no,
  NULLIF(LTRIM(RTRIM(CAST(tc.vserialno AS VARCHAR(80)))), '') AS serial_no,
  CAST(tc.nofficeid AS VARCHAR(50)) AS office_code,
  COALESCE(NULLIF(LTRIM(RTRIM(o.vcompanyname)), ''), NULLIF(LTRIM(RTRIM(o.valiasname)), '')) AS office_name,
  CONVERT(varchar(30), tc.dtrndate, 103) AS call_date,
  CONVERT(varchar(30), tc.dsolvedatetime, 103) AS solve_date
FROM trhcalls tc (NOLOCK)
LEFT JOIN mstoffice o (NOLOCK) ON tc.nofficeid = o.ncode
WHERE ${where}
ORDER BY tc.dtrndate DESC, tc.vtrnno
`.trim();
}

const CRM_GAP_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeByKey(
  target: Map<string, Record<string, unknown>>,
  rows: Record<string, unknown>[],
  keyField: string
): void {
  for (const row of rows) {
    const key = String(row[keyField] ?? '').trim();
    if (!key) continue;
    if (!target.has(key)) target.set(key, row);
  }
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

async function fetchRows(sql: string): Promise<Record<string, unknown>[]> {
  const res = await postQuery({ rawSql: sql, timeoutMs: 300_000 });
  return (res.data || []) as Record<string, unknown>[];
}

async function loadArcpFromPostgres(): Promise<ArcpClaimsDetailRow[]> {
  try {
    return await queryArcpClaimsDetailRows({
      startDate,
      endDate,
      dateFilterColumn: 'bm_approved_at',
      franchisee: franchisee || undefined,
      isHod: true,
    });
  } catch (err) {
    console.warn('  Postgres read failed, will use CRM only:', err instanceof Error ? err.message : err);
    return [];
  }
}

function pgRowsToExportRows(pg: ArcpClaimsDetailRow[]): Record<string, unknown>[] {
  return pg.map((row) => ({
    arcp_line_code: row.ncode,
    ucn: row.vucnno,
    call_ncode:
      String(row.vucnno ?? '').trim() ||
      String(row.call_no ?? '').trim() ||
      String(row.calls2fault_code ?? '').trim(),
    call_no: row.call_no || row.vucnno,
    franchisee_code: row.franchisee_code,
    franchisee_name: row.franchisee_name,
    serial_no: '',
    arcp_vitemserialno: '',
    arcp_nitemserialno: '',
    trhcalls_vserialno: '',
    bm_approved_date: row.bm_approved_date,
    bm_approved_amount: row.raw_nbmapprovedamt ?? row.branch_approved,
    line_type: row.line_type,
    call_log_date: row.call_date,
    solve_date: row.solve_date,
  }));
}

async function enrichSerialsFromCrm(rows: Record<string, unknown>[]): Promise<void> {
  const ncodes = [...new Set(rows.map((r) => String(r.arcp_line_code ?? '').trim()).filter(Boolean))];
  if (ncodes.length === 0) return;

  console.log(`  CRM serial lookup for ${ncodes.length} ARCP lines…`);
  const serialByNcode = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < ncodes.length; i += 25) {
    const batch = ncodes.slice(i, i + 25);
    try {
      const crm = await fetchRows(buildArcpSerialsByNcodesSql(batch));
      for (const r of crm) {
        const key = String(r.arcp_line_code ?? '').trim();
        if (key) serialByNcode.set(key, r);
      }
    } catch (err) {
      console.warn(`    batch ${i / 25 + 1} failed:`, err instanceof Error ? err.message : err);
    }
    await sleep(CRM_GAP_MS);
  }

  for (const row of rows) {
    const hit = serialByNcode.get(String(row.arcp_line_code ?? '').trim());
    if (!hit) continue;
    row.arcp_vitemserialno = hit.arcp_vitemserialno;
    row.arcp_nitemserialno = hit.arcp_nitemserialno;
    row.call_ncode = hit.call_ncode || row.call_ncode;
    row.serial_no = hit.arcp_vitemserialno || hit.arcp_nitemserialno || row.serial_no;
  }
}

async function fetchArcpSerialsChunked(): Promise<Record<string, unknown>[]> {
  const chunks = splitArcpDateRange(startDate, endDate, 3);
  const byLine = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < chunks.length; i++) {
    const { start, end } = chunks[i];
    console.log(`  ARCP chunk ${i + 1}/${chunks.length}: ${start} → ${end}`);
    try {
      const rows = await fetchRows(buildArcpSerialsSql(start, end));
      mergeByKey(byLine, rows, 'arcp_line_code');
      console.log(`    ${rows.length} lines (${byLine.size} unique total)`);
    } catch (err) {
      if (!isCrmOutOfMemoryError(err) || start === end) throw err;
      const sub = splitArcpDateRange(start, end, 1);
      for (const day of sub) {
        const rows = await fetchRows(buildArcpSerialsSql(day.start, day.end));
        mergeByKey(byLine, rows, 'arcp_line_code');
        await sleep(CRM_GAP_MS);
      }
    }
    await sleep(CRM_GAP_MS);
  }

  return Array.from(byLine.values());
}

function summarizeCallsFromArcp(arcpRows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byCall = new Map<string, Record<string, unknown>>();
  for (const row of arcpRows) {
    const callNcode =
      String(row.call_ncode ?? '').trim() ||
      String(row.call_no ?? '').trim() ||
      String(row.ucn ?? '').trim();
    if (!callNcode) continue;
    const existing = byCall.get(callNcode);
    const bmAmt = Number(row.bm_approved_amount) || 0;
    if (!existing) {
      byCall.set(callNcode, {
        call_ncode: callNcode,
        call_no: row.call_no,
        serial_no: row.trhcalls_vserialno || row.serial_no,
        office_code: row.franchisee_code,
        office_name: row.franchisee_name,
        bm_approved_date: row.bm_approved_date,
        bm_approved_amount: bmAmt,
        arcp_line_count: 1,
        ucn_list: row.ucn,
      });
      continue;
    }
    existing.arcp_line_count = Number(existing.arcp_line_count) + 1;
    if (!existing.serial_no && row.serial_no) existing.serial_no = row.serial_no;
    if (!existing.ucn_list && row.ucn) existing.ucn_list = row.ucn;
    if (bmAmt > Number(existing.bm_approved_amount)) existing.bm_approved_amount = bmAmt;
  }
  return Array.from(byCall.values());
}

async function enrichTrhcallsFromCrm(
  callSummaries: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const byKey = new Map(
    callSummaries.map((r) => {
      const key = String(r.call_ncode ?? '').trim();
      return [key, { ...r }];
    })
  );

  const keys = [...byKey.keys()];
  const callNos = keys.filter((k) => /[A-Za-z]/.test(k));
  const ncodes = keys.filter((k) => !/[A-Za-z]/.test(k));

  for (let i = 0; i < keys.length; i += 30) {
    const batchKeys = keys.slice(i, i + 30);
    const batchNcodes = batchKeys.filter((k) => !/[A-Za-z]/.test(k));
    const batchCallNos = batchKeys.filter((k) => /[A-Za-z]/.test(k));
    try {
      const rows = await fetchRows(buildTrhcallsLookupSql(batchNcodes, batchCallNos));
      for (const tc of rows) {
        const tcNcode = String(tc.call_ncode ?? '').trim();
        const tcCallNo = String(tc.call_no ?? '').trim();
        const existing = byKey.get(tcNcode) ?? byKey.get(tcCallNo);
        if (!existing) continue;
        existing.call_ncode = tcNcode || existing.call_ncode;
        existing.call_no = existing.call_no || tcCallNo;
        existing.serial_no = tc.serial_no || existing.serial_no;
        existing.call_date = tc.call_date;
        existing.solve_date = tc.solve_date;
        if (!existing.office_name) existing.office_name = tc.office_name;
        if (existing.serial_no && !existing.trhcalls_vserialno) {
          existing.trhcalls_vserialno = existing.serial_no;
        }
      }
    } catch (err) {
      console.warn(`    trhcalls batch ${i / 30 + 1} failed:`, err instanceof Error ? err.message : err);
    }
    await sleep(CRM_GAP_MS);
  }

  return Array.from(byKey.values()).sort((a, b) =>
    String(a.bm_approved_date ?? '').localeCompare(String(b.bm_approved_date ?? ''))
  );
}

async function main() {
  const outDir = join(process.cwd(), 'exports');
  mkdirSync(outDir, { recursive: true });
  const suffix = franchisee
    ? `${startDate}_${endDate}_fr${franchisee}`
    : `${startDate}_${endDate}`;

  console.log(`BM-approved serial export ${startDate} → ${endDate}${franchisee ? ` franchisee ${franchisee}` : ''}`);
  console.log('Loading BM-approved ARCP lines (Postgres cache)…');
  const pgRows = await loadArcpFromPostgres();
  let arcpRows: Record<string, unknown>[];

  if (pgRows.length > 0) {
    arcpRows = pgRowsToExportRows(pgRows);
    console.log(`  ${arcpRows.length} lines from arcp_lines_hot`);
    await enrichSerialsFromCrm(arcpRows);
  } else {
    console.log('  Cache empty — querying CRM (chunked)…');
    arcpRows = await fetchArcpSerialsChunked();
  }

  const arcpHeaders = [
    'arcp_line_code',
    'ucn',
    'call_ncode',
    'call_no',
    'franchisee_code',
    'franchisee_name',
    'serial_no',
    'arcp_vitemserialno',
    'arcp_nitemserialno',
    'trhcalls_vserialno',
    'bm_approved_date',
    'bm_approved_amount',
    'line_type',
    'call_log_date',
    'solve_date',
  ];
  const arcpPath = join(outDir, `arcp-bm-approved-serials_${suffix}.csv`);
  writeFileSync(arcpPath, toCsv(arcpHeaders, arcpRows), 'utf8');

  const arcpWithSerial = arcpRows.filter((r) => String(r.serial_no ?? '').trim());
  const arcpDistinctSerials = [...new Set(arcpWithSerial.map((r) => String(r.serial_no).trim()))].sort();

  console.log(`  ARCP lines: ${arcpRows.length}, with serial: ${arcpWithSerial.length}, distinct serials: ${arcpDistinctSerials.length}`);
  console.log(`  → ${arcpPath}`);

  console.log('Building trhcalls list from BM-approved ARCP calls…');
  const callSummaries = summarizeCallsFromArcp(arcpRows);
  console.log(`  ${callSummaries.length} distinct calls — enriching serials from trhcalls…`);
  const callRows = await enrichTrhcallsFromCrm(callSummaries);

  const callHeaders = [
    'call_ncode',
    'call_no',
    'serial_no',
    'office_code',
    'office_name',
    'call_date',
    'solve_date',
    'bm_approved_date',
    'bm_approved_amount',
    'arcp_line_count',
    'ucn_list',
  ];
  const callsPath = join(outDir, `trhcalls-bm-approved-serials_${suffix}.csv`);
  writeFileSync(callsPath, toCsv(callHeaders, callRows), 'utf8');

  const callsWithSerial = callRows.filter((r) => String(r.serial_no ?? '').trim());
  const callDistinctSerials = [...new Set(callsWithSerial.map((r) => String(r.serial_no).trim()))].sort();

  console.log(`  trhcalls: ${callRows.length}, with serial: ${callsWithSerial.length}, distinct serials: ${callDistinctSerials.length}`);
  console.log(`  → ${callsPath}`);

  const serialOnlyPath = join(outDir, `distinct-serials-bm-approved_${suffix}.txt`);
  const allSerials = [...new Set([...arcpDistinctSerials, ...callDistinctSerials])].sort();
  writeFileSync(serialOnlyPath, allSerials.join('\n'), 'utf8');
  console.log(`  Distinct serial list (${allSerials.length}) → ${serialOnlyPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
