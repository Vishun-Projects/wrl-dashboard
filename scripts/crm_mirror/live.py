from __future__ import annotations

import time
from datetime import timedelta
from typing import Any

import requests

from .batches import complete_batch, fail_batch, start_batch
from .config import (
    LIVE_INTERVAL_MS,
    OFFPEAK_ONLY,
    OVERLAP_MINUTES,
    PAGE_SIZE,
    PHASE_LIVE,
)
from .fetch_pages import fetch_page
from .schema import parse_blueprint
from .state import connect, release_table_lock, try_acquire_table_lock, tx, update_table_state
from .verify import promote_verified_to_live
from .write import upsert_rows


def _in_offpeak_window() -> bool:
    if not OFFPEAK_ONLY:
        return True
    from datetime import datetime
    from zoneinfo import ZoneInfo

    now = datetime.now(ZoneInfo("Asia/Kolkata"))
    hour = now.hour
    return hour >= 22 or hour < 6


def run_live_incremental_table(
    table_name: str,
    *,
    session: requests.Session | None = None,
) -> dict[str, Any]:
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

        if state["phase"] != PHASE_LIVE:
            return {"ok": False, "skipped": True, "phase": state["phase"]}

        if not try_acquire_table_lock(conn, table):
            return {"ok": False, "error": "Table lock held"}

        pk = state["pk_column"] or "ncode"
        bp = parse_blueprint().get(table)
        columns = bp.columns if bp else [pk]

        watermark = state.get("last_editedon") or state.get("backfill_started_at")
        if watermark:
            cutoff = watermark - timedelta(minutes=OVERLAP_MINUTES)
            cond_parts = []
            if state.get("has_editedon"):
                cond_parts.append(f"editedon >= '{cutoff.isoformat()}'")
            if state.get("has_addedon"):
                cond_parts.append(f"addedon >= '{cutoff.isoformat()}'")
            ts_cond = " OR ".join(cond_parts) if cond_parts else None
        else:
            ts_cond = None

        total = 0
        try:
            if ts_cond:
                cursor = None
                while True:
                    batch_id = start_batch(conn, table_name=table, phase=PHASE_LIVE, cursor_start=cursor)
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
                                end_pk = int(float(str(rows[-1].get(pk, ""))))
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
                            update_table_state(conn, table, last_ncode=end_pk)
                            total += written
                            cursor = end_pk
                    except Exception as exc:
                        fail_batch(conn, batch_id, str(exc))
                        raise
            else:
                cursor = state.get("last_ncode")
                batch_id = start_batch(conn, table_name=table, phase=PHASE_LIVE, cursor_start=cursor)
                cond = f"{pk} > {cursor}" if cursor is not None else None
                try:
                    rows, _ = fetch_page(
                        table_name=table,
                        pk_column=pk,
                        after_pk=cursor,
                        page_size=PAGE_SIZE,
                        condition_extra=cond,
                        session=sess,
                    )
                    with tx(conn):
                        written = upsert_rows(
                            conn,
                            table_name=table,
                            pk_column=pk,
                            columns=columns,
                            rows=rows,
                            batch_id=batch_id,
                        )
                        end_pk = cursor
                        if rows:
                            try:
                                end_pk = int(float(str(rows[-1].get(pk, ""))))
                            except (TypeError, ValueError):
                                pass
                        complete_batch(
                            conn,
                            batch_id=batch_id,
                            row_count=written,
                            cursor_end=end_pk,
                            rows=rows,
                            pk_column=pk,
                        )
                        update_table_state(conn, table, last_ncode=end_pk)
                        total += written
                except Exception as exc:
                    fail_batch(conn, batch_id, str(exc))
                    raise

            return {"ok": True, "table": table, "rows_upserted": total}
        finally:
            release_table_lock(conn, table)


def run_live_cycle(*, session: requests.Session | None = None) -> list[dict[str, Any]]:
    if not _in_offpeak_window():
        return [{"ok": False, "error": "Off-peak only — skipped"}]

    sess = session or requests.Session()
    with connect() as conn:
        promoted = promote_verified_to_live(conn)
        if promoted:
            print(f"[crm-mirror] Promoted {promoted} verified table(s) to live")

        rows = conn.execute(
            "SELECT table_name FROM crm_mirror.sync_state WHERE phase = 'live' ORDER BY table_name"
        ).fetchall()
        names = [r["table_name"] for r in rows]

    return [run_live_incremental_table(name, session=sess) for name in names]


def run_live_daemon(*, once: bool = False) -> None:
    print(f"[crm-mirror] Live daemon interval={LIVE_INTERVAL_MS}ms")
    while True:
        results = run_live_cycle()
        ok = sum(1 for r in results if r.get("ok"))
        print(f"[crm-mirror] Live cycle complete: {ok}/{len(results)} tables")
        if once:
            break
        time.sleep(LIVE_INTERVAL_MS / 1000)
