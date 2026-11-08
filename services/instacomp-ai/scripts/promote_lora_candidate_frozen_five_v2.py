#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from typing import Any

import promote_lora_candidate_frozen_five as base


MUTABLE_CANDIDATE_ENV_KEYS = (
    "INSTACOMP_AI_LORA_CANDIDATE_ENABLED",
    "INSTACOMP_AI_LORA_CANDIDATE_URL",
)


def clear_mutable_candidate_env_overrides() -> None:
    """Let post-activation app.config read the newly written protected .env.

    The canonical launcher exports .env so Registry credentials are available to
    this process. That can also export the *pre-activation* LoRA enabled/url
    values. Those two settings are intentionally mutable during this promotion,
    so retaining them in os.environ would outrank pydantic's later .env reload
    after enable-lora-candidate-macos.sh writes enabled=true.
    """
    for key in MUTABLE_CANDIDATE_ENV_KEYS:
        os.environ.pop(key, None)


def receipt_value(registry, prefix: str) -> str | None:
    if registry is None:
        return None
    for value in registry.source_receipts or []:
        text = str(value)
        if text.startswith(prefix):
            return text[len(prefix):]
    return None


def case_evidence(
    item: dict[str, Any],
    suggestion,
    registry,
    case: tuple,
    registry_diagnostics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    reg_dump = registry.model_dump(mode="json") if registry is not None else None
    diagnostics = registry_diagnostics or {}
    return {
        "key": case[0],
        "player": case[1],
        "card_number": case[2],
        "expected_parallel_marker": case[3],
        "expected_registry_identity_id": case[4],
        "expected_registry_fingerprint_sha256": case[5],
        "fixture_row_id": item["row_id"],
        "fixture_split": item["split"],
        "candidate_provider": suggestion.provider,
        "candidate_fallback": bool(suggestion.raw.get("lora_candidate_fallback")),
        "candidate_identity": suggestion.identity.model_dump(mode="json"),
        "candidate_evidence": suggestion.evidence.model_dump(mode="json"),
        "registry_request": diagnostics.get("registry_request"),
        "registry_http_status": diagnostics.get("registry_http_status"),
        "registry_raw_response": diagnostics.get("registry_raw_response"),
        "registry_status": diagnostics.get("registry_status"),
        "registry_resolver_status": diagnostics.get("registry_resolver_status"),
        "registry_reasons": diagnostics.get("registry_reasons"),
        "registry_candidate_count": diagnostics.get("registry_candidate_count"),
        "registry_transport_error": diagnostics.get("registry_transport_error"),
        "registry_result": reg_dump,
        "registry_identity_id": (
            diagnostics.get("registry_identity_id")
            or (registry.identity_id if registry is not None else None)
        ),
        "registry_fingerprint_sha256": (
            diagnostics.get("registry_fingerprint_sha256")
            or receipt_value(registry, "registry_fingerprint:")
        ),
        "passed": False,
    }


async def run_round(
    number: int,
    fixtures: list[dict[str, Any]],
    adapter_sha: str,
) -> dict[str, Any]:
    from app.checklist import checklist_gateway
    from app.config import settings
    from app.local_vision import analyze_local_vision
    from app.ollama import OllamaReader

    if settings.lora_candidate_enabled is not True:
        raise RuntimeError("Candidate setting did not reload enabled")
    reader = OllamaReader(settings)
    cases: list[dict[str, Any]] = []

    for item in fixtures:
        case = item["case"]
        paths = item["images"]
        front = paths[0].read_bytes()
        back = paths[1].read_bytes() if len(paths) > 1 else None
        vision = await analyze_local_vision(front, back, settings)
        suggestion = await reader.analyze(front, back, local_vision=vision)

        try:
            base.suggestion_gate(suggestion.model_dump(mode="json"), adapter_sha)
        except RuntimeError as error:
            evidence = case_evidence(item, suggestion, None, case)
            evidence["error"] = str(error)
            cases.append(evidence)
            return {
                "round": number,
                "passed": False,
                "cases": cases,
                "error": str(error),
            }

        diagnostic_match = getattr(
            checklist_gateway,
            "match_with_diagnostics",
            None,
        )
        if not callable(diagnostic_match):
            error = RuntimeError(
                "Authoritative Registry diagnostic gateway is not installed"
            )
            evidence = case_evidence(item, suggestion, None, case)
            evidence["error"] = str(error)
            cases.append(evidence)
            return {
                "round": number,
                "passed": False,
                "cases": cases,
                "error": str(error),
            }

        try:
            registry, registry_diagnostics = await diagnostic_match(
                suggestion.identity,
                base.visible(suggestion),
            )
        except Exception as error:
            evidence = case_evidence(item, suggestion, None, case)
            evidence["error"] = (
                "Registry diagnostic request raised "
                f"{type(error).__name__}: {error}"
            )
            cases.append(evidence)
            return {
                "round": number,
                "passed": False,
                "cases": cases,
                "error": evidence["error"],
            }

        evidence = case_evidence(
            item,
            suggestion,
            registry,
            case,
            registry_diagnostics,
        )
        try:
            base.registry_gate(registry.model_dump(mode="json"), case)
        except RuntimeError as error:
            evidence["error"] = str(error)
            cases.append(evidence)
            print(
                f"ROUND {number} FAIL {case[1]} #{case[2]}: {error}; "
                f"candidate={json.dumps(evidence['candidate_identity'], sort_keys=True)}; "
                f"registry_status={evidence['registry_status']!r}; "
                f"resolver_status={evidence['registry_resolver_status']!r}; "
                f"candidate_count={evidence['registry_candidate_count']!r}; "
                f"registry_uuid={evidence['registry_identity_id']!r}; "
                f"registry_fingerprint={evidence['registry_fingerprint_sha256']!r}; "
                f"registry={json.dumps(evidence['registry_result'], sort_keys=True)}",
                flush=True,
            )
            return {
                "round": number,
                "passed": False,
                "cases": cases,
                "error": str(error),
            }

        evidence["passed"] = True
        cases.append(evidence)
        print(
            f"ROUND {number} PASS {case[1]} #{case[2]} "
            f"provider={suggestion.provider} registry={registry.identity_id}",
            flush=True,
        )

    return {"round": number, "passed": len(cases) == 5, "cases": cases}


def self_test() -> int:
    base.self_test()

    saved_candidate_env = {
        key: os.environ.get(key) for key in MUTABLE_CANDIDATE_ENV_KEYS
    }
    try:
        os.environ["INSTACOMP_AI_LORA_CANDIDATE_ENABLED"] = "false"
        os.environ["INSTACOMP_AI_LORA_CANDIDATE_URL"] = "http://127.0.0.1:9999"
        clear_mutable_candidate_env_overrides()
        assert "INSTACOMP_AI_LORA_CANDIDATE_ENABLED" not in os.environ
        assert "INSTACOMP_AI_LORA_CANDIDATE_URL" not in os.environ
    finally:
        for key, value in saved_candidate_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    print("PASS parent candidate environment refresh gate")

    fake_item = {"row_id": "row-1", "split": "validation"}
    fake_case = base.FROZEN[0]

    class FakeModel:
        def __init__(self, value):
            self.value = value

        def model_dump(self, mode="json"):
            return self.value

    class FakeSuggestion:
        provider = base.PROVIDER
        raw = {"lora_candidate_fallback": False}
        identity = FakeModel({"player": "Sonia Citron", "card_number": "122"})
        evidence = FakeModel({"visible_text": ["SONIA CITRON", "122"]})

    class FakeRegistry:
        identity_id = "wrong"
        source_receipts = ["registry_fingerprint:wrong-fingerprint"]

        def model_dump(self, mode="json"):
            return {
                "outcome": "set_present_no_exact_match",
                "identity_id": None,
                "reasons": ["diagnostic"],
            }

    fake_diagnostics = {
        "registry_request": {
            "year": "2025",
            "brand": "Panini",
            "cardNumber": "122",
        },
        "registry_http_status": 200,
        "registry_raw_response": {
            "ok": True,
            "status": "ambiguous",
            "resolverStatus": "ambiguous",
            "candidateCount": 2,
            "reasons": ["diagnostic"],
            "registryIdentityId": None,
            "registryFingerprintSha256": None,
        },
        "registry_status": "ambiguous",
        "registry_resolver_status": "ambiguous",
        "registry_reasons": ["diagnostic"],
        "registry_candidate_count": 2,
        "registry_identity_id": None,
        "registry_fingerprint_sha256": None,
        "registry_transport_error": None,
    }
    record = case_evidence(
        fake_item,
        FakeSuggestion(),
        FakeRegistry(),
        fake_case,
        fake_diagnostics,
    )
    assert record["expected_registry_identity_id"] == fake_case[4]
    assert record["candidate_identity"]["player"] == "Sonia Citron"
    assert record["registry_result"]["reasons"] == ["diagnostic"]
    assert record["registry_request"]["cardNumber"] == "122"
    assert record["registry_http_status"] == 200
    assert record["registry_status"] == "ambiguous"
    assert record["registry_resolver_status"] == "ambiguous"
    assert record["registry_candidate_count"] == 2
    assert record["registry_identity_id"] == "wrong"
    assert record["registry_fingerprint_sha256"] == "wrong-fingerprint"
    print("PASS failed-case candidate and raw Registry diagnostics are retained")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--adapter", type=base.Path)
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if platform.system() != "Darwin":
        raise SystemExit(
            "Frozen-five Production promotion must run on the Apple Silicon Mac."
        )

    # Registry credentials stay inherited from the launcher's protected .env,
    # but the candidate enabled/url keys must not remain frozen at their
    # pre-activation values in this long-running promotion process.
    clear_mutable_candidate_env_overrides()

    receipt, validated, dataset = base.completion_gate()
    adapter = args.adapter.expanduser().resolve() if args.adapter else validated
    if adapter != validated:
        raise SystemExit(
            "Explicit adapter does not match complete_and_validated receipt"
        )
    sha = base.file_sha(adapter / "adapters.safetensors")
    fixtures = base.fixtures(dataset, True)
    print(
        "FROZEN FIVE FIXTURES: "
        + ", ".join(
            f"{item['case'][1]} #{item['case'][2]}"
            f"[{item['split']}:{item['row_id']}]"
            for item in fixtures
        ),
        flush=True,
    )

    started = datetime.now(timezone.utc).timestamp()
    activated = False
    activation = None
    rounds: list[dict[str, Any]] = []
    try:
        subprocess.run(
            ["bash", str(base.ENABLE), str(adapter)],
            cwd=base.REPO_ROOT,
            check=True,
        )
        activated = True
        activation = base.activation_receipt(started, adapter, sha)
        for number in (1, 2):
            round_result = asyncio.run(run_round(number, fixtures, sha))
            rounds.append(round_result)
            if round_result.get("passed") is not True:
                raise RuntimeError(
                    str(
                        round_result.get("error")
                        or f"Round {number} failed"
                    )
                )
        base.rounds_gate(rounds)
    except BaseException as error:
        if activated:
            subprocess.run(
                ["bash", str(base.DISABLE)],
                cwd=base.REPO_ROOT,
                check=False,
            )
        data = {
            "schema_version": "tcos.instacomp-ai.lora-frozen-five-promotion.v2",
            "created_at": base.now(),
            "status": (
                "failed_rolled_back" if activated else "failed_before_activation"
            ),
            "complete": False,
            "adapter": str(adapter),
            "adapter_weights_sha256": sha,
            "dataset": str(dataset),
            "dataset_sha256": receipt.get("dataset_sha256"),
            "rounds": rounds,
            "error_type": type(error).__name__,
            "error": str(error)[:1000],
            "runtime_candidate_enabled_after_failure": (
                False if activated else None
            ),
            "automatic_deployment": False,
        }
        path = base.write_receipt(data)
        print(json.dumps(data, indent=2))
        print(f"FROZEN FIVE FAILURE RECEIPT: {path}")
        if isinstance(error, KeyboardInterrupt):
            raise
        return 2

    data = {
        "schema_version": "tcos.instacomp-ai.lora-frozen-five-promotion.v2",
        "created_at": base.now(),
        "status": "promoted_runtime_candidate",
        "complete": True,
        "adapter": str(adapter),
        "adapter_weights_sha256": sha,
        "validation_receipt": receipt.get("validation_receipt"),
        "dataset": str(dataset),
        "dataset_sha256": receipt.get("dataset_sha256"),
        "activation_receipt": activation.get("_path") if activation else None,
        "registry_resolver": "resolveChecklistRegistry",
        "frozen_five_source": (
            "historical_final_registry_v3_live_proof_"
            "55b0866947a05125371fd9d5554d1f497fbc19ff"
        ),
        "rounds": rounds,
        "passes": 2,
        "cards_per_pass": 5,
        "candidate_fallbacks": 0,
        "critical_regressions": 0,
        "runtime_candidate_enabled": True,
        "registry_remains_identity_authority": True,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    }
    path = base.write_receipt(data)
    print(json.dumps(data, indent=2))
    print(f"FROZEN FIVE PROMOTION RECEIPT: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
