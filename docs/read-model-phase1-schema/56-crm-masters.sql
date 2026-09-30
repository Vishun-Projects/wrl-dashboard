-- Chunk 56: CRM masters mirrored to Postgres (nightly). Rarely change; avoid live/old_crm hits on report load.
CREATE TABLE IF NOT EXISTS crm_mstitemcategory (
  ncode                 text NOT NULL,
  vname                 text,
  vshortname            text,
  bactive               boolean NOT NULL DEFAULT true,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_mstitemcategory_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_crm_mstitemcategory_vname
  ON crm_mstitemcategory (vname);

CREATE TABLE IF NOT EXISTS crm_mstrepair (
  ncode                 text NOT NULL,
  vname                 text,
  vshortname            text,
  bactive               boolean NOT NULL DEFAULT true,
  bmajor                boolean NOT NULL DEFAULT false,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_mstrepair_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_crm_mstrepair_vname
  ON crm_mstrepair (vname);

CREATE TABLE IF NOT EXISTS crm_mstitems (
  ncode                 text NOT NULL,
  vitemcode             text,
  norm_vitemcode        text,
  vname                 text,
  nitemtype             text,
  nitemcategory         text,
  bactive               boolean NOT NULL DEFAULT true,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_mstitems_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_crm_mstitems_norm_vitemcode
  ON crm_mstitems (norm_vitemcode);

CREATE INDEX IF NOT EXISTS idx_crm_mstitems_nitemcategory
  ON crm_mstitems (nitemcategory);

INSERT INTO sync_state (entity, last_editedon, last_addedon, status) VALUES
  ('crm_mstitemcategory', NULL, NULL, 'pending_backfill'),
  ('crm_mstrepair', NULL, NULL, 'pending_backfill'),
  ('crm_mstitems', NULL, NULL, 'pending_backfill')
ON CONFLICT (entity) DO NOTHING;
