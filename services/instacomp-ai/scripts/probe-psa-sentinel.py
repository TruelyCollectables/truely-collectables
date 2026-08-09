from __future__ import annotations

import asyncio
import json
import re
from html.parser import HTMLParser

from app.sentinel_sources import DEFAULT_SOURCES, SentinelSourceClient


TARGETS = [
    {
        "target_key": "basketball|2010|panini|threads",
        "sport": "basketball",
        "year": 2010,
        "season": "2010",
        "manufacturer": "panini",
        "product": "threads",
        "scope": "mainstream-gap",
    },
    {
        "target_key": "basketball|2010|panini|elite-black-box",
        "sport": "basketball",
        "year": 2010,
        "season": "2010",
        "manufacturer": "panini",
        "product": "elite black box",
        "scope": "mainstream-gap",
    },
    {
        "target_key": "basketball|2009|panini|timeless-treasures",
        "sport": "basketball",
        "year": 2009,
        "season": "2009",
        "manufacturer": "panini",
        "product": "timeless treasures",
        "scope": "mainstream-gap",
    },
    {
        "target_key": "basketball|2010|panini|prestige",
        "sport": "basketball",
        "year": 2010,
        "season": "2010",
        "manufacturer": "panini",
        "product": "prestige",
        "scope": "mainstream-gap",
    },
]


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs):
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


def data_rows(content: bytes) -> list[list[str]]:
    parser = TableParser()
    parser.feed(content.decode("utf-8", errors="replace"))
    rows = []
    for cells in parser.rows:
        if len(cells) < 2:
            continue
        number = cells[0].lstrip("#").strip()
        if re.fullmatch(r"[A-Za-z0-9-]+", number) and number.lower() not in {"no", "number"}:
            rows.append(cells)
    return rows


async def main() -> None:
    psa = next(source for source in DEFAULT_SOURCES if source["source_id"] == "psa")
    client = SentinelSourceClient(timeout_seconds=45, max_download_bytes=10_000_000)
    for target in TARGETS:
        candidates = await client.search(psa, target)
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
                    rows = data_rows(downloaded.content)
                    row["row_count"] = len(rows)
                    row["sample"] = rows[:5]
                except Exception as error:
                    row["download_error"] = str(error)[:300]
            result["candidates"].append(row)
            if not result["best"] or row["row_count"] > result["best"]["row_count"]:
                result["best"] = row
        print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
