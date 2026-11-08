#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_25_v12 as v12
import promote_lora_candidate_frozen_25_v13 as v13

SCHEMA = "tcos.instacomp-ai.lora-staged-pinned-promotion.v14"

# A stage needs target-5 NEW expansion fixtures because the trusted Frozen Five
# are always carried in first. v12 previously exposed exactly that many pinned
# rows, which meant one legitimate safety rejection made the whole stage
# impossible. Keep the same deterministic priority prefix but expose a small
# bounded replacement pool so v3 can skip a rejected pin and keep selecting.
#
# This is NOT request throttling. The Registry client runs at full speed; these
# values only bound which already-vetted pinned training rows may be considered
# for a staged certification rung.
PINNED_BACKFILL_POOL_SIZES = {10: 8, 15: 15, 25: 20}
REQUIRED_NEW_FIXTURES = {10: 5, 15: 10, 25: 20}
MAX_REGISTRY_CALLS_PER_EXPANSION_ROW = v12.MAX_REGISTRY_CALLS_PER_EXPANSION_ROW


def _install_backfill_pool() -> None:
    v12.PINNED_EXPANSION_BUDGETS = dict(PINNED_BACKFILL_POOL_SIZES)
    v12.PREFLIGHT_REGISTRY_CALL_CEILINGS = {
        target: pool_size * MAX_REGISTRY_CALLS_PER_EXPANSION_ROW
        for target, pool_size in PINNED_BACKFILL_POOL_SIZES.items()
    }


async def run_round_exhaustive(
    number: int,
    fixtures: list[dict[str, Any]],
    adapter_sha: str,
    *,
    settings_obj: Any | None = None,
    analyze_local_vision_fn: Any | None = None,
    reader_obj: Any | None = None,
    diagnostic_match_fn: Any | None = None,
    suggestion_gate_fn: Any | None = None,
    registry_gate_fn: Any | None = None,
    case_evidence_fn: Any | None = None,
    visible_fn: Any | None = None,
) -> dict[str, Any]:
    """Run every fixture before returning deterministic card failures.

    Older staged runners returned on the first candidate/Registry mismatch. That
    made a 15-card certification behave like whack-a-mole: fix one reviewed card,
    rerun, then discover the next bad card. Deterministic per-card failures are now
    accumulated across the complete fixture set so one live run exposes the whole
    repair list. Infrastructure failures still abort immediately because later
    results would not be trustworthy when the Registry/runtime transport is sick.
    """
    v2 = v11.v3.v2

    if settings_obj is None:
        from app.config import settings as settings_obj
    if analyze_local_vision_fn is None:
        from app.local_vision import analyze_local_vision as analyze_local_vision_fn
    if reader_obj is None:
        from app.ollama import OllamaReader

        reader_obj = OllamaReader(settings_obj)
    if diagnostic_match_fn is None:
        from app.checklist import checklist_gateway

        diagnostic_match_fn = getattr(checklist_gateway, "match_with_diagnostics", None)
    suggestion_gate_fn = suggestion_gate_fn or v2.base.suggestion_gate
    registry_gate_fn = registry_gate_fn or v2.legacy._registry_gate
    case_evidence_fn = case_evidence_fn or v2.frozen_five_v2.case_evidence
    visible_fn = visible_fn or v2.base.visible

    if settings_obj.lora_candidate_enabled is not True:
        raise RuntimeError("Candidate setting did not reload enabled")
    if not callable(diagnostic_match_fn):
        return {
            "round": number,
            "passed": False,
            "cases": [],
            "failure_mode": "infrastructure",
            "failure_count": 1,
            "failures": [
                {
                    "key": None,
                    "player": None,
                    "card_number": None,
                    "error": "Authoritative Registry diagnostic gateway is not installed",
                }
            ],
            "error": "Authoritative Registry diagnostic gateway is not installed",
        }

    cases: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    for item in fixtures:
        case = item["case"]
        paths = item["images"]
        front = paths[0].read_bytes()
        back = paths[1].read_bytes() if len(paths) > 1 else None
        vision = await analyze_local_vision_fn(front, back, settings_obj)
        suggestion = await reader_obj.analyze(front, back, local_vision=vision)

        try:
            suggestion_gate_fn(suggestion.model_dump(mode="json"), adapter_sha)
        except RuntimeError as error:
            evidence = case_evidence_fn(item, suggestion, None, case)
            evidence["error"] = str(error)
            evidence["passed"] = False
            cases.append(evidence)
            failures.append(
                {
                    "key": case[0],
                    "player": case[1],
                    "card_number": case[2],
                    "error": str(error),
                }
            )
            print(
                f"ROUND {number} FAIL {case[1]} #{case[2]}: {error}; "
                "continuing exhaustive deterministic sweep",
                flush=True,
            )
            continue

        try:
            registry, diagnostics = await diagnostic_match_fn(
                suggestion.identity,
                visible_fn(suggestion),
            )
        except Exception as error:
            evidence = case_evidence_fn(item, suggestion, None, case)
            message = f"Registry diagnostic request raised {type(error).__name__}: {error}"
            evidence["error"] = message
            evidence["passed"] = False
            cases.append(evidence)
            return {
                "round": number,
                "passed": False,
                "cases": cases,
                "failure_mode": "infrastructure",
                "failure_count": len(failures) + 1,
                "failures": failures
                + [
                    {
                        "key": case[0],
                        "player": case[1],
                        "card_number": case[2],
                        "error": message,
                    }
                ],
                "error": message,
            }

        evidence = case_evidence_fn(
            item,
            suggestion,
            registry,
            case,
            diagnostics,
        )
        try:
            registry_gate_fn(registry.model_dump(mode="json"), case)
        except RuntimeError as error:
            evidence["error"] = str(error)
            evidence["passed"] = False
            cases.append(evidence)
            failures.append(
                {
                    "key": case[0],
                    "player": case[1],
                    "card_number": case[2],
                    "error": str(error),
                    "registry_status": evidence.get("registry_status"),
                    "registry_resolver_status": evidence.get("registry_resolver_status"),
                    "registry_identity_id": evidence.get("registry_identity_id"),
                }
            )
            print(
                f"ROUND {number} FAIL {case[1]} #{case[2]}: {error}; "
                f"registry_status={evidence.get('registry_status')!r}; "
                f"resolver_status={evidence.get('registry_resolver_status')!r}; "
                f"registry_uuid={evidence.get('registry_identity_id')!r}; "
                "continuing exhaustive deterministic sweep",
                flush=True,
            )
            continue

        evidence["passed"] = True
        cases.append(evidence)
        print(
            f"ROUND {number} PASS {case[1]} #{case[2]} "
            f"provider={suggestion.provider} registry={registry.identity_id}",
            flush=True,
        )

    passed = not failures and len(cases) == len(fixtures)
    result: dict[str, Any] = {
        "round": number,
        "passed": passed,
        "cases": cases,
        "failure_mode": None if passed else "deterministic_card_failures",
        "failure_count": len(failures),
        "failures": failures,
    }
    if failures:
        summary = "; ".join(
            f"{item['player']} #{item['card_number']}: {item['error']}"
            for item in failures
        )
        result["error"] = f"{len(failures)} deterministic card failure(s): {summary}"
        print(
            f"ROUND {number} EXHAUSTIVE SWEEP COMPLETE failures={len(failures)} "
            f"cases_checked={len(cases)}/{len(fixtures)}",
            flush=True,
        )
    return result


