#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.config import settings
from app.external_learning import external_learning_status, stage_manifest_locator
from app.external_metadata import import_metadata_source, metadata_status

CATALOG_SCHEMA = "tcos.instacomp-ai.external-learning-source-catalog.v1"
BLOCKED_LICENSE_WORDS = ("noncommercial", "non-commercial", "by-nc", "all rights reserved", "research only")


def _load_catalog(path: Path) -> dict:
    if not path.exists():
        return {"schema_version": CATALOG_SCHEMA, "sources": []}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("sources"), list):
        raise ValueError("External-learning source catalog must contain a sources array")
    return payload


def _catalog_gate(source: dict) -> list[str]:
    reasons: list[str] = []
    if source.get("enabled") is not True:
        reasons.append("disabled")
    if source.get("license_reviewed") is not True:
        reasons.append("license_not_reviewed")
    if source.get("commercial_use_allowed") is not True:
        reasons.append("commercial_use_not_allowed")
    license_name = str(source.get("license") or "").strip()
    if not license_name:
        reasons.append("license_missing")
    if any(word in license_name.casefold() for word in BLOCKED_LICENSE_WORDS):
        reasons.append("license_blocked")
    mode = str(source.get("mode") or "image_manifest").strip()
    if mode == "metadata_reference":
        if not str(source.get("url") or "").strip():
            reasons.append("url_missing")
        if not str(source.get("adapter") or "").strip():
            reasons.append("adapter_missing")
        if not str(source.get("attribution") or "").strip():
            reasons.append("attribution_missing")
    elif not str(source.get("manifest") or "").strip():
        reasons.append("manifest_missing")
    return reasons


def run(catalog_path: Path) -> dict:
    database = settings.resolve_local_path(settings.database_path)
    external_images = settings.resolve_local_path(settings.data_datasets_path) / "external-learning" / "images"
    external_images.mkdir(parents=True, exist_ok=True)
    catalog = _load_catalog(catalog_path)
    results: list[dict] = []
    for raw in catalog.get("sources", []):
        if not isinstance(raw, dict):
            results.append({"status": "skipped", "reason": "source_not_object"})
            continue
        name = str(raw.get("name") or raw.get("manifest") or "unnamed-source")
        reasons = _catalog_gate(raw)
        if reasons:
            results.append({"source": name, "status": "skipped", "reasons": reasons})
            continue
        try:
            mode = str(raw.get("mode") or "image_manifest").strip()
            if mode == "metadata_reference":
                imported = import_metadata_source(database, raw)
                results.append({"source": name, "mode": mode, "status": "ok", **imported})
            else:
                rows = stage_manifest_locator(
                    database_path=database,
                    external_image_root=external_images,
                    manifest_locator=str(raw["manifest"]),
                    max_image_bytes=settings.max_image_bytes,
                )
                results.append(
                    {
                        "source": name,
                        "mode": mode,
                        "status": "ok",
                        "records": len(rows),
                        "states": {
                            state: sum(1 for row in rows if row.get("state") == state)
                            for state in {"staged", "quarantined", "verified", "promoted"}
                        },
                    }
                )
        except Exception as exc:
            results.append({"source": name, "status": "failed", "error": f"{type(exc).__name__}: {exc}"})
    failed = sum(1 for row in results if row.get("status") == "failed")
    return {
        "schema_version": CATALOG_SCHEMA,
        "ran_at": datetime.now(timezone.utc).isoformat(),
        "catalog": str(catalog_path),
        "sources": results,
        "failed_sources": failed,
        "learning_status": external_learning_status(database),
        "metadata_reference_status": metadata_status(database),
        "outside_data_auto_promoted": False,
        "metadata_reference_is_identity_authority": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Unsworth employee: pull approved outside learning manifests into safe staging.")
    default_catalog = settings.resolve_local_path(settings.data_datasets_path) / "external-learning" / "sources.json"
    parser.add_argument("--catalog", type=Path, default=default_catalog)
    args = parser.parse_args()
    report = run(args.catalog.expanduser().resolve())
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["failed_sources"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}), file=sys.stderr)
        raise SystemExit(2)
