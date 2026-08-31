/**
 * Find YTD BREAKDOWN TRNs in CRM missing from hot, then upsert ASAP.
 *   npx tsx scripts/ops/resync-missing-ytd-breakdown.ts
 *   npx tsx scripts/ops/resync-missing-ytd-breakdown.ts 2026-08-27
 *   npx tsx scripts/ops/resync-missing-ytd-breakdown.ts 2026-08-27 --trns-file /tmp/missing.txt
 */
import '@/modules/mis-email/services/bootstrap-env';
import { postQuery } from '@/lib/db/proxy';
import { fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { processCrmRowsForYtdLoad } from '@/lib/read-model/transform';
import { upsertHotRows } from '@/lib/read-model/upsert-hot';
import { readFileSync } from 'fs';

const START = '2026-01-01';
const AS_OF = process.argv[2]?.trim() || '2026-08-27';
const TRNS_FILE = (() => {
  const i = process.argv.indexOf('--trns-file');
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const TRN_CHUNK = 40;
const IST_START = `${START}T00:00:00+05:30`;
const IST_END = `${AS_OF}T23:59:59.999+05:30`;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function hotTrnSet(): Promise<Set<string>> {
  return withAppClient(async (c) => {
    const r = await c.query<{ vtrnno: string }>(
      `SELECT vtrnno FROM calls_latest_hot
       WHERE upper(trim(call_type)) = 'BREAKDOWN'
         AND logged_at >= $1::timestamptz AND logged_at <= $2::timestamptz`,
      [IST_START, IST_END]
    );
    return new Set(r.rows.map((row) => String(row.vtrnno).trim()).filter(Boolean));
  });
}

async function crmBreakdownTrns(): Promise<string[]> {
  const months: { start: string; end: string }[] = [];
  const cursor = new Date(`${START}T00:00:00`);
  const last = new Date(`${AS_OF}T00:00:00`);
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const ms = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const me = new Date(y, m + 1, 0);
    const mend = `${me.getFullYear()}-${String(me.getMonth() + 1).padStart(2, '0')}-${String(me.getDate()).padStart(2, '0')}`;
    months.push({
      start: ms < START ? START : ms,
      end: mend > AS_OF ? AS_OF : mend,
    });
    cursor.setMonth(m + 1, 1);
  }

  const all: string[] = [];
  for (const { start, end } of months) {
    const r = await postQuery({
      rawSql: `
        SELECT DISTINCT LTRIM(RTRIM(tc.vtrnno)) AS vtrnno
        FROM trhcalls tc (NOLOCK)
        INNER JOIN mstfixedselection calltype_fs (NOLOCK)
          ON tc.ncalltype = calltype_fs.ncode AND calltype_fs.vfieldname = 'ncalltype'
        WHERE tc.dtrndate >= '${start}' AND tc.dtrndate <= '${end} 23:59:59'
          AND tc.vtrnno IS NOT NULL AND LTRIM(RTRIM(tc.vtrnno)) <> ''
          AND ISNULL(tc.vtransfercallno, '') = ''
          AND ISNULL(CAST(tc.ncancelreason AS INT), 0) <> 2
          AND UPPER(LTRIM(RTRIM(calltype_fs.vdisplayvalue))) = 'BREAKDOWN'
      `,
      timeoutMs: 180_000,
    });
    const trns = ((r.data ?? []) as { vtrnno: string }[])
      .map((row) => String(row.vtrnno ?? '').trim())
      .filter(Boolean);
    console.log(`  CRM ${start}..${end}: ${trns.length.toLocaleString('en-IN')} TRNs`);
    all.push(...trns);
    await sleep(1500);
  }
  return [...new Set(all)];
}

async function upsertTrns(trns: string[]): Promise<number> {
  let upserted = 0;
  const total = Math.ceil(trns.length / TRN_CHUNK) || 1;
  for (let i = 0; i < trns.length; i += TRN_CHUNK) {
    const chunk = trns.slice(i, i + TRN_CHUNK);
    const n = Math.floor(i / TRN_CHUNK) + 1;
    const crmRows = await fetchCrmRowsByTrns(chunk, { includeTransferred: true });
    const hotRows = processCrmRowsForYtdLoad(crmRows);
    if (hotRows.length) {
      await withAppClient((c) => upsertHotRows(c, hotRows));
      upserted += hotRows.length;
    }
    console.log(`  chunk ${n}/${total}: fetched ${crmRows.length}, upserted ${hotRows.length} (total ${upserted})`);
    if (i + TRN_CHUNK < trns.length) await sleep(1500);
  }
  return upserted;
}

async function main() {
  let missing: string[];

  if (TRNS_FILE) {
    const raw = readFileSync(TRNS_FILE, 'utf8');
    missing = [...new Set(raw.split(/\s+/).map((s) => s.trim()).filter(Boolean))];
    console.log(`Loaded ${missing.length} TRN(s) from ${TRNS_FILE}`);
  } else {
    console.log(`Finding missing BREAKDOWN TRNs (${START} → ${AS_OF} logged)…`);
    const [hot, crm] = await Promise.all([hotTrnSet(), crmBreakdownTrns()]);
    missing = crm.filter((t) => !hot.has(t));
    console.log(`CRM=${crm.length.toLocaleString('en-IN')} hot=${hot.size.toLocaleString('en-IN')} missing=${missing.length.toLocaleString('en-IN')}`);
  }

  if (!missing.length) {
    console.log('Nothing to resync.');
    return;
  }

  console.log(`\nResyncing ${missing.length} TRN(s)…`);
  if (missing.length <= 20) console.log(missing.join('\n'));
  else console.log(missing.slice(0, 10).join('\n'), `\n… and ${missing.length - 10} more`);

  const upserted = await upsertTrns(missing);
  console.log(`\nDone — upserted ${upserted}/${missing.length} row(s) into calls_latest_hot.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closePool());
