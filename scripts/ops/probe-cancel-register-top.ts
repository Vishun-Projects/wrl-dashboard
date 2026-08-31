import '@/lib/read-model/bootstrap-env';
import { postQuery } from '@/lib/db/proxy';

async function main() {
  const sql = `SELECT TOP 20 vtrnno, ncode, Editon, dtrndate, ncancelreason
    FROM rpt_cancelcallregister (NOLOCK)
    WHERE ISNULL(CAST(ncancelreason AS INT), 0) NOT IN (0, 2)
    ORDER BY ncode DESC`;
  const r = await postQuery({ rawSql: sql, timeoutMs: 180_000 });
  console.log('rows', (r.data || []).length);
  for (const row of (r.data || []).slice(0, 5)) {
    console.log(row);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.slice(0, 300) : e);
  process.exit(1);
});
