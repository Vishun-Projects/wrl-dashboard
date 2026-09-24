#!/usr/bin/env python3
"""
Stream 2022-2025 FINAL.xlsx into warranty_master_items (merge, later-end wins).
Prints progress so a 196 MB file does not look stuck.

  python scripts/maintenance/import-warranty-final.py
  node scripts/maintenance/reimport-warranty-master.mjs --final
"""
import csv
import io
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
                    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                        val = val[1:-1]
                    return val
    return None


def excel_serial_to_date(n):
    try:
        serial = float(n)
    except (TypeError, ValueError):
        return None
    if serial <= 30000 or serial >= 70000:
        return None
    d = date(1899, 12, 30) + timedelta(days=int(serial))
    if d.year < 1990 or d.year > 2100:
        return None
    return d.isoformat()


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
    return excel_serial_to_date(s)


def calc_warranty_months(start_str, end_str):
    if not start_str or not end_str:
        return 0
    try:
        d1 = datetime.strptime(start_str, "%Y-%m-%d").date()
        d2 = datetime.strptime(end_str, "%Y-%m-%d").date()
        months = (d2.year - d1.year) * 12 + (d2.month - d1.month)
        if d2.day < d1.day:
            months -= 1
        return months if months > 0 else 0
    except Exception:
        return 0


def remap_subgroup(raw):
    t = (raw or "").strip()
    return "Pepsi-Bott" if t.lower() == "pepsi" else t


def clean_customer_name(raw):
    t = (raw or "").strip()
    if not t or t.isdigit() or t == "(Unknown)":
        return ""
    return t


MERGE_BATCHES = 32
MERGE_ONLY = "--merge-only" in sys.argv

