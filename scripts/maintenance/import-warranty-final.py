#!/usr/bin/env python3
"""
Stream 2022-2025 FINAL.xlsx into warranty_master_items (merge, later-end wins).
No truncate. New schema (no fg_model / product_subgroup / city / sheet_year).

  python scripts/maintenance/import-warranty-final.py
  python scripts/maintenance/import-warranty-final.py --merge-only
"""
import csv
import io
import math
import os
import re
import sys
import time
import zipfile
from datetime import date, datetime, timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
EXCEL = os.path.join(ROOT, "2022 to 2025 FINAL.xlsx")
STAGING = "public.warranty_master_final_staging"


def get_database_url():
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    for name in (".env.local", ".env"):
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and line.startswith("DATABASE_URL="):
                    val = line.split("=", 1)[1].strip()
                    if (val.startswith('"') and val.endswith('"')) or (
                        val.startswith("'") and val.endswith("'")
                    ):
                        val = val[1:-1]
                    return val
    return None


def parse_date_str(s):
    if not s:
        return None
    s = str(s).strip()
    if len(s) >= 10 and s[2] == "." and s[5] == ".":
        try:
            dd, mm, yyyy = int(s[0:2]), int(s[3:5]), int(s[6:10])
            if 1 <= dd <= 31 and 1 <= mm <= 12 and 1990 <= yyyy <= 2100:
                return f"{yyyy:04d}-{mm:02d}-{dd:02d}"
        except Exception:
            return None
        return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            yyyy, mm, dd = int(s[0:4]), int(s[5:7]), int(s[8:10])
            if 1 <= dd <= 31 and 1 <= mm <= 12 and 1990 <= yyyy <= 2100:
                return f"{yyyy:04d}-{mm:02d}-{dd:02d}"
        except Exception:
            return None
    try:
        serial = float(s)
        if 30000 < serial < 70000:
            d = date(1899, 12, 30) + timedelta(days=int(serial))
            if 1990 <= d.year <= 2100:
                return d.isoformat()
    except Exception:
        pass
    return None


def calc_warranty_months(start_str, end_str):
    """Inclusive end+1 day, snap up to 6-month step (same as app import)."""
    if not start_str or not end_str:
        return 0
    try:
        d1 = datetime.strptime(start_str, "%Y-%m-%d").date()
        d2 = datetime.strptime(end_str, "%Y-%m-%d").date()
        nxt = d2 + timedelta(days=1)
        months = (nxt.year - d1.year) * 12 + (nxt.month - d1.month)
        if nxt.day < d1.day:
            months -= 1
        if months <= 0:
            return 0
        return int(math.ceil(months / 6.0) * 6)
    except Exception:
        return 0


def cell_text(raw):
    t = (raw or "").strip()
    return t or None


MERGE_BATCHES = 32
MERGE_ONLY = "--merge-only" in sys.argv

MERGE_SQL = f"""
INSERT INTO public.warranty_master_items (
  serial_no, billing_doc, billing_date, material, group_name, material_group,
  customer_name, customer_subgroup, ship_to_party, ship_to_state,
  ship_to_city, inventory_number, warr_start_dt, warr_end_dt, pin_code,
  warranty_months, is_active
)
SELECT
  serial_no, billing_doc, billing_date, material, group_name, material_group,
  customer_name, customer_subgroup, ship_to_party, ship_to_state,
  ship_to_city, inventory_number, warr_start_dt, warr_end_dt, pin_code,
  warranty_months, is_active
FROM (
  SELECT DISTINCT ON (serial_no) *
  FROM {STAGING}
  WHERE MOD(ABS(HASHTEXT(serial_no)), %s) = %s
  ORDER BY serial_no, warr_end_dt DESC NULLS LAST, billing_date DESC NULLS LAST
) s
ON CONFLICT (serial_no) DO UPDATE SET
  billing_doc = COALESCE(EXCLUDED.billing_doc, warranty_master_items.billing_doc),
  billing_date = COALESCE(EXCLUDED.billing_date, warranty_master_items.billing_date),
  material = COALESCE(EXCLUDED.material, warranty_master_items.material),
  group_name = COALESCE(EXCLUDED.group_name, warranty_master_items.group_name),
  material_group = COALESCE(EXCLUDED.material_group, warranty_master_items.material_group),
  customer_name = COALESCE(EXCLUDED.customer_name, warranty_master_items.customer_name),
  customer_subgroup = COALESCE(EXCLUDED.customer_subgroup, warranty_master_items.customer_subgroup),
  ship_to_party = COALESCE(EXCLUDED.ship_to_party, warranty_master_items.ship_to_party),
  ship_to_state = COALESCE(EXCLUDED.ship_to_state, warranty_master_items.ship_to_state),
  ship_to_city = COALESCE(EXCLUDED.ship_to_city, warranty_master_items.ship_to_city),
  inventory_number = COALESCE(EXCLUDED.inventory_number, warranty_master_items.inventory_number),
  warr_start_dt = COALESCE(EXCLUDED.warr_start_dt, warranty_master_items.warr_start_dt),
  warr_end_dt = COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt),
  pin_code = COALESCE(EXCLUDED.pin_code, warranty_master_items.pin_code),
  warranty_months = EXCLUDED.warranty_months,
  is_active = (COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt) IS NOT NULL
    AND COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt) >= CURRENT_DATE),
  imported_at = NOW()
WHERE
  (warranty_master_items.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NOT NULL)
  OR (warranty_master_items.warr_end_dt IS NOT NULL AND EXCLUDED.warr_end_dt IS NOT NULL
      AND EXCLUDED.warr_end_dt >= warranty_master_items.warr_end_dt)
  OR (warranty_master_items.warr_end_dt IS NULL AND EXCLUDED.warr_end_dt IS NULL)
"""


