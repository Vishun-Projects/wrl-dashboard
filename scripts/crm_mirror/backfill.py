from __future__ import annotations

from typing import Any

import psycopg
import requests

from .batches import complete_batch, fail_batch, start_batch
from .catalog import repair_catalog_fast
from .config import (
    CAP_HEAP_SCAN,
    CAP_SMALL_SNAPSHOT,
    PAGE_SIZE,
    PHASE_BACKFILLING,
    PHASE_CATCHING_UP,
    PHASE_ERROR,
    PHASE_LIVE,
    PHASE_PENDING,
    PHASE_VERIFIED,
)
from .fetch_pages import (
    crm_count,
    fetch_all_heap,
    fetch_all_text_pk,
    fetch_heap_page,
    fetch_page_text_pk,
    probe_crm_columns,
)
from .schema import quote_ident
from .state import (
    connect,
    count_phases,
    release_table_lock,
    try_acquire_table_lock,
    tx,
    update_table_state,
    utcnow,
)
from .worker import claim_worker, release_worker
from .write import insert_rows, mirror_columns, mirror_count, truncate_mirror_table

_DONE_PHASES = frozenset({PHASE_CATCHING_UP, PHASE_VERIFIED, PHASE_LIVE})


def _is_pooler_error(msg: str) -> bool:
    lower = msg.lower()
    return "prepared statement" in lower or "duplicatepreparedstatement" in lower


def _resolve_columns(conn, table: str, pk: str | None, sess: requests.Session) -> list[str]:
    cols = mirror_columns(conn, table)
    if cols:
        return cols
    probed = probe_crm_columns(table, session=sess)
    if probed:
        return probed
    return [pk] if pk else ["ncode"]


def _cursor_from_state(state: dict[str, Any]) -> str | None:
    if state.get("last_cursor"):
        return str(state["last_cursor"])
    if state.get("last_ncode") is not None:
        return str(state["last_ncode"])
    return None


def _heap_offset_from_state(state: dict[str, Any]) -> int:
    raw = state.get("last_cursor") or state.get("rows_loaded") or 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return int(state.get("rows_loaded") or 0)


def seal_backfill_complete(
    conn,
    *,
    table_name: str,
    session: requests.Session,
) -> bool:
    """Row-count parity — no bigint PK seal."""
    crm_total = crm_count(table_name, session=session)
    mirror_total = mirror_count(conn, table_name)
    update_table_state(conn, table_name, crm_row_count=crm_total)
    return mirror_total == crm_total


def run_backfill_table(table_name: str, *, session: requests.Session | None = None) -> dict[str, Any]:
    sess = session or requests.Session()
    table = table_name.lower()

    try:
        return _run_backfill_table_impl(table, sess)
    except psycopg.errors.DuplicatePreparedStatement as exc:
        return {"ok": False, "table": table, "error": str(exc), "pooler": True, "retry": True}
    except Exception as exc:
        msg = str(exc)
        if _is_pooler_error(msg):
            return {"ok": False, "table": table, "error": msg, "pooler": True, "retry": True}
        return {"ok": False, "table": table, "error": msg}


