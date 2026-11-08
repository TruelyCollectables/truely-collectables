from __future__ import annotations

import importlib.util
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = SERVICE_ROOT / "scripts" / "validate_lora_candidate.py"


def load_module():
    spec = importlib.util.spec_from_file_location("instacomp_validate_lora_candidate", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def row(row_id: str, *, player: str = "Sonia Citron", parallel: str = "Holo") -> dict:
    module = load_module()
    identity = {field: None for field in module.IDENTITY_FIELDS}
    identity.update({
        "year": "2025",
        "manufacturer": "Panini",
        "brand": "Prizm WNBA",
        "set_name": "Prizm WNBA",
        "player": player,
        "card_number": "122",
        "parallel": parallel,
        "rookie": True,
        "autograph": False,
        "memorabilia": False,
    })
    return {
        "id": row_id,
        "images": ["/tmp/front.jpg", "/tmp/back.jpg"],
        "messages": [
            {"role": "user", "content": [{"type": "text", "text": "identify"}]},
            {"role": "assistant", "content": [{"type": "text", "text": __import__("json").dumps({"identity": identity})}]},
        ],
        "metadata": {"scan_id": row_id, "card_uuid": f"uuid-{row_id}"},
    }


def prediction(identity: dict | None) -> dict:
    return {"parsed": {"identity": identity} if identity is not None else None}


def expected_identity(module, source_row: dict) -> dict:
    return module._expected_payload(source_row)["identity"]


def test_parser_accepts_fenced_json() -> None:
    module = load_module()
    assert module._parse_json_object('```json\n{"identity":{"player":"A"}}\n```') == {
        "identity": {"player": "A"}
    }


def test_candidate_strict_improvement_without_regression_is_eligible() -> None:
    module = load_module()
    source = row("scan-1")
    expected = expected_identity(module, source)
    baseline_identity = dict(expected)
    baseline_identity["parallel"] = "Silver"
    candidate_identity = dict(expected)

    score = module.score_predictions(
        [source],
        {"scan-1": prediction(baseline_identity)},
        {"scan-1": prediction(candidate_identity)},
    )

    assert score["gates"]["strict_improvement"] is True
    assert score["gates"]["no_critical_regressions"] is True
    assert score["gates"]["promotion_candidate"] is True
    assert score["critical_improvements"][0]["field"] == "parallel"


def test_any_critical_regression_blocks_promotion_even_with_net_improvement() -> None:
    module = load_module()
    source = row("scan-2")
    expected = expected_identity(module, source)
    baseline_identity = dict(expected)
    baseline_identity["parallel"] = "Silver"
    baseline_identity["year"] = "2024"
    candidate_identity = dict(expected)
    candidate_identity["player"] = "Wrong Player"

    score = module.score_predictions(
        [source],
        {"scan-2": prediction(baseline_identity)},
        {"scan-2": prediction(candidate_identity)},
    )

    assert score["gates"]["strict_improvement"] is True
    assert score["gates"]["no_critical_regressions"] is False
    assert score["gates"]["promotion_candidate"] is False
    assert {item["field"] for item in score["critical_improvements"]} >= {"parallel", "year"}
    assert any(item["field"] == "player" for item in score["critical_regressions"])


def test_parse_regression_blocks_promotion() -> None:
    module = load_module()
    source = row("scan-3")
    expected = expected_identity(module, source)
    candidate_identity = dict(expected)
    baseline_identity = dict(expected)
    baseline_identity["parallel"] = "Silver"

    score = module.score_predictions(
        [source],
        {"scan-3": prediction(baseline_identity)},
        {"scan-3": prediction(None)},
    )

    assert score["gates"]["parse_not_worse"] is False
    assert score["gates"]["promotion_candidate"] is False
