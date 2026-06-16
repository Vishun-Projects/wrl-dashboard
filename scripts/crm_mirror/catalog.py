from __future__ import annotations

from typing import Any

import requests

from .config import CATALOG_SQL, FETCH_GAP_MS, PHASE_PENDING, SMALL_TABLE_ROWS
from .crm_client import post_query
from .schema import ensure_raw_table_sql, parse_blueprint, quote_ident, resolve_table_metadata
from .state import connect, tx, upsert_catalog_row


def fetch_crm_catalog(session=None) -> list[dict[str, Any]]:
    result = post_query(session=session, gap_ms=FETCH_GAP_MS, raw_sql=CATALOG_SQL)
    rows = result.get("data") or []
    out: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get("TableName") or row.get("tablename") or "").strip()
        if not name:
            continue
        out.append(
            {
                "table_name": name.lower(),
                "row_count": int(float(row.get("RowCounts") or row.get("rowcounts") or 0)),
                "size_kb": int(float(row.get("TotalSpaceKB") or row.get("totalspacekb") or 0)),
            }
        )
    out.sort(key=lambda r: (r["size_kb"], r["table_name"]))
    return out


def _register_table(
    conn,
    *,
    entry: dict[str, Any],
    meta: dict[str, Any],
    create_ddl: bool,
) -> bool:
    table = entry["table_name"]
    upsert_catalog_row(
        conn,
        {
            "table_name": table,
            "phase": PHASE_PENDING,
            "sync_capability": meta["sync_capability"],
            "pk_column": meta["pk_column"],
            "has_editedon": meta["has_editedon"],
            "has_addedon": meta["has_addedon"],
            "crm_row_count": entry["row_count"],
            "size_kb": entry["size_kb"],
        },
    )
    if create_ddl and meta["columns"]:
        conn.execute(f"DROP TABLE IF EXISTS crm_raw.{quote_ident(table)} CASCADE")
        ddl = ensure_raw_table_sql(table, meta["columns"], meta.get("pk_column"))
        conn.execute(ddl)
        return True
    return False


def init_catalog(*, create_ddl: bool = True) -> dict[str, Any]:
    blueprint = parse_blueprint()
    catalog = fetch_crm_catalog()
    sess = requests.Session()
    created = 0

    with connect() as conn:
        with tx(conn):
            for entry in catalog:
                table = entry["table_name"]
                bp = blueprint.get(table)
                meta = resolve_table_metadata(
                    table_name=table,
                    blueprint_columns=bp.columns if bp else [],
                    row_count=entry["row_count"],
                    session=sess,
                    small_table_rows=SMALL_TABLE_ROWS,
                )
                if _register_table(conn, entry=entry, meta=meta, create_ddl=create_ddl):
                    created += 1

    return {
        "catalog_tables": len(catalog),
        "ddl_created": created,
        "blocked": 0,
    }


def repair_catalog_fast() -> dict[str, Any]:
    """Reset locks/errors/blocked back to pending — never block tables."""
    with connect() as conn:
        with tx(conn):
            conn.execute(
                "UPDATE crm_mirror.sync_state SET is_running = false WHERE is_running = true"
            )
            reset_blocked = conn.execute(
                """
                UPDATE crm_mirror.sync_state
                SET phase = 'pending', last_error = NULL, is_running = false
                WHERE phase IN ('blocked', 'error')
                """
            ).rowcount
            reset_pooler = conn.execute(
                """
                UPDATE crm_mirror.sync_state
                SET phase = 'pending', last_error = NULL, is_running = false
                WHERE phase = 'error'
                  AND (
                    last_error ILIKE '%prepared statement%'
                    OR last_error ILIKE '%DuplicatePreparedStatement%'
                  )
                """
            ).rowcount
    return {"reset_to_pending": reset_blocked, "reset_pooler_errors": reset_pooler}


def repair_catalog(*, table: str | None = None, fast: bool = False) -> dict[str, Any]:
    if fast and not table:
        return repair_catalog_fast()
    blueprint = parse_blueprint()
    sess = requests.Session()
    repaired = 0

    with connect() as conn:
        if table:
            names = [table.lower()]
        else:
            rows = conn.execute(
                """
                SELECT table_name, crm_row_count, size_kb
                FROM crm_mirror.sync_state
                WHERE phase NOT IN ('catching_up', 'backfilling', 'live', 'verified')
                ORDER BY size_kb NULLS LAST, table_name
                """
            ).fetchall()
            names = [r["table_name"] for r in rows]

        for name in names:
            row = conn.execute(
                "SELECT * FROM crm_mirror.sync_state WHERE table_name = %s",
                (name,),
            ).fetchone()
            if not row:
                continue
            row = dict(row)
            bp = blueprint.get(name)
            meta = resolve_table_metadata(
                table_name=name,
                blueprint_columns=bp.columns if bp else [],
                row_count=int(row.get("crm_row_count") or 0),
                session=sess,
                small_table_rows=SMALL_TABLE_ROWS,
            )
            entry = {
                "table_name": name,
                "row_count": int(row.get("crm_row_count") or 0),
                "size_kb": row.get("size_kb"),
            }
            with tx(conn):
                _register_table(conn, entry=entry, meta=meta, create_ddl=True)
                conn.execute(
                    """
                    UPDATE crm_mirror.sync_state
                    SET phase = 'pending', last_error = NULL, is_running = false,
                        last_ncode = NULL, last_cursor = NULL, rows_loaded = 0
                    WHERE table_name = %s
                    """,
                    (name,),
                )
                repaired += 1

    return {"repaired": repaired}
