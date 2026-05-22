import type { ReportDateRange } from '@/lib/report-filters';
import type { RegisterDateFilterColumn } from '@/lib/trhcalls-query';
import type { RegisterSummary } from '@/lib/report-search';

export interface GlobalReportCacheType {
  data: any[];
  summaryData: any[];
  accountsData: any[];
  globalHeadcount: number;
  total: number;
  page: number;
  search: string;
  pincodeSearch: string;
  selectedOfficeIds: string[];
  dateRange: ReportDateRange;
  dateFilterColumn?: RegisterDateFilterColumn;
  filterRegion: string[];
  filterAccount: string[];
  selectedCallTypes: string[];
  registerSummary: RegisterSummary | null;
  lastRefreshed: Date | null;
  agingAsOf: string;
  selectedStatus: string[];
  priorityFilter: string[];
  portalFilter: string[];
  selectedState?: string[];
  selectedCity?: string[];
  selectedBranch?: string[] | string;
  selectedFranchisee?: string[] | string;
  selectedTechnician?: string[];
  summaryQueryKey?: string;
}

export interface DistributionDataCache {
  allCalls: any[];
  dbBranches: any[];
  cacheKey: string;
  fetchedAt: number;
  lastSyncedAt: number;
}

export let globalReportCache: GlobalReportCacheType | null = null;

export let distributionDataCache: DistributionDataCache | null = null;

export function setGlobalReportCache(cache: GlobalReportCacheType | null) {
  globalReportCache = cache;
}

export function setDistributionDataCache(cache: DistributionDataCache | null) {
  distributionDataCache = cache;
}
