#!/usr/bin/env npx tsx
/**
 * Find why mirror has extra (client, serial) vs CRM in a daddedon window.
 * Compares per-client to keep memory bounded.
 *
 * Usage: npx tsx scripts/ops/explain-transaction-entry-extra.ts [from] [to] [sampleLimit]
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sqlLit(value: string): string {
  return `N'${value.replace(/'/g, "''")}'`;
}

async function main() {
  const dateFrom = process.argv[2] ?? '2024-09-01';
  const dateTo = process.argv[3] ?? todayLocalDate();
  const sampleLimit = Number(process.argv[4] ?? 25) || 25;

  console.log(`[explain-extra] window ${dateFrom} .. ${dateTo}`);

  const clientsRes = await withClient((c) =>
    c.query<{ client: string }>(
      `SELECT DISTINCT btrim(client) AS client
       FROM crm_transaction_entry
       WHERE daddedon >= $1::date AND daddedon < ($2::date + interval '1 day')
       ORDER BY 1`,
      [dateFrom, dateTo]
    )
  );
  const clients = clientsRes.rows.map((r) => r.client).filter(Boolean);

  const mirrorOnly: Array<{
    client: string;
    serial: string;
    daddedon: string | null;
    daddedon_raw: string | null;
  }> = [];
  let crmOnlyCount = 0;
  let mirrorTotal = 0;
  let crmDistinctTotal = 0;

  for (const client of clients) {
    const mirror = await withClient((c) =>
      c.query<{ serial: string; daddedon: Date | null; daddedon_raw: string | null }>(
        `SELECT btrim(product_serial_no) AS serial, daddedon, daddedon_raw
         FROM crm_transaction_entry
         WHERE btrim(client) = $1
           AND daddedon >= $2::date
           AND daddedon < ($3::date + interval '1 day')`,
        [client, dateFrom, dateTo]
      )
    );

    const crmSql = `
      SELECT DISTINCT LTRIM(RTRIM(ProductSerialNo)) AS serial
      FROM TransactionEntry
      WHERE ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
        AND LTRIM(RTRIM(Client)) = ${sqlLit(client)}
        AND TRY_CONVERT(DATETIME, daddedon, 103) >= TRY_CONVERT(DATETIME, '${dateFrom}', 120)
        AND TRY_CONVERT(DATETIME, daddedon, 103) <= TRY_CONVERT(DATETIME, '${dateTo} 23:59:59', 120)
    `;
    const crm = await postQuery({ rawSql: crmSql, timeoutMs: 180_000 });
    const crmSerials = new Set(
      ((crm.data || []) as Array<{ serial?: string }>)
        .map((r) => String(r.serial ?? '').trim())
        .filter(Boolean)
    );

    mirrorTotal += mirror.rows.length;
    crmDistinctTotal += crmSerials.size;

    const mirrorSerials = new Set<string>();
    for (const row of mirror.rows) {
      const serial = String(row.serial ?? '').trim();
      if (!serial) continue;
      mirrorSerials.add(serial);
      if (!crmSerials.has(serial)) {
        mirrorOnly.push({
          client,
          serial,
          daddedon: row.daddedon ? new Date(row.daddedon).toISOString().slice(0, 10) : null,
          daddedon_raw: row.daddedon_raw,
        });
      }
    }
    for (const serial of crmSerials) {
      if (!mirrorSerials.has(serial)) crmOnlyCount += 1;
    }

    await sleep(200);
  }

  const sample = mirrorOnly.slice(0, sampleLimit);
  let stillInCrmOtherDate = 0;
  let unparsableOrOutside = 0;
  let goneFromCrm = 0;
  const details: Array<Record<string, unknown>> = [];

  for (const row of sample) {
    const lookupSql = `
      SELECT TOP 8
        daddedon AS daddedon_raw,
        CONVERT(varchar(23), TRY_CONVERT(DATETIME, daddedon, 103), 121) AS parsed_121,
        CASE
          WHEN TRY_CONVERT(DATETIME, daddedon, 103) IS NULL THEN 'unparsable_103'
          WHEN TRY_CONVERT(DATETIME, daddedon, 103) < TRY_CONVERT(DATETIME, '${dateFrom}', 120) THEN 'before_window'
          WHEN TRY_CONVERT(DATETIME, daddedon, 103) > TRY_CONVERT(DATETIME, '${dateTo} 23:59:59', 120) THEN 'after_window'
          ELSE 'in_window'
        END AS window_status
      FROM TransactionEntry
      WHERE LTRIM(RTRIM(Client)) = ${sqlLit(row.client)}
        AND LTRIM(RTRIM(ProductSerialNo)) = ${sqlLit(row.serial)}
      ORDER BY TRY_CONVERT(DATETIME, daddedon, 103) DESC
    `;
    try {
      const res = await postQuery({ rawSql: lookupSql, timeoutMs: 60_000 });
      const hits = (res.data || []) as Array<Record<string, unknown>>;
      if (!hits.length) {
        goneFromCrm += 1;
        details.push({ ...row, reason: 'not_in_crm_anymore' });
      } else {
        const statuses = hits.map((h) => String(h.window_status ?? ''));
        const inWindow = statuses.includes('in_window');
        if (inWindow) {
          // Shouldn't happen if set compare was correct — trim/collation mismatch?
          details.push({
            ...row,
            reason: 'crm_says_in_window_but_missed_distinct',
            crm_rows: hits.slice(0, 3),
          });
        } else if (statuses.every((s) => s === 'unparsable_103')) {
          unparsableOrOutside += 1;
          details.push({ ...row, reason: 'crm_daddedon_unparsable_103', crm_rows: hits.slice(0, 3) });
        } else {
          stillInCrmOtherDate += 1;
          details.push({
            ...row,
            reason: 'crm_serial_exists_outside_window',
            crm_rows: hits.slice(0, 3),
          });
        }
      }
    } catch (err) {
      details.push({
        ...row,
        reason: 'lookup_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await sleep(150);
  }

  console.log(
    JSON.stringify(
      {
        dateFrom,
        dateTo,
        clientsChecked: clients.length,
        mirrorTotal,
        crmDistinctTotal,
        deltaMirrorMinusCrmDistinct: mirrorTotal - crmDistinctTotal,
        mirrorOnlyCount: mirrorOnly.length,
        crmOnlyCount,
        sampleChecked: sample.length,
        sampleStillInCrmOtherDate: stillInCrmOtherDate,
        sampleUnparsable: unparsableOrOutside,
        sampleGoneFromCrm: goneFromCrm,
        sampleDetails: details,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
