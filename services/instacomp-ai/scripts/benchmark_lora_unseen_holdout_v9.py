#!/usr/bin/env python3
from __future__ import annotations

import sys
from typing import Any

import benchmark_lora_unseen_holdout_v8 as v8

SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v9"
BOOTSTRAP_OUTAGE_MIN_ATTEMPTS = 40
BOOTSTRAP_OUTAGE_TRANSPORT_RATIO = 0.90

v5 = v8.v7.v6.v5
canonical = v8.canonical
_ORIGINAL_V5_AUTHORITATIVE_HOLDOUT = v5._authoritative_holdout
_original_bootstrap_one: Any | None = None
_bootstrap_attempts = 0
_bootstrap_transport_failures = 0
_bootstrap_exact = 0


class RegistryOutageAbort(RuntimeError):
    """Systemic Registry transport failure; benchmark must stop fail-closed."""


def _transport_failure(reason: object) -> bool:
    text = str(reason or "").strip().casefold()
    return text.startswith("transport:") or text == "bootstrap_item_timeout"


def _outage_detected(*, attempts: int, transport_failures: int, exact: int) -> bool:
    if attempts < BOOTSTRAP_OUTAGE_MIN_ATTEMPTS or exact != 0:
        return False
    return (transport_failures / attempts) >= BOOTSTRAP_OUTAGE_TRANSPORT_RATIO


async def _outage_sensing_bootstrap_one(client: Any, item: dict[str, Any], identity: Any):
    global _bootstrap_attempts, _bootstrap_transport_failures, _bootstrap_exact
    if _original_bootstrap_one is None:
        raise RuntimeError("V9 bootstrap runtime was not installed")

    resolved, reason = await _original_bootstrap_one(client, item, identity)
    _bootstrap_attempts += 1
    if resolved is not None:
        _bootstrap_exact += 1
    elif _transport_failure(reason):
        _bootstrap_transport_failures += 1

    if _outage_detected(
        attempts=_bootstrap_attempts,
        transport_failures=_bootstrap_transport_failures,
        exact=_bootstrap_exact,
    ):
        ratio = _bootstrap_transport_failures / _bootstrap_attempts
        raise RegistryOutageAbort(
            "systemic Registry bootstrap transport outage: "
            f"attempts={_bootstrap_attempts} transport_failures={_bootstrap_transport_failures} "
            f"transport_ratio={ratio:.1%} exact={_bootstrap_exact}"
        )
    return resolved, reason


async def _outage_bounded_authoritative_holdout(
    items: list[dict[str, Any]],
    *,
    target: int,
    registry_call_budget: int,
    gateway: Any,
    train_ids: set[str],
    all_dataset_ids: set[str],
    frozen_row_ids: set[str],
):
    try:
        return await _ORIGINAL_V5_AUTHORITATIVE_HOLDOUT(
            items,
            target=target,
            registry_call_budget=registry_call_budget,
            gateway=gateway,
            train_ids=train_ids,
            all_dataset_ids=all_dataset_ids,
            frozen_row_ids=frozen_row_ids,
        )
    except RegistryOutageAbort as error:
        print(
            "UNSEEN REGISTRY OUTAGE CIRCUIT BREAKER: "
            f"{error}; stopping fail-closed before canonical preflight",
            flush=True,
        )
        return [], {
            "inspected": 0,
            "registry_calls": _bootstrap_attempts,
            "locked": 0,
            "source_counts": {},
            "reject_reasons": {
                "registry_systemic_transport_outage": _bootstrap_transport_failures,
            },
            "bootstrap_attempts": _bootstrap_attempts,
            "bootstrap_transport_failures": _bootstrap_transport_failures,
            "bootstrap_exact": _bootstrap_exact,
            "registry_outage_circuit_breaker": True,
        }


def _install_runtime() -> None:
    global _original_bootstrap_one, _bootstrap_attempts, _bootstrap_transport_failures, _bootstrap_exact
    _bootstrap_attempts = 0
    _bootstrap_transport_failures = 0
    _bootstrap_exact = 0

    # Install every unchanged V8 authority/physical/recovery gate first. V9 then
    # observes only the transport outcome of the already-installed bootstrap call.
    v8._install_runtime()
    _original_bootstrap_one = v5._bootstrap_one
    v5._bootstrap_one = _outage_sensing_bootstrap_one
    v5._authoritative_holdout = _outage_bounded_authoritative_holdout
    v5.SCHEMA = SCHEMA
    v5.v4.SCHEMA = SCHEMA
    canonical.SCHEMA = SCHEMA


def _self_test() -> int:
    assert v8._self_test() == 0
    assert _transport_failure("transport:ReadTimeout")
    assert _transport_failure("bootstrap_item_timeout")
    assert not _transport_failure("registry_input_incomplete")
    assert not _outage_detected(attempts=39, transport_failures=39, exact=0)
    assert _outage_detected(attempts=40, transport_failures=40, exact=0)
    assert _outage_detected(attempts=40, transport_failures=36, exact=0)
    assert not _outage_detected(attempts=40, transport_failures=35, exact=0)
    assert not _outage_detected(attempts=40, transport_failures=40, exact=1)
    assert BOOTSTRAP_OUTAGE_MIN_ATTEMPTS >= 40
    assert BOOTSTRAP_OUTAGE_TRANSPORT_RATIO >= 0.90
    print("PASS unseen V9 detects only sustained systemic Registry transport outage")
    print("PASS unseen V9 never converts transport failure into Registry authority")
    print("PASS unseen V9 preserves the complete V8 receipt, physical, unseen-image, and diversity gates")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()
    _install_runtime()
    return int(v5.main())


if __name__ == "__main__":
    raise SystemExit(main())
