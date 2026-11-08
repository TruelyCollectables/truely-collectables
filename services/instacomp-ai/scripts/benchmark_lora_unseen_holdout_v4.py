#!/usr/bin/env python3
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import benchmark_lora_unseen_holdout as canonical

# V4 does not replace the canonical V3 scorer. It only repairs teacher metadata
# for validation rows from the Mac's current trusted training-example database,
# then hands those rows back to V3 for the exact same Registry + physical gates.
SCHEMA = "tcos.instacomp-ai.lora-unseen-holdout-benchmark.v4"
_CANONICAL_VALIDATION_HOLDOUT_CANDIDATES = canonical._validation_holdout_candidates
_enrichment_stats: Counter[str] = Counter()


def _valid_sha(value: object) -> str | None:
    text = str(value or "").strip().lower()
    return text if len(text) == 64 and all(ch in "0123456789abcdef" for ch in text) else None


def _example_image_key(example: Any) -> tuple[str, ...] | None:
    front = _valid_sha(getattr(example, "front_sha256", None))
    if front is None:
        return None
    values = [front]
    back_value = getattr(example, "back_sha256", None)
    if back_value:
        back = _valid_sha(back_value)
        if back is None:
            return None
        values.append(back)
    return tuple(values)


def _item_image_key(item: dict[str, Any]) -> tuple[str, ...] | None:
    images = [Path(value) if not isinstance(value, Path) else value for value in item.get("images") or []]
    if not images:
        return None
    try:
        return tuple(canonical._file_sha(path).lower() for path in images)
    except Exception:
        return None


def _current_trusted_indexes() -> tuple[dict[str, Any], dict[tuple[str, ...], list[Any]]]:
    from app.config import settings
    from app.storage import MemoryStore
    from app.training import latest_training_examples

    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    examples = store.list_training_examples(trusted_only=True, limit=100_000)
    latest = latest_training_examples(examples)

    by_id: dict[str, Any] = {}
    by_images: dict[tuple[str, ...], list[Any]] = defaultdict(list)
    for example in latest:
        example_id = str(example.training_example_id or "").strip()
        if example_id:
            by_id[example_id] = example
        image_key = _example_image_key(example)
        if image_key:
            by_images[image_key].append(example)
    return by_id, dict(by_images)


def _image_bytes_match_current_example(item: dict[str, Any], example: Any) -> bool:
    item_key = _item_image_key(item)
    example_key = _example_image_key(example)
    return item_key is not None and item_key == example_key


def _resolve_current_trusted_example(
    item: dict[str, Any],
    *,
    current_by_id: dict[str, Any],
    current_by_images: dict[tuple[str, ...], list[Any]],
) -> tuple[Any | None, str]:
    row_id = str(item.get("row_id") or "").strip()
    exact = current_by_id.get(row_id)
    if exact is not None:
        if _image_bytes_match_current_example(item, exact):
            return exact, "exact_training_example_id_and_image_hash"
        return None, "exact_id_image_mismatch"

    image_key = _item_image_key(item)
    if image_key is None:
        return None, "dataset_image_hash_unavailable"
    matches = current_by_images.get(image_key) or []
    if len(matches) == 1:
        return matches[0], "unique_current_trusted_image_hash"
    if len(matches) > 1:
        return None, "ambiguous_current_trusted_image_hash"
    return None, "current_trusted_row_missing_or_superseded"


def _enrich_from_current_trusted_example(
    item: dict[str, Any],
    example: Any,
    *,
    resolution: str,
) -> tuple[dict[str, Any], str]:
    if not _image_bytes_match_current_example(item, example):
        return item, "image_mismatch"

    identity = getattr(example, "confirmed_identity", None)
    if identity is None:
        return item, "confirmed_identity_missing"

    value = dict(item)
    value["identity"] = identity.model_dump(mode="json") if hasattr(identity, "model_dump") else dict(identity)
    value["trusted_created_at"] = str(getattr(example, "created_at", None) or "")
    value["validation_truth_source"] = (
        "current_trusted_training_example_exact_id_and_image_hash"
        if resolution == "exact_training_example_id_and_image_hash"
        else "current_trusted_training_example_unique_image_hash"
    )
    value["validation_truth_resolution"] = resolution
    value["validation_truth_training_example_id"] = str(
        getattr(example, "training_example_id", "") or ""
    )

    registry_id = canonical.legacy.v20.v19.legacy._valid_uuid(
        getattr(example, "registry_identity_id", None)
    )
    fingerprint = canonical.legacy.v20.v19.legacy._valid_sha256(
        getattr(example, "registry_fingerprint_sha256", None)
    )
    if registry_id and fingerprint:
        value["historical_metadata_registry_id"] = registry_id
        value["historical_metadata_fingerprint"] = fingerprint
        return value, "identity_and_registry_receipt_enriched"
    return value, "identity_enriched_no_registry_receipt"


