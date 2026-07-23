import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { CALL_REGISTER_CLIENTS } from './clients';
import { callRegisterDateSqlExpr, parseCallRegisterDateField } from './dates';
import type { CallRegisterQueryParams, CallRegisterRow, CallRegisterSummary } from './types';

const HOT_DONE = `(
  h.status_bucket::text IN ('solved', 'completed')
  OR LOWER(COALESCE(h.status_label, '')) IN ('solved', 'completed')
)`;

function ensureGridRows(rows: CallRegisterRow[]): CallRegisterRow[] {
  const byClient = new Map(rows.map((r) => [r.client, r]));
  return CALL_REGISTER_CLIENTS.map(
    (client) =>
      byClient.get(client) ?? {
        client,
        qty: 0,
        installation: 0,
        deployment: 0,
        balanceInstallation: 0,
        balanceDeployment: 0,
      }
  );
}

type AggregateRow = {
  client: string;
  qty: number;
  installation: number;
  deployment: number;
};

/** Count install/deploy on billed serials where the solved call is on the same account. */
async function fetchAggregatedRows(params: CallRegisterQueryParams): Promise<AggregateRow[]> {
  const { dateFrom, dateTo } = params;
  const dateField = parseCallRegisterDateField(params.dateField);
  const dateExpr = callRegisterDateSqlExpr(dateField, 'b');
  const dateClause =
    dateFrom && dateTo
      ? `AND ${dateExpr} >= $2::date
         AND ${dateExpr} < ($3::date + interval '1 day')`
      : '';
  const args: unknown[] =
    dateFrom && dateTo ? [CALL_REGISTER_CLIENTS, dateFrom, dateTo] : [CALL_REGISTER_CLIENTS];

  return prisma.$queryRawUnsafeBulk<AggregateRow[]>(
    `SELECT b.client,
       COUNT(*)::int AS qty,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM calls_latest_hot h
         WHERE h.serial = b.product_serial_no
           AND h.account = b.client
           AND UPPER(h.call_type) IN ('INSTALLATION', 'INSTALLATION CALL')
           AND ${HOT_DONE}
       ))::int AS installation,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM calls_latest_hot h
         WHERE h.serial = b.product_serial_no
           AND h.account = b.client
           AND UPPER(h.call_type) IN ('DEPLOYMENT', 'DEPLOYMENT CALL')
           AND ${HOT_DONE}
       ))::int AS deployment
     FROM crm_transaction_entry b
     WHERE b.client = ANY($1::text[])
     ${dateClause}
     GROUP BY b.client`,
    ...args
  );
}

export function listCallRegisterClients(): string[] {
  return [...CALL_REGISTER_CLIENTS];
}

export async function fetchCallRegisterRows(
  params: CallRegisterQueryParams
): Promise<{ rows: CallRegisterRow[]; summary: CallRegisterSummary }> {
  const aggregated = await fetchAggregatedRows(params);

  let totalQty = 0;
  let totalInstallation = 0;
  let totalDeployment = 0;

  const rows = aggregated.map((row) => {
    const qty = Number(row.qty || 0);
    const installation = Number(row.installation || 0);
    const deployment = Number(row.deployment || 0);
    totalQty += qty;
    totalInstallation += installation;
    totalDeployment += deployment;
    return {
      client: row.client,
      qty,
      installation,
      deployment,
      balanceInstallation: qty - installation,
      balanceDeployment: qty - deployment,
    };
  });

  return {
    rows: ensureGridRows(rows),
    summary: {
      totalQty,
      totalInstallation,
      totalDeployment,
      totalBalanceInstallation: totalQty - totalInstallation,
      totalBalanceDeployment: totalQty - totalDeployment,
    },
  };
}
