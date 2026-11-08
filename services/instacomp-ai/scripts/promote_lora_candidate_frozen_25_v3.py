#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import platform
import subprocess
import sys
import tempfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import promote_lora_candidate_frozen_25 as legacy
import promote_lora_candidate_frozen_25_v2 as v2
import promote_lora_candidate_frozen_five as base
import promote_lora_candidate_frozen_five_v2 as frozen_five_v2

TARGET = legacy.TARGET
ROUNDS = legacy.ROUNDS
SCHEMA = "tcos.instacomp-ai.lora-frozen-25-promotion.v3"
RegistryMatch = Callable[[Any, str | None], Awaitable[Any]]


def _expansion_candidate(row: dict[str, Any], *, require_images: bool) -> dict[str, Any] | None:
    try:
        identity = base.identity(row)
    except RuntimeError:
        return None

    player = str(identity.get("player") or "").strip()
    number = str(identity.get("card_number") or "").strip().lstrip("#")
    if not player or not number:
        return None

    images = [Path(str(value)).expanduser().resolve() for value in row.get("images") or []]
    if not images:
        return None
    if require_images and any(not path.is_file() for path in images):
        return None

    split = str(row.get("_split") or "")
    row_id = str(row.get("id") or "").strip()
    if split not in {"train", "validation"} or not row_id:
        return None

    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    raw_registry_id = str(metadata.get("registry_identity_id") or "").strip()
    raw_fingerprint = str(metadata.get("registry_fingerprint_sha256") or "").strip().lower()
    if raw_registry_id and legacy._valid_uuid(raw_registry_id) is None:
        return None
    if raw_fingerprint and legacy._valid_sha256(raw_fingerprint) is None:
        return None

    return {
        "row_id": row_id,
        "split": split,
        "images": images,
        "identity": identity,
        "marker": legacy._marker(identity),
        "metadata_registry_id": legacy._valid_uuid(raw_registry_id),
        "metadata_fingerprint": legacy._valid_sha256(raw_fingerprint),
    }


def _expansion_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    identity = item["identity"]
    return (
        0 if len(item["images"]) >= 2 else 1,
        0 if item.get("marker") else 1,
        0 if item["split"] == "validation" else 1,
        base.norm(identity.get("player")),
        base.norm(identity.get("card_number")),
        item["row_id"],
    )


def _registry_fingerprint(registry: Any) -> str | None:
    receipts = getattr(registry, "source_receipts", None) or []
    for receipt in receipts:
        text = str(receipt or "")
        if text.startswith("registry_fingerprint:"):
            return legacy._valid_sha256(text.split(":", 1)[1])
    return None


def _registry_identity_matches_teacher(teacher: dict[str, Any], registry: Any) -> bool:
    locked = getattr(registry, "identity", None)
    if locked is None:
        return False
    locked_payload = locked.model_dump(mode="json") if hasattr(locked, "model_dump") else dict(locked)
    if base.norm(locked_payload.get("player")) != base.norm(teacher.get("player")):
        return False
    if base.norm(locked_payload.get("card_number")).lstrip("#") != base.norm(teacher.get("card_number")).lstrip("#"):
        return False

    marker = legacy._marker(teacher)
    if marker:
        registry_variants = " ".join(
            base.norm(locked_payload.get(key))
            for key in ("brand", "set_name", "subset", "parallel", "variation")
        )
        if marker not in registry_variants:
            return False
    return True


def _locked_expansion(item: dict[str, Any], registry: Any) -> dict[str, Any] | None:
    from app.models import ChecklistOutcome

    if getattr(registry, "outcome", None) != ChecklistOutcome.EXACT_MATCH:
        return None
    registry_id = legacy._valid_uuid(getattr(registry, "identity_id", None))
    fingerprint = _registry_fingerprint(registry)
    if registry_id is None or fingerprint is None:
        return None
    if not _registry_identity_matches_teacher(item["identity"], registry):
        return None

    metadata_registry_id = item.get("metadata_registry_id")
    metadata_fingerprint = item.get("metadata_fingerprint")
    if metadata_registry_id and base.norm(metadata_registry_id) != base.norm(registry_id):
        return None
    if metadata_fingerprint and base.norm(metadata_fingerprint) != base.norm(fingerprint):
        return None

    player = str(item["identity"].get("player") or "").strip()
    number = str(item["identity"].get("card_number") or "").strip().lstrip("#")
    locked = dict(item)
    locked["case"] = (
        f"registry-{registry_id[:8]}-{number}",
        player,
        number,
        item.get("marker"),
        registry_id,
        fingerprint,
    )
    locked["registry_lock_source"] = "live_authoritative_registry_preflight"
    return locked


