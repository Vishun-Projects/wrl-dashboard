from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .catalog import repair_catalog_fast
from .config import ROOT, load_env_files
from .schema import quote_ident
from .state import connect, count_phases, get_table_state
from .worker import LOG_PATH, clear_stale_worker, is_pid_running, read_pid, stop_worker_process, worker_status
from .write import mirror_count

DEFAULT_PORT = 8765
SYNC_SCRIPT = ROOT / "scripts" / "crm_mirror_sync.py"
DASHBOARD_HTML_PATH = Path(__file__).resolve().parent / "dashboard.html"

_BACKFILL_DONE_PHASES = frozenset({"catching_up", "verified", "live"})

PHASE_LEGEND: dict[str, dict[str, str]] = {
    "pending": {"label": "Queued", "help": "waiting for backfill — not copied yet"},
    "backfilling": {"label": "Importing", "help": "CRM data is being copied right now"},
    "catching_up": {
        "label": "Backfill done",
        "help": "full copy finished — catchup & verify not run yet (this IS done for backfill)",
    },
    "verified": {"label": "Verified", "help": "passed exactness gates vs CRM"},
    "live": {"label": "Live", "help": "incremental sync active"},
    "error": {"label": "Error", "help": "failed — click Retry or fix manually"},
    "blocked": {"label": "Blocked", "help": "no usable PK in CRM — intentionally skipped"},
}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table_progress(row: dict[str, Any]) -> float | None:
    phase = row.get("phase") or "pending"
    if phase == "blocked":
        return None
    crm = int(row.get("crm_row_count") or 0)
    loaded = int(row.get("rows_loaded") or 0)
    if crm > 0:
        return min(100.0, round(loaded / crm * 100, 1))
    if phase in _BACKFILL_DONE_PHASES:
        return 100.0
    if phase == "pending":
        return 0.0
    if phase == "backfilling":
        return None
    return 0.0


def _phase_info(phase: str) -> dict[str, str]:
    return PHASE_LEGEND.get(phase, {"label": phase, "help": ""})


def _read_log_tail(lines: int = 80) -> list[str]:
    if not LOG_PATH.is_file():
        return []
    try:
        content = LOG_PATH.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    return content.splitlines()[-lines:]


