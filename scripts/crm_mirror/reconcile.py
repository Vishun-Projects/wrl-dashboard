from __future__ import annotations

from typing import Any

import requests

from .config import CAP_PK_ONLY, FETCH_GAP_MS, PAGE_SIZE, PHASE_LIVE, PHASE_VERIFYING
from .fetch_pages import crm_count, fetch_page
from .state import connect, tx, update_table_state
from .verify import verify_table
from .write import list_active_pks, mirror_count, tombstone_missing_pks


def reconcile_table(table_name: str, *, session: requests.Session | None = None) -> dict[str, Any]:
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
            return {"ok": False, "error": f"Table phase is {state['phase']}, expected live"}

        pk = state["pk_column"] or "ncode"
        capability = state["sync_capability"]

        if capability == CAP_PK_ONLY:
            present: set[int] = set()
            cursor = None
            while True:
                rows, used = fetch_page(
                    table_name=table,
                    pk_column=pk,
                    after_pk=cursor,
                    page_size=500,
                    session=sess,
                )
                if not rows:
                    break
                for row in rows:
                    try:
                        present.add(int(float(str(row.get(pk, "")))))
                    except (TypeError, ValueError):
                        pass
                try:
                    cursor = int(float(str(rows[-1].get(pk, ""))))
                except (TypeError, ValueError):
                    break
                if len(rows) < used:
                    break
        else:
            present = set()
            cursor = None
            while True:
                rows, used = fetch_page(
                    table_name=table,
                    pk_column=pk,
                    after_pk=cursor,
                    page_size=500,
                    session=sess,
                )
                if not rows:
                    break
                for row in rows:
                    try:
                        present.add(int(float(str(row.get(pk, "")))))
                    except (TypeError, ValueError):
                        pass
                try:
                    cursor = int(float(str(rows[-1].get(pk, ""))))
                except (TypeError, ValueError):
                    break
                if len(rows) < used:
                    break

        with tx(conn):
            tombstoned = tombstone_missing_pks(
                conn, table_name=table, pk_column=pk, present_pks=present
            )
            update_table_state(
                conn,
                table,
                rows_tombstoned=(state.get("rows_tombstoned") or 0) + tombstoned,
            )

        crm_cnt = crm_count(table, session=sess)
        mir_cnt = mirror_count(conn, table)
        drift = crm_cnt != mir_cnt

        result = {
            "ok": True,
            "table": table,
            "tombstoned": tombstoned,
            "crm_count": crm_cnt,
            "mirror_count": mir_cnt,
            "drift": drift,
        }

        if drift:
            with tx(conn):
                update_table_state(conn, table, phase=PHASE_VERIFYING)
            verify_table(table, session=sess)

        return result


def run_reconcile(*, table: str | None = None) -> list[dict[str, Any]]:
    sess = requests.Session()
    with connect() as conn:
        if table:
            names = [table.lower()]
        else:
            rows = conn.execute(
                "SELECT table_name FROM crm_mirror.sync_state WHERE phase = 'live' ORDER BY table_name"
            ).fetchall()
            names = [r["table_name"] for r in rows]

    return [reconcile_table(name, session=sess) for name in names]


def weekly_count_audit(*, session: requests.Session | None = None) -> list[dict[str, Any]]:
    sess = session or requests.Session()
    results: list[dict[str, Any]] = []
    with connect() as conn:
        rows = conn.execute(
            "SELECT table_name FROM crm_mirror.sync_state WHERE phase = 'live' ORDER BY table_name"
        ).fetchall()
        for row in rows:
            table = row["table_name"]
            crm_cnt = crm_count(table, session=sess)
            mir_cnt = mirror_count(conn, table)
            drift = crm_cnt != mir_cnt
            entry = {"table": table, "crm_count": crm_cnt, "mirror_count": mir_cnt, "drift": drift}
            if drift:
                with tx(conn):
                    update_table_state(conn, table, phase=PHASE_VERIFYING)
                verify_table(table, session=sess)
            results.append(entry)
    return results
