from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .backfill import run_backfill
from .catalog import init_catalog, repair_catalog
from .reset import reset_old_crm
from .stop_all import stop_all_sync
from .catchup import run_catchup
from .config import load_env_files
from .dashboard import run_dashboard
from .live import run_live_cycle, run_live_daemon
from .reconcile import run_reconcile, weekly_count_audit
from .state import connect, status_summary
from .verify import run_verify, verify_table


def cmd_stop_all(args: argparse.Namespace) -> int:
    result = stop_all_sync(dashboard_port=args.port)
    print(json.dumps(result, indent=2))
    return 0


def cmd_reset(args: argparse.Namespace) -> int:
    if not args.yes:
        print("This drops ALL crm_raw + crm_mirror data and recreates empty schemas.", file=sys.stderr)
        print("Re-run with --yes to confirm.", file=sys.stderr)
        return 1
    result = reset_old_crm(apply_schema=not args.no_schema)
    print(json.dumps(result, indent=2))
    return 0


def cmd_repair_catalog(args: argparse.Namespace) -> int:
    result = repair_catalog(table=args.table, fast=args.fast)
    print(json.dumps(result, indent=2))
    return 0


def cmd_init_catalog(_: argparse.Namespace) -> int:
    result = init_catalog()
    print(json.dumps(result, indent=2))
    return 0


def cmd_backfill(args: argparse.Namespace) -> int:
    summary = run_backfill(table=args.table, until_done=args.until_done)
    print(json.dumps(summary, indent=2, default=str))
    if summary.get("error"):
        return 1
    if args.table:
        results = summary.get("results") or []
        return 0 if all(r.get("ok") for r in results) else 1
    return 0 if summary.get("complete") else 1


def cmd_catchup(args: argparse.Namespace) -> int:
    results = run_catchup(table=args.table)
    print(json.dumps(results, indent=2))
    return 0 if all(r.get("ok") for r in results if not r.get("skipped")) else 1


def cmd_verify(args: argparse.Namespace) -> int:
    if args.table:
        import requests

        result = verify_table(args.table, strict=args.strict, session=requests.Session())
        print(json.dumps(result, indent=2))
        return 0 if result.get("ok") else 1
    results = run_verify(strict=args.strict)
    print(json.dumps(results, indent=2))
    return 0 if all(r.get("ok") for r in results) else 1


def cmd_live(args: argparse.Namespace) -> int:
    if args.daemon:
        run_live_daemon(once=args.once)
        return 0
    results = run_live_cycle()
    print(json.dumps(results, indent=2))
    return 0


def cmd_reconcile(args: argparse.Namespace) -> int:
    if args.weekly_audit:
        results = weekly_count_audit()
    else:
        results = run_reconcile(table=args.table)
    print(json.dumps(results, indent=2))
    return 0


def cmd_status(_: argparse.Namespace) -> int:
    with connect() as conn:
        summary = status_summary(conn)
    print(json.dumps(summary, indent=2, default=str))
    return 0


def cmd_dashboard(args: argparse.Namespace) -> int:
    run_dashboard(host=args.host, port=args.port)
    return 0


def cmd_retry(args: argparse.Namespace) -> int:
    if not args.table:
        print("retry requires --table", file=sys.stderr)
        return 1
    with connect() as conn:
        conn.execute(
            """
            UPDATE crm_mirror.sync_state
            SET phase = 'pending', last_error = NULL, catchup_empty_passes = 0,
                last_ncode = NULL, last_cursor = NULL, rows_loaded = 0
            WHERE table_name = %s AND phase = 'error'
            """,
            (args.table.lower(),),
        )
    print(f"Reset {args.table} to pending (if it was in error)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="CRM full mirror into Postgres database old_crm",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_stop = sub.add_parser(
        "stop-all",
        help="Stop dashboard, backfill workers, and DB sessions (run before reset)",
    )
    p_stop.add_argument("--port", type=int, default=8765, help="Dashboard port to kill")

    p_reset = sub.add_parser("reset", help="Wipe old_crm mirror (crm_raw + crm_mirror) and recreate schemas")
    p_reset.add_argument("--yes", action="store_true", help="Confirm destructive reset")
    p_reset.add_argument(
        "--no-schema",
        action="store_true",
        help="Only drop schemas; do not re-apply docs/old-crm-schema/*.sql",
    )

    sub.add_parser("init-catalog", help="Discover CRM tables and create sync_state + DDL")

    p_repair = sub.add_parser("repair-catalog", help="Re-probe CRM columns and rebuild raw table DDL")
    p_repair.add_argument("--table", help="Single table name")
    p_repair.add_argument(
        "--fast",
        action="store_true",
        help="SQL-only fix for pooler + invalid-ncode errors (no CRM calls)",
    )

    p_backfill = sub.add_parser("backfill", help="Phase 1 — initial full copy")
    p_backfill.add_argument("--table", help="Single table name")
    p_backfill.add_argument(
        "--until-done",
        action="store_true",
        help="Loop repair+retry until pending=0 and error=0 (recommended for unattended runs)",
    )

    p_catchup = sub.add_parser("catchup", help="Phase 2 — replay changes during backfill")
    p_catchup.add_argument("--table", help="Single table name")

    p_verify = sub.add_parser("verify", help="Phase 3 — mandatory exactness gates")
    p_verify.add_argument("--table", help="Single table name")
    p_verify.add_argument("--strict", action=argparse.BooleanOptionalAction, default=True)

    p_live = sub.add_parser("live", help="Phase 4 — incremental sync (verified tables only)")
    p_live.add_argument("--daemon", action="store_true", help="Run forever")
    p_live.add_argument("--once", action="store_true", help="Single cycle (with --daemon)")

    p_reconcile = sub.add_parser("reconcile", help="Nightly PK scan + tombstones")
    p_reconcile.add_argument("--table", help="Single table name")
    p_reconcile.add_argument("--weekly-audit", action="store_true", help="Full count audit")

    sub.add_parser("status", help="JSON progress")

    p_dash = sub.add_parser("dashboard", help="Local web UI — progress, resume, stop")
    p_dash.add_argument("--host", default="127.0.0.1")
    p_dash.add_argument("--port", type=int, default=8765)

    p_retry = sub.add_parser("retry", help="Reset error table to pending")
    p_retry.add_argument("--table", required=True)

    return parser


def main(argv: list[str] | None = None) -> int:
    load_env_files()
    parser = build_parser()
    args = parser.parse_args(argv)

    handlers = {
        "stop-all": cmd_stop_all,
        "reset": cmd_reset,
        "init-catalog": cmd_init_catalog,
        "repair-catalog": cmd_repair_catalog,
        "backfill": cmd_backfill,
        "catchup": cmd_catchup,
        "verify": cmd_verify,
        "live": cmd_live,
        "reconcile": cmd_reconcile,
        "status": cmd_status,
        "dashboard": cmd_dashboard,
        "retry": cmd_retry,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
