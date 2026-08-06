from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from app.sentinel import ChecklistSentinel
from app.sentinel_sources import (
    Candidate,
    DownloadedFile,
    exact_target_match,
    parse_target_key,
)
from app.sentinel_store import SentinelStore


def test_exact_target_match_rejects_wrong_year() -> None:
    target = {
        "scope": "exact-gap",
        "year": 2024,
        "season": "2024",
        "manufacturer": "Topps",
        "product": "Chrome Logofractor",
    }
    exact, reason = exact_target_match(
        target,
        "2023 Topps Chrome Logofractor Baseball Checklist",
        "https://example.com/2023-topps-chrome-logofractor",
    )
    assert exact is False
    assert "Season/year" in reason


def test_exact_target_match_accepts_identity_tokens() -> None:
    target = {
        "scope": "exact-gap",
        "year": 2024,
        "season": "2024",
        "manufacturer": "Topps",
        "product": "Chrome Logofractor",
    }
    exact, reason = exact_target_match(
        target,
        "2024 Topps Chrome Logofractor Baseball Checklist",
        "https://www.topps.com/2024-topps-chrome-logofractor-checklist.pdf",
    )
    assert exact is True
    assert "overlap" in reason


def test_target_key_parser() -> None:
    target = parse_target_key("hockey|2024-25|upper-deck|artifacts")
    assert target is not None
    assert target["sport"] == "hockey"
    assert target["year"] == 2024
    assert target["manufacturer"] == "upper-deck"
    assert target["product"] == "artifacts"


def test_sentinel_store_freeze_resume_and_sha_dedupe(tmp_path: Path) -> None:
    path = tmp_path / "instacomp.sqlite3"
    store = SentinelStore(path)
    store.initialize()
    store.seed_sources(
        [
            {
                "source_id": "topps",
                "name": "Topps",
                "kind": "site_search",
                "trust_score": 100,
                "import_policy": "auto_import",
                "search_url_template": "https://example.com?q={query}",
                "domains": ["topps.com"],
            }
        ]
    )
    store.upsert_targets(
        [
            {
                "target_key": "baseball|2024|topps|chrome-logofractor",
                "sport": "baseball",
                "year": 2024,
                "season": "2024",
                "manufacturer": "Topps",
                "product": "Chrome Logofractor",
                "scope": "exact-gap",
                "priority": 10,
            }
        ]
    )

    job_id, existing = store.acquire_job("test", stale_seconds=1)
    assert job_id is not None
    assert existing is None
    store.heartbeat(
        job_id,
        total_targets=1,
        processed_targets=0,
        checkpoint={"phase": "searching"},
    )
    status = store.latest_job()
    assert status is not None
    assert status["status"] == "running"
    assert status["checkpoint"]["phase"] == "searching"

    finding_id = store.record_finding(
        job_id=job_id,
        target_key="baseball|2024|topps|chrome-logofractor",
        source_id="topps",
        url="https://www.topps.com/checklist.pdf",
        title="2024 Topps Chrome Logofractor Checklist",
        domain="www.topps.com",
        trust_score=100,
        exact_match=True,
        content_type="application/pdf",
        status="validated_candidate",
        reason="exact",
    )
    payload = b"test checklist bytes"
    digest = hashlib.sha256(payload).hexdigest()
    download_id = store.record_download(
        finding_id=finding_id,
        target_key="baseball|2024|topps|chrome-logofractor",
        source_url="https://www.topps.com/checklist.pdf",
        local_path="/tmp/checklist.pdf",
        sha256=digest,
        content_type="application/pdf",
        byte_count=len(payload),
        status="downloaded_local_pending_registry_import",
    )
    assert download_id
    assert store.sha_exists(digest) is not None


@pytest.mark.asyncio
async def test_service_start_seeds_sources_and_targets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service_root = tmp_path / "services" / "instacomp-ai"
    data = service_root / "data"
    data.mkdir(parents=True)
    (data / "sentinel-target-keys.txt").write_text(
        "baseball|2024|topps|chrome-logofractor\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("INSTACOMP_AI_SENTINEL_ENABLED", "false")
    sentinel = ChecklistSentinel(
        database_path=data / "instacomp.sqlite3",
        service_root=service_root,
    )
    await sentinel.start()
    status = sentinel.status()
    assert status["name"] == "InstaComp AI Checklist Sentinel™"
    assert status["targets"]["total"] >= 73
    assert len(sentinel.store.list_sources(enabled_only=True)) >= 18
    await sentinel.stop()


class FakeSourceClient:
    async def search(self, source, target):
        if source["source_id"] != "topps":
            return []
        return [
            Candidate(
                url="https://www.topps.com/checklists/exact.pdf",
                title="2024 Topps Chrome Logofractor Baseball Checklist",
                source_id="topps",
                domain="www.topps.com",
                trust_score=100,
                import_policy="auto_import",
                exact_match=True,
                reason="Exact identity token overlap 1.00.",
            )
        ]

    async def download(self, url):
        payload = b"%PDF sentinel test"
        return DownloadedFile(
            url=url,
            content=payload,
            content_type="application/pdf",
            sha256=hashlib.sha256(payload).hexdigest(),
            extension=".pdf",
        )


@pytest.mark.asyncio
async def test_process_target_downloads_trusted_exact_match(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service_root = tmp_path / "services" / "instacomp-ai"
    data = service_root / "data"
    data.mkdir(parents=True)
    monkeypatch.setenv("INSTACOMP_AI_SENTINEL_ENABLED", "false")
    sentinel = ChecklistSentinel(
        database_path=data / "instacomp.sqlite3",
        service_root=service_root,
    )
    await sentinel.start()
    sentinel.store.upsert_targets(
        [
            {
                "target_key": "baseball|2024|topps|chrome-logofractor",
                "sport": "baseball",
                "year": 2024,
                "season": "2024",
                "manufacturer": "Topps",
                "product": "Chrome Logofractor",
                "scope": "exact-gap",
                "priority": 1,
            }
        ]
    )
    job_id, _ = sentinel.store.acquire_job("test", stale_seconds=60)
    assert job_id
    sources = [
        source
        for source in sentinel.store.list_sources(enabled_only=True)
        if source["source_id"] == "topps"
    ]
    result = await sentinel._process_target(
        job_id=job_id,
        target=sentinel.store.list_targets(
            status="pending", limit=1
        )[0],
        sources=sources,
        client=FakeSourceClient(),
    )
    assert result["downloaded"] == 1
    downloads = sentinel.store.list_downloads()
    assert len(downloads) == 1
    assert Path(downloads[0]["local_path"]).is_file()
    await sentinel.stop()