MERGE_SQL = f"""
INSERT INTO public.warranty_master_items (
  serial_no, billing_doc, billing_date, fg_model, material, group_name, material_group,
  product_subgroup, customer_name, customer_subgroup, ship_to_party, ship_to_state,
  ship_to_city, inventory_number, warr_start_dt, warr_end_dt, city, pin_code,
  sheet_year, warranty_months, is_active
)
SELECT
  serial_no, billing_doc, billing_date, fg_model, material, group_name, material_group,
  product_subgroup, customer_name, customer_subgroup, ship_to_party, ship_to_state,
  ship_to_city, inventory_number, warr_start_dt, warr_end_dt, city, pin_code,
  sheet_year, warranty_months, is_active
FROM (
  SELECT DISTINCT ON (serial_no) *
  FROM {STAGING}
  WHERE MOD(ABS(HASHTEXT(serial_no)), %s) = %s
  ORDER BY serial_no, sheet_year DESC, billing_date DESC NULLS LAST
) s
ON CONFLICT (serial_no) DO UPDATE SET
  billing_doc = COALESCE(NULLIF(EXCLUDED.billing_doc, ''), warranty_master_items.billing_doc),
  billing_date = COALESCE(EXCLUDED.billing_date, warranty_master_items.billing_date),
  fg_model = COALESCE(NULLIF(EXCLUDED.fg_model, ''), NULLIF(EXCLUDED.fg_model, '(Unknown)'), warranty_master_items.fg_model),
  material = COALESCE(NULLIF(EXCLUDED.material, ''), NULLIF(EXCLUDED.material, '(Unknown)'), warranty_master_items.material),
  group_name = COALESCE(NULLIF(EXCLUDED.group_name, ''), NULLIF(EXCLUDED.group_name, '(Unknown)'), warranty_master_items.group_name),
  material_group = COALESCE(NULLIF(EXCLUDED.material_group, ''), NULLIF(EXCLUDED.material_group, '(Unknown)'), warranty_master_items.material_group),
  product_subgroup = COALESCE(NULLIF(EXCLUDED.product_subgroup, ''), warranty_master_items.product_subgroup),
  customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), NULLIF(EXCLUDED.customer_name, '(Unknown)'), warranty_master_items.customer_name),
  customer_subgroup = COALESCE(NULLIF(EXCLUDED.customer_subgroup, ''), warranty_master_items.customer_subgroup),
  ship_to_party = COALESCE(NULLIF(EXCLUDED.ship_to_party, ''), warranty_master_items.ship_to_party),
  ship_to_state = COALESCE(NULLIF(EXCLUDED.ship_to_state, ''), warranty_master_items.ship_to_state),
  ship_to_city = COALESCE(NULLIF(EXCLUDED.ship_to_city, ''), warranty_master_items.ship_to_city),
  inventory_number = COALESCE(NULLIF(EXCLUDED.inventory_number, ''), warranty_master_items.inventory_number),
  warr_start_dt = COALESCE(EXCLUDED.warr_start_dt, warranty_master_items.warr_start_dt),
  warr_end_dt = COALESCE(EXCLUDED.warr_end_dt, warranty_master_items.warr_end_dt),
  city = COALESCE(NULLIF(EXCLUDED.city, ''), warranty_master_items.city),
  pin_code = COALESCE(NULLIF(EXCLUDED.pin_code, ''), warranty_master_items.pin_code),
  sheet_year = COALESCE(EXCLUDED.sheet_year, warranty_master_items.sheet_year),
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
    cursor.execute("SELECT COUNT(*) FROM public.warranty_master_items")
    live = cursor.fetchone()[0]
    cursor.execute(
        "SELECT COUNT(*) FROM public.warranty_master_items WHERE customer_subgroup = 'Pepsi-Bott'"
    )
    pepsi_bott = cursor.fetchone()[0]
    return live, pepsi_bott


raw_url = get_database_url()
if not raw_url:
    print("Error: DATABASE_URL not found in environment or .env.local")
    sys.exit(1)
if not MERGE_ONLY and not os.path.exists(EXCEL):
    print(f"Error: {EXCEL} not found")
    sys.exit(1)

parsed = urlparse(raw_url)
valid_params = {k: v for k, v in parse_qsl(parsed.query) if k.lower() not in ("pgbouncer", "connection_limit")}
db_url = urlunparse(parsed._replace(query=urlencode(valid_params)))

conn = psycopg2.connect(db_url)
conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
cursor = conn.cursor()
cursor.execute("SET statement_timeout = 0")
cursor.execute("SET idle_in_transaction_session_timeout = 0")

print("==========================================================")
print("  FINAL.xlsx stream merge → warranty_master_items")
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
    live, pepsi_bott = merge_into_live(cursor)
    print("\n==========================================================")
    print(f"  Live warranty_master_items: {live:,}")
    print(f"  Pepsi-Bott: {pepsi_bott:,}")
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
cursor.execute(f"""
CREATE UNLOGGED TABLE {STAGING} (
  serial_no VARCHAR(100),
  billing_doc VARCHAR(100),
  billing_date DATE,
  fg_model VARCHAR(100),
  material VARCHAR(100),
  group_name VARCHAR(100),
  material_group VARCHAR(100),
  product_subgroup VARCHAR(100),
  customer_name VARCHAR(255),
  customer_subgroup VARCHAR(100),
  ship_to_party VARCHAR(255),
  ship_to_state VARCHAR(100),
  ship_to_city VARCHAR(100),
  inventory_number VARCHAR(100),
  warr_start_dt DATE,
  warr_end_dt DATE,
  city VARCHAR(100),
  pin_code VARCHAR(50),
  sheet_year SMALLINT,
  warranty_months SMALLINT,
  is_active BOOLEAN
)
""")
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
  serial_no, billing_doc, billing_date, fg_model, material,
  group_name, material_group, product_subgroup, customer_name,
  customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
  inventory_number, warr_start_dt, warr_end_dt, city, pin_code,
  sheet_year, warranty_months, is_active
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
            csv_writer = csv.writer(csv_buffer, delimiter="\t", quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
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

                    csv_writer.writerow(
                        [
                            serial_no,
                            vals[0] or "",
                            parse_date_str(vals[1]) or "",
                            vals[2] or "",
                            vals[2] or "",
                            vals[4] or "",
                            vals[4] or "",
                            vals[5] or "",
                            clean_customer_name(vals[6]),
                            remap_subgroup(vals[7]),
                            vals[8] or "",
                            vals[9] or "",
                            vals[10] or "",
                            vals[11] or "",
                            warr_start_dt or "",
                            warr_end_dt or "",
                            vals[14] or "",
                            vals[15] or "",
                            year,
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
live, pepsi_bott = merge_into_live(cursor)

print("\n==========================================================")
print(f"  Live warranty_master_items: {live:,}")
print(f"  Pepsi-Bott: {pepsi_bott:,}")
print(f"  Total time: {(time.time() - t0) / 60:.1f} min")
print("==========================================================")

cursor.close()
conn.close()
