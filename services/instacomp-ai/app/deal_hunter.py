from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import uuid4

import httpx

from .deal_hunter_learning import record_decision_learning_event, shoe_decision_memory
from .deal_hunter_store import DealHunterStore, utc_now


# The third value is a safety floor, not an exact family count. New query
# families may be added by the production feed without requiring a Mac release,
# but a feed that unexpectedly shrinks below its certified baseline still fails.
FEEDS = (
    ("wnba", "/api/tcos/deal-hunter-native-ebay?perQuery={per_query}&scope=wnba", 15),
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
    (
        "music_comedy_autographs",
        "/api/tcos/deal-hunter-native-ebay?perQuery={per_query}&scope=music_comedy_autographs",
        8,
    ),
    (
        "shoe_deals",
        "/api/tcos/deal-hunter-public-marketplaces?perQuery={per_query}&scope=shoe_deals",
        2,
    ),
    (
        "mercari_card_opportunities",
        "/api/tcos/deal-hunter-public-marketplaces?perQuery={per_query}&scope=card_opportunities",
        6,
    ),
)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024

# Signed prospect baseballs are intentionally handled differently from sports
# cards. The user accepts raw/unauthenticated autographs when the physical ball
# is an official MLB or MiLB baseball and the acquisition price is cheap enough
# to justify authenticity risk. These candidates must never be forced through
# the card Checklist Registry or discarded merely because no JSA/BAS/PSA/COA
# accompanies the listing.
SIGNED_BASEBALL_LANES = {
    "signed_prospect_baseball",
    "signed_prospect_baseball_mislist_rescue",
}
SIGNED_BASEBALL_MIN_PER_RUN = 5
SIGNED_BASEBALL_REVIEW_MAX_DELIVERED_COST = 60.0
PUBLIC_MARKETPLACE_MIN_PER_RUN = 8
OPPORTUNITIES_PER_RUN = 5
SHOE_DEAL_LANES = {"shoe_deal"}
SHOE_MAX_ITEM_PRICE = 30.0
SHOE_MAX_SHIPPING = 15.0
SIGNED_BASEBALL_SIGNATURE_RE = re.compile(r"\b(signed|autograph(?:ed)?|auto)\b", re.I)
SIGNED_BASEBALL_OFFICIAL_RE = re.compile(
    r"\b(?:official\s+major\s+league\s+baseball|"
    r"official\s+minor\s+league\s+baseball|"
    r"official\s+ball\s+of\s+minor\s+league\s+baseball|"
    r"oml(?:b)?|"
    r"rawlings\s+official(?:\s+major|\s+minor)?\s+league\s+baseball|"
    r"robert\s+d\.?\s+manfred|allan\s+h\.?\s+selig|bud\s+selig)\b",
    re.I,
)
SIGNED_BASEBALL_AUTH_RE = re.compile(
    r"\b(?:jsa|beckett|bas|psa|mlb\s+authenticated|fanatics\s+authentic|"
    r"coa|certificate\s+of\s+authenticity|authenticated)\b",
    re.I,
)


class DealHunterEbayRateLimited(RuntimeError):
    pass


def _is_native_ebay_feed_path(path: str) -> bool:
    return "deal-hunter-native-ebay" in str(path)


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _is_signed_baseball_candidate(candidate: dict[str, Any]) -> bool:
    return str(candidate.get("lane") or "").strip() in SIGNED_BASEBALL_LANES


def _is_shoe_candidate(candidate: dict[str, Any]) -> bool:
    return str(candidate.get("lane") or "").strip() in SHOE_DEAL_LANES


def _is_public_marketplace_candidate(candidate: dict[str, Any]) -> bool:
    return str(candidate.get("marketplace") or "").strip().lower() in {"mercari", "poshmark"}


