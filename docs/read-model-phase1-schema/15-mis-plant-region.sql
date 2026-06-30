-- Plant / office → BD MIS regional zone (from Format.xlsx Code sheet).
CREATE TABLE IF NOT EXISTS mis_plant_region_mappings (
  office_id   bigint PRIMARY KEY,
  region_zone text NOT NULL CHECK (region_zone IN ('NORTH ZONE', 'EAST ZONE', 'WEST ZONE', 'SOUTH ZONE'))
);

COMMENT ON TABLE mis_plant_region_mappings IS
  'BD MIS Excel uses Plant/office codes for regional rollup; overrides CRM branch region when present.';
