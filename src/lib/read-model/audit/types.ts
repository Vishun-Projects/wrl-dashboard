import type { HotRow } from '@/lib/read-model/types';

export type AuditPhase = 'hot' | 'dims' | 'facts' | 'plant' | 'reverse';

export type ColumnMismatch = {
  column: string;
  hot_value: unknown;
  expected_value: unknown;
};

export type AuditMismatch = {
  phase: AuditPhase;
  entity: string;
  kind:
    | 'column_mismatch'
    | 'missing_in_crm'
    | 'should_not_exist_in_hot'
    | 'missing_in_hot'
    | 'extra_in_hot'
    | 'orphan_fk'
    | 'invalid_zone';
  key: string;
  trn?: string;
  columns?: ColumnMismatch[];
  details?: Record<string, unknown>;
};

export type HotAuditSummary = {
  rows_checked: number;
  column_mismatch_rows: number;
  column_mismatches: number;
  missing_in_crm: number;
  should_not_exist: number;
  by_column: Record<string, number>;
};

export type DimTableAuditSummary = {
  postgres_count: number;
  crm_count: number;
  missing_in_postgres: number;
  extra_in_postgres: number;
  column_mismatch_rows: number;
  column_mismatches: number;
};

export type FactsAuditSummary = {
  keys_checked: number;
  missing_in_postgres: number;
  extra_in_postgres: number;
  column_mismatch_keys: number;
  column_mismatches: number;
};

export type PlantAuditSummary = {
  rows_checked: number;
  orphan_office_ids: number;
  invalid_zones: number;
};

export type ReverseAuditSummary = {
  crm_eligible_count: number;
  hot_count: number;
  in_crm_not_in_hot: number;
  in_hot_not_eligible: number;
};

export type AuditSummary = {
  started_at: string;
  finished_at: string | null;
  apply_mode: boolean;
  phases_run: AuditPhase[];
  hot: HotAuditSummary | null;
  dims: {
    offices: DimTableAuditSummary | null;
    engineers: DimTableAuditSummary | null;
    call_types: DimTableAuditSummary | null;
  };
  facts: FactsAuditSummary | null;
  plant: PlantAuditSummary | null;
  reverse: ReverseAuditSummary | null;
  total_mismatches: number;
  fixes_applied: {
    hot_upserted: number;
    hot_deleted: number;
    ncr_repaired: number;
    dims_refreshed: boolean;
    facts_rebuilt: boolean;
  };
};

export type AuditOptions = {
  phases: AuditPhase[];
  apply: boolean;
  resumeFromTrn?: string;
  hotPageSize?: number;
  crmTrnChunk?: number;
  skipReverse?: boolean;
  onMismatch?: (mismatch: AuditMismatch) => void;
  onProgress?: (message: string) => void;
};

export type HotRowDb = HotRow & { synced_at?: Date | string | null };
