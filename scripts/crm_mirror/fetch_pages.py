from __future__ import annotations

from typing import Any

from .config import FETCH_GAP_MS, MIN_PAGE_SIZE, PAGE_SIZE
from .crm_client import CrmOutOfMemoryError, CrmSqlTimeoutError, post_query


def _sql_literal(val: str) -> str:
    return "'" + str(val).replace("'", "''") + "'"


def _row_value(row: dict[str, str], column: str) -> str:
    for key, value in row.items():
        if key.lower() == column.lower():
            return str(value).strip()
    return ""


def fetch_page_text_pk(
    *,
    table_name: str,
    pk_column: str,
    after_cursor: str | None,
    page_size: int,
    condition_extra: str | None = None,
    session=None,
) -> tuple[list[dict[str, str]], int]:
    """Keyset pagination using raw text PK values (no bigint cast)."""
    size = page_size
    while size >= MIN_PAGE_SIZE:
        cond_parts = []
        if after_cursor is not None and after_cursor != "":
            cond_parts.append(f"{pk_column} > {_sql_literal(after_cursor)}")
        if condition_extra:
            cond_parts.append(f"({condition_extra})")
        condition = " AND ".join(cond_parts) if cond_parts else "1=1"
        try:
            result = post_query(
                session=session,
                gap_ms=FETCH_GAP_MS,
                top=str(size),
                fields="*",
                table_name=f"{table_name} (NOLOCK)",
                condition=condition,
                order_by=f"{pk_column} ASC",
            )
            rows = result.get("data") or []
            return rows, size
        except (CrmOutOfMemoryError, CrmSqlTimeoutError):
            size = max(MIN_PAGE_SIZE, size // 2)
            if size == MIN_PAGE_SIZE:
                raise
    return [], page_size


def fetch_heap_page(
    *,
    table_name: str,
    offset: int,
    page_size: int,
    session=None,
) -> tuple[list[dict[str, str]], int]:
    """Unordered heap tables — OFFSET/FETCH pagination."""
    size = page_size
    while size >= MIN_PAGE_SIZE:
        sql = (
            f"SELECT * FROM {table_name} (NOLOCK) "
            f"ORDER BY (SELECT NULL) "
            f"OFFSET {int(offset)} ROWS FETCH NEXT {size} ROWS ONLY"
        )
        try:
            result = post_query(session=session, gap_ms=FETCH_GAP_MS, raw_sql=sql)
            rows = result.get("data") or []
            return rows, size
        except (CrmOutOfMemoryError, CrmSqlTimeoutError):
            size = max(MIN_PAGE_SIZE, size // 2)
            if size == MIN_PAGE_SIZE:
                raise
    return [], page_size


def fetch_all_text_pk(
    *,
    table_name: str,
    pk_column: str,
    after_cursor: str | None = None,
    condition_extra: str | None = None,
    page_size: int = PAGE_SIZE,
    session=None,
    max_pages: int | None = None,
) -> list[dict[str, str]]:
    all_rows: list[dict[str, str]] = []
    cursor = after_cursor
    pages = 0
    current_size = page_size
    while True:
        if max_pages is not None and pages >= max_pages:
            break
        rows, used_size = fetch_page_text_pk(
            table_name=table_name,
            pk_column=pk_column,
            after_cursor=cursor,
            page_size=current_size,
            condition_extra=condition_extra,
            session=session,
        )
        pages += 1
        if not rows:
            break
        all_rows.extend(rows)
        cursor = _row_value(rows[-1], pk_column)
        if not cursor or len(rows) < used_size:
            break
    return all_rows


def fetch_all_heap(
    *,
    table_name: str,
    start_offset: int = 0,
    page_size: int = PAGE_SIZE,
    session=None,
    max_pages: int | None = None,
) -> list[dict[str, str]]:
    all_rows: list[dict[str, str]] = []
    offset = start_offset
    pages = 0
    while True:
        if max_pages is not None and pages >= max_pages:
            break
        rows, used_size = fetch_heap_page(
            table_name=table_name,
            offset=offset,
            page_size=page_size,
            session=session,
        )
        pages += 1
        if not rows:
            break
        all_rows.extend(rows)
        offset += len(rows)
        if len(rows) < used_size:
            break
    return all_rows


# Legacy int-PK helpers kept for catchup/verify paths
def fetch_page(
    *,
    table_name: str,
    pk_column: str,
    after_pk: int | None,
    page_size: int,
    condition_extra: str | None = None,
    session=None,
) -> tuple[list[dict[str, str]], int]:
    after = str(after_pk) if after_pk is not None else None
    return fetch_page_text_pk(
        table_name=table_name,
        pk_column=pk_column,
        after_cursor=after,
        page_size=page_size,
        condition_extra=condition_extra,
        session=session,
    )


def fetch_all_pages(
    *,
    table_name: str,
    pk_column: str,
    after_pk: int | None = None,
    condition_extra: str | None = None,
    page_size: int = PAGE_SIZE,
    session=None,
    max_pages: int | None = None,
) -> list[dict[str, str]]:
    after = str(after_pk) if after_pk is not None else None
    return fetch_all_text_pk(
        table_name=table_name,
        pk_column=pk_column,
        after_cursor=after,
        condition_extra=condition_extra,
        page_size=page_size,
        session=session,
        max_pages=max_pages,
    )


def crm_scalar(session, sql: str) -> str | None:
    result = post_query(session=session, gap_ms=FETCH_GAP_MS, raw_sql=sql)
    rows = result.get("data") or []
    if not rows:
        return None
    first = rows[0]
    for val in first.values():
        text = str(val).strip()
        if text:
            return text
    return None


def crm_count(table_name: str, condition: str = "1=1", session=None) -> int:
    result = post_query(
        session=session,
        gap_ms=FETCH_GAP_MS,
        fields="COUNT(1) as cnt",
        table_name=f"{table_name} (NOLOCK)",
        condition=condition,
    )
    rows = result.get("data") or []
    if not rows:
        return 0
    return int(float(rows[0].get("cnt") or 0))


def probe_pk_uniqueness(table_name: str, pk_column: str, session=None) -> bool:
    """Return True when pk_column is safe for keyset (pk > cursor) pagination."""
    sql = (
        f"SELECT COUNT(1) AS total, COUNT(DISTINCT {pk_column}) AS distinct_pk "
        f"FROM {table_name} (NOLOCK)"
    )
    try:
        result = post_query(session=session, gap_ms=FETCH_GAP_MS, raw_sql=sql)
    except Exception:
        return False
    rows = result.get("data") or []
    if not rows:
        return True
    row = rows[0]
    total = int(float(row.get("total") or row.get("Total") or 0))
    distinct_pk = int(float(row.get("distinct_pk") or row.get("Distinct_pk") or 0))
    if total != distinct_pk:
        return False
    try:
        empty_pk = crm_count(
            table_name,
            condition=f"COALESCE(CAST({pk_column} AS NVARCHAR(MAX)), '') = ''",
            session=session,
        )
        return empty_pk == 0
    except Exception:
        return True


def probe_crm_columns(table_name: str, session=None) -> list[str]:
    """Fetch CRM column names via TOP 1 row (live schema)."""
    try:
        result = post_query(
            session=session,
            gap_ms=FETCH_GAP_MS,
            top="1",
            fields="*",
            table_name=f"{table_name} (NOLOCK)",
            condition="1=1",
            order_by="",
        )
    except Exception:
        return []
    cols = result.get("columns") or []
    if cols:
        return [str(c).lower() for c in cols if c]
    data = result.get("data") or []
    if data:
        return [str(k).lower() for k in data[0].keys()]
    return []


def fetch_rows_by_pks(
    *,
    table_name: str,
    pk_column: str,
    pks: list[Any],
    session=None,
) -> list[dict[str, str]]:
    if not pks:
        return []
    in_list = ",".join(_sql_literal(str(p)) for p in pks)
    result = post_query(
        session=session,
        gap_ms=FETCH_GAP_MS,
        fields="*",
        table_name=f"{table_name} (NOLOCK)",
        condition=f"{pk_column} IN ({in_list})",
    )
    return result.get("data") or []
