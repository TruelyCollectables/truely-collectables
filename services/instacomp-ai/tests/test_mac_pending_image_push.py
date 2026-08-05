from __future__ import annotations

import hashlib
import importlib.util
import sqlite3
from pathlib import Path


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "repair-pending-images-from-mac.py"
)
spec = importlib.util.spec_from_file_location("mac_pending_image_push", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_load_local_env_keeps_values_private(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text(
        '# comment\nINSTACOMP_AI_REGISTRY_URL="https://example.test"\n'
        "INSTACOMP_AI_REGISTRY_TOKEN='private-token'\n",
        encoding="utf-8",
    )
    values = module.load_local_env(env)
    assert values["INSTACOMP_AI_REGISTRY_URL"] == "https://example.test"
    assert values["INSTACOMP_AI_REGISTRY_TOKEN"] == "private-token"


def test_archived_image_path_accepts_existing_hashed_jpeg(tmp_path: Path):
    content = b"front-image"
    digest = hashlib.sha256(content).hexdigest()
    target = tmp_path / digest[:2] / digest[2:4] / f"{digest}-front.jpg"
    target.parent.mkdir(parents=True)
    target.write_bytes(content)
    assert module.archived_image_path(tmp_path, digest, "front") == target


def test_read_scan_finds_front_back_receipt(tmp_path: Path):
    database = tmp_path / "instacomp.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE scans (
                scan_id TEXT PRIMARY KEY,
                front_sha256 TEXT NOT NULL,
                back_sha256 TEXT,
                image_pair_sha256 TEXT NOT NULL,
                status TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "INSERT INTO scans VALUES (?, ?, ?, ?, ?)",
            ("scan-1", "a" * 64, "b" * 64, "c" * 64, "needs_review"),
        )
    scan = module.read_scan(database, "scan-1")
    assert scan["front_sha256"] == "a" * 64
    assert scan["back_sha256"] == "b" * 64


def test_pair_hash_matches_mac_archive_contract():
    front = "a" * 64
    back = "b" * 64
    expected = hashlib.sha256(
        f"front:{front}|back:{back}".encode("utf-8")
    ).hexdigest()
    assert module.pair_hash(front, back) == expected


def test_multipart_contains_both_images_and_receipt_fields():
    body, content_type = module.multipart_body(
        {
            "inventoryItemId": "00000000-0000-4000-8000-000000000000",
            "scanId": "scan-1",
            "frontSha256": "a" * 64,
            "backSha256": "b" * 64,
            "imagePairSha256": "c" * 64,
        },
        [
            ("frontImage", "front.jpg", "image/jpeg", b"front"),
            ("backImage", "back.jpg", "image/jpeg", b"back"),
        ],
    )
    assert content_type.startswith("multipart/form-data; boundary=")
    assert b'name="frontImage"' in body
    assert b'name="backImage"' in body
    assert b'name="imagePairSha256"' in body
    assert b"front" in body
    assert b"back" in body
