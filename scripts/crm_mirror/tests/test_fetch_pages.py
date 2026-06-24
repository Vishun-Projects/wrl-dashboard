from __future__ import annotations

import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from crm_mirror.config import CAP_HEAP_SCAN, CAP_TEXT_PK, SMALL_TABLE_ROWS
from crm_mirror.fetch_pages import probe_pk_uniqueness
from crm_mirror.schema import classify_capability
from crm_mirror.write import insert_rows


class TestClassifyCapability(unittest.TestCase):
    def test_non_unique_pk_uses_heap_scan(self) -> None:
        cap = classify_capability(
            pk_column="ncode",
            has_editedon=True,
            has_addedon=True,
            row_count=100_000,
            small_table_rows=SMALL_TABLE_ROWS,
            pk_unique=False,
        )
        self.assertEqual(cap, CAP_HEAP_SCAN)

    def test_unique_pk_uses_text_pk(self) -> None:
        cap = classify_capability(
            pk_column="ncode",
            has_editedon=False,
            has_addedon=False,
            row_count=100_000,
            small_table_rows=SMALL_TABLE_ROWS,
            pk_unique=True,
        )
        self.assertEqual(cap, CAP_TEXT_PK)


class TestProbePkUniqueness(unittest.TestCase):
    @patch("crm_mirror.fetch_pages.post_query")
    @patch("crm_mirror.fetch_pages.crm_count")
    def test_duplicate_pk_not_unique(self, mock_count, mock_post) -> None:
        mock_post.return_value = {"data": [{"total": "10", "distinct_pk": "7"}]}
        self.assertFalse(probe_pk_uniqueness("trdcalls2fault", "ncode"))

    @patch("crm_mirror.fetch_pages.post_query")
    @patch("crm_mirror.fetch_pages.crm_count")
    def test_empty_pk_values_not_unique(self, mock_count, mock_post) -> None:
        mock_post.return_value = {"data": [{"total": "10", "distinct_pk": "10"}]}
        mock_count.return_value = 2
        self.assertFalse(probe_pk_uniqueness("msthelp", "ncode"))

    @patch("crm_mirror.fetch_pages.post_query")
    @patch("crm_mirror.fetch_pages.crm_count")
    def test_unique_pk_with_no_empty(self, mock_count, mock_post) -> None:
        mock_post.return_value = {"data": [{"total": "100", "distinct_pk": "100"}]}
        mock_count.return_value = 0
        self.assertTrue(probe_pk_uniqueness("trhcalls", "ncode"))


class TestKeysetPaginationSkipsDuplicates(unittest.TestCase):
    def test_keyset_gt_excludes_remaining_duplicate_pk_rows(self) -> None:
        """Rows sharing the page-boundary pk value are excluded by pk > cursor."""
        page_boundary_pk = "B"
        remaining = [{"ncode": "B"}, {"ncode": "C"}]
        matched = [r for r in remaining if r["ncode"] > page_boundary_pk]
        self.assertEqual(matched, [{"ncode": "C"}])
        self.assertLess(len(matched), len(remaining))


class TestNulSanitization(unittest.TestCase):
    def test_insert_rows_strips_nul_bytes(self) -> None:
        conn = MagicMock()
        batch_id = uuid.uuid4()
        rows = [{"msg": "hello\x00world"}]
        insert_rows(
            conn,
            table_name="ccreclog",
            columns=["msg"],
            rows=rows,
            batch_id=batch_id,
        )
        conn.execute.assert_called_once()
        payload = conn.execute.call_args[0][1]
        self.assertEqual(payload["msg"], "helloworld")


if __name__ == "__main__":
    unittest.main()
