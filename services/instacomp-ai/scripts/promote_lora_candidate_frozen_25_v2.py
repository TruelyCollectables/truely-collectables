#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import promote_lora_candidate_frozen_25 as legacy
import promote_lora_candidate_frozen_five as base
import promote_lora_candidate_frozen_five_v2 as frozen_five_v2


def _seed_candidate(
    row: dict[str, Any],
    seed: dict[str, Any],
    *,
    require_images: bool,
) -> dict[str, Any]:
    case = seed["case"]
    row_id = str(seed["row_id"])

    if not base.matches(row, case):
        raise RuntimeError(f"Frozen Five seed identity drift: {row_id}")

    identity = base.identity(row)
    images = [Path(str(value)).expanduser().resolve() for value in row.get("images") or []]
    if not images:
        raise RuntimeError(f"Frozen Five seed has no images: {row_id}")
    if require_images and any(not path.is_file() for path in images):
        raise RuntimeError(f"Frozen Five seed image missing: {row_id}")

    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    raw_registry_id = str(metadata.get("registry_identity_id") or "").strip()
    raw_fingerprint = str(metadata.get("registry_fingerprint_sha256") or "").strip()

    # Frozen Five predates the stricter Frozen 25 training-row metadata contract.
    # Missing seed metadata is therefore allowed, because the hard-coded Frozen Five
    # case plus the live authoritative Registry is the identity proof. If seed metadata
    # is present, however, it must agree exactly with the proven Frozen Five identity.
    if raw_registry_id:
        registry_id = legacy._valid_uuid(raw_registry_id)
        if registry_id is None or base.norm(registry_id) != base.norm(case[4]):
            raise RuntimeError(f"Frozen Five seed Registry UUID drift: {row_id}")
    if raw_fingerprint:
        fingerprint = legacy._valid_sha256(raw_fingerprint)
        if fingerprint is None or base.norm(fingerprint) != base.norm(case[5]):
            raise RuntimeError(f"Frozen Five seed Registry fingerprint drift: {row_id}")

    split = str(seed.get("split") or row.get("_split") or "")
    if split not in {"train", "validation"}:
        raise RuntimeError(f"Frozen Five seed split is invalid: {row_id}")

    return {
        "case": case,
        "row_id": row_id,
        "split": split,
        "images": images,
        "identity": identity,
        "marker": legacy._marker(identity),
        "seed_contract": "frozen_five_authoritative",
    }


def build_frozen_25(dataset: Path, require_images: bool = True) -> list[dict[str, Any]]:
    seeds = base.fixtures(dataset, require_images=require_images)
    selected: list[dict[str, Any]] = []
    used_rows: set[str] = set()
    used_registry_ids: set[str] = set()
    player_counts: Counter[str] = Counter()

    rows = base.load_rows(dataset)
    row_by_id = {str(row["id"]): row for row in rows}

    # Keep the five already-proven fixtures under the Frozen Five contract. Do not
    # accidentally subject them to the stricter eligibility requirements intended
    # only for newly-added Frozen 25 fixtures.
    for seed in seeds:
        row_id = str(seed["row_id"])
        row = row_by_id.get(row_id)
        if row is None:
            raise RuntimeError(f"Frozen Five seed row vanished from dataset: {row_id}")
        item = _seed_candidate(row, seed, require_images=require_images)
        selected.append(item)
        used_rows.add(row_id)
        used_registry_ids.add(str(item["case"][4]))
        player_counts[base.norm(item["case"][1])] += 1

    # Only the twenty new expansion fixtures must meet the stricter row-local
    # Registry UUID + SHA-256 fingerprint + two-image contract.
    extras: list[dict[str, Any]] = []
    for row in rows:
        item = legacy._row_candidate(row, require_images=require_images)
        if item is None:
            continue
        registry_id = str(item["case"][4])
        if item["row_id"] in used_rows or registry_id in used_registry_ids:
            continue
        extras.append(item)

    extras.sort(key=legacy._sort_key)

    deferred: list[dict[str, Any]] = []
    for item in extras:
        if len(selected) >= legacy.TARGET:
            break
        player_key = base.norm(item["case"][1])
        if player_counts[player_key] >= legacy.MAX_PRIMARY_ROWS_PER_PLAYER:
            deferred.append(item)
            continue
        selected.append(item)
        used_rows.add(item["row_id"])
        used_registry_ids.add(str(item["case"][4]))
        player_counts[player_key] += 1

    if len(selected) < legacy.TARGET:
        for item in deferred:
            if len(selected) >= legacy.TARGET:
                break
            registry_id = str(item["case"][4])
            if item["row_id"] in used_rows or registry_id in used_registry_ids:
                continue
            selected.append(item)
            used_rows.add(item["row_id"])
            used_registry_ids.add(registry_id)

    if len(selected) != legacy.TARGET:
        raise RuntimeError(
            f"Frozen 25 requires the proven Frozen Five plus 20 distinct Registry-proven "
            f"two-image expansion fixtures; only {len(selected)} total fixtures qualified."
        )
    if len({item["row_id"] for item in selected}) != legacy.TARGET:
        raise RuntimeError("Frozen 25 row IDs are not unique")
    if len({item["case"][4] for item in selected}) != legacy.TARGET:
        raise RuntimeError("Frozen 25 Registry UUIDs are not unique")

    return selected


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
            legacy._registry_gate(registry.model_dump(mode="json"), case)
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

    return {"round": number, "passed": len(cases) == legacy.TARGET, "cases": cases}


