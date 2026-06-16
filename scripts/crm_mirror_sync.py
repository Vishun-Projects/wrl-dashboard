#!/usr/bin/env python3
"""
Full CRM mirror into Postgres database old_crm.

  python scripts/crm_mirror_sync.py init-catalog
  python scripts/crm_mirror_sync.py backfill
  python scripts/crm_mirror_sync.py catchup
  python scripts/crm_mirror_sync.py verify
  python scripts/crm_mirror_sync.py live --daemon
  python scripts/crm_mirror_sync.py dashboard

Requires: OLD_CRM_DATABASE_URL, network access to westerncrm.com
See docs/crm-mirror-sync.md
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from crm_mirror.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
