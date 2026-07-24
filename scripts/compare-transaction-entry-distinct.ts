#!/usr/bin/env npx tsx
/**
 * Compare CRM vs mirror using DISTINCT (client, serial) — matches our PK.
 * Usage: npx tsx scripts/compare-transaction-entry-distinct.ts [from] [to]
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env.sync-worker') });
config({ path: join(process.cwd(), '.env') });
process.env.USE_DIRECT_DATABASE = 'true';

import { postQuery } from '@/lib/db/proxy';
import { closePool, withClient } from '@/lib/read-model/db';
import { todayLocalDate } from '@/lib/read-model/dates';

async function main() {
  const dateFrom = process.argv[2] ?? '2024-09-01';
  const dateTo = process.argv[3] ?? todayLocalDate();

  const crmSql = `
    SELECT COUNT(*) AS row_cnt,
           COUNT(DISTINCT CONCAT(LTRIM(RTRIM(Client)), NCHAR(1), LTRIM(RTRIM(ProductSerialNo)))) AS distinct_cnt
    FROM TransactionEntry
    WHERE ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
      AND Client IS NOT NULL AND LTRIM(RTRIM(Client)) <> ''
      AND TRY_CONVERT(DATETIME, daddedon, 103) >= TRY_CONVERT(DATETIME, '${dateFrom}', 120)
      AND TRY_CONVERT(DATETIME, daddedon, 103) <= TRY_CONVERT(DATETIME, '${dateTo} 23:59:59', 120)
  `;

  console.log(`[compare-distinct] window ${dateFrom} .. ${dateTo} (imported/daddedon)`);
  const crm = await postQuery({ rawSql: crmSql, timeoutMs: 600_000 });
  const row = (crm.data?.[0] ?? {}) as Record<string, unknown>;
  const crmRows = Number(row.row_cnt ?? 0) || 0;
  const crmDistinct = Number(row.distinct_cnt ?? 0) || 0;

  const mirror = await withClient((c) =>
    c.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt
       FROM crm_transaction_entry
       WHERE daddedon >= $1::date
         AND daddedon < ($2::date + interval '1 day')`,
      [dateFrom, dateTo]
    )
  );
  const mirrorCount = Number(mirror.rows[0]?.cnt ?? 0) || 0;

  console.log(
    JSON.stringify(
      {
        dateFrom,
        dateTo,
        crmRawRows: crmRows,
        crmDistinctClientSerial: crmDistinct,
        mirrorRows: mirrorCount,
        deltaDistinctMinusMirror: crmDistinct - mirrorCount,
        crmDuplicateExtraRows: crmRows - crmDistinct,
      },
      null,
      2
    )
  );

  if (crmDistinct === mirrorCount) {
    console.log('IN SYNC on distinct (client, serial) — same grain as our table PK.');
  } else {
    console.log(
      `NOT fully in sync: missing/extra vs distinct CRM keys = ${crmDistinct - mirrorCount}`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