def fetch_dashboard_data() -> dict[str, Any]:
    with connect() as conn:
        phases = count_phases(conn)
        rows = conn.execute(
            """
            SELECT
              table_name, phase, sync_capability, pk_column,
              crm_row_count, rows_loaded, size_kb, is_running,
              last_error, backfill_started_at, backfill_completed_at, last_run_at
            FROM crm_mirror.sync_state
            ORDER BY
              CASE phase
                WHEN 'backfilling' THEN 0
                WHEN 'pending' THEN 1
                WHEN 'error' THEN 2
                WHEN 'catching_up' THEN 3
                WHEN 'verified' THEN 4
                WHEN 'live' THEN 5
                WHEN 'blocked' THEN 6
                ELSE 7
              END,
              size_kb DESC NULLS LAST,
              table_name
            """
        ).fetchall()
        ddl_count = int(
            conn.execute(
                "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = 'crm_raw'"
            ).fetchone()["cnt"]
        )
        tables_with_data = int(
            conn.execute(
                """
                SELECT COUNT(*) AS cnt FROM crm_mirror.sync_state
                WHERE phase IN ('catching_up', 'verified', 'live', 'backfilling')
                  AND rows_loaded > 0
                """
            ).fetchone()["cnt"]
        )

    tables: list[dict[str, Any]] = []
    total_crm_rows = 0
    total_loaded_rows = 0
    syncable = 0
    done_count = 0

    for raw in rows:
        row = dict(raw)
        for key in ("backfill_started_at", "backfill_completed_at", "last_run_at"):
            if row.get(key) is not None:
                row[key] = row[key].isoformat()
        pct = _table_progress(row)
        row["progress_pct"] = pct
        info = _phase_info(row["phase"])
        row["phase_label"] = info["label"]
        row["phase_help"] = info["help"]
        row["backfill_complete"] = row["phase"] in _BACKFILL_DONE_PHASES
        crm = int(row.get("crm_row_count") or 0)
        loaded = int(row.get("rows_loaded") or 0)
        row["row_count_match"] = None
        if row["phase"] != "blocked":
            syncable += 1
            total_crm_rows += crm
            if row["backfill_complete"]:
                done_count += 1
                total_loaded_rows += loaded if loaded > 0 else crm
            else:
                total_loaded_rows += loaded
        tables.append(row)

    row_pct = round(total_loaded_rows / total_crm_rows * 100, 1) if total_crm_rows else 0.0
    table_pct = round(done_count / syncable * 100, 1) if syncable else 0.0
    log_tail = _read_log_tail(80)
    worker = worker_status(log_tail=log_tail)

    pending = phases.get("pending", 0)
    importing = phases.get("backfilling", 0)
    backfill_done = phases.get("catching_up", 0) + phases.get("verified", 0) + phases.get("live", 0)
    if worker.get("running") or importing > 0 or pending > 0:
        data_step_status = "active"
    elif backfill_done > 0:
        data_step_status = "done"
    else:
        data_step_status = "waiting"

    pipeline = [
        {
            "step": 1,
            "name": "Catalog",
            "status": "done",
            "title": "Discover tables",
            "detail": f"{len(tables)} CRM tables registered in sync_state",
        },
        {
            "step": 2,
            "name": "Empty tables",
            "status": "done",
            "title": "Create Postgres structure (DDL)",
            "detail": f"{ddl_count} empty crm_raw.* tables — columns only, no row data yet",
        },
        {
            "step": 3,
            "name": "Import data",
            "status": data_step_status,
            "title": "Copy rows from Western CRM",
            "detail": (
                f"{backfill_done} tables have data · {pending} queued (big tables like trhcalls) · "
                f"{tables_with_data} with rows_loaded > 0"
            ),
        },
        {
            "step": 4,
            "name": "Catchup",
            "status": "waiting",
            "title": "Replay changes during import",
            "detail": "Run after step 3 completes (not started yet)",
        },
        {
            "step": 5,
            "name": "Verify",
            "status": "waiting",
            "title": "Prove CRM row counts match mirror",
            "detail": "Mandatory before live sync",
        },
    ]

    return {
        "updated_at": _utcnow_iso(),
        "phases": phases,
        "phase_legend": PHASE_LEGEND,
        "pipeline": pipeline,
        "summary": {
            "total_tables": len(tables),
            "syncable_tables": syncable,
            "blocked_tables": phases.get("blocked", 0),
            # Use DB phase counts (same source as `crm_mirror_sync.py status`)
            "backfill_done": backfill_done,
            "done_tables": backfill_done,
            "queued": pending,
            "importing": importing,
            "errors": phases.get("error", 0),
            "blocked": phases.get("blocked", 0),
            "ddl_tables": ddl_count,
            "tables_with_data": tables_with_data,
            "table_progress_pct": round(backfill_done / syncable * 100, 1) if syncable else 0.0,
            "row_progress_pct": row_pct,
            "total_crm_rows": total_crm_rows,
            "total_loaded_rows": total_loaded_rows,
        },
        "worker": worker,
        "tables": tables,
        "log_tail": log_tail,
    }


def start_backfill(*, until_done: bool = True) -> dict[str, Any]:
    clear_stale_worker()
    if is_pid_running(read_pid()):
        return {"ok": False, "error": "Backfill already running", "pid": read_pid()}
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as log:
        log.write(f"\n=== {_utcnow_iso()} dashboard resume ===\n")
        log.flush()
        cmd = [sys.executable, str(SYNC_SCRIPT), "backfill"]
        if until_done:
            cmd.append("--until-done")
        subprocess.Popen(
            cmd,
            stdout=log,
            stderr=subprocess.STDOUT,
            cwd=str(ROOT),
            start_new_session=True,
        )
    return {"ok": True, "message": "Backfill started — PID will appear when worker claims job"}


def stop_backfill() -> dict[str, Any]:
    result = stop_worker_process()
    with connect() as conn:
        conn.execute("UPDATE crm_mirror.sync_state SET is_running = false WHERE is_running = true")
        conn.commit()
    return result


def run_repair_fast() -> dict[str, Any]:
    return {"ok": True, **repair_catalog_fast()}


def retry_table(table_name: str) -> dict[str, Any]:
    table = table_name.strip().lower()
    if not table:
        return {"ok": False, "error": "table name required"}
    with connect() as conn:
        conn.execute(
            """
            UPDATE crm_mirror.sync_state
            SET phase = 'pending', last_error = NULL, is_running = false
            WHERE table_name = %s AND phase IN ('error', 'backfilling')
            """,
            (table,),
        )
        conn.commit()
    return {"ok": True, "table": table}


def retry_all_errors() -> dict[str, Any]:
    with connect() as conn:
        count = conn.execute(
            """
            UPDATE crm_mirror.sync_state
            SET phase = 'pending', last_error = NULL, is_running = false
            WHERE phase = 'error'
            """
        ).rowcount
        conn.commit()
    return {"ok": True, "reset": count}


