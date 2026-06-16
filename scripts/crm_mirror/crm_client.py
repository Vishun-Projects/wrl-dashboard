from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from typing import Any

import requests
from bs4 import BeautifulSoup

from .config import CRM_TIMEOUT_MS, DB_URL, MAX_RETRIES

SESSION_CACHE_MS = 30_000
_session_lock = threading.Lock()
_cached_state: dict[str, str] | None = None
_last_fetch = 0.0
_fetch_lock = threading.Lock()
_last_request_at = 0.0


class CrmError(Exception):
    pass


class CrmOutOfMemoryError(CrmError):
    pass


class CrmSqlTimeoutError(CrmError):
    pass


def _is_sql_timeout(text: str) -> bool:
    hay = text.lower()
    return (
        "timeout expired" in hay
        or "timeout period elapsed" in hay
        or "etimedout" in hay
        or ("timeout of" in hay and "exceeded" in hay)
    )


def _is_oom(text: str) -> bool:
    return "outofmemoryexception" in text.lower() or "crm viewstate oom" in text.lower()


def wait_fetch_gap(gap_ms: int) -> None:
    global _last_request_at
    with _fetch_lock:
        now = time.monotonic()
        elapsed_ms = (now - _last_request_at) * 1000
        if _last_request_at > 0 and elapsed_ms < gap_ms:
            time.sleep((gap_ms - elapsed_ms) / 1000)
        _last_request_at = time.monotonic()


def get_app_state(session: requests.Session) -> dict[str, str]:
    global _cached_state, _last_fetch
    now = time.time()
    with _session_lock:
        if _cached_state and now - _last_fetch < SESSION_CACHE_MS / 1000:
            return _cached_state

        for attempt in range(1, 4):
            try:
                res = session.get(
                    DB_URL,
                    timeout=180,
                    headers={"User-Agent": "Mozilla/5.0"},
                )
                res.raise_for_status()
                soup = BeautifulSoup(res.text, "html.parser")
                vs = soup.select_one("#__VIEWSTATE")
                vsg = soup.select_one("#__VIEWSTATEGENERATOR")
                ev = soup.select_one("#__EVENTVALIDATION")
                state = {
                    "viewState": vs.get("value", "") if vs else "",
                    "viewStateGenerator": vsg.get("value", "") if vsg else "",
                    "eventValidation": ev.get("value", "") if ev else "",
                }
                _cached_state = state
                _last_fetch = time.time()
                return state
            except requests.RequestException:
                if attempt >= 3:
                    raise
                _cached_state = None
                time.sleep(2 * attempt)
        raise CrmError("CRM session fetch failed")


def _build_form(params: dict[str, Any], state: dict[str, str]) -> dict[str, str]:
    form: dict[str, str] = {
        "__VIEWSTATE": state["viewState"],
        "__VIEWSTATEGENERATOR": state["viewStateGenerator"],
        "btn_View": "Execute",
    }
    if state.get("eventValidation"):
        form["__EVENTVALIDATION"] = state["eventValidation"]

    if params.get("raw_sql"):
        sql = str(params["raw_sql"]).strip()
        sql_upper = sql.upper()
        has_offset = "OFFSET" in sql_upper or "FETCH NEXT" in sql_upper
        if "ORDER BY" in sql_upper and not re.match(r"^\s*SELECT\s+(?:DISTINCT\s+)?TOP\b", sql, re.I) and not has_offset:
            if re.match(r"^\s*SELECT\s+DISTINCT\b", sql, re.I):
                sql = re.sub(r"^(\s*SELECT\s+DISTINCT)\b", r"\1 TOP 100 PERCENT", sql, count=1, flags=re.I)
            else:
                sql = re.sub(r"^(\s*SELECT)\b", r"\1 TOP 100 PERCENT", sql, count=1, flags=re.I)
        form["txt_Fields"] = "*"
        form["txt_TableName"] = f"({sql}) as t"
        form["txt_Condition"] = "1=1"
        form["txt_OrderBy"] = ""
    else:
        form["txt_Top"] = str(params.get("top") or "")
        form["txt_Fields"] = str(params.get("fields") or "")
        form["txt_TableName"] = str(params.get("table_name") or "")
        form["txt_Condition"] = str(params.get("condition") or "1=1")
        form["txt_OrderBy"] = str(params.get("order_by") or "")
    return form


def _parse_grid(html: str) -> tuple[list[str], list[dict[str, str]]]:
    soup = BeautifulSoup(html, "html.parser")
    result_table = soup.select_one("#ResultGrid")
    if not result_table:
        for fieldset in soup.select("fieldset"):
            legend = fieldset.select_one("legend")
            if legend and "Result" in legend.get_text():
                tables = fieldset.select("table")
                if tables:
                    result_table = tables[0]
                    break
    if not result_table:
        return [], []

    columns: list[str] = []
    data: list[dict[str, str]] = []
    rows = result_table.select("tr")
    for i, row in enumerate(rows):
        cells = row.select("td, th")
        if i == 0:
            columns = [c.get_text(strip=True) for c in cells if c.get_text(strip=True)]
            continue
        row_data: dict[str, str] = {}
        for j, cell in enumerate(cells):
            col = columns[j] if j < len(columns) else f"Col{j}"
            row_data[col] = cell.get_text(strip=True)
        if row_data:
            data.append(row_data)
    return columns, data


def post_query(
    *,
    session: requests.Session | None = None,
    gap_ms: int = 0,
    timeout_ms: int | None = None,
    **params: Any,
) -> dict[str, Any]:
    if gap_ms > 0:
        wait_fetch_gap(gap_ms)

    sess = session or requests.Session()
    timeout_s = (timeout_ms or CRM_TIMEOUT_MS) / 1000

    for attempt in range(1, MAX_RETRIES + 1):
        state = get_app_state(sess)
        form = _build_form(params, state)
        try:
            res = sess.post(
                DB_URL,
                data=form,
                timeout=timeout_s,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0",
                },
            )
            res.raise_for_status()
            body = res.text
            soup = BeautifulSoup(body, "html.parser")
            err_el = soup.select_one("#lbl_Error")
            err_text = err_el.get_text(strip=True) if err_el else ""
            if err_text:
                if "No record found" in err_text:
                    return {"data": [], "columns": [], "message": "No record found"}
                if "deadlocked" in err_text.lower():
                    time.sleep(attempt * 5)
                    continue
                if _is_sql_timeout(err_text):
                    raise CrmSqlTimeoutError(err_text)
                if _is_oom(err_text):
                    raise CrmOutOfMemoryError(err_text)
                raise CrmError(err_text)

            columns, data = _parse_grid(body)
            return {"data": data, "columns": columns}
        except CrmOutOfMemoryError:
            raise
        except CrmSqlTimeoutError:
            raise
        except requests.RequestException as exc:
            msg = str(exc)
            if _is_oom(msg):
                raise CrmOutOfMemoryError(msg) from exc
            if _is_sql_timeout(msg):
                raise CrmSqlTimeoutError(msg) from exc
            if attempt >= MAX_RETRIES:
                raise CrmError(msg) from exc
            global _cached_state
            _cached_state = None
            time.sleep(3 * attempt)

    raise CrmError("Maximum retry attempts reached")


def row_fingerprint(row: dict[str, str], exclude: frozenset[str] | None = None) -> str:
    skip = exclude or frozenset()
    payload = {k: row.get(k, "") for k in sorted(row.keys()) if k not in skip}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
