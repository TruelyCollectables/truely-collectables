from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "tcos.instacomp-ai.teacher-comp-learning.v1"
RECEIPT_SCHEMA_VERSION = "tcos.instacomp.teacher-comp-receipt.v1"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: object, maximum: int = 4000) -> str:
    return str(value or "").strip()[:maximum]


def _number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None


def initialize_teacher_comp_learning(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path, timeout=30) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS teacher_comp_receipts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                receipt_fingerprint TEXT NOT NULL UNIQUE,
                registry_identity_id TEXT,
                registry_fingerprint_sha256 TEXT,
                scan_id TEXT,
                trusted_market_truth INTEGER NOT NULL DEFAULT 0,
                student_training_eligible INTEGER NOT NULL DEFAULT 0,
                pricing_authority INTEGER NOT NULL DEFAULT 0,
                identity_training_mutated INTEGER NOT NULL DEFAULT 0,
                configured_teacher_count INTEGER NOT NULL DEFAULT 0,
                required_votes INTEGER NOT NULL DEFAULT 2,
                trusted_sold_count INTEGER NOT NULL DEFAULT 0,
                trusted_suggested_price REAL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS teacher_comp_receipts_identity_idx
                ON teacher_comp_receipts(registry_identity_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS teacher_comp_receipts_training_idx
                ON teacher_comp_receipts(student_training_eligible, created_at DESC);
            """
        )


def _normalized_receipt(body: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValueError("Teacher comp receipt must be an object.")

    schema = _text(body.get("schemaVersion") or body.get("schema_version"), 100)
    if schema and schema != RECEIPT_SCHEMA_VERSION:
        raise ValueError(f"Unsupported teacher comp receipt schema: {schema}")

    consensus = body.get("teacherConsensus") or body.get("teacher_consensus") or {}
    if not isinstance(consensus, dict):
        raise ValueError("teacherConsensus must be an object.")

    configured = consensus.get("configuredTeachers") or consensus.get("configured_teachers") or []
    if not isinstance(configured, list):
        configured = []
    configured = sorted({_text(value, 80) for value in configured if _text(value, 80)})

    required_votes = int(_number(consensus.get("requiredVotes") or consensus.get("required_votes")) or 2)
    required_votes = max(2, required_votes)

    accepted_sold = body.get("acceptedSoldComps") or body.get("accepted_sold_comps") or []
    if not isinstance(accepted_sold, list):
        accepted_sold = []

    pricing_eligible_count = int(
        _number(body.get("pricingEligibleSoldCount") or body.get("pricing_eligible_sold_count")) or 0
    )
    trusted_sold_count = min(len(accepted_sold), max(0, pricing_eligible_count))
    consensus_trusted = consensus.get("trusted") is True

    # Market truth can only become student training material when independent
    # teachers actually reached the configured vote threshold and at least one
    # pricing-eligible exact sold comp survived the deterministic firewall.
    trusted_market_truth = bool(
        consensus_trusted
        and len(configured) >= 2
        and required_votes >= 2
        and trusted_sold_count > 0
    )

    canonical_identity = body.get("canonicalIdentity") or body.get("canonical_identity") or {}
    if not isinstance(canonical_identity, dict):
        canonical_identity = {}

    normalized = {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "source": _text(body.get("source") or "instacomp", 100),
        "scanId": _text(body.get("scanId") or body.get("scan_id"), 120) or None,
        "registryIdentityId": _text(
            body.get("registryIdentityId") or body.get("registry_identity_id"), 160
        )
        or None,
        "registryFingerprintSha256": _text(
            body.get("registryFingerprintSha256")
            or body.get("registry_fingerprint_sha256"),
            128,
        )
        or None,
        "canonicalIdentity": canonical_identity,
        "teacherConsensus": {
            **consensus,
            "configuredTeachers": configured,
            "requiredVotes": required_votes,
            "trusted": trusted_market_truth,
        },
        "acceptedSoldComps": accepted_sold[:50],
        "discoverySoldComps": (
            body.get("discoverySoldComps")
            if isinstance(body.get("discoverySoldComps"), list)
            else []
        )[:100],
        "discoveryActiveComps": (
            body.get("discoveryActiveComps")
            if isinstance(body.get("discoveryActiveComps"), list)
            else []
        )[:100],
        "trustedSuggestedPrice": _number(
            body.get("trustedSuggestedPrice") or body.get("trusted_suggested_price")
        ),
        "pricingEligibleSoldCount": trusted_sold_count,
        "studentMode": True,
        "pricingAuthority": False,
        "identityTrainingMutationAllowed": False,
        "createdAt": _text(body.get("createdAt") or body.get("created_at"), 80)
        or utc_now_iso(),
    }
    return normalized


def record_teacher_comp_receipt(path: Path, body: dict[str, Any]) -> dict[str, Any]:
    initialize_teacher_comp_learning(path)
    receipt = _normalized_receipt(body)
    canonical = json.dumps(receipt, sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    consensus = receipt["teacherConsensus"]
    trusted = consensus.get("trusted") is True

    with sqlite3.connect(path, timeout=30) as db:
        existing = db.execute(
            "SELECT id FROM teacher_comp_receipts WHERE receipt_fingerprint = ?",
            (fingerprint,),
        ).fetchone()
        if existing:
            return {
                "ok": True,
                "status": "duplicate",
                "schema_version": SCHEMA_VERSION,
                "receipt_id": int(existing[0]),
                "receipt_fingerprint": fingerprint,
                "trusted_market_truth": trusted,
                "student_training_eligible": trusted,
                "pricing_authority": False,
                "identity_training_mutated": False,
            }

        cursor = db.execute(
            """
            INSERT INTO teacher_comp_receipts (
                receipt_fingerprint, registry_identity_id,
                registry_fingerprint_sha256, scan_id,
                trusted_market_truth, student_training_eligible,
                pricing_authority, identity_training_mutated,
                configured_teacher_count, required_votes,
                trusted_sold_count, trusted_suggested_price,
                payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)
            """,
            (
                fingerprint,
                receipt["registryIdentityId"],
                receipt["registryFingerprintSha256"],
                receipt["scanId"],
                int(trusted),
                int(trusted),
                len(consensus.get("configuredTeachers") or []),
                int(consensus.get("requiredVotes") or 2),
                int(receipt["pricingEligibleSoldCount"]),
                receipt["trustedSuggestedPrice"],
                canonical,
                utc_now_iso(),
            ),
        )
        receipt_id = int(cursor.lastrowid)

    return {
        "ok": True,
        "status": "saved",
        "schema_version": SCHEMA_VERSION,
        "receipt_id": receipt_id,
        "receipt_fingerprint": fingerprint,
        "trusted_market_truth": trusted,
        "student_training_eligible": trusted,
        "pricing_authority": False,
        "identity_training_mutated": False,
    }


def teacher_comp_learning_stats(path: Path) -> dict[str, Any]:
    initialize_teacher_comp_learning(path)
    with sqlite3.connect(path, timeout=30) as db:
        total = int(db.execute("SELECT COUNT(*) FROM teacher_comp_receipts").fetchone()[0])
        trusted = int(
            db.execute(
                "SELECT COUNT(*) FROM teacher_comp_receipts WHERE trusted_market_truth = 1"
            ).fetchone()[0]
        )
        sold = int(
            db.execute(
                "SELECT COALESCE(SUM(trusted_sold_count), 0) FROM teacher_comp_receipts WHERE trusted_market_truth = 1"
            ).fetchone()[0]
        )
    return {
        "schema_version": SCHEMA_VERSION,
        "receipt_count": total,
        "trusted_teacher_receipt_count": trusted,
        "trusted_exact_sold_comp_count": sold,
        "pricing_authority": False,
        "identity_training_mutation_allowed": False,
        "student_mode": True,
    }


def load_teacher_comp_receipts(path: Path, *, limit: int = 100) -> list[dict[str, Any]]:
    initialize_teacher_comp_learning(path)
    bounded = max(1, min(int(limit), 2000))
    with sqlite3.connect(path, timeout=30) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT id, receipt_fingerprint, trusted_market_truth,
                   student_training_eligible, pricing_authority,
                   identity_training_mutated, payload_json, created_at
            FROM teacher_comp_receipts
            ORDER BY id DESC
            LIMIT ?
            """,
            (bounded,),
        ).fetchall()
    results: list[dict[str, Any]] = []
    for row in rows:
        payload = json.loads(row["payload_json"])
        results.append(
            {
                "receipt_id": row["id"],
                "receipt_fingerprint": row["receipt_fingerprint"],
                "trusted_market_truth": bool(row["trusted_market_truth"]),
                "student_training_eligible": bool(row["student_training_eligible"]),
                "pricing_authority": bool(row["pricing_authority"]),
                "identity_training_mutated": bool(row["identity_training_mutated"]),
                "created_at": row["created_at"],
                "receipt": payload,
            }
        )
    return results