def handle_action(body: dict[str, Any]) -> dict[str, Any]:
    action = (body.get("action") or "").strip().lower()
    if action == "resume":
        repair = run_repair_fast()
        started = start_backfill(until_done=True)
        return {"ok": started.get("ok", False), "repair": repair, "worker": started}
    if action == "repair":
        return run_repair_fast()
    if action == "stop":
        return stop_backfill()
    if action == "retry_all":
        return retry_all_errors()
    if action == "retry_table":
        return retry_table(str(body.get("table") or ""))
    return {"ok": False, "error": f"Unknown action: {action}"}


def _mirror_table_exists(conn, table: str) -> bool:
    row = conn.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'crm_raw' AND table_name = %s
        """,
        (table,),
    ).fetchone()
    return row is not None


def fetch_table_detail(
    table_name: str,
    *,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    table = table_name.strip().lower()
    if not table or not re.match(r"^[a-z0-9_$]+$", table):
        return {"ok": False, "error": "Invalid table name"}

    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    offset = (page - 1) * page_size

    with connect() as conn:
        meta = get_table_state(conn, table)
        if not meta:
            return {"ok": False, "error": f"Unknown table {table}"}

        has_mirror = _mirror_table_exists(conn, table)
        mirror_rows = 0
        columns: list[str] = []
        rows: list[dict[str, Any]] = []

        if has_mirror:
            mirror_rows = mirror_count(conn, table)
            col_rows = conn.execute(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'crm_raw' AND table_name = %s
                ORDER BY ordinal_position
                """,
                (table,),
            ).fetchall()
            columns = [r["column_name"] for r in col_rows if not r["column_name"].startswith("_mirror_")]

            pk = (meta.get("pk_column") or "ncode").lower()
            order_expr = quote_ident(pk) if pk in {c.lower() for c in columns} else quote_ident(columns[0]) if columns else "1"
            raw_table = f"crm_raw.{quote_ident(table)}"
            data_rows = conn.execute(
                f"""
                SELECT * FROM {raw_table}
                WHERE _mirror_deleted_at IS NULL
                ORDER BY {order_expr}
                LIMIT %s OFFSET %s
                """,
                (page_size, offset),
            ).fetchall()
            for dr in data_rows:
                item = {c: dr.get(c) for c in columns}
                rows.append(item)

        crm_count = int(meta.get("crm_row_count") or 0)
        loaded = int(meta.get("rows_loaded") or 0)
        info = _phase_info(meta["phase"])
        match = mirror_rows == crm_count if has_mirror and crm_count > 0 else None

        return {
            "ok": True,
            "table_name": table,
            "phase": meta["phase"],
            "phase_label": info["label"],
            "phase_help": info["help"],
            "pk_column": meta.get("pk_column"),
            "crm_row_count": crm_count,
            "rows_loaded": loaded,
            "mirror_row_count": mirror_rows,
            "row_count_match": match,
            "has_mirror_table": has_mirror,
            "backfill_started_at": meta.get("backfill_started_at"),
            "backfill_completed_at": meta.get("backfill_completed_at"),
            "last_error": meta.get("last_error"),
            "columns": columns,
            "rows": rows,
            "page": page,
            "page_size": page_size,
        }


def load_dashboard_html() -> str:
    return DASHBOARD_HTML_PATH.read_text(encoding="utf-8")




class DashboardHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        return

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        try:
            if path in ("/", "/index.html"):
                self._send_html(load_dashboard_html())
            elif path == "/api/status":
                self._send_json(fetch_dashboard_data())
            elif path == "/api/version":
                self._send_json({"version": 2, "html": "dashboard.html"})
            elif path.startswith("/api/table/"):
                table = urlparse(self.path).path.split("/api/table/", 1)[1].strip("/")
                qs = parse_qs(urlparse(self.path).query)
                page = int(qs.get("page", ["1"])[0])
                limit = int(qs.get("limit", ["50"])[0])
                self._send_json(fetch_table_detail(table, page=page, page_size=limit))
            elif path == "/api/log":
                qs = parse_qs(urlparse(self.path).query)
                lines = int(qs.get("lines", ["80"])[0])
                self._send_json({"lines": _read_log_tail(lines)})
            else:
                self.send_error(404)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=500)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/api/action":
                result = handle_action(self._read_json_body())
                self._send_json(result)
            else:
                self.send_error(404)
        except Exception as exc:
            self._send_json({"ok": False, "error": str(exc)}, status=500)


def run_dashboard(*, host: str = "127.0.0.1", port: int = DEFAULT_PORT) -> None:
    load_env_files()
    server = ThreadingHTTPServer((host, port), DashboardHandler)
    print(f"CRM mirror dashboard: http://{host}:{port}", flush=True)
    print("Press Ctrl+C to stop the dashboard (backfill keeps running in background)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDashboard stopped.", flush=True)
    finally:
        server.server_close()
