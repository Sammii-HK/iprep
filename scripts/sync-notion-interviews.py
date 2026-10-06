#!/usr/bin/env python3
"""Sync the Notion 'Interview Prep' database into iPrep.

Reads upcoming interviews from Notion and POSTs them to iPrep's
/api/interviews/sync endpoint, keyed by the Notion page id.

Environment:
  NOTION_TOKEN         Notion integration token (secret, never printed)
  IPREP_BASE_URL       e.g. https://iprep.example.com
  IPREP_API_TOKEN      a machine principal token with the interviews:sync and folders:read scopes (secret).
                       Create it with: npx tsx scripts/principals.ts create --name notion-sync ...
  NOTION_DATA_SOURCE_ID / NOTION_DATABASE_ID   optional overrides

Usage:
  python3 scripts/sync-notion-interviews.py --dry-run
  python3 scripts/sync-notion-interviews.py
  python3 scripts/sync-notion-interviews.py --dry-run --fixture f.json --folders-fixture folders.json

Python 3.9 compatible, standard library only. See docs/interviews-and-notion.md.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python < 3.9
    ZoneInfo = None  # type: ignore

DATABASE_ID = "ae882a61-6164-4c15-af6f-4c7fbf4ea0b8"
DATA_SOURCE_ID = "e569a62f-88bd-42f4-9695-22ec3eff43ed"
NOTION_API = "https://api.notion.com/v1"
DATA_SOURCE_VERSION = "2025-09-03"
LEGACY_VERSION = "2022-06-28"
LOOKBACK = timedelta(days=1)
DEFAULT_HOUR = 9  # used when Notion gives a date with no time


class NotionAccessError(Exception):
    """Raised when the integration cannot see the database (HTTP 404)."""


# --------------------------------------------------------------------------
# Pure mapping helpers (unit tested)
# --------------------------------------------------------------------------

def plain_text(prop: Optional[Dict[str, Any]]) -> str:
    """Text of a title or rich_text property."""
    if not prop:
        return ""
    parts = prop.get("title") or prop.get("rich_text") or []
    return "".join(p.get("plain_text", "") for p in parts).strip()


def select_name(prop: Optional[Dict[str, Any]]) -> Optional[str]:
    sel = (prop or {}).get("select")
    return sel.get("name") if sel else None


def url_value(prop: Optional[Dict[str, Any]]) -> Optional[str]:
    value = (prop or {}).get("url")
    if value and value.lower().startswith(("http://", "https://")):
        return value
    return None


def parse_notion_date(start: str, tz_name: Optional[str]) -> datetime:
    """Parse a Notion date start into an aware datetime.

    Handles date-only values (09:00 local), offset values, and naive values
    paired with a time_zone name (Notion's usual shape when a zone is set).
    """
    if "T" not in start:
        d = date.fromisoformat(start)
        naive = datetime.combine(d, time(DEFAULT_HOUR, 0))
    else:
        text = start.replace("Z", "+00:00")
        naive = datetime.fromisoformat(text)
        if naive.tzinfo is not None:
            return naive
    zone = timezone.utc
    if tz_name and ZoneInfo is not None:
        try:
            zone = ZoneInfo(tz_name)  # type: ignore[assignment]
        except Exception:
            zone = timezone.utc
    return naive.replace(tzinfo=zone)


def match_folder(company: str, folders: List[Dict[str, Any]]) -> Optional[str]:
    """Folder whose title contains the company name followed by 'Interview Prep'."""
    name = company.strip().lower()
    if not name:
        return None
    for folder in folders:
        title = str(folder.get("title", "")).lower()
        at = title.find(name)
        if at != -1 and title.find("interview prep", at + len(name)) != -1:
            return folder.get("id")
    return None


def map_row(
    page: Dict[str, Any],
    folders: List[Dict[str, Any]],
    now: datetime,
) -> Optional[Dict[str, Any]]:
    """Map one Notion page to a sync item, or None if it should be skipped."""
    props = page.get("properties", {})
    date_prop = (props.get("Interview Date") or {}).get("date")
    if not date_prop or not date_prop.get("start"):
        return None
    company = plain_text(props.get("Company"))
    if not company:
        return None

    tz_name = date_prop.get("time_zone")
    starts_at = parse_notion_date(date_prop["start"], tz_name)
    if starts_at < now - LOOKBACK:
        return None

    role = plain_text(props.get("Role")) or plain_text(props.get("Title")) or "Interview"
    item: Dict[str, Any] = {
        "externalId": page["id"],
        "company": company,
        "role": role,
        "round": select_name(props.get("Interview Round")),
        "startsAt": starts_at.isoformat(),
        "endsAt": None,
        "link": url_value(props.get("Interview Link")),
        "bookingLink": url_value(props.get("Booking Link")),
        "interviewer": plain_text(props.get("Interviewer")) or None,
        "folderId": match_folder(company, folders),
    }
    if date_prop.get("end"):
        ends_at = parse_notion_date(date_prop["end"], tz_name)
        if ends_at > starts_at:
            item["endsAt"] = ends_at.isoformat()
    return item


def build_payload(
    pages: List[Dict[str, Any]],
    folders: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    items = [m for m in (map_row(p, folders, now) for p in pages) if m]
    items.sort(key=lambda i: i["startsAt"])
    # complete=True: this is every future row in Notion, so iPrep may cancel
    # scheduled interviews that have disappeared from it.
    return {"source": "notion", "complete": True, "interviews": items}


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

def _request(
    url: str,
    method: str,
    headers: Dict[str, str],
    body: Optional[Dict[str, Any]] = None,
) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8") or "null")


def _notion_query(path: str, version: str, token: str) -> List[Dict[str, Any]]:
    headers = {
        "Authorization": "Bearer " + token,
        "Notion-Version": version,
        "Content-Type": "application/json",
    }
    results: List[Dict[str, Any]] = []
    cursor: Optional[str] = None
    while True:
        body: Dict[str, Any] = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        page = _request(NOTION_API + path, "POST", headers, body)
        results.extend(page.get("results", []))
        if not page.get("has_more"):
            return results
        cursor = page.get("next_cursor")


def fetch_notion_pages(token: str) -> List[Dict[str, Any]]:
    ds_id = os.environ.get("NOTION_DATA_SOURCE_ID", DATA_SOURCE_ID)
    db_id = os.environ.get("NOTION_DATABASE_ID", DATABASE_ID)
    try:
        return _notion_query("/data_sources/%s/query" % ds_id, DATA_SOURCE_VERSION, token)
    except urllib.error.HTTPError as err:
        if err.code != 404:
            raise
    try:  # older API shape, in case the data source endpoint is unavailable
        return _notion_query("/databases/%s/query" % db_id, LEGACY_VERSION, token)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            raise NotionAccessError(
                "Notion returned 404 for the 'Interview Prep' database. Your integration "
                "cannot see it. In Notion open the database, click the '...' menu, choose "
                "Connections, and add the integration whose token is in NOTION_TOKEN. "
                "Then run this again."
            )
        raise


def fetch_folders(base_url: str, key: str) -> List[Dict[str, Any]]:
    data = _request(base_url.rstrip("/") + "/api/folders", "GET", {"Authorization": "Bearer " + key})
    return data if isinstance(data, list) else []


def post_sync(base_url: str, key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    return _request(base_url.rstrip("/") + "/api/interviews/sync", "POST", headers, payload)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def _load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="print the payload, send nothing")
    ap.add_argument("--fixture", help="read a saved Notion query response instead of calling Notion")
    ap.add_argument("--folders-fixture", help="read a saved /api/folders response instead of calling iPrep")
    args = ap.parse_args(argv)

    base_url = os.environ.get("IPREP_BASE_URL", "")
    key = os.environ.get("IPREP_API_TOKEN", "")
    token = os.environ.get("NOTION_TOKEN", "")

    if not args.fixture and not token:
        print("NOTION_TOKEN is not set.", file=sys.stderr)
        return 2
    if not args.dry_run and not (base_url and key):
        print("IPREP_BASE_URL and IPREP_API_TOKEN must be set to sync.", file=sys.stderr)
        return 2

    try:
        if args.fixture:
            fixture = _load_json(args.fixture)
            pages = fixture.get("results", fixture) if isinstance(fixture, dict) else fixture
        else:
            pages = fetch_notion_pages(token)

        if args.folders_fixture:
            folders = _load_json(args.folders_fixture)
        elif base_url and key:
            folders = fetch_folders(base_url, key)
        else:
            folders = []
            print("No iPrep credentials: folder matching skipped.", file=sys.stderr)

        payload = build_payload(pages, folders)
        if args.dry_run:
            print(json.dumps(payload, indent=2))
            print("Dry run: %d interview(s), nothing sent." % len(payload["interviews"]), file=sys.stderr)
            return 0

        result = post_sync(base_url, key, payload)
        print("Synced: %s" % json.dumps(result))
        return 0
    except NotionAccessError as err:
        print(str(err), file=sys.stderr)
        return 3
    except urllib.error.HTTPError as err:
        print("HTTP %s from %s" % (err.code, err.url.split("?")[0]), file=sys.stderr)
        return 1
    except urllib.error.URLError as err:
        print("Network error: %s" % err.reason, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
