/**
 * Resync hot from live CRM for TRNs in WRL Call Register Report CSV,
 * then align status fields to match the report snapshot.
 *
 *   npx tsx scripts/ops/resync-from-register-csv.ts path/to/report.csv
 */
import '@/modules/mis-email/services/bootstrap-env';
import { readFileSync } from 'fs';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { processCrmRowsForYtdLoad } from '@/lib/read-model/transform';
import { upsertHotRows } from '@/lib/read-model/upsert-hot';
import type { StatusBucket } from '@/lib/read-model/types';

const CSV_PATH = process.argv[2];
const TRN_CHUNK = 40;

type CsvCall = {
  callType: string;
  callStatus: string;
  techSolvedAt: string | null;
  callSolvedAt: string | null;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (const c of line) {
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseReportDateTime(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`);
  const d = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (d) return new Date(`${d[3]}-${d[2]}-${d[1]}T${d[4]}:${d[5]}:${d[6]}+05:30`);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function csvStatusToHot(statusRaw: string, techSolved: string | null, callSolved: string | null) {
  const status = statusRaw.trim();
  const lower = status.toLowerCase();

  if (lower.includes('cancel')) {
    return {
      status_bucket: 'cancelled' as StatusBucket,
      status_label: 'Cancelled',
      bsolved: false,
      bfastclose: false,
      ncancelreason: 1,
      solved_at: null as Date | null,
    };
  }

  if (lower.includes('tech')) {
    return {
      status_bucket: 'tech_solved' as StatusBucket,
      status_label: 'Tech. Solve Call',
      bsolved: false,
      bfastclose: true,
      ncancelreason: 0,
      solved_at: parseReportDateTime(techSolved ?? '') ?? parseReportDateTime(callSolved ?? ''),
    };
  }

  if (lower === 'solved' || lower.includes('closed')) {
    return {
      status_bucket: 'solved' as StatusBucket,
      status_label: 'Closed',
      bsolved: true,
      bfastclose: false,
      ncancelreason: 0,
      solved_at: parseReportDateTime(callSolved ?? '') ?? parseReportDateTime(techSolved ?? ''),
    };
  }

  if (lower.includes('assign')) {
    return {
      status_bucket: 'assigned' as StatusBucket,
      status_label: 'Assigned',
      bsolved: false,
      bfastclose: false,
      ncancelreason: 0,
      solved_at: null as Date | null,
    };
  }

  return {
    status_bucket: 'open_unallocated' as StatusBucket,
    status_label: 'Open Unallocated',
    bsolved: false,
    bfastclose: false,
    ncancelreason: 0,
    solved_at: null as Date | null,
  };
}

function parseRegisterCsv(path: string): { trns: string[]; byTrn: Map<string, CsvCall> } {
  const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const hdrIdx = lines.findIndex((l) => l.includes('Service Order') && l.includes('Call Status'));
  if (hdrIdx < 0) throw new Error('CSV header row not found');

  const headers = parseCsvLine(lines[hdrIdx]);
  const idx = (name: string) => headers.findIndex((h) => h.trim() === name);
  const so = idx('Service Order');
  const ct = idx('Call Type');
  const cs = idx('Call Status');
  const ts = idx('Tech Solved Date & Time');
  const cd = idx('Call Solved Date & Time');
  if (so < 0) throw new Error('Service Order column missing');

  const byTrn = new Map<string, CsvCall>();
  for (let i = hdrIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    const trn = String(cols[so] ?? '').trim();
    if (!trn || byTrn.has(trn)) continue;
    byTrn.set(trn, {
      callType: String(cols[ct] ?? '').trim(),
      callStatus: String(cols[cs] ?? '').trim(),
      techSolvedAt: String(cols[ts] ?? '').trim() || null,
      callSolvedAt: String(cols[cd] ?? '').trim() || null,
    });
  }
  return { trns: [...byTrn.keys()], byTrn };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function applyCsvStatusOverlay(trns: string[], byTrn: Map<string, CsvCall>): Promise<number> {
  let updated = 0;
  for (let i = 0; i < trns.length; i += 100) {
    const chunk = trns.slice(i, i + 100);
    await withAppClient(async (c) => {
      for (const trn of chunk) {
        const csv = byTrn.get(trn);
        if (!csv) continue;
        const st = csvStatusToHot(csv.callStatus, csv.techSolvedAt, csv.callSolvedAt);
        const r = await c.query(
          `UPDATE calls_latest_hot SET
             status_bucket = $2::status_bucket_type,
             status_label = $3,
             bsolved = $4,
             bfastclose = $5,
             ncancelreason = $6,
             solved_at = $7,
             synced_at = now()
           WHERE vtrnno = $1`,
          [trn, st.status_bucket, st.status_label, st.bsolved, st.bfastclose, st.ncancelreason, st.solved_at]
        );
        updated += r.rowCount ?? 0;
      }
    });
  }
  return updated;
}

async function main() {
  if (!CSV_PATH) throw new Error('Usage: npx tsx scripts/ops/resync-from-register-csv.ts <csv-path>');
  const { trns, byTrn } = parseRegisterCsv(CSV_PATH);
  const breakdown = trns.filter((t) => /breakdown/i.test(byTrn.get(t)?.callType ?? ''));
  const target = trns; // full report — all call types in CSV window

  console.log(`=== Resync from CRM register CSV ===`);
  console.log(`File: ${CSV_PATH}`);
  console.log(`Unique TRNs: ${trns.length} (BREAKDOWN: ${breakdown.length})`);

  let upserted = 0;
  const total = Math.ceil(target.length / TRN_CHUNK);
  for (let i = 0; i < target.length; i += TRN_CHUNK) {
    const chunk = target.slice(i, i + TRN_CHUNK);
    const n = Math.floor(i / TRN_CHUNK) + 1;
    const crmRows = await fetchCrmRowsByTrns(chunk, { includeTransferred: true });
    const hotOut = processCrmRowsForYtdLoad(crmRows);
    if (hotOut.length) {
      await withAppClient((c) => upsertHotRows(c, hotOut));
      upserted += hotOut.length;
    }
    if (n === 1 || n % 10 === 0 || n === total) {
      console.log(`  CRM chunk ${n}/${total}: fetched ${crmRows.length}, upserted ${hotOut.length}`);
    }
    if (i + TRN_CHUNK < target.length) await sleep(1200);
  }

  console.log(`\n→ Applying report status overlay for ${target.length} TRN(s)...`);
  const patched = await applyCsvStatusOverlay(target, byTrn);
  console.log(`  status rows patched: ${patched}`);

  const after = await withAppClient(async (c) => {
    const r = await c.query(
      `SELECT vtrnno, status_bucket::text, status_label FROM calls_latest_hot WHERE vtrnno = ANY($1::text[])`,
      [target]
    );
    return r.rows as { vtrnno: string; status_bucket: string; status_label: string }[];
  });
  const afterMap = new Map(after.map((r) => [r.vtrnno, r]));
  let missing = 0;
  let mismatch = 0;
  for (const trn of target) {
    const csv = byTrn.get(trn)!;
    const hot = afterMap.get(trn);
    const exp = csvStatusToHot(csv.callStatus, csv.techSolvedAt, csv.callSolvedAt);
    if (!hot) {
      missing++;
      continue;
    }
    if (hot.status_bucket !== exp.status_bucket) mismatch++;
  }

  console.log(`\nDone — CRM upserted ${upserted}, CSV status patched ${patched}`);
  console.log(`Verify: in hot ${after.length}/${target.length}, missing ${missing}, status mismatch ${mismatch}`);

  if (mismatch > 0 && mismatch <= 20) {
    for (const trn of target) {
      const csv = byTrn.get(trn)!;
      const hot = afterMap.get(trn);
      const exp = csvStatusToHot(csv.callStatus, csv.techSolvedAt, csv.callSolvedAt);
      if (hot && hot.status_bucket !== exp.status_bucket) {
        console.log(`  ${trn}: csv=${csv.callStatus}→${exp.status_bucket} hot=${hot.status_bucket}`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
