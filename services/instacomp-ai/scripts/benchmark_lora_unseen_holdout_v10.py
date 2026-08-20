#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from typing import Any

import httpx

import benchmark_lora_unseen_holdout_v9 as v9

SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v10"
LIVE_PREFLIGHT_ROUTE = "/api/instacomp/registry-holdout-lock-player-card"
LIVE_PREFLIGHT_HTTP_TIMEOUT_SECONDS = 4.0
LIVE_PREFLIGHT_PROBES = (
    ("Napheesa Collier", "5"),
    ("Caitlin Clark", "8"),
    ("Aliyah Boston", "3"),
)
LIVE_PREFLIGHT_REQUIRED_HEALTHY = 3
TRANSIENT_HTTP_STATUSES = frozenset(
    {408, 425, 429, 500, 502, 503, 504, 544, *range(520, 531)}
)

_ORIGINAL_V9_TRANSPORT_FAILURE = v9._transport_failure


def _http_status_from_reason(reason: object) -> int | None:
    match = re.match(r"^http_(\d{3})(?::|$)", str(reason or "").strip().casefold())
    return int(match.group(1)) if match else None


def _systemic_registry_failure(reason: object) -> bool:
    """Treat transport failures and transient overload HTTP statuses as systemic.

    V9 already catches socket/read timeouts. V10 additionally classifies the
    overload statuses Production has emitted during Registry starvation so those
    responses cannot consume the full bootstrap/preflight budgets.
    """
    if _ORIGINAL_V9_TRANSPORT_FAILURE(reason):
        return True
    text = str(reason or "").strip().casefold()
    if text == "route_error":
        return True
    status = _http_status_from_reason(text)
    return status in TRANSIENT_HTTP_STATUSES if status is not None else False


def _preflight_response_health(
    status_code: int,
    data: object,
) -> tuple[bool, str]:
    if status_code in {401, 403}:
        return False, "authentication_failed"
    if status_code in TRANSIENT_HTTP_STATUSES:
        return False, f"http_{status_code}"
    if status_code < 200 or status_code >= 300:
        return False, f"http_{status_code}"
    if not isinstance(data, dict) or data.get("ok") is not True:
        return False, "route_error"

    status = str(data.get("status") or data.get("resolverStatus") or "").strip()
    reasons = [str(value) for value in data.get("reasons", []) if value] if isinstance(data.get("reasons"), list) else []

    # input_incomplete can be returned before touching the database, so it is not
    # a valid live-DB health signal. lookup_unavailable explicitly means the RPC
    # failed. Only responses produced after a successful player/card DB lookup are
    # accepted as healthy, regardless of whether that specific probe was exact.
    if status in {"input_incomplete", "lookup_unavailable"}:
        return False, status
    if any("player_card_candidate_lookup_failed" in reason for reason in reasons):
        return False, "player_card_candidate_lookup_failed"
    if status not in {"exact_match", "set_present_no_exact_match"}:
        return False, f"unexpected_status:{status or 'missing'}"
    return True, status


