export type AthenaReconciliationStatus =
  | 'REGISTERED'
  | 'NOT_REGISTERED'
  | 'MULTIPLE_MATCHES'
  | 'INVALID_DATA';

export type CrmAthenaFailedRow = {
  ClientCaption?: string;
  BRANCHNAME?: string;
  CLIENTTICKETNO?: string;
  MCSTATUS?: string;
  CALLTYPE?: string;
  NATUREOFCOMPLAINT?: string;
  RECEIVEDDATE?: string;
  ASPOFFICEID?: string;
  OUTLETNAME?: string;
  CLIENTCODE1?: string;
  CLIENT?: string;
  TOWN?: string;
  AREANAME?: string;
  OUTLETNAMEADDRESS?: string;
  PINCODE?: string;
  PHONE?: string;
  MODEL?: string;
  SERIALNO?: string;
  ASSETNO1?: string;
  INVOICENO?: string;
  Product_Status?: string;
  INVOICEDATE?: string;
  RESULT?: string;
  RESULT_VALUE?: string;
  addedon?: string;
  [key: string]: unknown;
};

export type AthenaFailedRawRow = {
  id: number;
  clientCaption: string | null;
  branchName: string | null;
  clientTicketNo: string | null;
  mcStatus: string | null;
  callType: string | null;
  natureOfComplaint: string | null;
  receivedDateRaw: string | null;
  aspOfficeId: string | null;
  outletName: string | null;
  clientCode1: string | null;
  client: string | null;
  town: string | null;
  areaName: string | null;
  outletNameAddress: string | null;
  pincode: string | null;
  phone: string | null;
  model: string | null;
  serialNo: string | null;
  assetNo1: string | null;
  invoiceNo: string | null;
  productStatus: string | null;
  invoiceDateRaw: string | null;
  result: string | null;
  resultValue: string | null;
  addedonRaw: string | null;
  ingestionBatchId: string | null;
  sourceIdentifier: string;
  rawFingerprint: string;
  ingestedAt: Date;
};

export type AthenaFailedNormalizedRow = {
  id: number;
  rawFingerprint: string;
  clientCaption: string | null;
  branchName: string | null;
  clientTicketNo: string | null;
  mcStatus: string | null;
  callType: string | null;
  natureOfComplaint: string | null;
  outletName: string | null;
  outletAddress: string | null;
  pincode: string | null;
  phone: string | null;
  model: string | null;
  serialNo: string | null;
  assetNo: string | null;
  invoiceNo: string | null;
  productStatus: string | null;
  result: string | null;
  resultValue: string | null;
  failureReason: string | null;
  callDate: Date | null;
  receivedDate: Date | null;
  addedonAt: Date | null;
  isValidMatchingData: boolean;
  invalidReason: string | null;
  reconciliationStatus: AthenaReconciliationStatus;
  matchCount: number;
  matchedVtrnno: string | null;
  matchedVtrnnos: string[] | null;
  matchedCrmLoggedAt: Date | null;
  matchedCrmStatus: string | null;
  matchedCrmPartyName: string | null;
  matchedCrmCallType: string | null;
  matchedCrmSerial: string | null;
  reconciledAt: Date | null;
  updatedAt: Date;
  attemptCount?: number;
};

export type AthenaReconciliationFilterParams = {
  startDate?: string | null;
  endDate?: string | null;
  branches?: string[] | null;
  clients?: string[] | null;
  callTypes?: string[] | null;
  failureReasons?: string[] | null;
  status?: AthenaReconciliationStatus | 'ALL' | null;
  search?: string | null;
  excludedReasons?: string[] | null;
  treatAsRegisteredReasons?: string[] | null;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Preset label from DateRangeSelector (e.g. This Month, Last 7 Days). */
  dateRangeLabel?: string | null;
};

export type AthenaReconciliationKpis = {
  totalRecords: number;
  registered: number;
  notRegistered: number;
  multipleMatches: number;
  invalidData: number;
  registrationRatePct: number;
  failureRatePct: number;
};

export type AthenaDailyTrendPoint = {
  date: string;
  total: number;
  registered: number;
  notRegistered: number;
  multipleMatches: number;
  invalidData: number;
};

export type AthenaBreakdownItem = {
  label: string;
  count: number;
  percentage: number;
};

export type AthenaProblemEntity = {
  identifier: string;
  name: string;
  totalUnregistered: number;
  latestCallDate: string | null;
  commonFailureReason: string | null;
};

export type AthenaReconciliationSummary = {
  kpis: AthenaReconciliationKpis;
  dailyTrend: AthenaDailyTrendPoint[];
  byFailureReason: AthenaBreakdownItem[];
  byCallType: AthenaBreakdownItem[];
  byClient: AthenaBreakdownItem[];
  byBranch: AthenaBreakdownItem[];
  topUnregisteredSerials: AthenaProblemEntity[];
  topUnregisteredOutlets: AthenaProblemEntity[];
  lastReconciledAt: string | null;
  lastSyncState: {
    status: string | null;
    lastAddedon: string | null;
    lastRunAt: string | null;
    rowsUpsertedLast: number;
  } | null;
};

export type AthenaReasonDateMatrixRow = {
  reason: string;
  total: number;
  byDate: Record<string, number>;
};

export type AthenaReasonDateMatrix = {
  windowStart: string;
  windowEnd: string;
  dates: string[];
  rows: AthenaReasonDateMatrixRow[];
  columnTotals: Record<string, number>;
  grandTotal: number;
  registeredByDate: Record<string, number>;
  unregisteredByDate: Record<string, number>;
  multipleMatchesByDate: Record<string, number>;
  invalidDataByDate: Record<string, number>;
  registeredTotal: number;
  unregisteredTotal: number;
  multipleMatchesTotal: number;
  invalidDataTotal: number;
};

export type AthenaFailedAttemptSummary = {
  id: number;
  clientTicketNo: string | null;
  callDate: Date | null;
  failureReason: string | null;
  result: string | null;
  resultValue: string | null;
  reconciliationStatus: AthenaReconciliationStatus;
  matchCount: number;
  matchedVtrnnos: string[] | null;
  isCurrent: boolean;
};

export type AthenaCrmCallSummary = {
  vtrnno: string;
  vcclid: string | null;
  callType: string | null;
  partyName: string | null;
  serial: string | null;
  loggedAt: Date | null;
  statusLabel: string | null;
  statusBucket: string | null;
  complaint: string | null;
  branchName: string | null;
};

export type AthenaInspectionDetail = {
  row: AthenaFailedNormalizedRow;
  relatedFailures: AthenaFailedAttemptSummary[];
  crmCalls: AthenaCrmCallSummary[];
};

export type AthenaFailedRowDetail = AthenaFailedNormalizedRow & {
  rawPayload?: Record<string, unknown>;
};

export type AthenaRowsResponse = {
  rows: AthenaFailedNormalizedRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
