#!/usr/bin/env python3
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "mlx-community/Qwen3-VL-2B-Instruct-4bit"
IDENTITY_FIELDS = [
    "sport",
    "league",
    "year",
    "manufacturer",
    "brand",
    "set_name",
    "subset",
    "player",
    "team",
    "card_number",
    "parallel",
    "variation",
    "serial_number",
    "serial_run",
    "rookie",
    "autograph",
    "inscription",
    "inscription_text",
    "memorabilia",
    "memorabilia_type",
]
CRITICAL_FIELDS = [
    "year",
    "manufacturer",
    "brand",
    "set_name",
    "subset",
    "player",
    "card_number",
    "parallel",
    "variation",
    "serial_number",
    "serial_run",
    "rookie",
    "autograph",
    "memorabilia",
]


def _normalize(value: Any) -> Any:
    if isinstance(value, str):
        return " ".join(unicodedata.normalize("NFKC", value).strip().split()).casefold()
    return value


def _extract_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text") or ""))
        return "\n".join(part for part in parts if part)
    return str(content or "")


def _parse_json_object(text: str) -> dict[str, Any] | None:
    value = text.strip()
    if value.startswith("```"):
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


def _expected_payload(row: dict[str, Any]) -> dict[str, Any]:
    messages = row.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        raise ValueError(f"validation row {row.get('id')} is missing messages")
    answer = _extract_text(messages[-1].get("content"))
    payload = _parse_json_object(answer)
    if payload is None or not isinstance(payload.get("identity"), dict):
        raise ValueError(f"validation row {row.get('id')} has invalid teacher answer")
    return payload


def _prompt_and_images(row: dict[str, Any]) -> tuple[str, list[str]]:
    messages = row.get("messages")
    if not isinstance(messages, list) or not messages:
        raise ValueError(f"validation row {row.get('id')} is missing prompt")
    prompt = _extract_text(messages[0].get("content"))
    images = row.get("images")
    if not isinstance(images, list) or not images:
        raise ValueError(f"validation row {row.get('id')} is missing images")
    normalized = [str(Path(str(image)).expanduser()) for image in images]
    missing = [image for image in normalized if not Path(image).is_file()]
    if missing:
        raise FileNotFoundError(
            f"validation row {row.get('id')} has missing image(s): {missing}"
        )
    return prompt, normalized


def _load_rows(dataset_export: Path, required_examples: int) -> list[dict[str, Any]]:
    validation_path = dataset_export / "validation.jsonl"
    manifest_path = dataset_export / "manifest.json"
    if not validation_path.is_file():
        raise SystemExit(f"Held-out validation split is missing: {validation_path}")
    if not manifest_path.is_file():
        raise SystemExit(f"Training export manifest is missing: {manifest_path}")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    rows = [json.loads(line) for line in validation_path.read_text("utf-8").splitlines() if line.strip()]
    if int(manifest.get("validation_examples", -1)) != len(rows):
        raise SystemExit(
            "Held-out validation row count disagrees with manifest: "
            f"manifest={manifest.get('validation_examples')} rows={len(rows)}"
        )
    if len(rows) != required_examples:
        raise SystemExit(
            f"Promotion gate requires exactly {required_examples} held-out examples; found {len(rows)}."
        )
    ids = [str(row.get("id") or "") for row in rows]
    if not all(ids) or len(ids) != len(set(ids)):
        raise SystemExit("Held-out validation rows must have unique non-empty ids.")
    for row in rows:
        _expected_payload(row)
        _prompt_and_images(row)
    return rows


def _validate_adapter(adapter: Path) -> Path:
    adapter = adapter.expanduser().resolve()
    if not adapter.is_dir():
        raise SystemExit(f"Adapter candidate is not a directory: {adapter}")
    config = adapter / "adapter_config.json"
    weights = adapter / "adapters.safetensors"
    if not config.is_file():
        raise SystemExit(f"Adapter candidate is missing adapter_config.json: {adapter}")
    if not weights.is_file() or weights.stat().st_size <= 0:
        raise SystemExit(f"Adapter candidate is missing adapters.safetensors: {adapter}")
    return adapter


def _load_cache(path: Path) -> dict[str, dict[str, Any]]:
    if not path.is_file():
        return {}
    cached: dict[str, dict[str, Any]] = {}
    for line in path.read_text("utf-8").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        row_id = str(item.get("id") or "")
        if row_id:
            cached[row_id] = item
    return cached


def _append_cache(path: Path, item: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=False) + "\n")
        handle.flush()


def _generation_text(output: Any) -> str:
    text = getattr(output, "text", None)
    return str(text if text is not None else output)


