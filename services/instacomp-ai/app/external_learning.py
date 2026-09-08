from __future__ import annotations

import hashlib
import ipaddress
import json
import socket
import sqlite3
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from uuid import uuid4

from .images import (
    pair_hash,
    persist_image,
    persisted_source_path,
    validate_and_normalize_image,
)
from .models import (
    CardIdentity,
    ChecklistOutcome,
    ChecklistResult,
    LearningState,
    LessonCreate,
)
from .storage import MemoryStore, identity_fingerprint

SCHEMA_VERSION = "tcos.instacomp-ai.external-learning.v1"
CANDIDATE_STATES = {"staged", "quarantined", "verified", "promoted", "rejected"}
BLOCKED_LICENSE_TERMS = (
    "noncommercial",
    "non-commercial",
    "cc by-nc",
    "cc-by-nc",
    "cc_by_nc",
    "all rights reserved",
    "personal use only",
    "research use only",
    "research-only",
    "unknown",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def manifest_contract() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "purpose": "Stage outside card examples without allowing outside data to become training truth automatically.",
        "required": [
            "source_name",
            "license",
            "commercial_use_allowed",
            "front_image",
            "identity",
        ],
        "optional": ["source_url", "license_url", "back_image", "metadata"],
        "identity_fields": list(CardIdentity.model_fields),
        "trust_policy": {
            "ingest_creates_trusted_lesson": False,
            "quarantined_can_be_verified": False,
            "verification_requires_operator": True,
            "promotion_requires_second_explicit_step": True,
            "promotion_state": LearningState.OPERATOR_CONFIRMED.value,
            "blank_parallel_means_unknown_not_base": True,
            "external_license_declaration_is_not_legal_advice": True,
        },
    }


