#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import re
import sys
from typing import Any, Awaitable, Callable

import promote_lora_candidate_frozen_25_v12 as v12

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v13"
RegistryMatch = Callable[[Any, str | None], Awaitable[Any]]
SleepFn = Callable[[float], Awaitable[None]]

# A throttle is infrastructure flow control, never card evidence.  Retry the
# exact same Registry request after the server-provided window instead of
# returning anything to the legacy preflight loop that could be counted as a
# card miss.  Bound repeated throttle windows so a dead endpoint cannot hang
# forever.
MAX_THROTTLE_WINDOWS_PER_REQUEST = 6
RETRY_WINDOW_BUFFER_SECONDS = 3
_DEFAULT_RETRY_SECONDS = 60
_RETRY_WINDOW_RE = re.compile(
    r"try\s+again\s+in\s+(\d+)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)",
    re.IGNORECASE,
)


class RegistryThrottleAbort(BaseException):
    """Terminal Registry throttle control signal that legacy `except Exception` cannot swallow."""


def _retry_seconds(reason: str) -> int:
    match = _RETRY_WINDOW_RE.search(str(reason or ""))
    if match is None:
        return _DEFAULT_RETRY_SECONDS
    amount = max(1, int(match.group(1)))
    unit = match.group(2).casefold()
    if unit.startswith(("hour", "hr")):
        return amount * 3600
    if unit.startswith(("minute", "min")):
        return amount * 60
    return amount


def _retrying_registry_match(
    registry_match: RegistryMatch,
    *,
    sleep_fn: SleepFn = asyncio.sleep,
    max_windows: int = MAX_THROTTLE_WINDOWS_PER_REQUEST,
) -> RegistryMatch:
    async def guarded(identity: Any, ocr: str | None):
        throttle_windows = 0
        while True:
            result = await registry_match(identity, ocr)
            reason = v12._registry_throttle_reason(result)
            if not reason:
                return result

            throttle_windows += 1
            if throttle_windows > max_windows:
                raise RegistryThrottleAbort(
                    "Registry remained throttled after the bounded retry windows. "
                    "No card was marked failed and the candidate was not activated. "
                    f"Registry said: {reason}"
                )

            delay = _retry_seconds(reason) + RETRY_WINDOW_BUFFER_SECONDS
            print(
                "REGISTRY THROTTLE BACKOFF: "
                f"same_request_retry={throttle_windows}/{max_windows} "
                f"delay_seconds={delay} reason={reason!r}; "
                "no card failure recorded",
                flush=True,
            )
            await sleep_fn(delay)

    return guarded


def _install_contract() -> None:
    # v12 owns the pinned row selection and every inherited Registry/identity
    # gate. Replace only the throttle wrapper. Because build_staged_pinned_live
    # looks this symbol up at runtime, every v10 retry request now waits/retries
    # internally and never hands a throttled result/Exception to v3.
    v12._throttle_guarded_registry_match = _retrying_registry_match
    v12.SCHEMA = SCHEMA


def _self_test_retry_same_request() -> None:
    calls: list[tuple[Any, str | None]] = []
    sleeps: list[float] = []
    identity = object()

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async def throttled_once(current_identity: Any, ocr: str | None):
        calls.append((current_identity, ocr))
        if len(calls) == 1:
            return type(
                "RegistryResult",
                (),
                {
                    "reasons": ["Too many attempts. Try again in 13 minutes."],
                    "outcome": "set_present_no_exact_match",
                },
            )()
        return type(
            "RegistryResult",
            (),
            {"reasons": [], "outcome": "exact_match"},
        )()

    result = asyncio.run(
        _retrying_registry_match(
            throttled_once,
            sleep_fn=fake_sleep,
        )(identity, "same-ocr")
    )
    assert result.outcome == "exact_match"
    assert len(calls) == 2
    assert calls[0] == calls[1] == (identity, "same-ocr")
    assert sleeps == [13 * 60 + RETRY_WINDOW_BUFFER_SECONDS]

    print("PASS v13 throttle retries the exact same Registry identity/OCR request")
    print("PASS v13 honors the Registry-provided retry window before retrying")


def _self_test_legacy_swallow_regression() -> None:
    calls = 0
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async def always_throttled(_identity: Any, _ocr: str | None):
        nonlocal calls
        calls += 1
        return type(
            "RegistryResult",
            (),
            {
                "reasons": ["Too many attempts. Try again in 1 second."],
                "outcome": "set_present_no_exact_match",
            },
        )()

    guarded = _retrying_registry_match(always_throttled, sleep_fn=fake_sleep, max_windows=1)

    async def legacy_broad_exception_loop():
        # This reproduces the exact structural mistake in v3: `except Exception`
        # used to swallow v12's RuntimeError throttle signal.  v13's terminal
        # control signal is a BaseException, so it must escape this block.
        try:
            return await guarded(object(), None)
        except Exception:  # pragma: no cover - must not execute
            return "SWALLOWED_AS_CARD_MISS"

    try:
        asyncio.run(legacy_broad_exception_loop())
        raise AssertionError("terminal throttle was swallowed by legacy except Exception")
    except RegistryThrottleAbort as exc:
        assert "No card was marked failed" in str(exc)

    assert calls == 2
    assert sleeps == [1 + RETRY_WINDOW_BUFFER_SECONDS]
    assert not issubclass(RegistryThrottleAbort, Exception)

    print("PASS v13 terminal throttle cannot be swallowed by v3 except Exception")
    print("PASS v13 bounded exhaustion records no card mismatch")


def _self_test_non_throttle_passthrough() -> None:
    calls = 0

    async def ordinary(_identity: Any, _ocr: str | None):
        nonlocal calls
        calls += 1
        return type(
            "RegistryResult",
            (),
            {
                "reasons": ["no exact checklist row"],
                "outcome": "set_present_no_exact_match",
            },
        )()

    result = asyncio.run(_retrying_registry_match(ordinary)(object(), None))
    assert result.outcome == "set_present_no_exact_match"
    assert calls == 1
    print("PASS v13 ordinary Registry results remain unchanged for v10 identity logic")


def self_test() -> int:
    # Prove the entire pinned v12/v11/v10/v9 stack first using its original
    # behavior, then prove the v13 replacement around the exact regression.
    assert v12.self_test() == 0
    _self_test_retry_same_request()
    _self_test_legacy_swallow_regression()
    _self_test_non_throttle_passthrough()
    assert _retry_seconds("Too many attempts. Try again in 13 minutes.") == 780
    assert _retry_seconds("Try again in 9 seconds") == 9
    assert _retry_seconds("Try again in 2 hours") == 7200
    print("PASS v13 preserves pinned Frozen 10 and every inherited fail-closed gate")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    _install_contract()
    try:
        return v12.main()
    except RegistryThrottleAbort as error:
        print(f"REGISTRY THROTTLE ABORT: {error}", file=sys.stderr, flush=True)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
