from __future__ import annotations

import time
from pathlib import Path

import psycopg

from .config import ROOT
from .state import connect
from .stop_all import stop_all_sync
from .worker import LOG_PATH, PID_PATH

SCHEMA_DIR = ROOT / "docs" / "old-crm-schema"


def _drop_schemas(conn: psycopg.Connection) -> None:
    conn.execute("DROP SCHEMA IF EXISTS crm_raw CASCADE")
    conn.execute("DROP SCHEMA IF EXISTS crm_mirror CASCADE")


def reset_old_crm(*, apply_schema: bool = True, retries: int = 5) -> dict:
    """Drop all mirror data and re-create empty crm_mirror + crm_raw schemas."""
    stop_all_sync()

    last_exc: Exception | None = None
    for attempt in range(retries):
        try:
            stop_all_sync()
            with connect() as conn:
                _drop_schemas(conn)
                conn.commit()
            last_exc = None
            break
        except psycopg.errors.DeadlockDetected as exc:
            last_exc = exc
            time.sleep(2 * (attempt + 1))
        except psycopg.Error as exc:
            if "crm_mirror" in str(exc) and attempt == 0:
                with connect() as conn:
                    conn.execute("DROP SCHEMA IF EXISTS crm_raw CASCADE")
                    conn.commit()
                continue
            raise

    if last_exc:
        raise last_exc

    if apply_schema:
        files = sorted(
            f
            for f in SCHEMA_DIR.glob("*.sql")
            if f.name != "00-create-database.sql"
        )
        with connect() as conn:
            for path in files:
                sql = path.read_text(encoding="utf-8")
                conn.execute(sql)
            conn.commit()

    PID_PATH.unlink(missing_ok=True)
    if LOG_PATH.is_file():
        LOG_PATH.write_text("", encoding="utf-8")

    return {"ok": True, "message": "old_crm mirror wiped — crm_raw and crm_mirror recreated"}
