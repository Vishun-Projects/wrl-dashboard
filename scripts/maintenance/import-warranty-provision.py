#!/usr/bin/env python3
"""
Stream-import Warranty Provision .xlsb — input columns only; recompute end/FY.
Upserts on (billing_document, serial_number).

Usage:
  python scripts/maintenance/import-warranty-provision.py
  python scripts/maintenance/import-warranty-provision.py --sheet Data3
  python scripts/maintenance/import-warranty-provision.py --replace
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

INPUT_HEADERS = [
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
    "days",
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


def fy_label(end: date) -> str:
    y = end.year if end.month >= 4 else end.year - 1
    return f"{y % 100:02d}-{(y + 1) % 100:02d}"


def map_header(vals) -> dict:
    out = {}
    for i, v in enumerate(vals):
        key = norm(v)
        if key:
            out[key] = i
    return out


def get(hdr, key, vals):
    ix = hdr.get(key)
    if ix is None or ix >= len(vals):
        return None
    return vals[ix]


def apply_schema(conn) -> None:
    """Apply schema chunks statement-by-statement with autocommit.

    Never wrap 67's backfill + DROP COLUMN in one long transaction — that holds
    AccessExclusiveLock and lock-timeouts the live SNAP/options queries.
    """
    prev = conn.autocommit
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for name in ("66-warranty-provision.sql", "67-warranty-provision-snap.sql"):
                sql_path = ROOT / "docs" / "read-model-phase1-schema" / name
                if not sql_path.exists():
                    continue
                text = sql_path.read_text(encoding="utf-8")
                if name.startswith("67-"):
                    cur.execute(
                        "SELECT 1 FROM pg_indexes WHERE indexname = 'ux_wp_doc_serial'"
                    )
                    if cur.fetchone():
                        # Backfill/unique already done — only ensure phase-2 tables.
                        marker = "-- Claims + assumptions"
                        tail = text.split(marker, 1)[1] if marker in text else ""
                        for stmt in _split_sql(tail):
                            cur.execute(stmt)
                        print(f"  {name}: skipped backfill (ux_wp_doc_serial present)", flush=True)
                        continue
                for stmt in _split_sql(text):
                    cur.execute(stmt)
                print(f"  {name}: ok", flush=True)
    finally:
        conn.autocommit = prev


def _split_sql(sql: str) -> list[str]:
    """Split on semicolons outside dollar-quotes. Enough for our schema files."""
    parts: list[str] = []
    buf: list[str] = []
    i = 0
    in_dollar = False
    while i < len(sql):
        if sql.startswith("$$", i):
            in_dollar = not in_dollar
            buf.append("$$")
            i += 2
            continue
        ch = sql[i]
        if ch == ";" and not in_dollar:
            stmt = "".join(buf).strip()
            if stmt and not all(line.strip().startswith("--") or not line.strip() for line in stmt.splitlines()):
                parts.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    stmt = "".join(buf).strip()
    if stmt:
        parts.append(stmt)
    return parts


def parse_args(argv: list[str]) -> tuple[Path, str | None, bool]:
    only_sheet: str | None = None
    replace = False
    positional: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--replace":
            replace = True
            i += 1
            continue
        if argv[i] == "--sheet" and i + 1 < len(argv):
            only_sheet = argv[i + 1]
            i += 2
            continue
        if argv[i].startswith("--sheet="):
            only_sheet = argv[i].split("=", 1)[1]
            i += 1
            continue
        positional.append(argv[i])
        i += 1
    file_path = Path(positional[0]) if positional else DEFAULT_FILE
    return file_path, only_sheet, replace


def main() -> int:
    load_env()
    file_path, only_sheet, replace = parse_args(sys.argv[1:])
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
            apply_schema(conn)
            print("schema ok", flush=True)

            if replace and only_sheet is None:
                cur.execute("TRUNCATE warranty_provision_rows RESTART IDENTITY CASCADE")

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
                      billing_document, billing_date, billing_year, material, serial_number,
                      material_group, external_material_group, sold_to_party_name, customer_subgroup,
                      ship_to_party_name, ship_to_party_state, ship_to_party_city, inventory_number,
                      warranty_start, warranty_end_date, days, warranty_end_fy
                    ) VALUES %s
                    ON CONFLICT (billing_document, serial_number)
                    WHERE billing_document <> '' AND serial_number <> ''
                    DO UPDATE SET
                      billing_date = EXCLUDED.billing_date,
                      billing_year = EXCLUDED.billing_year,
                      material = EXCLUDED.material,
                      material_group = EXCLUDED.material_group,
                      external_material_group = EXCLUDED.external_material_group,
                      sold_to_party_name = EXCLUDED.sold_to_party_name,
                      customer_subgroup = EXCLUDED.customer_subgroup,
                      ship_to_party_name = EXCLUDED.ship_to_party_name,
                      ship_to_party_state = EXCLUDED.ship_to_party_state,
                      ship_to_party_city = EXCLUDED.ship_to_party_city,
                      inventory_number = EXCLUDED.inventory_number,
                      warranty_start = EXCLUDED.warranty_start,
                      warranty_end_date = EXCLUDED.warranty_end_date,
                      days = EXCLUDED.days,
                      warranty_end_fy = EXCLUDED.warranty_end_fy
                    """,
                    batch,
                    page_size=BATCH,
                )
                batch = []

            with open_workbook(str(file_path)) as wb:
                print(f"sheets: {wb.sheets}", flush=True)
                if only_sheet and only_sheet not in wb.sheets:
                    print(f"sheet not found: {only_sheet}", file=sys.stderr)
                    return 1
                target = [only_sheet] if only_sheet else list(wb.sheets)
                for sheet_name in target:
                    with wb.get_sheet(sheet_name) as sheet:
                        hdr = None
                        sheet_rows = 0
                        sheet_skip = 0
                        for i, row in enumerate(sheet.rows()):
                            vals = [c.v for c in row]
                            if i == 0:
                                hdr = map_header(vals)
                                if "billingdocument" not in hdr or "warranty" not in hdr or "days" not in hdr:
                                    print(f"  {sheet_name}: skipped (need Billing Document, Warranty, Days)", flush=True)
                                    hdr = None
                                    break
                                missing = [h for h in INPUT_HEADERS if h not in hdr]
                                if missing:
                                    print(f"  {sheet_name}: soft-missing {', '.join(missing)}", flush=True)
                                continue
                            if hdr is None:
                                break
                            if not any(v is not None and str(v).strip() != "" for v in vals):
                                sheet_skip += 1
                                continue
                            billing = cell_text(get(hdr, "billingdocument", vals))
                            serial = cell_text(get(hdr, "serialnumber", vals))
                            start = cell_date(get(hdr, "warranty", vals))
                            days = cell_int(get(hdr, "days", vals))
                            billing_date = cell_date(get(hdr, "billingdate", vals))
                            if not billing and not serial:
                                sheet_skip += 1
                                continue
                            end = start + timedelta(days=days) if start is not None and days is not None else None
                            batch.append(
                                (
                                    billing,
                                    billing_date,
                                    billing_date.year if billing_date else None,
                                    cell_text(get(hdr, "material", vals)),
                                    serial,
                                    cell_text(get(hdr, "materialgroup", vals)),
                                    cell_text(get(hdr, "externalmaterialgroup", vals)),
                                    cell_text(get(hdr, "customersoldtopartyname", vals)),
                                    cell_text(get(hdr, "customersubgroup", vals)),
                                    cell_text(get(hdr, "customershiptopartyname", vals)),
                                    cell_text(get(hdr, "shiptopartystate", vals)),
                                    cell_text(get(hdr, "shiptopartycity", vals)),
                                    cell_text(get(hdr, "inventorynumber", vals)),
                                    start,
                                    end,
                                    days,
                                    fy_label(end) if end else "",
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
