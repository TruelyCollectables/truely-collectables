#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OLLAMA = ROOT / "services" / "instacomp-ai" / "app" / "ollama.py"
MAIN = ROOT / "services" / "instacomp-ai" / "app" / "main.py"


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(
            f"{path}: expected exactly one match, found {count}: {old[:160]!r}"
        )
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


source = OLLAMA.read_text(encoding="utf-8")
if "import math\n" not in source:
    replace_once(OLLAMA, "import json\nimport re\n", "import json\nimport math\nimport re\n")

old_local_payload = '''def local_vision_prompt_payload(local_vision: LocalVisionEvidence | None) -> dict | None:\n    if local_vision is None:\n        return None\n    return {\n        "identity_hints": local_vision.identity_hints.model_dump(mode="json"),\n        "serial": local_vision.serial.model_dump(mode="json"),\n        "front": {\n            "ocr": [value.model_dump(mode="json") for value in local_vision.front.ocr[:100]],\n            "colors": local_vision.front.colors.model_dump(mode="json"),\n            "pattern": local_vision.front.pattern.model_dump(mode="json"),\n        },\n        "back": (\n            {\n                "ocr": [value.model_dump(mode="json") for value in local_vision.back.ocr[:100]],\n                "colors": local_vision.back.colors.model_dump(mode="json"),\n                "pattern": local_vision.back.pattern.model_dump(mode="json"),\n            }\n            if local_vision.back\n            else None\n        ),\n    }\n'''

new_local_payload = '''def _finite_float(value: object, default: float = 0.0) -> float:\n    try:\n        numeric = float(value)\n    except (TypeError, ValueError):\n        return default\n    return numeric if math.isfinite(numeric) else default\n\n\ndef _compact_ocr(observations: list, limit: int = 40) -> list[dict]:\n    compact: list[dict] = []\n    seen: set[str] = set()\n    for observation in observations:\n        text = re.sub(r"\\s+", " ", str(observation.text or "")).strip()\n        if not text:\n            continue\n        key = text.casefold()\n        if key in seen:\n            continue\n        seen.add(key)\n        compact.append(\n            {\n                "text": text[:120],\n                "confidence": round(_finite_float(observation.confidence), 3),\n            }\n        )\n        if len(compact) >= limit:\n            break\n    return compact\n\n\ndef _compact_colors(colors) -> dict:\n    ranked = sorted(\n        (\n            (str(name), _finite_float(score))\n            for name, score in colors.proportions.items()\n        ),\n        key=lambda item: item[1],\n        reverse=True,\n    )[:8]\n    return {\n        "dominant_colors": list(colors.dominant_colors[:8]),\n        "proportions": {name: round(score, 4) for name, score in ranked},\n        "mean_saturation": round(_finite_float(colors.mean_saturation), 4),\n        "mean_brightness": round(_finite_float(colors.mean_brightness), 4),\n        "metallic_score": round(_finite_float(colors.metallic_score), 4),\n    }\n\n\ndef _compact_pattern(pattern) -> dict:\n    ranked = sorted(\n        (\n            (str(name), _finite_float(score))\n            for name, score in pattern.scores.items()\n        ),\n        key=lambda item: item[1],\n        reverse=True,\n    )[:8]\n    return {\n        "label": pattern.label,\n        "confidence": round(_finite_float(pattern.confidence), 4),\n        "scores": {name: round(score, 4) for name, score in ranked},\n        "geometry": list(pattern.geometry[:12]),\n        "line_count": int(pattern.line_count),\n        "polygon_count": int(pattern.polygon_count),\n        "edge_density": round(_finite_float(pattern.edge_density), 4),\n        "dominant_angle": (\n            round(_finite_float(pattern.dominant_angle), 2)\n            if pattern.dominant_angle is not None\n            else None\n        ),\n        "angle_concentration": round(_finite_float(pattern.angle_concentration), 4),\n        "angle_entropy": round(_finite_float(pattern.angle_entropy), 4),\n    }\n\n\ndef _compact_side(side) -> dict:\n    return {\n        "ocr": _compact_ocr(side.ocr),\n        "colors": _compact_colors(side.colors),\n        "pattern": _compact_pattern(side.pattern),\n        "errors": list(side.errors[:8]),\n    }\n\n\ndef local_vision_prompt_payload(local_vision: LocalVisionEvidence | None) -> dict | None:\n    \"\"\"Return a bounded reasoning digest while preserving full evidence in storage.\n\n    Bounding boxes and every raw OpenCV metric belong in the scan/training record,\n    not in the Ollama prompt. Sending the full evidence object can exceed Qwen's\n    configured context and make Ollama reject the request with HTTP 400.\n    \"\"\"\n    if local_vision is None:\n        return None\n    return {\n        "identity_hints": local_vision.identity_hints.model_dump(mode="json"),\n        "serial": local_vision.serial.model_dump(mode="json", exclude={"box"}),\n        "front": _compact_side(local_vision.front),\n        "back": _compact_side(local_vision.back) if local_vision.back else None,\n    }\n'''

