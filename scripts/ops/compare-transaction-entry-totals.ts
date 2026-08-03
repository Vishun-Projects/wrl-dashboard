#!/usr/bin/env npx tsx
/**
 * Totals-only CRM vs mirror check for TransactionEntry (daddedon window).
 * Usage: npx tsx scripts/ops/compare-transaction-entry-totals.ts [from] [to]
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
import {
  mismatchedClients,
  verifyCallRegisterTransactionEntry,
} from '@/lib/read-model/transaction-entry/verify';

async function main() {
  const dateFrom = process.argv[2] ?? '2024-09-01';
  const dateTo = process.argv[3] ?? todayLocalDate();

  const crmSql = `
    SELECT COUNT(*) AS cnt
    FROM TransactionEntry
    WHERE ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
      AND Client IS NOT NULL AND LTRIM(RTRIM(Client)) <> ''
      AND TRY_CONVERT(DATETIME, daddedon, 103) >= TRY_CONVERT(DATETIME, '${dateFrom}', 120)
      AND TRY_CONVERT(DATETIME, daddedon, 103) <= TRY_CONVERT(DATETIME, '${dateTo} 23:59:59', 120)
  `;

  console.log(`[compare] window ${dateFrom} .. ${dateTo} (imported/daddedon)`);
  const crm = await postQuery({ rawSql: crmSql, timeoutMs: 300_000 });
  const crmCount = Number((crm.data?.[0] as Record<string, unknown>)?.cnt ?? 0) || 0;

  const mirror = await withClient((c) =>
    c.query<{ cnt: string; clients: string }>(
      `SELECT COUNT(*)::text AS cnt,
              COUNT(DISTINCT client)::text AS clients
       FROM crm_transaction_entry
       WHERE daddedon >= $1::date
         AND daddedon < ($2::date + interval '1 day')`,
      [dateFrom, dateTo]
    )
  );
  const mirrorCount = Number(mirror.rows[0]?.cnt ?? 0) || 0;
  const mirrorClients = Number(mirror.rows[0]?.clients ?? 0) || 0;
  const delta = crmCount - mirrorCount;

  console.log(
    JSON.stringify(
      { dateFrom, dateTo, crmCount, mirrorCount, mirrorClients, delta },
      null,
      2
    )
  );

  if (delta === 0) {
    console.log('TOTALS MATCH — overall CRM and mirror counts are equal for this window.');
    return;
  }

  console.log(
    `TOTALS DIFFER by ${delta} (CRM − mirror). Running per-client verify (slow)…`
  );
  const rows = await verifyCallRegisterTransactionEntry({ dateFrom, dateTo });
  const bad = mismatchedClients(rows);
  console.log(`clients checked=${rows.length} mismatches=${bad.length}`);
  for (const r of rows) {
    if (r.delta !== 0 || r.mirrorNullDaddedon > 0) {
      console.log(
        `  ${r.client}: CRM=${r.crmCount} mirror=${r.mirrorCount} delta=${r.delta} null_daddedon=${r.mirrorNullDaddedon}`
      );
    }
  }
  process.exitCode = bad.length ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
