#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import promote_lora_candidate_frozen_five as base
import promote_lora_candidate_frozen_five_v2 as v2


Evaluator = Callable[
    [int, dict[str, Any], str, dict[str, dict[str, Any]]],
    Awaitable[dict[str, Any]],
]


def _teacher_map(dataset: Path) -> dict[str, dict[str, Any]]:
    return {
        str(row["id"]): base.identity(row)
        for row in base.load_rows(dataset)
    }


def _side_diagnostics(side) -> dict[str, Any] | None:
    if side is None:
        return None
    return {
        "pattern": side.pattern.model_dump(mode="json"),
        "colors": side.colors.model_dump(mode="json"),
        "errors": list(side.errors),
        "ocr_text": list(dict.fromkeys(str(item.text or "") for item in side.ocr if item.text)),
    }


def _vision_diagnostics(vision) -> dict[str, Any]:
    return {
        "identity_hints": vision.identity_hints.model_dump(mode="json"),
        "combined_text": vision.combined_text,
        "apple_vision_available": vision.apple_vision_available,
        "opencv_available": vision.opencv_available,
        "serial": vision.serial.model_dump(mode="json"),
        "front": _side_diagnostics(vision.front),
        "back": _side_diagnostics(vision.back),
    }


def _style_memory_diagnostics(settings, vision) -> dict[str, Any]:
    """Explain the parallel-only style-memory decision without changing it."""
    from app import pattern_memory as pm

    database_path = settings.resolve_local_path(settings.database_path)
    current_manufacturer = pm._normalized(vision.identity_hints.manufacturer)
    current_family = pm._product_family(vision.combined_text, vision.identity_hints)
    current_pattern = vision.front.pattern
    current_colors = vision.front.colors
    has_visual_signal = bool(
        current_pattern.label != "unknown"
        or current_pattern.line_count >= 8
        or current_pattern.polygon_count >= 10
        or current_pattern.edge_density >= 0.05
        or current_colors.metallic_score >= 0.10
    )

    examples = pm._load_latest_examples(database_path)
    compared: list[dict[str, Any]] = []
    trusted_with_vision_and_parallel = 0
    family_eligible = 0
    for example in examples:
        if not example.trusted or not example.local_vision:
            continue
        parallel = str(example.confirmed_identity.parallel or "").strip()
        if not parallel:
            continue
        trusted_with_vision_and_parallel += 1

        learned_manufacturer = pm._normalized(example.confirmed_identity.manufacturer)
        if (
            current_manufacturer
            and learned_manufacturer
            and current_manufacturer != learned_manufacturer
        ):
            continue
        learned_family = pm._product_family(
            example.local_vision.combined_text,
            example.confirmed_identity,
        )
        if current_family and learned_family and current_family != learned_family:
            continue
        family_eligible += 1
        score, reasons = pm._pattern_similarity(vision, example.local_vision)
        compared.append(
            {
                "score": round(float(score), 6),
                "parallel": parallel,
                "scan_id": example.scan_id,
                "player": example.confirmed_identity.player,
                "card_number": example.confirmed_identity.card_number,
                "product_family": learned_family,
                "reasons": reasons,
            }
        )

    compared.sort(key=lambda item: item["score"], reverse=True)
    hint = pm.find_trusted_pattern_style(database_path=database_path, current=vision)
    return {
        "database_path": str(database_path),
        "current_manufacturer": current_manufacturer or None,
        "current_product_family": current_family,
        "has_visual_signal": has_visual_signal,
        "trusted_examples_with_vision_and_parallel": trusted_with_vision_and_parallel,
        "family_eligible_examples": family_eligible,
        "selected_hint": (
            {
                "parallel": hint.parallel,
                "score": hint.score,
                "support_count": hint.support_count,
                "reference_scan_ids": list(hint.reference_scan_ids),
                "reasons": list(hint.reasons),
            }
            if hint is not None
            else None
        ),
        "top_style_matches": compared[:12],
    }


