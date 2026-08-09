#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "mlx-community/Qwen3-VL-2B-Instruct-4bit"
DEFAULT_PORT = 8791
MAX_BODY_BYTES = 40 * 1024 * 1024

TRAINING_RULES = [
    "Use only visible evidence plus the supplied checklist candidate space.",
    "Keep a physical stamped numerator separate from the checklist print-run denominator.",
    "Do not invent a stamp when only a checklist print run exists.",
    "Describe color and foil geometry such as velocity lines or cracked-ice facets.",
    "Return null for unknown values.",
]


def _read_env_value(name: str) -> str | None:
    env_value = str(os.environ.get(name) or "").strip()
    if env_value:
        return env_value
    path = SERVICE_ROOT / ".env"
    if not path.is_file():
        return None
    for raw in path.read_text("utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != name:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        return value.strip() or None
    return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _receipt_for_adapter(adapter: Path) -> tuple[Path, dict[str, Any]]:
    matches: list[tuple[Path, dict[str, Any]]] = []
    for path in sorted(adapter.glob("validation-*.json"), reverse=True):
        try:
            payload = json.loads(path.read_text("utf-8"))
        except Exception:
            continue
        receipt_adapter = Path(str(payload.get("adapter") or "")).expanduser()
        try:
            receipt_adapter = receipt_adapter.resolve()
        except OSError:
            continue
        if receipt_adapter != adapter:
            continue
        score = payload.get("score") if isinstance(payload.get("score"), dict) else {}
        gates = score.get("gates") if isinstance(score.get("gates"), dict) else {}
        promotion = payload.get("promotion") if isinstance(payload.get("promotion"), dict) else {}
        if (
            int(payload.get("held_out_examples") or 0) == 30
            and gates.get("promotion_candidate") is True
            and gates.get("strict_improvement") is True
            and gates.get("no_critical_regressions") is True
            and gates.get("parse_not_worse") is True
            and gates.get("candidate_not_worse_exact") is True
            and not score.get("critical_regressions")
            and promotion.get("eligible_for_runtime_candidate") is True
            and promotion.get("automatic_promotion") is False
        ):
            matches.append((path, payload))
    if not matches:
        raise SystemExit(
            "Adapter is not eligible for runtime candidate use: no matching passed 30-card validation receipt was found."
        )
    return matches[0]


def validate_adapter(adapter: Path) -> dict[str, Any]:
    adapter = adapter.expanduser().resolve()
    if not adapter.is_dir():
        raise SystemExit(f"LoRA candidate adapter is not a directory: {adapter}")
    config = adapter / "adapter_config.json"
    weights = adapter / "adapters.safetensors"
    if not config.is_file():
        raise SystemExit(f"LoRA candidate is missing adapter_config.json: {adapter}")
    if not weights.is_file() or weights.stat().st_size <= 0:
        raise SystemExit(f"LoRA candidate is missing adapters.safetensors: {adapter}")
    try:
        config_payload = json.loads(config.read_text("utf-8"))
    except Exception as exc:
        raise SystemExit(f"LoRA candidate adapter_config.json is invalid: {config}") from exc
    if not isinstance(config_payload, dict):
        raise SystemExit("LoRA candidate adapter_config.json must contain a JSON object")
    receipt_path, receipt = _receipt_for_adapter(adapter)
    return {
        "schema_version": "tcos.instacomp-ai.lora-runtime-candidate-preflight.v1",
        "status": "ready",
        "adapter": str(adapter),
        "adapter_name": adapter.name,
        "adapter_weights_sha256": _sha256(weights),
        "validation_receipt": str(receipt_path),
        "validation_receipt_name": receipt_path.name,
        "held_out_examples": int(receipt.get("held_out_examples") or 0),
        "promotion_candidate": True,
        "automatic_promotion": False,
        "registry_remains_identity_authority": True,
        "nothing_published": True,
    }


def _parse_json_object(text: str) -> dict[str, Any] | None:
    value = str(text or "").strip().lstrip("\ufeff")
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value)
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    start = value.find("{")
    end = value.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(value[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _generation_text(output: Any) -> str:
    text = getattr(output, "text", None)
    return str(text if text is not None else output)


def build_runtime_prompt(deterministic_evidence: Any) -> str:
    payload = {
        "task": "Read one trading card from front and back and return the exact structured identity and visible evidence.",
        "rules": TRAINING_RULES,
        "deterministic_evidence": deterministic_evidence,
    }
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


class CandidateEngine:
    def __init__(self, *, model_name: str, adapter: Path, max_tokens: int):
        self.model_name = model_name
        self.adapter = adapter.expanduser().resolve()
        self.max_tokens = max_tokens
        self.preflight = validate_adapter(self.adapter)

        from mlx_vlm import generate, load
        from mlx_vlm.prompt_utils import apply_chat_template

        self._generate = generate
        self._apply_chat_template = apply_chat_template
        print(f"Loading validated InstaComp LoRA candidate: {self.adapter}", flush=True)
        self.model, self.processor = load(model_name, adapter_path=str(self.adapter))
        print("Validated InstaComp LoRA candidate is resident and ready.", flush=True)

    def analyze(
        self,
        *,
        front: bytes,
        back: bytes | None,
        deterministic_evidence: Any,
    ) -> dict[str, Any]:
        prompt = build_runtime_prompt(deterministic_evidence)
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
        raw = _generation_text(output)
        parsed = _parse_json_object(raw)
        if parsed is None:
            raise ValueError("LoRA candidate generation did not return a JSON object")
        return {
            "ok": True,
            "schema_version": "tcos.instacomp-ai.lora-runtime-candidate.v1",
            "model": self.model_name,
            "adapter_name": self.preflight["adapter_name"],
            "adapter_weights_sha256": self.preflight["adapter_weights_sha256"],
            "validation_receipt": self.preflight["validation_receipt_name"],
            "validation_eligible": True,
            "parsed": parsed,
            "authority": "evidence_only_registry_lock_required",
            "nothing_published": True,
        }


class CandidateHandler(BaseHTTPRequestHandler):
    engine: CandidateEngine
    server_version = "InstaCompLoRACandidate/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        # Keep normal request logs concise and never print image/request bodies.
        print(f"candidate-http {self.address_string()} {format % args}", flush=True)

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path != "/health":
            self._json(404, {"ok": False, "error": "not_found"})
            return
        self._json(
            200,
            {
                "ok": True,
                "schema_version": "tcos.instacomp-ai.lora-runtime-candidate-health.v1",
                "model": self.engine.model_name,
                "adapter_name": self.engine.preflight["adapter_name"],
                "adapter_weights_sha256": self.engine.preflight["adapter_weights_sha256"],
                "validation_receipt": self.engine.preflight["validation_receipt_name"],
                "validation_eligible": True,
                "registry_remains_identity_authority": True,
                "nothing_published": True,
            },
        )

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
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("request must be a JSON object")
            front_value = payload.get("front_base64")
            if not isinstance(front_value, str) or not front_value:
                raise ValueError("front_base64 is required")
            front = base64.b64decode(front_value, validate=True)
            back_value = payload.get("back_base64")
            back = (
                base64.b64decode(back_value, validate=True)
                if isinstance(back_value, str) and back_value
                else None
            )
            if not front or len(front) + len(back or b"") > 24 * 1024 * 1024:
                raise ValueError("decoded image payload is empty or too large")
            result = self.engine.analyze(
                front=front,
                back=back,
                deterministic_evidence=payload.get("deterministic_evidence"),
            )
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            self._json(422, {"ok": False, "error": type(exc).__name__})
            return
        except Exception as exc:
            print(f"candidate inference failed: {type(exc).__name__}: {exc}", flush=True)
            self._json(503, {"ok": False, "error": "candidate_inference_failed"})
            return
        self._json(200, result)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve a validated InstaComp MLX-VLM LoRA adapter on localhost only.")
    parser.add_argument("--adapter", type=Path, default=None)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--max-tokens", type=int, default=2048)
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()

    adapter_value = args.adapter or _read_env_value("INSTACOMP_AI_LORA_CANDIDATE_ADAPTER_PATH")
    if not adapter_value:
        raise SystemExit("Set --adapter or INSTACOMP_AI_LORA_CANDIDATE_ADAPTER_PATH.")
    adapter = Path(adapter_value)
    preflight = validate_adapter(adapter)
    print(json.dumps(preflight, indent=2), flush=True)
    if args.preflight_only:
        return 0

    port_value = args.port
    if port_value is None:
        raw_port = _read_env_value("INSTACOMP_AI_LORA_CANDIDATE_PORT")
        port_value = int(raw_port) if raw_port else DEFAULT_PORT
    if not 1024 <= int(port_value) <= 65535:
        raise SystemExit("LoRA candidate port must be between 1024 and 65535.")
    if args.max_tokens < 128 or args.max_tokens > 4096:
        raise SystemExit("--max-tokens must be between 128 and 4096.")

    engine = CandidateEngine(
        model_name=args.model,
        adapter=adapter,
        max_tokens=args.max_tokens,
    )
    CandidateHandler.engine = engine
    server = HTTPServer(("127.0.0.1", int(port_value)), CandidateHandler)
    print(f"InstaComp LoRA candidate listening on http://127.0.0.1:{port_value}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
