from __future__ import annotations

from pathlib import Path

from app.deal_hunter_store import DealHunterStore
from app.deal_hunter_targeted import ALLOWED_TARGET_LANES, select_targeted_candidates


class Settings:
    deal_hunter_candidate_cooldown_hours = 6
    deal_hunter_max_candidates_per_run = 2


class SchedulerStub:
    def __init__(self, store):
        self.settings = Settings()
        self.store = store

    def _select_for_evaluation(self, candidates):
        return [], len(candidates)


def candidate(index: int):
    return {
        "candidate_key": f"ebay:{index}",
        "listing_url": f"https://www.ebay.com/itm/{index}",
        "title": f"Ivan Demidov card {index}",
        "image_urls": ["front", "back"],
        "item_price": float(index + 1),
    }


def test_ivan_lane_is_allowlisted():
    assert "ivan_demidov" in ALLOWED_TARGET_LANES


def test_force_bypasses_only_cooldown_and_respects_configured_limit(tmp_path: Path):
    store = DealHunterStore(tmp_path / "targeted.sqlite3")
    store.initialize()
    scheduler = SchedulerStub(store)
    candidates = [candidate(index) for index in range(5)]

    selected, deferred = select_targeted_candidates(
        scheduler,
        candidates,
        force=True,
        limit=20,
    )

    assert [row["candidate_key"] for row in selected] == ["ebay:0", "ebay:1"]
    assert deferred == 3


def test_non_force_delegates_to_normal_cooldown_selection(tmp_path: Path):
    store = DealHunterStore(tmp_path / "normal.sqlite3")
    store.initialize()
    scheduler = SchedulerStub(store)

    selected, deferred = select_targeted_candidates(
        scheduler,
        [candidate(0)],
        force=False,
        limit=1,
    )

    assert selected == []
    assert deferred == 1
