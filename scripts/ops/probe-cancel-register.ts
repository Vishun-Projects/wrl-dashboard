import '@/lib/read-model/bootstrap-env';
import { postQuery } from '@/lib/db/proxy';

async function probe(table: string) {
  const r = await postQuery({
    rawSql: `SELECT TOP 1 * FROM ${table}`,
    timeoutMs: 120_000,
  });
  const row = (r.data || [])[0] as Record<string, unknown> | undefined;
  console.log(`\n${table}:`, row ? Object.keys(row).sort().join(', ') : 'no rows');
  if (row) console.log(JSON.stringify(row, null, 2));
}

async function main() {
  for (const t of ['rpt_cancelcallregister', 'rpt_cancelledcallregister']) {
    try {
      await probe(t);
    } catch (e) {
      console.error(`${t} ERR:`, e instanceof Error ? e.message.slice(0, 300) : e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