def rebuild_rollup(cursor):
    print("  rebuilding rollup...")
    cursor.execute("DROP TABLE IF EXISTS public.warranty_master_rollup CASCADE")
    cursor.execute("DROP TYPE IF EXISTS public.warranty_master_rollup CASCADE")
    cursor.execute(
        """
        CREATE TABLE public.warranty_master_rollup (
          subgroup_key text NOT NULL,
          subgroup_label text NOT NULL,
          group_key text NOT NULL,
          group_label text NOT NULL,
          warranty_months smallint NOT NULL,
          material text NOT NULL,
          machine_count integer NOT NULL,
          active_machine_count integer NOT NULL,
          min_warr_end date,
          max_warr_end date,
          PRIMARY KEY (subgroup_key, group_key, warranty_months, material)
        )
        """
    )
    cursor.execute(
        """
        INSERT INTO public.warranty_master_rollup (
          subgroup_key, subgroup_label, group_key, group_label,
          warranty_months, material, machine_count, active_machine_count,
          min_warr_end, max_warr_end
        )
        SELECT
          LOWER(COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')),
          MODE() WITHIN GROUP (ORDER BY COALESCE(NULLIF(BTRIM(customer_subgroup), ''), '(Unknown)')),
          LOWER(COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')),
          MODE() WITHIN GROUP (ORDER BY COALESCE(NULLIF(BTRIM(group_name), ''), '(Unknown)')),
          COALESCE(warranty_months, 0),
          LOWER(COALESCE(NULLIF(BTRIM(material), ''), '(Unknown)')),
          COUNT(*)::int,
          SUM(CASE WHEN warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE THEN 1 ELSE 0 END)::int,
          MIN(warr_end_dt),
          MAX(warr_end_dt)
        FROM public.warranty_master_items
        GROUP BY 1, 3, 5, 6
        """
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_wm_rollup_subgroup ON public.warranty_master_rollup (subgroup_key)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_wm_rollup_group ON public.warranty_master_rollup (group_key)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_wm_rollup_material ON public.warranty_master_rollup (material)"
    )
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_wm_rollup_months ON public.warranty_master_rollup (warranty_months)"
    )


def merge_into_live(cursor):
    cursor.execute("SET statement_timeout = 0")
    cursor.execute("SET idle_in_transaction_session_timeout = 0")
    cursor.execute(f"SELECT COUNT(*) FROM {STAGING}")
    staged = cursor.fetchone()[0]
    print(f"  staging rows: {staged:,}")
    if staged <= 0:
        raise SystemExit("Staging is empty — aborting merge")
    print("  indexing staging serial_no...")
    t_idx = time.time()
    cursor.execute(
        f"CREATE INDEX IF NOT EXISTS warranty_master_final_staging_serial_idx ON {STAGING} (serial_no)"
    )
    print(f"  index ready in {time.time() - t_idx:.1f}s")
    t_up = time.time()
    for i in range(MERGE_BATCHES):
        t_b = time.time()
        print(f"  merge batch {i + 1}/{MERGE_BATCHES}...", flush=True)
        cursor.execute(MERGE_SQL, (MERGE_BATCHES, i))
        print(f"    done in {time.time() - t_b:.1f}s")
    print(f"  all batches done in {time.time() - t_up:.1f}s")
    print("  refreshing is_active...")
    cursor.execute(
        """
        UPDATE public.warranty_master_items
        SET is_active = (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
        WHERE is_active IS DISTINCT FROM (warr_end_dt IS NOT NULL AND warr_end_dt >= CURRENT_DATE)
        """
    )
    cursor.execute(f"DROP TABLE IF EXISTS {STAGING}")
    rebuild_rollup(cursor)
    cursor.execute("SELECT COUNT(*) FROM public.warranty_master_items")
    live = cursor.fetchone()[0]
    return live