async def build_frozen_25_live(
    dataset: Path,
    *,
    require_images: bool = True,
    registry_match: RegistryMatch | None = None,
) -> list[dict[str, Any]]:
    from app.models import CardIdentity

    if registry_match is None:
        from app.checklist import checklist_gateway

        registry_match = checklist_gateway.match

    seeds = base.fixtures(dataset, require_images=require_images)
    rows = base.load_rows(dataset)
    row_by_id = {str(row["id"]): row for row in rows}

    selected: list[dict[str, Any]] = []
    used_rows: set[str] = set()
    used_registry_ids: set[str] = set()
    player_counts: Counter[str] = Counter()

    for seed in seeds:
        row_id = str(seed["row_id"])
        row = row_by_id.get(row_id)
        if row is None:
            raise RuntimeError(f"Frozen Five seed row vanished from dataset: {row_id}")
        item = v2._seed_candidate(row, seed, require_images=require_images)
        selected.append(item)
        used_rows.add(row_id)
        used_registry_ids.add(str(item["case"][4]))
        player_counts[base.norm(item["case"][1])] += 1

    candidates: list[dict[str, Any]] = []
    for row in rows:
        if str(row.get("id") or "") in used_rows:
            continue
        item = _expansion_candidate(row, require_images=require_images)
        if item is not None:
            candidates.append(item)
    candidates.sort(key=_expansion_sort_key)

    diagnostics = {
        "candidate_rows": len(candidates),
        "registry_exact_locks": 0,
        "registry_non_exact_or_error": 0,
        "metadata_conflicts_or_identity_drift": 0,
        "duplicate_registry_ids": 0,
        "selected_expansion": 0,
    }
    deferred: list[dict[str, Any]] = []

    for item in candidates:
        try:
            teacher = CardIdentity.model_validate(item["identity"])
            registry = await registry_match(teacher, None)
        except Exception as error:
            diagnostics["registry_non_exact_or_error"] += 1
            print(
                f"FROZEN 25 PREFLIGHT SKIP {item['identity'].get('player')} "
                f"#{item['identity'].get('card_number')}: Registry request raised "
                f"{type(error).__name__}: {error}",
                flush=True,
            )
            continue

        locked = _locked_expansion(item, registry)
        if locked is None:
            outcome = getattr(getattr(registry, "outcome", None), "value", getattr(registry, "outcome", None))
            if outcome == "exact_match":
                diagnostics["metadata_conflicts_or_identity_drift"] += 1
            else:
                diagnostics["registry_non_exact_or_error"] += 1
            print(
                f"FROZEN 25 PREFLIGHT SKIP {item['identity'].get('player')} "
                f"#{item['identity'].get('card_number')}: live Registry did not produce a compatible exact lock",
                flush=True,
            )
            continue

        diagnostics["registry_exact_locks"] += 1
        registry_id = str(locked["case"][4])
        if registry_id in used_registry_ids:
            diagnostics["duplicate_registry_ids"] += 1
            continue

        player_key = base.norm(locked["case"][1])
        if player_counts[player_key] >= legacy.MAX_PRIMARY_ROWS_PER_PLAYER:
            deferred.append(locked)
            continue

        selected.append(locked)
        used_rows.add(locked["row_id"])
        used_registry_ids.add(registry_id)
        player_counts[player_key] += 1
        diagnostics["selected_expansion"] += 1
        print(
            f"FROZEN 25 PREFLIGHT PASS {locked['case'][1]} #{locked['case'][2]} "
            f"images={len(locked['images'])} registry={registry_id}",
            flush=True,
        )
        if len(selected) >= TARGET:
            break

    if len(selected) < TARGET:
        for locked in deferred:
            if len(selected) >= TARGET:
                break
            registry_id = str(locked["case"][4])
            if locked["row_id"] in used_rows or registry_id in used_registry_ids:
                continue
            selected.append(locked)
            used_rows.add(locked["row_id"])
            used_registry_ids.add(registry_id)
            diagnostics["selected_expansion"] += 1
            print(
                f"FROZEN 25 PREFLIGHT PASS {locked['case'][1]} #{locked['case'][2]} "
                f"images={len(locked['images'])} registry={registry_id} deferred_player_cap=true",
                flush=True,
            )

    if len(selected) != TARGET:
        raise RuntimeError(
            "Frozen 25 live preflight could not lock enough real training fixtures before activation: "
            f"selected={len(selected)} required={TARGET} diagnostics={json.dumps(diagnostics, sort_keys=True)}"
        )
    if len({item["row_id"] for item in selected}) != TARGET:
        raise RuntimeError("Frozen 25 row IDs are not unique after live preflight")
    if len({item["case"][4] for item in selected}) != TARGET:
        raise RuntimeError("Frozen 25 Registry UUIDs are not unique after live preflight")

    print(f"FROZEN 25 PREFLIGHT COMPLETE {json.dumps(diagnostics, sort_keys=True)}", flush=True)
    return selected


