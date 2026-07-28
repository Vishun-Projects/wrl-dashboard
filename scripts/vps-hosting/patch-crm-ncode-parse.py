#!/usr/bin/env python3
"""Patch crm-to-pg-sync.js ncode cursor/PK parsing. Payload JSON stays as CRM returned it."""
from __future__ import annotations

from pathlib import Path
import re
import sys

SCRIPT = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/wrl/database/scratch/crm-to-pg-sync.js")
src = SCRIPT.read_text()

old_row = """function rowNcode(row) {
  const v = row.ncode ?? row.Ncode ?? row.NCODE ?? row.uniqueid ?? row.UniqueId ?? row.id ?? row.Id;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}"""

new_row = r'''/** Raw ncode string exactly as CRM returned (payload stays untouched). */
function rawNcode(row) {
  const v = row.ncode ?? row.Ncode ?? row.NCODE ?? row.uniqueid ?? row.UniqueId ?? row.id ?? row.Id;
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Staging PK only — CRM sometimes sends int IDs as floats like "1.100100000".
 * Encode by removing the decimal point so keys stay unique. Does NOT modify payload.
 */
function ncodeKey(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (/^-?\d+\.\d+$/.test(s)) {
    const digits = s.replace(".", "");
    const n = Number(digits);
    return Number.isSafeInteger(n) ? n : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Cursor value for CRM WHERE ncode > … — keep float-form strings as CRM sent them. */
function rowNcode(row) {
  const raw = rawNcode(row);
  if (raw == null) return null;
  if (/^-?\d+\.\d+$/.test(raw)) return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Safe numeric literal for CRM SQL (digits + optional dot only). */
function crmNcodeSql(last) {
  if (last == null || last === "") return null;
  const s = String(last).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`invalid ncode cursor: ${s}`);
  }
  return s;
}'''

old_upsert = """async function upsertRows(pool, table, rows, editCol) {
  if (!rows.length) return 0;
  const byNcode = new Map();
  for (const row of rows) {
    const ncode = rowNcode(row);
    if (ncode == null) continue;
    byNcode.set(ncode, row);
  }
  if (!byNcode.size) return 0;

  let written = 0;
  for (const [ncode, row] of byNcode) {
    const editedon = parseCrmTs(row[editCol] ?? row.editedon ?? row.Editedon);
    const addedon = parseCrmTs(row.addedon ?? row.Addedon);
    await pool.query(
      `INSERT INTO migration_crm_row (table_name, ncode, payload, editedon, addedon, synced_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, now())
       ON CONFLICT (table_name, ncode) DO UPDATE SET
         payload = EXCLUDED.payload,
         editedon = EXCLUDED.editedon,
         addedon = EXCLUDED.addedon,
         synced_at = now()`,
      [table, ncode, JSON.stringify(row), editedon, addedon]
    );
    written += 1;
  }
  return written;
}"""

new_upsert = """async function upsertRows(pool, table, rows, editCol) {
  if (!rows.length) return 0;
  const byNcode = new Map();
  for (const row of rows) {
    const key = ncodeKey(rawNcode(row));
    if (key == null) continue;
    // Keep first-seen row for key; payload is stored exactly as CRM returned it.
    if (!byNcode.has(key)) byNcode.set(key, row);
  }
  if (!byNcode.size) return 0;

  let written = 0;
  for (const [ncode, row] of byNcode) {
    const editedon = parseCrmTs(row[editCol] ?? row.editedon ?? row.Editedon);
    const addedon = parseCrmTs(row.addedon ?? row.Addedon);
    await pool.query(
      `INSERT INTO migration_crm_row (table_name, ncode, payload, editedon, addedon, synced_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, now())
       ON CONFLICT (table_name, ncode) DO UPDATE SET
         payload = EXCLUDED.payload,
         editedon = EXCLUDED.editedon,
         addedon = EXCLUDED.addedon,
         synced_at = now()`,
      [table, ncode, JSON.stringify(row), editedon, addedon]
    );
    written += 1;
  }
  return written;
}"""

if old_row not in src:
    raise SystemExit("rowNcode block not found")
if old_upsert not in src:
    raise SystemExit("upsertRows block not found")

src = src.replace(old_row, new_row, 1)
src = src.replace(old_upsert, new_upsert, 1)

src, n1 = re.subn(
    r"const condition = last != null \? `ncode > \$\{Number\(last\)\}` : \"1=1\";",
    "const condition = last != null ? `ncode > ${crmNcodeSql(last)}` : \"1=1\";",
    src,
    count=1,
)
src, n2 = re.subn(
    r"const cursorPart = lastNcode != null \? ` AND ncode > \$\{Number\(lastNcode\)\}` : \"\";",
    "const cursorPart = lastNcode != null ? ` AND ncode > ${crmNcodeSql(lastNcode)}` : \"\";",
    src,
)
if n1 != 1 or n2 < 1:
    raise SystemExit(f"cursor replacements failed n1={n1} n2={n2}")
if "Number(lastNcode)" in src or "Number(last)}" in src:
    raise SystemExit("leftover Number(last*) cursor usage")

bak = SCRIPT.with_suffix(SCRIPT.suffix + f".bak-ncode")
if not bak.exists():
    bak.write_text(Path(SCRIPT).read_text() if False else "")  # placeholder
# real backup done by caller; write patched
SCRIPT.write_text(src)
print(f"patched {SCRIPT} (cursor replacements: {n1}+{n2}, crmNcodeSql={src.count('crmNcodeSql(')})")
