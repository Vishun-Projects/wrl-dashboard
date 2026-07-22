export type CallRegisterQueryParams = {
  /** Omit both for All Time. */
  dateFrom?: string;
  dateTo?: string;
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
