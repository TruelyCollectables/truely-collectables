#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text(encoding="utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


storage = ROOT / "services/instacomp-ai/app/storage.py"
importer = ROOT / "services/instacomp-ai/scripts/import_supervised_203_trusted.py"
tests = ROOT / "services/instacomp-ai/tests/test_card_uuid_tracking.py"

replace_once(
    storage,
    "from uuid import uuid4\n",
    "from uuid import UUID, uuid4\n",
    "UUID parser import",
)

replace_once(
    storage,
    '''def normalize(value: object) -> str:\n    return " ".join(str(value or "").strip().lower().split())\n\n\ndef identity_fingerprint(identity: CardIdentity) -> str:\n''',
    '''def normalize(value: object) -> str:\n    return " ".join(str(value or "").strip().lower().split())\n\n\ndef canonical_uuid_or_none(value: object) -> str | None:\n    try:\n        return str(UUID(str(value or "").strip()))\n    except (ValueError, AttributeError, TypeError):\n        return None\n\n\ndef repair_legacy_card_uuids(db: sqlite3.Connection) -> int:\n    """Replace legacy/non-UUID physical-card keys with stable real UUIDs.\n\n    Exact front/back image-pair rows share one generated UUID. Existing valid\n    UUIDs are preserved and become the seed for any legacy rows with the same\n    exact image pair. Training-example JSON is updated because card_uuid is\n    tracking metadata carried with the example, never a visual/model target.\n    """\n    rows = db.execute(\n        "SELECT scan_id, card_uuid, image_pair_sha256 FROM scans "\n        "ORDER BY created_at ASC, scan_id ASC"\n    ).fetchall()\n    pair_uuid: dict[str, str] = {}\n    for row in rows:\n        pair_hash = str(row["image_pair_sha256"] or "").strip()\n        valid = canonical_uuid_or_none(row["card_uuid"])\n        if pair_hash and valid and pair_hash not in pair_uuid:\n            pair_uuid[pair_hash] = valid\n\n    repaired = 0\n    for row in rows:\n        current = canonical_uuid_or_none(row["card_uuid"])\n        if current:\n            continue\n        pair_hash = str(row["image_pair_sha256"] or "").strip()\n        resolved = pair_uuid.get(pair_hash)\n        if not resolved:\n            resolved = canonical_uuid_or_none(row["scan_id"]) or str(uuid4())\n            if pair_hash:\n                pair_uuid[pair_hash] = resolved\n        db.execute(\n            "UPDATE scans SET card_uuid = ? WHERE scan_id = ?",\n            (resolved, row["scan_id"]),\n        )\n        repaired += 1\n\n    examples = db.execute(\n        "SELECT te.training_example_id, te.example_json, s.card_uuid "\n        "FROM training_examples te JOIN scans s ON s.scan_id = te.scan_id"\n    ).fetchall()\n    for row in examples:\n        card_uuid = canonical_uuid_or_none(row["card_uuid"])\n        if not card_uuid:\n            continue\n        try:\n            payload = json.loads(row["example_json"])\n        except (TypeError, json.JSONDecodeError):\n            continue\n        if not isinstance(payload, dict) or payload.get("card_uuid") == card_uuid:\n            continue\n        payload["card_uuid"] = card_uuid\n        db.execute(\n            "UPDATE training_examples SET example_json = ? "\n            "WHERE training_example_id = ?",\n            (json.dumps(payload), row["training_example_id"]),\n        )\n    return repaired\n\n\ndef identity_fingerprint(identity: CardIdentity) -> str:\n''',
    "legacy physical-card UUID repair helper",
)

replace_once(
    storage,
    '''            # Legacy scans predate card_uuid. Their historical scan UUID is the\n            # safest permanent seed because no physical-card key existed yet.\n            db.execute("UPDATE scans SET card_uuid = scan_id WHERE card_uuid IS NULL")\n''',
    '''            # Legacy logical scan IDs such as SCAN-0001 are not valid permanent\n            # physical-card UUIDs. Repair them once and keep the result stable.\n            repair_legacy_card_uuids(db)\n''',
    "initialize legacy UUID migration",
)

replace_once(
    storage,
    '''        resolved_card_uuid = str(card_uuid or scan_id).strip()\n        if not resolved_card_uuid:\n            raise ValueError("card_uuid or scan_id is required")\n        with self.connection() as db:\n''',
    '''        requested_uuid = canonical_uuid_or_none(card_uuid)\n        if card_uuid is not None and not requested_uuid:\n            raise ValueError("card_uuid must be a valid UUID")\n        exact_pair_uuid = self.card_uuid_for_image_pair(image_pair_sha256)\n        if requested_uuid and exact_pair_uuid and requested_uuid != exact_pair_uuid:\n            raise ValueError(\n                "The exact front/back image pair is already bound to another card_uuid"\n            )\n        resolved_card_uuid = (\n            requested_uuid\n            or exact_pair_uuid\n            or canonical_uuid_or_none(scan_id)\n            or str(uuid4())\n        )\n        with self.connection() as db:\n''',
    "save_scan valid UUID enforcement",
)

