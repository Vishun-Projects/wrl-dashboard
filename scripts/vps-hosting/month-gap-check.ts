/**
 * Per-month BREAKDOWN hot vs CRM counts through AS_OF.
 *   npx tsx scripts/vps-hosting/month-gap-check.ts --as-of 2026-09-29
 */
import { postQuery } from '@/lib/db/proxy';
import { withAppClient, closePool } from '@/lib/read-model/db';
import { buildTrhcallsBaseCondition } from '@/sql/trhcalls/query';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

function crmDedupTable(from: string, to: string): string {
  const esc = (d: string) => d.replace(/'/g, "''");
  return `(
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY CASE WHEN ISNULL(vtrnno, '') = '' THEN CAST(ncode AS VARCHAR(50)) ELSE vtrnno END
        ORDER BY ISNULL(editedon, addedon) DESC, ncode DESC
      ) rn FROM trhcalls (NOLOCK)
      WHERE dtrndate >= '${esc(from)}' AND dtrndate <= '${esc(to)} 23:59:59'
    ) s WHERE s.rn = 1
  ) tc`;
}

async function crmCount(from: string, to: string): Promise<number> {
  const cond = buildTrhcallsBaseCondition({
    startDate: from,
    endDate: to,
    dateColumn: 'dtrndate',
    callType: 'BREAKDOWN',
    datesInSubquery: true,
  });
  const res = await postQuery({
    fields: 'COUNT(*) as total',
    tableName: crmDedupTable(from, to),
    condition: cond,
    timeoutMs: 180_000,
  });
  return Number(res.data?.[0]?.total ?? 0);
}

async function hotCount(from: string, to: string): Promise<number> {
  return withAppClient(async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::bigint AS n FROM calls_latest_hot
       WHERE upper(trim(call_type)) = 'BREAKDOWN'
         AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date >= $1::date
         AND (logged_at AT TIME ZONE 'Asia/Kolkata')::date <= $2::date`,
      [from, to]
    );
    return Number(r.rows[0]?.n ?? 0);
  });
}

async function main(): Promise<void> {
  const asOf = arg('--as-of', '2026-09-29');
  const year = asOf.slice(0, 4);
  const asOfMonth = Number(asOf.slice(5, 7));
  const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  for (let m = 1; m <= asOfMonth; m++) {
    const mm = String(m).padStart(2, '0');
    const last = new Date(Number(year), m, 0).getDate();
    const from = `${year}-${mm}-01`;
    const to = m === asOfMonth ? asOf : `${year}-${mm}-${String(last).padStart(2, '0')}`;
    const h = await hotCount(from, to);
    const c = await crmCount(from, to);
    const d = h - c;
    const mark = d === 0 ? 'OK' : `GAP ${d > 0 ? '+' : ''}${d}`;
    console.log(`${labels[m - 1]} ${from}..${to} hot=${h} crm=${c} ${mark}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
