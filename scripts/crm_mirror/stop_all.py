from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

import psycopg

from .state import connect
from .worker import LOG_PATH, PID_PATH, clear_stale_worker, read_pid, release_worker, stop_worker_process

DEFAULT_PORT = 8765


def _append_log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as log:
        log.write(message + "\n")


def _kill_pids(pids: set[int], *, label: str) -> list[int]:
    my_pid = os.getpid()
    my_ppid = os.getppid()
    killed: list[int] = []
    for pid in sorted(pids):
        if pid <= 0 or pid in (my_pid, my_ppid):
            continue
        try:
            if sys.platform == "win32":
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/F"],
                    check=False,
                    capture_output=True,
                )
            else:
                os.kill(pid, 15)
            killed.append(pid)
        except OSError:
            pass
    if killed:
        _append_log(f"[stop-all] killed {label}: {killed}")
    return killed


def _find_crm_mirror_pids() -> set[int]:
    pids: set[int] = set()
    pid = read_pid()
    if pid:
        pids.add(pid)

    if sys.platform == "win32":
        try:
            out = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "Get-CimInstance Win32_Process | "
                    "Where-Object { "
                    "  $_.CommandLine -match 'crm_mirror_sync\\.py' "
                    "  -and $_.CommandLine -notmatch 'stop-all' "
                    "  -and $_.CommandLine -notmatch ' reset' "
                    "} | "
                    "Select-Object -ExpandProperty ProcessId",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            for line in out.stdout.splitlines():
                line = line.strip()
                if line.isdigit():
                    pids.add(int(line))
        except OSError:
            pass
    else:
        try:
            out = subprocess.run(
                ["pgrep", "-f", "crm_mirror_sync"],
                check=False,
                capture_output=True,
                text=True,
            )
            for line in out.stdout.splitlines():
                line = line.strip()
                if line.isdigit():
                    pids.add(int(line))
        except OSError:
            pass

    return pids


def _find_port_pids(port: int) -> set[int]:
    pids: set[int] = set()
    if sys.platform == "win32":
        try:
            out = subprocess.run(
                ["netstat", "-ano"],
                check=False,
                capture_output=True,
                text=True,
            )
            needle = f":{port}"
            for line in out.stdout.splitlines():
                if needle not in line or "LISTENING" not in line.upper():
                    continue
                parts = line.split()
                if parts and parts[-1].isdigit():
                    pids.add(int(parts[-1]))
        except OSError:
            pass
    else:
        try:
            out = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                check=False,
                capture_output=True,
                text=True,
            )
            for line in out.stdout.splitlines():
                line = line.strip()
                if line.isdigit():
                    pids.add(int(line))
        except OSError:
            pass
    return pids


def terminate_db_sessions(*, include_drop: bool = False) -> dict[str, Any]:
    terminated: list[dict[str, Any]] = []
    with connect() as conn:
        conn.autocommit = True
        try:
            conn.execute(
                "UPDATE crm_mirror.sync_state SET is_running = false WHERE is_running = true"
            )
        except psycopg.Error:
            pass

        rows = conn.execute(
            """
            SELECT pid, left(query, 160) AS query
            FROM pg_stat_activity
            WHERE datname = current_database()
              AND pid <> pg_backend_pid()
              AND (
                query ILIKE '%crm_raw%'
                OR query ILIKE '%crm_mirror%'
                OR query ILIKE '%pg_advisory_lock%'
                OR query ILIKE '%pg_advisory_unlock%'
              )
            """
        ).fetchall()

        for row in rows:
            pid = row["pid"]
            query = row["query"] or ""
            if not include_drop and "DROP SCHEMA" in query.upper():
                continue
            try:
                conn.execute("SELECT pg_terminate_backend(%s)", (pid,))
                terminated.append({"pid": pid, "query": query})
            except psycopg.Error as exc:
                terminated.append({"pid": pid, "query": query, "error": str(exc)})

    return {"terminated_sessions": len(terminated), "sessions": terminated}


def stop_all_sync(*, dashboard_port: int = DEFAULT_PORT) -> dict[str, Any]:
    """Stop dashboard, backfill workers, and DB sessions touching the mirror."""
    _append_log("[stop-all] === stopping all CRM mirror sync ===")

    worker = stop_worker_process()
    clear_stale_worker()
    release_worker()

    dashboard_pids = _find_port_pids(dashboard_port)
    mirror_pids = _find_crm_mirror_pids()
    all_pids = dashboard_pids | mirror_pids

    killed_dashboard = _kill_pids(dashboard_pids, label="dashboard")
    killed_mirror = _kill_pids(all_pids - dashboard_pids, label="crm_mirror_sync")

    db = terminate_db_sessions(include_drop=False)

    PID_PATH.unlink(missing_ok=True)

    result = {
        "ok": True,
        "worker": worker,
        "killed_dashboard_pids": killed_dashboard,
        "killed_mirror_pids": killed_mirror,
        "db": db,
        "message": "All CRM mirror sync stopped. Safe to reset.",
    }
    _append_log(f"[stop-all] done: {result}")
    return result
