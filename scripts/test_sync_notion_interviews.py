"""Unit tests for sync-notion-interviews.py. Run: python3 -m unittest scripts/test_sync_notion_interviews.py"""
import importlib.util
import json
import os
import unittest
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("sync", os.path.join(HERE, "sync-notion-interviews.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)


def load(name):
    with open(os.path.join(HERE, "fixtures", name), encoding="utf-8") as fh:
        return json.load(fh)


class MappingTests(unittest.TestCase):
    def setUp(self):
        self.pages = load("notion-interviews.json")["results"]
        self.folders = load("iprep-folders.json")
        self.payload = sync.build_payload(self.pages, self.folders, NOW)

    def test_skips_past_and_undated_rows(self):
        ids = [i["externalId"] for i in self.payload["interviews"]]
        self.assertEqual(ids, [self.pages[0]["id"], self.pages[1]["id"]])

    def test_payload_is_complete_notion_sync(self):
        self.assertTrue(self.payload["complete"])
        self.assertEqual(self.payload["source"], "notion")

    def test_naive_date_with_time_zone_gets_offset(self):
        first = self.payload["interviews"][0]
        self.assertEqual(first["startsAt"], "2099-10-08T14:00:00+01:00")
        self.assertEqual(first["endsAt"], "2099-10-08T14:45:00+01:00")

    def test_date_only_defaults_to_nine(self):
        self.assertEqual(self.payload["interviews"][1]["startsAt"], "2099-11-01T09:00:00+00:00")

    def test_role_falls_back_to_title(self):
        self.assertEqual(self.payload["interviews"][1]["role"], "Date only row")

    def test_unsafe_urls_dropped(self):
        first = self.payload["interviews"][0]
        self.assertEqual(first["link"], "https://meet.example.com/abc")
        self.assertIsNone(first["bookingLink"])

    def test_folder_matching(self):
        self.assertEqual(self.payload["interviews"][0]["folderId"], "folder_attio")
        self.assertIsNone(self.payload["interviews"][1]["folderId"])

    def test_row_within_last_day_is_kept(self):
        page = {
            "id": "x",
            "properties": {
                "Company": {"rich_text": [{"plain_text": "Acme"}]},
                "Interview Date": {"date": {"start": "2026-10-05T18:00:00+00:00"}},
            },
        }
        self.assertIsNotNone(sync.map_row(page, [], NOW))


class FolderMatchTests(unittest.TestCase):
    def test_requires_interview_prep_after_company(self):
        folders = [{"id": "a", "title": "Interview Prep for Attio"}, {"id": "b", "title": "attio - Interview Prep (2)"}]
        self.assertEqual(sync.match_folder("Attio", folders), "b")

    def test_empty_company(self):
        self.assertIsNone(sync.match_folder("", [{"id": "a", "title": "Interview Prep"}]))


if __name__ == "__main__":
    unittest.main()