def _opportunity_score(result: dict[str, Any]) -> tuple[float, float, str]:
    if bool(result.get("actionable")):
        return (10_000.0 + float(result.get("roi_percent") or 0), 0.0, str(result.get("candidate_key") or ""))
    price = _number(result.get("item_price"))
    shipping = _number(result.get("inbound_shipping"))
    marketplace = str(result.get("marketplace") or "").strip().lower()
    lane = str(result.get("lane") or "").strip().lower()
    title = str(result.get("title") or "")
    score = 0.0
    if marketplace == "mercari":
        score += 35.0
    elif marketplace == "poshmark":
        score += 15.0
    if bool(result.get("alertworthy")):
        score += 25.0
    if result.get("status") in {"manual_review", "identity_review"}:
        score += 18.0
    if lane in {"broad_professional_rookies", "true_first_bowman", "signed_prospect_baseball", "signed_prospect_baseball_mislist_rescue"}:
        score += 12.0
    if re.search(r"\b(?:lot|2x|pair|bundle|complete your set|rookie|rc|1st|chrome|prizm|select|auto|autograph|signed)\b", title, re.I):
        score += 10.0
    if price is not None:
        if price <= 3:
            score += 18.0
        elif price <= 10:
            score += 14.0
        elif price <= 20:
            score += 8.0
        elif price <= 40:
            score += 3.0
    if shipping is not None and shipping <= 1.5:
        score += 5.0
    elif shipping is not None and shipping >= 8:
        score -= 5.0
    if result.get("error_code") == "DEAL_HUNTER_EXACT_SOLD_REQUIRED":
        score += 4.0
    return (score, -(price if price is not None else 10**6), str(result.get("candidate_key") or ""))


def _opportunity_item(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "candidate_key": result.get("candidate_key"),
        "title": result.get("title"),
        "listing_url": result.get("listing_url"),
        "watched_person": result.get("watched_person"),
        "lane": result.get("lane"),
        "marketplace": result.get("marketplace"),
        "status": result.get("status"),
        "item_price": result.get("item_price"),
        "inbound_shipping": result.get("inbound_shipping"),
        "delivered_cost": result.get("delivered_cost"),
        "conservative_resale": result.get("conservative_resale"),
        "expected_net_profit": result.get("expected_net_profit"),
        "roi_percent": result.get("roi_percent"),
        "deal_label": result.get("deal_label"),
        "actionable": bool(result.get("actionable")),
        "alertworthy": bool(result.get("alertworthy")),
        "error_code": result.get("error_code"),
        "error_message": result.get("error_message"),
        "opportunity_score": round(_opportunity_score(result)[0], 2),
    }


def _known_delivered_cost(candidate: dict[str, Any]) -> float | None:
    parts = [
        candidate.get("item_price"),
        candidate.get("inbound_shipping"),
        candidate.get("buyer_fees"),
        candidate.get("tax"),
    ]
    known = [_number(value) for value in parts]
    known = [value for value in known if value is not None]
    if not known:
        return None
    return round(sum(known), 2)


def candidate_key(candidate: dict[str, Any]) -> str:
    direct = str(candidate.get("listingItemId") or "").strip()
    if direct:
        marketplace = re.sub(r"[^a-z0-9]+", "-", str(candidate.get("marketplace") or "eBay").strip().lower()).strip("-") or "marketplace"
        return f"{marketplace}:{direct}"
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


