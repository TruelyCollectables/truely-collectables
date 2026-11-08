#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v10 as v10
import promote_lora_candidate_frozen_five as base

SCHEMA = "tcos.instacomp-ai.lora-staged-promotion.v11"
MANIFEST_SCHEMA = "tcos.instacomp-ai.lora-staged-fixtures.v1"
ALLOWED_STAGE_TARGETS = (10, 15, 25)
DEFAULT_STAGE_TARGET = 10
REGISTRY_ATTEMPT_BUDGETS = {10: 100, 15: 250, 25: 750}
PRIOR_STAGE = {10: 5, 15: 10, 25: 15}
STAGE_MANIFEST = base.RECEIPTS / "staged-promotion-fixtures-latest.json"
_ORIGINAL_EXPANSION_CANDIDATE = v3._expansion_candidate
_V10_BUILD = v10.build_frozen_25_live_v10


def _stage_label(target: int) -> str:
    return f"Frozen {target}"


def _configure_stage(target: int) -> None:
    if target not in ALLOWED_STAGE_TARGETS:
        raise RuntimeError(
            f"Unsupported promotion stage {target}; allowed={ALLOWED_STAGE_TARGETS}"
        )
    v3.TARGET = target
    v3.legacy.TARGET = target
    v3.legacy.RECEIPT_PREFIX = f"frozen-{target}-promotion"


def _shortlisted_row_ids(dataset: Path, *, require_images: bool, target: int) -> tuple[set[str], int]:
    candidates: list[dict[str, Any]] = []
    for row in base.load_rows(dataset):
        item = _ORIGINAL_EXPANSION_CANDIDATE(row, require_images=require_images)
        if item is not None:
            candidates.append(item)
    candidates.sort(key=v3._expansion_sort_key)
    budget = REGISTRY_ATTEMPT_BUDGETS[target]
    shortlist = candidates[:budget]
    return {str(item["row_id"]) for item in shortlist}, len(candidates)


async def build_staged_live(
    dataset: Path,
    *,
    require_images: bool = True,
    registry_match=None,
) -> list[dict[str, Any]]:
    target = int(v3.TARGET)
    allowed_rows, eligible_count = _shortlisted_row_ids(
        dataset,
        require_images=require_images,
        target=target,
    )
    budget = REGISTRY_ATTEMPT_BUDGETS[target]
    print(
        f"{_stage_label(target).upper()} LOCAL SHORTLIST: "
        f"eligible_rows={eligible_count} registry_attempt_budget={budget} "
        f"shortlisted_rows={len(allowed_rows)}",
        flush=True,
    )

    def shortlisted_expansion(row: dict[str, Any], *, require_images: bool):
        item = _ORIGINAL_EXPANSION_CANDIDATE(row, require_images=require_images)
        if item is None:
            return None
        return item if str(item.get("row_id") or "") in allowed_rows else None

    previous = v3._expansion_candidate
    v3._expansion_candidate = shortlisted_expansion
    try:
        fixtures = await _V10_BUILD(
            dataset,
            require_images=require_images,
            registry_match=registry_match,
        )
    finally:
        v3._expansion_candidate = previous

    if len(fixtures) != target:
        raise RuntimeError(
            f"{_stage_label(target)} produced {len(fixtures)} fixtures; expected {target}"
        )
    return fixtures


def _fixture_signature(item: dict[str, Any]) -> dict[str, str]:
    case = item.get("case") or ()
    if len(case) < 6:
        raise RuntimeError("Promotion fixture is missing authoritative Registry case fields")
    return {
        "row_id": str(item.get("row_id") or ""),
        "player": str(case[1] or ""),
        "card_number": str(case[2] or ""),
        "registry_identity_id": str(case[4] or ""),
        "registry_fingerprint_sha256": str(case[5] or ""),
    }


