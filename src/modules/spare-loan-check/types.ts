export type SpareLoanMatchSource = 'loan' | 'con_rtn';

/** Shown problems only — not_found is hidden; transferred counts as vendor_mismatch. */
export type SpareLoanProblemReason =
  | 'vendor_mismatch'
  | 'cancelled'
  | 'unassigned_cancelled';

export type Zss02ParsedRow = {
  plant: string;
  vendorNo: string;
  vendorName: string;
  material: string;
  materialDescription: string;
  barcode: string;
  soConRtn: string;
  soLoan: string;
  loanDate: string;
  loanRtnDate: string;
  cnsmpDate: string;
  noCnsmpCount: string;
  saleDate: string;
  saleRtnDate: string;
};

export type SpareLoanCallLookup = {
  vtrnno: string;
  vendorCode: string | null;
  vendorName: string | null;
  statusBucket: string;
  ncancelreason: number | null;
  cancelReason: string | null;
  transferred: boolean;
  /** Call log date (ISO). */
  loggedAt: string | null;
  /** Cancel / transfer / last CRM edit (ISO). */
  lastEditedAt: string | null;
};

export type SpareLoanProblemRow = {
  plant: string;
  vendorNo: string;
  vendorName: string;
  material: string;
  materialDescription: string;
  /** CRM mstitemcategory.vname via material → mstitems. */
  itemCategory: string | null;
  barcode: string;
  soLoan: string;
  soConRtn: string;
  matchKey: string;
  matchSource: SpareLoanMatchSource;
  crmVtrnno: string | null;
  crmVendorCode: string | null;
  crmVendorName: string | null;
  reason: SpareLoanProblemReason;
  cancelReason: string | null;
  callLoggedAt: string | null;
  lastEditedAt: string | null;
};

export type SpareLoanCheckSummary = {
  parsed: number;
  skipped: number;
  ok: number;
  problems: number;
  byReason: Record<SpareLoanProblemReason, number>;
};

export type SpareLoanCheckResponse = {
  summary: SpareLoanCheckSummary;
  rows: SpareLoanProblemRow[];
  savedPlants?: string[];
};
