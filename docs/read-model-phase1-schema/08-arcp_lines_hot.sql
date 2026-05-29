-- Chunk 8: ARCP franchise claim lines (synced from CRM trdcalls10ARCP)
CREATE TABLE IF NOT EXISTS arcp_lines_hot (
  ncode                   bigint NOT NULL,
  vucnno                  varchar(50),
  calls2fault_code        bigint,
  nofficeid               bigint NOT NULL,
  office_under            bigint,
  call_at                 timestamptz,
  solve_at                timestamptz,
  bm_approved_at          timestamptz,
  ho_approved_at          timestamptz,
  approve_at              timestamptz,
  claim_month_call        varchar(7),
  claim_month_solve       varchar(7),
  claim_month_approve     varchar(7),
  ncalltype               varchar(50),
  nitemcategory           varchar(50),
  nlocalupcountry         varchar(50),
  call_type_label         varchar(255),
  item_category_label     varchar(255),
  local_upcountry_label   varchar(255),
  is_travel               boolean NOT NULL DEFAULT false,
  is_major                boolean NOT NULL DEFAULT false,
  rate                    numeric,
  amount_payable          numeric,
  branch_approved         numeric,
  ho_approved             numeric,
  is_rejected             boolean NOT NULL DEFAULT false,
  source_editedon         timestamptz,
  added_at                timestamptz,
  synced_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcp_lines_hot_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_arcp_hot_approve_at
  ON arcp_lines_hot (approve_at DESC, office_under)
  WHERE approve_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_arcp_hot_approve_office
  ON arcp_lines_hot (approve_at DESC, nofficeid)
  WHERE approve_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_arcp_hot_call_at
  ON arcp_lines_hot (call_at DESC, ncode DESC);

CREATE INDEX IF NOT EXISTS idx_arcp_hot_solve_at
  ON arcp_lines_hot (solve_at DESC, ncode DESC);

CREATE INDEX IF NOT EXISTS idx_arcp_hot_claim_month_approve
  ON arcp_lines_hot (claim_month_approve, office_under);

COMMENT ON TABLE arcp_lines_hot IS
  'Franchise ARCP claim lines (nofficetype=3). Report filters: call_at, solve_at, bm_approved_at, ho_approved_at (approve_at = COALESCE(ho, bm) legacy).';
