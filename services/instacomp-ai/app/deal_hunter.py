from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx

from .deal_hunter_store import DealHunterStore, utc_now


FEEDS = (
    ("wnba", "/api/tcos/deal-hunter-native-ebay?perQuery={per_query}&scope=wnba", 15),
    ("ivan_demidov", "/api/tcos/deal-hunter-native-ebay?perQuery={per_query}&scope=ivan_demidov", 3),
    (
        "matvei_michkov_young_guns",
        "/api/tcos/deal-hunter-native-ebay?perQuery={per_query}&scope=matvei_michkov_young_guns",
        8,
    ),
    (
        "matvei_michkov_opc_platinum",
        "/api/tcos/deal-hunter-michkov-opc-platinum?perQuery={per_query}",
        10,
    ),
    (
        "baseball_prospects",
        "/api/tcos/deal-hunter-native-ebay?perQuery={per_query}&scope=baseball_prospects",
        10,
    ),
    (
        "signed_baseballs",
        "/api/tcos/deal-hunter-native-ebay?perQuery={per_query}&scope=signed_baseballs",
        5,
    ),
)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def candidate_key(candidate: dict[str, Any]) -> str:
    direct = str(candidate.get("listingItemId") or "").strip()
    if direct:
        return f"ebay:{direct}"
    url = str(candidate.get("listingUrl") or "").strip()
    return "url:" + hashlib.sha256(url.encode("utf-8")).hexdigest()


def normalize_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    images = []
    for value in candidate.get("imageUrls") or []:
        text = str(value or "").strip()
        if text and text not in images:
            images.append(text)
    return {
        "candidate_key": candidate_key(candidate),
        "lane": candidate.get("lane"),
        "watched_person": candidate.get("watchedPerson"),
        "marketplace": candidate.get("marketplace") or "eBay",
        "listing_item_id": candidate.get("listingItemId"),
        "listing_url": str(candidate.get("listingUrl") or "").strip(),
        "title": str(candidate.get("title") or "Untitled listing").strip(),
        "seller_name": candidate.get("sellerName"),
        "item_price": _number(candidate.get("itemPrice")),
        "inbound_shipping": _number(candidate.get("inboundShipping")),
        "buyer_fees": _number(candidate.get("buyerFees")),
        "tax": _number(candidate.get("tax")),
        "image_urls": images,
        "manual_review_required": bool(candidate.get("manualReviewRequired")),
        "preliminary_risks": candidate.get("preliminaryRisks") or [],
        "query_family_ids": candidate.get("queryFamilyIds") or [],
    }


def validate_feed(payload: dict[str, Any], key: str, expected_families: int) -> None:
    errors = []
    if payload.get("schema") != "TCOS_NATIVE_EBAY_FEED_V1":
        errors.append(f"schema={payload.get('schema')}")
    if payload.get("ok") is not True:
        errors.append(f"ok={payload.get('ok')}")
    if payload.get("nativeEbayUsed") is not True:
        errors.append("nativeEbayUsed=false")
    if payload.get("tokenMode") != "client_credentials":
        errors.append(f"tokenMode={payload.get('tokenMode')}")
    family_count = int(payload.get("queryFamilyCount", -1))
    success_count = int(payload.get("successfulQueryCount", -1))
    failed_count = int(payload.get("failedQueryCount", -1))
    if family_count != expected_families:
        errors.append(f"queryFamilyCount={family_count}; expected={expected_families}")
    if success_count != expected_families:
        errors.append(f"successfulQueryCount={success_count}; expected={expected_families}")
    if failed_count != 0:
        errors.append(f"failedQueryCount={failed_count}")
    coverage = payload.get("sourceCoverage") or []
    if len(coverage) != expected_families:
        errors.append(f"sourceCoverage={len(coverage)}; expected={expected_families}")
    incomplete = [row.get("familyId") for row in coverage if row.get("status") != "COMPLETE"]
    if incomplete:
        errors.append(f"incomplete={incomplete}")
    if errors:
        raise ValueError(f"{key} feed contract failed: {'; '.join(errors)}")


