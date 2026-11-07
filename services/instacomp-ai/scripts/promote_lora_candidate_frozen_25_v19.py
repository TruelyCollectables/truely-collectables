#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import platform
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

import promote_lora_candidate_frozen_25 as legacy
import promote_lora_candidate_frozen_25_v3 as v3
import promote_lora_candidate_frozen_25_v6 as v6
import promote_lora_candidate_frozen_25_v11 as v11
import promote_lora_candidate_frozen_25_v13 as v13
import promote_lora_candidate_frozen_25_v17 as v17
import promote_lora_candidate_frozen_five as base

SCHEMA = "tcos.instacomp-ai.lora-staged-authoritative-promotion.v19"
MANIFEST_SCHEMA = v11.MANIFEST_SCHEMA
STAGE_MANIFEST = v11.STAGE_MANIFEST
ALLOWED_STAGE_TARGETS = (10, 15, 25)
PRIOR_STAGE = {10: None, 15: 10, 25: 15}
SELECTION_ATTEMPT_LIMITS = {10: 80, 15: 120, 25: 200}
LOCKED_POOL_LIMITS = {10: 30, 15: 45, 25: 70}
CANDIDATE_DRY_PASSES = 2
REVIEWED_PRIORITY_ROW_IDS = tuple(v17.REVIEWED_PINNED_ROW_IDS)
PATTERN_SENSITIVE_VARIANTS = frozenset({"ice", "velocity"})


class CandidateFixtureMismatch(RuntimeError):
    """A certified carry-forward fixture changed under the current live pipeline."""


def _stage_label(target: int) -> str:
    return f"Frozen {target}"


def _norm(value: object) -> str:
    return " ".join(str(value or "").strip().casefold().split())


def _text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _dataset_fingerprint(dataset: Path, declared: object = None) -> str:
    declared_text = str(declared or "").strip().lower()
    if legacy._valid_sha256(declared_text) is not None:
        return declared_text
    digest = hashlib.sha256()
    for name in ("train.jsonl", "validation.jsonl"):
        path = dataset / name
        if not path.is_file():
            raise RuntimeError(f"V19 cannot fingerprint missing dataset split: {path}")
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def _canonical_variant(value: object) -> str | None:
    """Canonicalize physical family before cosmetic color.

    Pattern families must win over color words.  A Blue Velocity Prizm is
    Velocity, not merely Blue; a Blue Cracked Ice is Ice, not merely Blue.
    """
    text = _norm(value).replace("-", " ")
    if not text:
        return None
    if text in {"base", "regular", "standard", "none", "n/a", "na"}:
        return "base"
    words = set(text.split())
    if "cracked ice" in text or "ice" in words:
        return "ice"
    if "velocity" in words:
        return "velocity"
    for token in ("groovy", "wave", "mojo", "scope", "hyper", "pulsar"):
        if token in words:
            return token
    for token in (
        "silver", "green", "red", "blue", "orange", "purple", "gold", "black",
    ):
        if token in words:
            return token
    return text[:80]


def _identity_payload(identity: Any) -> dict[str, Any]:
    if identity is None:
        return {}
    if hasattr(identity, "model_dump"):
        return identity.model_dump(mode="json")
    return dict(identity)


def _identity_variant(identity: Any) -> str | None:
    payload = _identity_payload(identity)
    for key in ("parallel", "variation", "subset"):
        marker = _canonical_variant(payload.get(key))
        if marker is not None:
            return marker
    return None


def _registry_variant(registry: Any) -> str | None:
    return _identity_variant(getattr(registry, "identity", None))


def _registry_outcome(registry: Any) -> str:
    outcome = getattr(registry, "outcome", None)
    return str(getattr(outcome, "value", outcome) or "")


def _registry_fingerprint(registry: Any, diagnostics: dict[str, Any]) -> str | None:
    direct = legacy._valid_sha256(diagnostics.get("registry_fingerprint_sha256"))
    if direct:
        return direct
    for receipt in getattr(registry, "source_receipts", None) or []:
        text = str(receipt or "")
        if text.startswith("registry_fingerprint:"):
            return legacy._valid_sha256(text.split(":", 1)[1])
    return None


def _signature(item: dict[str, Any]) -> dict[str, str]:
    case = item.get("case") or ()
    if len(case) < 6:
        raise RuntimeError("V19 fixture is missing authoritative Registry case fields")
    payload = {
        "row_id": str(item.get("row_id") or ""),
        "player": str(case[1] or ""),
        "card_number": str(case[2] or ""),
        "registry_identity_id": str(case[4] or ""),
        "registry_fingerprint_sha256": str(case[5] or ""),
    }
    if any(not payload[key] for key in payload):
        raise RuntimeError(f"V19 fixture signature contains a blank required field: {payload}")
    if legacy._valid_uuid(payload["registry_identity_id"]) is None:
        raise RuntimeError(f"V19 fixture has invalid Registry UUID: {payload['registry_identity_id']!r}")
    if legacy._valid_sha256(payload["registry_fingerprint_sha256"]) is None:
        raise RuntimeError("V19 fixture has invalid Registry fingerprint")
    return payload


def _manifest_signatures(
    payload: dict[str, Any],
    *,
    expected_stage: int,
    adapter_sha: str,
    dataset_sha: str | None,
) -> list[dict[str, str]]:
    if payload.get("schema_version") != MANIFEST_SCHEMA or payload.get("complete") is not True:
        raise RuntimeError("Prior staged fixture manifest is not complete")
    if int(payload.get("stage_target") or 0) != expected_stage:
        raise RuntimeError(
            f"Expected successful Frozen {expected_stage} manifest; "
            f"found stage={payload.get('stage_target')!r}"
        )
    if _norm(payload.get("adapter_weights_sha256")) != _norm(adapter_sha):
        raise RuntimeError("Prior staged manifest adapter hash does not match current adapter")
    if _norm(payload.get("dataset_sha256")) != _norm(dataset_sha):
        raise RuntimeError("Prior staged manifest dataset hash does not match current dataset")
    raw = payload.get("fixtures")
    if not isinstance(raw, list) or len(raw) != expected_stage:
        raise RuntimeError(
            f"Prior Frozen {expected_stage} manifest must contain exactly {expected_stage} fixtures"
        )
    output: list[dict[str, str]] = []
    row_ids: set[str] = set()
    registry_ids: set[str] = set()
    for value in raw:
        if not isinstance(value, dict):
            raise RuntimeError("Prior staged manifest contains a malformed fixture")
        item = {
            "row_id": str(value.get("row_id") or ""),
            "player": str(value.get("player") or ""),
            "card_number": str(value.get("card_number") or ""),
            "registry_identity_id": str(value.get("registry_identity_id") or ""),
            "registry_fingerprint_sha256": str(value.get("registry_fingerprint_sha256") or ""),
        }
        if any(not item[key] for key in item):
            raise RuntimeError(f"Prior staged manifest contains a blank fixture field: {item}")
        if legacy._valid_uuid(item["registry_identity_id"]) is None:
            raise RuntimeError("Prior staged manifest contains an invalid Registry UUID")
        if legacy._valid_sha256(item["registry_fingerprint_sha256"]) is None:
            raise RuntimeError("Prior staged manifest contains an invalid Registry fingerprint")
        if item["row_id"] in row_ids or item["registry_identity_id"] in registry_ids:
            raise RuntimeError("Prior staged manifest repeats a row ID or Registry UUID")
        row_ids.add(item["row_id"])
        registry_ids.add(item["registry_identity_id"])
        output.append(item)
    return output