replace_once(
    storage,
    '''        value = str(row["card_uuid"] or "").strip()\n        return value or None\n''',
    '''        return canonical_uuid_or_none(row["card_uuid"])\n''',
    "exact-pair UUID validation",
)

replace_once(
    importer,
    '''def canonical_uuid(value: object) -> str:\n    try:\n        return str(uuid.UUID(str(value or "").strip()))\n    except (ValueError, AttributeError, TypeError) as exc:\n        raise RuntimeError(f"Invalid permanent card UUID: {value!r}") from exc\n\n\ndef read_env_value(path: Path, name: str) -> str:\n''',
    '''def canonical_uuid(value: object) -> str:\n    try:\n        return str(uuid.UUID(str(value or "").strip()))\n    except (ValueError, AttributeError, TypeError) as exc:\n        raise RuntimeError(f"Invalid permanent card UUID: {value!r}") from exc\n\n\ndef optional_uuid(value: object) -> str:\n    try:\n        return canonical_uuid(value)\n    except RuntimeError:\n        return ""\n\n\ndef read_env_value(path: Path, name: str) -> str:\n''',
    "optional legacy receipt UUID parser",
)

replace_once(
    importer,
    '''                existing_card_uuid = str(existing.get("cardUuid") or "")\n''',
    '''                existing_card_uuid = optional_uuid(existing.get("cardUuid"))\n''',
    "ignore invalid pre-migration receipt UUID",
)

replace_once(
    importer,
    '''                "latestScanId": canonical_uuid(scan_id),\n''',
    '''                "latestScanId": str(scan_id),\n''',
    "allow historical logical scan IDs in UUID map",
)

append_marker = "def test_initialize_repairs_legacy_non_uuid_card_ids_stably"
source = tests.read_text(encoding="utf-8")
if append_marker not in source:
    source += '''\n\ndef _insert_legacy_scan(\n    store: MemoryStore,\n    *,\n    scan_id: str,\n    image_pair_sha256: str,\n    card_uuid: str | None,\n) -> None:\n    with store.connection() as db:\n        db.execute(\n            """\n            INSERT INTO scans (\n                scan_id, card_uuid, created_at, front_sha256, back_sha256,\n                image_pair_sha256, checklist_json, status\n            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)\n            """,\n            (\n                scan_id,\n                card_uuid,\n                datetime.now(timezone.utc).isoformat(),\n                f"front-{scan_id}",\n                f"back-{scan_id}",\n                image_pair_sha256,\n                '{"outcome":"input_incomplete","candidate_count":0,"reasons":[],"source_receipts":[]}',\n                "needs_review",\n            ),\n        )\n\n\ndef test_initialize_repairs_legacy_non_uuid_card_ids_stably(tmp_path):\n    store = MemoryStore(tmp_path / "memory.sqlite3")\n    store.initialize()\n    _insert_legacy_scan(\n        store,\n        scan_id="SCAN-0001",\n        image_pair_sha256="legacy-pair-shared",\n        card_uuid=None,\n    )\n    _insert_legacy_scan(\n        store,\n        scan_id="SCAN-0002",\n        image_pair_sha256="legacy-pair-shared",\n        card_uuid="SCAN-0002",\n    )\n    _insert_legacy_scan(\n        store,\n        scan_id="SCAN-0003",\n        image_pair_sha256="legacy-pair-distinct",\n        card_uuid="SCAN-0003",\n    )\n\n    store.initialize()\n    first = store.get_scan("SCAN-0001")\n    second = store.get_scan("SCAN-0002")\n    third = store.get_scan("SCAN-0003")\n    assert first and second and third\n    UUID(first["card_uuid"])\n    UUID(second["card_uuid"])\n    UUID(third["card_uuid"])\n    assert first["card_uuid"] == second["card_uuid"]\n    assert first["card_uuid"] != third["card_uuid"]\n\n    stable = first["card_uuid"]\n    store.initialize()\n    assert store.get_scan("SCAN-0001")["card_uuid"] == stable\n    assert store.card_uuid_for_image_pair("legacy-pair-shared") == stable\n\n\ndef test_save_scan_generates_real_uuid_for_legacy_logical_scan_id(tmp_path):\n    store = MemoryStore(tmp_path / "memory.sqlite3")\n    store.initialize()\n    store.save_scan(\n        scan_id="SCAN-0101",\n        created_at=datetime.now(timezone.utc),\n        front_sha256="f" * 64,\n        back_sha256="b" * 64,\n        image_pair_sha256="legacy-save-pair",\n        local_suggestion=None,\n        local_vision=None,\n        checklist={\n            "outcome": "input_incomplete",\n            "candidate_count": 0,\n            "reasons": [],\n            "source_receipts": [],\n        },\n        status="needs_review",\n    )\n    archive = store.get_scan("SCAN-0101")\n    assert archive is not None\n    UUID(archive["card_uuid"])\n    assert archive["card_uuid"] != "SCAN-0101"\n'''
    tests.write_text(source, encoding="utf-8")
    print(f"patched legacy UUID regression tests: {tests}")
else:
    print(f"already patched legacy UUID regression tests: {tests}")

print("Legacy physical-card UUID migration repair complete.")
