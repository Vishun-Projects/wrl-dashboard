#!/usr/bin/env python3
"""
Fill billing_date only where it is NULL, from FINAL.xlsx 2025 sheet (Excel serials).
Does not change any other column or any row that already has a date.

  python scripts/maintenance/fix-missing-billing-dates.py
"""
import os
import re
import sys
import time
import zipfile
from datetime import date, timedelta
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

import psycopg2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
EXCEL = os.path.join(ROOT, "2022 to 2025 FINAL.xlsx")


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


raw_url = get_database_url()
if not raw_url:
    print("Error: DATABASE_URL not found")
    sys.exit(1)
if not os.path.exists(EXCEL):
    print(f"Error: {EXCEL} not found")
    sys.exit(1)

parsed = urlparse(raw_url)
valid_params = {k: v for k, v in parse_qsl(parsed.query) if k.lower() not in ("pgbouncer", "connection_limit")}
db_url = urlunparse(parsed._replace(query=urlencode(valid_params)))

print("Fill missing billing_date from FINAL.xlsx sheet 2025 only")
print("Existing dates are not overwritten.\n")

t0 = time.time()
print("[1/3] Reading shared strings...")
with zipfile.ZipFile(EXCEL) as z:
    raw_ss = z.read("xl/sharedStrings.xml")
sis = raw_ss.split(b"</si>")
strings = []
for si in sis[:-1]:
    start = si.find(b"<t")
    if start == -1:
        strings.append("")
        continue
    val_start = si.find(b">", start) + 1
    val_end = si.find(b"</t>", val_start)
    strings.append(si[val_start:val_end].decode("utf-8", errors="replace") if val_end != -1 else "")
print(f"  {len(strings):,} strings in {time.time() - t0:.1f}s")

cell_regex = re.compile(rb'<c\s+r="([A-P])[0-9]+"(.*?)(?:><v>([^<]*)</v>|</c>)')
row_split_regex = re.compile(rb"<row[^>]*>(.*?)</row>")
col_map = {c: i for i, c in enumerate("ABCDEFGHIJKLMNOP")}

print("[2/3] Streaming 2025 sheet (serial + billing date only)...")
serial_dates = {}
sheet_start = time.time()
parsed_n = 0
with zipfile.ZipFile(EXCEL) as z:
    with z.open("xl/worksheets/sheet4.xml") as f:
        chunk_size = 32 * 1024 * 1024
        tail = b""
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
                vals = ["", "", "", ""]
                for c in cell_regex.finditer(row_xml):
                    col = c.group(1).decode("ascii")
                    if col not in ("B", "D"):
                        continue
                    attrs, v = c.group(2), c.group(3)
                    if not v:
                        continue
                    v_str = v.decode("ascii", errors="ignore")
                    if b't="s"' in attrs and v_str.isdigit():
                        idx = int(v_str)
                        val = strings[idx].strip() if idx < len(strings) else ""
                    else:
                        val = v_str.strip()
                    vals[col_map[col]] = val
                serial = vals[3]
                billing_date = parse_date_str(vals[1])
                if not serial or not billing_date:
                    continue
                prev = serial_dates.get(serial)
                if not prev or billing_date >= prev:
                    serial_dates[serial] = billing_date
                parsed_n += 1
                if parsed_n % 100000 == 0:
                    print(f"  scanned {parsed_n:,} dated rows  unique {len(serial_dates):,}  {time.time() - sheet_start:.0f}s")

print(f"  unique serials with a date: {len(serial_dates):,} in {time.time() - sheet_start:.1f}s")

print("[3/3] Updating rows where billing_date IS NULL...")
from psycopg2.extras import execute_values

conn = psycopg2.connect(db_url)
conn.autocommit = False
cur = conn.cursor()
cur.execute("SET LOCAL statement_timeout = 0")
cur.execute("SET LOCAL idle_in_transaction_session_timeout = 0")
cur.execute(
    """
    CREATE TEMP TABLE _fix_bill_dt (
      serial_no TEXT PRIMARY KEY,
      billing_date DATE NOT NULL
    )
    """
)

rows = list(serial_dates.items())
CHUNK = 2000
for i in range(0, len(rows), CHUNK):
    execute_values(
        cur,
        "INSERT INTO _fix_bill_dt (serial_no, billing_date) VALUES %s ON CONFLICT (serial_no) DO UPDATE SET billing_date = EXCLUDED.billing_date",
        [(s, d) for s, d in rows[i : i + CHUNK]],
    )
    if (i // CHUNK) % 20 == 0:
        print(f"  loaded {min(i + CHUNK, len(rows)):,} / {len(rows):,} into temp")

print("  running UPDATE (null dates only)...")
t_up = time.time()
cur.execute(
    """
    UPDATE public.warranty_master_items w
    SET billing_date = f.billing_date
    FROM _fix_bill_dt f
    WHERE UPPER(w.serial_no) = UPPER(f.serial_no)
      AND w.billing_date IS NULL
    """
)
updated = cur.rowcount
cur.execute(
    """
    SELECT COUNT(*) FROM public.warranty_master_items
    WHERE NULLIF(TRIM(billing_doc), '') IS NOT NULL AND billing_date IS NULL
    """
)
still = cur.fetchone()[0]
conn.commit()
print(f"  updated {updated:,} rows in {time.time() - t_up:.1f}s")
print(f"  invoices still missing a date: {still:,}")
print(f"Done in {(time.time() - t0) / 60:.1f} min")
cur.close()
conn.close()
