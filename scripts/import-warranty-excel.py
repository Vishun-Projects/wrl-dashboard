#!/usr/bin/env python3
import os
import sys
import time
import zipfile
import re
import io
import csv
from datetime import datetime, date
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass

# Load .env.local or .env
def get_database_url():
    url = os.environ.get('DATABASE_URL')
    if url:
        return url
    for name in ['.env.local', '.env']:
        if os.path.exists(name):
            with open(name, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and 'DATABASE_URL=' in line:
                        val = line.split('DATABASE_URL=', 1)[1].strip()
                        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                            val = val[1:-1]
                        return val
    return None

from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

raw_url = get_database_url()
if not raw_url:
    print("Error: DATABASE_URL not found in environment or .env.local")
    sys.exit(1)

# Clean query params not recognized by libpq / psycopg2
parsed = urlparse(raw_url)
valid_params = {}
for k, v in parse_qsl(parsed.query):
    if k.lower() not in ['pgbouncer', 'connection_limit']:
        valid_params[k] = v
db_url = urlunparse(parsed._replace(query=urlencode(valid_params)))

excel_file = '2022 to 2025 FINAL.xlsx'
if not os.path.exists(excel_file):
    print(f"Error: {excel_file} not found")
    sys.exit(1)

conn = psycopg2.connect(db_url)
conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
cursor = conn.cursor()

print("==========================================================")
print("  Warranty Master: High-Speed Excel Importer (2022-2025)  ")
print("==========================================================")

# Step 1: Create staging table
print("\n[Step 1/4] Preparing PostgreSQL staging table...")
cursor.execute("""
DROP TABLE IF EXISTS public.warranty_master_staging;
CREATE UNLOGGED TABLE public.warranty_master_staging (
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
);
""")
print("Staging table created.")

# Step 2: Read shared strings
print("\n[Step 2/4] Reading shared strings from Excel...")
t0 = time.time()
with zipfile.ZipFile(excel_file) as z:
    raw_ss = z.read('xl/sharedStrings.xml')
    sis = raw_ss.split(b'</si>')
    strings = []
    for si in sis[:-1]:
        start = si.find(b'<t')
        if start == -1:
            strings.append('')
            continue
        val_start = si.find(b'>', start) + 1
        val_end = si.find(b'</t>', val_start)
        if val_end != -1:
            strings.append(si[val_start:val_end].decode('utf-8', errors='replace'))
        else:
            strings.append('')

print(f"Loaded {len(strings):,} shared strings in {time.time() - t0:.2f}s.")

# Step 3: Stream parse and COPY into staging
print("\n[Step 3/4] Streaming sheets into PostgreSQL staging...")

sheets = [
    ('sheet1.xml', 2022),
    ('sheet2.xml', 2023),
    ('sheet3.xml', 2024),
    ('sheet4.xml', 2025),
]

col_map = {
    'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'F': 5, 'G': 6, 'H': 7,
    'I': 8, 'J': 9, 'K': 10, 'L': 11, 'M': 12, 'N': 13, 'O': 14, 'P': 15
}

cell_regex = re.compile(rb'<c\s+r="([A-P])[0-9]+"(.*?)(?:><v>([^<]*)</v>|</c>)')
row_split_regex = re.compile(rb'<row[^>]*>(.*?)</row>')

today = date.today()

def parse_date_str(s):
    if not s:
        return None
    s = s.strip()
    # Expect DD.MM.YYYY
    if len(s) >= 10 and s[2] == '.' and s[5] == '.':
        try:
            dd = int(s[0:2])
            mm = int(s[3:5])
            yyyy = int(s[6:10])
            if dd < 1 or dd > 31 or mm < 1 or mm > 12 or yyyy < 1990 or yyyy > 2100:
                return None
            return f"{yyyy:04d}-{mm:02d}-{dd:02d}"
        except Exception:
            return None
    # If YYYY-MM-DD
    if len(s) >= 10 and s[4] == '-' and s[7] == '-':
        try:
            yyyy = int(s[0:4])
            mm = int(s[5:7])
            dd = int(s[8:10])
            if dd < 1 or dd > 31 or mm < 1 or mm > 12 or yyyy < 1990 or yyyy > 2100:
                return None
            return f"{yyyy:04d}-{mm:02d}-{dd:02d}"
        except Exception:
            return None
    return None

def calc_warranty_months(start_str, end_str):
    if not start_str or not end_str:
        return 12
    try:
        d1 = datetime.strptime(start_str, "%Y-%m-%d").date()
        d2 = datetime.strptime(end_str, "%Y-%m-%d").date()
        months = round((d2 - d1).days / 30.4375)
        return months if months > 0 else 12
    except Exception:
        return 12

total_staged = 0

for sheet_file, year in sheets:
    sheet_start = time.time()
    print(f"\nProcessing Sheet {year} ({sheet_file})...")
    
    with zipfile.ZipFile(excel_file) as z:
        with z.open(f'xl/worksheets/{sheet_file}') as f:
            csv_buffer = io.StringIO()
            csv_writer = csv.writer(csv_buffer, delimiter='\t', quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
            
            chunk_size = 32 * 1024 * 1024 # 32MB chunks
            tail = b''
            sheet_rows = 0
            is_first_row = True
            
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    if not tail:
                        break
                    data = tail
                    tail = b''
                else:
                    data = tail + chunk
                
                last_row_end = data.rfind(b'</row>')
                if last_row_end == -1:
                    if not chunk:
                        break
                    tail = data
                    continue
                
                rows_data = data[:last_row_end + 6]
                tail = data[last_row_end + 6:]
                
                # Iterate rows
                for r_match in row_split_regex.finditer(rows_data):
                    if is_first_row:
                        is_first_row = False
                        continue # Skip header row
                    
                    row_xml = r_match.group(1)
                    vals = ['' for _ in range(16)]
                    
                    for c in cell_regex.finditer(row_xml):
                        col = c.group(1).decode('ascii')
                        attrs = c.group(2)
                        v = c.group(3)
                        if not v:
                            continue
                        v_str = v.decode('ascii', errors='ignore')
                        if b't="s"' in attrs and v_str.isdigit():
                            idx = int(v_str)
                            if idx < len(strings):
                                vals[col_map[col]] = strings[idx].strip()
                        else:
                            vals[col_map[col]] = v_str.strip()
                    
                    serial_no = vals[3]
                    if not serial_no:
                        continue
                    
                    billing_doc = vals[0]
                    billing_date = parse_date_str(vals[1])
                    fg_model = vals[2] or '(Unknown)'
                    material = fg_model
                    group_name = vals[4] or '(Unknown)'
                    material_group = group_name
                    product_subgroup = vals[5]
                    customer_name = vals[6] or '(Unknown)'
                    customer_subgroup = vals[7] or ''
                    ship_to_party = vals[8]
                    ship_to_state = vals[9]
                    ship_to_city = vals[10]
                    inventory_number = vals[11]
                    warr_start_dt = parse_date_str(vals[12]) or billing_date
                    warr_end_dt = parse_date_str(vals[13])
                    city = vals[14]
                    pin_code = vals[15]
                    
                    warranty_months = calc_warranty_months(warr_start_dt, warr_end_dt)
                    is_active = False
                    if warr_end_dt:
                        try:
                            end_d = datetime.strptime(warr_end_dt, "%Y-%m-%d").date()
                            is_active = end_d >= today
                        except Exception:
                            is_active = False
                    
                    csv_writer.writerow([
                        serial_no,
                        billing_doc or '',
                        billing_date or '',
                        fg_model,
                        material,
                        group_name,
                        material_group,
                        product_subgroup or '',
                        customer_name,
                        customer_subgroup or '',
                        ship_to_party or '',
                        ship_to_state or '',
                        ship_to_city or '',
                        inventory_number or '',
                        warr_start_dt or '',
                        warr_end_dt or '',
                        city or '',
                        pin_code or '',
                        year,
                        warranty_months,
                        't' if is_active else 'f'
                    ])
                    sheet_rows += 1
                    
                    # Flush buffer to PostgreSQL every 25,000 rows
                    if sheet_rows % 25000 == 0:
                        csv_buffer.seek(0)
                        cursor.copy_expert("""
                            COPY public.warranty_master_staging (
                                serial_no, billing_doc, billing_date, fg_model, material,
                                group_name, material_group, product_subgroup, customer_name,
                                customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
                                inventory_number, warr_start_dt, warr_end_dt, city, pin_code,
                                sheet_year, warranty_months, is_active
                            ) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '')
                        """, csv_buffer)
                        csv_buffer = io.StringIO()
                        csv_writer = csv.writer(csv_buffer, delimiter='\t', quoting=csv.QUOTE_MINIMAL, lineterminator='\n')
                        elapsed = time.time() - sheet_start
                        rate = int(sheet_rows / elapsed) if elapsed > 0 else 0
                        print(f"  [{year}] {sheet_rows:,} rows staged ({rate:,} rows/s)...")

            # Final flush of remaining rows for this sheet
            if csv_buffer.tell() > 0:
                csv_buffer.seek(0)
                cursor.copy_expert("""
                    COPY public.warranty_master_staging (
                        serial_no, billing_doc, billing_date, fg_model, material,
                        group_name, material_group, product_subgroup, customer_name,
                        customer_subgroup, ship_to_party, ship_to_state, ship_to_city,
                        inventory_number, warr_start_dt, warr_end_dt, city, pin_code,
                        sheet_year, warranty_months, is_active
                    ) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '')
                """, csv_buffer)

    total_staged += sheet_rows
    sheet_time = time.time() - sheet_start
    print(f"Finished {year}: {sheet_rows:,} rows staged in {sheet_time:.1f}s.")

print(f"\nTotal rows staged across all sheets: {total_staged:,}")

# Step 4: Upsert from staging into warranty_master_items with deduplication
print("\n[Step 4/4] Deduplicating and transferring into public.warranty_master_items...")
t_up = time.time()

cursor.execute("""
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
  FROM public.warranty_master_staging
  ORDER BY serial_no, sheet_year DESC, billing_date DESC NULLS LAST
) s
ON CONFLICT (serial_no) DO UPDATE SET
  billing_doc = EXCLUDED.billing_doc,
  billing_date = EXCLUDED.billing_date,
  fg_model = EXCLUDED.fg_model,
  material = EXCLUDED.material,
  group_name = EXCLUDED.group_name,
  material_group = EXCLUDED.material_group,
  product_subgroup = EXCLUDED.product_subgroup,
  customer_name = EXCLUDED.customer_name,
  customer_subgroup = EXCLUDED.customer_subgroup,
  ship_to_party = EXCLUDED.ship_to_party,
  ship_to_state = EXCLUDED.ship_to_state,
  ship_to_city = EXCLUDED.ship_to_city,
  inventory_number = EXCLUDED.inventory_number,
  warr_start_dt = EXCLUDED.warr_start_dt,
  warr_end_dt = EXCLUDED.warr_end_dt,
  city = EXCLUDED.city,
  pin_code = EXCLUDED.pin_code,
  sheet_year = EXCLUDED.sheet_year,
  warranty_months = EXCLUDED.warranty_months,
  is_active = EXCLUDED.is_active,
  imported_at = NOW();
""")

print(f"Transfer and deduplication complete in {time.time() - t_up:.2f}s.")

# Drop staging table to reclaim disk space
print("Cleaning up staging table...")
cursor.execute("DROP TABLE IF EXISTS public.warranty_master_staging;")

# Verify final row count
cursor.execute("SELECT COUNT(*) FROM public.warranty_master_items;")
final_count = cursor.fetchone()[0]

cursor.execute("SELECT sheet_year, COUNT(*) FROM public.warranty_master_items GROUP BY sheet_year ORDER BY sheet_year;")
breakdown = cursor.fetchall()

print("\n==========================================================")
print(f"  SUCCESS! Total Machines in Warranty Master: {final_count:,}")
print("==========================================================")
for yr, cnt in breakdown:
    print(f"  Year {yr}: {cnt:,} machines")
print(f"Total Import Time: {(time.time() - t0) / 60:.1f} minutes")
print("==========================================================\n")

cursor.close()
conn.close()
