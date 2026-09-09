from pathlib import Path

from app.sentinel_store import SentinelStore


def test_due_for_run_reclaims_stale_running_job(tmp_path: Path) -> None:
    store = SentinelStore(tmp_path / "sentinel.sqlite3")
    store.initialize()
    job_id, existing = store.acquire_job("health-test", stale_seconds=60)
    assert job_id is not None and existing is None

    with store.connection() as db:
        db.execute(
            "UPDATE checklist_sentinel_jobs SET heartbeat_at = ? WHERE job_id = ?",
            ("2000-01-01T00:00:00+00:00", job_id),
        )

    assert store.due_for_run(interval_seconds=86400, stale_seconds=60) is True
    latest = store.latest_job()
    assert latest is not None
    assert latest["status"] == "interrupted"
    assert "Stale heartbeat reclaimed by scheduler" in (latest["error"] or "")
