import '@/lib/read-model/bootstrap-env';
import { prisma } from '@/lib/db/prisma';

const client = process.argv[2];

async function listMirrorClients(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafeBulk<{ client: string }[]>(
    `SELECT DISTINCT btrim(client) AS client
     FROM crm_transaction_entry
     WHERE NULLIF(btrim(client), '') IS NOT NULL
     ORDER BY 1`
  );
  return rows.map((r) => r.client).filter(Boolean);
}

async function countsFor(name: string) {
  const billed = await prisma.$queryRawUnsafeBulk<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt FROM crm_transaction_entry WHERE client = $1`,
    name
  );
  const joined = await prisma.$queryRawUnsafeBulk<{ install: number; deploy: number }[]>(
    `SELECT
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM calls_latest_hot h
        WHERE h.serial = b.product_serial_no AND h.account = b.client
          AND UPPER(h.call_type) IN ('INSTALLATION', 'INSTALLATION CALL')
          AND (
            h.status_bucket::text IN ('solved', 'completed')
            OR LOWER(COALESCE(h.status_label, '')) IN ('solved', 'completed')
          )
      ))::int AS install,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM calls_latest_hot h
        WHERE h.serial = b.product_serial_no AND h.account = b.client
          AND UPPER(h.call_type) IN ('DEPLOYMENT', 'DEPLOYMENT CALL')
          AND (
            h.status_bucket::text IN ('solved', 'completed')
            OR LOWER(COALESCE(h.status_label, '')) IN ('solved', 'completed')
          )
      ))::int AS deploy
     FROM crm_transaction_entry b WHERE b.client = $1`,
    name
  );
  return { qty: billed[0]?.cnt ?? 0, ...joined[0] };
}

async function main() {
  if (client) {
    const c = await countsFor(client);
    console.log(client, c);
    if (client === 'UB') {
      console.assert(c.install === 11320, 'UB install should be 11320');
    }
    return;
  }
  for (const name of await listMirrorClients()) {
    console.log(name, await countsFor(name));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
