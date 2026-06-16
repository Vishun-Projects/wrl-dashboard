from __future__ import annotations

import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from .config import STALE_LOCK_MS, old_crm_database_url

BACKFILL_RUN_LOCK = "old_crm_backfill_global"


def connect(*, retries: int = 4) -> psycopg.Connection:
    # Supavisor transaction pool (6543): disable server-side prepared statements entirely.
    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            conn = psycopg.connect(
                old_crm_database_url(),
                row_factory=dict_row,
                prepare_threshold=None,
                autocommit=False,
            )
            conn.prepare_threshold = None
            return conn
        except psycopg.errors.DuplicatePreparedStatement as exc:
            last_exc = exc
            time.sleep(0.25 * (attempt + 1))
    if last_exc:
        raise last_exc
    raise RuntimeError("connect failed")


@contextmanager
def tx(conn: psycopg.Connection) -> Iterator[psycopg.Connection]:
    with conn.transaction():
        yield conn


def try_acquire_run_lock(conn: psycopg.Connection, lock_name: str = BACKFILL_RUN_LOCK) -> bool:
    row = conn.execute("SELECT pg_try_advisory_lock(hashtext(%s)) AS ok", (lock_name,)).fetchone()
    return bool(row and row["ok"])


def release_run_lock(conn: psycopg.Connection, lock_name: str = BACKFILL_RUN_LOCK) -> None:
    conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", (lock_name,))


def count_phases(conn: psycopg.Connection) -> dict[str, int]:
    rows = conn.execute(
        "SELECT phase, COUNT(*) AS cnt FROM crm_mirror.sync_state GROUP BY phase"
    ).fetchall()
    return {r["phase"]: r["cnt"] for r in rows}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_table_state(conn: psycopg.Connection, table_name: str) -> dict[str, Any] | None:
    row = conn.execute(
        "SELECT * FROM crm_mirror.sync_state WHERE table_name = %s",
        (table_name.lower(),),
    ).fetchone()
    return dict(row) if row else None


def list_table_states(conn: psycopg.Connection, phase: str | None = None) -> list[dict[str, Any]]:
    if phase:
        rows = conn.execute(
            "SELECT * FROM crm_mirror.sync_state WHERE phase = %s ORDER BY size_kb NULLS LAST, table_name",
            (phase,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM crm_mirror.sync_state ORDER BY size_kb NULLS LAST, table_name"
        ).fetchall()
    return [dict(r) for r in rows]


def upsert_catalog_row(conn: psycopg.Connection, row: dict[str, Any]) -> None:
    conn.execute(
        """
        INSERT INTO crm_mirror.sync_state (
          table_name, phase, sync_capability, pk_column,
          has_editedon, has_addedon, crm_row_count, size_kb
        ) VALUES (
          %(table_name)s, %(phase)s, %(sync_capability)s, %(pk_column)s,
          %(has_editedon)s, %(has_addedon)s, %(crm_row_count)s, %(size_kb)s
        )
        ON CONFLICT (table_name) DO UPDATE SET
          sync_capability = EXCLUDED.sync_capability,
          pk_column = EXCLUDED.pk_column,
          has_editedon = EXCLUDED.has_editedon,
          has_addedon = EXCLUDED.has_addedon,
          crm_row_count = EXCLUDED.crm_row_count,
          size_kb = EXCLUDED.size_kb
        """,
        row,
    )


def try_acquire_table_lock(conn: psycopg.Connection, table_name: str) -> bool:
    table = table_name.lower()
    conn.execute("SELECT pg_advisory_lock(hashtext(%s))", (f"old_crm_{table}",))
    row = conn.execute(
        "SELECT is_running, last_run_at FROM crm_mirror.sync_state WHERE table_name = %s",
        (table,),
    ).fetchone()
    if not row:
        return False
    if row["is_running"]:
        last_run = row["last_run_at"]
        if last_run is not None:
            age_ms = (utcnow() - last_run).total_seconds() * 1000
            if age_ms < STALE_LOCK_MS:
                conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", (f"old_crm_{table}",))
                return False
    conn.execute(
        """
        UPDATE crm_mirror.sync_state
        SET is_running = true, last_run_at = now(), last_error = NULL
        WHERE table_name = %s
        """,
        (table,),
    )
    return True


def release_table_lock(conn: psycopg.Connection, table_name: str) -> None:
    table = table_name.lower()
    conn.execute(
        "UPDATE crm_mirror.sync_state SET is_running = false, last_run_at = now() WHERE table_name = %s",
        (table,),
    )
    conn.execute("SELECT pg_advisory_unlock(hashtext(%s))", (f"old_crm_{table}",))


def update_table_state(conn: psycopg.Connection, table_name: str, **fields: Any) -> None:
    if not fields:
        return
    table = table_name.lower()
    sets = ", ".join(f"{k} = %({k})s" for k in fields)
    payload = {"table_name": table, **fields}
    conn.execute(
        f"UPDATE crm_mirror.sync_state SET {sets} WHERE table_name = %(table_name)s",
        payload,
    )


def record_verification(
    conn: psycopg.Connection,
    *,
    table_name: str,
    gate_name: str,
    crm_value: str | None,
    mirror_value: str | None,
    passed: bool,
    details: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO crm_mirror.sync_verifications
          (table_name, gate_name, crm_value, mirror_value, passed, details_json)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            table_name.lower(),
            gate_name,
            crm_value,
            mirror_value,
            passed,
            json.dumps(details) if details else None,
        ),
    )


def latest_verifications(conn: psycopg.Connection, table_name: str | None = None) -> list[dict[str, Any]]:
    if table_name:
        rows = conn.execute(
            """
            SELECT DISTINCT ON (gate_name) *
            FROM crm_mirror.sync_verifications
            WHERE table_name = %s
            ORDER BY gate_name, run_at DESC
            """,
            (table_name.lower(),),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT DISTINCT ON (table_name, gate_name) *
            FROM crm_mirror.sync_verifications
            ORDER BY table_name, gate_name, run_at DESC
            """
        ).fetchall()
    return [dict(r) for r in rows]


def status_summary(conn: psycopg.Connection) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT phase, COUNT(*) AS cnt
        FROM crm_mirror.sync_state
        GROUP BY phase
        ORDER BY phase
        """
    ).fetchall()
    return {
        "phases": {r["phase"]: r["cnt"] for r in rows},
        "tables": list_table_states(conn),
        "verifications": latest_verifications(conn),
    }
