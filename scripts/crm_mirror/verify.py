from __future__ import annotations

import random
import time
from typing import Any

import requests

from .batches import audit_backfill_batches
from .config import (
    FINGERPRINT_SAMPLE_ROWS,
    LARGE_TABLE_ROWS,
    OVERLAP_MINUTES,
    PHASE_ERROR,
    PHASE_LIVE,
    PHASE_VERIFIED,
    PHASE_VERIFYING,
)
from .crm_client import row_fingerprint
from .config import MIRROR_COLS
from .fetch_pages import crm_count, crm_scalar, fetch_rows_by_pks
from .state import (
    connect,
    record_verification,
    release_table_lock,
    try_acquire_table_lock,
    tx,
    update_table_state,
    utcnow,
)
from .write import get_row_by_pk, list_active_pks, mirror_count, mirror_max_pk, mirror_min_pk, mirror_max_timestamp


def _crm_max_timestamp(table: str, has_editedon: bool, has_addedon: bool, session) -> str | None:
    parts = []
    if has_editedon:
        parts.append("NULLIF(editedon, '')")
    if has_addedon:
        parts.append("NULLIF(addedon, '')")
    if not parts:
        return None
    expr = f"MAX(COALESCE({', '.join(parts)}))"
    sql = f"SELECT {expr} AS mx FROM {table} (NOLOCK)"
    return crm_scalar(session, sql)


def _crm_min_max_pk(table: str, pk: str, session) -> tuple[int | None, int | None]:
    mn = crm_scalar(session, f"SELECT MIN({pk}) AS v FROM {table} (NOLOCK) WHERE {pk} IS NOT NULL")
    mx = crm_scalar(session, f"SELECT MAX({pk}) AS v FROM {table} (NOLOCK) WHERE {pk} IS NOT NULL")
    def to_int(v):
        if v is None or str(v).strip() == "":
            return None
        return int(float(str(v)))
    return to_int(mn), to_int(mx)


def _pick_sample_pks(all_pks: list[int], sample_size: int) -> list[int]:
    if len(all_pks) <= sample_size:
        return all_pks
    sorted_pks = sorted(all_pks)
    picks = set()
    picks.add(sorted_pks[0])
    picks.add(sorted_pks[-1])
    for q in (0.25, 0.5, 0.75):
        picks.add(sorted_pks[int((len(sorted_pks) - 1) * q)])
    while len(picks) < sample_size:
        picks.add(random.choice(sorted_pks))
    return sorted(picks)[:sample_size]


