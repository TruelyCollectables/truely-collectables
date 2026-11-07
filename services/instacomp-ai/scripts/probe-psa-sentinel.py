from __future__ import annotations

import asyncio
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.sentinel_sources import DEFAULT_SOURCES, SentinelSourceClient


TARGETS = [
    {
        "target_key": "basketball|2010-11|panini|threads",
        "sport": "basketball",
        "year": 2010,
        "season": "2010-11",
        "manufacturer": "panini",
        "product": "threads",
        "scope": "mainstream-gap",
    },
    {
        "target_key": "basketball|2010-11|panini|elite-black-box",
        "sport": "basketball",
        "year": 2010,
        "season": "2010-11",
        "manufacturer": "panini",
        "product": "elite black box",
        "scope": "mainstream-gap",
    },
    {
        "target_key": "basketball|2009-10|panini|timeless-treasures",
        "sport": "basketball",
        "year": 2009,
        "season": "2009-10",
        "manufacturer": "panini",
        "product": "timeless treasures",
        "scope": "mainstream-gap",
    },
    {
        "target_key": "basketball|2010-11|panini|prestige",
        "sport": "basketball",
        "year": 2010,
        "season": "2010-11",
        "manufacturer": "panini",
        "product": "prestige",
        "scope": "mainstream-gap",
    },
]

KNOWN_SET_PAGES = [
    "https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090",
    "https://www.psacard.com/auctionprices/basketball-cards/2009-topps/89284",
]


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self.links: list[str] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs):
        values = dict(attrs)
        if tag.lower() == "a" and values.get("href"):
            self.links.append(str(values["href"]))
        if tag.lower() == "tr":
            self._row = []
        elif tag.lower() in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            value = " ".join("".join(self._cell).split())
            self._row.append(value)
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(self._row):
                self.rows.append(self._row)
            self._row = None
            self._cell = None


def parsed_page(content: bytes) -> tuple[list[list[str]], list[str], list[str]]:
    text = content.decode("utf-8", errors="replace")
    parser = TableParser()
    parser.feed(text)
    rows = []
    for cells in parser.rows:
        if len(cells) < 2:
            continue
        number = cells[0].lstrip("#").strip()
        if re.fullmatch(r"[A-Za-z0-9-]+", number) and number.lower() not in {"no", "number"}:
            rows.append(cells)
    page_links = sorted(
        {
            link
            for link in parser.links
            if re.search(r"(?:page|skip|offset|start|index)=", link, re.I)
        }
    )[:20]
    hints = []
    for pattern in [
        r".{0,80}(?:pageCount|totalPages|pageSize|itemsPerPage|totalItems|totalCount).{0,120}",
        r".{0,80}(?:Next|Previous).{0,120}",
    ]:
        hints.extend(re.findall(pattern, text, flags=re.I | re.S)[:10])
    hints = [" ".join(hint.split())[:250] for hint in hints]
    return rows, page_links, hints[:20]


async def main() -> None:
    psa = next(source for source in DEFAULT_SOURCES if source["source_id"] == "psa")
    client = SentinelSourceClient(timeout_seconds=45, max_download_bytes=10_000_000)

    for url in KNOWN_SET_PAGES:
        result = {"fixture_url": url, "row_count": 0, "page_links": [], "pagination_hints": [], "sample": []}
        try:
            downloaded = await client.download(url)
            rows, page_links, hints = parsed_page(downloaded.content)
            result.update(
                row_count=len(rows),
                page_links=page_links,
                pagination_hints=hints,
                sample=rows[:5],
            )
        except Exception as error:
            result["download_error"] = str(error)[:300]
        print(json.dumps(result, sort_keys=True))

    for target in TARGETS:
        try:
            candidates = await client.search(psa, target)
        except Exception as error:
            print(json.dumps({"target": target["target_key"], "search_error": str(error)[:300]}, sort_keys=True))
            continue
        result = {
            "target": target["target_key"],
            "candidate_count": len(candidates),
            "candidates": [],
            "best": None,
        }
        for candidate in candidates[:5]:
            row = {
                "url": candidate.url,
                "title": candidate.title,
                "exact_match": candidate.exact_match,
                "trust_score": candidate.trust_score,
                "import_policy": candidate.import_policy,
                "row_count": 0,
                "sample": [],
            }
            if candidate.exact_match:
                try:
                    downloaded = await client.download(candidate.url)
                    rows, page_links, hints = parsed_page(downloaded.content)
                    row["row_count"] = len(rows)
                    row["sample"] = rows[:5]
                    row["page_links"] = page_links
                    row["pagination_hints"] = hints
                except Exception as error:
                    row["download_error"] = str(error)[:300]
            result["candidates"].append(row)
            if not result["best"] or row["row_count"] > result["best"]["row_count"]:
                result["best"] = row
        print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
