/**
 * Find serial(s) and datetime 15.04.2026 16:29:09 across CRM call/ARCP tables.
 * Usage: npx tsx scripts/find-serial-datetime.ts
 */
import { postQuery } from '../src/lib/db/proxy';

const SERIALS = ['26B20231', '42213251100902'];
const DATE_PATTERNS = [
  '%15/04/2026%16:29%',
  '%15.04.2026%16:29%',
  '%2026-04-15%16:29%',
  '%15-04-2026%16:29%',
];

function esc(s: string) {
  return s.replace(/'/g, "''");
}

function serialWhere(cols: string[]): string {
  const parts: string[] = [];
  for (const col of cols) {
    for (const s of SERIALS) {
      parts.push(`LTRIM(RTRIM(CAST(${col} AS VARCHAR(50)))) = '${esc(s)}'`);
      parts.push(`LTRIM(RTRIM(CAST(${col} AS VARCHAR(50)))) LIKE '%${esc(s)}%'`);
    }
  }
  return `(${parts.join(' OR ')})`;
}

function dateWhere(cols: string[]): string {
  const parts: string[] = [];
  for (const col of cols) {
    for (const p of DATE_PATTERNS) {
      parts.push(`LTRIM(RTRIM(CAST(${col} AS VARCHAR(40)))) LIKE '${esc(p)}'`);
    }
  }
  return `(${parts.join(' OR ')})`;
}

type Probe = {
  table: string;
  serialCols: string[];
  dateCols: string[];
  extraCols?: string;
};

const PROBES: Probe[] = [
  {
    table: 'trhcalls',
    serialCols: ['vserialno', 'nitemserialno'],
    dateCols: [
      'dtrndate',
      'dsolvedatetime',
      'dapprovedon',
      'addedon',
      'editedon',
      'dfastclosedatetime',
      'dallocationdatetime',
      'dapptdatetime',
    ],
    extraCols: 'ncode, vtrnno, nofficeid',
  },
  {
    table: 'trdcalls10ARCP',
    serialCols: ['vitemserialno', 'nitemserialno'],
    dateCols: [
      'dbmapproveddate',
      'dapproval1on',
      'dapproval2on',
      'dhoapproveddate',
      'dcalllogdatetime',
      'dcalltransferdatetime',
      'dcallfirstvisitdatetime',
      'dsolveddatetime',
      'addedon',
      'editedon',
    ],
    extraCols: 'ncode, vucnno, nofficeid, nofficetype',
  },
  {
    table: 'trdcalls1visit',
    serialCols: [],
    dateCols: ['dvisitdatetime', 'addedon', 'editedon'],
    extraCols: 'ncode, ncalls, nofficeid',
  },
  {
    table: 'trdcalls2fault',
    serialCols: [],
    dateCols: ['addedon', 'editedon'],
    extraCols: 'ncode, ncalls, nofficeid',
  },
  {
    table: 'trdcalls3parts',
    serialCols: [],
    dateCols: ['addedon', 'editedon'],
    extraCols: 'ncode, ncalls, nofficeid',
  },
  {
    table: 'trhaspclaim',
    serialCols: ['vserialno', 'vitemserialno'],
    dateCols: ['dBMapproveddate', 'dHOapproveddate', 'dCallLogDateTime', 'addedon'],
    extraCols: 'ncode, nofficeid',
  },
];

async function probeTable(p: Probe, mode: 'serial' | 'date' | 'both') {
  const hasSerial = p.serialCols.length > 0;
  const whereParts: string[] = [];
  if ((mode === 'serial' || mode === 'both') && hasSerial) {
    whereParts.push(serialWhere(p.serialCols));
  }
  if (mode === 'date' || mode === 'both') {
    whereParts.push(dateWhere(p.dateCols));
  }
  if (whereParts.length === 0) return;

  const where =
    mode === 'both' && hasSerial
      ? `${serialWhere(p.serialCols)} AND ${dateWhere(p.dateCols)}`
      : whereParts.join(' AND ');

  const cols = [...new Set([...(p.extraCols?.split(',').map((c) => c.trim()) || []), ...p.serialCols, ...p.dateCols])].join(
    ', '
  );

  const sql = `SELECT TOP 15 ${cols} FROM ${p.table} (NOLOCK) WHERE ${where}`;
  try {
    const res = await postQuery({ rawSql: sql, timeoutMs: 120000 });
    const rows = (res.data || []) as Record<string, unknown>[];
    if (rows.length > 0) {
      console.log(`\n=== ${p.table} [${mode}] — ${rows.length} row(s) ===`);
      for (const r of rows) {
        const hit: Record<string, unknown> = {};
        for (const k of Object.keys(r)) {
          const v = String(r[k] ?? '').trim();
          if (!v) continue;
          const serialHit = SERIALS.some(
            (s) => v.toUpperCase().includes(s) || v === s
          );
          
          if (serialHit || dateHit || ['ncode', 'vtrnno', 'vucnno', 'ncalls'].includes(k)) {
            hit[k] = r[k];
          }
        }
        console.log(hit);
      }
    }
  } catch (e) {
    console.log(`\n=== ${p.table} [${mode}] — ERROR:`, e instanceof Error ? e.message : e);
  }
}

async function trhcallsViaFault() {
  const sql = `
SELECT TOP 15
  h.ncode, h.vtrnno, h.vserialno, h.nitemserialno, h.dtrndate, h.dsolvedatetime, h.dapprovedon,
  f.ncode AS fault_ncode, f.addedon AS fault_addedon
FROM trhcalls h (NOLOCK)
INNER JOIN trdcalls2fault f (NOLOCK) ON f.ncalls = h.ncode AND f.nofficeid = h.nofficeid
WHERE ${serialWhere(['h.vserialno', 'h.nitemserialno'])}
   OR ${dateWhere(['h.dtrndate', 'h.dsolvedatetime', 'h.addedon', 'f.addedon'])}`;
  const res = await postQuery({ rawSql: sql, timeoutMs: 120000 });
  const rows = (res.data || []) as Record<string, unknown>[];
  console.log(`\n=== trhcalls + trdcalls2fault — ${rows.length} row(s) ===`);
  for (const r of rows) console.log(r);
}

async function arcpDateOnly() {
  const sql = `
SELECT TOP 20 ncode, vitemserialno, nitemserialno, vucnno, nofficeid,
  dbmapproveddate, dapproval1on, dhoapproveddate, dcalllogdatetime
FROM trdcalls10ARCP (NOLOCK)
WHERE ${dateWhere(['dbmapproveddate', 'dapproval1on', 'dapproval2on', 'dhoapproveddate', 'dcalllogdatetime', 'addedon', 'editedon'])}`;
  const res = await postQuery({ rawSql: sql, timeoutMs: 120000 });
  const rows = (res.data || []) as Record<string, unknown>[];
  console.log(`\n=== trdcalls10ARCP [date only] — ${rows.length} row(s) ===`);
  for (const r of rows) console.log(r);
}

async function defcallsProbe() {
  const sql = `
SELECT TOP 10 ncode, callno, btrndate, dvistdatetime, addedon, editedon, vitems
FROM defcalls (NOLOCK)
WHERE ${dateWhere(['addedon', 'editedon', 'btrndate', 'dvistdatetime'])}
   OR vitems LIKE '%26B20231%' OR vitems LIKE '%42213251100902%'`;
  try {
    const res = await postQuery({ rawSql: sql, timeoutMs: 60000 });
    const rows = (res.data || []) as Record<string, unknown>[];
    console.log(`\n=== defcalls — ${rows.length} row(s) ===`);
    for (const r of rows) console.log(r);
  } catch (e) {
    console.log('\n=== defcalls — ERROR:', e instanceof Error ? e.message : e);
  }
}

async function main() {
  console.log('Serials:', SERIALS.join(', '));
  console.log('Datetime patterns:', DATE_PATTERNS.join(', '));

  for (const p of PROBES) {
    if (p.serialCols.length) await probeTable(p, 'serial');
    await probeTable(p, 'date');
    if (p.serialCols.length) await probeTable(p, 'both');
  }

  await arcpDateOnly();
  await trhcallsViaFault();
  await defcallsProbe();
}

main().catch(console.error);
