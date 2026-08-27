from __future__ import annotations

from pathlib import Path

from app.sentinel_store import SentinelStore, iso_now


def _target(key: str, product: str) -> dict:
    sport, year, manufacturer, _ = key.split("|", 3)
    return {
        "target_key": key,
        "sport": sport,
        "year": int(year),
        "season": year,
        "manufacturer": manufacturer,
        "product": product,
        "scope": "mainstream-2000plus-priority",
        "priority": 50,
    }


def test_requeue_targets_only_forces_unresolved_due_now(tmp_path: Path) -> None:
    store = SentinelStore(tmp_path / "sentinel.sqlite3")
    store.initialize()
    keys = {
        "pending": "football|2024|topps|chrome",
        "no_result": "baseball|2024|topps|series-1",
        "lead_only": "basketball|2024|panini|prizm",
        "failed": "hockey|2024|upper-deck|series-2",
        "recovered": "baseball|2024|topps|heritage",
    }
    store.upsert_targets([_target(value, name) for name, value in keys.items()])

    future = "2099-01-01T00:00:00+00:00"
    with store.connection() as db:
        for status, key in keys.items():
            db.execute(
                """
                UPDATE checklist_sentinel_targets
                SET status = ?, attempts = 7, next_search_at = ?, priority = 50,
                    last_searched_at = ?, recovered_download_id = ?
                WHERE target_key = ?
                """,
                (
                    status,
                    future,
                    iso_now(),
                    "download-proof" if status == "recovered" else None,
                    key,
                ),
            )

    result = store.requeue_targets(list(keys.values()) + ["missing|2024|x|y"], priority=1)

    assert result == {
        "requested": 6,
        "matched": 5,
        "requeued": 4,
        "recovered_skipped": 1,
        "other_skipped": 0,
    }

    rows = {row["target_key"]: row for row in store.list_targets(limit=20)}
    for status in ("pending", "no_result", "lead_only", "failed"):
        row = rows[keys[status]]
        assert row["status"] == "pending"
        assert row["priority"] == 1
        assert row["attempts"] == 7
        assert row["last_searched_at"] is not None
        assert row["next_search_at"] < future

    recovered = rows[keys["recovered"]]
    assert recovered["status"] == "recovered"
    assert recovered["priority"] == 50
    assert recovered["attempts"] == 7
    assert recovered["next_search_at"] == future
    assert recovered["recovered_download_id"] == "download-proof"
