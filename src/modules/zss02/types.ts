import type { Zss02ParsedRow } from '@/modules/spare-loan-check';

export type { Zss02ParsedRow };

export type Zss02ImportMeta = {
  id: string;
  fileName: string;
  parsed: number;
  skipped: number;
  importedAt: string;
};

/** CRM flags using spare-loan-check classify rules. */
export type Zss02IssueFlag = 'cancelled' | 'franchisee_change' | null;

export type Zss02Row = Zss02ParsedRow & {
  id: number;
  importId: string;
  plantName: string | null;
  issue: Zss02IssueFlag;
  issueDetail: string | null;
};

export type Zss02OptionsResponse = {
  plants: Array<{ value: string; label: string }>;
  vendors: Array<{ value: string; label: string }>;
  materials: Array<{ value: string; label: string }>;
  /** Latest loan_date across stored rows as DD-MM-YYYY, or null. */
  latestLoanDate: string | null;
};

export type Zss02RowsResponse = {
  rows: Zss02Row[];
  total: number;
  page: number;
  pageSize: number;
};

export type Zss02ImportResult = {
  importId: string;
  fileName: string;
  parsed: number;
  skipped: number;
  /** Plants whose prior rows were cleared before this insert. */
  plantsOverwritten: string[];
};

export type Zss02ImportResponse = {
  imports: Zss02ImportResult[];
};