def _run_backfill_table_impl(table: str, sess: requests.Session) -> dict[str, Any]:
    with connect() as conn:
        state = conn.execute(
            "SELECT * FROM crm_mirror.sync_state WHERE table_name = %s",
            (table,),
        ).fetchone()
        if not state:
            return {"ok": False, "error": f"Unknown table {table}"}
        state = dict(state)

        if state["phase"] in _DONE_PHASES:
            return {"ok": True, "already_done": True, "table": table, "phase": state["phase"]}

        if state["phase"] == PHASE_BACKFILLING:
            return {"ok": False, "skipped": True, "table": table, "error": "Already backfilling elsewhere"}

        if state["phase"] not in (PHASE_PENDING, PHASE_ERROR):
            return {
                "ok": False,
                "skipped": True,
                "table": table,
                "error": f"Unexpected phase {state['phase']}",
            }

        if not try_acquire_table_lock(conn, table):
            return {"ok": False, "skipped": True, "table": table, "error": "Table lock held by another run"}

        capability = state["sync_capability"]
        pk = state.get("pk_column")
        is_heap = capability == CAP_HEAP_SCAN or not pk

        try:
            columns = _resolve_columns(conn, table, pk, sess)
            resume_cursor = _cursor_from_state(state)
            resume_offset = _heap_offset_from_state(state) if is_heap else 0
            fresh_start = state["phase"] == PHASE_PENDING and not resume_cursor and resume_offset == 0

            with tx(conn):
                if fresh_start:
                    truncate_mirror_table(conn, table)
                update_table_state(
                    conn,
                    table,
                    phase=PHASE_BACKFILLING,
                    backfill_started_at=utcnow() if fresh_start else state.get("backfill_started_at"),
                    catchup_empty_passes=0,
                )

            total_rows = int(state.get("rows_loaded") or 0) if not fresh_start else 0
            page_size = PAGE_SIZE

            if is_heap:
                offset = resume_offset if not fresh_start else 0
                while True:
                    batch_id = start_batch(
                        conn,
                        table_name=table,
                        phase=PHASE_BACKFILLING,
                        cursor_start=offset,
                    )
                    try:
                        rows, used_size = fetch_heap_page(
                            table_name=table,
                            offset=offset,
                            page_size=page_size,
                            session=sess,
                        )
                        if not rows:
                            with tx(conn):
                                complete_batch(
                                    conn,
                                    batch_id=batch_id,
                                    row_count=0,
                                    cursor_end=offset,
                                    rows=[],
                                    pk_column=pk or "ncode",
                                )
                            break

                        with tx(conn):
                            written = insert_rows(
                                conn,
                                table_name=table,
                                columns=columns,
                                rows=rows,
                                batch_id=batch_id,
                            )
                            offset += written
                            complete_batch(
                                conn,
                                batch_id=batch_id,
                                row_count=written,
                                cursor_end=offset,
                                rows=rows,
                                pk_column=pk or "ncode",
                            )
                            update_table_state(
                                conn,
                                table,
                                last_cursor=str(offset),
                                rows_loaded=total_rows + written,
                            )
                            total_rows += written

                        if len(rows) < used_size:
                            break
                    except Exception as exc:
                        fail_batch(conn, batch_id, str(exc))
                        raise

            elif capability == CAP_SMALL_SNAPSHOT:
                rows = fetch_all_text_pk(
                    table_name=table,
                    pk_column=pk,
                    after_cursor=resume_cursor,
                    page_size=page_size,
                    session=sess,
                )
                batch_id = start_batch(
                    conn,
                    table_name=table,
                    phase=PHASE_BACKFILLING,
                    cursor_start=resume_cursor,
                )
                try:
                    with tx(conn):
                        written = insert_rows(
                            conn,
                            table_name=table,
                            columns=columns,
                            rows=rows,
                            batch_id=batch_id,
                        )
                        end_cursor = None
                        if rows:
                            for key in rows[-1]:
                                if key.lower() == pk.lower():
                                    end_cursor = str(rows[-1][key]).strip()
                                    break
                        complete_batch(
                            conn,
                            batch_id=batch_id,
                            row_count=written,
                            cursor_end=end_cursor,
                            rows=rows,
                            pk_column=pk,
                        )
                        total_rows += written
                except Exception as exc:
                    fail_batch(conn, batch_id, str(exc))
                    raise
            else:
                cursor = resume_cursor
                while True:
                    batch_id = start_batch(
                        conn,
                        table_name=table,
                        phase=PHASE_BACKFILLING,
                        cursor_start=cursor,
                    )
                    try:
                        rows, used_size = fetch_page_text_pk(
                            table_name=table,
                            pk_column=pk,
                            after_cursor=cursor,
                            page_size=page_size,
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
                            written = insert_rows(
                                conn,
                                table_name=table,
                                columns=columns,
                                rows=rows,
                                batch_id=batch_id,
                            )
                            end_cursor = cursor
                            for key in rows[-1]:
                                if key.lower() == pk.lower():
                                    end_cursor = str(rows[-1][key]).strip()
                                    break
                            complete_batch(
                                conn,
                                batch_id=batch_id,
                                row_count=written,
                                cursor_end=end_cursor,
                                rows=rows,
                                pk_column=pk,
                            )
                            update_table_state(
                                conn,
                                table,
                                last_cursor=end_cursor,
                                rows_loaded=total_rows + written,
                            )
                            total_rows += written
                            cursor = end_cursor

                        if len(rows) < used_size:
                            break
                    except Exception as exc:
                        fail_batch(conn, batch_id, str(exc))
                        raise

            with tx(conn):
                if not seal_backfill_complete(
                    conn,
                    table_name=table,
                    session=sess,
                ):
                    crm_total = crm_count(table, session=sess)
                    mirror_total = mirror_count(conn, table)
                    raise RuntimeError(
                        f"Row count mismatch after backfill: CRM={crm_total} mirror={mirror_total} loaded={total_rows}"
                    )

                update_table_state(
                    conn,
                    table,
                    phase=PHASE_CATCHING_UP,
                    backfill_completed_at=utcnow(),
                    rows_loaded=total_rows,
                    catchup_empty_passes=0,
                )

            return {"ok": True, "table": table, "rows_loaded": total_rows}
        except Exception as exc:
            msg = str(exc)
            with tx(conn):
                if _is_pooler_error(msg):
                    update_table_state(
                        conn,
                        table,
                        phase=PHASE_PENDING,
                        last_error=msg[:500],
                        is_running=False,
                    )
                    return {"ok": False, "table": table, "error": msg, "pooler": True, "retry": True}
                update_table_state(
                    conn,
                    table,
                    phase=PHASE_ERROR,
                    last_error=str(exc)[:2000],
                )
            return {"ok": False, "table": table, "error": str(exc)}
        finally:
            release_table_lock(conn, table)


def _pending_backfill_tables(conn) -> list[str]:
    rows = conn.execute(
        """
        SELECT table_name FROM crm_mirror.sync_state
        WHERE phase IN ('pending', 'error')
        ORDER BY size_kb NULLS LAST, table_name
        """
    ).fetchall()
    return [r["table_name"] for r in rows]


def _log_backfill_result(name: str, result: dict[str, Any]) -> None:
    if result.get("already_done") or result.get("skipped"):
        return
    if result.get("ok"):
        rows = result.get("rows_loaded")
        if rows is not None:
            print(f"[crm-mirror] backfill ok on {name}: {rows} rows", flush=True)
        return
    if result.get("pooler"):
        print(f"[crm-mirror] backfill pooler retry on {name} (will retry next pass)", flush=True)
        return
    print(f"[crm-mirror] backfill failed on {name}: {result.get('error')}", flush=True)


def run_backfill(
    *,
    table: str | None = None,
    until_done: bool = False,
    max_rounds: int = 100,
) -> dict[str, Any]:
    sess = requests.Session()

    if table:
        result = run_backfill_table(table, session=sess)
        _log_backfill_result(table.lower(), result)
        return {"rounds": 1, "results": [result], "phases": _fetch_phases()}

    if not claim_worker():
        return {
            "ok": False,
            "error": "Another backfill run is active (check logs/crm-mirror.pid or click Stop then Resume)",
            "phases": _fetch_phases(),
        }

    try:
        totals = {"ok": 0, "pooler": 0, "failed": 0, "already_done": 0}
        all_results: list[dict[str, Any]] = []
        rounds = 0

        while rounds < max_rounds:
            rounds += 1
            repair = repair_catalog_fast()
            if repair.get("reset_pooler_errors") or repair.get("reset_to_pending"):
                print(f"[crm-mirror] repair pass: {repair}", flush=True)

            with connect() as conn:
                names = _pending_backfill_tables(conn)

            if not names:
                break

            print(f"[crm-mirror] backfill round {rounds}: {len(names)} tables queued", flush=True)
            for name in names:
                try:
                    result = run_backfill_table(name, session=sess)
                except Exception as exc:
                    result = {"ok": False, "table": name, "error": str(exc)}
                all_results.append(result)
                _log_backfill_result(name, result)
                if result.get("ok") and not result.get("already_done"):
                    totals["ok"] += 1
                elif result.get("already_done"):
                    totals["already_done"] += 1
                elif result.get("pooler"):
                    totals["pooler"] += 1
                elif not result.get("skipped"):
                    totals["failed"] += 1

            phases = _fetch_phases()
            pending = phases.get(PHASE_PENDING, 0)
            errors = phases.get(PHASE_ERROR, 0)
            print(
                f"[crm-mirror] round {rounds} done — "
                f"catching_up={phases.get(PHASE_CATCHING_UP, 0)} "
                f"pending={pending} error={errors}",
                flush=True,
            )
            if not until_done or (pending == 0 and errors == 0):
                break

        phases = _fetch_phases()
        summary = {
            "ok": True,
            "rounds": rounds,
            "totals": totals,
            "phases": phases,
            "complete": phases.get(PHASE_PENDING, 0) == 0 and phases.get(PHASE_ERROR, 0) == 0,
        }
        print(f"[crm-mirror] backfill summary: {summary}", flush=True)
        return summary
    finally:
        release_worker()


def _fetch_phases() -> dict[str, int]:
    with connect() as conn:
        return count_phases(conn)
