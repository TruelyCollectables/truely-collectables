from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path

import pytest

from app.sentinel import ChecklistSentinel, rotated_sentinel_sources, sentinel_source_order
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


def test_known_sentinel_sources_run_before_generic_search_engines() -> None:
    sources = [
        {"source_id": "google", "trust_score": 60},
        {"source_id": "bing", "trust_score": 60},
        {"source_id": "tcdb", "trust_score": 55},
        {"source_id": "blowout", "trust_score": 55},
        {"source_id": "psa", "trust_score": 96},
        {"source_id": "panini", "trust_score": 100},
    ]
    ordered = [source["source_id"] for source in sorted(sources, key=sentinel_source_order)]
    assert ordered == ["psa", "panini", "blowout", "tcdb", "bing", "google"]


def test_golden_sources_rotate_before_generic_search_engines() -> None:
    sources = [
        {"source_id": "psa", "trust_score": 96},
        {"source_id": "panini", "trust_score": 100},
        {"source_id": "topps", "trust_score": 100},
        {"source_id": "upperdeck", "trust_score": 100},
        {"source_id": "leaf", "trust_score": 98},
        {"source_id": "beckett", "trust_score": 90},
        {"source_id": "gogts", "trust_score": 84},
        {"source_id": "cardboardconnection", "trust_score": 88},
        {"source_id": "bing", "trust_score": 60},
        {"source_id": "google", "trust_score": 60},
    ]
    topps = [source["source_id"] for source in rotated_sentinel_sources(
        sources, 0, {"manufacturer": "Topps"}
    )]
    upperdeck = [source["source_id"] for source in rotated_sentinel_sources(
        sources, 1, {"manufacturer": "Upper Deck"}
    )]

    assert topps[:3] == ["topps", "beckett", "gogts"]
    assert upperdeck[:3] == ["upperdeck", "beckett", "gogts"]
    assert topps[-2:] == ["google", "bing"]
    assert upperdeck[-2:] == ["google", "bing"]


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


def test_inventory_gap_target_timeout_is_bounded() -> None:
    sentinel = ChecklistSentinel.__new__(ChecklistSentinel)
    sentinel.target_timeout_seconds = 600.0
    assert sentinel._effective_target_timeout({"scope": "inventory-gap"}) == 180.0
    assert sentinel._effective_target_timeout({"scope": "scan-recovery"}) == 180.0
    assert sentinel._effective_target_timeout({"scope": "mainstream-2000plus-priority"}) == 600.0