def verify_table(table_name: str, *, strict: bool = True, session: requests.Session | None = None) -> dict[str, Any]:
    sess = session or requests.Session()
    table = table_name.lower()
    gates: list[dict[str, Any]] = []

    with connect() as conn:
        state = conn.execute(
            "SELECT * FROM crm_mirror.sync_state WHERE table_name = %s",
            (table,),
        ).fetchone()
        if not state:
            return {"ok": False, "error": f"Unknown table {table}"}
        state = dict(state)

        if state["phase"] not in (PHASE_VERIFYING, PHASE_VERIFIED, PHASE_LIVE, PHASE_ERROR):
            return {"ok": False, "error": f"Table phase is {state['phase']}, run catchup first"}

        if not try_acquire_table_lock(conn, table):
            return {"ok": False, "error": "Table lock held by another run"}

        pk = state["pk_column"] or "ncode"
        all_pass = True

        try:
            # Gate 1 — row count (twice with gap)
            crm_cnt = crm_count(table, session=sess)
            mirror_cnt = mirror_count(conn, table)
            passed = crm_cnt == mirror_cnt
            if not passed and strict:
                time.sleep(30)
                crm_cnt2 = crm_count(table, session=sess)
                passed = crm_cnt2 == mirror_cnt
                crm_cnt = crm_cnt2
            gates.append({"gate": "row_count", "passed": passed, "crm": crm_cnt, "mirror": mirror_cnt})
            with tx(conn):
                record_verification(
                    conn,
                    table_name=table,
                    gate_name="row_count",
                    crm_value=str(crm_cnt),
                    mirror_value=str(mirror_cnt),
                    passed=passed,
                )
            all_pass = all_pass and passed

            # Gate 2 — PK bounds
            crm_min, crm_max = _crm_min_max_pk(table, pk, sess)
            mir_min = mirror_min_pk(conn, table, pk)
            mir_max = mirror_max_pk(conn, table, pk)
            pk_pass = crm_min == mir_min and crm_max == mir_max
            gates.append(
                {
                    "gate": "pk_bounds",
                    "passed": pk_pass,
                    "crm_min": crm_min,
                    "crm_max": crm_max,
                    "mirror_min": mir_min,
                    "mirror_max": mir_max,
                }
            )
            with tx(conn):
                record_verification(
                    conn,
                    table_name=table,
                    gate_name="pk_bounds",
                    crm_value=f"min={crm_min},max={crm_max}",
                    mirror_value=f"min={mir_min},max={mir_max}",
                    passed=pk_pass,
                )
            all_pass = all_pass and pk_pass

            # Gate 3 — timestamp bounds
            if state.get("has_editedon") or state.get("has_addedon"):
                crm_ts = _crm_max_timestamp(
                    table,
                    bool(state.get("has_editedon")),
                    bool(state.get("has_addedon")),
                    sess,
                )
                mir_ts = mirror_max_timestamp(
                    conn,
                    table,
                    has_editedon=bool(state.get("has_editedon")),
                    has_addedon=bool(state.get("has_addedon")),
                )
                ts_pass = True
                if crm_ts and mir_ts:
                    ts_pass = mir_ts >= crm_ts
                elif crm_ts and not mir_ts:
                    ts_pass = False
                gates.append({"gate": "timestamp_bounds", "passed": ts_pass, "crm": crm_ts, "mirror": mir_ts})
                with tx(conn):
                    record_verification(
                        conn,
                        table_name=table,
                        gate_name="timestamp_bounds",
                        crm_value=str(crm_ts),
                        mirror_value=str(mir_ts),
                        passed=ts_pass,
                    )
                all_pass = all_pass and ts_pass

            # Gate 4 — row fingerprints
            active_pks = list_active_pks(conn, table, pk)
            row_count = len(active_pks)
            if row_count <= LARGE_TABLE_ROWS:
                sample_pks = active_pks
            else:
                sample_pks = _pick_sample_pks(active_pks, FINGERPRINT_SAMPLE_ROWS)

            mismatches: list[int] = []
            crm_rows = fetch_rows_by_pks(table_name=table, pk_column=pk, pks=sample_pks, session=sess)
            crm_by_pk = {}
            for row in crm_rows:
                try:
                    crm_by_pk[int(float(str(row.get(pk, ""))))] = row
                except (TypeError, ValueError):
                    continue

            skip = frozenset(MIRROR_COLS)
            for pk_val in sample_pks:
                crm_row = crm_by_pk.get(pk_val)
                mir_row = get_row_by_pk(conn, table, pk, pk_val)
                if not crm_row or not mir_row:
                    mismatches.append(pk_val)
                    continue
                mir_data = {
                    k.lower(): str(v or "")
                    for k, v in mir_row.items()
                    if k.lower() not in {m.lower() for m in MIRROR_COLS}
                }
                crm_norm = {k.lower(): v for k, v in crm_row.items()}
                if row_fingerprint(crm_norm, exclude=skip) != row_fingerprint(mir_data, exclude=skip):
                    mismatches.append(pk_val)

            fp_pass = len(mismatches) == 0
            gates.append(
                {
                    "gate": "row_fingerprint",
                    "passed": fp_pass,
                    "sampled": len(sample_pks),
                    "mismatches": mismatches[:10],
                }
            )
            with tx(conn):
                record_verification(
                    conn,
                    table_name=table,
                    gate_name="row_fingerprint",
                    crm_value=str(len(sample_pks)),
                    mirror_value=str(len(mismatches)),
                    passed=fp_pass,
                    details={"mismatches": mismatches[:20]},
                )
            all_pass = all_pass and fp_pass

            # Gate 5 — batch audit
            audit = audit_backfill_batches(conn, table)
            mirror_cnt2 = mirror_count(conn, table)
            batch_pass = (
                audit["batch_row_sum"] == mirror_cnt2 and audit["stale_started_batches"] == 0
            )
            gates.append({"gate": "batch_audit", "passed": batch_pass, **audit, "mirror_count": mirror_cnt2})
            with tx(conn):
                record_verification(
                    conn,
                    table_name=table,
                    gate_name="batch_audit",
                    crm_value=str(audit["batch_row_sum"]),
                    mirror_value=str(mirror_cnt2),
                    passed=batch_pass,
                    details=audit,
                )
            all_pass = all_pass and batch_pass

            with tx(conn):
                if all_pass:
                    update_table_state(
                        conn,
                        table,
                        phase=PHASE_VERIFIED,
                        verified_at=utcnow(),
                        last_error=None,
                    )
                else:
                    update_table_state(
                        conn,
                        table,
                        phase=PHASE_ERROR,
                        last_error="Verification failed — see sync_verifications",
                    )

            return {"ok": all_pass, "table": table, "gates": gates}
        finally:
            release_table_lock(conn, table)


def run_verify(*, table: str | None = None, strict: bool = True) -> list[dict[str, Any]]:
    sess = requests.Session()
    with connect() as conn:
        if table:
            names = [table.lower()]
        else:
            rows = conn.execute(
                """
                SELECT table_name FROM crm_mirror.sync_state
                WHERE phase IN ('verifying', 'verified', 'error')
                ORDER BY table_name
                """
            ).fetchall()
            names = [r["table_name"] for r in rows if r["table_name"]]

    results = []
    for name in names:
        with connect() as conn2:
            st = conn2.execute(
                "SELECT phase FROM crm_mirror.sync_state WHERE table_name = %s", (name,)
            ).fetchone()
            if st and st["phase"] == PHASE_VERIFYING:
                results.append(verify_table(name, strict=strict, session=sess))
    return results


def promote_verified_to_live(conn) -> int:
    rows = conn.execute(
        """
        UPDATE crm_mirror.sync_state
        SET phase = %s
        WHERE phase = %s
        RETURNING table_name
        """,
        (PHASE_LIVE, PHASE_VERIFIED),
    ).fetchall()
    return len(rows)
