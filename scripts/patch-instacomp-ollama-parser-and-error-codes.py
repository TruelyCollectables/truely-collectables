#!/usr/bin/env python3
from pathlib import Path

ollama_path = Path("services/instacomp-ai/app/ollama.py")
main_path = Path("services/instacomp-ai/app/main.py")

ollama = ollama_path.read_text(encoding="utf-8")
main = main_path.read_text(encoding="utf-8")

start = ollama.index("def normalize_identity_payload(payload: dict) -> dict:\n")
end = ollama.index("\n\nclass OllamaReader:", start)

replacement = r'''TEXT_IDENTITY_FIELDS = [
    "sport", "league", "year", "manufacturer", "brand", "set_name",
    "subset", "player", "team", "card_number", "parallel", "variation",
    "serial_number", "inscription_text", "memorabilia_type",
]

IDENTITY_ALIASES = {
    "setName": "set_name", "cardNumber": "card_number",
    "serialNumber": "serial_number", "serialRun": "serial_run",
    "inscriptionText": "inscription_text", "memorabiliaType": "memorabilia_type",
    "isRookie": "rookie", "isAuto": "autograph", "isAutograph": "autograph",
    "isInscribed": "inscription", "isRelic": "memorabilia",
}

EVIDENCE_ALIASES = {
    "visibleText": "visible_text", "frontVisibleText": "front_visible_text",
    "backVisibleText": "back_visible_text", "foilOrPattern": "foil_or_pattern",
    "frontNotes": "front_notes", "backNotes": "back_notes",
}


def _as_mapping(value: object) -> dict:
    return dict(value) if isinstance(value, dict) else {}


def _as_optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    text = str(value).strip().lower()
    if text in {"true", "yes", "y", "1", "present"}:
        return True
    if text in {"false", "no", "n", "0", "none", "null", "absent", ""}:
        return False
    return None


def _as_text_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        items = list(value.values())
    elif isinstance(value, (list, tuple, set)):
        items = list(value)
    else:
        items = [value]
    normalized: list[str] = []
    for item in items:
        if isinstance(item, (list, tuple, set)):
            normalized.extend(_as_text_list(item))
            continue
        text = str(item).strip()
        if text and text not in normalized:
            normalized.append(text)
    return normalized


def normalize_confidence(value: object) -> float:
    if value is None or isinstance(value, (dict, list, tuple, set)):
        return 0.0
    text = str(value).strip()
    percent = text.endswith("%")
    if percent:
        text = text[:-1].strip()
    try:
        confidence = float(text or 0)
    except (TypeError, ValueError):
        return 0.0
    if percent or confidence > 1:
        confidence /= 100
    return max(0.0, min(confidence, 1.0))


def normalize_identity_payload(payload: object) -> dict:
    root = _as_mapping(payload)
    identity_source = _as_mapping(root.get("identity")) or root
    for alias, canonical in IDENTITY_ALIASES.items():
        if canonical not in identity_source and alias in identity_source:
            identity_source[canonical] = identity_source.get(alias)

    identity: dict = {
        field: _as_optional_text(identity_source.get(field))
        for field in TEXT_IDENTITY_FIELDS
    }
    serial_number = identity.get("serial_number") or ""
    serial_run = identity_source.get("serial_run")
    if not serial_run and serial_number:
        match = re.search(r"/\s*(\d{1,6})\b", serial_number)
        if match:
            serial_run = int(match.group(1))
    try:
        identity["serial_run"] = int(serial_run) if serial_run is not None else None
    except (TypeError, ValueError):
        identity["serial_run"] = None
    for field in ["rookie", "autograph", "inscription", "memorabilia"]:
        identity[field] = _as_optional_bool(identity_source.get(field))

    evidence_source = _as_mapping(root.get("evidence"))
    for alias, canonical in EVIDENCE_ALIASES.items():
        if canonical not in evidence_source and alias in evidence_source:
            evidence_source[canonical] = evidence_source.get(alias)
    evidence = {
        field: _as_text_list(evidence_source.get(field))
        for field in [
            "visible_text", "front_visible_text", "back_visible_text", "logos",
            "colors", "foil_or_pattern", "front_notes", "back_notes", "uncertainty",
        ]
    }

    root["evidence"] = evidence
    root["identity"] = normalize_prizm_surface_parallel(
        identity, evidence, str(root.get("explanation") or "")
    )
    root["confidence"] = normalize_confidence(root.get("confidence"))
    root["explanation"] = str(
        root.get("explanation") or "Local backup visual evidence only."
    ).strip()
    return root
'''

ollama = ollama[:start] + replacement + ollama[end:]
ollama = ollama.replace(
    '''        confidence = float(parsed.get("confidence") or 0)\n        if confidence > 1:\n            confidence /= 100\n        confidence = max(0.0, min(confidence, 1.0))\n''',
    '''        confidence = normalize_confidence(parsed.get("confidence"))\n''',
    1,
)

old = '''    suggestion = None\n    model_error = None\n    suggestion_registry = printed_registry\n    try:\n'''
new = '''    suggestion = None\n    model_error = None\n    model_error_code = None\n    suggestion_registry = printed_registry\n    try:\n'''
if old not in main:
    raise SystemExit("main.py model-error initialization anchor not found")
main = main.replace(old, new, 1)

old = '''    except (httpx.HTTPError, ValueError) as exc:\n        model_error = str(exc)\n'''
new = '''    except httpx.HTTPStatusError as exc:\n        model_error_code = f"ollama_http_{exc.response.status_code}"\n        model_error = model_error_code\n    except httpx.TimeoutException:\n        model_error_code = "ollama_timeout"\n        model_error = model_error_code\n    except httpx.HTTPError as exc:\n        model_error_code = f"ollama_transport_{type(exc).__name__.lower()}"\n        model_error = model_error_code\n    except (TypeError, ValueError, KeyError) as exc:\n        model_error_code = f"ollama_parse_{type(exc).__name__.lower()}"\n        model_error = model_error_code\n'''
if old not in main:
    raise SystemExit("main.py exception anchor not found")
main = main.replace(old, new, 1)

old = '''        if model_error:\n            status = "model_unavailable"\n            next_action = (\n                "The local Ollama evidence reader was unavailable. Keep identity and "\n                "pricing blocked, repair the local model, and retry."\n            )\n'''
new = '''        if model_error:\n            status = "model_unavailable"\n            error_receipt = f"local_model_error:{model_error_code or 'unknown'}"\n            checklist_result = checklist_result.model_copy(\n                update={\n                    "reasons": list(dict.fromkeys([*checklist_result.reasons, error_receipt]))\n                }\n            )\n            next_action = (\n                "The local Ollama evidence reader did not produce a usable result "\n                f"({model_error_code or 'unknown'}). Keep identity and pricing blocked, "\n                "repair the local reader, and retry."\n            )\n'''
if old not in main:
    raise SystemExit("main.py model-error response anchor not found")
main = main.replace(old, new, 1)

ollama_path.write_text(ollama, encoding="utf-8")
main_path.write_text(main, encoding="utf-8")
print(f"patched {ollama_path}")
print(f"patched {main_path}")
