from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from .config import ROOT

PID_PATH = ROOT / "logs" / "crm-mirror.pid"
LOG_PATH = ROOT / "logs" / "crm-mirror-run.log"


def read_pid() -> int | None:
    if not PID_PATH.is_file():
        return None
    try:
        return int(PID_PATH.read_text(encoding="utf-8").strip())
    except ValueError:
        return None


def is_pid_running(pid: int | None) -> bool:
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def claim_worker() -> bool:
    """Mark this process as the active backfill worker (PID file)."""
    pid = read_pid()
    if is_pid_running(pid):
        return False
    PID_PATH.parent.mkdir(parents=True, exist_ok=True)
    PID_PATH.write_text(str(os.getpid()), encoding="utf-8")
    return True


def release_worker() -> None:
    PID_PATH.unlink(missing_ok=True)


def clear_stale_worker() -> None:
    pid = read_pid()
    if not is_pid_running(pid):
        PID_PATH.unlink(missing_ok=True)


def worker_status(*, log_tail: list[str] | None = None) -> dict:
    pid = read_pid()
    running = is_pid_running(pid)
    if not running:
        PID_PATH.unlink(missing_ok=True)
        pid = None

    message = "Worker stopped"
    if running:
        message = f"Importing CRM data (PID {pid})"
    elif log_tail:
        for line in reversed(log_tail):
            if "Another backfill run is active" in line:
                message = "Resume blocked — stale lock (click Resume again; fixed in latest code)"
                break
            if "backfill summary" in line:
                message = "Worker finished a run — click Resume to continue queued tables"
                break
            if line.startswith("[crm-mirror] backfill ok on"):
                message = "Worker stopped mid-run — click Resume to continue"
                break

    return {"running": running, "pid": pid, "message": message}


def stop_worker_process() -> dict:
    pid = read_pid()
    if not is_pid_running(pid):
        clear_stale_worker()
        return {"ok": True, "stopped": False, "message": "No worker running"}

    assert pid is not None
    try:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=False, capture_output=True)
        else:
            os.kill(pid, 15)
    except OSError:
        pass
    release_worker()
    return {"ok": True, "stopped": True, "pid": pid}
