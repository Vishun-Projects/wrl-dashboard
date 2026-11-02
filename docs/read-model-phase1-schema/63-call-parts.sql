-- Chunk 63: call_parts report indexes (table created by call-visits sync ensureCallPartsTable)

CREATE INDEX IF NOT EXISTS idx_call_parts_call_no ON call_parts (call_no);
CREATE INDEX IF NOT EXISTS idx_call_parts_office ON call_parts (nofficeid);
CREATE INDEX IF NOT EXISTS idx_call_parts_editedon ON call_parts (editedon);
CREATE INDEX IF NOT EXISTS idx_call_parts_part_name
  ON call_parts (upper(btrim(part_name)))
  WHERE coalesce(btrim(part_name), '') <> '';
CREATE INDEX IF NOT EXISTS idx_call_parts_office_under
  ON call_parts (office_under)
  WHERE coalesce(btrim(office_under), '') <> '';
CREATE INDEX IF NOT EXISTS idx_call_parts_part_code
  ON call_parts (upper(btrim(part_code)))
  WHERE coalesce(btrim(part_code), '') <> '';
CREATE INDEX IF NOT EXISTS idx_call_parts_visit_at
  ON call_parts (visit_at DESC NULLS LAST)
  WHERE visit_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_parts_call_no_part
  ON call_parts (call_no, part_name, ncode);