replace_once(OLLAMA, old_local_payload, new_local_payload)

old_prompt = '''        prompt = (\n            SYSTEM_PROMPT\n            + "\\nReturn only a JSON object matching this JSON schema exactly. "\n            + "Use null or empty arrays for unknown values.\\n"\n            + json.dumps(OLLAMA_OUTPUT_SCHEMA, separators=(",", ":"))\n            + "\\nDeterministic local evidence (trust exact OCR boxes, serial parsing, and measured geometry over visual guessing):\\n"\n            + json.dumps(local_vision_prompt_payload(local_vision), separators=(",", ":"), ensure_ascii=False)\n        )\n'''

new_prompt = '''        evidence_digest = local_vision_prompt_payload(local_vision)\n        prompt = (\n            SYSTEM_PROMPT\n            + "\\nReturn only one JSON object matching the requested structured-output schema. "\n            + "Use null or empty arrays for unknown values."\n        )\n        if evidence_digest is not None:\n            prompt += (\n                "\\nDeterministic local evidence digest. Full OCR boxes and raw measurements "\n                "remain stored for training; this bounded digest is for reasoning only. "\n                "Trust serial parsing, OCR text, colors, and measured geometry over visual guessing:\\n"\n                + json.dumps(\n                    evidence_digest,\n                    separators=(",", ":"),\n                    ensure_ascii=False,\n                    allow_nan=False,\n                )\n            )\n'''
replace_once(OLLAMA, old_prompt, new_prompt)

old_raw = '''                "prepared_image_bytes": [len(image) for image in prepared_images],\n                "deterministic_local_evidence": local_vision is not None,\n'''
new_raw = '''                "prepared_image_bytes": [len(image) for image in prepared_images],\n                "deterministic_local_evidence": local_vision is not None,\n                "prompt_chars": len(prompt),\n                "evidence_digest_chars": (\n                    len(json.dumps(evidence_digest, ensure_ascii=False, allow_nan=False))\n                    if evidence_digest is not None\n                    else 0\n                ),\n'''
replace_once(OLLAMA, old_raw, new_raw)

main_source = MAIN.read_text(encoding="utf-8")
helper_marker = '''def _merge_identity(primary: CardIdentity, fallback: CardIdentity) -> CardIdentity:\n'''
helper = '''def _safe_ollama_error_detail(value: object, limit: int = 240) -> str:\n    text = re.sub(r"\\s+", " ", str(value or "")).strip()\n    text = re.sub(r"[^A-Za-z0-9 .,:;_\\-/()\\[\\]{}'\\\"=]+", "?", text)\n    return text[:limit]\n\n\ndef _merge_identity(primary: CardIdentity, fallback: CardIdentity) -> CardIdentity:\n'''
if "def _safe_ollama_error_detail" not in main_source:
    replace_once(MAIN, helper_marker, helper)

old_http_error = '''    except httpx.HTTPStatusError as exc:\n        model_error_code = f"ollama_http_{exc.response.status_code}"\n        model_error = model_error_code\n'''
new_http_error = '''    except httpx.HTTPStatusError as exc:\n        model_error_code = f"ollama_http_{exc.response.status_code}"\n        detail = _safe_ollama_error_detail(exc.response.text)\n        model_error = (\n            f"{model_error_code}:{detail}" if detail else model_error_code\n        )\n'''
replace_once(MAIN, old_http_error, new_http_error)

old_receipt = '''            error_receipt = f"local_model_error:{model_error_code or 'unknown'}"\n'''
new_receipt = '''            error_receipt = f"local_model_error:{model_error or model_error_code or 'unknown'}"\n'''
replace_once(MAIN, old_receipt, new_receipt)

print("patched compact Ollama evidence digest and HTTP error receipts")
