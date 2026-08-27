from __future__ import annotations

from typing import Any
from uuid import uuid4

import httpx

from .deal_hunter import FEEDS, normalize_candidate
from .deal_hunter_store import utc_now


ALLOWED_TARGET_LANES = frozenset(key for key, _, _ in FEEDS)


def select_targeted_candidates(
    scheduler,
    candidates: list[dict[str, Any]],
    *,
    force: bool,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    configured_max = max(1, int(scheduler.settings.deal_hunter_max_candidates_per_run))
    cap = max(1, min(int(limit), configured_max))

    if not force:
        selected, _ = scheduler._select_for_evaluation(candidates)
        selected = selected[:cap]
        return selected, max(0, len(candidates) - len(selected))

    # Force bypasses only candidate cooldown. It does not bypass image,
    # Registry identity, exact-market, economics, or trusted-history gates.
    due = list(candidates)
    due.sort(
        key=lambda candidate: (
            0 if len(candidate.get("image_urls") or []) >= 2 else 1,
            float(candidate.get("item_price") or 10**9),
            str(candidate.get("candidate_key") or ""),
        )
    )
    selected = due[:cap]
    return selected, max(0, len(candidates) - len(selected))


async def discover_target_lane(scheduler, lane: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if lane not in ALLOWED_TARGET_LANES:
        raise ValueError(f"Unknown Deal Hunter lane: {lane}")

    key, path, expected = next(row for row in FEEDS if row[0] == lane)
    site = str(scheduler.settings.deal_hunter_site_url).rstrip("/")
    timeout = httpx.Timeout(float(scheduler.settings.deal_hunter_request_timeout_seconds))
    url = site + path.format(per_query=int(scheduler.settings.deal_hunter_per_query))

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        outcome = await scheduler._fetch_feed(client, key, url, expected)

    aggregate: dict[str, dict[str, Any]] = {}
    for raw in outcome["results"]:
        candidate = normalize_candidate(raw)
        if not candidate["listing_url"]:
            continue
        existing = aggregate.get(candidate["candidate_key"])
        if existing:
            existing["image_urls"] = list(
                dict.fromkeys(existing["image_urls"] + candidate["image_urls"])
            )[:12]
            existing["query_family_ids"] = list(
                dict.fromkeys(existing["query_family_ids"] + candidate["query_family_ids"])
            )
        else:
            aggregate[candidate["candidate_key"]] = candidate

    return list(aggregate.values()), [outcome["coverage"]]


async def run_targeted_lane(
    scheduler,
    *,
    lane: str,
    force: bool = False,
    limit: int = 10,
) -> dict[str, Any]:
    if lane not in ALLOWED_TARGET_LANES:
        raise ValueError(f"Unknown Deal Hunter lane: {lane}")
    if scheduler._run_lock.locked():
        return {"accepted": False, "reason": "A Deal Hunter run is already active."}

    async with scheduler._run_lock:
        run_id = str(uuid4())
        next_run_at = scheduler.next_run()
        scheduler.store.create_run(run_id, "manual_targeted")
        scheduler.store.mark_scheduler_started(run_id, next_run_at)
        summary: dict[str, Any] = {
            "run_id": run_id,
            "trigger": "manual_targeted",
            "target_lane": lane,
            "force_cooldown_bypass": bool(force),
            "requested_limit": int(limit),
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
        status = "completed"
        error_message = None

        try:
            candidates, coverage = await discover_target_lane(scheduler, lane)
            counts["discovery"] = len(candidates)
            summary["feed_coverage"] = coverage
            selected, deferred = select_targeted_candidates(
                scheduler,
                candidates,
                force=force,
                limit=limit,
            )
            summary["selected_for_evaluation"] = len(selected)
            summary["deferred_by_cooldown_or_capacity"] = deferred

            for candidate in selected:
                result = await scheduler._evaluate(candidate, run_id)
                scheduler.store.save_candidate(run_id, result)
                counts["evaluated"] += 1
                counts["actionable"] += int(bool(result.get("actionable")))
                counts["manual_review"] += int(
                    result.get("status") in {"manual_review", "identity_review"}
                )
                counts["failure"] += int(result.get("status") == "failed")

            summary.update(counts)
            summary["completed_at"] = utc_now().isoformat()
            await scheduler._publish_run_summary(run_id, status, counts, summary)
        except Exception as exc:
            status = "failed"
            error_message = str(exc)[:4000]
            counts["failure"] += 1
            summary.update(counts)
            summary["error"] = error_message
            summary["completed_at"] = utc_now().isoformat()
            try:
                await scheduler._publish_run_summary(run_id, status, counts, summary)
            except Exception as publish_error:
                summary["publish_error"] = str(publish_error)[:1000]
        finally:
            scheduler.store.finish_run(
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
            scheduler.store.mark_scheduler_finished(
                status=status,
                next_run_at=scheduler.next_run(),
                error_message=error_message,
            )

        return {"accepted": True, "status": status, **summary}
