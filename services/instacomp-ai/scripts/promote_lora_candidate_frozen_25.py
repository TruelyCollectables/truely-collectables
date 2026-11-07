#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import subprocess
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import promote_lora_candidate_frozen_five as base
import promote_lora_candidate_frozen_five_v2 as frozen_five_v2


TARGET = 25
ROUNDS = (1, 2)
MAX_PRIMARY_ROWS_PER_PLAYER = 3
RECEIPT_PREFIX = "frozen-25-promotion"
SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v1"


def _valid_uuid(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return str(UUID(text))
    except ValueError:
        return None


def _valid_sha256(value: object) -> str | None:
    text = str(value or "").strip().lower()
    if len(text) != 64 or any(ch not in "0123456789abcdef" for ch in text):
        return None
    return text


def _marker(identity: dict[str, Any]) -> str | None:
    values = [
        base.norm(identity.get("parallel")),
        base.norm(identity.get("variation")),
        base.norm(identity.get("subset")),
        base.norm(identity.get("set_name")),
    ]
    joined = " ".join(value for value in values if value)
    if not joined or joined in {"base", "prizm", "prizm wnba"}:
        return None
    for token in (
        "cracked ice",
        "ice",
        "groovy",
        "silver",
        "green",
        "red",
        "blue",
        "orange",
        "purple",
        "gold",
        "black",
        "velocity",
        "wave",
        "mojo",
        "scope",
        "hyper",
        "pulsar",
    ):
        if token in joined:
            return token
    return joined[:80]


def _row_candidate(row: dict[str, Any], require_images: bool) -> dict[str, Any] | None:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    registry_id = _valid_uuid(metadata.get("registry_identity_id"))
    fingerprint = _valid_sha256(metadata.get("registry_fingerprint_sha256"))
    if registry_id is None or fingerprint is None:
        return None

    try:
        identity = base.identity(row)
    except RuntimeError:
        return None

    player = str(identity.get("player") or "").strip()
    number = str(identity.get("card_number") or "").strip().lstrip("#")
    if not player or not number:
        return None

    images = [Path(str(value)).expanduser().resolve() for value in row.get("images") or []]
    if len(images) < 2:
        return None
    if require_images and any(not path.is_file() for path in images[:2]):
        return None

    split = str(row.get("_split") or "")
    row_id = str(row.get("id") or "").strip()
    if split not in {"train", "validation"} or not row_id:
        return None

    marker = _marker(identity)
    case = (
        f"registry-{registry_id[:8]}-{number}",
        player,
        number,
        marker,
        registry_id,
        fingerprint,
    )
    return {
        "case": case,
        "row_id": row_id,
        "split": split,
        "images": images,
        "identity": identity,
        "marker": marker,
    }


def _sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    identity = item["identity"]
    return (
        0 if item.get("marker") else 1,
        0 if item["split"] == "validation" else 1,
        base.norm(identity.get("player")),
        base.norm(identity.get("card_number")),
        item["row_id"],
    )


def build_frozen_25(dataset: Path, require_images: bool = True) -> list[dict[str, Any]]:
    seeds = base.fixtures(dataset, require_images=require_images)
    selected: list[dict[str, Any]] = []
    used_rows: set[str] = set()
    used_registry_ids: set[str] = set()
    player_counts: Counter[str] = Counter()

    rows = base.load_rows(dataset)
    row_by_id = {str(row["id"]): row for row in rows}

    for seed in seeds:
        row_id = str(seed["row_id"])
        row = row_by_id.get(row_id)
        if row is None:
            raise RuntimeError(f"Frozen Five seed row vanished from dataset: {row_id}")
        item = _row_candidate(row, require_images=require_images)
        if item is None:
            raise RuntimeError(f"Frozen Five seed is not eligible for Frozen 25: {row_id}")

        expected_case = seed["case"]
        if base.norm(item["case"][4]) != base.norm(expected_case[4]):
            raise RuntimeError(f"Frozen Five seed Registry UUID drift: {row_id}")
        if base.norm(item["case"][5]) != base.norm(expected_case[5]):
            raise RuntimeError(f"Frozen Five seed Registry fingerprint drift: {row_id}")

        item["case"] = expected_case
        selected.append(item)
        used_rows.add(row_id)
        used_registry_ids.add(str(expected_case[4]))
        player_counts[base.norm(expected_case[1])] += 1

    extras: list[dict[str, Any]] = []
    for row in rows:
        item = _row_candidate(row, require_images=require_images)
        if item is None:
            continue
        registry_id = str(item["case"][4])
        if item["row_id"] in used_rows or registry_id in used_registry_ids:
            continue
        extras.append(item)

    extras.sort(key=_sort_key)

    deferred: list[dict[str, Any]] = []
    for item in extras:
        if len(selected) >= TARGET:
            break
        player_key = base.norm(item["case"][1])
        if player_counts[player_key] >= MAX_PRIMARY_ROWS_PER_PLAYER:
            deferred.append(item)
            continue
        selected.append(item)
        used_rows.add(item["row_id"])
        used_registry_ids.add(str(item["case"][4]))
        player_counts[player_key] += 1

    if len(selected) < TARGET:
        for item in deferred:
            if len(selected) >= TARGET:
                break
            registry_id = str(item["case"][4])
            if item["row_id"] in used_rows or registry_id in used_registry_ids:
                continue
            selected.append(item)
            used_rows.add(item["row_id"])
            used_registry_ids.add(registry_id)

    if len(selected) != TARGET:
        raise RuntimeError(
            f"Frozen 25 requires {TARGET} distinct Registry-proven two-image fixtures; "
            f"only {len(selected)} qualified."
        )
    if len({item["row_id"] for item in selected}) != TARGET:
        raise RuntimeError("Frozen 25 row IDs are not unique")
    if len({item["case"][4] for item in selected}) != TARGET:
        raise RuntimeError("Frozen 25 Registry UUIDs are not unique")

    return selected


def _registry_gate(registry: dict[str, Any], case: tuple[Any, ...]) -> None:
    base.registry_gate(registry, case)


def _rounds_gate(rounds: list[dict[str, Any]]) -> None:
    if len(rounds) != len(ROUNDS):
        raise RuntimeError("Exactly two Frozen 25 Production rounds are required")
    wanted = {case["key"] for case in rounds[0].get("cases", [])} if rounds else set()
    if len(wanted) != TARGET:
        raise RuntimeError("Frozen 25 first round did not contain exactly 25 unique cases")
    for number, round_result in enumerate(rounds, 1):
        cases = round_result.get("cases")
        if round_result.get("passed") is not True or not isinstance(cases, list):
            raise RuntimeError(f"Frozen 25 round {number} did not pass")
        if len(cases) != TARGET or {case.get("key") for case in cases} != wanted:
            raise RuntimeError(f"Frozen 25 round {number} was not exact 25/25")
        if any(
            case.get("candidate_provider") != base.PROVIDER
            or case.get("candidate_fallback") is True
            or case.get("passed") is not True
            for case in cases
        ):
            raise RuntimeError(f"Frozen 25 round {number} contains fallback/non-candidate evidence")


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
        back = paths[1].read_bytes()
        vision = await analyze_local_vision(front, back, settings)
        suggestion = await reader.analyze(front, back, local_vision=vision)

        try:
            base.suggestion_gate(suggestion.model_dump(mode="json"), adapter_sha)
        except RuntimeError as error:
            evidence = frozen_five_v2.case_evidence(item, suggestion, None, case)
            evidence["error"] = str(error)
            cases.append(evidence)
            return {"round": number, "passed": False, "cases": cases, "error": str(error)}

        diagnostic_match = getattr(checklist_gateway, "match_with_diagnostics", None)
        if not callable(diagnostic_match):
            error = RuntimeError("Authoritative Registry diagnostic gateway is not installed")
            evidence = frozen_five_v2.case_evidence(item, suggestion, None, case)
            evidence["error"] = str(error)
            cases.append(evidence)
            return {"round": number, "passed": False, "cases": cases, "error": str(error)}

        try:
            registry, diagnostics = await diagnostic_match(
                suggestion.identity,
                base.visible(suggestion),
            )
        except Exception as error:
            evidence = frozen_five_v2.case_evidence(item, suggestion, None, case)
            evidence["error"] = f"Registry diagnostic request raised {type(error).__name__}: {error}"
            cases.append(evidence)
            return {"round": number, "passed": False, "cases": cases, "error": evidence["error"]}

        evidence = frozen_five_v2.case_evidence(
            item,
            suggestion,
            registry,
            case,
            diagnostics,
        )
        try:
            _registry_gate(registry.model_dump(mode="json"), case)
        except RuntimeError as error:
            evidence["error"] = str(error)
            cases.append(evidence)
            print(
                f"ROUND {number} FAIL {case[1]} #{case[2]}: {error}; "
                f"registry_status={evidence['registry_status']!r}; "
                f"resolver_status={evidence['registry_resolver_status']!r}; "
                f"registry_uuid={evidence['registry_identity_id']!r}",
                flush=True,
            )
            return {"round": number, "passed": False, "cases": cases, "error": str(error)}

        evidence["passed"] = True
        cases.append(evidence)
        print(
            f"ROUND {number} PASS {case[1]} #{case[2]} "
            f"provider={suggestion.provider} registry={registry.identity_id}",
            flush=True,
        )

    return {"round": number, "passed": len(cases) == TARGET, "cases": cases}


def _write_receipt(data: dict[str, Any]) -> Path:
    base.RECEIPTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = base.RECEIPTS / f"{RECEIPT_PREFIX}-{stamp}.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", "utf-8")
    tmp.replace(path)
    return path


