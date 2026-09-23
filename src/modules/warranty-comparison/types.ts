export type WarrantyComparisonTab = 'oow_in_warr' | 'in_warr_oow' | 'all';

export type WarrantyComparisonFilterParams = {
  tab: WarrantyComparisonTab;
  startDate?: string;
  endDate?: string;
  dateRangeLabel?: string;
  search?: string;
  branches?: string[];
  accounts?: string[];
  callTypes?: string[];
  statuses?: string[];
  page?: number;
  pageSize?: number;
  sortBy?: 'callDate' | 'vtrnno' | 'serial' | 'partyName' | 'account' | 'warrEndDt' | 'warrantyMonths' | 'daysDelta';
  sortDir?: 'asc' | 'desc';
};

export type WarrantyComparisonSummary = {
  totalCallsAnalyzed: number;
  totalWithWarrantyMaster: number;
  oowInWarrCount: number;
  inWarrOowCount: number;
  uniqueSerialsCount: number;
};

export type WarrantyComparisonRow = {
  vtrnno: string;
  vcclid: string | null;
  callDate: string;
  callType: string;
  status: string;
  serial: string;
  callWco: string;
  partyName: string;
  branchName: string;
  region: string;
  account: string;
  itemName: string;
  customerName: string;
  customerSubgroup: string | null;
  groupName: string;
  fgModel: string;
  warrantyMonths: number | null;
  warrStartDt: string | null;
  warrEndDt: string | null;
  billingDoc: string | null;
  billingDate: string | null;
  masterWarrantyStatus: 'EXPIRED' | 'ACTIVE';
  mismatchType: 'oow_in_warr' | 'in_warr_oow';
  daysDelta: number; // positive = days expired before call; negative = days remaining before expiry
};

export type WarrantyComparisonRowsResponse = {
  rows: WarrantyComparisonRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type WarrantyComparisonFilterOptions = {
  branches: Array<{ value: string; label: string; count?: number }>;
  accounts: Array<{ value: string; label: string; count?: number }>;
  callTypes: Array<{ value: string; label: string; count?: number }>;
  statuses: Array<{ value: string; label: string; count?: number }>;
};
