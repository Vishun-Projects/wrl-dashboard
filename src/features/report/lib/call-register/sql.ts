import type { CallRegisterQueryParams } from './types';
export {
  CALL_REGISTER_CLIENTS,
  isCallRegisterClient,
  type CallRegisterClient,
} from './clients';

/** @deprecated CRM live queries — sync worker uses crm-fetch instead. */
export function buildCrmTransactionQuery(params: CallRegisterQueryParams): string {
  const { dateFrom, dateTo, client } = params;
  const dateField = params.dateField === 'imported' ? 'imported' : 'billing';
  const sqlStringLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const clientFilter = client ? `AND Client = ${sqlStringLiteral(client)}` : '';
  const dateCol =
    dateField === 'billing'
      ? 'ISNULL(TRY_CONVERT(DATETIME, WarrantyStartDate, 103), TRY_CONVERT(DATETIME, daddedon, 103))'
      : 'TRY_CONVERT(DATETIME, daddedon, 103)';
  const dateFilter =
    dateFrom && dateTo
      ? `
    AND ${dateCol} >= TRY_CONVERT(DATETIME, '${dateFrom}', 120)
    AND ${dateCol} <= TRY_CONVERT(DATETIME, '${dateTo} 23:59:59', 120)
  `
      : '';

  return `
    SELECT Client AS Client, ProductSerialNo
    FROM TransactionEntry
    WHERE ProductSerialNo IS NOT NULL AND ProductSerialNo <> ''
      AND Client IS NOT NULL AND LTRIM(RTRIM(Client)) <> ''
      ${clientFilter}
      ${dateFilter}
  `;
}

export { monthChunks } from '@/lib/read-model/transaction-entry/shared';
