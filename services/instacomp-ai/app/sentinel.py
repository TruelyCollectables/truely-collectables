from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import subprocess
from contextlib import suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .sentinel_sources import (
    DEFAULT_SOURCES,
    SentinelSourceClient,
    broad_discovery_targets,
    parse_target_key,
    persist_download,
    targets_from_payload,
)
from .sentinel_store import SentinelStore
from .local_registry_store import LocalRegistryStore, registry_semantic_key
from .resource_coordinator import HeavyWorkCoordinator
from .inventory_checklist_targets import write_inventory_target_snapshot


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(maximum, value))


def sentinel_source_order(source: dict[str, Any]) -> tuple[int, int, str]:
    source_id = str(source.get("source_id") or "")
    if source_id == "psa":
        lane = 0
    elif source_id in GOLDEN_SOURCE_ROTATION:
        lane = 1
    elif source_id == "cardboardconnection":
        lane = 3
    elif source_id in {"google", "bing"}:
        lane = 4
    else:
        lane = 2
    return (lane, -int(source.get("trust_score") or 0), source_id)


GOLDEN_SOURCE_ROTATION = ("panini", "topps", "upperdeck", "leaf", "beckett", "gogts")


def rotated_sentinel_sources(
    sources: list[dict[str, Any]],
    target_index: int,
    target: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Manufacturer first, then Beckett/GoGTS, then trusted fallbacks."""
    by_id = {str(source.get("source_id") or ""): source for source in sources}
    manufacturer = str((target or {}).get("manufacturer") or "").strip().lower()
    aliases = {
        "upper deck": "upperdeck", "upperdeck": "upperdeck",
        "topps": "topps", "bowman": "topps",
        "panini": "panini", "donruss": "panini", "leaf": "leaf",
    }
    primary = aliases.get(manufacturer, manufacturer.replace(" ", ""))
    if (target or {}).get("scope") == "scan-recovery":
        # Live scans have a bounded latency budget. Beckett and
        # CardboardConnection expose stable release URLs that can be validated
        # and ingested directly; slow manufacturer index/search pages stay as
        # fallback rather than blocking the scan first.
        preferred = ["beckett", "cardboardconnection", primary, "gogts", "checklistinsider"]
    else:
        preferred = [primary, "beckett", "gogts"]
    ordered: list[dict[str, Any]] = []
    used: set[str] = set()
    for source_id in preferred:
        if source_id and source_id in by_id and source_id not in used:
            ordered.append(by_id[source_id])
            used.add(source_id)
    for source in sorted(sources, key=sentinel_source_order):
        source_id = str(source.get("source_id") or "")
        if source_id not in used and source_id not in {"google", "bing"}:
            ordered.append(source)
            used.add(source_id)
    for source_id in ("google", "bing"):
        if source_id in by_id and source_id not in used:
            ordered.append(by_id[source_id])
            used.add(source_id)
    return ordered


class ChecklistSentinel:
    """InstaComp AI Checklist Sentinel™.

    The service owns scheduling, state, checkpoints and source policy. It does
    not depend on ChatGPT tasks. It searches public sources, preserves exact
    provenance, downloads only trusted/public evidence, and leaves community
    material in a review queue unless provenance and redistribution permission
    are confirmed.
    """

    def __init__(
        self,
        *,
        database_path: Path,
        service_root: Path,
        coordinated_runs: bool = False,
    ) -> None:
        self.database_path = database_path
        self.service_root = service_root
        self.coordinated_runs = coordinated_runs
        self._heavy_work = HeavyWorkCoordinator(
            service_root / "data" / "database" / "background_work.sqlite3"
        )
        self.repo_root = service_root.parents[1]
        self.store = SentinelStore(database_path)
        # Canonical checklist truth lives in the Mac registry SQLite. Sentinel
        # checks it before spending search/download capacity on a target.
        self.registry_database_path = self._resolve_path(
            os.getenv(
                "INSTACOMP_AI_REGISTRY_DB_PATH",
                str(service_root / "data" / "database" / "checklist_registry.sqlite3"),
            )
        )
        self.registry_store = LocalRegistryStore(self.registry_database_path, service_root)
        self.registry_store.initialize()
        self.download_root = self._resolve_path(
            os.getenv(
                "INSTACOMP_AI_SENTINEL_DOWNLOAD_PATH",
                str(service_root / "data" / "checklist-sentinel" / "downloads"),
            )
        )
        self.auto_start = _env_bool("INSTACOMP_AI_SENTINEL_ENABLED", True)
        self.interval_seconds = _env_int(
            "INSTACOMP_AI_SENTINEL_INTERVAL_SECONDS",
            24 * 60 * 60,
            15 * 60,
            30 * 24 * 60 * 60,
        )
        self.scheduler_poll_seconds = _env_int(
            "INSTACOMP_AI_SENTINEL_POLL_SECONDS", 60, 15, 3600
        )
        self.checkpoint_seconds = _env_int(
            "INSTACOMP_AI_SENTINEL_CHECKPOINT_SECONDS", 300, 60, 3600
        )
        self.stale_seconds = _env_int(
            "INSTACOMP_AI_SENTINEL_STALE_SECONDS", 12 * 60, 5 * 60, 24 * 60 * 60
        )
        self.max_targets_per_run = _env_int(
            "INSTACOMP_AI_SENTINEL_MAX_TARGETS_PER_RUN", 75, 1, 10_000
        )
        self.max_candidates_per_target = _env_int(
            "INSTACOMP_AI_SENTINEL_MAX_CANDIDATES_PER_TARGET", 20, 1, 100
        )
        self.search_delay_seconds = _env_float(
            "INSTACOMP_AI_SENTINEL_SEARCH_DELAY_SECONDS", 1.2, 0.2, 60.0
        )
        self.request_timeout_seconds = _env_float(
            "INSTACOMP_AI_SENTINEL_REQUEST_TIMEOUT_SECONDS", 45.0, 5.0, 300.0
        )
        self.target_timeout_seconds = _env_float(
            "INSTACOMP_AI_SENTINEL_TARGET_TIMEOUT_SECONDS", 600.0, 60.0, 3600.0
        )
        self.max_download_bytes = _env_int(
            "INSTACOMP_AI_SENTINEL_MAX_DOWNLOAD_BYTES",
            50_000_000,
            1_000_000,
            500_000_000,
        )
        self.registry_import_url = os.getenv(
            "INSTACOMP_AI_SENTINEL_IMPORT_URL", ""
        ).strip()
        self.registry_token = os.getenv(
            "INSTACOMP_AI_REGISTRY_TOKEN", ""
        ).strip()
        self.target_url = os.getenv(
            "INSTACOMP_AI_SENTINEL_TARGETS_URL", ""
        ).strip()
        self._scheduler_task: asyncio.Task | None = None
        self._run_task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._start_lock = asyncio.Lock()
        self._inventory_refresh_lock = asyncio.Lock()
        self.inventory_target_path = self.service_root / "data" / "sentinel-targets.json"
        self.inventory_gap_report_path = self.service_root / "data" / "inventory-checklist-gap-report.json"

    def _resolve_path(self, value: str | Path) -> Path:
        path = Path(value).expanduser()
        if path.is_absolute():
            return path.resolve()
        return (self.service_root / path).resolve()

    async def start(self) -> None:
        self.store.initialize()
        self.store.interrupt_running_jobs(
            "Service restarted; previous in-process Sentinel job was safely interrupted."
        )
        self.store.seed_sources(DEFAULT_SOURCES)
        # Inventory truth is authoritative. Rebuild the live inventory-gap
        # snapshot before loading targets or allowing backlog drain to start,
        # so a restart can never resume stale year-only or obsolete targets.
        await self.refresh_targets()
        if not self.auto_start or self._scheduler_task:
            return
        self._stop_event.clear()
        self._scheduler_task = asyncio.create_task(
            self._scheduler_loop(),
            name="instacomp-ai-checklist-sentinel-scheduler",
        )

    async def stop(self) -> None:
        self._stop_event.set()
        tasks = [task for task in [self._scheduler_task, self._run_task] if task]
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task
        self._scheduler_task = None
        self._run_task = None

    async def refresh_targets(self) -> dict[str, int]:
        targets: list[dict[str, Any]] = []
        for path in self._target_paths():
            if not path.is_file():
                continue
            try:
                if path.suffix.lower() == ".txt":
                    for line in path.read_text("utf-8").splitlines():
                        target = parse_target_key(line)
                        if target:
                            targets.append(target)
                else:
                    payload = json.loads(path.read_text("utf-8"))
                    targets.extend(targets_from_payload(payload))
            except (OSError, json.JSONDecodeError):
                continue

        if self.target_url:
            targets.extend(await self._fetch_remote_targets())

        targets.extend(broad_discovery_targets())
        self.store.upsert_targets(targets)
        return self.store.target_counts()

    async def refresh_inventory_targets(self) -> dict[str, Any]:
        """Rebuild the crawler queue from current Mac-local inventory truth."""
        async with self._inventory_refresh_lock:
            payload = await asyncio.to_thread(
                write_inventory_target_snapshot,
                self.registry_database_path,
                self.inventory_target_path,
                self.inventory_gap_report_path,
            )
            if not payload.get("ok"):
                return payload
            targets = targets_from_payload({"targets": payload.get("targets") or []})
            sync = self.store.sync_inventory_targets(targets)
            return {
                **{k: v for k, v in payload.items() if k not in {"targets", "unresolved"}},
                "queue_sync": sync,
            }

    def _target_paths(self) -> list[Path]:
        configured = os.getenv("INSTACOMP_AI_SENTINEL_TARGETS_PATH", "").strip()
        paths: list[Path] = []
        if configured:
            for value in configured.split(","):
                if value.strip():
                    paths.append(self._resolve_path(value.strip()))
        paths.extend(
            [
                self.service_root / "data" / "sentinel-targets.json",
                self.service_root / "data" / "sentinel-target-keys.txt",
                self.repo_root / "data" / "checklist-recovery-targets.json",
                self.repo_root / "data" / "checklist-recovery-modern-gap-keys.txt",
                self.repo_root / ".checklist-recovery-state" / "targets.json",
            ]
        )
        unique: list[Path] = []
        seen: set[Path] = set()
        for path in paths:
            resolved = path.resolve()
            if resolved not in seen:
                seen.add(resolved)
                unique.append(resolved)
        return unique

    async def _fetch_remote_targets(self) -> list[dict[str, Any]]:
        headers = {"accept": "application/json"}
        if self.registry_token:
            headers["authorization"] = f"Bearer {self.registry_token}"
            headers["x-tcos-instacomp-service-token"] = self.registry_token
        try:
            async with httpx.AsyncClient(
                timeout=self.request_timeout_seconds,
                follow_redirects=True,
                headers=headers,
            ) as client:
                response = await client.get(self.target_url)
                response.raise_for_status()
            return targets_from_payload(response.json())
        except (httpx.HTTPError, json.JSONDecodeError, ValueError):
            return []

    async def _scheduler_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                if self._run_task and not self._run_task.done():
                    latest = self.store.latest_job() or {}
                    heartbeat = latest.get("heartbeat_at")
                    heartbeat_at = None
                    if heartbeat:
                        try:
                            heartbeat_at = datetime.fromisoformat(str(heartbeat).replace("Z", "+00:00"))
                        except ValueError:
                            heartbeat_at = None
                    now = datetime.now(timezone.utc)
                    if heartbeat_at and heartbeat_at.tzinfo is None:
                        heartbeat_at = heartbeat_at.replace(tzinfo=timezone.utc)
                    if heartbeat_at and (now - heartbeat_at).total_seconds() > self.stale_seconds:
                        self._run_task.cancel()
                        with suppress(asyncio.CancelledError):
                            await self._run_task
                        self._run_task = None
                if self.store.due_for_run(self.interval_seconds, self.stale_seconds):
                    # Inventory truth is authoritative. Refresh it immediately
                    # before selecting work so generic backlog can never outrank
                    # a newly discovered inventory checklist gap.
                    await self.refresh_inventory_targets()
                    await self.trigger("internal-24-hour-scheduler")
            except Exception:
                pass
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self.scheduler_poll_seconds,
                )
            except asyncio.TimeoutError:
                continue

    async def trigger(self, trigger: str = "manual-api", target_keys: list[str] | None = None) -> dict[str, Any]:
        async with self._start_lock:
            if self._run_task and not self._run_task.done():
                latest = self.store.latest_job()
                return {
                    "accepted": False,
                    "reason": "already_running",
                    "job": latest,
                }

            heavy_lease = None
            if self.coordinated_runs:
                heavy_lease = await self._heavy_work.acquire(
                    "checklist-sentinel",
                    priority=60,
                )

            job_id, existing = self.store.acquire_job(trigger, self.stale_seconds)
            if not job_id:
                if heavy_lease is not None:
                    await heavy_lease.release()
                return {
                    "accepted": False,
                    "reason": "already_running",
                    "job": existing,
                }

            async def run_claimed_job() -> None:
                try:
                    await self._run(job_id, target_keys=target_keys)
                finally:
                    if heavy_lease is not None:
                        await heavy_lease.release()

            self._run_task = asyncio.create_task(
                run_claimed_job(),
                name=f"instacomp-ai-checklist-sentinel-{job_id}",
            )
            return {
                "accepted": True,
                "job_id": job_id,
                "trigger": trigger,
            }

    def _load_mac_registry_release_index(self) -> list[tuple[Any, Any]]:
        if not self.registry_database_path.exists():
            return []
        try:
            db = sqlite3.connect(self.registry_database_path, timeout=10)
            try:
                return db.execute(
                    "SELECT year, product FROM checklist_registry_entries WHERE active=1 GROUP BY release_id"
                ).fetchall()
            finally:
                db.close()
        except sqlite3.Error:
            return []

    def _target_already_in_mac_registry(
        self,
        target: dict[str, Any],
        registry_index: list[tuple[Any, Any]] | None = None,
    ) -> bool:
        # A scan-triggered recovery means the current Registry lookup already
        # proved this exact card family is missing/incomplete. Do not skip the
        # fetch merely because some other rows from the same release exist.
        metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
        if target.get("scope") in {"scan-recovery", "inventory-gap"} or metadata.get("force_refresh") is True:
            return False
        year = str(target.get("year") or target.get("season") or "")[:4]
        product = " ".join(str(target.get("product") or "").lower().split())
        if not product:
            return False

        rows = registry_index
        if rows is None:
            rows = self._load_mac_registry_release_index()

        def norm(v: object) -> str:
            return re.sub(r"[^a-z0-9]+", " ", str(v or "").lower()).strip()
        want = norm(product)
        for have_year, have_product in rows:
            if year and str(have_year or "")[:4] != year:
                continue
            have = norm(have_product)
            if have == want or (len(want) >= 12 and (want in have or have in want)):
                return True
        return False

    async def _run(self, job_id: str, target_keys: list[str] | None = None) -> None:
        due = (
            self.store.targets_by_keys(target_keys)
            if target_keys
            else self.store.due_targets(self.max_targets_per_run * 3)
        )
        if not target_keys:
            inventory_due = [
                target for target in due
                if str(target.get("scope") or "") == "inventory-gap"
                or str(target.get("target_key") or "").startswith("inventory-gap-v2|")
            ]
            if inventory_due:
                # Inventory work is the production priority. Never mix it with
                # generic backlog in the same run: that used to force a full
                # Registry release scan and waste crawler capacity before the
                # first inventory checklist search even started.
                due = inventory_due[: self.max_targets_per_run]
        # A targeted live scan already proved the exact card family is absent.
        # Do not scan/group the multi-gigabyte Registry just to rediscover that
        # fact before fetching one release. Bulk scheduled runs still use the
        # release index to avoid redundant public-source work.
        targeted_scan_recovery = bool(due) and all(
            str(target.get("scope") or "") in {"scan-recovery", "inventory-gap"}
            or ((target.get("metadata") or {}) if isinstance(target.get("metadata"), dict) else {}).get("force_refresh") is True
            for target in due
        )
        registry_index = [] if targeted_scan_recovery else await asyncio.to_thread(self._load_mac_registry_release_index)
        targets = []
        already_present = 0
        for target in due:
            if self._target_already_in_mac_registry(target, registry_index):
                self.store.mark_target(target["target_key"], "recovered", retry_after_seconds=self.interval_seconds, metadata={"reason":"already_present_mac_registry","registry_required":False})
                already_present += 1
                continue
            targets.append(target)
            if len(targets) >= self.max_targets_per_run:
                break
        total = len(targets)
        counters = {
            "processed": 0,
            "found": 0,
            "downloaded": 0,
            "imported": 0,
            "duplicates": 0,
            "failed": 0,
            "already_present": 0,
        }
        counters["already_present"] = already_present
        heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(job_id, counters, total),
            name=f"sentinel-heartbeat-{job_id}",
        )
        client = SentinelSourceClient(
            timeout_seconds=self.request_timeout_seconds,
            max_download_bytes=self.max_download_bytes,
        )
        self.store.heartbeat(
            job_id,
            total_targets=total,
            processed_targets=0,
            checkpoint={"phase": "starting", "target_count": total},
        )

        if total == 0:
            self.store.checkpoint(
                job_id,
                "complete",
                100.0,
                {"message": "No targets were due.", **counters},
            )
            self.store.finish_job(job_id, "completed")
            heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat_task
            return

        try:
            sources = self.store.list_sources(enabled_only=True)
            for target_index, target in enumerate(targets):
                self.store.heartbeat(
                    job_id,
                    current_target_key=target["target_key"],
                    processed_targets=counters["processed"],
                    total_targets=total,
                    found_count=counters["found"],
                    downloaded_count=counters["downloaded"],
                    imported_count=counters["imported"],
                    duplicate_count=counters["duplicates"],
                    failed_count=counters["failed"],
                )
                try:
                    target_timeout = self._effective_target_timeout(target)
                    target_started_at = datetime.now(timezone.utc).isoformat()
                    result = await asyncio.wait_for(
                        self._process_target(
                            job_id=job_id,
                            target=target,
                            sources=rotated_sentinel_sources(sources, target_index, target),
                            client=client,
                        ),
                        timeout=target_timeout,
                    )
                    for key in ["found", "downloaded", "imported", "duplicates"]:
                        counters[key] += int(result.get(key, 0))
                except asyncio.CancelledError:
                    raise
                except asyncio.TimeoutError:
                    timeout_import = self._recover_timeout_after_registry_import(
                        target=target,
                        target_started_at=target_started_at,
                        target_timeout=target_timeout,
                    )
                    if timeout_import is not None:
                        counters["downloaded"] += int(timeout_import.get("downloaded", 0))
                        counters["imported"] += int(timeout_import.get("imported", 0))
                    else:
                        counters["failed"] += 1
                        self.store.mark_target(
                            target["target_key"],
                            "failed",
                            retry_after_seconds=6 * 60 * 60,
                            metadata={
                                "last_error": f"Target exceeded {target_timeout:.0f}s without a successful Registry import.",
                                "timeout_seconds": target_timeout,
                            },
                        )
                except Exception as error:
                    counters["failed"] += 1
                    self.store.mark_target(
                        target["target_key"],
                        "failed",
                        retry_after_seconds=6 * 60 * 60,
                        metadata={"last_error": str(error)[:1000] or error.__class__.__name__},
                    )
                counters["processed"] += 1
                progress = counters["processed"] * 100.0 / total
                self.store.checkpoint(
                    job_id,
                    "target-complete",
                    progress,
                    {
                        "current_target_key": target["target_key"],
                        "total_targets": total,
                        **counters,
                    },
                )

            if counters["failed"]:
                final_status = "completed_with_errors"
            elif counters["imported"] or counters["already_present"]:
                final_status = "completed"
            else:
                final_status = "completed_no_registry_progress"
            self.store.heartbeat(
                job_id,
                processed_targets=counters["processed"],
                total_targets=total,
                found_count=counters["found"],
                downloaded_count=counters["downloaded"],
                imported_count=counters["imported"],
                duplicate_count=counters["duplicates"],
                failed_count=counters["failed"],
                checkpoint={"phase": "complete", **counters},
            )
            self.store.finish_job(job_id, final_status)
        except asyncio.CancelledError:
            self.store.checkpoint(
                job_id,
                "interrupted",
                counters["processed"] * 100.0 / max(1, total),
                {
                    "message": "Service stopped; pending targets will resume.",
                    "total_targets": total,
                    **counters,
                },
            )
            self.store.finish_job(
                job_id,
                "interrupted",
                "Service shutdown or cancellation; safe resume is enabled.",
            )
            raise
        except Exception as error:
            self.store.checkpoint(
                job_id,
                "failed",
                counters["processed"] * 100.0 / max(1, total),
                {"error": str(error)[:2000], "total_targets": total, **counters},
            )
            self.store.finish_job(job_id, "failed", str(error)[:2000])
        finally:
            heartbeat_task.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat_task

    async def _heartbeat_loop(
        self,
        job_id: str,
        counters: dict[str, int],
        total: int,
    ) -> None:
        while True:
            await asyncio.sleep(self.checkpoint_seconds)
            try:
                self.store.heartbeat(
                    job_id,
                    processed_targets=counters["processed"],
                    total_targets=total,
                    found_count=counters["found"],
                    downloaded_count=counters["downloaded"],
                    imported_count=counters["imported"],
                    duplicate_count=counters["duplicates"],
                    failed_count=counters["failed"],
                    checkpoint={
                        "phase": "heartbeat",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                        **counters,
                    },
                )
            except Exception:
                # A transient SQLite lock must not permanently kill the heartbeat task.
                continue

    @staticmethod
    def _inventory_import_added_rows(receipt: str | None) -> bool:
        if not receipt:
            return False
        match = re.search(r"(?:^|:)inserted=(\d+)(?:$|:)", str(receipt))
        return bool(match and int(match.group(1)) > 0)

    def _recover_timeout_after_registry_import(
        self,
        *,
        target: dict[str, Any],
        target_started_at: str,
        target_timeout: float,
    ) -> dict[str, int] | None:
        """Convert a watchdog timeout after a committed Registry import into safe retry/recovery."""
        with self.registry_store.connection() as db:
            imports = db.execute(
                """
                SELECT source_sha256, imported_at, registry_receipt
                FROM checklist_registry_imports
                WHERE target_key=? AND import_status='imported' AND imported_at>=?
                ORDER BY imported_at ASC
                """,
                (target["target_key"], target_started_at),
            ).fetchall()
        if not imports:
            return None

        download_rows: dict[str, dict[str, Any]] = {}
        shas = [str(row["source_sha256"] or "") for row in imports if row["source_sha256"]]
        if shas:
            placeholders = ",".join("?" for _ in shas)
            with self.store.connection() as db:
                rows = db.execute(
                    f"""SELECT * FROM checklist_sentinel_downloads
                    WHERE target_key=? AND status='imported_registry'
                      AND sha256 IN ({placeholders})
                    ORDER BY created_at ASC""",
                    [target["target_key"], *shas],
                ).fetchall()
            download_rows = {str(row["sha256"]): dict(row) for row in rows}

        receipts: list[str] = []
        recovered_download_id: str | None = None
        progress_imports = 0
        for row in imports:
            sha = str(row["source_sha256"] or "")
            download = download_rows.get(sha)
            receipt = str((download or {}).get("registry_receipt") or row["registry_receipt"] or "")
            if receipt:
                receipts.append(receipt)
            if download is not None:
                recovered_download_id = str(download["download_id"])
            if self._inventory_import_added_rows(receipt):
                progress_imports += 1

        if progress_imports:
            status = "recovered"
            retry_after = self.interval_seconds
            reason = "target_timeout_after_registry_progress"
        else:
            status = "pending"
            retry_after = 6 * 60 * 60
            reason = "target_timeout_after_registry_import_no_new_rows"
        self.store.mark_target(
            target["target_key"],
            status,
            retry_after_seconds=retry_after,
            recovered_download_id=recovered_download_id,
            metadata={
                "reason": reason,
                "timeout_seconds": target_timeout,
                "successful_registry_imports": len(imports),
                "registry_progress_imports": progress_imports,
                "registry_receipts": receipts[-5:],
                "registry_required": True,
            },
        )
        return {"downloaded": len(imports), "imported": progress_imports}

    @staticmethod
    def _inventory_multi_release_target(target: dict[str, Any]) -> bool:
        norm = lambda value: re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
        return (
            target.get("scope") == "inventory-gap"
            and norm(target.get("manufacturer")) == "upper deck"
            and norm(target.get("product")) == "upper deck"
            and norm(target.get("sport")) == "hockey"
        )

    async def _process_target(
        self,
        *,
        job_id: str,
        target: dict[str, Any],
        sources: list[dict[str, Any]],
        client: SentinelSourceClient,
    ) -> dict[str, int]:
        counts = {"found": 0, "downloaded": 0, "imported": 0, "duplicates": 0}
        recovered_download_id: str | None = None
        multi_release_target = self._inventory_multi_release_target(target)
        lead_count = 0
        candidate_count = 0
        seen_urls: set[str] = set()

        for source in sources:
            try:
                candidates = await client.search(source, target)
                self.store.source_checked(source["source_id"], "ok")
            except (httpx.HTTPError, ValueError, json.JSONDecodeError) as error:
                self.store.source_checked(
                    source["source_id"],
                    "error",
                    str(error)[:1000],
                )
                await asyncio.sleep(self.search_delay_seconds)
                continue

            for candidate in candidates:
                if candidate.url in seen_urls:
                    continue
                seen_urls.add(candidate.url)
                candidate_count += 1
                if candidate_count > self.max_candidates_per_target:
                    break

                if target.get("scope") == "discovery":
                    status = "lead_only"
                    reason = (
                        "Broad vintage discovery result. Exact season, manufacturer "
                        "and product must be confirmed before import."
                    )
                elif not candidate.exact_match:
                    status = "rejected_identity"
                    reason = candidate.reason
                elif candidate.import_policy != "auto_import":
                    status = "lead_only"
                    reason = (
                        "Exact-looking community result retained as a lead. "
                        "Provenance and redistribution permission are required."
                    )
                elif candidate.trust_score < 75:
                    status = "lead_only"
                    reason = "Trust score is below the automatic-download threshold."
                else:
                    status = "validated_candidate"
                    reason = candidate.reason

                finding_id = self.store.record_finding(
                    job_id=job_id,
                    target_key=target["target_key"],
                    source_id=source["source_id"],
                    url=candidate.url,
                    title=candidate.title,
                    domain=candidate.domain,
                    trust_score=candidate.trust_score,
                    exact_match=candidate.exact_match,
                    content_type=None,
                    status=status,
                    reason=reason,
                )
                counts["found"] += 1

                if status == "lead_only":
                    lead_count += 1
                    continue
                if status != "validated_candidate" or (recovered_download_id and not multi_release_target):
                    continue

                ingest_candidate = candidate
                candidate_path = candidate.url.lower().split("?", 1)[0]
                if not candidate_path.endswith((".xlsx", ".xls", ".csv", ".pdf")) and hasattr(client, "resolve_ingest_candidates"):
                    try:
                        attachments = await asyncio.wait_for(
                            client.resolve_ingest_candidates(source, target, candidate),
                            timeout=10.0 if target.get("scope") in {"scan-recovery", "inventory-gap"} else self.request_timeout_seconds,
                        )
                    except (httpx.HTTPError, ValueError, asyncio.TimeoutError):
                        attachments = []
                    if attachments:
                        ingest_candidate = attachments[0]
                    elif target.get("scope") not in {"scan-recovery", "inventory-gap"}:
                        lead_count += 1
                        continue
                    # For a trusted exact scan-recovery page, fall back to the
                    # page itself when its attachment host stalls or exposes no
                    # ingestible file. LocalRegistryStore validates HTML plans.

                try:
                    downloaded = await client.download(ingest_candidate.url)
                except (httpx.HTTPError, ValueError):
                    continue

                # Normal scheduled discovery remains conservative. A scan-time
                # exact-gap recovery may also ingest a trusted exact-match HTML
                # checklist because LocalRegistryStore's planner already validates
                # HTML into the same transactional import plan.
                supported = {".xlsx", ".xls", ".csv", ".pdf"}
                if target.get("scope") in {"scan-recovery", "inventory-gap"}:
                    supported.update({".html", ".htm"})
                if downloaded.extension.lower() not in supported:
                    lead_count += 1
                    self.store.record_finding(
                        job_id=job_id, target_key=target["target_key"],
                        source_id=source["source_id"], url=candidate.url,
                        title=candidate.title, domain=candidate.domain,
                        trust_score=candidate.trust_score, exact_match=True,
                        content_type=downloaded.content_type, status="unsupported_ingest_format",
                        reason="Discovery page retained, but ingestion requires XLSX/CSV or structured PDF.",
                    )
                    continue

                existing = self.store.sha_exists(downloaded.sha256)
                if existing:
                    counts["duplicates"] += 1
                    existing_status = str(existing.get("status") or "")
                    self.store.record_finding(
                        job_id=job_id,
                        target_key=target["target_key"],
                        source_id=source["source_id"],
                        url=candidate.url,
                        title=candidate.title,
                        domain=candidate.domain,
                        trust_score=candidate.trust_score,
                        exact_match=True,
                        content_type=downloaded.content_type,
                        status="duplicate_sha256",
                        reason=(
                            f"Same bytes already stored as {existing['download_id']} "
                            f"with status {existing_status or 'unknown'}."
                        ),
                    )
                    if existing_status == "imported_registry" and target.get("scope") != "inventory-gap":
                        recovered_download_id = str(existing["download_id"])
                        break
                    # A prior download is NOT a successful duplicate unless it was
                    # actually imported. Retry the already-persisted supported file
                    # through the current local Mac SQLite importer.
                    existing_path = Path(str(existing.get("local_path") or ""))
                    if existing_path.exists() and existing_path.suffix.lower() in ({".xlsx", ".xls", ".csv", ".pdf", ".html", ".htm"} if target.get("scope") in {"scan-recovery", "inventory-gap"} else {".xlsx", ".xls", ".csv", ".pdf"}):
                        registry_status, receipt = await self._import_to_registry(
                            target=target, source_url=downloaded.url,
                            local_path=existing_path, content_type=downloaded.content_type,
                            sha256=downloaded.sha256,
                        )
                        self.store.update_download_status(str(existing["download_id"]), registry_status, receipt)
                        counts["downloaded"] += 1
                        made_progress = registry_status == "imported_registry" and (
                            target.get("scope") != "inventory-gap" or self._inventory_import_added_rows(receipt)
                        )
                        if made_progress:
                            counts["imported"] += 1
                            recovered_download_id = str(existing["download_id"])
                            if not multi_release_target:
                                break
                    lead_count += 1
                    continue

                local_path = persist_download(
                    self.download_root,
                    target,
                    downloaded,
                )
                registry_status, receipt = await self._import_to_registry(
                    target=target,
                    source_url=downloaded.url,
                    local_path=local_path,
                    content_type=downloaded.content_type,
                    sha256=downloaded.sha256,
                )
                download_id = self.store.record_download(
                    finding_id=finding_id,
                    target_key=target["target_key"],
                    source_url=downloaded.url,
                    local_path=str(local_path),
                    sha256=downloaded.sha256,
                    content_type=downloaded.content_type,
                    byte_count=len(downloaded.content),
                    status=registry_status,
                    registry_receipt=receipt,
                )
                counts["downloaded"] += 1
                made_progress = registry_status == "imported_registry" and (
                    target.get("scope") != "inventory-gap" or self._inventory_import_added_rows(receipt)
                )
                if made_progress:
                    counts["imported"] += 1
                    recovered_download_id = download_id
                    if not multi_release_target:
                        break
                lead_count += 1

            # A verified Registry import that added identities has completed this
            # target. Do not burn the remaining watchdog budget sleeping before
            # returning the successful receipt to the job runner.
            if recovered_download_id:
                break
            await asyncio.sleep(self.search_delay_seconds)

        if recovered_download_id:
            self.store.mark_target(
                target["target_key"],
                "recovered",
                retry_after_seconds=self.interval_seconds,
                recovered_download_id=recovered_download_id,
                metadata={
                    "candidate_count": candidate_count,
                    "lead_count": lead_count,
                    "registry_required": True,
                },
            )
        elif lead_count:
            self.store.mark_target(
                target["target_key"],
                "lead_only",
                retry_after_seconds=24 * 60 * 60,
                metadata={
                    "candidate_count": candidate_count,
                    "lead_count": lead_count,
                    "registry_required": True,
                },
            )
        else:
            self.store.mark_target(
                target["target_key"],
                "no_result",
                retry_after_seconds=24 * 60 * 60,
                metadata={
                    "candidate_count": candidate_count,
                    "lead_count": 0,
                    "registry_required": True,
                },
            )
        return counts

    def _effective_target_timeout(self, target: dict[str, Any]) -> float:
        metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
        if target.get("scope") in {"scan-recovery", "inventory-gap"} or metadata.get("force_refresh") is True:
            return min(self.target_timeout_seconds, 180.0)
        return self.target_timeout_seconds

    @staticmethod
    def _release_text(value: object) -> str:
        return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()

    @classmethod
    def _release_sport(cls, value: object) -> str:
        text = cls._release_text(value)
        aliases = {
            "nba": "basketball", "wnba": "basketball", "basketball": "basketball",
            "nhl": "hockey", "hockey": "hockey", "mlb": "baseball", "baseball": "baseball",
            "nfl": "football", "football": "football", "soccer": "soccer", "golf": "golf",
            "wwe": "wrestling", "aew": "wrestling", "wrestling": "wrestling",
            "nascar": "racing", "racing": "racing", "ufc": "mma", "mma": "mma",
            "boxing": "boxing", "tennis": "tennis",
        }
        return aliases.get(text, text)

    @classmethod
    def _inventory_plan_identity_matches(cls, target: dict[str, Any], plan: dict[str, Any]) -> tuple[bool, str]:
        release = plan.get("release") if isinstance(plan, dict) else None
        if not isinstance(release, dict):
            return False, "Parsed checklist has no release identity."
        target_year = re.search(r"(?:19|20)\d{2}", str(target.get("season") or target.get("year") or ""))
        release_year = re.search(r"(?:19|20)\d{2}", str(release.get("releaseYear") or release.get("season") or ""))
        if not target_year or not release_year or target_year.group(0) != release_year.group(0):
            return False, "Parsed checklist year does not match the inventory release."
        target_sport = cls._release_sport(target.get("sport"))
        release_sport = cls._release_sport(release.get("sport"))
        if not target_sport or not release_sport or target_sport != release_sport:
            return False, f"Parsed checklist sport {release_sport or 'unknown'} does not match inventory sport {target_sport or 'unknown'}."
        aliases = {"bowman": "topps", "upperdeck": "upper deck"}
        target_mfr = aliases.get(cls._release_text(target.get("manufacturer")).replace(" ", ""), cls._release_text(target.get("manufacturer")))
        release_mfr_raw = cls._release_text(release.get("manufacturer"))
        release_mfr = aliases.get(release_mfr_raw.replace(" ", ""), release_mfr_raw)
        if target_mfr and release_mfr and target_mfr != release_mfr:
            return False, f"Parsed checklist manufacturer {release_mfr} does not match inventory manufacturer {target_mfr}."
        ignored = {"panini","topps","upper","deck","leaf","bowman","cards","card","trading","baseball","basketball","football","hockey","soccer","golf","wrestling","wwe","aew","nba","wnba","nfl","nhl","mlb","set","collection"}
        target_product_text = cls._release_text(target.get("product"))
        release_product_text = cls._release_text(release.get("product"))
        release_brand_text = cls._release_text(release.get("brand"))
        flagship = {"panini", "topps", "upper deck", "leaf", "bowman"}
        if target_product_text in flagship:
            if target_product_text not in {release_product_text, release_brand_text}:
                return False, "Parsed checklist does not match the inventory flagship product."
            return True, "Parsed checklist release identity matches inventory flagship target."
        want = {x for x in target_product_text.split() if x not in ignored}
        have_text = " ".join(str(release.get(k) or "") for k in ("product", "brand"))
        have = {x for x in cls._release_text(have_text).split() if x not in ignored}
        if not want or not have:
            return False, "Parsed checklist product identity is too weak for inventory auto-import."
        overlap = len(want & have) / max(1, len(want))
        if not (want.issubset(have) or have.issubset(want) or overlap >= 0.75):
            return False, f"Parsed checklist product family overlap {overlap:.2f} is below the inventory safety threshold."
        return True, "Parsed checklist release identity matches inventory target."

    async def _import_to_registry(
        self,
        *, target: dict[str, Any], source_url: str, local_path: Path,
        content_type: str, sha256: str,
    ) -> tuple[str, str | None]:
        # Parsing and especially the multi-thousand-row SQLite transaction are
        # blocking work. Keep the complete import lifecycle off Uvicorn's event
        # loop so /health, scans, and Cloudflare tunnel requests remain serviceable.
        return await asyncio.to_thread(
            self._import_to_registry_sync,
            target=target,
            source_url=source_url,
            local_path=local_path,
            content_type=content_type,
            sha256=sha256,
        )

    def _import_to_registry_sync(
        self,
        *, target: dict[str, Any], source_url: str, local_path: Path,
        content_type: str, sha256: str,
    ) -> tuple[str, str | None]:
        supported = {".xlsx", ".xls", ".csv", ".pdf"}
        if target.get("scope") in {"scan-recovery", "inventory-gap"}:
            supported.update({".html", ".htm"})
        if local_path.suffix.lower() not in supported:
            return "downloaded_local_unsupported_format", "Only validated checklist source formats are accepted."
        inventory_gap = target.get("scope") == "inventory-gap"
        try:
            plan = self.registry_store._parse_plan(local_path, source_url, target)
            if inventory_gap:
                safe, reason = self._inventory_plan_identity_matches(target, plan)
                if not safe:
                    return "downloaded_local_registry_rejected", reason
            # Scan-time targets may fill missing parser metadata from physical-card
            # evidence. Inventory-gap imports preserve the parser's verified release
            # identity and use target fields only as missing-value fallbacks.
            if isinstance(plan, dict):
                release = plan.get("release")
                if isinstance(release, dict):
                    pick = (lambda parsed, queued: str(parsed or queued or "").strip()) if inventory_gap else (lambda parsed, queued: str(queued or parsed or "").strip())
                    manufacturer = pick(release.get("manufacturer"), target.get("manufacturer"))
                    sport = pick(release.get("sport"), target.get("sport"))
                    product = pick(release.get("product"), target.get("product"))
                    target_metadata = target.get("metadata") if isinstance(target.get("metadata"), dict) else {}
                    brand = pick(release.get("brand"), target.get("brand") or target_metadata.get("brand"))
                    season = pick(release.get("season"), target.get("season") or target.get("year"))
                    year = pick(release.get("releaseYear"), target.get("year"))
                    manufacturer_display = {"upper-deck":"Upper Deck", "panini":"Panini", "topps":"Topps", "press-pass":"Press Pass"}.get(manufacturer.lower(), manufacturer)
                    sport_display = {"basketball":"Basketball", "baseball":"Baseball", "football":"Football", "hockey":"Hockey", "golf":"Golf", "wrestling":"Wrestling", "soccer":"Soccer", "racing":"Racing"}.get(sport.lower(), sport.title())
                    updates = {"manufacturer": manufacturer_display, "brand": brand or release.get("brand"), "product": product, "releaseYear": year, "season": season, "sport": sport_display}
                    if not inventory_gap or not release.get("releaseSlug"):
                        slug_bits = [year, manufacturer, product, sport]
                        updates["releaseSlug"] = "-".join(re.sub(r"[^a-z0-9]+", "-", x.lower()).strip("-") for x in slug_bits if x)
                    release.update(updates)
            validation = plan.get("validation") if isinstance(plan, dict) else {}
            if not isinstance(validation, dict) or validation.get("status") != "passed":
                return "downloaded_local_registry_rejected", "Checklist plan validation did not pass."
            entries = self.registry_store._flatten_plan(sha256, source_url, local_path.stem[:120], target["target_key"], plan)
            if not entries:
                return "downloaded_local_registry_rejected", "Validated plan produced zero identities."
            release_id = self.registry_store._release_id(plan)
            inserted_entries = 0
            with self.registry_store.connection() as db:
                # Inventory-gap recovery is additive and idempotent. It exists to
                # fill missing truth, not replace already-valid Registry releases.
                # Exact fingerprints may already live under an older canonical
                # release slug; keep that truth and insert only genuinely new rows.
                if inventory_gap:
                    # Parser upgrades must be able to correct rows produced from
                    # this exact artifact without deleting truth from other sources.
                    db.execute("DELETE FROM checklist_registry_entries WHERE source_sha256=?", (sha256,))
                else:
                    db.execute("DELETE FROM checklist_registry_entries WHERE release_id=?", (release_id,))
                db.execute("DELETE FROM checklist_registry_imports WHERE source_sha256=?", (sha256,))
                db.execute("""INSERT INTO checklist_registry_imports (source_sha256,source_url,source_name,target_key,source_path,authority,content_type,byte_count,registry_receipt,imported_at,plan_json,import_status,import_error) VALUES (?,?,?,?,?,?,?,?,?,?,?,'imported',NULL)""", (sha256,source_url,local_path.stem[:120],target["target_key"],str(local_path),"official_manufacturer_or_approved_checklist_source",content_type,local_path.stat().st_size,release_id,datetime.now(timezone.utc).isoformat(),json.dumps(plan,sort_keys=True)))
                columns = list(entries[0].keys())
                if inventory_gap:
                    for entry in entries:
                        if self.registry_store.upsert_semantic_entry(db, entry) == "inserted":
                            inserted_entries += 1
                else:
                    db.executemany(
                        f"INSERT INTO checklist_registry_entries ({','.join(columns)}) VALUES ({','.join(':'+c for c in columns)})",
                        entries,
                    )
                    inserted_entries = len(entries)
                # Gap supplements survive ordinary release refreshes, but once an
                # approved checklist source contains the same exact identity the
                # temporary supplement must yield to that stronger provenance.
                db.execute("""
                    UPDATE checklist_registry_entries AS s SET active=0
                    WHERE s.active=1 AND s.source_label='InstaComp Registry Gap Supplement'
                    AND EXISTS (
                        SELECT 1 FROM checklist_registry_entries AS o
                        WHERE o.active=1
                          AND o.source_sha256=?
                          AND o.source_label!='InstaComp Registry Gap Supplement'
                          AND o.year=s.year
                          AND o.normalized_card_number=s.normalized_card_number
                          AND lower(coalesce(o.player,''))=lower(coalesce(s.player,''))
                          AND lower(coalesce(o.product,''))=lower(coalesce(s.product,''))
                          AND lower(coalesce(o.set_name,''))=lower(coalesce(s.set_name,''))
                          AND lower(coalesce(o.parallel,'Base'))=lower(coalesce(s.parallel,'Base'))
                          AND lower(coalesce(o.variation,''))=lower(coalesce(s.variation,''))
                          AND coalesce(o.serial_run,-1)=coalesce(s.serial_run,-1)
                          AND coalesce(o.is_auto,0)=coalesce(s.is_auto,0)
                          AND coalesce(o.is_relic,0)=coalesce(s.is_relic,0)
                    )
                """, (sha256,))
                db.execute("""
                    UPDATE checklist_registry_supplements SET active=0
                    WHERE identity_id IN (
                        SELECT identity_id FROM checklist_registry_entries
                        WHERE source_label='InstaComp Registry Gap Supplement' AND active=0
                    )
                """)
            with self.registry_store.connection() as db:
                if inventory_gap:
                    expected_keys = {registry_semantic_key(entry) for entry in entries}
                    active_rows = db.execute(
                        """SELECT * FROM checklist_registry_entries
                        WHERE release_id=? AND active=1
                          AND source_label != 'InstaComp Registry Gap Supplement'""",
                        (release_id,),
                    ).fetchall()
                    active_keys = {registry_semantic_key(row) for row in active_rows}
                    actual = len(expected_keys & active_keys)
                    expected = len(expected_keys)
                else:
                    actual = int(db.execute("SELECT COUNT(*) FROM checklist_registry_entries WHERE release_id=? AND active=1", (release_id,)).fetchone()[0])
                    expected = len(entries)
            if actual != expected:
                return "downloaded_local_registry_error", f"post-write verification expected={expected} actual={actual}"
            if inventory_gap:
                return "imported_registry", f"{release_id}:covered={actual}:inserted={inserted_entries}"
            return "imported_registry", f"{release_id}:{actual}"
        except Exception as error:
            return "downloaded_local_registry_error", str(error)[:1000]

    def status(self) -> dict[str, Any]:
        latest = self.store.latest_job()
        counts = self.store.target_counts()
        training = self._training_status()
        running = bool(latest and latest.get("status") == "running")
        heartbeat = latest.get("heartbeat_at") if latest else None
        stale = False
        if running and heartbeat:
            try:
                age = (
                    datetime.now(timezone.utc)
                    - datetime.fromisoformat(heartbeat)
                ).total_seconds()
                stale = age > self.stale_seconds
            except ValueError:
                stale = True
        return {
            "name": "InstaComp AI Checklist Sentinel™",
            "enabled": self.auto_start,
            "schedule_seconds": self.interval_seconds,
            "schedule_hours": round(self.interval_seconds / 3600, 2),
            "checkpoint_seconds": self.checkpoint_seconds,
            "freeze_protection": {
                "sqlite_wal": True,
                "atomic_downloads": True,
                "heartbeat": True,
                "checkpoint_interval_seconds": self.checkpoint_seconds,
                "stale_after_seconds": self.stale_seconds,
                "resume_pending_targets": True,
                "stale": stale,
            },
            "targets": counts,
            "latest_job": latest,
            "training": training,
            "download_root": str(self.download_root),
            "registry_import_configured": bool(self.registry_import_url),
            "target_feed_configured": bool(self.target_url),
        }

    def _training_status(self) -> dict[str, Any]:
        status_path = self.service_root / "data" / "training" / "lora-training-status.json"
        progress_path = self.service_root / "data" / "logs" / "lora-safe2048-supervised-progress.txt"
        payload: dict[str, Any] = {
            "state": "unknown",
            "requested_iters": None,
            "completed_iters": None,
            "remaining_iters": None,
            "progress_percent": 0.0,
            "learning_percent": None,
            "cpu_percent": None,
            "output_bundle": None,
            "updated_at_epoch": None,
        }

        if status_path.is_file():
            try:
                raw = json.loads(status_path.read_text("utf-8"))
                if isinstance(raw, dict):
                    payload["state"] = str(raw.get("state") or payload["state"])
                    payload["requested_iters"] = raw.get("requested_iters")
                    payload["completed_iters"] = raw.get("completed_iters")
                    payload["remaining_iters"] = raw.get("remaining_iters")
                    payload["output_bundle"] = raw.get("output_bundle")
                    payload["updated_at_epoch"] = raw.get("updated_at_epoch")
                    requested = int(raw.get("requested_iters") or 0)
                    completed = int(raw.get("completed_iters") or 0)
                    if requested > 0:
                        payload["progress_percent"] = round(
                            max(0.0, min(100.0, completed * 100.0 / requested)),
                            1,
                        )
            except Exception:
                pass

        if progress_path.is_file():
            try:
                progress_value = int(progress_path.read_text("utf-8").strip().splitlines()[-1])
                payload["learning_percent"] = max(0, min(100, progress_value))
                if payload["progress_percent"] == 0.0 and progress_value > 0:
                    payload["progress_percent"] = float(min(100, progress_value))
            except Exception:
                pass

        cpu_percent: float | None = None
        try:
            result = subprocess.run(
                [
                    "/bin/ps",
                    "-axo",
                    "pcpu=,command=",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode == 0 and result.stdout:
                best = 0.0
                for line in result.stdout.splitlines():
                    if "mlx_vlm.lora" not in line and "run_safe2048_supervised_runner.sh" not in line:
                        continue
                    head, _, _cmd = line.strip().partition(" ")
                    try:
                        best = max(best, float(head))
                    except ValueError:
                        continue
                if best > 0:
                    cpu_percent = round(best, 1)
        except Exception:
            pass

        payload["cpu_percent"] = cpu_percent
        return payload
