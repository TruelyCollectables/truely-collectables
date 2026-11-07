from __future__ import annotations

import asyncio
import signal
from pathlib import Path

from app.config import settings
from app.deal_hunter import DealHunterScheduler
from app.deal_hunter_store import DealHunterStore


STATE_ROOT = Path.home() / "Library" / "Application Support" / "Unsworth"
ACTIVE_FLAG = STATE_ROOT / "deal-hunter-active"


async def main() -> None:
    store = DealHunterStore(settings.resolve_local_path(settings.deal_hunter_database_path))
    scheduler = DealHunterScheduler(settings, store)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            pass

    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    await scheduler.start()
    try:
        while not stop.is_set():
            state = store.scheduler_state()
            if bool(state.get("running")):
                ACTIVE_FLAG.write_text(str(state.get("active_run_id") or "running") + "\n")
            else:
                ACTIVE_FLAG.unlink(missing_ok=True)
            try:
                await asyncio.wait_for(stop.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                continue
    finally:
        ACTIVE_FLAG.unlink(missing_ok=True)
        await scheduler.stop()


if __name__ == "__main__":
    asyncio.run(main())
