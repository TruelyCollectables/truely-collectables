from __future__ import annotations

import asyncio
import json
import os
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


class ChecklistSentinel:
    """InstaComp AI Checklist Sentinel™.

    The service owns scheduling, state, checkpoints and source policy. It does
    not depend on ChatGPT tasks. It searches public sources, preserves exact
    provenance, downloads only trusted/public evidence, and leaves community
    material in a review queue unless provenance and redistribution permission
    are confirmed.
    """

    def __init__(self, *, database_path: Path, service_root: Path) -> None:
        self.database_path = database_path
        self.service_root = service_root
        self.repo_root = service_root.parents[1]
        self.store = SentinelStore(database_path)
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

    def _resolve_path(self, value: str | Path) -> Path:
        path = Path(value).expanduser()
        if path.is_absolute():
            return path.resolve()
        return (self.service_root / path).resolve()

    async def start(self) -> None:
        self.store.initialize()
        self.store.seed_sources(DEFAULT_SOURCES)
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
                if self.store.due_for_run(self.interval_seconds):
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

    async def trigger(self, trigger: str = "manual-api") -> dict[str, Any]:
        async with self._start_lock:
            if self._run_task and not self._run_task.done():
                latest = self.store.latest_job()
                return {
                    "accepted": False,
                    "reason": "already_running",
                    "job": latest,
                }

            job_id, existing = self.store.acquire_job(trigger, self.stale_seconds)
            if not job_id:
                return {
                    "accepted": False,
                    "reason": "already_running",
                    "job": existing,
                }

            self._run_task = asyncio.create_task(
                self._run(job_id),
                name=f"instacomp-ai-checklist-sentinel-{job_id}",
            )
            return {
                "accepted": True,
                "job_id": job_id,
                "trigger": trigger,
            }

    async def _run(self, job_id: str) -> None:
        targets = self.store.due_targets(self.max_targets_per_run)
        total = len(targets)
        counters = {
            "processed": 0,
            "found": 0,
            "downloaded": 0,
            "imported": 0,
            "duplicates": 0,
            "failed": 0,
        }
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
            # PSA APR is a first-party checklist source and must run before any
            # SERP-backed manufacturer/community discovery. Trust still orders
            # the remaining sources after the PSA-first lane.
            sources.sort(
                key=lambda source: (
                    0 if source.get("source_id") == "psa" else 1,
                    -int(source.get("trust_score") or 0),
                    str(source.get("source_id") or ""),
                )
            )
            for target in targets:
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
                    result = await self._process_target(
                        job_id=job_id,
                        target=target,
                        sources=sources,
                        client=client,
                    )
                    for key in ["found", "downloaded", "imported", "duplicates"]:
                        counters[key] += int(result.get(key, 0))
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    counters["failed"] += 1
                    self.store.mark_target(
                        target["target_key"],
                        "failed",
                        retry_after_seconds=6 * 60 * 60,
                        metadata={"last_error": str(error)[:1000]},
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

            final_status = (
                "completed_with_errors" if counters["failed"] else "completed"
            )
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
                if status != "validated_candidate" or recovered_download_id:
                    continue

                try:
                    downloaded = await client.download(candidate.url)
                except (httpx.HTTPError, ValueError):
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
                    if existing_status == "imported_registry":
                        recovered_download_id = str(existing["download_id"])
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
                if registry_status == "imported_registry":
                    counts["imported"] += 1
                    recovered_download_id = download_id
                    break
                lead_count += 1

            await asyncio.sleep(self.search_delay_seconds)
            if recovered_download_id:
                break

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

    async def _import_to_registry(
        self,
        *,
        target: dict[str, Any],
        source_url: str,
        local_path: Path,
        content_type: str,
        sha256: str,
    ) -> tuple[str, str | None]:
        if not self.registry_import_url:
            return "downloaded_local_pending_registry_import", None

        headers = {}
        if self.registry_token:
            headers["authorization"] = f"Bearer {self.registry_token}"
            headers["x-tcos-instacomp-service-token"] = self.registry_token
        data = {
            "targetKey": target["target_key"],
            "sport": target.get("sport") or "",
            "year": str(target.get("year") or ""),
            "season": str(target.get("season") or ""),
            "manufacturer": str(target.get("manufacturer") or ""),
            "product": str(target.get("product") or ""),
            "sourceUrl": source_url,
            "sha256": sha256,
            "source": "instacomp-ai-checklist-sentinel",
        }
        try:
            async with httpx.AsyncClient(
                timeout=max(60.0, self.request_timeout_seconds),
                follow_redirects=True,
                headers=headers,
            ) as client:
                with local_path.open("rb") as handle:
                    response = await client.post(
                        self.registry_import_url,
                        data=data,
                        files={
                            "file": (
                                local_path.name,
                                handle,
                                content_type or "application/octet-stream",
                            )
                        },
                    )
            payload = response.json() if response.content else {}
            receipt = str(
                payload.get("receipt")
                or payload.get("importId")
                or payload.get("id")
                or ""
            ).strip()
            if (
                response.is_success
                and payload.get("ok") is True
                and payload.get("registryImported") is True
            ):
                return "imported_registry", receipt or None
            if response.is_success and payload.get("ok") is True:
                return "downloaded_local_pending_registry_validation", receipt or None
            return (
                "downloaded_local_registry_rejected",
                receipt
                or str(
                    payload.get("registryError")
                    or payload.get("error")
                    or response.status_code
                )[:1000],
            )
        except (httpx.HTTPError, OSError, ValueError, json.JSONDecodeError) as error:
            return "downloaded_local_registry_error", str(error)[:1000]

    def status(self) -> dict[str, Any]:
        latest = self.store.latest_job()
        counts = self.store.target_counts()
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
            "download_root": str(self.download_root),
            "registry_import_configured": bool(self.registry_import_url),
            "target_feed_configured": bool(self.target_url),
        }
