from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "tcos.instacomp-ai.teacher-comp-training.v1"


def _stable_bucket(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def _eligible_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    eligible: list[dict[str, Any]] = []
    for row in rows:
        if row.get("trusted_market_truth") is not True:
            continue
        if row.get("student_training_eligible") is not True:
            continue
        if row.get("pricing_authority") is True:
            continue
        if row.get("identity_training_mutated") is True:
            continue
        fingerprint = str(row.get("receipt_fingerprint") or "").strip()
        receipt = row.get("receipt")
        if not fingerprint or fingerprint in seen or not isinstance(receipt, dict):
            continue
        seen.add(fingerprint)
        eligible.append(row)
    return eligible


def build_teacher_comp_training_example(row: dict[str, Any]) -> dict[str, Any]:
    fingerprint = str(row.get("receipt_fingerprint") or "").strip()
    receipt = row.get("receipt")
    if not fingerprint or not isinstance(receipt, dict):
        raise ValueError("Teacher comp training row is missing a receipt fingerprint/payload.")
    consensus = receipt.get("teacherConsensus") or {}
    if not isinstance(consensus, dict):
        consensus = {}
    identity = receipt.get("canonicalIdentity") or {}
    if not isinstance(identity, dict):
        identity = {}
    accepted = receipt.get("acceptedSoldComps") or []
    discovery_sold = receipt.get("discoverySoldComps") or []
    discovery_active = receipt.get("discoveryActiveComps") or []
    if not isinstance(accepted, list):
        accepted = []
    if not isinstance(discovery_sold, list):
        discovery_sold = []
    if not isinstance(discovery_active, list):
        discovery_active = []

    return {
        "schema_version": SCHEMA_VERSION,
        "example_id": fingerprint,
        "task": "exact_sold_comp_selection_and_pricing_evidence",
        "input": {
            "registry_identity_id": receipt.get("registryIdentityId"),
            "registry_fingerprint_sha256": receipt.get("registryFingerprintSha256"),
            "canonical_identity": identity,
            "sold_candidates": discovery_sold[:100],
            "active_candidates": discovery_active[:100],
        },
        "target": {
            "accepted_exact_sold_comps": accepted[:50],
            "trusted_suggested_price": receipt.get("trustedSuggestedPrice"),
            "pricing_eligible_sold_count": int(receipt.get("pricingEligibleSoldCount") or 0),
            "teacher_consensus": {
                "configured_teachers": list(consensus.get("configuredTeachers") or []),
                "required_votes": int(consensus.get("requiredVotes") or 2),
                "trusted": consensus.get("trusted") is True,
            },
        },
        "boundaries": {
            "student_mode": True,
            "pricing_authority": False,
            "auto_promotion": False,
            "identity_training_mutation_allowed": False,
            "marketplace_title_is_identity_truth": False,
        },
    }


def teacher_comp_training_readiness(rows: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = _eligible_rows(rows)
    return {
        "schema_version": SCHEMA_VERSION,
        "eligible_example_count": len(eligible),
        "ready_for_export": len(eligible) > 0,
        "student_mode": True,
        "pricing_authority": False,
        "auto_promotion": False,
        "identity_training_separated": True,
    }


def export_teacher_comp_training_dataset(
    rows: list[dict[str, Any]],
    *,
    destination_root: Path,
    validation_percent: int = 15,
) -> dict[str, Any]:
    validation_percent = max(0, min(int(validation_percent), 50))
    eligible = _eligible_rows(rows)
    if not eligible:
        raise ValueError("No trusted teacher comp receipts are eligible for export.")

    examples = [build_teacher_comp_training_example(row) for row in eligible]
    examples.sort(key=lambda example: str(example["example_id"]))
    validation: list[dict[str, Any]] = []
    training: list[dict[str, Any]] = []
    for example in examples:
        bucket = _stable_bucket(str(example["example_id"]))
        if validation_percent > 0 and bucket < validation_percent:
            validation.append(example)
        else:
            training.append(example)

    # Keep a usable train file for very small supervised corpora while keeping
    # the split deterministic. Validation starts populating automatically as
    # the corpus grows and stable hashes fall inside the requested bucket.
    if not training and validation:
        training.append(validation.pop(0))

    destination = destination_root / "teacher-comp"
    destination.mkdir(parents=True, exist_ok=True)
    train_path = destination / "train.jsonl"
    validation_path = destination / "validation.jsonl"
    manifest_path = destination / "manifest.json"

    def write_jsonl(path: Path, values: list[dict[str, Any]]) -> None:
        text = "".join(json.dumps(value, sort_keys=True) + "\n" for value in values)
        path.write_text(text, encoding="utf-8")

    write_jsonl(train_path, training)
    write_jsonl(validation_path, validation)
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "example_count": len(examples),
        "training_count": len(training),
        "validation_count": len(validation),
        "validation_percent": validation_percent,
        "train_path": str(train_path),
        "validation_path": str(validation_path),
        "student_mode": True,
        "pricing_authority": False,
        "auto_promotion": False,
        "identity_training_separated": True,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {**manifest, "manifest_path": str(manifest_path)}
