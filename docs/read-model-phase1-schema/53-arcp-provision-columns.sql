-- ARCP Provision: repair type + TAT on claim lines; rate-card hot from mstarcpcccr.
-- Apply after 08-arcp_lines_hot.sql / 10-arcp_call_no.sql.

ALTER TABLE arcp_lines_hot
  ADD COLUMN IF NOT EXISTS nrepairtype varchar(50);

ALTER TABLE arcp_lines_hot
  ADD COLUMN IF NOT EXISTS repair_label varchar(255);

ALTER TABLE arcp_lines_hot
  ADD COLUMN IF NOT EXISTS ntat numeric;

CREATE INDEX IF NOT EXISTS idx_arcp_hot_repairtype
  ON arcp_lines_hot (nofficeid, nitemcategory, nlocalupcountry, nrepairtype)
  WHERE is_rejected = false;

CREATE TABLE IF NOT EXISTS arcp_rate_card_hot (
  ncode                   bigint NOT NULL,
  noffice                 bigint,
  nofficeid               bigint,
  nitemcategory           varchar(50),
  nlocalupcountry         varchar(50),
  nrepairtype             varchar(50),
  ncalltype               varchar(50),
  nclient                 varchar(50),
  ntraveltype             varchar(50),
  ntat_from               numeric,
  ntat_to                 numeric,
  nchargespayable         numeric,
  nchargesreceivable      numeric,
  synced_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcp_rate_card_hot_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_arcp_rate_card_match
  ON arcp_rate_card_hot (nofficeid, nitemcategory, nlocalupcountry, nrepairtype);

-- Join key is branch noffice (not franchisee nofficeid) — required for Provision rate lookup.
CREATE INDEX IF NOT EXISTS idx_arcp_rate_card_noffice_cat_local
  ON arcp_rate_card_hot (noffice, nitemcategory, nlocalupcountry);

COMMENT ON TABLE arcp_rate_card_hot IS
  'CRM mstarcpcccr rate card — per-office ARCP payable/receivable by category, local/upcountry, repair, TAT band.';

COMMENT ON COLUMN arcp_lines_hot.nrepairtype IS
  'CRM trdcalls10ARCP.nrepairtype — rate-card join key (stored; TAT not shown in Provision UI yet).';

COMMENT ON COLUMN arcp_lines_hot.ntat IS
  'CRM trdcalls10ARCP.ntat hours — used to pick rate-card TAT band; not shown in UI yet.';

INSERT INTO sync_state (entity, status)
VALUES ('arcp_rate_card_hot', 'ok')
ON CONFLICT (entity) DO NOTHING;