def _run_predictions(
    *,
    rows: list[dict[str, Any]],
    model_name: str,
    adapter: Path | None,
    cache_path: Path,
    max_tokens: int,
) -> dict[str, dict[str, Any]]:
    cached = _load_cache(cache_path)
    remaining = [row for row in rows if str(row["id"]) not in cached]
    if not remaining:
        print(f"CACHE {cache_path.name}: {len(cached)}/{len(rows)} complete", flush=True)
        return cached

    if sys.platform != "darwin":
        raise SystemExit("MLX-VLM held-out validation must run on the Apple Silicon Mac runtime.")

    from mlx_vlm import generate, load
    from mlx_vlm.prompt_utils import apply_chat_template

    label = "adapter" if adapter else "base"
    print(f"LOAD {label}: {model_name}", flush=True)
    model, processor = load(model_name, adapter_path=str(adapter) if adapter else None)
    try:
        total = len(rows)
        for row in rows:
            row_id = str(row["id"])
            if row_id in cached:
                continue
            prompt, images = _prompt_and_images(row)
            formatted = apply_chat_template(
                processor,
                model.config,
                prompt,
                num_images=len(images),
            )
            output = generate(
                model,
                processor,
                formatted,
                images,
                max_tokens=max_tokens,
                temperature=0.0,
                verbose=False,
            )
            raw = _generation_text(output)
            parsed = _parse_json_object(raw)
            item = {
                "id": row_id,
                "mode": label,
                "raw": raw,
                "parsed": parsed,
            }
            _append_cache(cache_path, item)
            cached[row_id] = item
            print(f"{label.upper()} {len(cached):02d}/{total:02d} {row_id}", flush=True)
    finally:
        del model
        del processor
        gc.collect()
        try:
            import mlx.core as mx

            mx.clear_cache()
        except Exception:
            pass
    return cached


def _field_match(expected: dict[str, Any], predicted: dict[str, Any] | None, field: str) -> bool:
    if predicted is None:
        return False
    return _normalize(predicted.get(field)) == _normalize(expected.get(field))