def _write_dataset(root: Path, rows: list[dict[str, Any]]) -> None:
    train = [row for row in rows if row["_split"] == "train"]
    validation = [row for row in rows if row["_split"] == "validation"]
    for row in rows:
        row.pop("_split", None)
    (root / "train.jsonl").write_text("".join(json.dumps(row) + "\n" for row in train), "utf-8")
    (root / "validation.jsonl").write_text("".join(json.dumps(row) + "\n" for row in validation), "utf-8")


def self_test() -> int:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        image = root / "card.jpg"
        image.write_bytes(b"card")
        rows: list[dict[str, Any]] = []

        for index, case in enumerate(base.FROZEN):
            rows.append(
                legacy._fake_row(
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

        # Reproduce the real regression: a Frozen Five seed can be authoritative and
        # previously validated even when the exported training row lacks the newer
        # Registry metadata fields and only carries its original single image.
        rows[1]["images"] = [str(image)]
        rows[1]["metadata"] = {}

        for index in range(20):
            registry_id = f"00000000-0000-0000-0001-{index:012d}"
            fingerprint = f"{index + 1:064x}"
            rows.append(
                legacy._fake_row(
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

        invalid_one_image = legacy._fake_row(
            "invalid-one-image",
            image,
            "Invalid One Image",
            "901",
            "00000000-0000-0000-0002-000000000001",
            "f" * 64,
            split="train",
        )
        invalid_one_image["images"] = [str(image)]
        rows.append(invalid_one_image)

        invalid_no_registry = legacy._fake_row(
            "invalid-no-registry",
            image,
            "Invalid No Registry",
            "902",
            "00000000-0000-0000-0002-000000000002",
            "e" * 64,
            split="train",
        )
        invalid_no_registry["metadata"] = {}
        rows.append(invalid_no_registry)

        _write_dataset(root, rows)

        first = build_frozen_25(root, require_images=True)
        second = build_frozen_25(root, require_images=True)
        assert [item["row_id"] for item in first] == [item["row_id"] for item in second]
        assert len(first) == legacy.TARGET
        assert len({item["row_id"] for item in first}) == legacy.TARGET
        assert len({item["case"][4] for item in first}) == legacy.TARGET
        assert [item["case"][0] for item in first[:5]] == [case[0] for case in base.FROZEN]
        assert first[1]["row_id"] == "seed-1"
        assert len(first[1]["images"]) == 1
        assert first[1]["seed_contract"] == "frozen_five_authoritative"
        assert all(item["row_id"] not in {"invalid-one-image", "invalid-no-registry"} for item in first)

        # Present-but-conflicting seed metadata must still fail closed.
        loaded = base.load_rows(root)
        seed_row = next(row for row in loaded if row["id"] == "seed-0")
        bad_seed = json.loads(json.dumps(seed_row))
        bad_seed["metadata"]["registry_identity_id"] = "00000000-0000-0000-0000-000000000999"
        try:
            _seed_candidate(bad_seed, base.fixtures(root, require_images=True)[0], require_images=True)
            raise AssertionError("Conflicting Frozen Five seed Registry UUID was accepted")
        except RuntimeError:
            pass

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

    print("PASS Frozen Five seed contract survives missing newer row metadata")
    print("PASS Frozen Five seed contract survives original single-image fixture")
    print("PASS Frozen 25 extras still require Registry UUID + fingerprint + two images")
    print("PASS conflicting seed Registry metadata fails closed")
    print("PASS deterministic exact two-round 25/25 contract")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()

    legacy.build_frozen_25 = build_frozen_25
    legacy.run_round = run_round
    return legacy.main()


if __name__ == "__main__":
    raise SystemExit(main())