raw_url = get_database_url()
if not raw_url:
    print("Error: DATABASE_URL not found in environment or .env.local")
    sys.exit(1)
if not MERGE_ONLY and not os.path.exists(EXCEL):
    print(f"Error: {EXCEL} not found")
    sys.exit(1)

parsed = urlparse(raw_url)
valid_params = {
    k: v for k, v in parse_qsl(parsed.query) if k.lower() not in ("pgbouncer", "connection_limit")
}
db_url = urlunparse(parsed._replace(query=urlencode(valid_params)))

conn = psycopg2.connect(db_url)
conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
cursor = conn.cursor()
cursor.execute("SET statement_timeout = 0")
cursor.execute("SET idle_in_transaction_session_timeout = 0")
cursor.execute("SET synchronous_commit = off")

print("==========================================================")
print("  FINAL.xlsx stream MERGE -> warranty_master_items (no truncate)")
print("==========================================================")
if MERGE_ONLY:
    print("Mode: --merge-only (reuse existing staging, skip Excel)")
else:
    print(f"File: {EXCEL}  ({os.path.getsize(EXCEL) / 1024 / 1024:.1f} MB)")

t0 = time.time()
if MERGE_ONLY:
    cursor.execute("SELECT to_regclass('public.warranty_master_final_staging')")
    if not cursor.fetchone()[0]:
        print("Error: staging table not found. Re-run without --merge-only.")
        sys.exit(1)
    print("\n[4/4] Merging existing staging into live...")
    live = merge_into_live(cursor)
    print("\n==========================================================")
    print(f"  Live warranty_master_items: {live:,}")
    print(f"  Total time: {(time.time() - t0) / 60:.1f} min")
    print("==========================================================")
    cursor.close()
    conn.close()
    sys.exit(0)

print("\n[1/4] Reading shared strings (heartbeat every few seconds)...")
with zipfile.ZipFile(EXCEL) as z:
    raw_ss = z.read("xl/sharedStrings.xml")
print(f"  sharedStrings.xml {len(raw_ss) / 1024 / 1024:.1f} MB — splitting...")
sis = raw_ss.split(b"</si>")
strings = []
last_beat = time.time()
for i, si in enumerate(sis[:-1]):
    start = si.find(b"<t")
    if start == -1:
        strings.append("")
        continue
    val_start = si.find(b">", start) + 1
    val_end = si.find(b"</t>", val_start)
    strings.append(si[val_start:val_end].decode("utf-8", errors="replace") if val_end != -1 else "")
    if time.time() - last_beat >= 3:
        print(f"  ... {i + 1:,} / {len(sis) - 1:,} strings")
        last_beat = time.time()
print(f"  loaded {len(strings):,} strings in {time.time() - t0:.1f}s")

print("\n[2/4] Creating staging table...")
cursor.execute(f"DROP TABLE IF EXISTS {STAGING}")
cursor.execute(
    f"""
CREATE UNLOGGED TABLE {STAGING} (
  serial_no VARCHAR(100),
  billing_doc VARCHAR(100),
  billing_date DATE,
  material VARCHAR(100),
  group_name VARCHAR(100),
  material_group VARCHAR(100),
  customer_name VARCHAR(255),
  customer_subgroup VARCHAR(100),
  ship_to_party VARCHAR(255),
  ship_to_state VARCHAR(100),
  ship_to_city VARCHAR(100),
  inventory_number VARCHAR(100),
  warr_start_dt DATE,
  warr_end_dt DATE,
  pin_code VARCHAR(50),
  warranty_months SMALLINT,
  is_active BOOLEAN
)
"""
)
print("  staging ready")

sheets = [
    ("sheet1.xml", 2022),
    ("sheet2.xml", 2023),
    ("sheet3.xml", 2024),
    ("sheet4.xml", 2025),
]
col_map = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOP")}
cell_regex = re.compile(rb'<c\s+r="([A-P])[0-9]+"(.*?)(?:><v>([^<]*)</v>|</c>)')
row_split_regex = re.compile(rb"<row[^>]*>(.*?)</row>")
today = date.today()
COPY_SQL = f"""
COPY {STAGING} (
  serial_no, billing_doc, billing_date, material,
  group_name, material_group, customer_name,
  customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
  inventory_number, warr_start_dt, warr_end_dt, pin_code,
  warranty_months, is_active
) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '')
"""