def validate_feed(payload: dict[str, Any], key: str, minimum_families: int) -> None:
    errors = []
    schema = payload.get("schema")
    if schema == "TCOS_NATIVE_EBAY_FEED_V1":
        if payload.get("nativeEbayUsed") is not True:
            errors.append("nativeEbayUsed=false")
        if payload.get("tokenMode") != "client_credentials":
            errors.append(f"tokenMode={payload.get('tokenMode')}")
    elif schema == "TCOS_PUBLIC_MARKETPLACE_FEED_V1":
        if payload.get("publicWebSearchUsed") is not True:
            errors.append("publicWebSearchUsed=false")
        provider_mode = str(payload.get("providerMode") or "")
        allowed_provider_modes = {
            "openai_web_search",
            "openai_web_search_fallback",
            "gemini_google_search_primary",
            "poshmark_public_api",
            "poshmark_public_api_plus_gemini_fallback",
            "poshmark_public_api_plus_openai_fallback",
        }
        if provider_mode not in allowed_provider_modes:
            errors.append(f"providerMode={provider_mode or None}")
    else:
        errors.append(f"schema={schema}")
    if payload.get("ok") is not True:
        errors.append(f"ok={payload.get('ok')}")
    family_count = int(payload.get("queryFamilyCount", -1))
    success_count = int(payload.get("successfulQueryCount", -1))
    failed_count = int(payload.get("failedQueryCount", -1))
    if family_count < minimum_families:
        errors.append(
            f"queryFamilyCount={family_count}; minimum_expected={minimum_families}"
        )
    if success_count != family_count:
        errors.append(
            f"successfulQueryCount={success_count}; queryFamilyCount={family_count}"
        )
    if failed_count != 0:
        errors.append(f"failedQueryCount={failed_count}")
    coverage = payload.get("sourceCoverage") or []
    if len(coverage) != family_count:
        errors.append(
            f"sourceCoverage={len(coverage)}; queryFamilyCount={family_count}"
        )
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
        self.store.recover_interrupted_runs()
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
                summary["market_observations_saved"] = self.store.save_market_observations(run_id, candidates)
                selected, deferred = self._select_for_evaluation(candidates)
                summary["selected_for_evaluation"] = len(selected)
                summary["deferred_by_cooldown_or_capacity"] = deferred

                alert_delivery = {
                    "attempted": 0,
                    "sent": 0,
                    "duplicate_suppressed": 0,
                    "skipped": 0,
                    "failed": 0,
                    "errors": [],
                }
                concurrency = max(1, min(8, int(getattr(self.settings, "deal_hunter_evaluation_concurrency", 4))))
                gate = asyncio.Semaphore(concurrency)

                async def evaluate_one(candidate: dict[str, Any]) -> dict[str, Any]:
                    async with gate:
                        return await self._evaluate(candidate, run_id)

                evaluated_results = await asyncio.gather(
                    *(evaluate_one(candidate) for candidate in selected),
                    return_exceptions=True,
                )
                summary["evaluation_concurrency"] = concurrency

                run_review_items: list[dict[str, Any]] = []
                opportunity_pool: list[dict[str, Any]] = []
                for candidate, outcome in zip(selected, evaluated_results):
                    if isinstance(outcome, Exception):
                        result = {
                            **candidate,
                            "status": "failed",
                            "actionable": False,
                            "alertworthy": False,
                            "error_code": "DEAL_HUNTER_EVALUATION_TASK_FAILED",
                            "error_message": str(outcome)[:2000],
                        }
                    else:
                        result = outcome
                    self.store.save_candidate(run_id, result)
                    counts["evaluated"] += 1
                    counts["actionable"] += int(bool(result.get("actionable")))
                    counts["manual_review"] += int(
                        result.get("status") in {"manual_review", "identity_review"}
                    )
                    counts["failure"] += int(result.get("status") == "failed")
                    if result.get("status") in {"manual_review", "identity_review"} or bool(result.get("actionable")):
                        run_review_items.append(_opportunity_item(result))
                    if result.get("status") != "failed" and result.get("listing_url"):
                        opportunity_pool.append(result)

                    # Fully evaluated card candidates are persisted and alerted by
                    # the central evaluate endpoint during _evaluate(). Local-only
                    # outcomes (missing-back-image reviews and signed-baseball
                    # reviews) never touched that endpoint, so they previously
                    # vanished into SQLite even when alertworthy=True. Bridge those
                    # local outcomes into the same central persistence/email path.
                    if bool(result.get("alertworthy")) and not bool(
                        result.get("central_delivery_handled")
                    ):
                        alert_delivery["attempted"] += 1
                        try:
                            receipt = await self._publish_candidate_alert(run_id, result)
                            delivery = (receipt.get("persistence") or {}).get("delivery") or {}
                            delivery_status = str(delivery.get("status") or "skipped")
                            if delivery_status in alert_delivery:
                                alert_delivery[delivery_status] += 1
                            else:
                                alert_delivery["skipped"] += 1
                        except Exception as alert_error:
                            alert_delivery["failed"] += 1
                            if len(alert_delivery["errors"]) < 10:
                                alert_delivery["errors"].append(str(alert_error)[:1000])

                summary["alert_delivery"] = alert_delivery
                summary["review_items"] = run_review_items
                summary["top_opportunities"] = [
                    _opportunity_item(result)
                    for result in sorted(
                        opportunity_pool,
                        key=_opportunity_score,
                        reverse=True,
                    )[:OPPORTUNITIES_PER_RUN]
                ]
                summary["top_opportunity_count"] = len(summary["top_opportunities"])
                summary.update(counts)
                summary["completed_at"] = utc_now().isoformat()
                try:
                    receipt = await self._publish_run_summary(run_id, status, counts, summary)
                    summary["run_summary_delivery"] = {
                        "status": "sent",
                        "email": receipt.get("email") or {},
                    }
                except Exception as publish_error:
                    summary["run_summary_delivery"] = {
                        "status": "failed",
                        "error": str(publish_error)[:1000],
                    }
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
                # Preserve the cadence calculated when this run started. If a
                # slow batch overruns that timestamp, the scheduler loop will see
                # it as due and immediately start the next non-overlapping batch
                # instead of idling for another full interval.
                self.store.mark_scheduler_finished(
                    status=status,
                    next_run_at=next_run_at,
                    error_message=error_message,
                )

            return {"accepted": True, "status": status, **summary}

    async def _discover(self) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        site = str(self.settings.deal_hunter_site_url).rstrip("/")
        timeout = httpx.Timeout(float(self.settings.deal_hunter_request_timeout_seconds))
        aggregate: dict[str, dict[str, Any]] = {}
        coverage = []
        failures = []
        healthy_feed_count = 0
        ebay_rate_limited = False
        feed_pace = max(0.0, min(15.0, float(getattr(self.settings, "deal_hunter_feed_pace_seconds", 2.0))))

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            for key, path, minimum_families in FEEDS:
                native_ebay = _is_native_ebay_feed_path(path)
                if native_ebay and ebay_rate_limited:
                    coverage.append(
                        {
                            "key": key,
                            "status": "DEFERRED_RATE_LIMIT",
                            "minimum_query_family_count": minimum_families,
                            "result_count": 0,
                            "error": "Skipped without an HTTP call after an earlier eBay Browse rate limit in this run.",
                        }
                    )
                    continue

                url = site + path.format(per_query=int(self.settings.deal_hunter_per_query))
                try:
                    outcome = await self._fetch_feed(client, key, url, minimum_families)
                except DealHunterEbayRateLimited as exc:
                    ebay_rate_limited = True
                    error = str(exc)[:1000]
                    failures.append(f"{key}: {error}")
                    coverage.append(
                        {
                            "key": key,
                            "status": "FAILED_RATE_LIMIT",
                            "minimum_query_family_count": minimum_families,
                            "result_count": 0,
                            "error": error,
                        }
                    )
                    continue
                except Exception as exc:
                    error = str(exc)[:1000]
                    failures.append(f"{key}: {error}")
                    coverage.append(
                        {
                            "key": key,
                            "status": "FAILED",
                            "minimum_query_family_count": minimum_families,
                            "result_count": 0,
                            "error": error,
                        }
                    )
                    continue

                healthy_feed_count += 1
                coverage.append(outcome["coverage"])
                for raw in outcome["results"]:
                    normalized = normalize_candidate(raw)
                    if not normalized["listing_url"]:
                        continue
                    candidate_id = normalized["candidate_key"]
                    existing = aggregate.get(candidate_id)
                    if existing:
                        existing["image_urls"] = list(
                            dict.fromkeys(existing["image_urls"] + normalized["image_urls"])
                        )[:12]
                        existing["query_family_ids"] = list(
                            dict.fromkeys(existing["query_family_ids"] + normalized["query_family_ids"])
                        )
                        existing["manual_review_required"] = bool(
                            existing["manual_review_required"] or normalized["manual_review_required"]
                        )
                        existing["preliminary_risks"] = list(
                            dict.fromkeys(existing["preliminary_risks"] + normalized["preliminary_risks"])
                        )
                    else:
                        aggregate[candidate_id] = normalized

                if native_ebay and feed_pace > 0:
                    await asyncio.sleep(feed_pace)

        if failures and healthy_feed_count == 0:
            raise RuntimeError(
                "All Deal Hunter discovery feeds failed closed: " + " | ".join(failures)
            )
        return list(aggregate.values()), coverage

    async def _fetch_feed(
        self,
        client: httpx.AsyncClient,
        key: str,
        url: str,
        minimum_families: int,
    ) -> dict[str, Any]:
        started = utc_now()
        response = await client.get(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "InstaComp-AI-Mac-Deal-Hunter/1.0",
            },
        )
        payload = None
        try:
            payload = response.json()
        except Exception:
            payload = None
        if not response.is_success:
            errors = payload.get("errors") if isinstance(payload, dict) else None
            codes = {
                str(row.get("code") or row.get("errorCode") or "")
                for row in (errors or [])
                if isinstance(row, dict)
            }
            top_code = str(payload.get("code") or "") if isinstance(payload, dict) else ""
            if response.status_code == 429 or top_code in {"EBAY_BROWSE_QUOTA_RESERVED", "EBAY_BROWSE_RATE_LIMITED"} or "EBAY_BROWSE_RATE_LIMITED" in codes:
                detail = ""
                if isinstance(payload, dict):
                    detail = str(payload.get("error") or "")
                raise DealHunterEbayRateLimited(
                    f"{key} eBay discovery rate-limited (HTTP {response.status_code})"
                    + (f": {detail}" if detail else "")
                )
            response.raise_for_status()
        if not isinstance(payload, dict):
            raise RuntimeError(f"{key} feed returned unreadable JSON")
        validate_feed(payload, key, minimum_families)
        family_count = int(payload.get("queryFamilyCount", 0))
        return {
            "coverage": {
                "key": key,
                "status": "COMPLETE",
                "query_family_count": family_count,
                "minimum_query_family_count": minimum_families,
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
            failed_retry = 0 if prior and str(prior.get("last_status") or "").lower() == "failed" else 1
            image_penalty = 0 if len(candidate.get("image_urls") or []) >= 2 else 1
            return (
                failed_retry,
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

        # Signed baseballs used to compete with every card lane for the same 20
        # slots, which could leave 100+ discovered balls completely unevaluated.
        # Reserve a small guaranteed slice of each run for the cheapest/newest
        # signed-ball candidates, then fill the remaining slots normally.
        public_due = [candidate for candidate in due if _is_public_marketplace_candidate(candidate)]
        public_quota = min(PUBLIC_MARKETPLACE_MIN_PER_RUN, maximum, len(public_due))
        selected = public_due[:public_quota]
        selected_keys = {candidate["candidate_key"] for candidate in selected}

        signed_due = [candidate for candidate in due if _is_signed_baseball_candidate(candidate)]
        signed_quota = min(SIGNED_BASEBALL_MIN_PER_RUN, max(0, maximum - len(selected)), len(signed_due))
        for candidate in signed_due[:signed_quota]:
            if candidate["candidate_key"] in selected_keys:
                continue
            selected.append(candidate)
            selected_keys.add(candidate["candidate_key"])

        for candidate in due:
            if len(selected) >= maximum:
                break
            if candidate["candidate_key"] in selected_keys:
                continue
            selected.append(candidate)
            selected_keys.add(candidate["candidate_key"])

        return selected, max(0, len(candidates) - len(selected))

    def _decision_learning_path(self):
        resolver = getattr(self.settings, "resolve_local_path", None)
        database_path = getattr(self.settings, "database_path", None)
        if callable(resolver) and database_path is not None:
            return resolver(database_path)
        return self.store.path

    def _evaluate_shoe(self, candidate: dict[str, Any]) -> dict[str, Any]:
        base = {**candidate, "actionable": False, "alertworthy": False}
        item_price = _number(candidate.get("item_price"))
        shipping = _number(candidate.get("inbound_shipping"))
        delivered_cost = _known_delivered_cost(candidate)
        learning_path = self._decision_learning_path()
        memory = shoe_decision_memory(learning_path, candidate)

        if item_price is None or item_price > SHOE_MAX_ITEM_PRICE:
            result = {
                **base,
                "status": "completed",
                "delivered_cost": delivered_cost,
                "deal_label": "SHOE PASS — OVER ACQUISITION LIMIT",
                "error_code": "DEAL_HUNTER_SHOE_PRICE_LIMIT",
                "error_message": "Shoe Deal Watch requires an item price of $30 or less.",
                "decision_learning": memory,
            }
        elif shipping is not None and shipping > SHOE_MAX_SHIPPING:
            result = {
                **base,
                "status": "completed",
                "delivered_cost": delivered_cost,
                "deal_label": "SHOE PASS — SHIPPING TOO HIGH",
                "error_code": "DEAL_HUNTER_SHOE_SHIPPING_LIMIT",
                "error_message": "Known shipping exceeds the $15 reasonable-shipping ceiling.",
                "decision_learning": memory,
            }
        else:
            learned_bias = float(memory.get("learned_bias") or 0.0)
            trusted_total = int(memory.get("trusted_total") or 0)
            if trusted_total >= 2 and learned_bias >= 0.5:
                deal_label = "SHOE DEAL — LEARNED POSITIVE PATTERN"
            elif trusted_total >= 2 and learned_bias <= -0.5:
                deal_label = "SHOE DEAL — LEARNED CAUTION / REVIEW"
            else:
                deal_label = "SHOE DEAL — REVIEW FLIP ECONOMICS"
            result = {
                **base,
                "status": "manual_review",
                "delivered_cost": delivered_cost,
                "deal_label": deal_label,
                "alertworthy": True,
                "error_code": "DEAL_HUNTER_SHOE_FLIP_REVIEW",
                "error_message": (
                    "Public listing passed the saved Shoe Deal Watch intake rules: new adult New Balance, Adidas, "
                    "or Timberland Pro, item price at or below $30, and no excessive known shipping. InstaComp "
                    "decision memory is attached; verify availability, size/condition, seller quality, and resale margin before buying."
                ),
                "decision_learning": memory,
            }

        try:
            record_decision_learning_event(
                learning_path,
                event_type="SHOE_CANDIDATE_OBSERVED",
                candidate_key=str(candidate.get("candidate_key") or "").strip() or None,
                payload={
                    "lane": "shoe_deal",
                    "item_type": "new_adult_shoes",
                    "title": candidate.get("title"),
                    "brand": memory.get("brand"),
                    "marketplace": candidate.get("marketplace"),
                    "item_price": item_price,
                    "shipping": shipping,
                    "delivered_cost": delivered_cost,
                    "deal_label": result.get("deal_label"),
                    "learned_bias": memory.get("learned_bias"),
                },
                trusted=False,
            )
        except Exception:
            # Learning telemetry must never make Deal Hunter lose a valid candidate.
            pass
        return result

    def _evaluate_signed_baseball(self, candidate: dict[str, Any]) -> dict[str, Any]:
        base = {**candidate, "actionable": False, "alertworthy": False}
        title = str(candidate.get("title") or "")
        delivered_cost = _known_delivered_cost(candidate)
        signature_claimed = bool(SIGNED_BASEBALL_SIGNATURE_RE.search(title))
        official_ball_claimed = bool(SIGNED_BASEBALL_OFFICIAL_RE.search(title))
        authentication_claimed = bool(SIGNED_BASEBALL_AUTH_RE.search(title))
        cheap_enough_for_review = (
            delivered_cost is not None
            and delivered_cost <= SIGNED_BASEBALL_REVIEW_MAX_DELIVERED_COST
        )

        identity = {
            "type": "signed_prospect_baseball",
            "watchedPerson": candidate.get("watched_person"),
            "signatureClaimed": signature_claimed,
            "officialMlbOrMilbBallClaimed": official_ball_claimed,
            "authenticationClaimed": authentication_claimed,
            "authenticationRequired": False,
        }

        if not signature_claimed:
            return {
                **base,
                "status": "manual_review",
                "identity": identity,
                "delivered_cost": delivered_cost,
                "deal_label": "SIGNED BALL — VERIFY AUTOGRAPH CLAIM",
                "alertworthy": cheap_enough_for_review,
                "error_code": "DEAL_HUNTER_SIGNED_BALL_SIGNATURE_REVIEW_REQUIRED",
                "error_message": (
                    "The signed-baseball lane requires a plausible autograph claim. "
                    "Authentication/COA is optional, but the signature still must be verified from the listing photos."
                ),
            }

        if not official_ball_claimed:
            return {
                **base,
                "status": "manual_review",
                "identity": identity,
                "delivered_cost": delivered_cost,
                "deal_label": "SIGNED BALL — VERIFY OFFICIAL MLB/MILB BALL",
                "alertworthy": cheap_enough_for_review,
                "error_code": "DEAL_HUNTER_OFFICIAL_BALL_REVIEW_REQUIRED",
                "error_message": (
                    "Authentication/COA is not required. Verify from the photos that the physical ball is an official "
                    "Major League Baseball or official Minor League Baseball before buying."
                ),
            }

        if authentication_claimed:
            deal_label = "SIGNED OFFICIAL BALL — VALUE REVIEW"
            error_code = "DEAL_HUNTER_SIGNED_BALL_VALUE_REVIEW"
            reason = (
                "Official MLB/MiLB ball evidence and an authentication claim are present. "
                "Review the exact signature, seller, condition, delivered cost, and resale upside before buying."
            )
        else:
            deal_label = "RAW OFFICIAL BALL — AUTHENTICATION UPSIDE"
            error_code = "DEAL_HUNTER_RAW_SIGNED_BALL_REVIEW"
            reason = (
                "Raw/unauthenticated prospect autographs are allowed. The physical ball appears to be an official "
                "MLB/MiLB ball from the listing title; verify that marking and the signature from photos. No COA is required."
            )

        return {
            **base,
            "status": "manual_review",
            "identity": identity,
            "delivered_cost": delivered_cost,
            "deal_label": deal_label,
            "alertworthy": cheap_enough_for_review,
            "error_code": error_code,
            "error_message": reason,
        }

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
        if _is_shoe_candidate(candidate):
            return self._evaluate_shoe(candidate)
        if _is_signed_baseball_candidate(candidate):
            return self._evaluate_signed_baseball(candidate)

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
                    json={
                        "kind": "candidate_evaluate_v2",
                        "listing": listing_payload,
                        "frontImage": {
                            "name": front[2],
                            "contentType": front[1],
                            "dataBase64": base64.b64encode(front[0]).decode("ascii"),
                        },
                        "backImage": {
                            "name": back[2],
                            "contentType": back[1],
                            "dataBase64": base64.b64encode(back[0]).decode("ascii"),
                        },
                    },
                )
                try:
                    payload = response.json()
                except ValueError as exc:
                    content_type = str(response.headers.get("content-type") or "unknown")
                    preview = " ".join(response.text.strip().split())[:1000] or "<empty>"
                    raise RuntimeError(
                        f"Deal Hunter evaluator HTTP {response.status_code} returned non-JSON "
                        f"({content_type}): {preview}"
                    ) from exc
                if not response.is_success or payload.get("ok") is not True:
                    raise RuntimeError(
                        str(payload.get("error") or payload.get("note") or f"HTTP {response.status_code}")
                    )
                evaluation = payload.get("evaluation") or {}
                return {
                    **base,
                    "status": str(evaluation.get("status") or "completed"),
                    "central_delivery_handled": True,
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

    async def _publish_candidate_alert(
        self, run_id: str, result: dict[str, Any]
    ) -> dict[str, Any]:
        if not self.settings.api_key:
            raise RuntimeError(
                "INSTACOMP_AI_API_KEY is required for Deal Hunter alert delivery."
            )

        exact_market = result.get("exact_market") or {}
        sold_count = int(
            exact_market.get("pricingEligibleSoldCount")
            or exact_market.get("soldCount")
            or 0
        )
        payload = {
            "kind": "candidate_alert",
            "listing": {
                "runId": run_id,
                "candidateKey": result.get("candidate_key"),
                "lane": result.get("lane"),
                "watchedPerson": result.get("watched_person"),
                "marketplace": result.get("marketplace"),
                "listingItemId": result.get("listing_item_id"),
                "listingUrl": result.get("listing_url"),
                "title": result.get("title"),
                "sellerName": result.get("seller_name"),
                "itemPrice": result.get("item_price"),
                "inboundShipping": result.get("inbound_shipping"),
                "buyerFees": result.get("buyer_fees"),
                "tax": result.get("tax"),
                "imageUrls": result.get("image_urls") or [],
                "manualReviewRequired": result.get("manual_review_required"),
                "preliminaryRisks": result.get("preliminary_risks") or [],
                "queryFamilyIds": result.get("query_family_ids") or [],
            },
            "evaluation": {
                "status": result.get("status") or "manual_review",
                "soldCount": sold_count,
                "deliveredCost": result.get("delivered_cost"),
                "conservativeResale": result.get("conservative_resale"),
                "expectedNetProfit": result.get("expected_net_profit"),
                "roiPercent": result.get("roi_percent"),
                "dealLabel": result.get("deal_label") or "DEAL HUNTER REVIEW",
                "actionable": bool(result.get("actionable")),
                "alertworthy": bool(result.get("alertworthy")),
                "reason": result.get("error_message") or "Mac Deal Hunter flagged this listing for review.",
                "errorCode": result.get("error_code"),
            },
            "identity": result.get("identity") or {},
            "exactMarket": exact_market,
        }
        timeout = httpx.Timeout(
            min(float(self.settings.deal_hunter_request_timeout_seconds), 60.0)
        )
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.post(
                str(self.settings.deal_hunter_site_url).rstrip("/")
                + "/api/instacomp/deal-hunter/evaluate",
                headers={
                    "X-InstaComp-AI-Key": str(self.settings.api_key),
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
            )
            body = response.json()
            if not response.is_success or body.get("ok") is not True:
                raise RuntimeError(
                    str(body.get("error") or f"HTTP {response.status_code}")
                )
            return body

    async def _publish_run_summary(
        self,
        run_id: str,
        status: str,
        counts: dict[str, int],
        summary: dict[str, Any],
    ) -> dict[str, Any]:
        if not self.settings.api_key:
            raise RuntimeError("Deal Hunter run summary email cannot send: InstaComp AI key is missing.")
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
            body = response.json()
            if body.get("ok") is not True or (body.get("email") or {}).get("status") != "sent":
                raise RuntimeError(str(body.get("error") or "Deal Hunter run summary email was not confirmed sent."))
            return body