def _validation_holdout_candidates(dataset: Path, *, frozen_row_ids: set[str]) -> list[dict[str, Any]]:
    global _enrichment_stats
    _enrichment_stats = Counter()
    values = _CANONICAL_VALIDATION_HOLDOUT_CANDIDATES(
        dataset,
        frozen_row_ids=frozen_row_ids,
    )
    try:
        current_by_id, current_by_images = _current_trusted_indexes()
    except Exception as error:
        _enrichment_stats[f"trusted_db_load_error:{type(error).__name__}"] += 1
        print(
            "UNSEEN VALIDATION TRUTH ENRICHMENT: "
            f"db_error={type(error).__name__}; falling back to frozen dataset metadata only",
            flush=True,
        )
        return values

    output: list[dict[str, Any]] = []
    for item in values:
        example, resolution = _resolve_current_trusted_example(
            item,
            current_by_id=current_by_id,
            current_by_images=current_by_images,
        )
        _enrichment_stats[resolution] += 1
        if example is None:
            output.append(item)
            continue
        enriched, status = _enrich_from_current_trusted_example(
            item,
            example,
            resolution=resolution,
        )
        _enrichment_stats[status] += 1
        output.append(enriched)

    print(
        "UNSEEN VALIDATION TRUTH ENRICHMENT: "
        f"validation_rows={len(values)} "
        f"exact_id={_enrichment_stats['exact_training_example_id_and_image_hash']} "
        f"unique_image_recovery={_enrichment_stats['unique_current_trusted_image_hash']} "
        f"identity_and_receipt={_enrichment_stats['identity_and_registry_receipt_enriched']} "
        f"identity_only={_enrichment_stats['identity_enriched_no_registry_receipt']} "
        f"missing_or_superseded={_enrichment_stats['current_trusted_row_missing_or_superseded']} "
        f"exact_id_image_mismatch={_enrichment_stats['exact_id_image_mismatch']} "
        f"ambiguous_image={_enrichment_stats['ambiguous_current_trusted_image_hash']} "
        f"image_hash_unavailable={_enrichment_stats['dataset_image_hash_unavailable']} "
        f"identity_missing={_enrichment_stats['confirmed_identity_missing']}",
        flush=True,
    )
    return output


def _self_test() -> int:
    assert canonical._self_test() == 0

    from types import SimpleNamespace
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        front = root / "front.jpg"
        back = root / "back.jpg"
        front.write_bytes(b"front-current-truth")
        back.write_bytes(b"back-current-truth")

        class Identity:
            def model_dump(self, mode: str = "json") -> dict[str, Any]:
                assert mode == "json"
                return {
                    "sport": "Basketball",
                    "year": "2025",
                    "brand": "Prizm",
                    "set_name": "Base",
                    "player": "Truth Player",
                    "card_number": "77",
                    "parallel": "Base",
                }

        example = SimpleNamespace(
            training_example_id="current-row",
            confirmed_identity=Identity(),
            created_at="2026-08-18T00:00:00+00:00",
            front_sha256=canonical._file_sha(front),
            back_sha256=canonical._file_sha(back),
            registry_identity_id="11111111-1111-4111-8111-111111111111",
            registry_fingerprint_sha256="a" * 64,
        )
        item = {
            "row_id": "current-row",
            "images": [front, back],
            "identity": {"player": "Old", "card_number": "77"},
        }
        resolved, resolution = _resolve_current_trusted_example(
            item,
            current_by_id={"current-row": example},
            current_by_images={_example_image_key(example): [example]},
        )
        assert resolved is example
        assert resolution == "exact_training_example_id_and_image_hash"
        enriched, status = _enrich_from_current_trusted_example(
            item,
            example,
            resolution=resolution,
        )
        assert status == "identity_and_registry_receipt_enriched"
        assert enriched["identity"]["player"] == "Truth Player"
        assert enriched["historical_metadata_registry_id"] == example.registry_identity_id
        assert enriched["historical_metadata_fingerprint"] == example.registry_fingerprint_sha256
        assert enriched["validation_truth_source"] == "current_trusted_training_example_exact_id_and_image_hash"

        superseded_item = dict(item)
        superseded_item["row_id"] = "old-superseded-row"
        resolved, resolution = _resolve_current_trusted_example(
            superseded_item,
            current_by_id={},
            current_by_images={_example_image_key(example): [example]},
        )
        assert resolved is example
        assert resolution == "unique_current_trusted_image_hash"
        recovered, status = _enrich_from_current_trusted_example(
            superseded_item,
            example,
            resolution=resolution,
        )
        assert status == "identity_and_registry_receipt_enriched"
        assert recovered["validation_truth_source"] == "current_trusted_training_example_unique_image_hash"

        ambiguous, reason = _resolve_current_trusted_example(
            superseded_item,
            current_by_id={},
            current_by_images={_example_image_key(example): [example, example]},
        )
        assert ambiguous is None
        assert reason == "ambiguous_current_trusted_image_hash"

        bad = SimpleNamespace(**vars(example))
        bad.front_sha256 = "b" * 64
        resolved, resolution = _resolve_current_trusted_example(
            item,
            current_by_id={"current-row": bad},
            current_by_images={},
        )
        assert resolved is None
        assert resolution == "exact_id_image_mismatch"

    print("PASS unseen V4 enriches only exact current trusted row/image truth")
    print("PASS unseen V4 recovers superseded rows only by one unique current trusted image hash")
    print("PASS unseen V4 refuses ambiguous image truth and exact-ID image mismatches")
    print("PASS unseen V4 leaves canonical V3 Registry and physical scoring unchanged")
    return 0


def main() -> int:
    if "--self-test" in sys.argv[1:]:
        return _self_test()

    canonical.SCHEMA = SCHEMA
    canonical._validation_holdout_candidates = _validation_holdout_candidates
    return int(canonical.main())


if __name__ == "__main__":
    raise SystemExit(main())
