/**
 * Gap-fill calls_latest_hot from CRM corpus — upsert only, no truncate.
 *
 * Phase 1: CRM TRNs missing from hot (all call types, or --installations-only).
 * Phase 2: days where hot count is short vs CRM corpus (full day shard refetch).
 *
 *   npx tsx src/lib/read-model/cli.ts fill-hot-gaps
 *   npx tsx src/lib/read-model/cli.ts fill-hot-gaps --from 2025-11-01 --to 2025-12-31
 *   npx tsx src/lib/read-model/cli.ts fill-hot-gaps --serial 32614250700193
 *   npx tsx src/lib/read-model/cli.ts fill-hot-gaps --installations-only --from 2024-01-01 --to 2025-12-31
 *   npx tsx src/lib/read-model/cli.ts fill-hot-gaps --skip-short-days --from 2025-09-01 --to 2025-12-31
 */
import { forEachCrmBackfillChunk, fetchCrmRowsByTrns } from '@/lib/read-model/crm-fetch';
import { sleep } from '@/lib/utils/async';
import { dayBeforeDate, registerHotRetentionStart } from '@/lib/read-model/hot-window';
import { processCrmRowsForYtdLoad } from '@/lib/read-model/transform';
import { countHotRows, upsertHotRows } from '@/lib/read-model/upsert-hot';
import { formatLocalDate } from '@/lib/dates/local-date';
import { postQuery } from '@/lib/db/proxy';
import { withClient } from '@/lib/read-model/db';

const DEFAULT_START = '2024-01-01';
const GAP_RATIO = Number(process.env.SYNC_HOT_GAP_RATIO ?? 0.98) || 0.98;
const MIN_GAP = Math.max(1, Number(process.env.SYNC_HOT_GAP_MIN ?? 20) || 20);
const TRN_CHUNK = Math.max(10, Number(process.env.SYNC_PIPELINE_TRN_CHUNK ?? 40) || 40);
/** CRM mstfixedselection ncode for INSTALLATION CALL (resolved once at runtime). */
const INSTALL_TYPE_FALLBACK = 706;

function parseArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (d <= last) {
    out.push(formatLocalDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

async function resolveInstallationCallTypeCode(): Promise<number> {
  const r = await postQuery({
    rawSql: `
      SELECT TOP 5 ncode, vdisplayvalue
      FROM mstfixedselection (NOLOCK)
      WHERE vfieldname = 'ncalltype'
        AND UPPER(LTRIM(RTRIM(vdisplayvalue))) LIKE '%INSTALL%'
      ORDER BY ncode
    `,
  });
  const rows = (r.data ?? []) as { ncode: string | number; vdisplayvalue: string }[];
  const hit = rows.find((row) =>
    String(row.vdisplayvalue ?? '')
      .trim()
      .toUpperCase()
      .includes('INSTALLATION')
  );
  const code = Number(hit?.ncode ?? rows[0]?.ncode ?? INSTALL_TYPE_FALLBACK);
  console.log(
    `[fill-hot-gaps] installation call type ncode=${code}`,
    hit?.vdisplayvalue ?? rows[0]?.vdisplayvalue ?? '(fallback)'
  );
  return code;
}

async function crmCorpusCount(day: string): Promise<number> {
  const r = await postQuery({
    rawSql: `
      SELECT COUNT(*) AS cnt
      FROM trhcalls (NOLOCK)
      WHERE dtrndate >= '${day}' AND dtrndate <= '${day} 23:59:59'
        AND vtrnno IS NOT NULL AND vtrnno <> ''
        AND ISNULL(vtransfercallno, '') = ''
        AND ISNULL(CAST(ncancelreason AS INT), 0) <> 2
    `,
  });
  const rows = (r.data ?? []) as { cnt: string }[];
  return Number(rows[0]?.cnt ?? 0);
}

async function crmCorpusTrnsInRange(
  from: string,
  to: string,
  callTypeCode?: number
): Promise<string[]> {
  // One CRM round-trip per month — day-by-day was too slow across multi-year spans.
  const months: { start: string; end: string }[] = [];
  const cursor = new Date(`${from}T00:00:00`);
  const last = new Date(`${to}T00:00:00`);
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const start = formatLocalDate(new Date(y, m, 1));
    const end = formatLocalDate(new Date(y, m + 1, 0));
    months.push({
      start: start < from ? from : start,
      end: end > to ? to : end,
    });
    cursor.setMonth(m + 1, 1);
  }

  const typeSql =
    callTypeCode != null ? `AND tc.ncalltype = ${callTypeCode}` : '';
  const label = callTypeCode != null ? `type=${callTypeCode}` : 'all-types';
  const all: string[] = [];
  const gapMs = Number(process.env.SYNC_CRM_FETCH_GAP_MS ?? 1500) || 1500;
  for (const { start, end } of months) {
    const r = await postQuery({
      rawSql: `
        SELECT tc.vtrnno
        FROM trhcalls tc (NOLOCK)
        WHERE tc.dtrndate >= '${start}' AND tc.dtrndate <= '${end} 23:59:59'
          AND tc.vtrnno IS NOT NULL AND tc.vtrnno <> ''
          AND ISNULL(tc.vtransfercallno, '') = ''
          AND ISNULL(CAST(tc.ncancelreason AS INT), 0) <> 2
          ${typeSql}
      `,
    });
    const rows = (r.data ?? []) as { vtrnno: string }[];
    const trns = rows.map((row) => String(row.vtrnno ?? '').trim()).filter(Boolean);
    console.log(`[fill-hot-gaps] CRM ${label} ${start}..${end} trns=${trns.length}`);
    all.push(...trns);
    await sleep(gapMs);
  }
  return [...new Set(all)];
}

async function hotDayCount(day: string): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ cnt: string }>(
      `
      SELECT COUNT(*)::text AS cnt
      FROM calls_latest_hot
      WHERE (logged_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date
      `,
      [day]
    );
    return Number(res.rows[0]?.cnt ?? 0);
  });
}

