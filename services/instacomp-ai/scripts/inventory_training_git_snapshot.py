#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import json
import os
import subprocess
from pathlib import Path
from typing import Any, Mapping

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]

SNAPSHOT_SCHEMA = "tcos.instacomp-ai.inventory-training-production-snapshot.v1"
ENVELOPE_SCHEMA = "tcos.instacomp-ai.inventory-training-encrypted-envelope.v1"
ENVELOPE_ALGORITHM = "openssl-aes-256-cbc-pbkdf2-sha256-hmac-v1"
SNAPSHOT_BRANCH = "generated/instacomp-inventory-training-snapshot"
SNAPSHOT_REPO_PATH = "services/instacomp-ai/data/training/inventory-training-production-snapshot.enc.json"
REQUIRED_TABLES = (
    "inventory_items",
    "inventory_images",
    "inventory_attributes",
    "products",
)


class SnapshotUnavailable(RuntimeError):
    """The encrypted snapshot could not be retrieved from Git."""


class SnapshotInvalid(RuntimeError):
    """The retrieved snapshot is malformed, unauthenticated, or undecryptable."""


def decode_snapshot_bytes(raw: bytes) -> dict[str, Any]:
    try:
        decoded = gzip.decompress(raw)
        payload = json.loads(decoded.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - trust boundary must fail closed
        raise SnapshotInvalid(f"inventory snapshot decode failed: {type(exc).__name__}: {exc}") from exc

    if not isinstance(payload, dict):
        raise SnapshotInvalid("inventory snapshot payload is not an object")
    if payload.get("schema_version") != SNAPSHOT_SCHEMA:
        raise SnapshotInvalid(
            f"inventory snapshot schema mismatch: {payload.get('schema_version')!r}"
        )
    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise SnapshotInvalid("inventory snapshot tables payload is missing")
    for name in REQUIRED_TABLES:
        rows = tables.get(name)
        if not isinstance(rows, list):
            raise SnapshotInvalid(f"inventory snapshot table {name} is missing or invalid")
        if any(not isinstance(row, dict) for row in rows):
            raise SnapshotInvalid(f"inventory snapshot table {name} contains a non-object row")

    row_counts = payload.get("row_counts")
    if not isinstance(row_counts, dict):
        raise SnapshotInvalid("inventory snapshot row_counts payload is missing")
    for name in REQUIRED_TABLES:
        expected = row_counts.get(name)
        actual = len(tables[name])
        if expected != actual:
            raise SnapshotInvalid(
                f"inventory snapshot count mismatch for {name}: expected {expected}, got {actual}"
            )
    if int(row_counts.get("inventory_items") or 0) <= 0:
        raise SnapshotInvalid("inventory snapshot contains no inventory_items")
    return payload


def decode_envelope_bytes(raw: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - trust boundary must fail closed
        raise SnapshotInvalid(f"inventory snapshot envelope decode failed: {type(exc).__name__}: {exc}") from exc
    if not isinstance(payload, dict):
        raise SnapshotInvalid("inventory snapshot envelope is not an object")
    if payload.get("schema_version") != ENVELOPE_SCHEMA:
        raise SnapshotInvalid(
            f"inventory snapshot envelope schema mismatch: {payload.get('schema_version')!r}"
        )
    if payload.get("algorithm") != ENVELOPE_ALGORITHM:
        raise SnapshotInvalid(
            f"inventory snapshot envelope algorithm mismatch: {payload.get('algorithm')!r}"
        )
    if payload.get("pbkdf2_iterations") != 200000:
        raise SnapshotInvalid("inventory snapshot PBKDF2 iteration contract mismatch")
    digest = str(payload.get("hmac_sha256") or "").strip().lower()
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise SnapshotInvalid("inventory snapshot envelope HMAC is invalid")
    encoded = str(payload.get("ciphertext_base64") or "").strip()
    try:
        ciphertext = base64.b64decode(encoded, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise SnapshotInvalid("inventory snapshot envelope ciphertext is not valid base64") from exc
    if not ciphertext:
        raise SnapshotInvalid("inventory snapshot envelope ciphertext is empty")
    return payload


def fetch_envelope_from_git(
    *,
    repo_root: Path = REPO_ROOT,
    branch: str = SNAPSHOT_BRANCH,
    repo_path: str = SNAPSHOT_REPO_PATH,
    timeout_seconds: int = 120,
) -> dict[str, Any]:
    remote_ref = f"refs/remotes/origin/{branch}"
    fetch = subprocess.run(
        [
            "git",
            "fetch",
            "--quiet",
            "origin",
            f"+refs/heads/{branch}:{remote_ref}",
        ],
        cwd=repo_root,
        check=False,
        capture_output=True,
        timeout=timeout_seconds,
    )
    if fetch.returncode != 0:
        detail = fetch.stderr.decode("utf-8", "replace")[-500:].strip()
        raise SnapshotUnavailable(
            f"could not fetch inventory snapshot branch {branch}: {detail or 'git fetch failed'}"
        )

    shown = subprocess.run(
        ["git", "show", f"{remote_ref}:{repo_path}"],
        cwd=repo_root,
        check=False,
        capture_output=True,
        timeout=timeout_seconds,
    )
    if shown.returncode != 0:
        detail = shown.stderr.decode("utf-8", "replace")[-500:].strip()
        raise SnapshotUnavailable(
            f"encrypted inventory snapshot is unavailable on {branch}: {detail or 'git show failed'}"
        )
    return decode_envelope_bytes(shown.stdout)


def _snapshot_keys(service_key: str) -> tuple[str, bytes]:
    normalized = str(service_key or "").strip()
    if not normalized:
        raise SnapshotInvalid("Production service-role key is required to decrypt inventory snapshot")
    encoded = normalized.encode("utf-8")
    enc_pass = hashlib.sha256(b"instacomp-snapshot-encryption-v1\0" + encoded).hexdigest()
    mac_key = hashlib.sha256(b"instacomp-snapshot-mac-v1\0" + encoded).digest()
    return enc_pass, mac_key


def decrypt_snapshot_envelope(
    envelope: Mapping[str, Any],
    service_key: str,
    *,
    timeout_seconds: int = 120,
) -> dict[str, Any]:
    validated = decode_envelope_bytes(json.dumps(dict(envelope)).encode("utf-8"))
    ciphertext = base64.b64decode(str(validated["ciphertext_base64"]), validate=True)
    enc_pass, mac_key = _snapshot_keys(service_key)
    expected = str(validated["hmac_sha256"]).lower()
    actual = hmac.new(mac_key, ciphertext, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(actual, expected):
        raise SnapshotInvalid("inventory snapshot authentication failed; refusing untrusted training data")

    env = dict(os.environ)
    env["INSTACOMP_SNAPSHOT_ENC_PASS"] = enc_pass
    completed = subprocess.run(
        [
            "openssl",
            "enc",
            "-d",
            "-aes-256-cbc",
            "-pbkdf2",
            "-iter",
            "200000",
            "-pass",
            "env:INSTACOMP_SNAPSHOT_ENC_PASS",
        ],
        input=ciphertext,
        check=False,
        capture_output=True,
        timeout=timeout_seconds,
        env=env,
    )
    if completed.returncode != 0 or not completed.stdout:
        raise SnapshotInvalid("inventory snapshot decryption failed; refusing untrusted training data")
    return decode_snapshot_bytes(completed.stdout)


class SnapshotSupabaseReader:
    """Drop-in read-only table reader backed by an authenticated encrypted Git snapshot."""

    def __init__(
        self,
        base_url: str,
        service_key: str,
        *,
        snapshot: Mapping[str, Any] | None = None,
        envelope: Mapping[str, Any] | None = None,
    ) -> None:
        del base_url
        if snapshot is not None:
            self.snapshot = dict(snapshot)
        else:
            encrypted = dict(envelope or fetch_envelope_from_git())
            self.snapshot = decrypt_snapshot_envelope(encrypted, service_key)

    def close(self) -> None:
        return None

    def table(self, name: str, *, select: str = "*", page_size: int = 1000) -> list[dict[str, Any]]:
        del select, page_size
        tables = self.snapshot.get("tables")
        if not isinstance(tables, Mapping) or name not in tables:
            raise SystemExit(f"Inventory training snapshot does not contain table {name}")
        rows = tables[name]
        if not isinstance(rows, list):
            raise SystemExit(f"Inventory training snapshot table {name} is invalid")
        return [dict(row) for row in rows]
