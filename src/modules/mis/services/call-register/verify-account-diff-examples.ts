import '@/lib/read-model/bootstrap-env';
import { prisma } from '@/lib/db/prisma';

const client = process.argv[2] || 'UB';

async function main() {
  const nonBilled = await prisma.$queryRawUnsafeBulk<
    { serial: string; solved_install_calls: number }[]
  >(
    `SELECT h.serial, COUNT(*)::int AS solved_install_calls
     FROM calls_latest_hot h
     WHERE h.account = $1
       AND h.serial IS NOT NULL AND h.serial <> ''
       AND UPPER(h.call_type) IN ('INSTALLATION', 'INSTALLATION CALL')
       AND h.status_bucket::text = 'solved'
       AND NOT EXISTS (
         SELECT 1
         FROM crm_transaction_entry b
         WHERE b.client = $1
           AND b.product_serial_no = h.serial
       )
     GROUP BY h.serial
     ORDER BY solved_install_calls DESC, h.serial
     LIMIT 10`,
    client
  );

  const repeated = await prisma.$queryRawUnsafeBulk<
    { serial: string; solved_install_calls: number }[]
  >(
    `SELECT h.serial, COUNT(*)::int AS solved_install_calls
     FROM calls_latest_hot h
     WHERE h.account = $1
       AND h.serial IS NOT NULL AND h.serial <> ''
       AND UPPER(h.call_type) IN ('INSTALLATION', 'INSTALLATION CALL')
       AND h.status_bucket::text = 'solved'
     GROUP BY h.serial
     HAVING COUNT(*) > 1
     ORDER BY solved_install_calls DESC, h.serial
     LIMIT 10`,
    client
  );

  const crossAccount = await prisma.$queryRawUnsafeBulk<
    { serial: string; solved_accounts: string; solved_install_calls: number }[]
  >(
    `SELECT b.product_serial_no AS serial,
            STRING_AGG(DISTINCT h.account, ', ' ORDER BY h.account) AS solved_accounts,
            COUNT(*)::int AS solved_install_calls
     FROM crm_transaction_entry b
     JOIN calls_latest_hot h
       ON h.serial = b.product_serial_no
     WHERE b.client = $1
       AND UPPER(h.call_type) IN ('INSTALLATION', 'INSTALLATION CALL')
       AND h.status_bucket::text = 'solved'
     GROUP BY b.product_serial_no
     HAVING COUNT(DISTINCT h.account) > 1
     ORDER BY solved_install_calls DESC, serial
     LIMIT 10`,
    client
  );

  console.log('client:', client);
  console.log('--- non billed serials counted in account-level installs ---');
  console.table(nonBilled);
  console.log('--- same serial with repeated solved install calls ---');
  console.table(repeated);
  console.log('--- billed serial solved under multiple accounts ---');
  console.table(crossAccount);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