def _fake_row(
    row_id: str,
    image: Path,
    player: str,
    number: str,
    registry_id: str,
    fingerprint: str,
    *,
    split: str,
    parallel: str = "Base",
) -> dict[str, Any]:
    identity = {
        "player": player,
        "year": "2025",
        "brand": "Prizm",
        "set_name": "2025 Panini Prizm WNBA",
        "card_number": number,
        "parallel": parallel,
    }
    return {
        "id": row_id,
        "_split": split,
        "images": [str(image), str(image)],
        "messages": [
            {"content": []},
            {"content": [{"type": "text", "text": json.dumps({"identity": identity})}]},
        ],
        "metadata": {
            "registry_identity_id": registry_id,
            "registry_fingerprint_sha256": fingerprint,
        },
    }


def self_test() -> int:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        image = root / "card.jpg"
        image.write_bytes(b"card")
        rows: list[dict[str, Any]] = []

        for index, case in enumerate(base.FROZEN):
            rows.append(
                _fake_row(
                    f"seed-{index}",
                    image,
                    case[1],
                    case[2],
                    case[4],
                    case[5],
                    split="validation" if index % 2 == 0 else "train",
                    parallel="Prizms Ice" if case[3] == "ice" else ("Groovy" if case[3] == "groovy" else "Base"),
                )
            )

        for index in range(20):
            registry_id = f"00000000-0000-0000-0001-{index:012d}"
            fingerprint = f"{index + 1:064x}"
            rows.append(
                _fake_row(
                    f"extra-{index:02d}",
                    image,
                    f"Player {index:02d}",
                    str(200 + index),
                    registry_id,
                    fingerprint,
                    split="validation" if index % 3 == 0 else "train",
                    parallel=("Silver" if index % 2 == 0 else "Base"),
                )
            )

        train = [row for row in rows if row["_split"] == "train"]
        validation = [row for row in rows if row["_split"] == "validation"]
        for row in rows:
            row.pop("_split", None)
        (root / "train.jsonl").write_text("".join(json.dumps(row) + "\n" for row in train), "utf-8")
        (root / "validation.jsonl").write_text("".join(json.dumps(row) + "\n" for row in validation), "utf-8")

        first = build_frozen_25(root, require_images=True)
        second = build_frozen_25(root, require_images=True)
        assert [item["row_id"] for item in first] == [item["row_id"] for item in second]
        assert len(first) == TARGET
        assert len({item["row_id"] for item in first}) == TARGET
        assert len({item["case"][4] for item in first}) == TARGET
        assert [item["case"][0] for item in first[:5]] == [case[0] for case in base.FROZEN]

        fake_cases = [
            {
                "key": item["case"][0],
                "candidate_provider": base.PROVIDER,
                "candidate_fallback": False,
                "passed": True,
            }
            for item in first
        ]
        _rounds_gate([
            {"passed": True, "cases": fake_cases},
            {"passed": True, "cases": json.loads(json.dumps(fake_cases))},
        ])

        bad = json.loads(json.dumps(fake_cases))
        bad[-1]["candidate_fallback"] = True
        try:
            _rounds_gate([
                {"passed": True, "cases": fake_cases},
                {"passed": True, "cases": bad},
            ])
            raise AssertionError("Frozen 25 fallback was accepted")
        except RuntimeError:
            pass

    print("PASS deterministic Registry-proven Frozen 25 fixture selection")
    print("PASS exact two-round 25/25 gate")
    print("PASS fallback rejection")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--adapter", type=Path)
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if platform.system() != "Darwin":
        raise SystemExit("Frozen 25 Production promotion must run on the Apple Silicon Mac.")

    frozen_five_v2.clear_mutable_candidate_env_overrides()
    receipt, validated, dataset = base.completion_gate()
    adapter = args.adapter.expanduser().resolve() if args.adapter else validated
    if adapter != validated:
        raise SystemExit("Explicit adapter does not match complete_and_validated receipt")

    sha = base.file_sha(adapter / "adapters.safetensors")
    fixtures = build_frozen_25(dataset, require_images=True)
    print(
        "FROZEN 25 FIXTURES: "
        + ", ".join(
            f"{item['case'][1]} #{item['case'][2]}[{item['split']}:{item['row_id']}]"
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
        for number in ROUNDS:
            result = asyncio.run(run_round(number, fixtures, sha))
            rounds.append(result)
            if result.get("passed") is not True:
                raise RuntimeError(str(result.get("error") or f"Round {number} failed"))
        _rounds_gate(rounds)
    except BaseException as error:
        if activated:
            subprocess.run(["bash", str(base.DISABLE)], cwd=base.REPO_ROOT, check=False)
        data = {
            "schema_version": SCHEMA,
            "created_at": base.now(),
            "status": "failed_rolled_back" if activated else "failed_before_activation",
            "complete": False,
            "adapter": str(adapter),
            "adapter_weights_sha256": sha,
            "dataset": str(dataset),
            "dataset_sha256": receipt.get("dataset_sha256"),
            "rounds": rounds,
            "error_type": type(error).__name__,
            "error": str(error)[:1000],
            "runtime_candidate_enabled_after_failure": False if activated else None,
            "automatic_deployment": False,
        }
        path = _write_receipt(data)
        print(json.dumps(data, indent=2))
        print(f"FROZEN 25 FAILURE RECEIPT: {path}")
        if isinstance(error, KeyboardInterrupt):
            raise
        return 2

    data = {
        "schema_version": SCHEMA,
        "created_at": base.now(),
        "status": "promoted_runtime_candidate_frozen_25",
        "complete": True,
        "adapter": str(adapter),
        "adapter_weights_sha256": sha,
        "validation_receipt": receipt.get("validation_receipt"),
        "dataset": str(dataset),
        "dataset_sha256": receipt.get("dataset_sha256"),
        "activation_receipt": activation.get("_path") if activation else None,
        "registry_resolver": "resolveChecklistRegistry",
        "rounds": rounds,
        "passes": len(ROUNDS),
        "cards_per_pass": TARGET,
        "candidate_fallbacks": 0,
        "critical_regressions": 0,
        "runtime_candidate_enabled": True,
        "registry_remains_identity_authority": True,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    }
    path = _write_receipt(data)
    print(json.dumps(data, indent=2))
    print(f"FROZEN 25 PROMOTION RECEIPT: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
