from __future__ import annotations

from datetime import timedelta
from typing import Any

import requests

from .batches import complete_batch, fail_batch, start_batch
from .config import (
    CAP_PK_ONLY,
    CAP_SMALL_SNAPSHOT,
    CAP_TIMESTAMPED_PK,
    OVERLAP_MINUTES,
    PAGE_SIZE,
    PHASE_CATCHING_UP,
    PHASE_ERROR,
    PHASE_VERIFYING,
)
from .fetch_pages import fetch_all_pages, fetch_page
from .state import connect, release_table_lock, try_acquire_table_lock, tx, update_table_state, utcnow
from .write import upsert_rows


def _timestamp_condition(state: dict[str, Any]) -> str | None:
    started = state.get("backfill_started_at")
    if not started:
        return None
    overlap = timedelta(minutes=OVERLAP_MINUTES)
    cutoff = started - overlap
    parts = []
    if state.get("has_editedon"):
        parts.append(f"editedon >= '{cutoff.isoformat()}'")
    if state.get("has_addedon"):
        parts.append(f"addedon >= '{cutoff.isoformat()}'")
    if not parts:
        return None
    return " OR ".join(parts)


def run_catchup_table(table_name: str, *, session: requests.Session | None = None) -> dict[str, Any]:
    sess = session or requests.Session()
    table = table_name.lower()

    with connect() as conn:
        state = conn.execute(
            "SELECT * FROM crm_mirror.sync_state WHERE table_name = %s",
            (table,),
        ).fetchone()
        if not state:
            return {"ok": False, "error": f"Unknown table {table}"}
        state = dict(state)

        if state["phase"] != PHASE_CATCHING_UP:
            return {"ok": False, "error": f"Table phase is {state['phase']}, expected catching_up"}

        if not try_acquire_table_lock(conn, table):
            return {"ok": False, "error": "Table lock held by another run"}

        pk = state["pk_column"] or "ncode"
        capability = state["sync_capability"]
        from .schema import parse_blueprint

        bp = parse_blueprint().get(table)
        columns = bp.columns if bp else [pk]

        try:
            total_written = 0
            empty_passes = int(state.get("catchup_empty_passes") or 0)

            if capability == CAP_SMALL_SNAPSHOT or capability == CAP_PK_ONLY:
                rows = fetch_all_pages(table_name=table, pk_column=pk, page_size=PAGE_SIZE, session=sess)
                batch_id = start_batch(conn, table_name=table, phase=PHASE_CATCHING_UP, cursor_start=None)
                try:
                    with tx(conn):
                        written = upsert_rows(
                            conn,
                            table_name=table,
                            pk_column=pk,
                            columns=columns,
                            rows=rows,
                            batch_id=batch_id,
                        )
                        complete_batch(
                            conn,
                            batch_id=batch_id,
                            row_count=written,
                            cursor_end=None,
                            rows=rows,
                            pk_column=pk,
                        )
                        total_written += written
                    empty_passes = 2
                except Exception as exc:
                    fail_batch(conn, batch_id, str(exc))
                    raise
            else:
                ts_cond = _timestamp_condition(state)
                if not ts_cond:
                    empty_passes = 2
                else:
                    cursor = None
                    got_rows = False
                    while True:
                        batch_id = start_batch(
                            conn, table_name=table, phase=PHASE_CATCHING_UP, cursor_start=cursor
                        )
                        try:
                            rows, _ = fetch_page(
                                table_name=table,
                                pk_column=pk,
                                after_pk=cursor,
                                page_size=PAGE_SIZE,
                                condition_extra=ts_cond,
                                session=sess,
                            )
                            if not rows:
                                with tx(conn):
                                    complete_batch(
                                        conn,
                                        batch_id=batch_id,
                                        row_count=0,
                                        cursor_end=cursor,
                                        rows=[],
                                        pk_column=pk,
                                    )
                                break
                            got_rows = True
                            with tx(conn):
                                written = upsert_rows(
                                    conn,
                                    table_name=table,
                                    pk_column=pk,
                                    columns=columns,
                                    rows=rows,
                                    batch_id=batch_id,
                                )
                                try:
                                    end_pk = int(float(str(rows[-1].get(pk, "")).strip()))
                                except (TypeError, ValueError):
                                    end_pk = cursor
                                complete_batch(
                                    conn,
                                    batch_id=batch_id,
                                    row_count=written,
                                    cursor_end=end_pk,
                                    rows=rows,
                                    pk_column=pk,
                                )
                                total_written += written
                                cursor = end_pk
                        except Exception as exc:
                            fail_batch(conn, batch_id, str(exc))
                            raise

                    if got_rows:
                        empty_passes = 0
                    else:
                        empty_passes += 1

            with tx(conn):
                update_table_state(
                    conn,
                    table,
                    catchup_empty_passes=empty_passes,
                )
                if empty_passes >= 2:
                    update_table_state(
                        conn,
                        table,
                        phase=PHASE_VERIFYING,
                        catchup_completed_at=utcnow(),
                    )

            return {
                "ok": True,
                "table": table,
                "rows_upserted": total_written,
                "empty_passes": empty_passes,
            }
        except Exception as exc:
            with tx(conn):
                update_table_state(conn, table, phase=PHASE_ERROR, last_error=str(exc)[:2000])
            return {"ok": False, "table": table, "error": str(exc)}
        finally:
            release_table_lock(conn, table)


def run_catchup(*, table: str | None = None) -> list[dict[str, Any]]:
    sess = requests.Session()
    with connect() as conn:
        if table:
            names = [table.lower()]
        else:
            rows = conn.execute(
                """
                SELECT table_name FROM crm_mirror.sync_state
                WHERE phase = 'catching_up'
                ORDER BY size_kb NULLS LAST, table_name
                """
            ).fetchall()
            names = [r["table_name"] for r in rows]

    return [run_catchup_table(name, session=sess) for name in names]
