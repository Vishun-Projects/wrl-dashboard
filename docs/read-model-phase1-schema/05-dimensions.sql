-- Chunk 5: dimension tables
CREATE TABLE IF NOT EXISTS dim_offices (
  ncode                 bigint NOT NULL,
  vcompanyname          varchar(255),
  nunder                bigint,
  nzone                 bigint,
  is_branch             boolean NOT NULL DEFAULT false,
  region                varchar(100),
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dim_offices_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_dim_offices_nunder ON dim_offices (nunder);
CREATE INDEX IF NOT EXISTS idx_dim_offices_name ON dim_offices (vcompanyname);

CREATE TABLE IF NOT EXISTS dim_engineers (
  ncode                 bigint NOT NULL,
  vname                 varchar(255) NOT NULL,
  nofficeid             bigint,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dim_engineers_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_dim_engineers_office ON dim_engineers (nofficeid);
CREATE INDEX IF NOT EXISTS idx_dim_engineers_name ON dim_engineers (vname);

CREATE TABLE IF NOT EXISTS dim_call_types (
  ncode                 bigint NOT NULL,
  display_value         varchar(100) NOT NULL,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dim_call_types_pkey PRIMARY KEY (ncode)
);

CREATE INDEX IF NOT EXISTS idx_dim_call_types_display ON dim_call_types (display_value);