print("\n[3/4] Streaming year sheets...")
total_staged = 0

for sheet_file, year in sheets:
    sheet_start = time.time()
    print(f"\n  Sheet {year} ({sheet_file}) — opening zip stream...")
    with zipfile.ZipFile(EXCEL) as z:
        with z.open(f"xl/worksheets/{sheet_file}") as f:
            csv_buffer = io.StringIO()
            csv_writer = csv.writer(
                csv_buffer, delimiter="\t", quoting=csv.QUOTE_MINIMAL, lineterminator="\n"
            )
            chunk_size = 32 * 1024 * 1024
            tail = b""
            sheet_rows = 0
            is_first_row = True

            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    if not tail:
                        break
                    data = tail
                    tail = b""
                else:
                    data = tail + chunk

                last_row_end = data.rfind(b"</row>")
                if last_row_end == -1:
                    if not chunk:
                        break
                    tail = data
                    continue

                rows_data = data[: last_row_end + 6]
                tail = data[last_row_end + 6 :]

                for r_match in row_split_regex.finditer(rows_data):
                    if is_first_row:
                        is_first_row = False
                        continue
                    row_xml = r_match.group(1)
                    vals = [""] * 16
                    for c in cell_regex.finditer(row_xml):
                        col = c.group(1).decode("ascii")
                        attrs = c.group(2)
                        v = c.group(3)
                        if not v:
                            continue
                        v_str = v.decode("ascii", errors="ignore")
                        if b't="s"' in attrs and v_str.isdigit():
                            idx = int(v_str)
                            if idx < len(strings):
                                vals[col_map[col]] = strings[idx].strip()
                        else:
                            vals[col_map[col]] = v_str.strip()

                    serial_no = vals[3]
                    if not serial_no:
                        continue

                    warr_start_dt = parse_date_str(vals[12])
                    warr_end_dt = parse_date_str(vals[13])
                    is_active = False
                    if warr_end_dt:
                        try:
                            is_active = datetime.strptime(warr_end_dt, "%Y-%m-%d").date() >= today
                        except Exception:
                            is_active = False

                    # FINAL layout A–P: bill, date, material, serial, group, colF, cust, subgrp,
                    # ship, state, city, inv, warrStart, warrEnd, city2, pin
                    csv_writer.writerow(
                        [
                            serial_no,
                            cell_text(vals[0]) or "",
                            parse_date_str(vals[1]) or "",
                            cell_text(vals[2]) or "",
                            cell_text(vals[4]) or "",
                            cell_text(vals[5]) or "",
                            cell_text(vals[6]) or "",
                            cell_text(vals[7]) or "",
                            cell_text(vals[8]) or "",
                            cell_text(vals[9]) or "",
                            cell_text(vals[10]) or "",
                            cell_text(vals[11]) or "",
                            warr_start_dt or "",
                            warr_end_dt or "",
                            cell_text(vals[15]) or cell_text(vals[14]) or "",
                            calc_warranty_months(warr_start_dt, warr_end_dt),
                            "t" if is_active else "f",
                        ]
                    )
                    sheet_rows += 1
                    if sheet_rows % 25000 == 0:
                        csv_buffer.seek(0)
                        cursor.copy_expert(COPY_SQL, csv_buffer)
                        csv_buffer = io.StringIO()
                        csv_writer = csv.writer(
                            csv_buffer, delimiter="\t", quoting=csv.QUOTE_MINIMAL, lineterminator="\n"
                        )
                        elapsed = time.time() - sheet_start
                        rate = int(sheet_rows / elapsed) if elapsed > 0 else 0
                        print(f"    [{year}] {sheet_rows:,} rows  {rate:,} rows/s  {elapsed:.0f}s")

            if csv_buffer.tell() > 0:
                csv_buffer.seek(0)
                cursor.copy_expert(COPY_SQL, csv_buffer)

    total_staged += sheet_rows
    print(f"  Sheet {year} done: {sheet_rows:,} rows in {time.time() - sheet_start:.1f}s")

print(f"\n  Staged {total_staged:,} rows from FINAL")

print("\n[4/4] Merging into live warranty_master_items (32 batches, later end wins)...")
live = merge_into_live(cursor)

print("\n==========================================================")
print(f"  Live warranty_master_items: {live:,}")
print(f"  Total time: {(time.time() - t0) / 60:.1f} min")
print("==========================================================")

cursor.close()
conn.close()