def initialize_external_learning(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database_path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS external_learning_candidates (
                candidate_id TEXT PRIMARY KEY,
                state TEXT NOT NULL,
                source_name TEXT NOT NULL,
                source_url TEXT,
                license_name TEXT NOT NULL,
                license_url TEXT,
                commercial_use_allowed INTEGER NOT NULL DEFAULT 0,
                identity_json TEXT NOT NULL,
                front_locator TEXT,
                back_locator TEXT,
                front_normalized_sha256 TEXT,
                back_normalized_sha256 TEXT,
                front_source_extension TEXT,
                back_source_extension TEXT,
                front_perceptual_hash TEXT,
                back_perceptual_hash TEXT,
                image_pair_sha256 TEXT,
                quarantine_reasons_json TEXT NOT NULL,
                validation_receipts_json TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                manifest_fingerprint TEXT,
                operator_id TEXT,
                verification_source TEXT,
                verified_at TEXT,
                promoted_scan_id TEXT,
                promoted_lesson_id TEXT,
                promoted_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS external_learning_state_idx
                ON external_learning_candidates(state, updated_at);
            CREATE INDEX IF NOT EXISTS external_learning_pair_idx
                ON external_learning_candidates(image_pair_sha256);
            """
        )
        columns = {row[1] for row in db.execute("PRAGMA table_info(external_learning_candidates)").fetchall()}
        if "manifest_fingerprint" not in columns:
            db.execute("ALTER TABLE external_learning_candidates ADD COLUMN manifest_fingerprint TEXT")
        db.execute(
            "CREATE INDEX IF NOT EXISTS external_learning_manifest_fingerprint_idx "
            "ON external_learning_candidates(manifest_fingerprint)"
        )


def _text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _license_reasons(record: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    license_name = _text(record.get("license") or record.get("license_name"))
    if not license_name:
        reasons.append("license_missing")
    folded = license_name.casefold()
    if any(term in folded for term in BLOCKED_LICENSE_TERMS):
        reasons.append("license_explicitly_blocks_or_does_not_establish_commercial_use")
    if record.get("commercial_use_allowed") is not True:
        reasons.append("commercial_use_not_explicitly_allowed")
    if not _text(record.get("source_name")):
        reasons.append("source_name_missing")
    return reasons


def _identity_from_record(record: dict[str, Any]) -> tuple[CardIdentity | None, list[str]]:
    raw = record.get("identity")
    if not isinstance(raw, dict):
        return None, ["identity_missing_or_not_object"]
    try:
        identity = CardIdentity.model_validate(raw)
    except Exception as exc:
        return None, [f"identity_invalid:{type(exc).__name__}"]

    reasons: list[str] = []
    if not _text(identity.player):
        reasons.append("identity_player_missing")
    if not _text(identity.year):
        reasons.append("identity_year_missing")
    if not _text(identity.card_number):
        reasons.append("identity_card_number_missing")
    if not any(_text(value) for value in (identity.set_name, identity.brand, identity.manufacturer)):
        reasons.append("identity_product_family_missing")
    return identity, reasons


def _public_https_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme.casefold() != "https":
        raise ValueError("Remote external-learning images must use HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("Remote image URLs may not contain credentials")
    if not parsed.hostname:
        raise ValueError("Remote image URL is missing a hostname")
    if parsed.port not in (None, 443):
        raise ValueError("Remote image URLs may only use HTTPS port 443")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("Remote image hostname could not be resolved") from exc
    for item in addresses:
        address = ipaddress.ip_address(item[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_multicast
            or address.is_reserved
            or address.is_unspecified
        ):
            raise ValueError("Remote image URL resolves to a non-public address")
    return url


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        _public_https_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _read_locator(locator: str, *, max_bytes: int, base_dir: Path | None) -> bytes:
    value = _text(locator)
    if not value:
        raise ValueError("Image locator is empty")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme in {"http", "https"}:
        _public_https_url(value)
        opener = urllib.request.build_opener(_SafeRedirect())
        request = urllib.request.Request(
            value,
            headers={
                "User-Agent": "InstaComp-AI-External-Learning/1.0",
                "Accept": "image/jpeg,image/png,image/webp,*/*;q=0.1",
            },
        )
        with opener.open(request, timeout=30) as response:
            _public_https_url(response.geturl())
            content = response.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise ValueError(f"Remote image exceeds {max_bytes} bytes")
        return content
    if parsed.scheme:
        raise ValueError("Image locator must be an HTTPS URL or local file path")

    path = Path(value).expanduser()
    if not path.is_absolute() and base_dir is not None:
        path = base_dir / path
    path = path.resolve()
    if not path.is_file():
        raise ValueError(f"Local image does not exist: {path}")
    if path.stat().st_size > max_bytes:
        raise ValueError(f"Local image exceeds {max_bytes} bytes")
    return path.read_bytes()


def _candidate_row(db: sqlite3.Connection, candidate_id: str) -> sqlite3.Row | None:
    db.row_factory = sqlite3.Row
    return db.execute(
        "SELECT * FROM external_learning_candidates WHERE candidate_id = ?",
        (candidate_id,),
    ).fetchone()


def _row_dict(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    for key in ("identity_json", "quarantine_reasons_json", "validation_receipts_json", "manifest_json"):
        try:
            result[key.removesuffix("_json")] = json.loads(result.pop(key))
        except Exception:
            result[key.removesuffix("_json")] = None
    result["commercial_use_allowed"] = bool(result.get("commercial_use_allowed"))
    return result


def stage_external_candidate(
    *,
    database_path: Path,
    external_image_root: Path,
    record: dict[str, Any],
    max_image_bytes: int,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    initialize_external_learning(database_path)
    manifest_fingerprint = hashlib.sha256(
        json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    with sqlite3.connect(database_path) as db:
        existing = db.execute(
            "SELECT candidate_id FROM external_learning_candidates WHERE manifest_fingerprint = ? ORDER BY created_at DESC LIMIT 1",
            (manifest_fingerprint,),
        ).fetchone()
        if existing:
            row = _candidate_row(db, existing[0])
            assert row is not None
            return _row_dict(row)
    candidate_id = str(uuid4())
    created_at = _now()
    source_name = _text(record.get("source_name")) or "unnamed_external_source"
    source_url = _text(record.get("source_url")) or None
    license_name = _text(record.get("license") or record.get("license_name")) or "unknown"
    license_url = _text(record.get("license_url")) or None
    reasons = _license_reasons(record)
    identity, identity_reasons = _identity_from_record(record)
    reasons.extend(identity_reasons)
    receipts = [
        f"external_source:{source_name}",
        f"declared_license:{license_name}",
        f"commercial_use_allowed:{record.get('commercial_use_allowed') is True}",
        "external_data_never_auto_trusted",
    ]

    front_locator = _text(record.get("front_image") or record.get("frontImage") or record.get("front_url"))
    back_locator = _text(record.get("back_image") or record.get("backImage") or record.get("back_url"))
    front = back = None
    if not front_locator:
        reasons.append("front_image_missing")
    else:
        try:
            front = validate_and_normalize_image(
                _read_locator(front_locator, max_bytes=max_image_bytes, base_dir=base_dir),
                max_image_bytes,
            )
            persist_image(front, external_image_root, "front")
            receipts.append(f"front_validated:{front.sha256}")
        except Exception as exc:
            reasons.append(f"front_image_invalid:{type(exc).__name__}")
    if back_locator:
        try:
            back = validate_and_normalize_image(
                _read_locator(back_locator, max_bytes=max_image_bytes, base_dir=base_dir),
                max_image_bytes,
            )
            persist_image(back, external_image_root, "back")
            receipts.append(f"back_validated:{back.sha256}")
        except Exception as exc:
            reasons.append(f"back_image_invalid:{type(exc).__name__}")
    else:
        receipts.append("back_image_not_supplied:front_only_training_possible_after_verification")

    deduped_reasons = list(dict.fromkeys(reasons))
    state = "quarantined" if deduped_reasons else "staged"
    image_pair = pair_hash(front.sha256, back.sha256 if back else None) if front else None
    identity_payload = identity.model_dump(mode="json") if identity else {}
    with sqlite3.connect(database_path) as db:
        db.execute(
            """
            INSERT INTO external_learning_candidates (
                candidate_id, state, source_name, source_url, license_name, license_url,
                commercial_use_allowed, identity_json, front_locator, back_locator,
                front_normalized_sha256, back_normalized_sha256,
                front_source_extension, back_source_extension,
                front_perceptual_hash, back_perceptual_hash, image_pair_sha256,
                quarantine_reasons_json, validation_receipts_json, manifest_json, manifest_fingerprint,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                candidate_id,
                state,
                source_name,
                source_url,
                license_name,
                license_url,
                int(record.get("commercial_use_allowed") is True),
                json.dumps(identity_payload, ensure_ascii=False),
                front_locator or None,
                back_locator or None,
                front.sha256 if front else None,
                back.sha256 if back else None,
                front.source_extension if front else None,
                back.source_extension if back else None,
                front.perceptual_hash if front else None,
                back.perceptual_hash if back else None,
                image_pair,
                json.dumps(deduped_reasons),
                json.dumps(receipts),
                json.dumps(record, ensure_ascii=False),
                manifest_fingerprint,
                created_at,
                created_at,
            ),
        )
        row = _candidate_row(db, candidate_id)
    assert row is not None
    return _row_dict(row)


def verify_external_candidate(
    *,
    database_path: Path,
    candidate_id: str,
    operator_id: str,
    corrected_identity: dict[str, Any] | None = None,
    verification_source: str = "operator_external_dataset_review",
) -> dict[str, Any]:
    initialize_external_learning(database_path)
    operator = _text(operator_id)
    if not operator:
        raise ValueError("operator_id is required")
    with sqlite3.connect(database_path) as db:
        row = _candidate_row(db, candidate_id)
        if row is None:
            raise ValueError("Unknown external-learning candidate")
        if row["state"] == "quarantined":
            raise ValueError("Quarantined outside data cannot be verified; fix the manifest/license/identity and re-stage it")
        if row["state"] not in {"staged", "verified"}:
            raise ValueError(f"Candidate state {row['state']} cannot be verified")
        identity_raw = corrected_identity if corrected_identity is not None else json.loads(row["identity_json"])
        identity, reasons = _identity_from_record({"identity": identity_raw})
        if identity is None or reasons:
            raise ValueError("Verified identity is incomplete: " + ", ".join(reasons))
        now = _now()
        db.execute(
            """
            UPDATE external_learning_candidates
            SET state = 'verified', identity_json = ?, operator_id = ?,
                verification_source = ?, verified_at = ?, updated_at = ?
            WHERE candidate_id = ?
            """,
            (
                json.dumps(identity.model_dump(mode="json"), ensure_ascii=False),
                operator,
                _text(verification_source)[:200],
                now,
                now,
                candidate_id,
            ),
        )
        updated = _candidate_row(db, candidate_id)
    assert updated is not None
    return _row_dict(updated)


def promote_external_candidate(
    *,
    database_path: Path,
    external_image_root: Path,
    image_store_path: Path,
    candidate_id: str,
    operator_id: str,
    max_image_bytes: int,
) -> dict[str, Any]:
    initialize_external_learning(database_path)
    store = MemoryStore(database_path)
    store.initialize()
    operator = _text(operator_id)
    if not operator:
        raise ValueError("operator_id is required")
    with sqlite3.connect(database_path) as db:
        row = _candidate_row(db, candidate_id)
        if row is None:
            raise ValueError("Unknown external-learning candidate")
        if row["state"] == "promoted":
            return _row_dict(row)
        if row["state"] != "verified":
            raise ValueError("Only explicitly verified external-learning candidates can be promoted")
        if not bool(row["commercial_use_allowed"]):
            raise ValueError("Candidate does not carry an explicit commercial-use allowance")
        if _license_reasons(
            {
                "source_name": row["source_name"],
                "license": row["license_name"],
                "commercial_use_allowed": bool(row["commercial_use_allowed"]),
            }
        ):
            raise ValueError("Candidate license failed promotion-time revalidation")
        identity = CardIdentity.model_validate_json(row["identity_json"])
        front_sha = row["front_normalized_sha256"]
        if not front_sha or not row["front_source_extension"]:
            raise ValueError("Verified candidate has no usable front image")
        front_source = persisted_source_path(
            external_image_root,
            front_sha,
            "front",
            row["front_source_extension"],
        )
        front = validate_and_normalize_image(front_source.read_bytes(), max_image_bytes)
        back = None
        if row["back_normalized_sha256"] and row["back_source_extension"]:
            back_source = persisted_source_path(
                external_image_root,
                row["back_normalized_sha256"],
                "back",
                row["back_source_extension"],
            )
            back = validate_and_normalize_image(back_source.read_bytes(), max_image_bytes)

    image_pair = pair_hash(front.sha256, back.sha256 if back else None)
    existing = store.find_trusted_image_match(
        image_pair_sha256=image_pair,
        front_perceptual_hash=front.perceptual_hash,
        back_perceptual_hash=back.perceptual_hash if back else None,
    )
    if existing and "exact_image_pair" in existing.reasons:
        if identity_fingerprint(existing.identity) != identity_fingerprint(identity):
            raise ValueError("Exact image pair conflicts with existing trusted InstaComp identity")

    persist_image(front, image_store_path, "front")
    if back:
        persist_image(back, image_store_path, "back")
    scan_id = str(uuid4())
    checklist = ChecklistResult(
        outcome=ChecklistOutcome.INPUT_INCOMPLETE,
        identity_id=None,
        identity=None,
        candidate_count=0,
        reasons=[
            "Outside dataset example was promoted only after explicit operator verification; no Registry exact match is asserted by this receipt."
        ],
        source_receipts=[
            f"external_learning_candidate:{candidate_id}",
            f"external_source:{row['source_name']}",
            f"declared_license:{row['license_name']}",
        ],
    )
    store.save_scan(
        scan_id=scan_id,
        created_at=datetime.now(timezone.utc),
        front_sha256=front.sha256,
        back_sha256=back.sha256 if back else None,
        image_pair_sha256=image_pair,
        front_reference_sha256=front.reference_sha256,
        back_reference_sha256=back.reference_sha256 if back else None,
        front_perceptual_hash=front.perceptual_hash,
        back_perceptual_hash=back.perceptual_hash if back else None,
        local_suggestion=None,
        local_vision=None,
        checklist=checklist.model_dump(mode="json"),
        status="external_operator_verified",
    )
    source = f"external_operator_verified:{_text(row['source_name'])}"[:200]
    notes = (
        f"External candidate {candidate_id}; declared license={row['license_name']}; "
        f"source={row['source_url'] or row['source_name']}. Outside data was staged first and explicitly verified before promotion."
    )[:4000]
    lesson = store.create_lesson(
        LessonCreate(
            scan_id=scan_id,
            state=LearningState.OPERATOR_CONFIRMED,
            identity=identity,
            verification_source=source,
            operator_id=operator,
            notes=notes,
        )
    )
    now = _now()
    with sqlite3.connect(database_path) as db:
        db.execute(
            """
            UPDATE external_learning_candidates
            SET state = 'promoted', promoted_scan_id = ?, promoted_lesson_id = ?,
                promoted_at = ?, updated_at = ?
            WHERE candidate_id = ?
            """,
            (scan_id, lesson.lesson_id, now, now, candidate_id),
        )
        updated = _candidate_row(db, candidate_id)
    assert updated is not None
    result = _row_dict(updated)
    result["training_example_id"] = lesson.training_example_id
    result["trusted_lesson_created"] = True
    return result


def list_external_candidates(
    database_path: Path,
    *,
    state: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    initialize_external_learning(database_path)
    bounded = max(1, min(int(limit), 5000))
    with sqlite3.connect(database_path) as db:
        db.row_factory = sqlite3.Row
        if state:
            if state not in CANDIDATE_STATES:
                raise ValueError("Unknown candidate state")
            rows = db.execute(
                "SELECT * FROM external_learning_candidates WHERE state = ? ORDER BY updated_at DESC LIMIT ?",
                (state, bounded),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM external_learning_candidates ORDER BY updated_at DESC LIMIT ?",
                (bounded,),
            ).fetchall()
    return [_row_dict(row) for row in rows]


def external_learning_status(database_path: Path) -> dict[str, Any]:
    initialize_external_learning(database_path)
    with sqlite3.connect(database_path) as db:
        counts = {
            row[0]: int(row[1])
            for row in db.execute(
                "SELECT state, COUNT(*) FROM external_learning_candidates GROUP BY state"
            ).fetchall()
        }
    return {
        "schema_version": SCHEMA_VERSION,
        "counts": {state: counts.get(state, 0) for state in sorted(CANDIDATE_STATES)},
        "outside_data_auto_trusted": False,
        "promoted_examples_flow_to_existing_training_export": True,
    }


def load_manifest(path: Path) -> list[dict[str, Any]]:
    raw = path.read_text(encoding="utf-8")
    if path.suffix.casefold() == ".jsonl":
        rows: list[dict[str, Any]] = []
        for number, line in enumerate(raw.splitlines(), start=1):
            if not line.strip():
                continue
            payload = json.loads(line)
            if not isinstance(payload, dict):
                raise ValueError(f"Manifest line {number} is not an object")
            rows.append(payload)
        return rows
    payload = json.loads(raw)
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list) and all(isinstance(item, dict) for item in payload):
        return list(payload)
    raise ValueError("Manifest must be one object, an array of objects, or JSONL")


def stage_manifest(
    *,
    database_path: Path,
    external_image_root: Path,
    manifest_path: Path,
    max_image_bytes: int,
) -> list[dict[str, Any]]:
    return [
        stage_external_candidate(
            database_path=database_path,
            external_image_root=external_image_root,
            record=record,
            max_image_bytes=max_image_bytes,
            base_dir=manifest_path.parent,
        )
        for record in load_manifest(manifest_path)
    ]


def _manifest_records_from_text(raw: str) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        rows: list[dict[str, Any]] = []
        for number, line in enumerate(raw.splitlines(), start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            if not isinstance(item, dict):
                raise ValueError(f"Manifest line {number} is not an object")
            rows.append(item)
        return rows
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list) and all(isinstance(item, dict) for item in payload):
        return list(payload)
    raise ValueError("Manifest must be one object, an array of objects, or JSONL")


def stage_manifest_locator(
    *,
    database_path: Path,
    external_image_root: Path,
    manifest_locator: str,
    max_image_bytes: int,
) -> list[dict[str, Any]]:
    parsed = urllib.parse.urlparse(manifest_locator)
    if parsed.scheme in {"http", "https"}:
        raw = _read_locator(manifest_locator, max_bytes=2 * 1024 * 1024, base_dir=None).decode("utf-8")
        records = _manifest_records_from_text(raw)
        base_dir = None
    else:
        path = Path(manifest_locator).expanduser().resolve()
        records = load_manifest(path)
        base_dir = path.parent
    return [
        stage_external_candidate(
            database_path=database_path,
            external_image_root=external_image_root,
            record=record,
            max_image_bytes=max_image_bytes,
            base_dir=base_dir,
        )
        for record in records
    ]
