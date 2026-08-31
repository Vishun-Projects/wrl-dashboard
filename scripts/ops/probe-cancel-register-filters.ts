import '@/lib/read-model/bootstrap-env';
import { postQuery } from '@/lib/db/proxy';

const tests = [
  `SELECT TOP 5 vtrnno, Editon, dtrndate FROM rpt_cancelcallregister (NOLOCK)
   WHERE ISNULL(CAST(ncancelreason AS INT), 0) NOT IN (0, 2)
     AND TRY_CONVERT(DATETIME, Editon, 103) >= TRY_CONVERT(DATETIME, '2026-08-30 00:00:00', 120)
     AND TRY_CONVERT(DATETIME, Editon, 103) < TRY_CONVERT(DATETIME, '2026-08-30 01:00:00', 120)`,
  `SELECT TOP 5 vtrnno, Editon, dtrndate FROM rpt_cancelcallregister (NOLOCK)
   WHERE ISNULL(CAST(ncancelreason AS INT), 0) NOT IN (0, 2)
     AND TRY_CONVERT(DATETIME, dtrndate, 103) >= TRY_CONVERT(DATETIME, '2026-08-30', 120)
     AND TRY_CONVERT(DATETIME, dtrndate, 103) < TRY_CONVERT(DATETIME, '2026-08-31', 120)`,
];

async function main() {
  for (const sql of tests) {
    const t0 = Date.now();
    try {
      const r = await postQuery({ rawSql: sql, timeoutMs: 120_000 });
      console.log('OK', Date.now() - t0, 'ms', (r.data || []).length, 'rows');
    } catch (e) {
      console.log('FAIL', Date.now() - t0, 'ms', (e instanceof Error ? e.message : e).slice(0, 160));
    }
  }
}

main();