def _install_contract() -> None:
    _install_backfill_pool()
    # Preserve v13's same-request throttle handling and every inherited
    # Registry/identity/image/serial/card-number safety gate.
    v13._install_contract()
    # v2 historically stopped a live round at the first deterministic card miss.
    # Replace only that traversal behavior: all safety gates stay identical, but
    # the full stage is swept so every bad fixture is reported in one receipt.
    v11.v3.v2.run_round = run_round_exhaustive
    # Stamp the resulting staged receipts with the incident-specific runner.
    v12.SCHEMA = SCHEMA
    v11.SCHEMA = SCHEMA


class _FakeSuggestion:
    def __init__(self, key: str):
        self.key = key
        self.provider = "instacomp_lora_candidate"
        self.identity = SimpleNamespace(key=key)

    def model_dump(self, mode: str = "json") -> dict[str, Any]:
        return {"key": self.key, "provider": self.provider, "mode": mode}


class _FakeRegistry:
    def __init__(self, key: str, *, fail: bool):
        self.key = key
        self.fail = fail
        self.identity_id = f"registry-{key}"

    def model_dump(self, mode: str = "json") -> dict[str, Any]:
        return {
            "key": self.key,
            "fail": self.fail,
            "identity_id": self.identity_id,
            "mode": mode,
        }


class _FakeReader:
    async def analyze(self, _front: bytes, _back: bytes | None, *, local_vision: Any):
        return _FakeSuggestion(str(local_vision))


