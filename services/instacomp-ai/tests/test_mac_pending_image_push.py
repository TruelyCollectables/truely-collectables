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
        '# comment\nINSTACOMP_AI_DATABASE_PATH="./data/test.sqlite3"\n'
        "INSTACOMP_AI_IMAGE_STORE_PATH='./data/images'\n",
        encoding="utf-8",
    )
    values = module.load_local_env(env)
    assert values["INSTACOMP_AI_DATABASE_PATH"] == "./data/test.sqlite3"
    assert values["INSTACOMP_AI_IMAGE_STORE_PATH"] == "./data/images"


def test_archived_image_path_accepts_existing_hashed_jpeg(tmp_path: Path):
    content = b"front-image"
    digest = hashlib.sha256(content).hexdigest()
    target = tmp_path / digest[:2] / digest[2:4] / f"{digest}-front.jpg"
    target.parent.mkdir(parents=True)
    target.write_bytes(content)
    assert module.archived_image_path(tmp_path, digest, "front") == target


def test_read_local_scan_finds_receipt(tmp_path: Path):
    database = tmp_path / "instacomp.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE scans (
                scan_id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                front_sha256 TEXT NOT NULL,
                back_sha256 TEXT,
                image_pair_sha256 TEXT NOT NULL,
                status TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "INSERT INTO scans VALUES (?, ?, ?, ?, ?, ?)",
            ("scan-1", "2026-08-05T00:00:00Z", "a" * 64, "b" * 64, "c" * 64, "needs_review"),
        )
    scan = module.read_local_scan(database, "scan-1")
    assert scan["front_sha256"] == "a" * 64
    assert scan["back_sha256"] == "b" * 64


def test_recovered_metadata_marks_real_back_image_and_keeps_draft_review_reset():
    row = {
        "metadata": {
            "instacomp": {"scanId": "scan-1", "hasBackImage": False},
            "seller_review": {"identity_confirmed": True},
        }
    }
    scan = {
        "scan_id": "scan-1",
        "front_sha256": "a" * 64,
        "back_sha256": "b" * 64,
        "image_pair_sha256": "c" * 64,
    }
    metadata = module.recovered_metadata(
        row,
        scan,
        "https://example.test/front.jpg",
        "https://example.test/back.jpg",
    )
    assert metadata["instacomp"]["hasBackImage"] is True
    assert metadata["instacomp"]["imageRecoveryStatus"] == "recovered_by_mac_local_push"
    assert metadata["ebay_image_urls"] == [
        "https://example.test/front.jpg",
        "https://example.test/back.jpg",
    ]
    assert metadata["seller_review"]["identity_confirmed"] is False
