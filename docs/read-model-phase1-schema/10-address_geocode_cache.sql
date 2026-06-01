-- Cached Nominatim geocode results (no API key; rate-limited lookups)
CREATE TABLE IF NOT EXISTS address_geocode_cache (
  address_hash   varchar(64) PRIMARY KEY,
  query_text     text NOT NULL,
  lat            double precision,
  lng            double precision,
  success        boolean NOT NULL DEFAULT false,
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_address_geocode_cache_fetched
  ON address_geocode_cache (fetched_at DESC);

COMMENT ON TABLE address_geocode_cache IS
  'OpenStreetMap Nominatim geocode cache keyed by normalized install address.';