class DealHunterScheduler:
    def __init__(self, settings, store: DealHunterStore):
        self.settings = settings
        self.store = store
        self._task: asyncio.Task | None = None
        self._run_lock = asyncio.Lock()
        self._stopping = asyncio.Event()

    @property
    def enabled(self) -> bool:
        return bool(self.settings.deal_hunter_enabled)

    @property
    def interval(self) -> timedelta:
        return timedelta(minutes=max(15, int(self.settings.deal_hunter_interval_minutes)))

    def next_run(self, from_time: datetime | None = None) -> datetime:
        return (from_time or utc_now()) + self.interval

    async def start(self) -> None:
        self.store.initialize()
        self.store.configure(
            enabled=self.enabled,
            interval_minutes=max(15, int(self.settings.deal_hunter_interval_minutes)),
        )
        if not self.enabled or self._task:
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._loop(), name="instacomp-deal-hunter")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        delay = max(1, int(self.settings.deal_hunter_startup_delay_seconds))
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=delay)
            return
        except asyncio.TimeoutError:
            pass

        if bool(self.settings.deal_hunter_run_on_startup):
            await self.run_now(trigger="startup")

        while not self._stopping.is_set():
            state = self.store.scheduler_state()
            next_run_at = state.get("next_run_at")
            due = True
            if next_run_at:
                try:
                    due = datetime.fromisoformat(str(next_run_at)) <= utc_now()
                except ValueError:
                    due = True
            if due:
                await self.run_now(trigger="scheduled")
            try:
                await asyncio.wait_for(self._stopping.wait(), timeout=15)
            except asyncio.TimeoutError:
                continue

    async def run_now(self, trigger: str = "manual") -> dict[str, Any]:
        if self._run_lock.locked():
            return {"accepted": False, "reason": "A Deal Hunter run is already active."}

        async with self._run_lock:
            run_id = str(uuid4())
            next_run_at = self.next_run()
            self.store.create_run(run_id, trigger)
            self.store.mark_scheduler_started(run_id, next_run_at)
            summary: dict[str, Any] = {
                "run_id": run_id,
                "trigger": trigger,
                "started_at": utc_now().isoformat(),
                "feed_coverage": [],
            }
            counts = {
                "discovery": 0,
                "evaluated": 0,
                "actionable": 0,
                "manual_review": 0,
                "failure": 0,
            }
            error_message = None
            status = "completed"

            try:
                candidates, coverage = await self._discover()
                counts["discovery"] = len(candidates)
                summary["feed_coverage"] = coverage
                selected, deferred = self._select_for_evaluation(candidates)
                summary["selected_for_evaluation"] = len(selected)
                summary["deferred_by_cooldown_or_capacity"] = deferred

                for candidate in selected:
                    result = await self._evaluate(candidate, run_id)
                    self.store.save_candidate(run_id, result)
                    counts["evaluated"] += 1
                    counts["actionable"] += int(bool(result.get("actionable")))
                    counts["manual_review"] += int(
                        result.get("status") in {"manual_review", "identity_review"}
                    )
                    counts["failure"] += int(result.get("status") == "failed")

                summary.update(counts)
                summary["completed_at"] = utc_now().isoformat()
                await self._publish_run_summary(run_id, status, counts, summary)
            except Exception as exc:
                status = "failed"
                error_message = str(exc)[:4000]
                counts["failure"] += 1
                summary["error"] = error_message
                summary["completed_at"] = utc_now().isoformat()
                try:
                    await self._publish_run_summary(run_id, status, counts, summary)
                except Exception as publish_error:
                    summary["publish_error"] = str(publish_error)[:1000]
            finally:
                self.store.finish_run(
                    run_id=run_id,
                    status=status,
                    discovery_count=counts["discovery"],
                    evaluated_count=counts["evaluated"],
                    actionable_count=counts["actionable"],
                    manual_review_count=counts["manual_review"],
                    failure_count=counts["failure"],
                    summary=summary,
                    error_message=error_message,
                )
                self.store.mark_scheduler_finished(
                    status=status,
                    next_run_at=self.next_run(),
                    error_message=error_message,
                )

            return {"accepted": True, "status": status, **summary}

    async def _discover(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        site = str(self.settings.deal_hunter_site_url).rstrip("/")
        timeout = httpx.Timeout(float(self.settings.deal_hunter_request_timeout_seconds))
        aggregate: dict[str, dict[str, Any]] = {}
        coverage = []

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            tasks = []
            for key, path, expected in FEEDS:
                url = site + path.format(per_query=int(self.settings.deal_hunter_per_query))
                tasks.append(self._fetch_feed(client, key, url, expected))
            outcomes = await asyncio.gather(*tasks, return_exceptions=True)

        failures = []
        for outcome in outcomes:
            if isinstance(outcome, Exception):
                failures.append(str(outcome))
                continue
            coverage.append(outcome["coverage"])
            for raw in outcome["results"]:
                normalized = normalize_candidate(raw)
                if not normalized["listing_url"]:
                    continue
                key = normalized["candidate_key"]
                existing = aggregate.get(key)
                if existing:
                    existing["image_urls"] = list(
                        dict.fromkeys(existing["image_urls"] + normalized["image_urls"])
                    )[:12]
                    existing["query_family_ids"] = list(
                        dict.fromkeys(
                            existing["query_family_ids"] + normalized["query_family_ids"]
                        )
                    )
                    existing["manual_review_required"] = bool(
                        existing["manual_review_required"]
                        or normalized["manual_review_required"]
                    )
                    existing["preliminary_risks"] = list(
                        dict.fromkeys(
                            existing["preliminary_risks"]
                            + normalized["preliminary_risks"]
                        )
                    )
                else:
                    aggregate[key] = normalized

        if failures:
            raise RuntimeError("Deal Hunter discovery failed closed: " + " | ".join(failures))
        return list(aggregate.values()), coverage

    async def _fetch_feed(
        self,
        client: httpx.AsyncClient,
        key: str,
        url: str,
        expected: int,
    ) -> dict[str, Any]:
        started = utc_now()
        response = await client.get(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "InstaComp-AI-Mac-Deal-Hunter/1.0",
            },
        )
        response.raise_for_status()
        payload = response.json()
        validate_feed(payload, key, expected)
        return {
            "coverage": {
                "key": key,
                "status": "COMPLETE",
                "query_family_count": expected,
                "result_count": len(payload.get("results") or []),
                "duration_ms": int((utc_now() - started).total_seconds() * 1000),
            },
            "results": payload.get("results") or [],
        }

    def _select_for_evaluation(
        self, candidates: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], int]:
        history = self.store.candidate_history(
            candidate["candidate_key"] for candidate in candidates
        )
        cooldown = max(1, int(self.settings.deal_hunter_candidate_cooldown_hours))

        def priority(candidate: dict[str, Any]):
            prior = history.get(candidate["candidate_key"])
            never = 0 if not prior or not prior.get("last_evaluated_at") else 1
            price_changed = 0
            if prior and candidate.get("item_price") is not None and prior.get("last_price") is not None:
                price_changed = 0 if abs(float(candidate["item_price"]) - float(prior["last_price"])) >= 0.01 else 1
            image_penalty = 0 if len(candidate.get("image_urls") or []) >= 2 else 1
            return (
                never,
                price_changed,
                image_penalty,
                float(candidate.get("item_price") or 10**9),
                candidate["candidate_key"],
            )

        due = [
            candidate
            for candidate in candidates
            if not DealHunterStore.is_cooling_down(
                history.get(candidate["candidate_key"]),
                current_price=candidate.get("item_price"),
                cooldown_hours=cooldown,
            )
        ]
        due.sort(key=priority)
        maximum = max(1, int(self.settings.deal_hunter_max_candidates_per_run))
        return due[:maximum], max(0, len(candidates) - min(len(due), maximum))

    async def _download_image(
        self, client: httpx.AsyncClient, url: str, label: str
    ) -> tuple[bytes, str, str]:
        response = await client.get(
            url,
            headers={
                "Accept": "image/jpeg,image/png,image/webp",
                "User-Agent": "InstaComp-AI-Mac-Deal-Hunter/1.0",
            },
        )
        response.raise_for_status()
        content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
        if content_type not in ALLOWED_IMAGE_TYPES:
            raise ValueError(f"{label} image type is not supported: {content_type or 'unknown'}")
        content = response.content
        if not content or len(content) > MAX_IMAGE_BYTES:
            raise ValueError(f"{label} image is empty or larger than 12MB")
        extension = "png" if content_type == "image/png" else "webp" if content_type == "image/webp" else "jpg"
        return content, content_type, f"{label.lower()}.{extension}"

    async def _evaluate(self, candidate: dict[str, Any], run_id: str) -> dict[str, Any]:
        base = {**candidate, "status": "failed", "actionable": False, "alertworthy": False}
        images = list(dict.fromkeys(candidate.get("image_urls") or []))
        if len(images) < 2:
            return {
                **base,
                "status": "manual_review",
                "deal_label": "MANUAL REVIEW REQUIRED — BACK IMAGE MISSING",
                "alertworthy": bool(candidate.get("manual_review_required")),
                "error_code": "DEAL_HUNTER_BACK_IMAGE_MISSING",
                "error_message": "The marketplace feed did not expose two distinct listing images.",
            }
        if not self.settings.api_key:
            return {
                **base,
                "error_code": "DEAL_HUNTER_LOCAL_KEY_MISSING",
                "error_message": "INSTACOMP_AI_API_KEY is required for the Mac-to-website evaluation channel.",
            }

        timeout = httpx.Timeout(float(self.settings.deal_hunter_request_timeout_seconds))
        try:
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                front, back = await asyncio.gather(
                    self._download_image(client, images[0], "Front"),
                    self._download_image(client, images[1], "Back"),
                )
                listing_payload = {
                    "runId": run_id,
                    "candidateKey": candidate["candidate_key"],
                    "lane": candidate.get("lane"),
                    "watchedPerson": candidate.get("watched_person"),
                    "marketplace": candidate.get("marketplace"),
                    "listingItemId": candidate.get("listing_item_id"),
                    "listingUrl": candidate["listing_url"],
                    "title": candidate["title"],
                    "sellerName": candidate.get("seller_name"),
                    "itemPrice": candidate.get("item_price"),
                    "inboundShipping": candidate.get("inbound_shipping"),
                    "buyerFees": candidate.get("buyer_fees"),
                    "tax": candidate.get("tax"),
                    "imageUrls": images,
                    "manualReviewRequired": candidate.get("manual_review_required"),
                    "preliminaryRisks": candidate.get("preliminary_risks"),
                    "queryFamilyIds": candidate.get("query_family_ids"),
                }
                response = await client.post(
                    str(self.settings.deal_hunter_site_url).rstrip("/")
                    + "/api/instacomp/deal-hunter/evaluate",
                    headers={
                        "X-InstaComp-AI-Key": str(self.settings.api_key),
                        "Accept": "application/json",
                    },
                    data={"listingJson": json.dumps(listing_payload)},
                    files={
                        "frontImage": (front[2], front[0], front[1]),
                        "backImage": (back[2], back[0], back[1]),
                    },
                )
                payload = response.json()
                if not response.is_success or payload.get("ok") is not True:
                    raise RuntimeError(
                        str(payload.get("error") or payload.get("note") or f"HTTP {response.status_code}")
                    )
                evaluation = payload.get("evaluation") or {}
                return {
                    **base,
                    "status": str(evaluation.get("status") or "completed"),
                    "identity": payload.get("scan", {}).get("ai"),
                    "exact_market": payload.get("scan", {}).get("exactMarket"),
                    "delivered_cost": _number(evaluation.get("deliveredCost")),
                    "conservative_resale": _number(evaluation.get("conservativeResale")),
                    "expected_net_profit": _number(evaluation.get("expectedNetProfit")),
                    "roi_percent": _number(evaluation.get("roiPercent")),
                    "deal_label": evaluation.get("dealLabel"),
                    "actionable": bool(evaluation.get("actionable")),
                    "alertworthy": bool(evaluation.get("alertworthy")),
                    "error_code": evaluation.get("errorCode"),
                    "error_message": evaluation.get("reason"),
                }
        except Exception as exc:
            return {
                **base,
                "error_code": "DEAL_HUNTER_EVALUATION_FAILED",
                "error_message": str(exc)[:2000],
            }

    async def _publish_run_summary(
        self,
        run_id: str,
        status: str,
        counts: dict[str, int],
        summary: dict[str, Any],
    ) -> None:
        if not self.settings.api_key:
            return
        timeout = httpx.Timeout(min(float(self.settings.deal_hunter_request_timeout_seconds), 60.0))
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.post(
                str(self.settings.deal_hunter_site_url).rstrip("/")
                + "/api/instacomp/deal-hunter/evaluate",
                headers={
                    "X-InstaComp-AI-Key": str(self.settings.api_key),
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json={
                    "kind": "run_complete",
                    "runId": run_id,
                    "status": status,
                    "counts": counts,
                    "summary": summary,
                },
            )
            response.raise_for_status()
