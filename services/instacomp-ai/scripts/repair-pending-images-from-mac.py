#!/usr/bin/env python3
"""Repair and verify pending listing image pairs from the physical Mac archive.

The Mac owns the original front/back JPEGs. This command authenticates to
Production with the existing InstaComp service token. Production chooses repair
candidates from actual inventory_images rows, accepts the verified file pair,
then exposes a second audit proving both stored image sides exist.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SERVICE_ROOT = Path(__file__).resolve().parents[1]
LOCAL_ENV_PATH = SERVICE_ROOT / ".env"
REPAIR_ENDPOINT_PATH = "/api/instacomp/pending-image-repair-push"
AUDIT_ENDPOINT_PATH = "/api/instacomp/pending-image-repair-audit"


class RecoveryError(RuntimeError):
    pass


def load_local_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip()
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def resolve_local_path(value: str | None, fallback: str) -> Path:
    path = Path(value or fallback).expanduser()
    return path.resolve() if path.is_absolute() else (SERVICE_ROOT / path).resolve()


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def pair_hash(front_sha256: str, back_sha256: str) -> str:
    return hashlib.sha256(
        f"front:{front_sha256}|back:{back_sha256}".encode("utf-8")
    ).hexdigest()


def archived_image_path(root: Path, image_hash: str, side: str) -> Path:
    directory = root / image_hash[:2] / image_hash[2:4]
    preferred = directory / f"{image_hash}-{side}.jpg"
    if preferred.is_file():
        return preferred
    for candidate in sorted(directory.glob(f"{image_hash}-{side}.*")):
        if candidate.is_file():
            return candidate
    raise RecoveryError(
        f"Archived {side} image is missing for hash {image_hash[:12]}…"
    )


def read_scan(database_path: Path, scan_id: str) -> dict[str, Any]:
    if not database_path.is_file():
        raise RecoveryError(f"Local scan database was not found at {database_path}")
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT scan_id,front_sha256,back_sha256,image_pair_sha256,status "
            "FROM scans WHERE scan_id = ?",
            (scan_id,),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise RecoveryError("Scan ID was not found in the Mac archive.")
    result = dict(row)
    if not result.get("back_sha256"):
        raise RecoveryError("The archived scan receipt has no back-image hash.")
    return result


def request_json(
    url: str,
    token: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    content_type: str | None = None,
) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "x-tcos-instacomp-service-token": token,
        "Authorization": f"Bearer {token}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=300) as response:
            payload = response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1500]
        raise RecoveryError(f"Production returned HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RecoveryError(f"Could not reach Production: {error.reason}") from error
    try:
        result = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RecoveryError("Production returned an unreadable response.") from error
    if not isinstance(result, dict):
        raise RecoveryError("Production returned an invalid response.")
    if result.get("ok") is not True:
        raise RecoveryError(str(result.get("error") or "Production request failed."))
    return result


def audit(base_url: str, token: str) -> dict[str, Any]:
    result = request_json(f"{base_url}{AUDIT_ENDPOINT_PATH}", token)
    if not isinstance(result.get("items"), list):
        raise RecoveryError("Production audit did not return an item list.")
    if not isinstance(result.get("candidates"), list):
        raise RecoveryError("Production audit did not return a candidate list.")
    return result


def multipart_body(
    fields: dict[str, str],
    files: list[tuple[str, str, str, bytes]],
) -> tuple[bytes, str]:
    boundary = f"----tcos-instacomp-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    for field_name, filename, mime_type, content in files:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                (
                    f'Content-Disposition: form-data; name="{field_name}"; '
                    f'filename="{filename}"\r\n'
                ).encode(),
                f"Content-Type: {mime_type}\r\n\r\n".encode(),
                content,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def repair_item(
    *,
    base_url: str,
    token: str,
    item: dict[str, Any],
    database_path: Path,
    image_root: Path,
    dry_run: bool,
) -> dict[str, Any]:
    item_id = str(item.get("inventoryItemId") or "").strip()
    scan_id = str(item.get("scanId") or "").strip()
    title = str(item.get("title") or "Untitled item")
    if not item_id or not scan_id:
        raise RecoveryError("Pending candidate is missing its item ID or scan ID.")

    scan = read_scan(database_path, scan_id)
    front_hash = str(scan["front_sha256"]).lower()
    back_hash = str(scan["back_sha256"]).lower()
    stored_pair = str(scan["image_pair_sha256"]).lower()
    front_path = archived_image_path(image_root, front_hash, "front")
    back_path = archived_image_path(image_root, back_hash, "back")
    front_bytes = front_path.read_bytes()
    back_bytes = back_path.read_bytes()

    if sha256_bytes(front_bytes) != front_hash:
        raise RecoveryError("Front-image file failed its saved SHA-256 receipt.")
    if sha256_bytes(back_bytes) != back_hash:
        raise RecoveryError("Back-image file failed its saved SHA-256 receipt.")
    if front_hash == back_hash:
        raise RecoveryError("Archived front and back images are identical.")
    if pair_hash(front_hash, back_hash) != stored_pair:
        raise RecoveryError("Front/back pair failed its saved pair receipt.")

    if dry_run:
        return {"inventoryItemId": item_id, "title": title, "dryRun": True}

    body, content_type = multipart_body(
        {
            "inventoryItemId": item_id,
            "scanId": scan_id,
            "frontSha256": front_hash,
            "backSha256": back_hash,
            "imagePairSha256": stored_pair,
        },
        [
            ("frontImage", "front.jpg", "image/jpeg", front_bytes),
            ("backImage", "back.jpg", "image/jpeg", back_bytes),
        ],
    )
    return request_json(
        f"{base_url}{REPAIR_ENDPOINT_PATH}",
        token,
        method="POST",
        body=body,
        content_type=content_type,
    )


def verify_target_ids(audit_result: dict[str, Any], target_ids: set[str]) -> list[str]:
    remaining: list[str] = []
    for row in audit_result.get("items", []):
        if not isinstance(row, dict):
            continue
        item_id = str(row.get("inventoryItemId") or "")
        if item_id in target_ids and row.get("actualHasBackImage") is not True:
            remaining.append(item_id)
    missing_from_audit = target_ids.difference(
        str(row.get("inventoryItemId") or "")
        for row in audit_result.get("items", [])
        if isinstance(row, dict)
    )
    remaining.extend(sorted(missing_from_audit))
    return sorted(set(remaining))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Restore and verify original front/back scans on pending listings."
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    local_env = load_local_env(LOCAL_ENV_PATH)
    base_url = (
        os.getenv("INSTACOMP_AI_REGISTRY_URL")
        or local_env.get("INSTACOMP_AI_REGISTRY_URL")
        or "https://truelycollectables.com"
    ).rstrip("/")
    token = (
        os.getenv("INSTACOMP_AI_REGISTRY_TOKEN")
        or local_env.get("INSTACOMP_AI_REGISTRY_TOKEN")
        or ""
    ).strip()
    if not token:
        print("ERROR: Local InstaComp Registry token is missing.", file=sys.stderr)
        return 2

    database_path = resolve_local_path(
        os.getenv("INSTACOMP_AI_DATABASE_PATH")
        or local_env.get("INSTACOMP_AI_DATABASE_PATH"),
        "./data/instacomp_ai.sqlite3",
    )
    image_root = resolve_local_path(
        os.getenv("INSTACOMP_AI_IMAGE_STORE_PATH")
        or local_env.get("INSTACOMP_AI_IMAGE_STORE_PATH"),
        "./data/images",
    )

    try:
        before = audit(base_url, token)
        candidates = before["candidates"]
        if args.limit > 0:
            candidates = candidates[: args.limit]

        summary = before.get("summary") or {}
        print(
            "Production audit: "
            f"{summary.get('pendingScanDrafts', 0)} pending scan draft(s), "
            f"{summary.get('missingStoredBack', 0)} missing stored back image(s)."
        )

        if not candidates:
            print("VERIFIED: every audited pending scan has a stored back image.")
            print("No listings were published.")
            return 0

        target_ids = {
            str(item.get("inventoryItemId") or "")
            for item in candidates
            if isinstance(item, dict)
        }
        repaired = 0
        failed = 0
        print(f"Found {len(candidates)} pending listing(s) to repair.")
        for index, item in enumerate(candidates, start=1):
            title = str(item.get("title") or "Untitled item")
            try:
                result = repair_item(
                    base_url=base_url,
                    token=token,
                    item=item,
                    database_path=database_path,
                    image_root=image_root,
                    dry_run=args.dry_run,
                )
                if not args.dry_run and result.get("hasBackImage") is not True:
                    raise RecoveryError("Production upload did not confirm the back image.")
                repaired += 1
                status = "verified locally" if args.dry_run else "uploaded"
                print(f"[{index}/{len(candidates)}] {status}: {title}")
            except Exception as error:
                failed += 1
                print(f"[{index}/{len(candidates)}] FAILED: {title}: {error}", file=sys.stderr)

        if args.dry_run:
            print(f"Finished dry run: {repaired} verified locally, {failed} failed.")
            print("No listings were published.")
            return 1 if failed else 0

        after = audit(base_url, token)
        remaining = verify_target_ids(after, target_ids)
        final_summary = after.get("summary") or {}
        print(
            "Post-repair audit: "
            f"{final_summary.get('complete', 0)} complete, "
            f"{final_summary.get('missingStoredBack', 0)} missing stored back image(s)."
        )
        if remaining:
            print(
                "ERROR: repair verification failed for item ID(s): "
                + ", ".join(remaining),
                file=sys.stderr,
            )
            print("No listings were published.")
            return 1
        if failed:
            print(f"ERROR: {failed} repair upload(s) failed.", file=sys.stderr)
            print("No listings were published.")
            return 1

        print(f"VERIFIED: {repaired} repaired and confirmed with stored back images.")
        print("No listings were published.")
        return 0
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