def _live_registry_preflight() -> bool:
    from app.checklist import _registry_base_url, _registry_headers

    base_url = _registry_base_url()
    if not base_url:
        print("UNSEEN REGISTRY LIVE PREFLIGHT FAIL: Registry base URL is unavailable", flush=True)
        return False

    url = f"{base_url}{LIVE_PREFLIGHT_ROUTE}"
    healthy = 0
    timeout = httpx.Timeout(LIVE_PREFLIGHT_HTTP_TIMEOUT_SECONDS)
    limits = httpx.Limits(max_connections=1, max_keepalive_connections=1)

    try:
        with httpx.Client(timeout=timeout, limits=limits, follow_redirects=True) as client:
            for index, (player, card_number) in enumerate(LIVE_PREFLIGHT_PROBES, start=1):
                try:
                    response = client.post(
                        url,
                        headers=_registry_headers(),
                        json={"player": player, "cardNumber": card_number},
                    )
                except httpx.HTTPError as error:
                    print(
                        "UNSEEN REGISTRY LIVE PREFLIGHT "
                        f"{index}/{len(LIVE_PREFLIGHT_PROBES)} FAIL {player} #{card_number} "
                        f"transport:{type(error).__name__}",
                        flush=True,
                    )
                    continue

                try:
                    data: object = response.json() if response.content else {}
                except Exception:
                    data = {}
                ok, reason = _preflight_response_health(response.status_code, data)
                if ok:
                    healthy += 1
                print(
                    "UNSEEN REGISTRY LIVE PREFLIGHT "
                    f"{index}/{len(LIVE_PREFLIGHT_PROBES)} "
                    f"{'PASS' if ok else 'FAIL'} {player} #{card_number} "
                    f"http={response.status_code} result={reason}",
                    flush=True,
                )
    except httpx.HTTPError as error:
        print(
            "UNSEEN REGISTRY LIVE PREFLIGHT FAIL: "
            f"client transport:{type(error).__name__}",
            flush=True,
        )
        return False

    if healthy < LIVE_PREFLIGHT_REQUIRED_HEALTHY:
        print(
            "UNSEEN REGISTRY LIVE PREFLIGHT FAILED: "
            f"healthy={healthy}/{len(LIVE_PREFLIGHT_PROBES)} required={LIVE_PREFLIGHT_REQUIRED_HEALTHY}; "
            "no unseen exam work will start",
            flush=True,
        )
        return False

    print(
        "PASS UNSEEN REGISTRY LIVE PREFLIGHT: "
        f"healthy={healthy}/{len(LIVE_PREFLIGHT_PROBES)}; player/card RPC is serving database-backed responses",
        flush=True,
    )
    return True


def _install_runtime() -> None:
    # Widen only V9's outage classification. All authority, receipt, physical,
    # unseen-image, diversity, and recovery gates remain exactly V9/V8/V20.
    v9._transport_failure = _systemic_registry_failure
    v9._install_runtime()
    v9.SCHEMA = SCHEMA
    v9.v5.SCHEMA = SCHEMA
    v9.v5.v4.SCHEMA = SCHEMA
    v9.canonical.SCHEMA = SCHEMA


def _self_test() -> int:
    assert v9._self_test() == 0

    assert _systemic_registry_failure("transport:ReadTimeout")
    assert _systemic_registry_failure("bootstrap_item_timeout")
    assert _systemic_registry_failure("http_429")
    assert _systemic_registry_failure("http_503:service unavailable")
    assert _systemic_registry_failure("http_504:gateway timeout")
    assert _systemic_registry_failure("http_522")
    assert _systemic_registry_failure("route_error")
    assert not _systemic_registry_failure("http_404")
    assert not _systemic_registry_failure("authentication_failed")
    assert not _systemic_registry_failure("registry_input_incomplete")

    assert _preflight_response_health(200, {"ok": True, "status": "exact_match"})[0]
    assert _preflight_response_health(200, {"ok": True, "status": "set_present_no_exact_match"})[0]
    assert not _preflight_response_health(200, {"ok": True, "status": "lookup_unavailable"})[0]
    assert not _preflight_response_health(200, {"ok": True, "status": "input_incomplete"})[0]
    assert not _preflight_response_health(429, {"ok": False})[0]
    assert not _preflight_response_health(503, {"ok": False})[0]
    assert not _preflight_response_health(504, {"ok": False})[0]
    assert not _preflight_response_health(401, {"ok": False})[0]

    assert LIVE_PREFLIGHT_ROUTE.endswith("registry-holdout-lock-player-card")
    assert LIVE_PREFLIGHT_HTTP_TIMEOUT_SECONDS <= 4.0
    assert len(LIVE_PREFLIGHT_PROBES) == LIVE_PREFLIGHT_REQUIRED_HEALTHY == 3
    assert len({probe for probe in LIVE_PREFLIGHT_PROBES}) == len(LIVE_PREFLIGHT_PROBES)

    print("PASS unseen V10 blocks the exam until three database-backed player/card Registry probes succeed")
    print("PASS unseen V10 treats 429/5xx/52x overload responses as systemic Registry failures")
    print("PASS unseen V10 preserves every V9/V8/V20 authority, receipt, physical, unseen-image, and diversity gate")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()
    if "--preflight-only" in sys.argv[1:]:
        return 0 if _live_registry_preflight() else 4

    if not _live_registry_preflight():
        return 4
    _install_runtime()
    return int(v9.v5.main())


if __name__ == "__main__":
    raise SystemExit(main())
