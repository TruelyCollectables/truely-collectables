from __future__ import annotations

import asyncio
import time
from pathlib import Path

from app.resource_coordinator import HeavyWorkCoordinator


def test_heavy_work_lease_serializes_background_workers(tmp_path):
    coordinator = HeavyWorkCoordinator(tmp_path / "background.sqlite3")

    async def scenario():
        first = await coordinator.acquire("sentinel", priority=60, lease_seconds=2.0)
        acquired_second = asyncio.Event()

        async def second_worker():
            lease = await coordinator.acquire("deal-hunter", priority=80, lease_seconds=2.0)
            acquired_second.set()
            await lease.release()

        task = asyncio.create_task(second_worker())
        await asyncio.sleep(0.12)
        assert not acquired_second.is_set()
        await first.release()
        await asyncio.wait_for(task, timeout=2.0)
        assert acquired_second.is_set()
        assert coordinator.snapshot()["lease"] is None

    asyncio.run(scenario())


def test_heavy_work_waiters_honor_priority(tmp_path):
    coordinator = HeavyWorkCoordinator(tmp_path / "background.sqlite3")

    async def scenario():
        blocker = await coordinator.acquire("blocker", priority=50, lease_seconds=2.0)
        order: list[str] = []

        async def contender(name: str, priority: int):
            lease = await coordinator.acquire(name, priority=priority, lease_seconds=2.0)
            order.append(name)
            await asyncio.sleep(0.05)
            await lease.release()

        low = asyncio.create_task(contender("sentinel", 60))
        await asyncio.sleep(0.03)
        high = asyncio.create_task(contender("deal-hunter", 80))
        await asyncio.sleep(0.08)
        await blocker.release()
        await asyncio.gather(low, high)
        assert order == ["deal-hunter", "sentinel"]

    asyncio.run(scenario())


def test_expired_lease_is_reclaimed(tmp_path):
    coordinator = HeavyWorkCoordinator(tmp_path / "background.sqlite3")
    token = "stale-token"
    with coordinator.connection() as db:
        now = time.time()
        db.execute(
            "INSERT INTO heavy_work_lease "
            "(slot,token,owner,priority,pid,acquired_at,heartbeat_at,expires_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (coordinator.slot, token, "dead-worker", 90, 999999, now - 10, now - 10, now - 1),
        )

    async def scenario():
        lease = await coordinator.acquire("sentinel", priority=60, lease_seconds=1.0)
        assert "sentinel" in lease.owner
        await lease.release()

    asyncio.run(scenario())


def test_unsworth_owns_isolated_workers_and_api_disables_embedded_schedulers():
    service_root = Path(__file__).resolve().parents[1]
    source = (service_root / "scripts" / "unsworth.sh").read_text()
    assert "INSTACOMP_AI_EXTERNAL_BACKGROUND_WORKERS=1" in source
    assert 'start_loop "sentinel-worker"' in source
    assert 'start_loop "deal-hunter-worker"' in source
    assert 'start_loop "deal-hunter-scheduler"' not in source
    assert '"$STATE_ROOT/sentinel-active"' in source


def test_worker_wrappers_set_service_import_path_and_low_priority():
    service_root = Path(__file__).resolve().parents[1]
    sentinel = (service_root / "scripts" / "run-sentinel-worker.sh").read_text()
    deal = (service_root / "scripts" / "run-deal-hunter-worker.sh").read_text()
    for source in (sentinel, deal):
        assert 'export PYTHONPATH="$service_root${PYTHONPATH:+:$PYTHONPATH}"' in source
        assert "/usr/bin/nice -n 10" in source
    assert "INSTACOMP_AI_DEAL_HUNTER_RUN_ON_STARTUP=false" in deal
