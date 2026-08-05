import type { CallRegisterDateField } from './dates';

export type CallRegisterQueryParams = {
  /** Omit both for All Time. */
  dateFrom?: string;
  dateTo?: string;
  /** Date-range field: billing (`warranty_start`) by default; `imported` for internal use. */
  dateField?: CallRegisterDateField;
  /** Optional single-client scope (CRM chunk fallback). */
  client?: string;
};

export type CrmTransactionRow = {
  Client: string;
  ProductSerialNo: string;
};

export type CallRegisterRow = {
  client: string;
  qty: number;
  installation: number;
  deployment: number;
  balanceInstallation: number;
  balanceDeployment: number;
};

export type CallRegisterSummary = {
    totalQty: number;
    totalInstallation: number;
    totalDeployment: number;
    totalBalanceInstallation: number;
    totalBalanceDeployment: number;
  };