@pytest.mark.asyncio
async def test_inventory_registry_progress_returns_before_search_delay(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service_root = tmp_path / "services" / "instacomp-ai"
    data = service_root / "data"
    data.mkdir(parents=True)
    monkeypatch.setenv("INSTACOMP_AI_SENTINEL_ENABLED", "false")
    sentinel = ChecklistSentinel(database_path=data / "instacomp.sqlite3", service_root=service_root)
    await sentinel.start()
    target = {
        "target_key": "inventory-gap-v2|baseball|2024|topps|chrome-logofractor",
        "sport": "baseball", "year": 2024, "season": "2024",
        "manufacturer": "Topps", "product": "Chrome Logofractor",
        "scope": "inventory-gap", "priority": 1,
    }
    sentinel.store.upsert_targets([target])
    sources = [s for s in sentinel.store.list_sources(enabled_only=True) if s["source_id"] == "topps"]

    async def fake_import(**_kwargs):
        return "imported_registry", "release:test:covered=10:inserted=10"

    monkeypatch.setattr(sentinel, "_import_to_registry", fake_import)
    sentinel.search_delay_seconds = 60.0
    job_id, _ = sentinel.store.acquire_job("test-progress", stale_seconds=60)
    assert job_id
    result = await asyncio.wait_for(
        sentinel._process_target(
            job_id=job_id,
            target=sentinel.store.targets_by_keys([target["target_key"]])[0],
            sources=sources,
            client=FakeSourceClient(),
        ),
        timeout=0.5,
    )
    assert result["imported"] == 1
    row = sentinel.store.targets_by_keys([target["target_key"]])[0]
    assert row["status"] == "recovered"
    await sentinel.stop()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("inserted", "expected_target_status", "expected_imported", "expected_job_status"),
    [
        (0, "pending", 0, "completed_no_registry_progress"),
        (10, "recovered", 1, "completed"),
    ],
)
async def test_target_timeout_after_registry_import_is_not_failed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    inserted: int,
    expected_target_status: str,
    expected_imported: int,
    expected_job_status: str,
) -> None:
    service_root = tmp_path / "services" / "instacomp-ai"
    data = service_root / "data"
    data.mkdir(parents=True)
    monkeypatch.setenv("INSTACOMP_AI_SENTINEL_ENABLED", "false")
    sentinel = ChecklistSentinel(database_path=data / "instacomp.sqlite3", service_root=service_root)
    await sentinel.start()
    sentinel.registry_store.initialize()
    sentinel.checkpoint_seconds = 3600
    target = {
        "target_key": "inventory-gap-v2|basketball|2024|panini|prizm",
        "sport": "basketball", "year": 2024, "season": "2024",
        "manufacturer": "Panini", "product": "Prizm",
        "scope": "inventory-gap", "priority": 1,
    }
    sentinel.store.upsert_targets([target])
    monkeypatch.setattr(sentinel, "_effective_target_timeout", lambda _target: 0.03)

    async def fake_process_target(*, job_id, target, sources, client):
        sha = f"{inserted + 1:064x}"
        finding_id = sentinel.store.record_finding(
            job_id=job_id,
            target_key=target["target_key"],
            source_id="panini",
            url="https://example.test/prizm-checklist.xlsx",
            title="2024 Panini Prizm Basketball Checklist",
            domain="example.test",
            trust_score=100,
            exact_match=True,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            status="validated_candidate",
            reason="exact",
        )
        receipt = f"release:test:covered=10:inserted={inserted}"
        download_id = sentinel.store.record_download(
            finding_id=finding_id,
            target_key=target["target_key"],
            source_url="https://example.test/prizm-checklist.xlsx",
            local_path="/tmp/prizm-checklist.xlsx",
            sha256=sha,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            byte_count=123,
            status="imported_registry",
            registry_receipt=receipt,
        )
        assert download_id
        from app.sentinel_store import iso_now
        with sentinel.registry_store.connection() as db:
            db.execute(
                """INSERT OR REPLACE INTO checklist_registry_imports
                (source_sha256,source_url,source_name,target_key,source_path,authority,
                 content_type,byte_count,registry_receipt,imported_at,plan_json,import_status,import_error)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)""",
                (
                    sha, "https://example.test/prizm-checklist.xlsx", "test", target["target_key"],
                    "/tmp/prizm-checklist.xlsx", "test", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    123, "release:test", iso_now(), "{}", "imported",
                ),
            )
        await asyncio.sleep(1)
        return {"found": 0, "downloaded": 1, "imported": 1, "duplicates": 0}

    monkeypatch.setattr(sentinel, "_process_target", fake_process_target)
    job_id, _ = sentinel.store.acquire_job("timeout-import", stale_seconds=60)
    assert job_id
    await sentinel._run(job_id, [target["target_key"]])
    job = sentinel.store.latest_job()
    assert job is not None
    assert job["status"] == expected_job_status
    assert job["failed_count"] == 0
    assert job["downloaded_count"] == 1
    assert job["imported_count"] == expected_imported
    row = sentinel.store.targets_by_keys([target["target_key"]])[0]
    assert row["status"] == expected_target_status
    assert row["metadata"]["successful_registry_imports"] == 1
    assert row["metadata"]["registry_progress_imports"] == expected_imported
    assert "last_error" not in row["metadata"]
    await sentinel.stop()