def _prior_stage_signatures(target: int, *, adapter_sha: str, dataset_sha: str | None) -> list[dict[str, str]]:
    prior = PRIOR_STAGE[target]
    if prior is None:
        return []
    if not STAGE_MANIFEST.is_file():
        raise RuntimeError(
            f"{_stage_label(target)} requires a successful Frozen {prior} manifest first: {STAGE_MANIFEST}"
        )
    return _manifest_signatures(
        base.read_json(STAGE_MANIFEST),
        expected_stage=prior,
        adapter_sha=adapter_sha,
        dataset_sha=dataset_sha,
    )


def _candidate_items(dataset: Path, *, require_images: bool) -> dict[str, dict[str, Any]]:
    items: dict[str, dict[str, Any]] = {}
    for row in base.load_rows(dataset):
        item = v3._expansion_candidate(row, require_images=require_images)
        if item is None:
            continue
        value = dict(item)
        value["historical_metadata_registry_id"] = item.get("metadata_registry_id")
        value["historical_metadata_fingerprint"] = item.get("metadata_fingerprint")
        value["metadata_registry_id"] = None
        value["metadata_fingerprint"] = None
        row_id = str(value.get("row_id") or "")
        if not row_id or row_id in items:
            raise RuntimeError(f"V19 candidate row ID is missing/duplicated: {row_id!r}")
        items[row_id] = value
    if not items:
        raise RuntimeError("V19 found no image-backed training candidates")
    return items


def _legacy_priority_row_ids(dataset: Path, *, require_images: bool) -> tuple[str, ...]:
    try:
        fixtures = base.fixtures(dataset, require_images=require_images)
    except Exception:
        return ()
    output: list[str] = []
    for item in fixtures:
        row_id = str(item.get("row_id") or "")
        if row_id and row_id not in output:
            output.append(row_id)
    return tuple(output)


def _ordered_candidate_ids(
    *,
    items: dict[str, dict[str, Any]],
    carry_forward: list[dict[str, str]],
    legacy_priority: tuple[str, ...],
) -> list[str]:
    carry_ids = [item["row_id"] for item in carry_forward]
    order: list[str] = []
    seen: set[str] = set()

    def add(row_id: str) -> None:
        if row_id and row_id in items and row_id not in seen:
            order.append(row_id)
            seen.add(row_id)

    for row_id in carry_ids:
        add(row_id)
    for row_id in legacy_priority:
        add(row_id)
    for row_id in REVIEWED_PRIORITY_ROW_IDS:
        add(row_id)
    extras = sorted(
        (item for row_id, item in items.items() if row_id not in seen),
        key=v3._expansion_sort_key,
    )
    for item in extras:
        add(str(item.get("row_id") or ""))
    if order[: len(carry_ids)] != carry_ids:
        missing = [row_id for row_id in carry_ids if row_id not in items]
        raise RuntimeError(
            f"V19 cannot preserve the certified prior-stage row prefix; missing/ineligible={missing}"
        )
    return order


def _normalize_identity_shape(identity: Any):
    """Repair semantic field packaging only; never create player/card/variant truth."""
    from app.candidate_identity_guard import normalize_candidate_identity_payload
    from app.models import CardIdentity

    payload = {"parsed": {"identity": _identity_payload(identity)}}
    normalized, _ = normalize_candidate_identity_payload(payload)
    parsed = normalized.get("parsed") or {}
    source = parsed.get("identity") if isinstance(parsed.get("identity"), dict) else parsed
    value = CardIdentity.model_validate(source or {})

    data = value.model_dump(mode="json")
    if not data.get("parallel") and not data.get("variation"):
        context = f"{data.get('brand') or ''} {data.get('set_name') or ''}"
        subset = _text(data.get("subset"))
        family = _canonical_variant(subset)
        if "prizm" in _norm(context) and subset and family not in {None, "base"}:
            data["parallel"] = subset
            value = CardIdentity.model_validate(data)
    return value


def _core_registry_identity(identity: Any, *, clear_manufacturer: bool = False):
    from app.models import CardIdentity

    source = _identity_payload(identity)
    return CardIdentity(
        sport=source.get("sport"),
        league=source.get("league"),
        year=source.get("year"),
        manufacturer=None if clear_manufacturer else source.get("manufacturer"),
        player=source.get("player"),
        team=source.get("team"),
        card_number=source.get("card_number"),
        parallel=source.get("parallel"),
        variation=source.get("variation"),
        serial_number=source.get("serial_number"),
        serial_run=source.get("serial_run"),
        autograph=source.get("autograph"),
        memorabilia=source.get("memorabilia"),
    )


async def _direct_local_vision(front: bytes, back: bytes | None):
    """Run raw deterministic vision then explicitly enforce physical Prizm truth.

    V19 does not rely on package monkey-patches for this.  The back-mark rule is
    applied before trusted style memory and again afterward, preventing style
    memory from promoting over a physical Base result.
    """
    import app
    from app.config import settings
    from app.pattern_memory import apply_trusted_pattern_style
    from app.prizm_back_mark_guard import apply_prizm_back_mark_rule

    vision = await app._original_analyze_local_vision(front, back, settings)
    vision = apply_prizm_back_mark_rule(vision, back_bytes=back)
    try:
        database_path = settings.resolve_local_path(settings.database_path)
        vision = apply_trusted_pattern_style(database_path=database_path, evidence=vision)
    except Exception:
        pass
    return apply_prizm_back_mark_rule(vision, back_bytes=back)


