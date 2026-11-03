#!/usr/bin/env python3
"""
Stream-import Warranty Provision Excel Binary Workbook (.xlsb) — all sheets.
Flat table only (no import parent / FK).

Usage:
  python scripts/maintenance/import-warranty-provision.py
  python scripts/maintenance/import-warranty-provision.py "path/to/file.xlsb"
"""
from __future__ import annotations

import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from pyxlsb import open_workbook
import psycopg2
from psycopg2.extras import execute_values

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FILE = ROOT / "Warranty Prov working_October26.xlsb"
BATCH = 1000

EXPECTED = [
    "billingdocument",
    "billingdate",
    "material",
    "serialnumber",
    "materialgroup",
    "externalmaterialgroup",
    "customersoldtopartyname",
    "customersubgroup",
    "customershiptopartyname",
    "shiptopartystate",
    "shiptopartycity",
    "inventorynumber",
    "warranty",
    "warrantyenddate",
    "days",
    "remaningdays",
    "warrantyremaningdays",
    "warrantyendfy",
]


def load_env() -> None:
    if load_dotenv:
        load_dotenv(ROOT / ".env.local")
        load_dotenv(ROOT / ".env")
    else:
        for name in (".env.local", ".env"):
            p = ROOT / name
            if not p.exists():
                continue
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def cell_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (datetime, date)):
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def cell_date(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)) and 20000 < float(v) < 100000:
        return date(1899, 12, 30) + timedelta(days=int(v))
    s = cell_text(v)
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$", s)
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    return None


def cell_int(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v)
    try:
        return int(float(str(v).replace(",", "").strip()))
    except ValueError:
        return None


def map_header(vals) -> dict:
    out = {}
    for i, v in enumerate(vals):
        key = norm(v)
        if not key:
            continue
        if key == "remainingdays":
            key = "remaningdays"
        elif key == "warrantyremainingdays":
            key = "warrantyremaningdays"
        out[key] = i
    return out


def get(hdr, key, vals):
    ix = hdr.get(key)
    if ix is None or ix >= len(vals):
        return None
    return vals[ix]


def apply_schema(cur) -> None:
    sql_path = ROOT / "docs" / "read-model-phase1-schema" / "66-warranty-provision.sql"
    cur.execute(sql_path.read_text(encoding="utf-8"))


def main() -> int:
    load_env()
    file_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FILE
    db_url = os.environ.get("DIRECT_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1
    db_url = db_url.strip().strip('"').strip("'")
    db_url = db_url.replace("?pgbouncer=true", "").replace("&pgbouncer=true", "")
    db_url = db_url.replace(":6543/", ":5432/")

    print(f"reading {file_path}…", flush=True)
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            apply_schema(cur)
            conn.commit()
            print("schema ok", flush=True)

            cur.execute("TRUNCATE warranty_provision_rows RESTART IDENTITY")
            parsed = 0
            skipped = 0
            batch: list[tuple] = []

            def flush():
                nonlocal batch
                if not batch:
                    return
                execute_values(
                    cur,
                    """
                    INSERT INTO warranty_provision_rows (
                      billing_document, billing_date, material, serial_number,
                      material_group, external_material_group, sold_to_party_name, customer_subgroup,
                      ship_to_party_name, ship_to_party_state, ship_to_party_city, inventory_number,
                      warranty_start, warranty_end_date, days, remaining_days, warranty_remaining_days, warranty_end_fy
                    ) VALUES %s
                    """,
                    batch,
                    page_size=BATCH,
                )
                batch = []

            with open_workbook(str(file_path)) as wb:
                print(f"sheets: {wb.sheets}", flush=True)
                for sheet_name in wb.sheets:
                    with wb.get_sheet(sheet_name) as sheet:
                        hdr = None
                        sheet_rows = 0
                        sheet_skip = 0
                        for i, row in enumerate(sheet.rows()):
                            vals = [c.v for c in row]
                            if i == 0:
                                hdr = map_header(vals)
                                if "billingdocument" not in hdr:
                                    print(f"  {sheet_name}: skipped (no Billing Document header)", flush=True)
                                    hdr = None
                                    break
                                missing = [h for h in EXPECTED if h not in hdr]
                                if missing:
                                    print(f"  {sheet_name}: soft-missing {', '.join(missing)}", flush=True)
                                continue
                            if hdr is None:
                                break
                            if not any(v is not None and str(v).strip() != "" for v in vals):
                                sheet_skip += 1
                                continue
                            billing = cell_text(get(hdr, "billingdocument", vals))
                            material = cell_text(get(hdr, "material", vals))
                            serial = cell_text(get(hdr, "serialnumber", vals))
                            if not billing and not material and not serial:
                                sheet_skip += 1
                                continue
                            batch.append(
                                (
                                    billing,
                                    cell_date(get(hdr, "billingdate", vals)),
                                    material,
                                    serial,
                                    cell_text(get(hdr, "materialgroup", vals)),
                                    cell_text(get(hdr, "externalmaterialgroup", vals)),
                                    cell_text(get(hdr, "customersoldtopartyname", vals)),
                                    cell_text(get(hdr, "customersubgroup", vals)),
                                    cell_text(get(hdr, "customershiptopartyname", vals)),
                                    cell_text(get(hdr, "shiptopartystate", vals)),
                                    cell_text(get(hdr, "shiptopartycity", vals)),
                                    cell_text(get(hdr, "inventorynumber", vals)),
                                    cell_date(get(hdr, "warranty", vals)),
                                    cell_date(get(hdr, "warrantyenddate", vals)),
                                    cell_int(get(hdr, "days", vals)),
                                    cell_int(get(hdr, "remaningdays", vals)),
                                    cell_text(get(hdr, "warrantyremaningdays", vals)),
                                    cell_text(get(hdr, "warrantyendfy", vals)),
                                )
                            )
                            sheet_rows += 1
                            parsed += 1
                            if len(batch) >= BATCH:
                                flush()
                                if parsed % 20000 == 0:
                                    print(f"  …{parsed:,} rows", flush=True)
                        if hdr is not None:
                            skipped += sheet_skip
                            print(f"  {sheet_name}: {sheet_rows:,} rows, skipped {sheet_skip}", flush=True)

            flush()
            conn.commit()
            print(f"done parsed={parsed:,} skipped={skipped}", flush=True)
            return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
