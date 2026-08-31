export type CancelledCallsFilters = {
  startDate: string;
  endDate: string;
  branches: string[];
  callTypes: string[];
  page: number;
  pageSize: number;
  isHod: boolean;
  assignedOffices: string[];
};

export type CancelledCallRow = {
  vtrnno: string;
  ncode: number;
  ncancelreason: number;
  cancelReason: string;
  cancelledAt: string;
  loggedAt: string;
  callType: string | null;
  branchName: string | null;
  partyName: string | null;
  itemName: string | null;
  serial: string | null;
  engineerName: string | null;
  complaint: string | null;
  region: string | null;
  account: string | null;
};

export type CancelledCallsHealth = {
  totalRows: number;
  maxCancelledAt: string | null;
  maxSyncedAt: string | null;
  registerLastSyncedAt: string | null;
  registerStatus: string | null;
  registerLagMinutes: number | null;
};

export type CancelledCallsSummary = {
  total: number;
  byBranch: Array<{ label: string; count: number }>;
  byCallType: Array<{ label: string; count: number }>;
  health: CancelledCallsHealth;
};

export type CancelledCallsRowsResponse = {
  rows: CancelledCallRow[];
  total: number;
  page: number;
  pageSize: number;
};