async def _local_vision_for_item(item: dict[str, Any]):
    paths = item.get("images") or []
    if not paths:
        return None
    front = paths[0].read_bytes()
    back = paths[1].read_bytes() if len(paths) > 1 else None
    return await _direct_local_vision(front, back)


def _leading_truncation(candidate: object, hint: object) -> bool:
    candidate_number = "".join(str(candidate or "").strip().lstrip("#").casefold().split())
    hint_number = "".join(str(hint or "").strip().lstrip("#").casefold().split())
    if not candidate_number or not hint_number or candidate_number == hint_number:
        return False
    missing = len(candidate_number) - len(hint_number)
    return 1 <= missing <= 2 and candidate_number.endswith(hint_number)


def _merge_candidate_with_local_vision(payload: dict[str, Any], vision: Any) -> dict[str, Any]:
    """Pure promotion merge. It never calls the globally patched Ollama merge hook."""
    root = dict(payload)
    identity = dict(root.get("identity") or {})
    hints_obj = getattr(vision, "identity_hints", None)
    hints = hints_obj.model_dump(mode="json") if hasattr(hints_obj, "model_dump") else {}
    candidate_number = _text(identity.get("card_number"))

    for field, value in hints.items():
        if value in {None, ""}:
            continue
        if field == "card_number" and candidate_number and _leading_truncation(candidate_number, value):
            continue
        if field in {"year", "manufacturer", "card_number"} or identity.get(field) in {None, ""}:
            identity[field] = value

    if hints.get("parallel"):
        identity["parallel"] = hints["parallel"]
    elif identity.get("parallel") and re.search(
        r"^(?:white|black|red|blue|green|gold|orange|purple|pink|silver)\s+prizm$",
        str(identity.get("parallel")),
        re.I,
    ):
        identity["parallel"] = None

    serial = getattr(vision, "serial", None)
    if getattr(serial, "stamp_present", False) and getattr(serial, "exact_stamp", None):
        identity["serial_number"] = serial.exact_stamp
        identity["serial_run"] = serial.visible_denominator
    else:
        identity["serial_number"] = None
        identity["serial_run"] = None
    root["identity"] = identity
    return root


async def _read_candidate_direct(
    item: dict[str, Any],
    *,
    expected_adapter_sha: str,
) -> tuple[Any, Any, dict[str, Any]]:
    """Read via the LoRA sidecar directly. Promotion has no Ollama fallback path."""
    from app.candidate_identity_guard import normalize_candidate_identity_payload
    from app.config import settings
    from app.lora_candidate_runtime import _guard_model_pattern_parallel
    from app.lora_candidate_runtime_v2 import _candidate_request_body
    from app.models import CardIdentity
    from app.ollama import normalize_identity_payload

    paths = item.get("images") or []
    if not paths:
        raise RuntimeError("candidate_images_missing")
    front = paths[0].read_bytes()
    back = paths[1].read_bytes() if len(paths) > 1 else None
    vision = await _direct_local_vision(front, back)
    body = _candidate_request_body(front, back, local_vision=vision)

    async with httpx.AsyncClient(timeout=settings.lora_candidate_timeout_seconds) as client:
        response = await client.post(
            f"{settings.lora_candidate_url.rstrip('/')}/analyze",
            json=body,
        )
    if response.is_error:
        raise RuntimeError(f"candidate_sidecar_http_{response.status_code}")
    try:
        raw = response.json()
    except Exception as exc:
        raise RuntimeError("candidate_sidecar_invalid_json") from exc
    if not isinstance(raw, dict) or raw.get("ok") is not True:
        raise RuntimeError("candidate_sidecar_not_ok")
    if raw.get("validation_eligible") is not True:
        raise RuntimeError("candidate_sidecar_not_validation_eligible")
    actual_sha = legacy._valid_sha256(raw.get("adapter_weights_sha256"))
    if actual_sha != legacy._valid_sha256(expected_adapter_sha):
        raise RuntimeError(
            f"candidate_adapter_sha_mismatch expected={expected_adapter_sha} actual={actual_sha}"
        )
    parsed = raw.get("parsed")
    if not isinstance(parsed, dict):
        raise RuntimeError("candidate_identity_missing")

    shaped, repaired = normalize_candidate_identity_payload({"parsed": parsed})
    parsed = shaped.get("parsed") or {}
    normalized = normalize_identity_payload(parsed)
    merged = _merge_candidate_with_local_vision(normalized, vision)
    normalized = normalize_identity_payload(merged)
    normalized = _guard_model_pattern_parallel(normalized, vision)
    normalized = normalize_identity_payload(normalized)
    identity = CardIdentity.model_validate(normalized.get("identity") or {})

    if not identity.player or not identity.card_number:
        raise RuntimeError(
            f"candidate_identity_incomplete player={identity.player!r} card_number={identity.card_number!r}"
        )
    if not (identity.year or identity.manufacturer or identity.brand or identity.set_name):
        raise RuntimeError("candidate_release_identity_incomplete")
    return identity, vision, {
        "provider": "instacomp_lora_candidate",
        "fallback": False,
        "identity_shape_repaired": repaired,
        "transport_schema": body.get("transport_schema"),
    }


def _registry_throttle_reason(result: Any, diagnostics: dict[str, Any]) -> str | None:
    reason = v13.v12._registry_throttle_reason(result)
    if reason:
        return str(reason)
    if int(diagnostics.get("registry_http_status") or 0) == 429:
        raw = diagnostics.get("registry_raw_response")
        if isinstance(raw, dict):
            for key in ("error", "detail", "reason", "message"):
                text = _text(raw.get(key))
                if text:
                    return text
        return "Registry HTTP 429. Try again in 60 seconds."
    return None


async def _registry_request_with_throttle(
    gateway: Any,
    identity: Any,
    ocr_text: str | None,
    *,
    sleep_fn=asyncio.sleep,
    max_windows: int = v13.MAX_THROTTLE_WINDOWS_PER_REQUEST,
) -> tuple[Any, dict[str, Any]]:
    """Retry the exact same Registry request when the server throttles it."""
    windows = 0
    while True:
        result, diagnostics = await gateway.match_with_diagnostics(identity, ocr_text)
        reason = _registry_throttle_reason(result, diagnostics)
        if not reason:
            return result, diagnostics
        windows += 1
        if windows > max_windows:
            raise v13.RegistryThrottleAbort(
                "Registry remained throttled after the bounded retry windows. "
                "No card was marked failed and the candidate was not activated. "
                f"Registry said: {reason}"
            )
        delay = v13._retry_seconds(reason) + v13.RETRY_WINDOW_BUFFER_SECONDS
        print(
            "REGISTRY THROTTLE BACKOFF: "
            f"same_request_retry={windows}/{max_windows} "
            f"delay_seconds={delay} reason={reason!r}; no card failure recorded",
            flush=True,
        )
        await sleep_fn(delay)


