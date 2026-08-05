#!/usr/bin/env python3
"""Repair pending listing image pairs from the physical Mac archive.

The Mac owns the original front/back JPEGs. This command authenticates to the
Production repair endpoint with the existing InstaComp service token, then
uploads each verified pair. Production performs the Supabase mutation with its
server-only service key. No Supabase secret is downloaded to the Mac.
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
ENDPOINT_PATH = "/api/instacomp/pending-image-repair-push"


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
    value = f"front:{front_sha256}|back:{back_sha256}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


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
        raise RecoveryError(str(result.get("error") or "Production repair failed."))
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
        f"{base_url}{ENDPOINT_PATH}",
        token,
        method="POST",
        body=body,
        content_type=content_type,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Restore original front/back scans to pending listings."
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
        listing = request_json(f"{base_url}{ENDPOINT_PATH}", token)
        items = listing.get("items")
        if not isinstance(items, list):
            raise RecoveryError("Production returned an invalid repair candidate list.")
        if args.limit > 0:
            items = items[: args.limit]

        if not items:
            print("No pending listings are missing a recovered back scan.")
            print("No listings were published.")
            return 0

        repaired = 0
        failed = 0
        print(f"Found {len(items)} pending listing(s) to repair.")
        for index, item in enumerate(items, start=1):
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
                repaired += 1
                status = "verified" if args.dry_run else "repaired"
                print(f"[{index}/{len(items)}] {status}: {title}")
                if not args.dry_run and result.get("hasBackImage") is not True:
                    raise RecoveryError("Production did not confirm the back image.")
            except Exception as error:
                failed += 1
                print(f"[{index}/{len(items)}] FAILED: {title}: {error}", file=sys.stderr)

        action = "verified" if args.dry_run else "repaired"
        print(f"Finished: {repaired} {action}, {failed} failed.")
        print("No listings were published.")
        return 1 if failed else 0
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
