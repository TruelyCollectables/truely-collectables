#!/usr/bin/env python3
from __future__ import annotations

import ast
import base64
import importlib.util
import json
import re
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any

LEGACY_PATH = Path(__file__).resolve().with_name("run_lora_candidate_server_legacy.py")
LEGACY_SPEC = importlib.util.spec_from_file_location(
    "instacomp_lora_candidate_server_legacy",
    LEGACY_PATH,
)
if LEGACY_SPEC is None or LEGACY_SPEC.loader is None:
    raise RuntimeError(f"Could not load preserved LoRA candidate server: {LEGACY_PATH}")
legacy = importlib.util.module_from_spec(LEGACY_SPEC)
LEGACY_SPEC.loader.exec_module(legacy)

# Preserve the established public test/runtime API while the v2 shim changes
# only output recovery and error classification.
validate_adapter = legacy.validate_adapter
build_runtime_prompt = legacy.build_runtime_prompt
_automatic_deployment_disabled = legacy._automatic_deployment_disabled
DEFAULT_MODEL = legacy.DEFAULT_MODEL
DEFAULT_PORT = legacy.DEFAULT_PORT
MAX_BODY_BYTES = legacy.MAX_BODY_BYTES
MAX_DECODED_IMAGE_BYTES = 24 * 1024 * 1024

TRAINED_ANSWER_SHAPE = {
    "identity": {
        "sport": None,
        "league": None,
        "year": None,
        "manufacturer": None,
        "brand": None,
        "set_name": None,
        "subset": None,
        "player": None,
        "team": None,
        "card_number": None,
        "parallel": None,
        "variation": None,
        "serial_number": None,
        "serial_run": None,
        "rookie": None,
        "autograph": None,
        "inscription": None,
        "inscription_text": None,
        "memorabilia": None,
        "memorabilia_type": None,
    },
    "serial_truth": {
        "visible_stamp_present": False,
        "visible_exact_stamp": None,
        "visible_numerator": None,
        "visible_denominator": None,
        "checklist_print_run": None,
        "physical_copy_serial": None,
        "numerator_is_card_specific": True,
        "denominator_is_configuration_level": True,
    },
    "checklist_identity_id": None,
    "checklist_fingerprint_sha256": None,
    "correction_fields": [],
}


class RequestValidationError(ValueError):
    pass


class CandidateOutputError(RuntimeError):
    pass


