import type { ReportDateRange } from '@/features/report/services/filters';
import type { RegisterDateFilterColumn } from '@/lib/trhcalls/query';
import type { RegisterSummary } from '@/features/report/services/search';

export interface GlobalReportCacheType {
  data: Array<Record<string, unknown>>;
  summaryData: Array<Record<string, unknown>>;
  accountsData: Array<Record<string, unknown>>;
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
  repairFilter?: string[];
  selectedState?: string[];
  selectedCity?: string[];
  selectedRegion?: string[];
  selectedAccount?: string[];
  selectedBranch?: string[] | string;
  selectedFranchisee?: string[] | string;
  selectedTechnician?: string[];
  summaryQueryKey?: string;
}

export interface DistributionDataCache {
  allCalls: Array<Record<string, unknown>>;
  dbBranches: Array<Record<string, unknown>>;
  cacheKey: string;
  fetchedAt: number;
  lastSyncedAt: number;
}

export interface CallCorpusStore {
  calls: Map<string, Record<string, unknown>>;
  cacheKey: string;
  fetchedAt: number;
  lastSyncedAt: number;
  status: 'idle' | 'hydrated' | 'refreshing' | 'error';
  source: 'memory' | 'indexeddb' | 'network';
  truncated?: boolean;
  errorMessage?: string;
}

export let globalReportCache: GlobalReportCacheType | null = null;

export let distributionDataCache: DistributionDataCache | null = null;

export let callCorpusStore: CallCorpusStore | null = null;

export function setGlobalReportCache(cache: GlobalReportCacheType | null) {
  globalReportCache = cache;
}

export function setDistributionDataCache(cache: DistributionDataCache | null) {
  distributionDataCache = cache;
}

export function setCallCorpusStore(store: CallCorpusStore | null) {
  callCorpusStore = store;
}
