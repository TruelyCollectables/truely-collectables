from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from app.config import Settings
from app.lora_candidate_runtime import _candidate_response_to_suggestion


SERVICE_ROOT = Path(__file__).resolve().parents[1]
SIDECAR = SERVICE_ROOT / "scripts" / "run_lora_candidate_server.py"


def load_sidecar_module():
    spec = importlib.util.spec_from_file_location("instacomp_lora_candidate_sidecar", SIDECAR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_adapter(
    tmp_path: Path,
    *,
    promotion: bool = True,
    regressions: list | None = None,
    deployment_field: str = "automatic_deployment",
) -> Path:
    adapter = tmp_path / "adapter"
    adapter.mkdir()
    (adapter / "adapter_config.json").write_text(
        json.dumps({"lora_parameters": {"rank": 16, "alpha": 32}}),
        encoding="utf-8",
    )
    (adapter / "adapters.safetensors").write_bytes(b"safe-test-weights")
    receipt = {
        "adapter": str(adapter.resolve()),
        "held_out_examples": 30,
        "score": {
            "critical_regressions": regressions or [],
            "gates": {
                "strict_improvement": promotion,
                "no_critical_regressions": not bool(regressions),
                "parse_not_worse": True,
                "candidate_not_worse_exact": True,
                "promotion_candidate": promotion and not bool(regressions),
            },
        },
        "promotion": {
            "eligible_for_runtime_candidate": promotion and not bool(regressions),
            deployment_field: False,
        },
    }
    (adapter / "validation-test.json").write_text(
        json.dumps(receipt),
        encoding="utf-8",
    )
    return adapter


def test_candidate_is_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in [
        "INSTACOMP_AI_LORA_CANDIDATE_ENABLED",
        "INSTACOMP_AI_LORA_CANDIDATE_URL",
    ]:
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=None)
    assert settings.lora_candidate_enabled is False
    assert settings.lora_candidate_url == "http://127.0.0.1:8791"


def test_candidate_response_ignores_trained_registry_authority_fields() -> None:
    suggestion = _candidate_response_to_suggestion(
        {
            "ok": True,
            "validation_eligible": True,
            "model": "mlx-community/Qwen3-VL-2B-Instruct-4bit",
            "adapter_name": "instacomp-test",
            "adapter_weights_sha256": "a" * 64,
            "validation_receipt": "validation-test.json",
            "parsed": {
                "identity": {
                    "year": "2025",
                    "manufacturer": "Panini",
                    "player": "Sonia Citron",
                    "card_number": "122",
                },
                "checklist_identity_id": "must-not-be-trusted",
                "checklist_fingerprint_sha256": "must-not-be-trusted",
            },
        },
        local_vision=None,
    )
    assert suggestion.provider == "instacomp_lora_candidate"
    assert suggestion.identity.player == "Sonia Citron"
    assert suggestion.identity.card_number == "122"
    assert suggestion.raw["candidate_checklist_fields_ignored"] is True
    assert "checklist_identity_id" not in suggestion.raw
    assert suggestion.confidence == 0.0


def test_candidate_response_requires_core_identity() -> None:
    with pytest.raises(ValueError, match="core identity evidence"):
        _candidate_response_to_suggestion(
            {
                "ok": True,
                "validation_eligible": True,
                "parsed": {"identity": {"player": "Sonia Citron"}},
            },
            local_vision=None,
        )


def test_sidecar_accepts_actual_validator_receipt_schema(tmp_path: Path) -> None:
    module = load_sidecar_module()
    adapter = write_adapter(tmp_path, deployment_field="automatic_deployment")
    preflight = module.validate_adapter(adapter)
    assert preflight["promotion_candidate"] is True
    assert preflight["automatic_deployment"] is False
    assert preflight["automatic_promotion"] is False
    assert preflight["held_out_examples"] == 30
    assert preflight["registry_remains_identity_authority"] is True
    assert len(preflight["adapter_weights_sha256"]) == 64


def test_sidecar_accepts_legacy_automatic_promotion_alias(tmp_path: Path) -> None:
    module = load_sidecar_module()
    adapter = write_adapter(tmp_path, deployment_field="automatic_promotion")
    preflight = module.validate_adapter(adapter)
    assert preflight["promotion_candidate"] is True
    assert preflight["automatic_deployment"] is False
    assert preflight["automatic_promotion"] is False


def test_sidecar_rejects_adapter_with_critical_regression(tmp_path: Path) -> None:
    module = load_sidecar_module()
    adapter = write_adapter(
        tmp_path,
        regressions=[{"field": "player", "baseline": "A", "candidate": "B"}],
    )
    with pytest.raises(SystemExit, match="not eligible"):
        module.validate_adapter(adapter)


def test_runtime_prompt_matches_training_contract() -> None:
    module = load_sidecar_module()
    parsed = json.loads(module.build_runtime_prompt({"schema_version": "test"}))
    assert parsed["task"].startswith("Read one trading card from front and back")
    assert parsed["deterministic_evidence"] == {"schema_version": "test"}
    assert "Return null for unknown values." in parsed["rules"]