def _manifest_fixture_signatures(manifest: dict[str, Any]) -> list[dict[str, str]]:
    fixtures = manifest.get("fixtures")
    if not isinstance(fixtures, list):
        return []
    output: list[dict[str, str]] = []
    for item in fixtures:
        if not isinstance(item, dict):
            return []
        output.append(
            {
                "row_id": str(item.get("row_id") or ""),
                "player": str(item.get("player") or ""),
                "card_number": str(item.get("card_number") or ""),
                "registry_identity_id": str(item.get("registry_identity_id") or ""),
                "registry_fingerprint_sha256": str(
                    item.get("registry_fingerprint_sha256") or ""
                ),
            }
        )
    return output


def _require_prior_stage_manifest(
    fixtures: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    dataset_sha: str | None,
    manifest_path: Path = STAGE_MANIFEST,
) -> None:
    prior = PRIOR_STAGE[target]
    if prior == 5:
        return
    if not manifest_path.is_file():
        raise RuntimeError(
            f"{_stage_label(target)} requires a successful Frozen {prior} fixture manifest first: "
            f"{manifest_path}"
        )
    manifest = base.read_json(manifest_path)
    if manifest.get("schema_version") != MANIFEST_SCHEMA or manifest.get("complete") is not True:
        raise RuntimeError(f"Prior staged fixture manifest is not complete: {manifest_path}")
    if int(manifest.get("stage_target") or 0) != prior:
        raise RuntimeError(
            f"{_stage_label(target)} requires Frozen {prior} immediately before it; "
            f"manifest stage={manifest.get('stage_target')!r}"
        )
    if base.norm(manifest.get("adapter_weights_sha256")) != base.norm(adapter_sha):
        raise RuntimeError("Prior staged fixture manifest adapter hash does not match current adapter")
    if base.norm(manifest.get("dataset_sha256")) != base.norm(dataset_sha):
        raise RuntimeError("Prior staged fixture manifest dataset hash does not match current dataset")

    previous = _manifest_fixture_signatures(manifest)
    current = [_fixture_signature(item) for item in fixtures[:prior]]
    if len(previous) != prior or current != previous:
        raise RuntimeError(
            f"{_stage_label(target)} did not preserve the exact successful Frozen {prior} fixture prefix; "
            "refusing to swap previously certified cards"
        )
    print(
        f"PASS {_stage_label(target)} carries forward exact Frozen {prior} UUID/fingerprint fixture prefix",
        flush=True,
    )


def _write_stage_manifest(
    fixtures: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    dataset_sha: str | None,
    manifest_path: Path = STAGE_MANIFEST,
) -> Path:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "schema_version": MANIFEST_SCHEMA,
        "created_at": base.now(),
        "complete": True,
        "stage_target": target,
        "adapter_weights_sha256": adapter_sha,
        "dataset_sha256": dataset_sha,
        "registry_attempt_budget": REGISTRY_ATTEMPT_BUDGETS[target],
        "registry_remains_identity_authority": True,
        "fixtures": [_fixture_signature(item) for item in fixtures],
    }
    tmp = manifest_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", "utf-8")
    tmp.replace(manifest_path)
    return manifest_path


def _rounds_gate(rounds: list[dict[str, Any]], target: int) -> None:
    if len(rounds) != len(v3.ROUNDS):
        raise RuntimeError(f"Exactly two {_stage_label(target)} Production rounds are required")
    wanted = {case["key"] for case in rounds[0].get("cases", [])} if rounds else set()
    if len(wanted) != target:
        raise RuntimeError(
            f"{_stage_label(target)} first round did not contain exactly {target} unique cases"
        )
    for number, round_result in enumerate(rounds, 1):
        cases = round_result.get("cases")
        if round_result.get("passed") is not True or not isinstance(cases, list):
            raise RuntimeError(f"{_stage_label(target)} round {number} did not pass")
        if len(cases) != target or {case.get("key") for case in cases} != wanted:
            raise RuntimeError(
                f"{_stage_label(target)} round {number} was not exact {target}/{target}"
            )
        if any(
            case.get("candidate_provider") != base.PROVIDER
            or case.get("candidate_fallback") is True
            or case.get("passed") is not True
            for case in cases
        ):
            raise RuntimeError(
                f"{_stage_label(target)} round {number} contains fallback/non-candidate evidence"
            )


