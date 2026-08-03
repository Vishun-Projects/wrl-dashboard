#!/usr/bin/env npx tsx
/**
 * Compare CRM TransactionEntry vs crm_transaction_entry mirror for Deployment Completion accounts.
 * Usage: npx tsx scripts/ops/verify-transaction-entry-sync.ts [from] [to]
 */
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(process.cwd(), '.env.local') });
config({ path: join(process.cwd(), '.env.sync-worker') });
config({ path: join(process.cwd(), '.env') });
process.env.USE_DIRECT_DATABASE = 'true';

import { closePool } from '@/lib/read-model/db';
import { todayLocalDate, daysAgoDate } from '@/lib/read-model/dates';
import {
  logTransactionEntryVerify,
  verifyCallRegisterTransactionEntry,
} from '@/lib/read-model/transaction-entry/verify';

async function main() {
  const dateTo = process.argv[3] ?? process.argv[2] ?? todayLocalDate();
  const dateFrom = process.argv[3] ? process.argv[2]! : daysAgoDate(7);

  const rows = await verifyCallRegisterTransactionEntry({ dateFrom, dateTo });
  logTransactionEntryVerify(rows, 'manual', dateFrom, dateTo);

  const mismatches = rows.filter((r) => r.delta !== 0);
  if (mismatches.length) {
    console.log('\nMismatches (CRM count − mirror count):');
    for (const r of mismatches) {
      console.log(`  ${r.client}: CRM=${r.crmCount} mirror=${r.mirrorCount} delta=${r.delta}`);
    }
    process.exitCode = 1;
  } else {
    console.log('\nAll Deployment Completion accounts in sync for this window.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
