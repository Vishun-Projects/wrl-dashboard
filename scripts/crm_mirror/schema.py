from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .config import BLUEPRINT_PATH, CAP_HEAP_SCAN, CAP_PK_ONLY, CAP_SMALL_SNAPSHOT, CAP_TEXT_PK, CAP_TIMESTAMPED_PK, MIRROR_COLS

CREATE_TABLE_RE = re.compile(
    r"CREATE TABLE \[([^\]]+)\]\s*\((.*?)\);",
    re.IGNORECASE | re.DOTALL,
)
COLUMN_RE = re.compile(r"\[([^\]]+)\]\s+", re.IGNORECASE)

PK_CANDIDATES = ("ncode", "ntrnno", "ncodeoffid", "id", "code", "rowid")


@dataclass
class TableBlueprint:
    name: str
    columns: list[str]


def parse_blueprint(path=None) -> dict[str, TableBlueprint]:
    text = (path or BLUEPRINT_PATH).read_text(encoding="utf-8", errors="replace")
    out: dict[str, TableBlueprint] = {}
    for match in CREATE_TABLE_RE.finditer(text):
        name = match.group(1).strip().lower()
        body = match.group(2)
        cols = [m.group(1).lower() for m in COLUMN_RE.finditer(body)]
        if cols:
            out[name] = TableBlueprint(name=name, columns=cols)
    return out


def discover_pk(columns: list[str]) -> str | None:
    lower = {c.lower() for c in columns}
    for candidate in PK_CANDIDATES:
        if candidate in lower:
            return candidate
    return columns[0] if columns else None


def classify_capability(
    *,
    pk_column: str | None,
    has_editedon: bool,
    has_addedon: bool,
    row_count: int,
    small_table_rows: int,
    heap_only: bool = False,
    pk_unique: bool = True,
) -> str:
    if heap_only or not pk_column or not pk_unique:
        return CAP_HEAP_SCAN
    if row_count > 0 and row_count < small_table_rows:
        return CAP_SMALL_SNAPSHOT
    if has_editedon or has_addedon:
        return CAP_TIMESTAMPED_PK
    return CAP_TEXT_PK


def quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def ensure_raw_table_sql(
    table_name: str,
    columns: list[str],
    pk_column: str | None = None,
) -> str:
    """All CRM columns as nullable text; surrogate PK — store rows exactly as CRM returns them."""
    table = table_name.lower()
    col_defs = ['"_mirror_row_id" bigserial PRIMARY KEY']
    for c in columns:
        if c.lower() in {m.lower() for m in MIRROR_COLS} or c.lower() == "_mirror_row_id":
            continue
        col_defs.append(f"{quote_ident(c)} text")
    for mc in MIRROR_COLS:
        if mc == "_mirror_synced_at" or mc == "_mirror_deleted_at":
            col_defs.append(f"{quote_ident(mc)} timestamptz")
        else:
            col_defs.append(f"{quote_ident(mc)} uuid")
    return (
        f"CREATE TABLE IF NOT EXISTS crm_raw.{quote_ident(table)} (\n  "
        + ",\n  ".join(col_defs)
        + "\n);"
    )


def resolve_table_metadata(
    *,
    table_name: str,
    blueprint_columns: list[str],
    row_count: int,
    session,
    small_table_rows: int,
) -> dict[str, Any]:
    """Probe live CRM columns; never mark a table unsyncable."""
    from .fetch_pages import probe_crm_columns

    probed = probe_crm_columns(table_name, session=session)
    columns = list(probed) if probed else list(blueprint_columns)
    if not columns and blueprint_columns:
        columns = list(blueprint_columns)

    pk = discover_pk(columns) if columns else None
    heap_only = not probed and not columns
    if probed and pk and pk not in set(probed):
        # Declared PK not in live CRM — full heap scan, keep all live columns
        pk = None
        heap_only = True

    col_set = {c.lower() for c in columns}
    has_editedon = "editedon" in col_set
    has_addedon = "addedon" in col_set

    pk_unique = True
    if pk and not heap_only:
        from .fetch_pages import probe_pk_uniqueness

        pk_unique = probe_pk_uniqueness(table_name, pk, session=session)

    capability = classify_capability(
        pk_column=pk,
        has_editedon=has_editedon,
        has_addedon=has_addedon,
        row_count=row_count,
        small_table_rows=small_table_rows,
        heap_only=heap_only,
        pk_unique=pk_unique,
    )

    return {
        "columns": columns,
        "pk_column": pk,
        "has_editedon": has_editedon,
        "has_addedon": has_addedon,
        "sync_capability": capability,
        "pk_unique": pk_unique,
    }


def ensure_minimal_raw_table_sql(table_name: str, columns: list[str]) -> str:
    return ensure_raw_table_sql(table_name, columns or ["ncode"])
