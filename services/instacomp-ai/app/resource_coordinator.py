from __future__ import annotations

import asyncio
import os
import sqlite3
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4


@dataclass
class HeavyWorkLease:
    coordinator: "HeavyWorkCoordinator"
    token: str
    owner: str
    _stop: asyncio.Event
    _heartbeat_task: asyncio.Task | None = None

    async def release(self) -> None:
        self._stop.set()
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None
        await asyncio.to_thread(self.coordinator._release, self.token)


class HeavyWorkCoordinator:
    """Cross-process single-slot coordinator for background heavy work."""

    def __init__(self, path: Path, *, slot: str = "mac-heavy-work") -> None:
        self.path = Path(path)
        self.slot = slot
        self.initialize()

    def connection(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=15.0)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA busy_timeout=15000")
        return db

    def initialize(self) -> None:
        with self.connection() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS heavy_work_lease (
                    slot TEXT PRIMARY KEY,
                    token TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    pid INTEGER NOT NULL,
                    acquired_at REAL NOT NULL,
                    heartbeat_at REAL NOT NULL,
                    expires_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS heavy_work_waiters (
                    token TEXT PRIMARY KEY,
                    slot TEXT NOT NULL,
                    owner TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    pid INTEGER NOT NULL,
                    requested_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS heavy_work_waiters_order_idx
                    ON heavy_work_waiters(slot, priority DESC, requested_at ASC);
                """
            )

    def _register_waiter(self, token: str, owner: str, priority: int) -> None:
        now = time.time()
        with self.connection() as db:
            db.execute(
                "INSERT OR REPLACE INTO heavy_work_waiters "
                "(token,slot,owner,priority,pid,requested_at) VALUES (?,?,?,?,?,?)",
                (token, self.slot, owner, int(priority), os.getpid(), now),
            )

    def _try_acquire(self, token: str, owner: str, priority: int, lease_seconds: float) -> bool:
        now = time.time()
        db = self.connection()
        try:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM heavy_work_lease WHERE slot=? AND expires_at<=?", (self.slot, now))
            current = db.execute("SELECT token FROM heavy_work_lease WHERE slot=?", (self.slot,)).fetchone()
            if current is not None:
                db.commit()
                return False
            first = db.execute(
                "SELECT token FROM heavy_work_waiters WHERE slot=? "
                "ORDER BY priority DESC, requested_at ASC LIMIT 1",
                (self.slot,),
            ).fetchone()
            if first is not None and str(first["token"]) != token:
                db.commit()
                return False
            db.execute(
                "INSERT INTO heavy_work_lease "
                "(slot,token,owner,priority,pid,acquired_at,heartbeat_at,expires_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (self.slot, token, owner, int(priority), os.getpid(), now, now, now + lease_seconds),
            )
            db.execute("DELETE FROM heavy_work_waiters WHERE token=?", (token,))
            db.commit()
            return True
        finally:
            db.close()

    def _heartbeat(self, token: str, lease_seconds: float) -> bool:
        now = time.time()
        with self.connection() as db:
            cursor = db.execute(
                "UPDATE heavy_work_lease SET heartbeat_at=?, expires_at=? "
                "WHERE slot=? AND token=?",
                (now, now + lease_seconds, self.slot, token),
            )
            return int(cursor.rowcount or 0) == 1

    def _release(self, token: str) -> None:
        with self.connection() as db:
            db.execute("DELETE FROM heavy_work_lease WHERE slot=? AND token=?", (self.slot, token))
            db.execute("DELETE FROM heavy_work_waiters WHERE token=?", (token,))

    def _cancel_waiter(self, token: str) -> None:
        with self.connection() as db:
            db.execute("DELETE FROM heavy_work_waiters WHERE token=?", (token,))

    async def acquire(
        self,
        owner: str,
        *,
        priority: int,
        lease_seconds: float = 120.0,
        wait_timeout: float | None = None,
        poll_seconds: float = 0.5,
    ) -> HeavyWorkLease:
        token = str(uuid4())
        owner_text = f"{owner}:pid={os.getpid()}"
        await asyncio.to_thread(self._register_waiter, token, owner_text, priority)
        started = time.monotonic()
        try:
            while True:
                if await asyncio.to_thread(self._try_acquire, token, owner_text, priority, lease_seconds):
                    stop = asyncio.Event()
                    lease = HeavyWorkLease(self, token, owner_text, stop)
                    lease._heartbeat_task = asyncio.create_task(
                        self._heartbeat_loop(token, lease_seconds, stop),
                        name=f"heavy-work-heartbeat-{owner}",
                    )
                    return lease
                if wait_timeout is not None and time.monotonic() - started >= wait_timeout:
                    raise TimeoutError(f"Timed out waiting for background heavy-work slot: {owner}")
                await asyncio.sleep(max(0.05, poll_seconds))
        except BaseException:
            await asyncio.to_thread(self._cancel_waiter, token)
            raise

    async def _heartbeat_loop(self, token: str, lease_seconds: float, stop: asyncio.Event) -> None:
        interval = max(5.0, min(30.0, lease_seconds / 3.0))
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
                return
            except asyncio.TimeoutError:
                if not await asyncio.to_thread(self._heartbeat, token, lease_seconds):
                    return

    @asynccontextmanager
    async def lease(self, owner: str, *, priority: int, lease_seconds: float = 120.0):
        lease = await self.acquire(owner, priority=priority, lease_seconds=lease_seconds)
        try:
            yield lease
        finally:
            await lease.release()

    def snapshot(self) -> dict:
        now = time.time()
        with self.connection() as db:
            db.execute("DELETE FROM heavy_work_lease WHERE slot=? AND expires_at<=?", (self.slot, now))
            lease = db.execute("SELECT * FROM heavy_work_lease WHERE slot=?", (self.slot,)).fetchone()
            waiters = db.execute(
                "SELECT owner,priority,pid,requested_at FROM heavy_work_waiters WHERE slot=? "
                "ORDER BY priority DESC, requested_at ASC",
                (self.slot,),
            ).fetchall()
        return {"lease": dict(lease) if lease else None, "waiters": [dict(row) for row in waiters]}


class CoordinatedAsyncLock:
    """Drop-in asyncio.Lock wrapper that also owns the cross-process heavy slot."""

    def __init__(self, local_lock: asyncio.Lock, coordinator: HeavyWorkCoordinator, *, owner: str, priority: int):
        self.local_lock = local_lock
        self.coordinator = coordinator
        self.owner = owner
        self.priority = priority
        self._lease: HeavyWorkLease | None = None

    def locked(self) -> bool:
        return self.local_lock.locked()

    async def __aenter__(self):
        await self.local_lock.acquire()
        try:
            self._lease = await self.coordinator.acquire(self.owner, priority=self.priority)
        except BaseException:
            self.local_lock.release()
            raise
        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self._lease:
            await self._lease.release()
            self._lease = None
        self.local_lock.release()
        return False
