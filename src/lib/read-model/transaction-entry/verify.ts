import { postQuery } from '@/lib/db/proxy';
import { withClient } from '@/lib/read-model/db';
import { todayLocalDate } from '@/lib/read-model/dates';
import { fetchTransactionEntryClients } from './crm-fetch';

const CRM_TIMEOUT_MS = Number(process.env.TRANSACTION_ENTRY_CRM_TIMEOUT_MS ?? 180_000) || 180_000;

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function crmCountSql(client: string, dateFrom: string, dateTo: string): string {
  return `
    SELECT COUNT(*) AS cnt
    FROM TransactionEntry
    WHERE ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
      AND Client = ${sqlLiteral(client)}
      AND TRY_CONVERT(DATETIME, daddedon, 103) >= TRY_CONVERT(DATETIME, '${dateFrom}', 120)
      AND TRY_CONVERT(DATETIME, daddedon, 103) <= TRY_CONVERT(DATETIME, '${dateTo} 23:59:59', 120)
  `;
}

export type TransactionEntryVerifyRow = {
  client: string;
  crmCount: number;
  mirrorCount: number;
  mirrorNullDaddedon: number;
  delta: number;
};

export async function verifyCallRegisterTransactionEntry(opts?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<TransactionEntryVerifyRow[]> {
  const dateTo = opts?.dateTo ?? todayLocalDate();
  const dateFrom = opts?.dateFrom ?? dateTo;

  const clients = await fetchTransactionEntryClients();
  const rows: TransactionEntryVerifyRow[] = [];

  for (const client of clients) {
    let crmCount = 0;
    try {
      const res = await postQuery({ rawSql: crmCountSql(client, dateFrom, dateTo), timeoutMs: CRM_TIMEOUT_MS });
      crmCount = Number((res.data?.[0] as Record<string, unknown>)?.cnt ?? 0) || 0;
    } catch (err) {
      console.warn(
        `[transaction-entry] verify CRM count failed for ${client}:`,
        err instanceof Error ? err.message : err
      );
    }

    const mirror = await withClient((c) =>
      c.query<{ cnt: string; null_daddedon: string }>(
        `SELECT COUNT(*)::text AS cnt,
                COUNT(*) FILTER (WHERE daddedon IS NULL)::text AS null_daddedon
         FROM crm_transaction_entry
         WHERE client = $1
           AND daddedon >= $2::date
           AND daddedon < ($3::date + interval '1 day')`,
        [client, dateFrom, dateTo]
      )
    );
    const mirrorCount = Number(mirror.rows[0]?.cnt ?? 0) || 0;
    const mirrorNullDaddedon = Number(mirror.rows[0]?.null_daddedon ?? 0) || 0;

    rows.push({
      client,
      crmCount,
      mirrorCount,
      mirrorNullDaddedon,
      delta: crmCount - mirrorCount,
    });
  }

  return rows;
}

export function mismatchedClients(rows: TransactionEntryVerifyRow[]): string[] {
  return rows.filter((r) => r.delta !== 0 || r.mirrorNullDaddedon > 0).map((r) => r.client);
}

export function logTransactionEntryVerify(
  rows: TransactionEntryVerifyRow[],
  label: string,
  dateFrom: string,
  dateTo: string
): void {
  const mismatches = mismatchedClients(rows);
  console.log(
    `[transaction-entry] verify ${label} ${dateFrom}..${dateTo} — ${rows.length} clients, ${mismatches.length} mismatch(es)`
  );
  for (const row of rows) {
    if (row.delta !== 0 || row.mirrorNullDaddedon > 0) {
      console.log(
        `[transaction-entry] verify ${row.client}: CRM=${row.crmCount} mirror=${row.mirrorCount} delta=${row.delta} null_daddedon=${row.mirrorNullDaddedon}`
      );
    }
  }
}