def _self_test_exhaustive_round() -> None:
    import asyncio

    with tempfile.TemporaryDirectory(prefix="instacomp-exhaustive-round-") as temp:
        image = Path(temp) / "card.jpg"
        image.write_bytes(b"card")
        fixtures = [
            {
                "case": (
                    f"case-{index}",
                    f"Player {index}",
                    str(index),
                    None,
                    f"00000000-0000-0000-0014-{index:012d}",
                    f"{index + 1:064x}",
                ),
                "images": [image],
                "row_id": f"row-{index}",
                "split": "train",
            }
            for index in range(3)
        ]
        keys = iter(["case-0", "case-1", "case-2"])

        async def fake_vision(_front: bytes, _back: bytes | None, _settings: Any):
            return next(keys)

        async def fake_registry(identity: Any, _visible: str):
            key = str(identity.key)
            return _FakeRegistry(key, fail=key in {"case-0", "case-2"}), {"status": "test"}

        def fake_registry_gate(payload: dict[str, Any], _case: Any) -> None:
            if payload["fail"]:
                raise RuntimeError(f"deterministic mismatch {payload['key']}")

        def fake_evidence(
            _item: dict[str, Any],
            suggestion: _FakeSuggestion,
            registry: _FakeRegistry | None,
            case: Any,
            _diagnostics: Any = None,
        ) -> dict[str, Any]:
            return {
                "key": case[0],
                "player": case[1],
                "card_number": case[2],
                "candidate_provider": suggestion.provider,
                "candidate_fallback": False,
                "registry_status": "exact_match" if registry is not None else None,
                "registry_resolver_status": "internal_exact_match" if registry is not None else None,
                "registry_identity_id": registry.identity_id if registry is not None else None,
                "passed": False,
            }

        result = asyncio.run(
            run_round_exhaustive(
                1,
                fixtures,
                "a" * 64,
                settings_obj=SimpleNamespace(lora_candidate_enabled=True),
                analyze_local_vision_fn=fake_vision,
                reader_obj=_FakeReader(),
                diagnostic_match_fn=fake_registry,
                suggestion_gate_fn=lambda _payload, _sha: None,
                registry_gate_fn=fake_registry_gate,
                case_evidence_fn=fake_evidence,
                visible_fn=lambda _suggestion: "visible",
            )
        )
        assert result["passed"] is False
        assert result["failure_mode"] == "deterministic_card_failures"
        assert result["failure_count"] == 2
        assert len(result["cases"]) == 3
        assert [item["key"] for item in result["failures"]] == ["case-0", "case-2"]
        assert result["cases"][1]["passed"] is True

        async def infrastructure_failure(_identity: Any, _visible: str):
            raise ConnectionError("registry offline")

        one_key = iter(["case-0"])

        async def one_vision(_front: bytes, _back: bytes | None, _settings: Any):
            return next(one_key)

        infra = asyncio.run(
            run_round_exhaustive(
                1,
                fixtures[:1],
                "a" * 64,
                settings_obj=SimpleNamespace(lora_candidate_enabled=True),
                analyze_local_vision_fn=one_vision,
                reader_obj=_FakeReader(),
                diagnostic_match_fn=infrastructure_failure,
                suggestion_gate_fn=lambda _payload, _sha: None,
                registry_gate_fn=fake_registry_gate,
                case_evidence_fn=fake_evidence,
                visible_fn=lambda _suggestion: "visible",
            )
        )
        assert infra["passed"] is False
        assert infra["failure_mode"] == "infrastructure"
        assert "registry offline" in infra["error"]

    print("PASS v14 live round sweeps past deterministic card failures")
    print("PASS v14 one round reports every deterministic bad fixture together")
    print("PASS v14 infrastructure failures still abort immediately")


def self_test() -> int:
    # First prove v13 exactly as it existed before this incident fix.
    assert v13.self_test() == 0

    original_budgets = dict(v12.PINNED_EXPANSION_BUDGETS)
    original_ceilings = dict(v12.PREFLIGHT_REGISTRY_CALL_CEILINGS)
    original_run_round = v11.v3.v2.run_round
    try:
        _install_backfill_pool()
        assert PINNED_BACKFILL_POOL_SIZES[10] > REQUIRED_NEW_FIXTURES[10]
        assert PINNED_BACKFILL_POOL_SIZES[15] > REQUIRED_NEW_FIXTURES[15]
        assert PINNED_BACKFILL_POOL_SIZES[25] >= REQUIRED_NEW_FIXTURES[25]

        frozen10 = v12._wanted_pinned_row_ids(10)
        frozen15 = v12._wanted_pinned_row_ids(15)
        frozen25 = v12._wanted_pinned_row_ids(25)

        assert len(frozen10) == 8
        assert len(frozen15) == 15
        assert len(frozen25) == 20
        # The original priority order is untouched. The only change is that
        # later pins are now available as replacements after a safety reject.
        assert frozen10[:5] == v12.PINNED_EXPANSION_ROW_IDS[:5]
        assert frozen10[5:] == v12.PINNED_EXPANSION_ROW_IDS[5:8]
        assert frozen15[:8] == frozen10
        assert frozen25[:15] == frozen15
        assert v12.PREFLIGHT_REGISTRY_CALL_CEILINGS == {10: 24, 15: 45, 25: 60}

        _install_contract()
        assert v11.v3.v2.run_round is run_round_exhaustive
        _self_test_exhaustive_round()
    finally:
        v12.PINNED_EXPANSION_BUDGETS = original_budgets
        v12.PREFLIGHT_REGISTRY_CALL_CEILINGS = original_ceilings
        v11.v3.v2.run_round = original_run_round

    print("PASS v14 Frozen 10 preserves the original five pinned priorities")
    print("PASS v14 Frozen 10 exposes three deterministic replacement pins after a safety reject")
    print("PASS v14 Frozen 15/25 preserve the exact nested pinned priority prefix")
    print("PASS v14 changes fixture availability only; v13 throttle and all fail-closed gates remain inherited")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()

    _install_contract()
    try:
        return v12.main()
    except v13.RegistryThrottleAbort as error:
        print(f"REGISTRY THROTTLE ABORT: {error}", file=sys.stderr, flush=True)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
