from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA_VERSION = "tcos.instacomp-ai.teacher-comp-learning.v1"
RECEIPT_SCHEMA_VERSION = "tcos.instacomp.teacher-comp-receipt.v1"
MARKET_OBSERVATION_SCHEMA_VERSION = "tcos.instacomp.market-observation.v1"
MARKET_EVENT_CLASSES = {"OBSERVED", "REJECTED", "VERIFIED_PRICING", "VERIFIED_IDENTITY", "DECISION", "OUTCOME"}


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
            CREATE TABLE IF NOT EXISTS instacomp_market_observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                observation_fingerprint TEXT NOT NULL UNIQUE,
                parent_observation_fingerprint TEXT,
                receipt_fingerprint TEXT,
                research_id TEXT,
                scan_id TEXT,
                registry_identity_id TEXT,
                registry_fingerprint_sha256 TEXT,
                event_class TEXT NOT NULL,
                observation_type TEXT NOT NULL,
                source TEXT NOT NULL,
                marketplace TEXT,
                listing_id TEXT,
                listing_url TEXT,
                listing_title TEXT,
                observed_price REAL,
                shipping_price REAL,
                total_price REAL,
                currency TEXT NOT NULL DEFAULT 'USD',
                sold_at TEXT,
                observed_at TEXT NOT NULL,
                decision TEXT,
                valuation_low REAL,
                valuation_median REAL,
                valuation_high REAL,
                confidence REAL,
                buy_ceiling REAL,
                rejection_reason TEXT,
                verified_pricing_truth INTEGER NOT NULL DEFAULT 0,
                verified_identity_truth INTEGER NOT NULL DEFAULT 0,
                pricing_training_eligible INTEGER NOT NULL DEFAULT 0,
                identity_training_mutated INTEGER NOT NULL DEFAULT 0,
                lot_role TEXT,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS instacomp_market_observations_identity_idx
                ON instacomp_market_observations(registry_identity_id, observed_at DESC);
            CREATE INDEX IF NOT EXISTS instacomp_market_observations_research_idx
                ON instacomp_market_observations(research_id, observed_at DESC);
            CREATE INDEX IF NOT EXISTS instacomp_market_observations_listing_idx
                ON instacomp_market_observations(marketplace, listing_id);
            CREATE INDEX IF NOT EXISTS instacomp_market_observations_training_idx
                ON instacomp_market_observations(pricing_training_eligible, verified_pricing_truth, observed_at DESC);
            """
        )



def _list(value: object) -> list[Any]:
    return value if isinstance(value, list) else []


def _dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _event_class(value: object, default: str = "OBSERVED") -> str:
    parsed = _text(value, 40).upper()
    return parsed if parsed in MARKET_EVENT_CLASSES else default


def _listing_id(observation: dict[str, Any]) -> str | None:
    for key in ("listingId", "listing_id", "itemId", "item_id", "id"):
        parsed = _text(observation.get(key), 200)
        if parsed:
            return parsed
    return None


def _source(observation: dict[str, Any], default: str) -> str:
    return _text(observation.get("source") or observation.get("provider") or default, 80) or default


def _marketplace(observation: dict[str, Any]) -> str | None:
    return _text(observation.get("marketplace") or observation.get("provider") or observation.get("source"), 80) or None


def _money_value(observation: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        parsed = _number(observation.get(key))
        if parsed is not None:
            return round(parsed, 2)
    return None


def _observation_payload(
    receipt: dict[str, Any],
    *,
    receipt_fingerprint: str,
    event_class: str,
    observation_type: str,
    observation: dict[str, Any],
    parent_fingerprint: str | None = None,
    lot_role: str | None = None,
) -> dict[str, Any]:
    observed_price = _money_value(observation, "totalPrice", "total_price", "price")
    item_price = _money_value(observation, "itemPrice", "item_price")
    shipping = _money_value(observation, "shippingPrice", "shipping_price", "shipping")
    total_price = observed_price
    if total_price is None and (item_price is not None or shipping is not None):
        total_price = round(float(item_price or 0) + float(shipping or 0), 2)
    listing_url = _text(observation.get("url") or observation.get("listingUrl") or observation.get("listing_url"), 1000) or None
    listing_title = _text(observation.get("title") or observation.get("listingTitle") or observation.get("listing_title"), 1000) or None
    decision = _text(observation.get("decision") or receipt.get("decision"), 60) or None
    rejection_reason = _text(observation.get("rejectionReason") or observation.get("rejection_reason"), 1000) or None
    if event_class == "REJECTED" and not rejection_reason:
        flags = observation.get("flags")
        if isinstance(flags, list):
            rejection_reason = "; ".join(_text(flag, 200) for flag in flags if _text(flag, 200))[:1000] or None
    return {
        "schemaVersion": MARKET_OBSERVATION_SCHEMA_VERSION,
        "receiptFingerprint": receipt_fingerprint,
        "parentObservationFingerprint": parent_fingerprint,
        "researchId": _text(receipt.get("researchId") or receipt.get("research_id") or receipt.get("scanId"), 160) or None,
        "scanId": receipt.get("scanId"),
        "registryIdentityId": receipt.get("registryIdentityId"),
        "registryFingerprintSha256": receipt.get("registryFingerprintSha256"),
        "eventClass": event_class,
        "observationType": observation_type,
        "source": _source(observation, _text(receipt.get("source"), 80) or "instacomp"),
        "marketplace": _marketplace(observation),
        "listingId": _listing_id(observation),
        "listingUrl": listing_url,
        "listingTitle": listing_title,
        "observedPrice": observed_price,
        "shippingPrice": shipping,
        "totalPrice": total_price,
        "currency": _text(observation.get("currency") or receipt.get("currency") or "USD", 12) or "USD",
        "soldAt": _text(observation.get("soldAt") or observation.get("sold_at"), 80) or None,
        "observedAt": _text(observation.get("observedAt") or observation.get("observed_at") or receipt.get("createdAt"), 80) or utc_now_iso(),
        "decision": decision,
        "valuationLow": _money_value(observation, "valuationLow", "valuation_low") or _money_value(receipt, "valuationLow", "valuation_low"),
        "valuationMedian": _money_value(observation, "valuationMedian", "valuation_median") or _money_value(receipt, "trustedSuggestedPrice", "trusted_suggested_price", "valuationMedian", "valuation_median"),
        "valuationHigh": _money_value(observation, "valuationHigh", "valuation_high") or _money_value(receipt, "valuationHigh", "valuation_high"),
        "confidence": _number(observation.get("confidence") or receipt.get("confidence")),
        "buyCeiling": _money_value(observation, "buyCeiling", "buy_ceiling") or _money_value(receipt, "buyCeiling", "buy_ceiling"),
        "rejectionReason": rejection_reason,
        "verifiedPricingTruth": event_class == "VERIFIED_PRICING",
        "verifiedIdentityTruth": event_class == "VERIFIED_IDENTITY",
        "pricingTrainingEligible": False,
        "identityTrainingMutated": False,
        "lotRole": lot_role,
        "rawObservation": observation,
    }


def _market_observations_from_receipt(receipt: dict[str, Any], fingerprint: str) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for comp in _list(receipt.get("discoverySoldComps")):
        if isinstance(comp, dict):
            rejected = bool(comp.get("rejected") or comp.get("rejectionReason") or comp.get("rejection_reason"))
            observations.append(_observation_payload(receipt, receipt_fingerprint=fingerprint, event_class="REJECTED" if rejected else "OBSERVED", observation_type="SOLD_COMP_CANDIDATE", observation=comp))
    for comp in _list(receipt.get("discoveryActiveComps")):
        if isinstance(comp, dict):
            observations.append(_observation_payload(receipt, receipt_fingerprint=fingerprint, event_class="OBSERVED", observation_type="ACTIVE_ASK", observation=comp))
    for comp in _list(receipt.get("acceptedSoldComps")):
        if isinstance(comp, dict):
            observations.append(_observation_payload(receipt, receipt_fingerprint=fingerprint, event_class="VERIFIED_PRICING" if receipt.get("teacherConsensus", {}).get("trusted") is True else "OBSERVED", observation_type="ACCEPTED_SOLD_COMP", observation=comp))
    decision_payload = _dict(receipt.get("decisionRecord") or receipt.get("decision_record"))
    if decision_payload or receipt.get("decision"):
        observations.append(_observation_payload(receipt, receipt_fingerprint=fingerprint, event_class="DECISION", observation_type="INSTACOMP_DECISION", observation=decision_payload))
    outcome_payload = _dict(receipt.get("outcome") or receipt.get("outcomeRecord") or receipt.get("outcome_record"))
    if outcome_payload:
        observations.append(_observation_payload(receipt, receipt_fingerprint=fingerprint, event_class="OUTCOME", observation_type="MARKET_OUTCOME", observation=outcome_payload))
    lot = _dict(receipt.get("lot") or receipt.get("lotRecord") or receipt.get("lot_record"))
    if lot:
        parent = _observation_payload(receipt, receipt_fingerprint=fingerprint, event_class="DECISION" if lot.get("decision") else "OBSERVED", observation_type="LOT_RESEARCH", observation=lot, lot_role="PARENT")
        parent_fp = _market_observation_fingerprint(parent)
        observations.append(parent)
        for child in _list(lot.get("children") or lot.get("childObservations") or lot.get("child_observations")):
            if isinstance(child, dict):
                observations.append(_observation_payload(receipt, receipt_fingerprint=fingerprint, event_class="OBSERVED", observation_type="LOT_CHILD_CARD", observation=child, parent_fingerprint=parent_fp, lot_role="CHILD"))
    return observations


def _market_observation_fingerprint(observation: dict[str, Any]) -> str:
    payload = {key: value for key, value in observation.items() if key not in {"observedAt"}}
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _insert_market_observations(path: Path, observations: list[dict[str, Any]]) -> int:
    if not observations:
        return 0
    initialize_teacher_comp_learning(path)
    saved = 0
    with sqlite3.connect(path, timeout=30) as db:
        for observation in observations:
            fingerprint = _market_observation_fingerprint(observation)
            verified_pricing = observation["eventClass"] == "VERIFIED_PRICING"
            pricing_training_eligible = bool(verified_pricing and observation.get("registryIdentityId") and observation.get("registryFingerprintSha256"))
            cursor = db.execute("""
                INSERT OR IGNORE INTO instacomp_market_observations (
                    observation_fingerprint, parent_observation_fingerprint, receipt_fingerprint,
                    research_id, scan_id, registry_identity_id, registry_fingerprint_sha256,
                    event_class, observation_type, source, marketplace, listing_id, listing_url,
                    listing_title, observed_price, shipping_price, total_price, currency, sold_at,
                    observed_at, decision, valuation_low, valuation_median, valuation_high,
                    confidence, buy_ceiling, rejection_reason, verified_pricing_truth,
                    verified_identity_truth, pricing_training_eligible, identity_training_mutated,
                    lot_role, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            """, (
                fingerprint, observation.get("parentObservationFingerprint"), observation.get("receiptFingerprint"),
                observation.get("researchId"), observation.get("scanId"), observation.get("registryIdentityId"), observation.get("registryFingerprintSha256"),
                observation["eventClass"], observation["observationType"], observation["source"], observation.get("marketplace"), observation.get("listingId"), observation.get("listingUrl"),
                observation.get("listingTitle"), observation.get("observedPrice"), observation.get("shippingPrice"), observation.get("totalPrice"), observation.get("currency") or "USD", observation.get("soldAt"),
                observation.get("observedAt") or utc_now_iso(), observation.get("decision"), observation.get("valuationLow"), observation.get("valuationMedian"), observation.get("valuationHigh"),
                observation.get("confidence"), observation.get("buyCeiling"), observation.get("rejectionReason"), int(verified_pricing), int(observation["eventClass"] == "VERIFIED_IDENTITY"),
                int(pricing_training_eligible), observation.get("lotRole"), json.dumps(observation, sort_keys=True), utc_now_iso(),
            ))
            saved += int(cursor.rowcount > 0)
    return saved


def load_market_observations(path: Path, *, identity: dict[str, Any] | None = None, research_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    initialize_teacher_comp_learning(path)
    bounded = max(1, min(int(limit), 2000))
    clauses: list[str] = []
    params: list[Any] = []
    if research_id:
        clauses.append("research_id = ?")
        params.append(research_id)
    if identity:
        for column, field in (("registry_identity_id", "registryIdentityId"),):
            value = _text(identity.get(field) or identity.get("registry_identity_id"), 160)
            if value:
                clauses.append(f"{column} = ?")
                params.append(value)
                break
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    with sqlite3.connect(path, timeout=30) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(f"""
            SELECT * FROM instacomp_market_observations
            {where}
            ORDER BY id DESC
            LIMIT ?
        """, (*params, bounded)).fetchall()
    results = []
    for row in rows:
        value = dict(row)
        value["payload"] = json.loads(value.pop("payload_json"))
        results.append(value)
    return results


def append_market_observation_outcome(path: Path, *, prior_observation_fingerprint: str, outcome: dict[str, Any]) -> dict[str, Any]:
    initialize_teacher_comp_learning(path)
    with sqlite3.connect(path, timeout=30) as db:
        db.row_factory = sqlite3.Row
        prior = db.execute("SELECT * FROM instacomp_market_observations WHERE observation_fingerprint = ?", (prior_observation_fingerprint,)).fetchone()
    if prior is None:
        raise ValueError("Prior market observation does not exist.")
    payload = json.loads(prior["payload_json"])
    receipt = {
        "researchId": prior["research_id"],
        "scanId": prior["scan_id"],
        "registryIdentityId": prior["registry_identity_id"],
        "registryFingerprintSha256": prior["registry_fingerprint_sha256"],
        "createdAt": utc_now_iso(),
    }
    observation = _observation_payload(receipt, receipt_fingerprint=prior["receipt_fingerprint"] or prior_observation_fingerprint, event_class="OUTCOME", observation_type="MARKET_OUTCOME", observation={**outcome, "priorObservationFingerprint": prior_observation_fingerprint}, parent_fingerprint=prior_observation_fingerprint)
    saved = _insert_market_observations(path, [observation])
    return {"ok": True, "status": "saved" if saved else "duplicate", "schema_version": MARKET_OBSERVATION_SCHEMA_VERSION, "parent_observation_fingerprint": prior_observation_fingerprint, "identity_training_mutated": False}


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
    expected_required_votes = max(2, len(configured) // 2 + 1)

    accepted_sold = body.get("acceptedSoldComps") or body.get("accepted_sold_comps") or []
    if not isinstance(accepted_sold, list):
        accepted_sold = []

    pricing_eligible_count = int(
        _number(body.get("pricingEligibleSoldCount") or body.get("pricing_eligible_sold_count")) or 0
    )
    trusted_sold_count = min(len(accepted_sold), max(0, pricing_eligible_count))
    consensus_trusted = consensus.get("trusted") is True

    registry_identity_id = _text(
        body.get("registryIdentityId") or body.get("registry_identity_id"), 160
    ) or None
    registry_fingerprint_sha256 = _text(
        body.get("registryFingerprintSha256") or body.get("registry_fingerprint_sha256"), 128
    ) or None

    canonical_identity = body.get("canonicalIdentity") or body.get("canonical_identity") or {}
    if not isinstance(canonical_identity, dict):
        canonical_identity = {}
    canonical_identity_complete = all(
        _text(canonical_identity.get(field), 300)
        for field in ("player", "year", "brand", "setName", "cardNumber")
    )

    student_hypothesis = body.get("studentHypothesis") or body.get("student_hypothesis")
    if not isinstance(student_hypothesis, dict):
        student_hypothesis = None
    elif student_hypothesis:
        student_hypothesis = {
            "status": _text(student_hypothesis.get("status"), 40),
            "studentMode": True,
            "learnMode": True,
            "pricingAuthority": False,
            "marketTruth": False,
            "model": _text(student_hypothesis.get("model"), 160) or None,
            "trainingMemoryExamples": max(0, int(_number(student_hypothesis.get("trainingMemoryExamples")) or 0)),
            "predictedMedian": _number(student_hypothesis.get("predictedMedian")),
            "predictedLow": _number(student_hypothesis.get("predictedLow")),
            "predictedHigh": _number(student_hypothesis.get("predictedHigh")),
            "confidence": max(0.0, min(1.0, _number(student_hypothesis.get("confidence")) or 0.0)),
            "rationale": _text(student_hypothesis.get("rationale"), 1800),
            "uncertainty": [
                _text(value, 300)
                for value in (student_hypothesis.get("uncertainty") if isinstance(student_hypothesis.get("uncertainty"), list) else [])
                if _text(value, 300)
            ][:12],
        }

    # Market truth can only become student training material when independent
    # teachers reached the vote threshold, a canonical Registry identity binds
    # the lesson to one exact card, and at least one pricing-eligible exact sold
    # comp survived the deterministic firewall.
    trusted_market_truth = bool(
        consensus_trusted
        and len(configured) >= 2
        and required_votes >= expected_required_votes
        and trusted_sold_count > 0
        and registry_identity_id
        and registry_fingerprint_sha256
        and canonical_identity_complete
    )

    normalized = {
        "schemaVersion": RECEIPT_SCHEMA_VERSION,
        "source": _text(body.get("source") or "instacomp", 100),
        "scanId": _text(body.get("scanId") or body.get("scan_id"), 120) or None,
        "registryIdentityId": registry_identity_id,
        "registryFingerprintSha256": registry_fingerprint_sha256,
        "canonicalIdentity": canonical_identity,
        "studentHypothesis": student_hypothesis,
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
        "researchId": _text(body.get("researchId") or body.get("research_id"), 160) or None,
        "decision": _text(body.get("decision"), 60) or None,
        "decisionRecord": body.get("decisionRecord") if isinstance(body.get("decisionRecord"), dict) else (body.get("decision_record") if isinstance(body.get("decision_record"), dict) else {}),
        "outcome": body.get("outcome") if isinstance(body.get("outcome"), dict) else (body.get("outcomeRecord") if isinstance(body.get("outcomeRecord"), dict) else (body.get("outcome_record") if isinstance(body.get("outcome_record"), dict) else {})),
        "lot": body.get("lot") if isinstance(body.get("lot"), dict) else (body.get("lotRecord") if isinstance(body.get("lotRecord"), dict) else (body.get("lot_record") if isinstance(body.get("lot_record"), dict) else {})),
        "valuationLow": _number(body.get("valuationLow") or body.get("valuation_low")),
        "valuationHigh": _number(body.get("valuationHigh") or body.get("valuation_high")),
        "buyCeiling": _number(body.get("buyCeiling") or body.get("buy_ceiling")),
        "confidence": _number(body.get("confidence")),
        "pricingEligibleSoldCount": trusted_sold_count if trusted_market_truth else 0,
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
    fingerprint_payload = {key: value for key, value in receipt.items() if key != "createdAt"}
    fingerprint_canonical = json.dumps(
        fingerprint_payload, sort_keys=True, separators=(",", ":")
    )
    fingerprint = hashlib.sha256(fingerprint_canonical.encode("utf-8")).hexdigest()
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
                "market_observations_saved": 0,
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

    saved_observations = _insert_market_observations(path, _market_observations_from_receipt(receipt, fingerprint))

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
        "market_observations_saved": saved_observations,
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
        market_observations = int(db.execute("SELECT COUNT(*) FROM instacomp_market_observations").fetchone()[0])
        retained_rejected = int(db.execute("SELECT COUNT(*) FROM instacomp_market_observations WHERE event_class = 'REJECTED'").fetchone()[0])
        retained_active = int(db.execute("SELECT COUNT(*) FROM instacomp_market_observations WHERE observation_type = 'ACTIVE_ASK'").fetchone()[0])
    return {
        "schema_version": SCHEMA_VERSION,
        "receipt_count": total,
        "trusted_teacher_receipt_count": trusted,
        "trusted_exact_sold_comp_count": sold,
        "market_observation_count": market_observations,
        "retained_rejected_observation_count": retained_rejected,
        "retained_active_ask_count": retained_active,
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
