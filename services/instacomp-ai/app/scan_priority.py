from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

STATE_ROOT = Path.home() / "Library" / "Application Support" / "Unsworth"
STATE_GLOB = "instacomp-scan-priority-*.state"
DEFAULT_COOLDOWN_SECONDS = 15.0
DEFAULT_ACTIVE_SCAN_TIMEOUT_SECONDS = 600.0


def _state_path(pid: int | None = None) -> Path:
    process_id = int(pid or os.getpid())
    return STATE_ROOT / f"instacomp-scan-priority-{process_id}.state"


def publish_scan_priority_state(active_scans: int) -> None:
    """Atomically publish seller-facing physical scan activity for Mac workers."""
    try:
        STATE_ROOT.mkdir(parents=True, exist_ok=True)
        pid = os.getpid()
        target = _state_path(pid)
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_text(
            f"{pid}|{max(0, int(active_scans))}|{int(time.time())}\n",
            encoding="utf-8",
        )
        os.replace(temporary, target)
    except OSError:
        # Scan correctness must never depend on the advisory priority marker.
        return


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def scan_priority_active(
    *,
    cooldown_seconds: float = DEFAULT_COOLDOWN_SECONDS,
    active_timeout_seconds: float = DEFAULT_ACTIVE_SCAN_TIMEOUT_SECONDS,
) -> bool:
    now = time.time()
    try:
        candidates = list(STATE_ROOT.glob(STATE_GLOB))
    except OSError:
        return False
    for path in candidates:
        try:
            raw = path.read_text(encoding="utf-8").strip()
            pid_text, active_text, epoch_text = raw.split("|", 2)
            pid = int(pid_text)
            active = max(0, int(active_text))
            epoch = float(epoch_text)
        except (OSError, TypeError, ValueError):
            continue
        age = max(0.0, now - epoch)
        alive = _pid_alive(pid)
        cooldown = max(0.0, float(cooldown_seconds))
        active_timeout = max(cooldown, float(active_timeout_seconds))
        if active > 0 and alive and age <= active_timeout:
            return True
        if age <= cooldown:
            return True
        # Active markers are edge-triggered at scan start/end, not heartbeats.
        # Expire even a live-PID marker after the bounded scan grace so a hung
        # request cannot steal an entire overnight training window.
        if (
            (active > 0 and alive and age > active_timeout)
            or (not alive and age > max(60.0, cooldown))
            or age > 3600.0
        ):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    return False


async def wait_for_scan_priority_clear(
    *,
    stop_event: asyncio.Event | None = None,
    cooldown_seconds: float = DEFAULT_COOLDOWN_SECONDS,
    poll_seconds: float = 0.25,
) -> bool:
    """Yield background work until interactive InstaComp scanning is quiet."""
    interval = max(0.05, float(poll_seconds))
    while scan_priority_active(cooldown_seconds=cooldown_seconds):
        if stop_event is None:
            await asyncio.sleep(interval)
            continue
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=interval)
            return False
        except asyncio.TimeoutError:
            continue
    return True
