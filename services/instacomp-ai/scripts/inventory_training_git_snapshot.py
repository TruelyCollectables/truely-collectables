#!/usr/bin/env python3
from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path
from typing import Any, Mapping

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parents[1]

SNAPSHOT_SCHEMA = "tcos.instacomp-ai.inventory-training-production-snapshot.v1"
SNAPSHOT_BRANCH = "generated/instacomp-inventory-training-snapshot"
SNAPSHOT_REPO_PATH = "services/instacomp-ai/data/training/inventory-training-production-snapshot.json.gz"
REQUIRED_TABLES = (
    "inventory_items",
    "inventory_images",
    "inventory_attributes",
    "products",
)


class SnapshotUnavailable(RuntimeError):
    pass


def decode_snapshot_bytes(raw: bytes) -> dict[str, Any]:
    try:
        decoded = gzip.decompress(raw)
        payload = json.loads(decoded.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001 - boundary validation must fail closed
        raise SnapshotUnavailable(f"inventory snapshot decode failed: {type(exc).__name__}: {exc}") from exc

    if not isinstance(payload, dict):
        raise SnapshotUnavailable("inventory snapshot payload is not an object")
    if payload.get("schema_version") != SNAPSHOT_SCHEMA:
        raise SnapshotUnavailable(
            f"inventory snapshot schema mismatch: {payload.get('schema_version')!r}"
        )
    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise SnapshotUnavailable("inventory snapshot tables payload is missing")
    for name in REQUIRED_TABLES:
        rows = tables.get(name)
        if not isinstance(rows, list):
            raise SnapshotUnavailable(f"inventory snapshot table {name} is missing or invalid")
        if any(not isinstance(row, dict) for row in rows):
            raise SnapshotUnavailable(f"inventory snapshot table {name} contains a non-object row")

    row_counts = payload.get("row_counts")
    if not isinstance(row_counts, dict):
        raise SnapshotUnavailable("inventory snapshot row_counts payload is missing")
    for name in REQUIRED_TABLES:
        expected = row_counts.get(name)
        actual = len(tables[name])
        if expected != actual:
            raise SnapshotUnavailable(
                f"inventory snapshot count mismatch for {name}: expected {expected}, got {actual}"
            )
    return payload


def fetch_snapshot_from_git(
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
            f"inventory snapshot file is unavailable on {branch}: {detail or 'git show failed'}"
        )
    return decode_snapshot_bytes(shown.stdout)


class SnapshotSupabaseReader:
    """Drop-in read-only table reader backed by a validated Git snapshot."""

    def __init__(
        self,
        base_url: str,
        service_key: str,
        *,
        snapshot: Mapping[str, Any] | None = None,
    ) -> None:
        del base_url, service_key
        self.snapshot = dict(snapshot or fetch_snapshot_from_git())

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
