-- Chunk 52: Warranty Master rollup for fast KPI / hierarchy / filter options.
-- Grain: case-folded subgroup × group × warranty_months × fg_model (~100k rows vs 5M items).

CREATE TABLE IF NOT EXISTS warranty_master_rollup (
  subgroup_key          text NOT NULL,
  subgroup_label        text NOT NULL,
  group_key             text NOT NULL,
  group_label           text NOT NULL,
  warranty_months       smallint NOT NULL,
  fg_model              text NOT NULL,
  machine_count         integer NOT NULL,
  active_machine_count  integer NOT NULL,
  min_warr_end          date,
  max_warr_end          date,
  PRIMARY KEY (subgroup_key, group_key, warranty_months, fg_model)
);

CREATE INDEX IF NOT EXISTS idx_wm_rollup_subgroup
  ON warranty_master_rollup (subgroup_key);

CREATE INDEX IF NOT EXISTS idx_wm_rollup_group
  ON warranty_master_rollup (group_key);

CREATE INDEX IF NOT EXISTS idx_wm_rollup_fg
  ON warranty_master_rollup (fg_model);

CREATE INDEX IF NOT EXISTS idx_wm_rollup_months
  ON warranty_master_rollup (warranty_months);

COMMENT ON TABLE warranty_master_rollup IS
  'Pre-aggregated Warranty Master lines for report KPIs/hierarchy; rebuilt on Excel import.';