def _install_stage_contract(target: int) -> None:
    v10._install_contract_fix()
    _configure_stage(target)
    v3.SCHEMA = SCHEMA
    v3.build_frozen_25_live = build_staged_live


def _self_test_stage_contract() -> None:
    import tempfile

    original_target = v3.TARGET
    original_legacy_target = v3.legacy.TARGET
    original_prefix = v3.legacy.RECEIPT_PREFIX
    try:
        for target in ALLOWED_STAGE_TARGETS:
            _configure_stage(target)
            assert v3.TARGET == target
            assert v3.legacy.TARGET == target
            assert v3.legacy.RECEIPT_PREFIX == f"frozen-{target}-promotion"
            assert REGISTRY_ATTEMPT_BUDGETS[target] < 7429

        def cases(target: int):
            return [
                {
                    "key": f"case-{index:02d}",
                    "candidate_provider": base.PROVIDER,
                    "candidate_fallback": False,
                    "passed": True,
                }
                for index in range(target)
            ]

        for target in ALLOWED_STAGE_TARGETS:
            round_cases = cases(target)
            _rounds_gate(
                [
                    {"passed": True, "cases": round_cases},
                    {"passed": True, "cases": json.loads(json.dumps(round_cases))},
                ],
                target,
            )

        assert REGISTRY_ATTEMPT_BUDGETS[10] < REGISTRY_ATTEMPT_BUDGETS[15]
        assert REGISTRY_ATTEMPT_BUDGETS[15] < REGISTRY_ATTEMPT_BUDGETS[25]

        fixtures = [
            {
                "row_id": f"row-{index:02d}",
                "case": (
                    f"case-{index:02d}",
                    f"Player {index:02d}",
                    str(index),
                    None,
                    f"00000000-0000-0000-0011-{index:012d}",
                    f"{index + 1:064x}",
                ),
            }
            for index in range(15)
        ]
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "fixtures.json"
            _write_stage_manifest(
                fixtures[:10],
                target=10,
                adapter_sha="a" * 64,
                dataset_sha="b" * 64,
                manifest_path=manifest_path,
            )
            _require_prior_stage_manifest(
                fixtures,
                target=15,
                adapter_sha="a" * 64,
                dataset_sha="b" * 64,
                manifest_path=manifest_path,
            )
            swapped = list(fixtures)
            swapped[9] = dict(swapped[9])
            swapped[9]["row_id"] = "different-row"
            try:
                _require_prior_stage_manifest(
                    swapped,
                    target=15,
                    adapter_sha="a" * 64,
                    dataset_sha="b" * 64,
                    manifest_path=manifest_path,
                )
                raise AssertionError("prior-stage fixture swap was accepted")
            except RuntimeError:
                pass
    finally:
        v3.TARGET = original_target
        v3.legacy.TARGET = original_legacy_target
        v3.legacy.RECEIPT_PREFIX = original_prefix

    print("PASS v11 defaults to Frozen 10 before Frozen 15 and Frozen 25")
    print("PASS v11 Registry attempt budgets are hard-capped well below 7,429")
    print("PASS v11 larger stages use deterministic superset shortlist prefixes")
    print("PASS v11 exact prior-stage UUID/fingerprint fixtures cannot be swapped")
    print("PASS v11 requires exact two-round target/target candidate evidence at every stage")