async function missingTrnsNotInHot(trns: string[]): Promise<string[]> {
  if (!trns.length) return [];
  return withClient(async (client) => {
    const missing: string[] = [];
    for (let i = 0; i < trns.length; i += 500) {
      const batch = trns.slice(i, i + 500);
      const res = await client.query<{ vtrnno: string }>(
        `SELECT vtrnno FROM calls_latest_hot WHERE vtrnno = ANY($1::text[])`,
        [batch]
      );
      const have = new Set(res.rows.map((r) => r.vtrnno));
      for (const t of batch) {
        if (!have.has(t)) missing.push(t);
      }
    }
    return missing;
  });
}

async function upsertTrnsFull(trns: string[]): Promise<number> {
  let upserted = 0;
  const totalChunks = Math.ceil(trns.length / TRN_CHUNK) || 1;
  for (let i = 0; i < trns.length; i += TRN_CHUNK) {
    const chunk = trns.slice(i, i + TRN_CHUNK);
    const chunkNo = Math.floor(i / TRN_CHUNK) + 1;
    const crmRows = await fetchCrmRowsByTrns(chunk);
    const hotRows = processCrmRowsForYtdLoad(crmRows);
    if (hotRows.length) {
      await withClient((client) => upsertHotRows(client, hotRows));
      upserted += hotRows.length;
    }
    if (chunkNo === 1 || chunkNo % 10 === 0 || chunkNo === totalChunks) {
      console.log(
        `[fill-hot-gaps] TRN upsert chunk ${chunkNo}/${totalChunks} upserted=${upserted}/${trns.length}`
      );
    }
    if (i + TRN_CHUNK < trns.length) {
      await sleep(Number(process.env.SYNC_CRM_FETCH_GAP_MS ?? 1500) || 1500);
    }
  }
  return upserted;
}