def _write_dataset(root: Path, rows: list[dict[str, Any]]) -> None:
    train = [row for row in rows if row["_split"] == "train"]
    validation = [row for row in rows if row["_split"] == "validation"]
    for row in rows:
        row.pop("_split", None)
    (root / "train.jsonl").write_text("".join(json.dumps(row) + "\n" for row in train), "utf-8")
    (root / "validation.jsonl").write_text("".join(json.dumps(row) + "\n" for row in validation), "utf-8")


def self_test() -> int:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        image = root / "card.jpg"
        image.write_bytes(b"card")
        rows: list[dict[str, Any]] = []
        locks: dict[tuple[str, str], tuple[str, str]] = {}

        for index, case in enumerate(base.FROZEN):
            row = legacy._fake_row(
                f"seed-{index}",
                image,
                case[1],
                case[2],
                case[4],
                case[5],
                split="validation" if index % 2 == 0 else "train",
                parallel="Prizms Ice" if case[3] == "ice" else ("Groovy" if case[3] == "groovy" else "Base"),
            )
            if index == 1:
                row["images"] = [str(image)]
                row["metadata"] = {}
            rows.append(row)

        conflict = legacy._fake_row(
            "a-conflict",
            image,
            "Conflict Player",
            "199",
            "00000000-0000-0000-0009-000000000001",
            "f" * 64,
            split="validation",
        )
        conflict["images"] = [str(image)]
        rows.append(conflict)
        locks[("conflict player", "199")] = (
            "00000000-0000-0000-0008-000000000001",
            "e" * 64,
        )

        for index in range(20):
            registry_id = f"00000000-0000-0000-0007-{index:012d}"
            fingerprint = f"{index + 1:064x}"
            row = legacy._fake_row(
                f"extra-{index:02d}",
                image,
                f"Player {index:02d}",
                str(200 + index),
                registry_id,
                fingerprint,
                split="validation" if index % 3 == 0 else "train",
                parallel=("Silver" if index % 2 == 0 else "Base"),
            )
            row["metadata"] = {}
            if index % 2:
                row["images"] = [str(image)]
            rows.append(row)
            locks[(f"player {index:02d}", str(200 + index))] = (registry_id, fingerprint)

        _write_dataset(root, rows)

        async def fake_match(identity: CardIdentity, _ocr: str | None) -> ChecklistResult:
            key = (base.norm(identity.player), base.norm(identity.card_number).lstrip("#"))
            lock = locks.get(key)
            if lock is None:
                return ChecklistResult(outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH)
            registry_id, fingerprint = lock
            return ChecklistResult(
                outcome=ChecklistOutcome.EXACT_MATCH,
                identity_id=registry_id,
                identity=identity,
                candidate_count=1,
                source_receipts=[
                    f"registry_identity:{registry_id}",
                    f"registry_fingerprint:{fingerprint}",
                ],
            )

        first = asyncio.run(build_frozen_25_live(root, require_images=True, registry_match=fake_match))
        second = asyncio.run(build_frozen_25_live(root, require_images=True, registry_match=fake_match))
        assert [item["row_id"] for item in first] == [item["row_id"] for item in second]
        assert len(first) == TARGET
        assert len({item["row_id"] for item in first}) == TARGET
        assert len({item["case"][4] for item in first}) == TARGET
        assert first[1]["row_id"] == "seed-1" and len(first[1]["images"]) == 1
        assert "a-conflict" not in {item["row_id"] for item in first}
        assert any(len(item["images"]) == 1 for item in first[5:])
        assert all(item.get("registry_lock_source") == "live_authoritative_registry_preflight" for item in first[5:])

        fake_cases = [
            {
                "key": item["case"][0],
                "candidate_provider": base.PROVIDER,
                "candidate_fallback": False,
                "passed": True,
            }
            for item in first
        ]
        legacy._rounds_gate([
            {"passed": True, "cases": fake_cases},
            {"passed": True, "cases": json.loads(json.dumps(fake_cases))},
        ])

    print("PASS real-dataset-style extras may omit stale row-local Registry receipts")
    print("PASS one-image expansion fixtures require live exact Registry locks")
    print("PASS conflicting row-local Registry metadata still fails closed")
    print("PASS deterministic live-locked exact two-round 25/25 contract")
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
    fixtures = asyncio.run(build_frozen_25_live(dataset, require_images=True))
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
            result = asyncio.run(v2.run_round(number, fixtures, sha))
            rounds.append(result)
            if result.get("passed") is not True:
                raise RuntimeError(str(result.get("error") or f"Round {number} failed"))
        legacy._rounds_gate(rounds)
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
            "error": str(error)[:2000],
            "runtime_candidate_enabled_after_failure": False if activated else None,
            "automatic_deployment": False,
        }
        path = legacy._write_receipt(data)
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
        "registry_resolver": "live_authoritative_registry_preflight_then_round_relock",
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
    path = legacy._write_receipt(data)
    print(json.dumps(data, indent=2))
    print(f"FROZEN 25 PROMOTION RECEIPT: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
