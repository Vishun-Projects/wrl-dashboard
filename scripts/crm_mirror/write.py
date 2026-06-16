from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg

from .config import MIRROR_COLS
from .schema import quote_ident


def _mirror_table(table_name: str) -> str:
    return f"crm_raw.{quote_ident(table_name.lower())}"


def mirror_count(conn: psycopg.Connection, table_name: str, active_only: bool = True) -> int:
    table = _mirror_table(table_name)
    where = " WHERE _mirror_deleted_at IS NULL" if active_only else ""
    row = conn.execute(f"SELECT COUNT(*) AS cnt FROM {table}{where}").fetchone()
    return int(row["cnt"]) if row else 0


def truncate_mirror_table(conn: psycopg.Connection, table_name: str) -> None:
    table = _mirror_table(table_name)
    conn.execute(f"TRUNCATE {table} RESTART IDENTITY")


def insert_rows(
    conn: psycopg.Connection,
    *,
    table_name: str,
    columns: list[str],
    rows: list[dict[str, str]],
    batch_id: uuid.UUID,
    synced_at: datetime | None = None,
) -> int:
    """Append CRM rows as-is (surrogate _mirror_row_id PK)."""
    if not rows:
        return 0

    table = _mirror_table(table_name)
    skip = {m.lower() for m in MIRROR_COLS} | {"_mirror_row_id"}
    data_cols = [c.lower() for c in columns if c.lower() not in skip]
    if not data_cols and rows:
        data_cols = [k.lower() for k in rows[0].keys() if k.lower() not in skip]

    all_cols = data_cols + ["_mirror_synced_at", "_mirror_batch_id", "_mirror_deleted_at"]
    col_sql = ", ".join(quote_ident(c) for c in all_cols)
    placeholders = ", ".join(f"%({c})s" for c in all_cols)

    now = synced_at or datetime.now(timezone.utc)
    count = 0
    for row in rows:
        payload: dict[str, Any] = {}
        for col in data_cols:
            val = None
            for k, v in row.items():
                if k.lower() == col:
                    val = v
                    break
            payload[col] = val if val != "" else None
        payload["_mirror_synced_at"] = now
        payload["_mirror_batch_id"] = batch_id
        payload["_mirror_deleted_at"] = None
        conn.execute(
            f"INSERT INTO {table} ({col_sql}) VALUES ({placeholders})",
            payload,
        )
        count += 1
    return count


def mirror_columns(conn: psycopg.Connection, table_name: str) -> list[str]:
    rows = conn.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'crm_raw'
          AND table_name = %s
          AND column_name NOT LIKE '_mirror%%'
        ORDER BY ordinal_position
        """,
        (table_name.lower(),),
    ).fetchall()
    return [r["column_name"] for r in rows]


# --- legacy helpers for catchup/verify/reconcile ---

def mirror_max_pk(conn: psycopg.Connection, table_name: str, pk_column: str) -> int | None:
    table = _mirror_table(table_name)
    col = quote_ident(pk_column.lower())
    row = conn.execute(
        f"SELECT MAX(({col})::numeric) AS mx FROM {table} WHERE _mirror_deleted_at IS NULL"
    ).fetchone()
    if not row or row["mx"] is None:
        return None
    try:
        return int(float(str(row["mx"])))
    except (TypeError, ValueError):
        return None


def mirror_min_pk(conn: psycopg.Connection, table_name: str, pk_column: str) -> int | None:
    table = _mirror_table(table_name)
    col = quote_ident(pk_column.lower())
    row = conn.execute(
        f"SELECT MIN(({col})::numeric) AS mn FROM {table} WHERE _mirror_deleted_at IS NULL"
    ).fetchone()
    if not row or row["mn"] is None:
        return None
    try:
        return int(float(str(row["mn"])))
    except (TypeError, ValueError):
        return None


def mirror_max_timestamp(
    conn: psycopg.Connection,
    table_name: str,
    *,
    has_editedon: bool,
    has_addedon: bool,
) -> str | None:
    table = _mirror_table(table_name)
    parts = []
    if has_editedon:
        parts.append("NULLIF(editedon, '')::timestamptz")
    if has_addedon:
        parts.append("NULLIF(addedon, '')::timestamptz")
    if not parts:
        return None
    expr = f"MAX(GREATEST({', '.join(parts)}))"
    try:
        row = conn.execute(
            f"SELECT {expr} AS mx FROM {table} WHERE _mirror_deleted_at IS NULL"
        ).fetchone()
    except psycopg.Error:
        return None
    if not row or row["mx"] is None:
        return None
    return row["mx"].isoformat()


def upsert_rows(
    conn: psycopg.Connection,
    *,
    table_name: str,
    pk_column: str,
    columns: list[str],
    rows: list[dict[str, str]],
    batch_id: uuid.UUID,
    synced_at: datetime | None = None,
) -> int:
    """Legacy upsert — raw mirror uses insert_rows instead."""
    return insert_rows(
        conn,
        table_name=table_name,
        columns=columns,
        rows=rows,
        batch_id=batch_id,
        synced_at=synced_at,
    )


def tombstone_missing_pks(
    conn: psycopg.Connection,
    *,
    table_name: str,
    pk_column: str,
    present_pks: set[int],
) -> int:
    table = _mirror_table(table_name)
    pk = quote_ident(pk_column.lower())
    rows = conn.execute(
        f"""
        SELECT {pk} FROM {table}
        WHERE _mirror_deleted_at IS NULL
        """
    ).fetchall()
    count = 0
    for row in rows:
        raw = row[pk_column.lower()] if pk_column.lower() in row else row.get(pk_column)
        try:
            pk_val = int(float(str(raw)))
        except (TypeError, ValueError):
            continue
        if pk_val not in present_pks:
            conn.execute(
                f"""
                UPDATE {table}
                SET _mirror_deleted_at = now()
                WHERE {pk} = %s AND _mirror_deleted_at IS NULL
                """,
                (str(pk_val),),
            )
            count += 1
    return count


def get_row_by_pk(
    conn: psycopg.Connection,
    table_name: str,
    pk_column: str,
    pk_value: int,
) -> dict[str, Any] | None:
    table = _mirror_table(table_name)
    col = quote_ident(pk_column.lower())
    row = conn.execute(
        f"SELECT * FROM {table} WHERE {col} = %s AND _mirror_deleted_at IS NULL",
        (str(pk_value),),
    ).fetchone()
    return dict(row) if row else None


def list_active_pks(conn: psycopg.Connection, table_name: str, pk_column: str) -> list[int]:
    table = _mirror_table(table_name)
    col = quote_ident(pk_column.lower())
    rows = conn.execute(
        f"SELECT {col} AS pk FROM {table} WHERE _mirror_deleted_at IS NULL ORDER BY ({col})::numeric"
    ).fetchall()
    out: list[int] = []
    for row in rows:
        try:
            out.append(int(float(str(row["pk"]))))
        except (TypeError, ValueError):
            continue
    return out