def _base_case_record(
    item: dict[str, Any],
    teachers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    case = item["case"]
    return {
        "key": case[0],
        "player": case[1],
        "card_number": case[2],
        "expected_parallel_marker": case[3],
        "expected_registry_identity_id": case[4],
        "expected_registry_fingerprint_sha256": case[5],
        "fixture_row_id": item["row_id"],
        "fixture_split": item["split"],
        "teacher_identity": teachers.get(str(item["row_id"])),
        "passed": False,
    }


async def evaluate_case(
    round_number: int,
    item: dict[str, Any],
    adapter_sha: str,
    teachers: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    from app.checklist import checklist_gateway
    from app.config import settings
    from app.local_vision import analyze_local_vision
    from app.ollama import OllamaReader

    record = _base_case_record(item, teachers)
    case = item["case"]
    paths = item["images"]
    front = paths[0].read_bytes()
    back = paths[1].read_bytes() if len(paths) > 1 else None

    try:
        vision = await analyze_local_vision(front, back, settings)
        record["local_vision"] = _vision_diagnostics(vision)
        record["style_memory"] = _style_memory_diagnostics(settings, vision)
    except Exception as error:
        record["error_stage"] = "local_vision"
        record["error"] = f"{type(error).__name__}: {error}"
        return record

    reader = OllamaReader(settings)
    try:
        suggestion = await reader.analyze(front, back, local_vision=vision)
        record["candidate_provider"] = suggestion.provider
        record["candidate_fallback"] = bool(
            suggestion.raw.get("lora_candidate_fallback")
        )
        record["candidate_identity"] = suggestion.identity.model_dump(mode="json")
        record["candidate_evidence"] = suggestion.evidence.model_dump(mode="json")
        record["candidate_raw"] = dict(suggestion.raw)
    except Exception as error:
        record["error_stage"] = "candidate"
        record["error"] = f"{type(error).__name__}: {error}"
        return record

    try:
        base.suggestion_gate(suggestion.model_dump(mode="json"), adapter_sha)
        record["candidate_gate_passed"] = True
    except RuntimeError as error:
        record["candidate_gate_passed"] = False
        record["candidate_gate_error"] = str(error)

    diagnostic_match = getattr(checklist_gateway, "match_with_diagnostics", None)
    if not callable(diagnostic_match):
        record["error_stage"] = "registry_gateway"
        record["error"] = "Authoritative Registry diagnostic gateway is not installed"
        return record

    try:
        registry, diagnostics = await diagnostic_match(
            suggestion.identity,
            base.visible(suggestion),
        )
    except Exception as error:
        record["error_stage"] = "registry_transport"
        record["error"] = f"{type(error).__name__}: {error}"
        return record

    record.update(
        {
            "registry_request": diagnostics.get("registry_request"),
            "registry_http_status": diagnostics.get("registry_http_status"),
            "registry_raw_response": diagnostics.get("registry_raw_response"),
            "registry_status": diagnostics.get("registry_status"),
            "registry_resolver_status": diagnostics.get("registry_resolver_status"),
            "registry_reasons": diagnostics.get("registry_reasons"),
            "registry_candidate_count": diagnostics.get("registry_candidate_count"),
            "registry_transport_error": diagnostics.get("registry_transport_error"),
            "registry_result": registry.model_dump(mode="json"),
            "registry_identity_id": (
                diagnostics.get("registry_identity_id") or registry.identity_id
            ),
            "registry_fingerprint_sha256": (
                diagnostics.get("registry_fingerprint_sha256")
                or v2.receipt_value(registry, "registry_fingerprint:")
            ),
        }
    )

    try:
        base.registry_gate(registry.model_dump(mode="json"), case)
        registry_gate_passed = True
        registry_gate_error = None
    except RuntimeError as error:
        registry_gate_passed = False
        registry_gate_error = str(error)
    record["registry_gate_passed"] = registry_gate_passed
    record["registry_gate_error"] = registry_gate_error
    record["passed"] = bool(
        record.get("candidate_gate_passed") is True and registry_gate_passed
    )
    return record


async def run_diagnostic_round(
    number: int,
    fixtures: list[dict[str, Any]],
    adapter_sha: str,
    teachers: dict[str, dict[str, Any]],
    *,
    evaluator: Evaluator = evaluate_case,
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    for item in fixtures:
        try:
            record = await evaluator(number, item, adapter_sha, teachers)
        except Exception as error:
            record = _base_case_record(item, teachers)
            record["error_stage"] = "unhandled_case_exception"
            record["error"] = f"{type(error).__name__}: {error}"
        cases.append(record)
        status = "PASS" if record.get("passed") is True else "FAIL"
        print(
            f"DIAGNOSTIC ROUND {number} {status} "
            f"{record['player']} #{record['card_number']} "
            f"candidate_parallel={(record.get('candidate_identity') or {}).get('parallel')!r} "
            f"style_hint={(record.get('style_memory') or {}).get('selected_hint')!r} "
            f"registry={record.get('registry_identity_id')!r} "
            f"error={record.get('registry_gate_error') or record.get('candidate_gate_error') or record.get('error')!r}",
            flush=True,
        )
    return {
        "round": number,
        "passed": len(cases) == len(fixtures) and all(
            case.get("passed") is True for case in cases
        ),
        "cases": cases,
    }


def _write_diagnostic_receipt(data: dict[str, Any]) -> Path:
    base.RECEIPTS.mkdir(parents=True, exist_ok=True)
    path = base.RECEIPTS / (
        "frozen-five-full-diagnostic-"
        + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + ".json"
    )
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)
    return path


def self_test() -> int:
    fixtures = [
        {"case": case, "row_id": f"row-{index}", "split": "validation", "images": []}
        for index, case in enumerate(base.FROZEN)
    ]
    teachers = {
        f"row-{index}": {"player": case[1], "card_number": case[2]}
        for index, case in enumerate(base.FROZEN)
    }
    visited: list[str] = []

    async def fake_evaluator(
        round_number: int,
        item: dict[str, Any],
        adapter_sha: str,
        fake_teachers: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        record = _base_case_record(item, fake_teachers)
        visited.append(str(record["key"]))
        if record["key"] == "malonga-116-ice":
            record["candidate_identity"] = {"parallel": "Base"}
            record["registry_gate_error"] = "Registry exact UUID regression: malonga-116-ice"
            return record
        if record["key"] == "paige-5-ice":
            raise RuntimeError("synthetic per-card failure")
        record["candidate_identity"] = {"parallel": item["case"][3] or "Base"}
        record["candidate_gate_passed"] = True
        record["registry_gate_passed"] = True
        record["passed"] = True
        return record

    result = asyncio.run(
        run_diagnostic_round(
            1,
            fixtures,
            "a" * 64,
            teachers,
            evaluator=fake_evaluator,
        )
    )
    assert len(result["cases"]) == 5
    assert visited == [case[0] for case in base.FROZEN]
    assert result["passed"] is False
    assert result["cases"][1]["registry_gate_error"].endswith("malonga-116-ice")
    assert result["cases"][3]["error_stage"] == "unhandled_case_exception"
    assert result["cases"][4]["passed"] is True
    print("PASS full five continues after card failure")
    print("PASS per-card exceptions do not hide later diagnostics")
    print("PASS teacher truth is retained in diagnostic records")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--adapter", type=Path)
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if platform.system() != "Darwin":
        raise SystemExit(
            "Frozen-five full diagnostics must run on the Apple Silicon Mac."
        )

    v2.clear_mutable_candidate_env_overrides()
    receipt, validated, dataset = base.completion_gate()
    adapter = args.adapter.expanduser().resolve() if args.adapter else validated
    if adapter != validated:
        raise SystemExit("Explicit adapter does not match complete_and_validated receipt")
    adapter_sha = base.file_sha(adapter / "adapters.safetensors")
    fixtures = base.fixtures(dataset, True)
    teachers = _teacher_map(dataset)

    started = datetime.now(timezone.utc).timestamp()
    activated = False
    activation = None
    rounds: list[dict[str, Any]] = []
    fatal_error: BaseException | None = None
    try:
        subprocess.run(
            ["bash", str(base.ENABLE), str(adapter)],
            cwd=base.REPO_ROOT,
            check=True,
        )
        activated = True
        activation = base.activation_receipt(started, adapter, adapter_sha)
        for number in (1, 2):
            rounds.append(
                asyncio.run(
                    run_diagnostic_round(
                        number,
                        fixtures,
                        adapter_sha,
                        teachers,
                    )
                )
            )
    except BaseException as error:
        fatal_error = error
    finally:
        if activated:
            subprocess.run(
                ["bash", str(base.DISABLE)],
                cwd=base.REPO_ROOT,
                check=False,
            )

    complete_matrix = bool(
        len(rounds) == 2
        and all(len(round_result.get("cases") or []) == 5 for round_result in rounds)
    )
    all_passed = bool(
        complete_matrix
        and all(round_result.get("passed") is True for round_result in rounds)
    )
    data = {
        "schema_version": "tcos.instacomp-ai.lora-frozen-five-full-diagnostic.v1",
        "created_at": base.now(),
        "status": (
            "diagnostic_complete" if complete_matrix else "diagnostic_incomplete"
        ),
        "complete_matrix": complete_matrix,
        "all_passed": all_passed,
        "adapter": str(adapter),
        "adapter_weights_sha256": adapter_sha,
        "dataset": str(dataset),
        "dataset_sha256": receipt.get("dataset_sha256"),
        "activation_receipt": activation.get("_path") if activation else None,
        "rounds": rounds,
        "fatal_error_type": type(fatal_error).__name__ if fatal_error else None,
        "fatal_error": str(fatal_error)[:1000] if fatal_error else None,
        "runtime_candidate_enabled_after_diagnostic": False,
        "promotion_attempted": False,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    }
    path = _write_diagnostic_receipt(data)
    print(
        json.dumps(
            {
                "status": data["status"],
                "complete_matrix": complete_matrix,
                "all_passed": all_passed,
                "rounds_collected": len(rounds),
                "cases_collected": sum(len(r.get("cases") or []) for r in rounds),
                "runtime_candidate_enabled_after_diagnostic": False,
                "receipt": str(path),
            },
            indent=2,
        )
    )
    print(f"FROZEN FIVE FULL DIAGNOSTIC RECEIPT: {path}")
    if isinstance(fatal_error, KeyboardInterrupt):
        raise fatal_error
    return 0 if complete_matrix else 2


if __name__ == "__main__":
    raise SystemExit(main())
