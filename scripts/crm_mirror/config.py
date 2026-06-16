from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[2]
BLUEPRINT_PATH = ROOT / "docs" / "WesternCRM Schema Architect.txt"

DB_URL = "https://westerncrm.com/wrl/OTHERS/DBQUERY.aspx"

FETCH_GAP_MS = int(os.environ.get("CRM_MIRROR_FETCH_GAP_MS", "1200"))
PAGE_SIZE = int(os.environ.get("CRM_MIRROR_PAGE_SIZE", "200"))
MIN_PAGE_SIZE = int(os.environ.get("CRM_MIRROR_MIN_PAGE_SIZE", "25"))
OVERLAP_MINUTES = int(os.environ.get("CRM_MIRROR_OVERLAP_MINUTES", "2"))
MAX_RETRIES = int(os.environ.get("CRM_MIRROR_MAX_RETRIES", "3"))
CRM_TIMEOUT_MS = int(os.environ.get("CRM_MIRROR_TIMEOUT_MS", "180000"))
STALE_LOCK_MS = int(os.environ.get("CRM_MIRROR_STALE_LOCK_MS", "300000"))
LIVE_INTERVAL_MS = int(os.environ.get("CRM_MIRROR_LIVE_INTERVAL_MS", "180000"))
SMALL_TABLE_ROWS = int(os.environ.get("CRM_MIRROR_SMALL_TABLE_ROWS", "50000"))
FINGERPRINT_SAMPLE_ROWS = int(os.environ.get("CRM_MIRROR_FINGERPRINT_SAMPLE", "50"))
LARGE_TABLE_ROWS = int(os.environ.get("CRM_MIRROR_LARGE_TABLE_ROWS", "100000"))
OFFPEAK_ONLY = os.environ.get("CRM_MIRROR_OFFPEAK_ONLY", "false").lower() == "true"

PHASE_PENDING = "pending"
PHASE_BACKFILLING = "backfilling"
PHASE_CATCHING_UP = "catching_up"
PHASE_VERIFYING = "verifying"
PHASE_VERIFIED = "verified"
PHASE_LIVE = "live"
PHASE_ERROR = "error"
PHASE_BLOCKED = "blocked"

CAP_TIMESTAMPED_PK = "timestamped_pk"
CAP_PK_ONLY = "pk_only"
CAP_SMALL_SNAPSHOT = "small_snapshot"
CAP_HEAP_SCAN = "heap_scan"
CAP_TEXT_PK = "text_pk"
CAP_UNKNOWN = "unknown"

MIRROR_COLS = ("_mirror_synced_at", "_mirror_batch_id", "_mirror_deleted_at")

CATALOG_SQL = """
SELECT
  t.NAME AS TableName,
  SUM(p.rows) AS RowCounts,
  SUM(a.total_pages) * 8 AS TotalSpaceKB
FROM sys.tables t
INNER JOIN sys.indexes i ON t.object_id = i.object_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
WHERE t.is_ms_shipped = 0 AND i.object_id > 255
GROUP BY t.Name
"""


def _normalize_pg_url_for_psycopg(url: str) -> str:
    """Strip pooler-only params that node-pg accepts but psycopg rejects."""
    parsed = urlparse(url)
    qs = parse_qs(parsed.query, keep_blank_values=True) if parsed.query else {}
    for key in ("pgbouncer", "connection_limit", "pool_timeout"):
        qs.pop(key, None)
    new_query = urlencode(qs, doseq=True)
    return urlunparse(parsed._replace(query=new_query))


def old_crm_database_url() -> str:
    url = os.environ.get("OLD_CRM_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("OLD_CRM_DATABASE_URL (or DATABASE_URL) is required")
    return _normalize_pg_url_for_psycopg(url)


def load_env_files() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        for name in (".env.local", ".env"):
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

    for name in (".env.local", ".env"):
        path = ROOT / name
        if path.is_file():
            load_dotenv(path, override=False)