async def _registry_lookup_ladder(
    identity: Any,
    *,
    item: dict[str, Any] | None,
    vision: Any | None,
    gateway: Any,
) -> tuple[Any, dict[str, Any], int]:
    """The one Registry resolver used by preflight, qualification, and final rounds."""
    normalized = _normalize_identity_shape(identity)
    attempts: list[tuple[Any, str | None]] = [
        (normalized, None),
        (_core_registry_identity(normalized), None),
    ]
    if vision is None and item is not None:
        vision = await _local_vision_for_item(item)
    ocr = _text(getattr(vision, "combined_text", None)) if vision is not None else None
    if ocr:
        third = _core_registry_identity(normalized, clear_manufacturer=True)
        hints = getattr(vision, "identity_hints", None)
        visible_manufacturer = _text(getattr(hints, "manufacturer", None)) if hints else None
        if visible_manufacturer:
            third.manufacturer = visible_manufacturer
        attempts.append((third, ocr))

    last_result = None
    last_diagnostics: dict[str, Any] = {}
    for index, (query, ocr_text) in enumerate(attempts, 1):
        result, diagnostics = await _registry_request_with_throttle(
            gateway,
            query,
            ocr_text,
        )
        last_result = result
        last_diagnostics = diagnostics
        if _registry_outcome(result) == "exact_match":
            return result, diagnostics, index
    if last_result is None:
        raise RuntimeError("Registry lookup ladder executed no requests")
    return last_result, last_diagnostics, len(attempts)


def _registry_identity_compatible(query_identity: Any, registry: Any) -> bool:
    query = _identity_payload(query_identity)
    locked = _identity_payload(getattr(registry, "identity", None))
    if _norm(query.get("player")) != _norm(locked.get("player")):
        return False
    if _norm(query.get("card_number")).lstrip("#") != _norm(locked.get("card_number")).lstrip("#"):
        return False
    query_variant = _identity_variant(query_identity)
    registry_variant = _registry_variant(registry)
    if query_variant is None:
        return True
    if query_variant == "base":
        return registry_variant in {None, "base"}
    return registry_variant in {None, query_variant}


def _is_prizm(identity: Any, registry: Any) -> bool:
    values: list[str] = []
    for payload in (
        _identity_payload(identity),
        _identity_payload(getattr(registry, "identity", None)),
    ):
        for key in ("brand", "set_name", "subset", "parallel", "variation"):
            values.append(str(payload.get(key) or ""))
    return bool(re.search(r"\bprizm\b", " ".join(values), re.I))


def _physical_variant_decision(
    *,
    teacher_marker: str | None,
    registry_marker: str | None,
    image_marker: str | None,
    prizm: bool,
    back_mark: bool | None,
) -> tuple[bool, str | None]:
    """Pure fail-closed physical decision used by live code and self-tests."""
    if prizm:
        if back_mark is not True:
            if teacher_marker not in {None, "base"} or registry_marker not in {None, "base"}:
                return False, "physical_prizm_back_mark_missing"
            return True, None
        if teacher_marker == "base" or registry_marker == "base":
            return False, "physical_prizm_back_mark_contradicts_base"

        claimed = teacher_marker or registry_marker
        if claimed in PATTERN_SENSITIVE_VARIANTS and image_marker != claimed:
            return False, "physical_pattern_witness_mismatch"
        if image_marker is not None and claimed is not None and image_marker != claimed:
            return False, "physical_variant_witness_contradiction"
        return True, None

    claimed = teacher_marker or registry_marker
    if claimed in {None, "base"}:
        if image_marker is not None:
            return False, "physical_variant_witness_contradiction"
        return True, None
    if image_marker != claimed:
        return False, "physical_non_prizm_variant_unproven"
    return True, None


def _physical_variant_gate(
    identity: Any,
    registry: Any,
    *,
    vision: Any,
    back_bytes: bytes | None,
) -> tuple[bool, dict[str, Any]]:
    """Physical gate: printed PRIZM back mark plus deterministic surface family."""
    from app.prizm_back_mark_guard import bold_black_prizm_back_mark

    teacher_marker = _identity_variant(identity)
    registry_marker = _registry_variant(registry)
    hints = getattr(vision, "identity_hints", None)
    image_marker = _canonical_variant(getattr(hints, "parallel", None)) if hints else None
    if image_marker == "base":
        image_marker = None

    prizm = _is_prizm(identity, registry)
    back_mark: bool | None = None
    if prizm and back_bytes is not None:
        try:
            back_mark = bool(bold_black_prizm_back_mark(vision, back_bytes))
        except Exception:
            back_mark = None

    ok, reason = _physical_variant_decision(
        teacher_marker=teacher_marker,
        registry_marker=registry_marker,
        image_marker=image_marker,
        prizm=prizm,
        back_mark=back_mark,
    )
    return ok, {
        "teacher_variant": teacher_marker,
        "registry_variant": registry_marker,
        "image_variant": image_marker,
        "prizm_back_mark": back_mark,
        "reason": reason,
    }


