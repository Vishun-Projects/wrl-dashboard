export type StatusBucket =
  | 'open_unallocated'
  | 'assigned'
  | 'tech_solved'
  | 'solved'
  | 'cancelled';

export type MisClientSource = {
  id: string;
  code: string;
  name: string;
  file_kind: 'csv' | 'xlsx';
  delimiter: string | null;
  header_row_index: number;
  call_key_column: string;
  crm_account_filter: string | null;
  is_active: boolean;
};

export type MisClientFieldMapping = {
  client_column: string;
  crm_field: string;
  transform: Record<string, unknown> | null;
};

export type MisClientStatusMapping = {
  client_status: string;
  status_bucket: StatusBucket;
  status_label: string;
};

export type MisClientStateMapping = {
  client_state: string;
  plan_code: string | null;
  region_override: string | null;
};

export type MisClientSourceConfig = MisClientSource & {
  fieldMappings: MisClientFieldMapping[];
  statusMappings: MisClientStatusMapping[];
  stateMappings: MisClientStateMapping[];
};

export type SourceConfigPayload = {
  code: string;
  name: string;
  file_kind: 'csv' | 'xlsx';
  delimiter?: string | null;
  header_row_index: number;
  call_key_column: string;
  crm_account_filter?: string | null;
  fieldMappings: MisClientFieldMapping[];
  statusMappings: MisClientStatusMapping[];
  stateMappings: MisClientStateMapping[];
};

export type NormalizedClientRow = {
  call_key: string;
  logged_at: Date | null;
  solved_at: Date | null;
  status_bucket: StatusBucket;
  status_label: string;
  region: string;
  state: string | null;
  branch_label: string | null;
  complaint: string | null;
  call_type: string | null;
  is_part_pending: boolean;
  engineer_name: string | null;
  raw: Record<string, string>;
};

export type ImportRowError = {
  row: number;
  message: string;
};

export type ImportResult = {
  batchId: string;
  rowCount: number;
  errorCount: number;
  errors: ImportRowError[];
  warnings: string[];
  filterStart: string | null;
  filterEnd: string | null;
};

export type ClientImportMeta = {
  batchId: string;
  sourceCode: string;
  sourceName: string;
  uploadedAt: string;
  uploadedBy: string;
  fileName: string;
  rowCount: number;
};
