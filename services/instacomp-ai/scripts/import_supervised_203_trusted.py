#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shlex
import subprocess
import sys
import tempfile
import time
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import httpx

EXPECTED_ARCHIVE_SHA256 = "621d58db6fe31e15d462a72b649e66a8d742639ce39973570e790bae6d11081a"
TOTAL_CARDS = 203


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def norm(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or "")).lower().replace("&", " and ")
    chars = [ch if ch.isalnum() else " " for ch in text]
    return " ".join("".join(chars).split())


def same(a: object, b: object) -> bool:
    return norm(a) == norm(b)


def canonical_uuid(value: object) -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (ValueError, AttributeError, TypeError) as exc:
        raise RuntimeError(f"Invalid permanent card UUID: {value!r}") from exc


def optional_uuid(value: object) -> str:
    try:
        return canonical_uuid(value)
    except RuntimeError:
        return ""


def read_env_value(path: Path, name: str) -> str:
    if not path.is_file():
        return ""
    for raw in path.read_text("utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() != name:
            continue
        value = value.strip()
        try:
            if value.startswith('"'):
                return str(json.loads(value))
            if value.startswith("'"):
                parts = shlex.split(value)
                return parts[0] if parts else ""
        except Exception:
            pass
        return value.strip('"\'')
    return ""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def scan_filename(index: int) -> str:
    return "scan.jpg" if index == 0 else f"scan{index:04d}.jpg"


def load_truth(path: Path) -> list[dict]:
    payload = json.loads(path.read_text("utf-8"))
    cards = payload.get("cards") if isinstance(payload, dict) else None
    if not isinstance(cards, list) or len(cards) != TOTAL_CARDS:
        raise SystemExit(f"Trusted truth file must contain exactly {TOTAL_CARDS} cards.")
    cards = sorted(cards, key=lambda card: int(card["o"]))
    for index, card in enumerate(cards, start=1):
        expected = f"SCAN-{index:04d}"
        if int(card.get("o") or 0) != index or card.get("s") != expected:
            raise SystemExit(f"Trusted truth sequence mismatch at card {index}.")
    return cards


def identity(card: dict) -> dict:
    return {
        "sport": card.get("sp"),
        "league": card.get("lg"),
        "year": card.get("y"),
        "manufacturer": card.get("m"),
        "brand": card.get("b"),
        "set_name": card.get("n"),
        "subset": None,
        "player": card.get("p"),
        "team": None,
        "card_number": card.get("c"),
        "parallel": card.get("q"),
        "variation": None,
        "serial_number": card.get("sn"),
        "serial_run": card.get("sr"),
        "rookie": None,
        "autograph": card.get("a"),
        "inscription": None,
        "inscription_text": None,
        "memorabilia": None,
        "memorabilia_type": None,
    }


def printed_evidence(card: dict) -> dict:
    fields = [
        f"Year {card.get('y')}",
        f"Manufacturer {card.get('m')}",
        f"Product {card.get('b')}",
        f"Set/Insert/Level {card.get('n')}",
        f"Card #{card.get('c')}",
        f"Player {card.get('p')}",
    ]
    if card.get("q"):
        fields.append(f"Parallel {card['q']}")
    if card.get("a") is True:
        fields.append("Autograph yes")
    return {
        "provider": "operator_supervised_203",
        "text": "; ".join(fields),
        "serialNumber": card.get("sn"),
        "checkedImages": 2,
        "conflicts": [],
    }


def identity_matches(found: dict | None, card: dict) -> bool:
    if not isinstance(found, dict):
        return False
    wanted = identity(card)
    for key in ("year", "manufacturer", "brand", "set_name", "player", "card_number", "parallel"):
        if not same(found.get(key), wanted.get(key)):
            return False
    if card.get("sn") is not None and not same(found.get("serial_number"), card.get("sn")):
        return False
    if card.get("sr") is not None and int(found.get("serial_run") or 0) != int(card.get("sr")):
        return False
    if card.get("a") is not None and bool(found.get("autograph")) is not bool(card.get("a")):
        return False
    return True


def get_json(client: httpx.Client, path: str, *, timeout: float = 60.0) -> dict:
    response = client.get(path, timeout=timeout)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected JSON from {path}")
    return payload


def write_json(path: Path, payload: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def trusted_example_matches(
    examples: list[dict],
    *,
    scan_id: str,
    card_uuid: str,
    card: dict,
) -> bool:
    return any(
        isinstance(example, dict)
        and example.get("scan_id") == scan_id
        and canonical_uuid(example.get("card_uuid")) == canonical_uuid(card_uuid)
        and example.get("trusted") is True
        and identity_matches(example.get("confirmed_identity"), card)
        for example in examples
    )


def verify_existing(
    client: httpx.Client,
    *,
    scan_id: str,
    card_uuid: str,
    card: dict,
    examples: list[dict] | None = None,
) -> bool:
    try:
        archive = get_json(client, f"/v1/scans/{scan_id}/archive", timeout=20)
        if archive.get("has_front_image") is not True or archive.get("has_back_image") is not True:
            return False
        if canonical_uuid(archive.get("card_uuid")) != canonical_uuid(card_uuid):
            return False
        rows = examples
        if rows is None:
            rows = get_json(
                client,
                "/v1/training/examples?trusted_only=true&limit=5000",
                timeout=45,
            ).get("examples") or []
        return trusted_example_matches(
            rows,
            scan_id=scan_id,
            card_uuid=card_uuid,
            card=card,
        )
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code if exc.response is not None else "unknown"
        body = exc.response.text[:600] if exc.response is not None else str(exc)
        print(
            f"VERIFY HTTP ERROR scan={scan_id} card={card_uuid} status={status}: {body}",
            file=sys.stderr,
            flush=True,
        )
        return False
    except Exception as exc:
        print(
            f"VERIFY ERROR scan={scan_id} card={card_uuid}: {type(exc).__name__}: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return False


def install_training_runtime(service_root: Path, python_bin: Path) -> None:
    requirements = service_root / "requirements-training.txt"
    if not requirements.is_file():
        raise RuntimeError(f"Training requirements missing: {requirements}")
    subprocess.run(
        [str(python_bin), "-m", "pip", "install", "-r", str(requirements)],
        cwd=service_root,
        check=True,
    )


def run_lora(service_root: Path, python_bin: Path) -> int:
    trainer = service_root / "scripts" / "run_lora_training.py"
    if not trainer.is_file():
        raise RuntimeError(f"LoRA trainer missing: {trainer}")
    print("\n=== REAL LOCAL LoRA TRAINING ===", flush=True)
    print("Training uses trusted local examples. card_uuid is tracking metadata, not a visual target.", flush=True)
    completed = subprocess.run([str(python_bin), str(trainer)], cwd=service_root, check=False)
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Trusted 203 importer with permanent physical-card UUIDs.")
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--truth", required=True, type=Path)
    parser.add_argument("--service-root", required=True, type=Path)
    parser.add_argument("--train-lora", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    archive = args.archive.expanduser().resolve()
    truth_path = args.truth.expanduser().resolve()
    service_root = args.service_root.expanduser().resolve()
    if not archive.is_file():
        raise SystemExit(f"Scan archive not found: {archive}")
    if sha256_file(archive) != EXPECTED_ARCHIVE_SHA256:
        raise SystemExit("Scan archive SHA-256 does not match the reviewed 203-card source archive.")
    cards = load_truth(truth_path)

    with zipfile.ZipFile(archive) as zf:
        names = set(zf.namelist())
        expected_names = [scan_filename(i) for i in range(TOTAL_CARDS * 2)]
        missing_files = [name for name in expected_names if name not in names]
        if missing_files:
            raise SystemExit(f"Scan archive is missing expected files: {missing_files[:10]}")
        if args.verify_only:
            print(json.dumps({
                "ok": True,
                "cards": len(cards),
                "images": len(expected_names),
                "archiveSha256": EXPECTED_ARCHIVE_SHA256,
                "firstPair": expected_names[:2],
                "lastPair": expected_names[-2:],
                "uuidPolicy": "first_scan_uuid_becomes_permanent_card_uuid",
            }, indent=2))
            return 0

    env_file = service_root / ".env"
    api_key = read_env_value(env_file, "INSTACOMP_AI_API_KEY")
    port = read_env_value(env_file, "INSTACOMP_AI_PORT") or "8787"
    if len(api_key) != 64:
        raise SystemExit("INSTACOMP_AI_API_KEY is missing/invalid in the local service .env.")

    base_url = f"http://127.0.0.1:{port}"
    headers = {"X-InstaComp-AI-Key": api_key, "Accept": "application/json"}
    receipt_dir = service_root / "data" / "supervised-203"
    receipt_path = receipt_dir / "trusted-import-receipt.json"
    uuid_map_path = receipt_dir / "card-uuid-map.json"
    receipt = {
        "schema": "tcos.instacomp-ai.supervised-203-local-import.v2",
        "startedAt": utcnow(),
        "archiveSha256": EXPECTED_ARCHIVE_SHA256,
        "uuidPolicy": "first_scan_uuid_becomes_permanent_card_uuid",
        "total": TOTAL_CARDS,
        "cards": {},
        "summary": {},
    }
    if receipt_path.is_file():
        try:
            previous = json.loads(receipt_path.read_text("utf-8"))
            if previous.get("archiveSha256") == EXPECTED_ARCHIVE_SHA256:
                receipt = previous
                receipt["schema"] = "tcos.instacomp-ai.supervised-203-local-import.v2"
                receipt["uuidPolicy"] = "first_scan_uuid_becomes_permanent_card_uuid"
                receipt["resumedAt"] = utcnow()
        except Exception:
            pass

    with httpx.Client(base_url=base_url, headers=headers, follow_redirects=False) as client:
        health = get_json(client, "/health", timeout=30)
        if health.get("database") != "ready":
            raise SystemExit(f"Local InstaComp database is not ready: {health}")

        # One bulk trusted read makes resume effectively instant. Every row in the
        # receipt was archive-verified before it was written, so on resume we only
        # need to prove that the exact trusted training row still exists. A full
        # archive readback for all 203 cards still runs before final success.
        resume_examples = get_json(
            client,
            "/v1/training/examples?trusted_only=true&limit=5000",
            timeout=60,
        ).get("examples") or []
        resumable_ids: set[str] = set()
        for card in cards:
            external_id = card["s"]
            row = receipt.get("cards", {}).get(external_id) or {}
            scan_id = str(row.get("scanId") or "")
            card_uuid = optional_uuid(row.get("cardUuid"))
            if (
                row.get("status") == "trusted_verified"
                and scan_id
                and card_uuid
                and trusted_example_matches(
                    resume_examples,
                    scan_id=scan_id,
                    card_uuid=card_uuid,
                    card=card,
                )
            ):
                resumable_ids.add(external_id)

        if resumable_ids:
            first_missing = next(
                (int(card["o"]) for card in cards if card["s"] not in resumable_ids),
                TOTAL_CARDS + 1,
            )
            print(
                f"RESUME checkpoint: {len(resumable_ids)}/203 already trusted; "
                f"continuing at {first_missing if first_missing <= TOTAL_CARDS else 'final verification'}.",
                flush=True,
            )

        with tempfile.TemporaryDirectory(prefix="instacomp-supervised-203-") as temp_dir:
            temp_root = Path(temp_dir)
            with zipfile.ZipFile(archive) as zf:
                needed_files: list[str] = []
                for card in cards:
                    if card["s"] in resumable_ids:
                        continue
                    ordinal = int(card["o"])
                    front_index = (ordinal - 1) * 2
                    needed_files.extend([
                        scan_filename(front_index),
                        scan_filename(front_index + 1),
                    ])
                for name in needed_files:
                    zf.extract(name, temp_root)
                print(
                    f"Extracted {len(needed_files)} images for {len(needed_files) // 2} remaining cards.",
                    flush=True,
                )

            for card in cards:
                ordinal = int(card["o"])
                external_id = card["s"]
                existing = receipt.get("cards", {}).get(external_id) or {}
                existing_scan = str(existing.get("scanId") or "")
                existing_card_uuid = optional_uuid(existing.get("cardUuid"))
                if external_id in resumable_ids:
                    continue

                front_index = (ordinal - 1) * 2
                back_index = front_index + 1
                front_path = temp_root / scan_filename(front_index)
                back_path = temp_root / scan_filename(back_index)
                print(f"[{ordinal:03d}/203] ARCHIVE {external_id} {front_path.name} + {back_path.name}", flush=True)

                archive_data = {}
                if existing_card_uuid:
                    archive_data["card_uuid"] = canonical_uuid(existing_card_uuid)

                archived_response = None
                for attempt in range(1, 5):
                    try:
                        with front_path.open("rb") as front_handle, back_path.open("rb") as back_handle:
                            archived_response = client.post(
                                "/v1/scans/supervised-archive",
                                files={
                                    "front": (front_path.name, front_handle, "image/jpeg"),
                                    "back": (back_path.name, back_handle, "image/jpeg"),
                                },
                                data=archive_data,
                                timeout=90,
                            )
                        break
                    except httpx.TransportError as exc:
                        if attempt >= 4:
                            raise
                        print(
                            f"[{ordinal:03d}/203] transport retry {attempt}/3 after {type(exc).__name__}: {exc}",
                            file=sys.stderr,
                            flush=True,
                        )
                        # launchd normally brings the local service back if it was
                        # interrupted. Wait briefly for health, then retry the same
                        # exact pair; image-pair UUID binding makes that safe.
                        for _ in range(30):
                            try:
                                probe = client.get("/health", timeout=2)
                                if probe.status_code == 200:
                                    break
                            except httpx.TransportError:
                                pass
                            time.sleep(1)
                        time.sleep(min(attempt * 2, 6))
                if archived_response is None:
                    raise RuntimeError(f"{external_id} supervised archive did not return a response")
                if archived_response.status_code >= 400:
                    raise RuntimeError(
                        f"{external_id} supervised archive HTTP {archived_response.status_code}: "
                        f"{archived_response.text[:1000]}"
                    )
                analyzed = archived_response.json()
                scan_id = canonical_uuid(analyzed.get("scan_id"))
                card_uuid = canonical_uuid(analyzed.get("card_uuid"))
                if not existing_card_uuid and card_uuid != scan_id:
                    # A previous exact-image ingest may legitimately cause this on a resumed run.
                    prior_archive = get_json(client, f"/v1/scans/{scan_id}/archive", timeout=20)
                    if canonical_uuid(prior_archive.get("card_uuid")) != card_uuid:
                        raise RuntimeError(f"{external_id} returned an untraceable physical card UUID")
                if existing_card_uuid and canonical_uuid(existing_card_uuid) != card_uuid:
                    raise RuntimeError(f"{external_id} changed permanent card UUID during resume")

                lesson_body = {
                    "scan_id": scan_id,
                    "state": "operator_confirmed",
                    "identity": identity(card),
                    "verification_source": "supervised_203_operator_confirmed_2026-08-08",
                    "operator_id": "truely-collectables-owner",
                    "notes": " ".join(filter(None, [
                        f"Operator-confirmed reviewed card {ordinal}/203 ({external_id}).",
                        card.get("note"),
                        f"Permanent physical card UUID: {card_uuid}.",
                        "scan_id identifies this scan event; card_uuid follows the physical card across TCOS.",
                        "Structural Base is retained internally but is never displayed in titles.",
                    ])),
                    "rejected_identity": analyzed.get("trusted_identity") or (
                        (analyzed.get("local_suggestion") or {}).get("identity")
                        if isinstance(analyzed.get("local_suggestion"), dict) else None
                    ),
                }
                lesson = client.post("/v1/lessons", json=lesson_body, timeout=60)
                if lesson.status_code >= 400:
                    raise RuntimeError(f"{external_id} lesson HTTP {lesson.status_code}: {lesson.text[:1000]}")

                if not verify_existing(client, scan_id=scan_id, card_uuid=card_uuid, card=card):
                    raise RuntimeError(f"{external_id} did not verify as trusted truth with its permanent card UUID")

                receipt["cards"][external_id] = {
                    "ordinal": ordinal,
                    "cardUuid": card_uuid,
                    "scanId": scan_id,
                    "status": "trusted_verified",
                    "frontFile": front_path.name,
                    "backFile": back_path.name,
                    "operatorTruth": identity(card),
                    "analyzeStatus": analyzed.get("status"),
                    "completedAt": utcnow(),
                }
                receipt["lastCompletedOrdinal"] = ordinal
                write_json(receipt_path, receipt)
                print(f"[{ordinal:03d}/203] TRUSTED {external_id} card={card_uuid} scan={scan_id}", flush=True)

        trusted_payload = get_json(client, "/v1/training/examples?trusted_only=true&limit=5000", timeout=60)
        examples = trusted_payload.get("examples") or []
        missing: list[str] = []
        uuid_rows: list[dict] = []
        seen_card_uuids: set[str] = set()
        for card in cards:
            external_id = card["s"]
            row = receipt.get("cards", {}).get(external_id) or {}
            scan_id = str(row.get("scanId") or "")
            card_uuid = str(row.get("cardUuid") or "")
            if not scan_id or not card_uuid or not verify_existing(
                client,
                scan_id=scan_id,
                card_uuid=card_uuid,
                card=card,
                examples=examples,
            ):
                missing.append(external_id)
                continue
            normalized_uuid = canonical_uuid(card_uuid)
            if normalized_uuid in seen_card_uuids:
                raise RuntimeError(f"Duplicate permanent physical card UUID detected: {normalized_uuid}")
            seen_card_uuids.add(normalized_uuid)
            uuid_rows.append({
                "ordinal": int(card["o"]),
                "reviewId": external_id,
                "cardUuid": normalized_uuid,
                "latestScanId": str(scan_id),
                "player": card.get("p"),
                "year": card.get("y"),
                "brand": card.get("b"),
                "set": card.get("n"),
                "cardNumber": card.get("c"),
                "parallel": card.get("q"),
                "serialNumber": card.get("sn"),
            })

        readiness = get_json(client, "/v1/training/readiness", timeout=45)
        export_response = client.post("/v1/training/export?validation_percent=15", timeout=180)
        if export_response.status_code >= 400:
            raise RuntimeError(f"Training export HTTP {export_response.status_code}: {export_response.text[:1000]}")
        export_manifest = export_response.json()

        uuid_map = {
            "schema": "tcos.instacomp-ai.card-uuid-map.v1",
            "createdAt": utcnow(),
            "archiveSha256": EXPECTED_ARCHIVE_SHA256,
            "uuidPolicy": "first_scan_uuid_becomes_permanent_card_uuid",
            "count": len(uuid_rows),
            "cards": uuid_rows,
        }
        write_json(uuid_map_path, uuid_map)

        receipt["completedAt"] = utcnow()
        receipt["uuidMapPath"] = str(uuid_map_path)
        receipt["summary"] = {
            "ok": len(missing) == 0 and len(uuid_rows) == TOTAL_CARDS,
            "trustedVerified": TOTAL_CARDS - len(missing),
            "uniquePermanentCardUuids": len(seen_card_uuids),
            "missing": missing,
            "trainingReadiness": readiness,
            "trainingExport": export_manifest,
            "nothingPublished": True,
        }
        write_json(receipt_path, receipt)
        print("\n=== TRUSTED UUID IMPORT RECEIPT ===", flush=True)
        print(json.dumps(receipt["summary"], indent=2), flush=True)
        print(f"Master card UUID map: {uuid_map_path}", flush=True)
        if missing or len(uuid_rows) != TOTAL_CARDS:
            return 3

    if args.train_lora:
        python_bin = service_root / ".venv" / "bin" / "python"
        install_training_runtime(service_root, python_bin)
        rc = run_lora(service_root, python_bin)
        if rc != 0:
            print(
                f"LoRA training exited {rc}. Trusted UUID/database import is complete and preserved.",
                file=sys.stderr,
            )
            return rc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