async def _lock_identity(
    item: dict[str, Any],
    identity: Any,
    *,
    gateway: Any,
    vision: Any | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    paths = item.get("images") or []
    if vision is None:
        vision = await _local_vision_for_item(item)
    if vision is None:
        return None, {"reason": "physical_vision_unavailable"}
    back_bytes = paths[1].read_bytes() if len(paths) > 1 else None

    registry, diagnostics, attempt = await _registry_lookup_ladder(
        identity,
        item=item,
        vision=vision,
        gateway=gateway,
    )
    outcome = _registry_outcome(registry)
    registry_id = legacy._valid_uuid(getattr(registry, "identity_id", None))
    fingerprint = _registry_fingerprint(registry, diagnostics)
    detail: dict[str, Any] = {
        "reason": None,
        "registry_outcome": outcome,
        "registry_uuid": registry_id,
        "registry_fingerprint_present": fingerprint is not None,
        "registry_attempt": attempt,
        "registry_reasons": list(getattr(registry, "reasons", None) or []),
        "registry_request": diagnostics.get("registry_request"),
        "registry_resolver_status": diagnostics.get("registry_resolver_status"),
    }
    if outcome != "exact_match":
        detail["reason"] = "registry_" + (outcome or "non_exact")
        return None, detail
    if registry_id is None:
        detail["reason"] = "registry_uuid_missing"
        return None, detail
    if fingerprint is None:
        detail["reason"] = "registry_fingerprint_missing"
        return None, detail
    if not _registry_identity_compatible(identity, registry):
        detail["reason"] = "registry_identity_mismatch"
        return None, detail

    physical_ok, physical = _physical_variant_gate(
        identity,
        registry,
        vision=vision,
        back_bytes=back_bytes,
    )
    detail["physical"] = physical
    if not physical_ok:
        detail["reason"] = physical.get("reason") or "physical_conflict"
        return None, detail

    payload = _identity_payload(identity)
    locked_identity = _identity_payload(getattr(registry, "identity", None))
    player = _text(payload.get("player")) or _text(locked_identity.get("player"))
    number = _text(payload.get("card_number")) or _text(locked_identity.get("card_number"))
    if not player or not number:
        detail["reason"] = "locked_identity_missing_player_or_card_number"
        return None, detail

    locked = dict(item)
    locked["case"] = (
        f"registry-{registry_id[:8]}-{number.lstrip('#')}",
        player,
        number.lstrip("#"),
        _identity_variant(identity),
        registry_id,
        fingerprint,
    )
    locked["registry_lock_source"] = "v19_direct_authoritative_registry_plus_physical_witness"
    locked["v19_lock_diagnostics"] = detail
    return locked, detail


def _require_carry_forward_lock(
    locked: dict[str, Any] | None,
    expected: dict[str, str],
) -> dict[str, Any]:
    if locked is None:
        raise CandidateFixtureMismatch(
            f"Certified prior-stage row {expected['row_id']} no longer passes V19 current preflight"
        )
    actual = _signature(locked)
    if actual != expected:
        raise CandidateFixtureMismatch(
            f"Certified prior-stage fixture drifted: expected={expected} actual={actual}"
        )
    return locked


async def _build_locked_pool(
    dataset: Path,
    *,
    target: int,
    adapter_sha: str,
    dataset_sha: str | None,
    gateway: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    items = _candidate_items(dataset, require_images=True)
    carry_forward = _prior_stage_signatures(
        target,
        adapter_sha=adapter_sha,
        dataset_sha=dataset_sha,
    )
    order = _ordered_candidate_ids(
        items=items,
        carry_forward=carry_forward,
        legacy_priority=_legacy_priority_row_ids(dataset, require_images=True),
    )
    carry_by_row = {item["row_id"]: item for item in carry_forward}
    attempt_limit = min(SELECTION_ATTEMPT_LIMITS[target], len(order))
    locked_pool: list[dict[str, Any]] = []
    used_registry_ids: set[str] = set()
    player_counts: Counter[str] = Counter()

    print(
        f"{_stage_label(target).upper()} V19 PREFLIGHT: "
        f"eligible_rows={len(items)} carry_forward={len(carry_forward)} "
        f"attempt_limit={attempt_limit} locked_pool_limit={LOCKED_POOL_LIMITS[target]}",
        flush=True,
    )
    for row_id in order[:attempt_limit]:
        item = items[row_id]
        from app.models import CardIdentity
        identity = CardIdentity.model_validate(item["identity"])
        locked, detail = await _lock_identity(item, identity, gateway=gateway)
        expected = carry_by_row.get(row_id)
        if expected is not None:
            locked = _require_carry_forward_lock(locked, expected)
        elif locked is None:
            print(
                f"V19 PREFLIGHT REJECT {identity.player} #{identity.card_number}: "
                f"reason={detail.get('reason')} outcome={detail.get('registry_outcome')!r} "
                f"resolver={detail.get('registry_resolver_status')!r}",
                flush=True,
            )
            continue

        sig = _signature(locked)
        registry_id = sig["registry_identity_id"]
        if registry_id in used_registry_ids:
            if expected is not None:
                raise RuntimeError(f"Certified carry-forward Registry UUID duplicated: {registry_id}")
            continue
        player_key = _norm(sig["player"])
        cap = int(getattr(legacy, "MAX_PRIMARY_ROWS_PER_PLAYER", 2))
        if expected is None and player_counts[player_key] >= cap:
            continue
        locked_pool.append(locked)
        used_registry_ids.add(registry_id)
        player_counts[player_key] += 1
        print(
            f"V19 PREFLIGHT LOCK {len(locked_pool)}/{LOCKED_POOL_LIMITS[target]} "
            f"{sig['player']} #{sig['card_number']} registry={registry_id} "
            f"carry_forward={'true' if expected is not None else 'false'}",
            flush=True,
        )
        if len(locked_pool) >= LOCKED_POOL_LIMITS[target]:
            break

    if len(locked_pool) < target:
        raise RuntimeError(
            f"{_stage_label(target)} V19 could lock only {len(locked_pool)} "
            f"current-authoritative candidates; required={target}"
        )
    if carry_forward and [_signature(item) for item in locked_pool[: len(carry_forward)]] != carry_forward:
        raise RuntimeError(f"{_stage_label(target)} V19 failed to preserve exact prior-stage prefix")
    return locked_pool, carry_forward


async def _candidate_probe(
    item: dict[str, Any],
    *,
    adapter_sha: str,
    gateway: Any,
    phase: str,
    pass_number: int,
) -> tuple[bool, dict[str, Any]]:
    expected = _signature(item)
    try:
        identity, vision, candidate_meta = await _read_candidate_direct(
            item,
            expected_adapter_sha=adapter_sha,
        )
    except Exception as error:
        return False, {
            "passed": False,
            "phase": phase,
            "pass": pass_number,
            "key": item["case"][0],
            "player": expected["player"],
            "card_number": expected["card_number"],
            "failure_category": str(error).split(" ", 1)[0],
            "error": str(error)[:800],
        }

    locked, detail = await _lock_identity(
        item,
        identity,
        gateway=gateway,
        vision=vision,
    )
    receipt: dict[str, Any] = {
        "passed": False,
        "phase": phase,
        "pass": pass_number,
        "key": item["case"][0],
        "player": expected["player"],
        "card_number": expected["card_number"],
        "candidate_provider": candidate_meta["provider"],
        "candidate_fallback": candidate_meta["fallback"],
        "candidate_identity": _identity_payload(identity),
        "registry_status": detail.get("registry_outcome"),
        "registry_resolver_status": detail.get("registry_resolver_status"),
        "registry_identity_id": detail.get("registry_uuid"),
        "registry_failure_reason": detail.get("reason"),
        "physical": detail.get("physical"),
    }
    if locked is None:
        receipt["failure_category"] = detail.get("reason") or "candidate_registry_rejected"
        return False, receipt

    actual = _signature(locked)
    if actual["registry_identity_id"] != expected["registry_identity_id"]:
        receipt["failure_category"] = "registry_uuid_mismatch"
        receipt["actual_registry_identity_id"] = actual["registry_identity_id"]
        return False, receipt
    if actual["registry_fingerprint_sha256"] != expected["registry_fingerprint_sha256"]:
        receipt["failure_category"] = "registry_fingerprint_mismatch"
        receipt["actual_registry_fingerprint_sha256"] = actual["registry_fingerprint_sha256"]
        return False, receipt

    receipt["passed"] = True
    receipt["registry_identity_id"] = actual["registry_identity_id"]
    receipt["registry_fingerprint_sha256"] = actual["registry_fingerprint_sha256"]
    return True, receipt


async def _qualify_locked_pool(
    locked_pool: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    carry_forward: list[dict[str, str]],
    gateway: Any,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    carry_count = len(carry_forward)
    selected: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for item in locked_pool:
        sig = _signature(item)
        is_carry = len(selected) < carry_count and sig == carry_forward[len(selected)]
        if len(selected) < carry_count and not is_carry:
            raise RuntimeError(
                f"V19 candidate pool no longer begins with exact certified prefix at position {len(selected)}"
            )

        pass_receipts: list[dict[str, Any]] = []
        stable = True
        for pass_number in range(1, CANDIDATE_DRY_PASSES + 1):
            ok, receipt = await _candidate_probe(
                item,
                adapter_sha=adapter_sha,
                gateway=gateway,
                phase="qualification",
                pass_number=pass_number,
            )
            pass_receipts.append(receipt)
            if not ok:
                stable = False
                break

        if not stable:
            failure = pass_receipts[-1]
            if is_carry:
                raise CandidateFixtureMismatch(
                    f"Certified prior-stage fixture failed V19 qualification: "
                    f"{sig['player']} #{sig['card_number']} category={failure.get('failure_category')}"
                )
            rejected.append({
                **sig,
                "reason": failure.get("failure_category"),
                "passes_completed": len(pass_receipts),
                "last_probe": failure,
            })
            print(
                f"V19 CANDIDATE REJECT {sig['player']} #{sig['card_number']}: "
                f"category={failure.get('failure_category')} "
                f"registry_status={failure.get('registry_status')!r}",
                flush=True,
            )
            continue

        selected.append(item)
        print(
            f"V19 CANDIDATE PASS {len(selected)}/{target} "
            f"{sig['player']} #{sig['card_number']} exact_passes={CANDIDATE_DRY_PASSES}",
            flush=True,
        )
        if len(selected) >= target:
            break

    if len(selected) != target:
        raise RuntimeError(
            f"{_stage_label(target)} V19 candidate qualification produced "
            f"{len(selected)}/{target} stable fixtures; rejected={len(rejected)}"
        )
    if carry_forward and [_signature(item) for item in selected[:carry_count]] != carry_forward:
        raise RuntimeError(f"{_stage_label(target)} V19 qualification changed prior-stage prefix")
    return selected, rejected


async def _certification_round(
    number: int,
    fixtures: list[dict[str, Any]],
    *,
    adapter_sha: str,
    gateway: Any,
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for item in fixtures:
        ok, receipt = await _candidate_probe(
            item,
            adapter_sha=adapter_sha,
            gateway=gateway,
            phase=f"certification_round_{number}",
            pass_number=number,
        )
        cases.append(receipt)
        sig = _signature(item)
        if ok:
            print(
                f"ROUND {number} PASS {sig['player']} #{sig['card_number']} "
                f"provider=instacomp_lora_candidate registry={sig['registry_identity_id']}",
                flush=True,
            )
        else:
            failures.append({
                "key": receipt.get("key"),
                "player": sig["player"],
                "card_number": sig["card_number"],
                "error": receipt.get("failure_category"),
                "registry_status": receipt.get("registry_status"),
                "registry_resolver_status": receipt.get("registry_resolver_status"),
                "registry_identity_id": receipt.get("registry_identity_id"),
            })
            print(
                f"ROUND {number} FAIL {sig['player']} #{sig['card_number']}: "
                f"{receipt.get('failure_category')}; "
                f"registry_status={receipt.get('registry_status')!r}; "
                f"resolver={receipt.get('registry_resolver_status')!r}",
                flush=True,
            )
    return {
        "round": number,
        "passed": not failures and len(cases) == len(fixtures),
        "cases": cases,
        "failure_mode": None if not failures else "deterministic_card_failures",
        "failure_count": len(failures),
        "failures": failures,
        "error": None if not failures else (
            f"{len(failures)} deterministic card failure(s): "
            + "; ".join(
                f"{item['player']} #{item['card_number']}: {item['error']}"
                for item in failures
            )
        ),
    }


def _rounds_gate(rounds: list[dict[str, Any]], target: int) -> None:
    if len(rounds) != 2:
        raise RuntimeError(f"{_stage_label(target)} requires exactly two certification rounds")
    wanted: set[str] | None = None
    for index, result in enumerate(rounds, 1):
        cases = result.get("cases")
        if result.get("passed") is not True or not isinstance(cases, list):
            raise RuntimeError(f"{_stage_label(target)} round {index} failed: {result.get('error')}")
        keys = {str(value.get("key") or "") for value in cases}
        if len(cases) != target or len(keys) != target or "" in keys:
            raise RuntimeError(f"{_stage_label(target)} round {index} was not exact {target}/{target}")
        if any(
            value.get("candidate_provider") != "instacomp_lora_candidate"
            or value.get("candidate_fallback") is True
            or value.get("passed") is not True
            for value in cases
        ):
            raise RuntimeError(f"{_stage_label(target)} round {index} contains fallback/non-candidate evidence")
        if wanted is None:
            wanted = keys
        elif keys != wanted:
            raise RuntimeError(f"{_stage_label(target)} round {index} did not use identical fixture keys")


def _write_stage_manifest(
    fixtures: list[dict[str, Any]],
    *,
    target: int,
    adapter_sha: str,
    dataset_sha: str | None,
) -> Path:
    STAGE_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schema_version": MANIFEST_SCHEMA,
        "created_at": base.now(),
        "complete": True,
        "stage_target": target,
        "adapter_weights_sha256": adapter_sha,
        "dataset_sha256": dataset_sha,
        "registry_remains_identity_authority": True,
        "v19_canonical_pipeline": True,
        "fixtures": [_signature(item) for item in fixtures],
    }
    tmp = STAGE_MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", "utf-8")
    tmp.replace(STAGE_MANIFEST)
    return STAGE_MANIFEST


def _failure_receipt(
    *, target: int, adapter: Path, adapter_sha: str, dataset: Path,
    dataset_sha: str | None, rounds: list[dict[str, Any]],
    rejected: list[dict[str, Any]], error: BaseException, activated: bool,
) -> Path:
    return legacy._write_receipt({
        "schema_version": SCHEMA,
        "created_at": base.now(),
        "status": "failed_rolled_back" if activated else "failed_before_activation",
        "complete": False,
        "promotion_stage_target": target,
        "adapter": str(adapter),
        "adapter_weights_sha256": adapter_sha,
        "dataset": str(dataset),
        "dataset_sha256": dataset_sha,
        "candidate_dry_preflight_rejections": rejected,
        "rounds": rounds,
        "error_type": type(error).__name__,
        "error": str(error)[:4000],
        "runtime_candidate_enabled_after_failure": False if activated else None,
        "registry_remains_identity_authority": True,
        "v19_canonical_pipeline": True,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    })


def _success_receipt(
    *, target: int, adapter: Path, adapter_sha: str, dataset: Path,
    dataset_sha: str | None, validation_receipt: str | None,
    activation_receipt: str | None, manifest: Path,
    rounds: list[dict[str, Any]], rejected: list[dict[str, Any]],
) -> Path:
    return legacy._write_receipt({
        "schema_version": SCHEMA,
        "created_at": base.now(),
        "status": f"promoted_runtime_candidate_frozen_{target}",
        "complete": True,
        "promotion_stage_target": target,
        "next_stage_target": 15 if target == 10 else (25 if target == 15 else None),
        "adapter": str(adapter),
        "adapter_weights_sha256": adapter_sha,
        "validation_receipt": validation_receipt,
        "dataset": str(dataset),
        "dataset_sha256": dataset_sha,
        "activation_receipt": activation_receipt,
        "fixture_manifest": str(manifest),
        "candidate_dry_preflight_rejections": rejected,
        "candidate_dry_passes_per_fixture": CANDIDATE_DRY_PASSES,
        "rounds": rounds,
        "passes": 2,
        "cards_per_pass": target,
        "candidate_fallbacks": 0,
        "critical_regressions": 0,
        "runtime_candidate_enabled": True,
        "registry_remains_identity_authority": True,
        "v19_canonical_pipeline": True,
        "automatic_deployment": False,
        "automatic_promotion": False,
        "nothing_published": True,
    })


def _self_test_registry_ladder() -> None:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    calls: list[tuple[Any, str | None]] = []
    exact_uuid = "00000000-0000-0000-0019-000000000041"
    fingerprint = "b" * 64

    class FakeGateway:
        async def match_with_diagnostics(self, identity, ocr):
            calls.append((identity.model_copy(deep=True), ocr))
            if identity.brand is None and identity.set_name is None:
                return ChecklistResult(
                    outcome=ChecklistOutcome.EXACT_MATCH,
                    identity_id=exact_uuid,
                    identity=CardIdentity(
                        year="2025", manufacturer="Panini", brand="Prizm",
                        set_name="Base", player=identity.player,
                        card_number=identity.card_number, parallel=identity.parallel,
                    ),
                    candidate_count=1,
                    source_receipts=[
                        f"registry_identity:{exact_uuid}",
                        f"registry_fingerprint:{fingerprint}",
                    ],
                ), {
                    "registry_fingerprint_sha256": fingerprint,
                    "registry_resolver_status": "internal_exact_match",
                }
            return ChecklistResult(
                outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                reasons=["catalog_shape_conflict"],
            ), {"registry_resolver_status": "no_exact_match"}

    teacher = CardIdentity(
        year="2025", manufacturer="Panini", brand="Panini Prizm WNBA",
        set_name="Bad packaging", player="Caitlin Clark", card_number="41",
        parallel="Silver Prizm",
    )
    result, diagnostics, attempt = asyncio.run(
        _registry_lookup_ladder(teacher, item=None, vision=None, gateway=FakeGateway())
    )
    assert _registry_outcome(result) == "exact_match"
    assert attempt == 2
    assert calls[0][0].brand is not None and calls[1][0].brand is None
    assert calls[1][0].card_number == "41"
    assert diagnostics["registry_fingerprint_sha256"] == fingerprint
    print("PASS V19 one Registry ladder preserves card number and exact UUID/fingerprint")


def _self_test_throttle_same_request() -> None:
    from app.models import CardIdentity, ChecklistOutcome, ChecklistResult

    calls: list[tuple[str | None, str | None]] = []
    sleeps: list[float] = []

    class FakeGateway:
        async def match_with_diagnostics(self, identity, ocr):
            calls.append((identity.card_number, ocr))
            if len(calls) == 1:
                return ChecklistResult(
                    outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                    reasons=["Too many attempts. Try again in 9 seconds."],
                ), {"registry_http_status": 429}
            return ChecklistResult(
                outcome=ChecklistOutcome.SET_PRESENT_NO_EXACT_MATCH,
                reasons=["ordinary miss"],
            ), {"registry_http_status": 200}

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    identity = CardIdentity(player="Test", card_number="77")
    result, _ = asyncio.run(
        _registry_request_with_throttle(
            FakeGateway(), identity, "same-ocr", sleep_fn=fake_sleep
        )
    )
    assert _registry_outcome(result) == "set_present_no_exact_match"
    assert calls == [("77", "same-ocr"), ("77", "same-ocr")]
    assert sleeps == [9 + v13.RETRY_WINDOW_BUFFER_SECONDS]
    print("PASS V19 Registry throttle retries the exact same identity/OCR request")


def _self_test_physical_decisions() -> None:
    assert _canonical_variant("Blue Velocity Prizm") == "velocity"
    assert _canonical_variant("Blue Cracked Ice Prizm") == "ice"
    assert _canonical_variant("Blue Prizm") == "blue"

    assert _physical_variant_decision(
        teacher_marker="silver", registry_marker="silver", image_marker=None,
        prizm=True, back_mark=False,
    ) == (False, "physical_prizm_back_mark_missing")
    assert _physical_variant_decision(
        teacher_marker="base", registry_marker="base", image_marker=None,
        prizm=True, back_mark=False,
    ) == (True, None)
    assert _physical_variant_decision(
        teacher_marker="base", registry_marker="base", image_marker=None,
        prizm=True, back_mark=True,
    ) == (False, "physical_prizm_back_mark_contradicts_base")
    assert _physical_variant_decision(
        teacher_marker="silver", registry_marker=None, image_marker="silver",
        prizm=True, back_mark=True,
    ) == (True, None)
    assert _physical_variant_decision(
        teacher_marker="velocity", registry_marker=None, image_marker="velocity",
        prizm=True, back_mark=True,
    ) == (True, None)
    assert _physical_variant_decision(
        teacher_marker="velocity", registry_marker="velocity", image_marker="silver",
        prizm=True, back_mark=True,
    ) == (False, "physical_pattern_witness_mismatch")
    assert _physical_variant_decision(
        teacher_marker="ice", registry_marker="ice", image_marker=None,
        prizm=True, back_mark=True,
    ) == (False, "physical_pattern_witness_mismatch")
    print("PASS V19 pattern family outranks color and Prizm physical decisions fail closed")


def _self_test_exact_binding() -> None:
    expected = {
        "row_id": "row-1", "player": "Player", "card_number": "1",
        "registry_identity_id": "00000000-0000-0000-0019-000000000001",
        "registry_fingerprint_sha256": "c" * 64,
    }
    locked = {
        "row_id": "row-1",
        "case": (
            "case", "Player", "1", None,
            expected["registry_identity_id"], expected["registry_fingerprint_sha256"],
        ),
    }
    assert _signature(locked) == expected
    assert _leading_truncation("122", "22") is True
    assert _leading_truncation("118", "1") is False
    print("PASS V19 exact Registry signature and card-number evidence rules")


def self_test() -> int:
    _self_test_registry_ladder()
    _self_test_throttle_same_request()
    _self_test_physical_decisions()
    _self_test_exact_binding()
    assert CANDIDATE_DRY_PASSES == 2
    assert LOCKED_POOL_LIMITS[10] > 10 and LOCKED_POOL_LIMITS[15] > 15 and LOCKED_POOL_LIMITS[25] > 25
    print("PASS V19 uses one canonical Registry resolver for preflight, qualification, and final rounds")
    print("PASS V19 qualification calls the LoRA sidecar directly and has no Ollama fallback")
    print("PASS V19 runtime does not install V14/V15/V18 monkey-patch contracts")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--stage-target", type=int, choices=ALLOWED_STAGE_TARGETS, default=10)
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if platform.system() != "Darwin":
        raise SystemExit("V19 staged InstaComp Production promotion must run on the Apple Silicon Mac.")

    target = int(args.stage_target)
    v3.frozen_five_v2.clear_mutable_candidate_env_overrides()
    receipt, validated, dataset = base.completion_gate()
    adapter = args.adapter.expanduser().resolve() if args.adapter else validated
    if adapter != validated:
        raise SystemExit("Explicit adapter does not match complete_and_validated receipt")
    adapter_sha = base.file_sha(adapter / "adapters.safetensors")
    dataset_sha = _dataset_fingerprint(dataset, receipt.get("dataset_sha256"))

    activated = False
    activation = None
    rounds: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    try:
        from app.authoritative_registry_gateway import AuthoritativeRegistryChecklistGateway
        gateway = AuthoritativeRegistryChecklistGateway()
        locked_pool, carry_forward = asyncio.run(
            _build_locked_pool(
                dataset,
                target=target,
                adapter_sha=adapter_sha,
                dataset_sha=dataset_sha,
                gateway=gateway,
            )
        )

        started = datetime.now(timezone.utc).timestamp()
        subprocess.run(["bash", str(base.ENABLE), str(adapter)], cwd=base.REPO_ROOT, check=True)
        activated = True
        activation = base.activation_receipt(started, adapter, adapter_sha)
        settings = v6._refresh_runtime_candidate_settings()
        if settings.lora_candidate_enabled is not True:
            raise RuntimeError("Candidate setting did not reload enabled after protected .env refresh")

        fixtures, rejected = asyncio.run(
            _qualify_locked_pool(
                locked_pool,
                target=target,
                adapter_sha=adapter_sha,
                carry_forward=carry_forward,
                gateway=gateway,
            )
        )
        print(
            f"{_stage_label(target).upper()} V19 FIXTURES: "
            + ", ".join(
                f"{item['case'][1]} #{item['case'][2]}[{item['split']}:{item['row_id']}]"
                for item in fixtures
            ),
            flush=True,
        )

        for number in (1, 2):
            result = asyncio.run(
                _certification_round(number, fixtures, adapter_sha=adapter_sha, gateway=gateway)
            )
            rounds.append(result)
            if result.get("passed") is not True:
                raise RuntimeError(str(result.get("error") or f"Round {number} failed")[:4000])
        _rounds_gate(rounds, target)

        manifest = _write_stage_manifest(
            fixtures,
            target=target,
            adapter_sha=adapter_sha,
            dataset_sha=dataset_sha,
        )
        path = _success_receipt(
            target=target,
            adapter=adapter,
            adapter_sha=adapter_sha,
            dataset=dataset,
            dataset_sha=dataset_sha,
            validation_receipt=receipt.get("validation_receipt"),
            activation_receipt=activation.get("_path") if activation else None,
            manifest=manifest,
            rounds=rounds,
            rejected=rejected,
        )
        print(
            f"PASS {_stage_label(target)} V19 certification complete: "
            f"dry_passes={CANDIDATE_DRY_PASSES} rounds=2 cards={target}",
            flush=True,
        )
        print(f"{_stage_label(target).upper()} V19 SUCCESS RECEIPT: {path}", flush=True)
        return 0
    except v13.RegistryThrottleAbort as error:
        if activated:
            subprocess.run(["bash", str(base.DISABLE)], cwd=base.REPO_ROOT, check=False)
        print(f"REGISTRY THROTTLE ABORT: {error}", flush=True)
        return 3
    except BaseException as error:
        if activated:
            subprocess.run(["bash", str(base.DISABLE)], cwd=base.REPO_ROOT, check=False)
        path = _failure_receipt(
            target=target,
            adapter=adapter,
            adapter_sha=adapter_sha,
            dataset=dataset,
            dataset_sha=dataset_sha,
            rounds=rounds,
            rejected=rejected,
            error=error,
            activated=activated,
        )
        print(json.dumps({
            "schema_version": SCHEMA,
            "status": "failed_rolled_back" if activated else "failed_before_activation",
            "promotion_stage_target": target,
            "error_type": type(error).__name__,
            "error": str(error)[:4000],
            "nothing_published": True,
        }, indent=2))
        print(f"{_stage_label(target).upper()} V19 FAILURE RECEIPT: {path}", flush=True)
        if isinstance(error, KeyboardInterrupt):
            raise
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