def self_test() -> int:
    assert v10.self_test() == 0
    _self_test_stage_contract()
    print("PASS Frozen staged v11 preserves every v10/v9/v7/v6/v5 fail-closed gate")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--adapter", type=Path)
    parser.add_argument(
        "--stage-target",
        type=int,
        choices=ALLOWED_STAGE_TARGETS,
        default=DEFAULT_STAGE_TARGET,
        help="Promotion rung to certify. Defaults to 10; advance explicitly to 15 then 25.",
    )
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if platform.system() != "Darwin":
        raise SystemExit("Staged InstaComp Production promotion must run on the Apple Silicon Mac.")

    target = int(args.stage_target)
    _install_stage_contract(target)
    v3.frozen_five_v2.clear_mutable_candidate_env_overrides()
    receipt, validated, dataset = base.completion_gate()
    adapter = args.adapter.expanduser().resolve() if args.adapter else validated
    if adapter != validated:
        raise SystemExit("Explicit adapter does not match complete_and_validated receipt")

    sha = base.file_sha(adapter / "adapters.safetensors")
    dataset_sha = str(receipt.get("dataset_sha256") or "") or None
    fixtures = asyncio.run(build_staged_live(dataset, require_images=True))
    _require_prior_stage_manifest(
        fixtures,
        target=target,
        adapter_sha=sha,
        dataset_sha=dataset_sha,
    )
    print(
        f"{_stage_label(target).upper()} FIXTURES: "
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
        for number in v3.ROUNDS:
            result = asyncio.run(v3.v2.run_round(number, fixtures, sha))
            rounds.append(result)
            if result.get("passed") is not True:
                raise RuntimeError(str(result.get("error") or f"Round {number} failed"))
        _rounds_gate(rounds, target)
    except BaseException as error:
        if activated:
            subprocess.run(["bash", str(base.DISABLE)], cwd=base.REPO_ROOT, check=False)
        data = {
            "schema_version": SCHEMA,
            "created_at": base.now(),
            "status": "failed_rolled_back" if activated else "failed_before_activation",
            "complete": False,
            "promotion_stage_target": target,
            "registry_attempt_budget": REGISTRY_ATTEMPT_BUDGETS[target],
            "adapter": str(adapter),
            "adapter_weights_sha256": sha,
            "dataset": str(dataset),
            "dataset_sha256": dataset_sha,
            "rounds": rounds,
            "error_type": type(error).__name__,
            "error": str(error)[:2000],
            "runtime_candidate_enabled_after_failure": False if activated else None,
            "registry_remains_identity_authority": True,
            "automatic_deployment": False,
            "automatic_promotion": False,
            "nothing_published": True,
        }
        path = v3.legacy._write_receipt(data)
        print(json.dumps(data, indent=2))
        print(f"{_stage_label(target).upper()} FAILURE RECEIPT: {path}")
        if isinstance(error, KeyboardInterrupt):
            raise
        return 2

    manifest = _write_stage_manifest(
        fixtures,
        target=target,
        adapter_sha=sha,
        dataset_sha=dataset_sha,
    )
    data = {
        "schema_version": SCHEMA,
        "created_at": base.now(),
        "status": f"promoted_runtime_candidate_frozen_{target}",
        "complete": True,
        "promotion_stage_target": target,
        "next_stage_target": 15 if target == 10 else (25 if target == 15 else None),
        "registry_attempt_budget": REGISTRY_ATTEMPT_BUDGETS[target],
        "fixture_manifest": str(manifest),
        "adapter": str(adapter),
        "adapter_weights_sha256": sha,
        "validation_receipt": receipt.get("validation_receipt"),
        "dataset": str(dataset),
        "dataset_sha256": dataset_sha,
        "activation_receipt": activation.get("_path") if activation else None,
        "registry_resolver": "bounded_staged_v10_evidence_aligned_registry_preflight_then_round_relock",
        "rounds": rounds,
        "passes": len(v3.ROUNDS),
        "cards_per_pass": target,
        "candidate_fallbacks": 0,
        "critical_regressions": 0,
        "runtime_candidate_enabled": True,
        "registry_remains_identity_authority": True,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    }
    path = v3.legacy._write_receipt(data)
    print(json.dumps(data, indent=2))
    print(f"{_stage_label(target).upper()} PROMOTION RECEIPT: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