def _safe_detail(value: object, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    text = re.sub(r"[^A-Za-z0-9 .,:;_\-/()\[\]{}'\"=]+", "?", text)
    return text[:limit]


def _balanced_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    quote: str | None = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if quote is not None:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = None
            continue
        if char in {'"', "'"}:
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def parse_candidate_object(text: str) -> dict[str, Any] | None:
    value = str(text or "").strip().lstrip("\ufeff")
    value = re.sub(r"^```(?:json|python)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value)
    candidates = [value]
    balanced = _balanced_object(value)
    if balanced and balanced not in candidates:
        candidates.append(balanced)

    for candidate in candidates:
        repaired_versions = [
            candidate,
            re.sub(r",\s*([}\]])", r"\1", candidate)
            .replace("“", '"')
            .replace("”", '"')
            .replace("’", "'"),
        ]
        for repaired in repaired_versions:
            try:
                parsed = json.loads(repaired)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
            try:
                parsed = ast.literal_eval(repaired)
                if isinstance(parsed, dict):
                    return parsed
            except (SyntaxError, ValueError):
                pass
    return None


def strict_retry_prompt(deterministic_evidence: Any) -> str:
    base = json.loads(build_runtime_prompt(deterministic_evidence))
    base["output_contract"] = {
        "instruction": (
            "Return exactly one JSON object and no markdown or prose. Follow the same answer shape used during training. "
            "Use null for unknown values. Do not invent checklist IDs or fingerprints."
        ),
        "shape": TRAINED_ANSWER_SHAPE,
    }
    return json.dumps(base, separators=(",", ":"), ensure_ascii=False)


class CandidateEngineV2(legacy.CandidateEngine):
    def _generate_once(self, *, prompt: str, image_paths: list[str]) -> str:
        formatted = self._apply_chat_template(
            self.processor,
            self.model.config,
            prompt,
            num_images=len(image_paths),
        )
        output = self._generate(
            self.model,
            self.processor,
            formatted,
            image_paths,
            max_tokens=self.max_tokens,
            temperature=0.0,
            verbose=False,
        )
        return legacy._generation_text(output)

    def analyze(
        self,
        *,
        front: bytes,
        back: bytes | None,
        deterministic_evidence: Any,
    ) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="instacomp-lora-candidate-") as temp:
            root = Path(temp)
            image_paths: list[str] = []
            front_path = root / "front.jpg"
            front_path.write_bytes(front)
            image_paths.append(str(front_path))
            if back:
                back_path = root / "back.jpg"
                back_path.write_bytes(back)
                image_paths.append(str(back_path))

            first_error: str | None = None
            try:
                raw = self._generate_once(
                    prompt=build_runtime_prompt(deterministic_evidence),
                    image_paths=image_paths,
                )
                parsed = parse_candidate_object(raw)
            except ValueError as exc:
                first_error = f"{type(exc).__name__}:{_safe_detail(exc, 120)}"
                parsed = None

            retried = parsed is None
            if retried:
                first_error = first_error or "unparseable_generation"
                try:
                    retry_raw = self._generate_once(
                        prompt=strict_retry_prompt(deterministic_evidence),
                        image_paths=image_paths,
                    )
                    parsed = parse_candidate_object(retry_raw)
                except ValueError as exc:
                    raise CandidateOutputError(
                        "candidate_generation_value_error_after_retry "
                        f"first={first_error} retry={type(exc).__name__}:{_safe_detail(exc, 120)}"
                    ) from exc
                if parsed is None:
                    raise CandidateOutputError(
                        "candidate_generation_not_structured_json_after_retry "
                        f"first={first_error}"
                    )

        return {
            "ok": True,
            "schema_version": "tcos.instacomp-ai.lora-runtime-candidate.v2",
            "model": self.model_name,
            "adapter_name": self.preflight["adapter_name"],
            "adapter_weights_sha256": self.preflight["adapter_weights_sha256"],
            "validation_receipt": self.preflight["validation_receipt_name"],
            "validation_eligible": True,
            "parsed": parsed,
            "authority": "evidence_only_registry_lock_required",
            "structured_response_retried": retried,
            "nothing_published": True,
        }


class CandidateHandlerV2(legacy.CandidateHandler):
    server_version = "InstaCompLoRACandidate/2.0"

    def _read_request(self, length: int) -> tuple[bytes, bytes | None, Any]:
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RequestValidationError("request body is not valid JSON") from exc
        if not isinstance(payload, dict):
            raise RequestValidationError("request must be a JSON object")
        front_value = payload.get("front_base64")
        if not isinstance(front_value, str) or not front_value:
            raise RequestValidationError("front_base64 is required")
        try:
            front = base64.b64decode(front_value, validate=True)
        except Exception as exc:
            raise RequestValidationError("front_base64 is invalid") from exc
        back_value = payload.get("back_base64")
        if isinstance(back_value, str) and back_value:
            try:
                back = base64.b64decode(back_value, validate=True)
            except Exception as exc:
                raise RequestValidationError("back_base64 is invalid") from exc
        else:
            back = None
        if not front:
            raise RequestValidationError("decoded front image is empty")
        if len(front) + len(back or b"") > MAX_DECODED_IMAGE_BYTES:
            raise RequestValidationError("decoded image payload is too large")
        return front, back, payload.get("deterministic_evidence")

    def do_POST(self) -> None:
        if self.path != "/analyze":
            self._json(404, {"ok": False, "error": "not_found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._json(413, {"ok": False, "error": "invalid_request_size"})
            return
        try:
            front, back, deterministic_evidence = self._read_request(length)
        except RequestValidationError as exc:
            self._json(
                422,
                {
                    "ok": False,
                    "error": "invalid_candidate_request",
                    "error_type": type(exc).__name__,
                    "detail": _safe_detail(exc),
                },
            )
            return

        try:
            result = self.engine.analyze(
                front=front,
                back=back,
                deterministic_evidence=deterministic_evidence,
            )
        except Exception as exc:
            detail = _safe_detail(exc)
            print(f"candidate inference failed: {type(exc).__name__}: {detail}", flush=True)
            self._json(
                503,
                {
                    "ok": False,
                    "error": "candidate_inference_failed",
                    "error_type": type(exc).__name__,
                    "detail": detail,
                },
            )
            return
        self._json(200, result)


def self_test() -> int:
    expected = {
        "identity": {
            "player": "A'ja Wilson",
            "card_number": "76",
            "parallel": "Cracked Ice Prizm",
            "serial_number": None,
            "serial_run": None,
        },
        "serial_truth": {
            "visible_stamp_present": False,
            "visible_exact_stamp": None,
            "visible_numerator": None,
            "visible_denominator": None,
            "checklist_print_run": None,
            "physical_copy_serial": None,
            "numerator_is_card_specific": True,
            "denominator_is_configuration_level": True,
        },
        "checklist_identity_id": None,
        "checklist_fingerprint_sha256": None,
        "correction_fields": [],
    }
    encoded = json.dumps(expected)
    assert parse_candidate_object(encoded) == expected
    assert parse_candidate_object(f"```json\n{encoded}\n```") == expected
    assert parse_candidate_object(f"answer follows: {encoded} trailing prose") == expected
    assert parse_candidate_object(encoded[:-1] + ",}") == expected
    assert parse_candidate_object(repr(expected)) == expected

    training_prompt = json.loads(build_runtime_prompt({"schema_version": "test"}))
    assert training_prompt["deterministic_evidence"] == {"schema_version": "test"}
    assert "output_contract" not in training_prompt

    strict = json.loads(strict_retry_prompt({"front_text": ["AJA WILSON", "2/6"]}))
    contract = strict.get("output_contract") or {}
    assert "identity" in (contract.get("shape") or {})
    assert "serial_truth" in (contract.get("shape") or {})
    assert contract["shape"]["identity"]["serial_number"] is None
    assert contract["shape"]["identity"]["serial_run"] is None

    engine = CandidateEngineV2.__new__(CandidateEngineV2)
    engine.model_name = "self-test-model"
    engine.max_tokens = 256
    engine.preflight = {
        "adapter_name": "self-test-adapter",
        "adapter_weights_sha256": "a" * 64,
        "validation_receipt_name": "validation-self-test.json",
    }
    engine.model = SimpleNamespace(config=object())
    engine.processor = object()
    engine._apply_chat_template = lambda processor, config, prompt, num_images: prompt
    generations = iter(["not json", encoded])
    calls: list[str] = []

    def fake_generate(model, processor, formatted, image_paths, **kwargs):
        calls.append(formatted)
        return next(generations)

    engine._generate = fake_generate
    result = engine.analyze(
        front=b"front",
        back=b"back",
        deterministic_evidence={"x": 1},
    )
    assert len(calls) == 2
    assert "output_contract" not in json.loads(calls[0])
    assert "output_contract" in json.loads(calls[1])
    assert result["parsed"] == expected
    assert result["structured_response_retried"] is True

    engine2 = CandidateEngineV2.__new__(CandidateEngineV2)
    engine2.model_name = "self-test-model"
    engine2.max_tokens = 256
    engine2.preflight = engine.preflight
    engine2.model = SimpleNamespace(config=object())
    engine2.processor = object()
    engine2._apply_chat_template = engine._apply_chat_template
    engine2._generate = lambda *args, **kwargs: "still not json"
    try:
        engine2.analyze(front=b"front", back=None, deterministic_evidence=None)
    except CandidateOutputError as exc:
        assert "after_retry" in str(exc)
    else:
        raise AssertionError("two invalid generations must fail closed")

    print("PASS sidecar loads preserved server under spec_from_file_location")
    print("PASS sidecar parser accepts bounded JSON drift safely")
    print("PASS strict retry uses the adapter's trained answer contract")
    print("PASS A'ja-style 2/6 evidence does not force serial fields")
    print("PASS one bounded structured retry recovers an unparseable first generation")
    print("PASS two invalid generations still fail closed")
    print("PASS request errors remain distinct from inference/output failures")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return self_test()
    legacy.CandidateEngine = CandidateEngineV2
    legacy.CandidateHandler = CandidateHandlerV2
    return legacy.main()


if __name__ == "__main__":
    raise SystemExit(main())
