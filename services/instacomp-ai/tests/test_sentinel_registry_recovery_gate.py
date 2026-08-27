from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from app.sentinel import ChecklistSentinel
from app.sentinel_sources import Candidate, DEFAULT_SOURCES, DownloadedFile


TARGET = {
    "target_key": "basketball|2010|panini|elite-black-box",
    "sport": "basketball",
    "year": 2010,
    "season": "2010",
    "manufacturer": "panini",
    "product": "elite black box",
    "scope": "mainstream-gap",
    "priority": 1,
}


class FakeClient:
    def __init__(self, content: bytes) -> None:
        self.content = content

    async def search(self, source, target):
        return [
            Candidate(
                url="https://www.psacard.com/auctionprices/basketball-cards/2010-panini-elite-black-box/101090",
                title="2010 Panini Elite Black Box",
                source_id="psa",
                domain="www.psacard.com",
                trust_score=96,
                import_policy="auto_import",
                exact_match=True,
                reason="Exact PSA set page.",
            )
        ]

    async def download(self, url):
        return DownloadedFile(
            url=url,
            content=self.content,
            content_type="text/html",
            sha256=hashlib.sha256(self.content).hexdigest(),
            extension=".html",
        )


def build_sentinel(tmp_path: Path) -> tuple[ChecklistSentinel, str]:
    service_root = tmp_path / "services" / "instacomp-ai"
    service_root.mkdir(parents=True)
    sentinel = ChecklistSentinel(
        database_path=tmp_path / "sentinel.sqlite3",
        service_root=service_root,
    )
    sentinel.search_delay_seconds = 0
    sentinel.store.initialize()
    sentinel.store.seed_sources(DEFAULT_SOURCES)
    sentinel.store.upsert_targets([TARGET])
    job_id, _ = sentinel.store.acquire_job("test", sentinel.stale_seconds)
    assert job_id
    return sentinel, job_id


@pytest.mark.asyncio
async def test_archived_or_pending_registry_source_does_not_mark_target_recovered(
    tmp_path: Path,
) -> None:
    sentinel, job_id = build_sentinel(tmp_path)

    async def pending_import(**kwargs):
        return "downloaded_local_pending_registry_validation", "sentinel-archive:test"

    sentinel._import_to_registry = pending_import  # type: ignore[method-assign]
    result = await sentinel._process_target(
        job_id=job_id,
        target=TARGET,
        sources=[next(row for row in DEFAULT_SOURCES if row["source_id"] == "psa")],
        client=FakeClient(b"<html><body>PSA evidence only</body></html>"),
    )

    row = next(row for row in sentinel.store.list_targets(limit=10) if row["target_key"] == TARGET["target_key"])
    assert result["downloaded"] == 1
    assert result["imported"] == 0
    assert row["status"] == "lead_only"
    assert row["recovered_download_id"] is None


@pytest.mark.asyncio
async def test_only_registry_imported_source_marks_target_recovered(tmp_path: Path) -> None:
    sentinel, job_id = build_sentinel(tmp_path)

    async def accepted_import(**kwargs):
        return "imported_registry", "registry:test"

    sentinel._import_to_registry = accepted_import  # type: ignore[method-assign]
    result = await sentinel._process_target(
        job_id=job_id,
        target=TARGET,
        sources=[next(row for row in DEFAULT_SOURCES if row["source_id"] == "psa")],
        client=FakeClient(b"<html><body>Registry accepted rows</body></html>"),
    )

    row = next(row for row in sentinel.store.list_targets(limit=10) if row["target_key"] == TARGET["target_key"])
    assert result["downloaded"] == 1
    assert result["imported"] == 1
    assert row["status"] == "recovered"
    assert row["recovered_download_id"]
