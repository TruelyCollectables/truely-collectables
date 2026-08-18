#!/usr/bin/env python3
from __future__ import annotations

import sys
from collections import Counter
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


def _current_trusted_examples_by_id() -> dict[str, Any]:
    from app.config import settings
    from app.storage import MemoryStore
    from app.training import latest_training_examples

    settings.ensure_directories()
    store = MemoryStore(settings.resolve_local_path(settings.database_path))
    store.initialize()
    examples = store.list_training_examples(trusted_only=True, limit=100_000)
    latest = latest_training_examples(examples)
    return {
        str(example.training_example_id): example
        for example in latest
        if str(example.training_example_id or "").strip()
    }


def _image_bytes_match_current_example(item: dict[str, Any], example: Any) -> bool:
    images = [Path(value) if not isinstance(value, Path) else value for value in item.get("images") or []]
    expected = [str(example.front_sha256 or "").strip().lower()]
    if example.back_sha256:
        expected.append(str(example.back_sha256).strip().lower())
    if len(images) != len(expected) or any(not _valid_sha(value) for value in expected):
        return False
    try:
        actual = [canonical._file_sha(path).lower() for path in images]
    except Exception:
        return False
    return actual == expected


def _enrich_from_current_trusted_example(item: dict[str, Any], example: Any) -> tuple[dict[str, Any], str]:
    if not _image_bytes_match_current_example(item, example):
        return item, "image_mismatch"

    identity = getattr(example, "confirmed_identity", None)
    if identity is None:
        return item, "confirmed_identity_missing"

    value = dict(item)
    value["identity"] = identity.model_dump(mode="json") if hasattr(identity, "model_dump") else dict(identity)
    value["trusted_created_at"] = str(getattr(example, "created_at", None) or "")
    value["validation_truth_source"] = "current_trusted_training_example_exact_id_and_image_hash"

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
        current_by_id = _current_trusted_examples_by_id()
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
        row_id = str(item.get("row_id") or "").strip()
        example = current_by_id.get(row_id)
        if example is None:
            _enrichment_stats["current_trusted_row_missing_or_superseded"] += 1
            output.append(item)
            continue
        enriched, status = _enrich_from_current_trusted_example(item, example)
        _enrichment_stats[status] += 1
        output.append(enriched)

    print(
        "UNSEEN VALIDATION TRUTH ENRICHMENT: "
        f"validation_rows={len(values)} "
        f"identity_and_receipt={_enrichment_stats['identity_and_registry_receipt_enriched']} "
        f"identity_only={_enrichment_stats['identity_enriched_no_registry_receipt']} "
        f"missing_or_superseded={_enrichment_stats['current_trusted_row_missing_or_superseded']} "
        f"image_mismatch={_enrichment_stats['image_mismatch']} "
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
            confirmed_identity=Identity(),
            created_at="2026-08-18T00:00:00+00:00",
            front_sha256=canonical._file_sha(front),
            back_sha256=canonical._file_sha(back),
            registry_identity_id="11111111-1111-4111-8111-111111111111",
            registry_fingerprint_sha256="a" * 64,
        )
        item = {
            "row_id": "validation-row",
            "images": [front, back],
            "identity": {"player": "Old", "card_number": "77"},
        }
        enriched, status = _enrich_from_current_trusted_example(item, example)
        assert status == "identity_and_registry_receipt_enriched"
        assert enriched["identity"]["player"] == "Truth Player"
        assert enriched["historical_metadata_registry_id"] == example.registry_identity_id
        assert enriched["historical_metadata_fingerprint"] == example.registry_fingerprint_sha256
        assert enriched["validation_truth_source"] == "current_trusted_training_example_exact_id_and_image_hash"

        bad = SimpleNamespace(**vars(example))
        bad.front_sha256 = "b" * 64
        unchanged, status = _enrich_from_current_trusted_example(item, bad)
        assert status == "image_mismatch"
        assert unchanged is item

    print("PASS unseen V4 enriches only exact current trusted row/image truth")
    print("PASS unseen V4 refuses current trusted metadata when image bytes do not match")
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
