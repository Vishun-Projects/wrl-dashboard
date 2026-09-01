export type StatusBucket =
  | 'open_unallocated'
  | 'assigned'
  | 'tech_solved'
  | 'solved'
  | 'cancelled';

export type HotRow = {
  ncode: number;
  vtrnno: string;
  vcclid: string | null;
  nofficeid: number;
  nengineer: number | null;
  office_under: number | null;
  franchisee_code: string | null;
  party_name: string | null;
  branch_name: string | null;
  franchisee_name: string | null;
  pincode: string | null;
  city: string | null;
  state: string | null;
  region: string;
  account: string;
  item_name: string | null;
  item_code: string | null;
  serial: string | null;
  /** W/C/O/V from mstprorg as of call date; null when no serial link. */
  wco: string | null;
  engineer_name: string | null;
  call_type: string | null;
  complaint: string | null;
  status_label: string | null;
  status_bucket: StatusBucket;
  solve_remarks: string | null;
  contact_person: string | null;
  phone: string | null;
  address: string | null;
  has_visit: boolean;
  is_major: boolean;
  is_part_pending: boolean;
  branch_headcount: number;
  logged_at: Date;
  solved_at: Date | null;
  edited_at: Date | null;
  added_at: Date | null;
  source_editedon: Date | null;
  bsolved: boolean | null;
  bfastclose: boolean | null;
  /** From trhcalls.bapproval on sync (nullable until backfill). */
  bapproval: boolean | null;
  /** trhcalls.editedon when bapproval is true (BM Call Approved basis). */
  bm_approved_at: Date | null;
  /** BM approved date from matched ARCP claim line. */
  arcp_bm_approved_at: Date | null;
  ncancelreason: number | null;
  /** mstcallcancelreasons.vname when cancelled; otherwise null. */
  cancel_reason: string | null;
  /** Cancel datetime = trhcalls.editedon when cancelled; otherwise null. */
  cancelled_at: Date | null;
  lat: number | null;
  lng: number | null;
};

export type FactKey = {
  fact_date: string;
  office_id: number;
  call_type: string;
  account: string;
  region: string;
};

export type FactCounts = {
  total: number;
  solved: number;
  cancelled: number;
  open_count: number;
  tech_solved: number;
  deployment_total: number;
  deployment_done: number;
  installation_total: number;
  installation_done: number;
};

export type SyncStateRow = {
  entity: string;
  last_editedon: Date | null;
  last_addedon: Date | null;
  last_run_at: Date | null;
  is_running: boolean;
  rows_upserted_last: number;
  status: string | null;
};