def score_predictions(
    rows: list[dict[str, Any]],
    baseline: dict[str, dict[str, Any]],
    candidate: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    totals = {
        "examples": len(rows),
        "identity_fields": len(rows) * len(IDENTITY_FIELDS),
        "critical_fields": len(rows) * len(CRITICAL_FIELDS),
    }
    base = {
        "parse_success": 0,
        "identity_field_correct": 0,
        "critical_field_correct": 0,
        "full_identity_exact_cards": 0,
        "critical_identity_exact_cards": 0,
    }
    cand = dict(base)
    regressions: list[dict[str, Any]] = []
    improvements: list[dict[str, Any]] = []
    cards: list[dict[str, Any]] = []

    for row in rows:
        row_id = str(row["id"])
        expected = _expected_payload(row)["identity"]
        base_payload = baseline.get(row_id, {}).get("parsed")
        cand_payload = candidate.get(row_id, {}).get("parsed")
        base_identity = base_payload.get("identity") if isinstance(base_payload, dict) and isinstance(base_payload.get("identity"), dict) else None
        cand_identity = cand_payload.get("identity") if isinstance(cand_payload, dict) and isinstance(cand_payload.get("identity"), dict) else None
        if base_identity is not None:
            base["parse_success"] += 1
        if cand_identity is not None:
            cand["parse_success"] += 1

        base_matches = {field: _field_match(expected, base_identity, field) for field in IDENTITY_FIELDS}
        cand_matches = {field: _field_match(expected, cand_identity, field) for field in IDENTITY_FIELDS}
        base_critical = {field: base_matches[field] for field in CRITICAL_FIELDS}
        cand_critical = {field: cand_matches[field] for field in CRITICAL_FIELDS}

        base["identity_field_correct"] += sum(base_matches.values())
        cand["identity_field_correct"] += sum(cand_matches.values())
        base["critical_field_correct"] += sum(base_critical.values())
        cand["critical_field_correct"] += sum(cand_critical.values())
        base["full_identity_exact_cards"] += int(all(base_matches.values()))
        cand["full_identity_exact_cards"] += int(all(cand_matches.values()))
        base["critical_identity_exact_cards"] += int(all(base_critical.values()))
        cand["critical_identity_exact_cards"] += int(all(cand_critical.values()))

        row_regressions = []
        row_improvements = []
        for field in CRITICAL_FIELDS:
            if base_critical[field] and not cand_critical[field]:
                event = {
                    "id": row_id,
                    "field": field,
                    "expected": expected.get(field),
                    "baseline": base_identity.get(field) if base_identity else None,
                    "candidate": cand_identity.get(field) if cand_identity else None,
                }
                regressions.append(event)
                row_regressions.append(field)
            elif not base_critical[field] and cand_critical[field]:
                event = {
                    "id": row_id,
                    "field": field,
                    "expected": expected.get(field),
                    "baseline": base_identity.get(field) if base_identity else None,
                    "candidate": cand_identity.get(field) if cand_identity else None,
                }
                improvements.append(event)
                row_improvements.append(field)
        cards.append({
            "id": row_id,
            "scan_id": row.get("metadata", {}).get("scan_id"),
            "card_uuid": row.get("metadata", {}).get("card_uuid"),
            "baseline_critical_correct": sum(base_critical.values()),
            "candidate_critical_correct": sum(cand_critical.values()),
            "critical_regressions": row_regressions,
            "critical_improvements": row_improvements,
        })

    for stats in (base, cand):
        stats["identity_field_accuracy"] = stats["identity_field_correct"] / totals["identity_fields"] if totals["identity_fields"] else 0.0
        stats["critical_field_accuracy"] = stats["critical_field_correct"] / totals["critical_fields"] if totals["critical_fields"] else 0.0
        stats["full_identity_exact_accuracy"] = stats["full_identity_exact_cards"] / totals["examples"] if totals["examples"] else 0.0
        stats["critical_identity_exact_accuracy"] = stats["critical_identity_exact_cards"] / totals["examples"] if totals["examples"] else 0.0

    strict_improvement = (
        cand["critical_field_correct"] > base["critical_field_correct"]
        or cand["critical_identity_exact_cards"] > base["critical_identity_exact_cards"]
        or cand["full_identity_exact_cards"] > base["full_identity_exact_cards"]
    )
    no_critical_regressions = len(regressions) == 0
    parse_not_worse = cand["parse_success"] >= base["parse_success"]
    candidate_not_worse_exact = (
        cand["critical_identity_exact_cards"] >= base["critical_identity_exact_cards"]
        and cand["full_identity_exact_cards"] >= base["full_identity_exact_cards"]
    )
    promotion_candidate = (
        strict_improvement
        and no_critical_regressions
        and parse_not_worse
        and candidate_not_worse_exact
    )
    return {
        "schema_version": "tcos.instacomp-ai.lora-validation-score.v1",
        "totals": totals,
        "baseline": base,
        "candidate": cand,
        "critical_regressions": regressions,
        "critical_improvements": improvements,
        "cards": cards,
        "gates": {
            "strict_improvement": strict_improvement,
            "no_critical_regressions": no_critical_regressions,
            "parse_not_worse": parse_not_worse,
            "candidate_not_worse_exact": candidate_not_worse_exact,
            "promotion_candidate": promotion_candidate,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare a trained InstaComp LoRA adapter against the untouched base model on the held-out teacher split."
    )
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--dataset-export", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--required-examples", type=int, default=30)
    parser.add_argument("--max-tokens", type=int, default=768)
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()

    adapter = _validate_adapter(args.adapter)
    dataset_export = args.dataset_export.expanduser().resolve()
    rows = _load_rows(dataset_export, args.required_examples)
    cache_dir = adapter / "validation-cache"
    dataset_key = dataset_export.name
    base_cache = cache_dir / f"{dataset_key}-base.jsonl"
    adapter_cache = cache_dir / f"{dataset_key}-adapter.jsonl"
    receipt_path = adapter / f"validation-{dataset_key}.json"

    preflight = {
        "schema_version": "tcos.instacomp-ai.lora-validation-preflight.v1",
        "status": "ready",
        "model": args.model,
        "adapter": str(adapter),
        "dataset_export": str(dataset_export),
        "held_out_examples": len(rows),
        "base_cache": str(base_cache),
        "adapter_cache": str(adapter_cache),
        "receipt": str(receipt_path),
        "nothing_promoted": True,
    }
    print(json.dumps(preflight, indent=2), flush=True)
    if args.preflight_only:
        return 0

    baseline = _run_predictions(
        rows=rows,
        model_name=args.model,
        adapter=None,
        cache_path=base_cache,
        max_tokens=args.max_tokens,
    )
    candidate = _run_predictions(
        rows=rows,
        model_name=args.model,
        adapter=adapter,
        cache_path=adapter_cache,
        max_tokens=args.max_tokens,
    )
    score = score_predictions(rows, baseline, candidate)
    receipt = {
        "schema_version": "tcos.instacomp-ai.lora-validation.v1",
        "model": args.model,
        "adapter": str(adapter),
        "dataset_export": str(dataset_export),
        "held_out_examples": len(rows),
        "score": score,
        "promotion": {
            "eligible_for_runtime_candidate": score["gates"]["promotion_candidate"],
            "automatic_deployment": False,
            "next_required_gate": "wire candidate adapter into InstaComp AI runtime, then rerun the frozen five Production truth gate 5/5 twice with zero regressions",
        },
    }
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(receipt, indent=2), flush=True)
    return 0 if score["gates"]["promotion_candidate"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
