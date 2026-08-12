from __future__ import annotations

import base64
import csv
import hashlib
import io
import lzma
import re
import subprocess
from pathlib import Path
from typing import Any, Mapping

COLLX_SOURCE_BRANCH = "ops/collx-full-inventory-migration-20260811"
COLLX_SOURCE_REMOTE_REF = f"refs/remotes/origin/{COLLX_SOURCE_BRANCH}"
COLLX_SOURCE_EXPECTED_ROWS = 6909
COLLX_SOURCE_EXPECTED_SHA256 = "e5675ad8a23c345bf76aa7f28d73fe5cf8f56452a2bff4595b92a88a6358e904"
COLLX_SOURCE_PARTS = tuple(
    [f"collx-full-metadata.part{index:02d}" for index in range(10)]
    + [
        "collx-full-metadata.part10m0",
        "collx-full-metadata.part10m1",
        "collx-full-metadata.part11",
        "collx-full-metadata.part12",
        "collx-full-metadata.part13",
        "collx-full-metadata.part14m",
        "collx-full-metadata.part15m",
    ]
)


def collx_id_from_inventory(
    item: Mapping[str, Any],
    product: Mapping[str, Any] | None = None,
) -> str | None:
    product = product or {}
    for raw in (item.get("sku"), product.get("sku")):
        value = str(raw or "").strip()
        match = re.fullmatch(r"COLLX-(\d+)", value, re.IGNORECASE)
        if match:
            return match.group(1)
    metadata = item.get("metadata")
    if isinstance(metadata, Mapping):
        for key in ("collx_id", "collxId", "source_id", "sourceId"):
            value = str(metadata.get(key) or "").strip()
            if value.isdigit():
                return value
    return None


def _run_git(repo_root: Path, *args: str) -> bytes:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        error = completed.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {error[:500]}")
    return completed.stdout


def _ensure_source_ref(repo_root: Path) -> None:
    probe = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", COLLX_SOURCE_REMOTE_REF],
        cwd=repo_root,
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if probe.returncode == 0:
        return
    _run_git(
        repo_root,
        "fetch",
        "--quiet",
        "origin",
        f"refs/heads/{COLLX_SOURCE_BRANCH}:{COLLX_SOURCE_REMOTE_REF}",
    )


def decode_verified_collx_source(encoded: bytes) -> list[dict[str, str]]:
    compact = b"".join(encoded.split())
    try:
        compressed = base64.b64decode(compact, validate=True)
        csv_bytes = lzma.decompress(compressed)
    except Exception as exc:  # pragma: no cover - concrete exception types vary by corruption
        raise RuntimeError(f"Could not decode authoritative CollX source: {type(exc).__name__}: {exc}") from exc

    digest = hashlib.sha256(csv_bytes).hexdigest()
    if digest != COLLX_SOURCE_EXPECTED_SHA256:
        raise RuntimeError(
            "Authoritative CollX source checksum mismatch: "
            f"expected {COLLX_SOURCE_EXPECTED_SHA256}, got {digest}"
        )

    text = csv_bytes.decode("utf-8-sig")
    rows = [dict(row) for row in csv.DictReader(io.StringIO(text, newline=""))]
    ids = [str(row.get("collx_id") or "").strip() for row in rows]
    if len(rows) != COLLX_SOURCE_EXPECTED_ROWS:
        raise RuntimeError(
            f"Authoritative CollX source row count mismatch: expected {COLLX_SOURCE_EXPECTED_ROWS}, got {len(rows)}"
        )
    if len(set(ids)) != COLLX_SOURCE_EXPECTED_ROWS or any(not value for value in ids):
        raise RuntimeError("Authoritative CollX source does not contain 6,909 unique non-empty collx_id values")
    return rows


def load_authoritative_collx_source(repo_root: Path) -> dict[str, dict[str, str]]:
    """Load the exact checksummed 6,909-row CollX export retained in Git history.

    This is read-only. The historical ops branch is fetched only when its remote
    ref is absent locally. Nothing is written to Production inventory.
    """
    _ensure_source_ref(repo_root)
    chunks: list[bytes] = []
    for part in COLLX_SOURCE_PARTS:
        path = f".github/ops/{part}"
        chunks.append(_run_git(repo_root, "show", f"{COLLX_SOURCE_REMOTE_REF}:{path}"))
    rows = decode_verified_collx_source(b"".join(chunks))
    return {str(row["collx_id"]).strip(): row for row in rows}


def _text(value: object) -> str | None:
    text = " ".join(str(value or "").strip().split())
    return text or None


def collx_source_attributes(row: Mapping[str, Any]) -> dict[str, Any]:
    """Translate the operator-owned CollX export into existing CardIdentity aliases.

    These values are fallback truth only. Current structured inventory attributes
    overlay them later, so operator corrections made after the export remain the
    final authority.
    """
    result: dict[str, Any] = {}
    mapping = {
        "Year": row.get("year"),
        "Brand": row.get("brand"),
        "Set": row.get("set"),
        "Player/Athlete": row.get("name"),
        "Card Number": row.get("number"),
        "Features": row.get("flags"),
    }
    for key, value in mapping.items():
        cleaned = _text(value)
        if cleaned:
            result[key] = cleaned

    flags = str(row.get("flags") or "").upper()
    flag_tokens = set(re.findall(r"[A-Z0-9]+", flags))
    if "AU" in flag_tokens:
        result["Autographed"] = True
    if "RC" in flag_tokens:
        result["Rookie"] = True
    serial = re.search(r"\bSN\s*(\d{1,7})\b", flags)
    if serial and int(serial.group(1)) > 0:
        result["Print Run"] = int(serial.group(1))
    return result


def merge_collx_fallback_attributes(
    current_attributes: Mapping[str, Any] | None,
    source_row: Mapping[str, Any] | None,
) -> dict[str, Any]:
    """Historical verified source first; current inventory truth always wins."""
    merged = collx_source_attributes(source_row or {}) if source_row else {}
    if current_attributes:
        merged.update(dict(current_attributes))
    return merged
