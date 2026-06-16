from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

import psycopg

from .crm_client import row_fingerprint
from .config import MIRROR_COLS


def _batch_cursor(val: int | str | None) -> int | None:
    if val is None:
        return None
    if isinstance(val, int):
        return val
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def start_batch(
    conn: psycopg.Connection,
    *,
    table_name: str,
    phase: str,
    cursor_start: int | str | None,
) -> uuid.UUID:
    batch_id = uuid.uuid4()
    conn.execute(
        """
        INSERT INTO crm_mirror.sync_batches
          (batch_id, table_name, phase, cursor_start, status, started_at)
        VALUES (%s, %s, %s, %s, 'started', now())
        """,
        (batch_id, table_name.lower(), phase, _batch_cursor(cursor_start)),
    )
    return batch_id


def complete_batch(
    conn: psycopg.Connection,
    *,
    batch_id: uuid.UUID,
    row_count: int,
    cursor_end: int | str | None,
    rows: list[dict[str, str]],
    pk_column: str,
) -> None:
    checksum = batch_checksum(rows, pk_column)
    conn.execute(
        """
        UPDATE crm_mirror.sync_batches
        SET status = 'completed', row_count = %s, cursor_end = %s,
            checksum = %s, finished_at = now()
        WHERE batch_id = %s
        """,
        (row_count, _batch_cursor(cursor_end), checksum, batch_id),
    )


def fail_batch(conn: psycopg.Connection, batch_id: uuid.UUID, error: str) -> None:
    conn.execute(
        """
        UPDATE crm_mirror.sync_batches
        SET status = 'failed', error_message = %s, finished_at = now()
        WHERE batch_id = %s
        """,
        (error[:2000], batch_id),
    )


def batch_checksum(rows: list[dict[str, str]], pk_column: str) -> str:
    parts = []
    for row in rows:
        pk = row.get(pk_column, "")
        parts.append(f"{pk}:{row_fingerprint(row, exclude=frozenset(MIRROR_COLS))}")
    parts.sort()
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()


def audit_backfill_batches(conn: psycopg.Connection, table_name: str) -> dict[str, Any]:
    table = table_name.lower()
    sum_row = conn.execute(
        """
        SELECT COALESCE(SUM(row_count), 0) AS total_rows
        FROM crm_mirror.sync_batches
        WHERE table_name = %s AND phase = 'backfilling' AND status = 'completed'
        """,
        (table,),
    ).fetchone()
    stale = conn.execute(
        """
        SELECT COUNT(*) AS cnt FROM crm_mirror.sync_batches
        WHERE table_name = %s AND status = 'started' AND started_at < now() - interval '10 minutes'
        """,
        (table,),
    ).fetchone()
    return {
        "batch_row_sum": int(sum_row["total_rows"] if sum_row else 0),
        "stale_started_batches": int(stale["cnt"] if stale else 0),
    }
