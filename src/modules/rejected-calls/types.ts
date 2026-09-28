export type RejectedBySource = 'HO' | 'Branch';

export type RejectedCallsFilters = {
  startDate: string;
  endDate: string;
  source: RejectedBySource | null;
  callType: string | null;
  officeId: string | null;
  technician: string | null;
  search: string | null;
  reasons: string[];
  repair: string | null;
  dateFilterColumn: string | null;
  page: number;
  pageSize: number;
  isHod: boolean;
  assignedOffices: string[];
};

export type RejectedCallRow = {
  ncode: number;
  nofficeid: number;
  callNo: string;
  callDate: string | null;
  serialNo: string | null;
  callType: string | null;
  activityDone: string | null;
  solveDate: string | null;
  rejectedBySource: RejectedBySource;
  rejectionAt: string | null;
  rejectionReason: string | null;
  rejectedByName: string | null;
  branchName: string | null;
  franchiseeName: string | null;
};

export type RejectedCallsByLabel = {
  label: string;
  count: number;
};

export type RejectedCallsSummary = {
  total: number;
  byCallType: RejectedCallsByLabel[];
  byReason: RejectedCallsByLabel[];
};

export type RejectedCallsRowsResponse = {
  rows: RejectedCallRow[];
  total: number;
  page: number;
  pageSize: number;
  summary?: RejectedCallsSummary;
};
