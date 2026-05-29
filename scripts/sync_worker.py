#!/usr/bin/env python3
"""
One-shot CLI wrapper for read-model backfill jobs (calls + ARCP).

Live CRM->Postgres sync runs in the app while users are logged in (PostgresAutoSync).
Use this script only for initial backfill / maintenance from a terminal.

  python scripts/sync_worker.py backfill
  python scripts/sync_worker.py arcp-backfill

Requires: Node.js, npm install, DATABASE_URL
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLI_REL = "src/lib/read-model/cli.ts"
ENV_FILES = (".env.local", ".env")

BACKFILL_COMMANDS = frozenset(
    {"backfill", "arcp-backfill", "dims", "nightly", "retention", "incremental", "arcp-incremental", "once"}
)


def load_env_files() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        for name in ENV_FILES:
            path = ROOT / name
            if not path.is_file():
                continue
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
        return

    for name in ENV_FILES:
        path = ROOT / name
        if path.is_file():
            load_dotenv(path, override=False)


def tsx_argv(ts_command: str) -> list[str]:
    cli = ROOT / CLI_REL
    if not cli.is_file():
        raise FileNotFoundError(f"Missing {cli} — run from repo root")
    if sys.platform == "win32":
        return ["cmd", "/c", "npx", "tsx", str(cli), ts_command]
    return ["npx", "tsx", str(cli), ts_command]


def run_ts(command: str) -> int:
    env = os.environ.copy()
    env.setdefault("USE_DIRECT_DATABASE", "true")
    print(f"[sync-worker-py] -> npx tsx cli.ts {command}")
    proc = subprocess.run(tsx_argv(command), cwd=str(ROOT), env=env)
    if proc.returncode != 0:
        print(f"[sync-worker-py] '{command}' exited {proc.returncode}", file=sys.stderr)
    return proc.returncode


def main() -> int:
    load_env_files()

    parser = argparse.ArgumentParser(
        description="Terminal backfill/maintenance for CRM -> Postgres read model",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Live sync: open the app while logged in (auto-sync every ~3 min via POST /api/read-model/sync).

Common commands (same as npm run sync-worker:<cmd>):
  backfill        Initial calls hot + facts load
  arcp-backfill   ARCP lines (restart-safe; arcp-reset to wipe first)
  once            Single incremental cycle (calls + ARCP if enabled)
        """,
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="help",
        choices=["help", *sorted(BACKFILL_COMMANDS)],
    )
    args = parser.parse_args()

    if args.command == "help":
        parser.print_help()
        return 0

    return run_ts(args.command)


if __name__ == "__main__":
    raise SystemExit(main())
