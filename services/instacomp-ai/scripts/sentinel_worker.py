from __future__ import annotations

import asyncio
import signal
import time
from pathlib import Path

from app.config import settings
from app.sentinel import ChecklistSentinel


POLL_SECONDS = 30.0
REFRESH_REQUEST = settings.service_root / "data" / "sentinel-worker-refresh.request"
STATE_ROOT = Path.home() / "Library" / "Application Support" / "Unsworth"
ACTIVE_FLAG = STATE_ROOT / "sentinel-active"


async def main() -> None:
    sentinel = ChecklistSentinel(
        database_path=settings.resolve_local_path(settings.database_path),
        service_root=settings.service_root,
        coordinated_runs=True,
    )
    # Worker owns scheduling. Initialize/recover state without launching the
    # class's in-process scheduler task; this keeps ownership explicit.
    sentinel.auto_start = False
    await sentinel.start()
    sentinel.auto_start = True

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    ACTIVE_FLAG.unlink(missing_ok=True)

    async def coordinated_refresh() -> None:
        lease = await sentinel._heavy_work.acquire(
            "sentinel-inventory-refresh",
            priority=60,
            lease_seconds=120.0,
        )
        ACTIVE_FLAG.write_text("inventory-refresh\n")
        try:
            await sentinel.refresh_inventory_targets()
            await sentinel.refresh_targets()
        finally:
            ACTIVE_FLAG.unlink(missing_ok=True)
            await lease.release()

    await coordinated_refresh()
    next_inventory_refresh = time.monotonic() + sentinel.interval_seconds

    try:
        while not stop.is_set():
            refresh_requested = REFRESH_REQUEST.exists()
            if refresh_requested or time.monotonic() >= next_inventory_refresh:
                await coordinated_refresh()
                REFRESH_REQUEST.unlink(missing_ok=True)
                next_inventory_refresh = time.monotonic() + sentinel.interval_seconds

            latest = sentinel.store.latest_job() or {}
            running = str(latest.get("status") or "") == "running"
            if not running and sentinel.store.due_targets(1):
                launch = await sentinel.trigger("external-worker-backlog")
                if launch.get("accepted") and sentinel._run_task is not None:
                    ACTIVE_FLAG.write_text(str(launch.get("job_id") or "running") + "\n")
                    try:
                        await sentinel._run_task
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        # Sentinel persists its own failure/checkpoint state.
                        pass
                    finally:
                        ACTIVE_FLAG.unlink(missing_ok=True)

            try:
                await asyncio.wait_for(stop.wait(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                continue
    finally:
        ACTIVE_FLAG.unlink(missing_ok=True)
        await sentinel.stop()


if __name__ == "__main__":
    asyncio.run(main())
