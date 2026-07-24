import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { listVisibleCallRegisterClients } from '@/lib/call-register/visible-clients';
import { callRegisterDateSqlExpr, parseCallRegisterDateField } from './dates';
import type { CallRegisterQueryParams, CallRegisterRow, CallRegisterSummary } from './types';

const HOT_DONE = `(
  h.status_bucket::text IN ('solved', 'completed')
  OR LOWER(COALESCE(h.status_label, '')) IN ('solved', 'completed')
)`;

function ensureAllowlistGridRows(
  rows: CallRegisterRow[],
  allowlist: string[]
): CallRegisterRow[] {
  const byClient = new Map(rows.map((r) => [r.client, r]));
  return allowlist.map(
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

const AGG_SELECT = `SELECT b.client,
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
     FROM crm_transaction_entry b`;

/** Count install/deploy on billed serials where the solved call is on the same account. */
async function fetchAggregatedRows(
  params: CallRegisterQueryParams,
  allowlist: string[] | null
): Promise<AggregateRow[]> {
  const { dateFrom, dateTo } = params;
  const dateField = parseCallRegisterDateField(params.dateField);
  const dateExpr = callRegisterDateSqlExpr(dateField, 'b');
  const dateClause =
    dateFrom && dateTo
      ? `AND ${dateExpr} >= $1::date
         AND ${dateExpr} < ($2::date + interval '1 day')`
      : '';

  if (allowlist == null) {
    const args: unknown[] = dateFrom && dateTo ? [dateFrom, dateTo] : [];
    return prisma.$queryRawUnsafeBulk<AggregateRow[]>(
      `${AGG_SELECT}
     WHERE NULLIF(trim(b.client), '') IS NOT NULL
     ${dateClause}
     GROUP BY b.client
     ORDER BY b.client`,
      ...args
    );
  }

  const curatedDateClause =
    dateFrom && dateTo
      ? `AND ${dateExpr} >= $2::date
         AND ${dateExpr} < ($3::date + interval '1 day')`
      : '';
  const args: unknown[] =
    dateFrom && dateTo ? [allowlist, dateFrom, dateTo] : [allowlist];

  return prisma.$queryRawUnsafeBulk<AggregateRow[]>(
    `${AGG_SELECT}
     WHERE b.client = ANY($1::text[])
     ${curatedDateClause}
     GROUP BY b.client`,
    ...args
  );
}

export async function listCallRegisterClients(): Promise<string[]> {
  return listVisibleCallRegisterClients();
}

export async function fetchCallRegisterRows(
  params: CallRegisterQueryParams & { allClients?: boolean }
): Promise<{ rows: CallRegisterRow[]; summary: CallRegisterSummary; sharedClients: string[] }> {
  const allClients = Boolean(params.allClients);
  const sharedClients = await listVisibleCallRegisterClients();
  const aggregated = await fetchAggregatedRows(params, allClients ? null : sharedClients);

  let totalQty = 0;
  let totalInstallation = 0;
  let totalDeployment = 0;

  const mapped = aggregated.map((row) => {
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

  const rows = allClients
    ? mapped.sort((a, b) => a.client.localeCompare(b.client))
    : ensureAllowlistGridRows(mapped, sharedClients);

  if (!allClients) {
    totalQty = 0;
    totalInstallation = 0;
    totalDeployment = 0;
    for (const row of rows) {
      totalQty += row.qty;
      totalInstallation += row.installation;
      totalDeployment += row.deployment;
    }
  }

  return {
    rows,
    sharedClients,
    summary: {
      totalQty,
      totalInstallation,
      totalDeployment,
      totalBalanceInstallation: totalQty - totalInstallation,
      totalBalanceDeployment: totalQty - totalDeployment,
    },
  };
}