async function upsertSerialOrTrn(opts: { serial?: string; trn?: string }): Promise<number> {
  let trn = opts.trn?.trim();

  if (!trn && opts.serial) {
    const s = opts.serial.replace(/'/g, "''");
    const probe = await postQuery({
      rawSql: `
        SELECT TOP 5 vtrnno
        FROM trhcalls (NOLOCK)
        WHERE LTRIM(RTRIM(CAST(vserialno AS VARCHAR(50)))) = '${s}'
          AND vtrnno IS NOT NULL AND vtrnno <> ''
          AND ISNULL(vtransfercallno, '') = ''
          AND ISNULL(CAST(ncancelreason AS INT), 0) <> 2
        ORDER BY ISNULL(editedon, addedon) DESC
      `,
    });
    const rows = (probe.data ?? []) as { vtrnno: string }[];
    trn = rows[0]?.vtrnno?.trim();
  }

  if (!trn) {
    console.log('[fill-hot-gaps] no CRM TRN found for', opts);
    return 0;
  }

  // Full sync corpus joins (engineer, account, call type, WCO, …) — not a thin SELECT.
  const upserted = await upsertTrnsFull([trn]);
  if (!upserted) {
    console.log('[fill-hot-gaps] CRM returned rows but none transformed', { trn });
    return 0;
  }
  console.log(`[fill-hot-gaps] upserted ${upserted} full row(s) for trn=${trn}`);
  return upserted;
}

async function refillDay(day: string): Promise<{ fetched: number; upserted: number }> {
  let fetched = 0;
  let upserted = 0;
  // Force 1-day window; crm-fetch shards single days.
  process.env.SYNC_BACKFILL_CHUNK_DAYS = '1';
  process.env.SYNC_CRM_SHARD_FIRST = 'true';
  await forEachCrmBackfillChunk(day, day, async ({ rows }) => {
    fetched += rows.length;
    const hotRows = processCrmRowsForYtdLoad(rows);
    if (hotRows.length === 0) return;
    await withClient((client) => upsertHotRows(client, hotRows));
    upserted += hotRows.length;
  });
  return { fetched, upserted };
}

/** Find CRM corpus TRNs missing from hot; upsert with full joins. */
async function fillMissingCorpusTrns(
  from: string,
  to: string,
  opts?: { installationsOnly?: boolean }
): Promise<number> {
  const installationsOnly = Boolean(opts?.installationsOnly);
  const callTypeCode = installationsOnly ? await resolveInstallationCallTypeCode() : undefined;
  console.log(
    `[fill-hot-gaps] phase 1: missing ${installationsOnly ? 'INSTALLATION CALL' : 'ALL'} TRNs ${from} .. ${to}`
  );

  const crmTrns = await crmCorpusTrnsInRange(from, to, callTypeCode);
  console.log(`[fill-hot-gaps] CRM unique TRNs=${crmTrns.length}`);
  const missing = await missingTrnsNotInHot(crmTrns);
  console.log(`[fill-hot-gaps] missing in hot=${missing.length}`);
  if (!missing.length) {
    console.log('[fill-hot-gaps] phase 1 done — nothing missing');
    return 0;
  }

  // ponytail: sequential TRN chunks — ceiling ~CRM rate; upgrade: parallel shards if CRM allows.
  const upserted = await upsertTrnsFull(missing);
  console.log(`[fill-hot-gaps] phase 1 done — missingTrns=${missing.length}, upserted=${upserted}`);
  return upserted;
}

async function fillShortDays(from: string, to: string): Promise<number> {
  console.log(`[fill-hot-gaps] phase 2: short days ${from} .. ${to} (CRM count vs hot)`);
  const days = eachDay(from, to);
  let daysChecked = 0;
  let daysRefilled = 0;
  let totalUpserted = 0;
  const gapMs = Number(process.env.SYNC_BACKFILL_FETCH_GAP_MS ?? 3000) || 3000;

  for (const day of days) {
    daysChecked++;
    const [crmCnt, hotCnt] = await Promise.all([crmCorpusCount(day), hotDayCount(day)]);
    const need =
      crmCnt > 0 && (hotCnt < Math.floor(crmCnt * GAP_RATIO) || crmCnt - hotCnt >= MIN_GAP);

    if (!need) {
      if (daysChecked % 30 === 0 || crmCnt > 0) {
        console.log(`[fill-hot-gaps] ${day} ok crm=${crmCnt} hot=${hotCnt}`);
      }
      continue;
    }

    console.log(`[fill-hot-gaps] ${day} SHORT crm=${crmCnt} hot=${hotCnt} — refetching…`);
    const { fetched, upserted } = await refillDay(day);
    const after = await hotDayCount(day);
    daysRefilled++;
    totalUpserted += upserted;
    console.log(
      `[fill-hot-gaps] ${day} done fetched=${fetched} upserted=${upserted} hotNow=${after} (crm=${crmCnt})`
    );
    await sleep(gapMs);
  }

  console.log(
    `[fill-hot-gaps] phase 2 done — checked ${daysChecked} days, refilled ${daysRefilled}, upserted ${totalUpserted}`
  );
  return totalUpserted;
}

export async function runFillHotGaps(opts?: {
  from?: string;
  to?: string;
  serial?: string;
  trn?: string;
}): Promise<void> {
  const serial = opts?.serial ?? parseArg('--serial');
  const trn = opts?.trn ?? parseArg('--trn');
  if (serial || trn) {
    await upsertSerialOrTrn({ serial, trn });
    return;
  }

  const ytd = registerHotRetentionStart();
  const from = opts?.from ?? parseArg('--from') ?? DEFAULT_START;
  const to = opts?.to ?? parseArg('--to') ?? dayBeforeDate(ytd);
  const installationsOnly = hasFlag('--installations-only');
  const skipMissingTrns = hasFlag('--skip-installations') || hasFlag('--skip-missing-trns');
  const skipShortDays = hasFlag('--skip-short-days');

  if (!skipMissingTrns) {
    await fillMissingCorpusTrns(from, to, { installationsOnly });
  }
  if (!installationsOnly && !skipShortDays) {
    await fillShortDays(from, to);
  }

  const hotTotal = await withClient((client) => countHotRows(client));
  console.log(`[fill-hot-gaps] complete — hot total ${hotTotal}`);
}
