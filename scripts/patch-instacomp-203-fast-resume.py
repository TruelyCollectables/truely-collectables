#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "services/instacomp-ai/app/main.py"
IMPORTER = ROOT / "services/instacomp-ai/scripts/import_supervised_203_trusted.py"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text("utf-8")
    if new in source:
        print(f"already patched {label}: {path}")
        return
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block in {path}, found {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")
    print(f"patched {label}: {path}")


# Add a protected supervised archive route. It deliberately does NOT identify the
# card: operator-confirmed identity is written by the lesson endpoint immediately
# afterward. This keeps teacher import separate from runtime identification.
main_source = MAIN.read_text("utf-8")
route_marker = '''\n\n@app.post(\n    "/v1/scans/analyze",\n'''
if '"/v1/scans/supervised-archive"' not in main_source:
    if route_marker not in main_source:
        raise SystemExit("Could not find analyze route insertion point")
    supervised_route = '''\n\n@app.post(\n    "/v1/scans/supervised-archive",\n    dependencies=[Depends(require_api_key)],\n)\nasync def supervised_archive_scan(\n    front: UploadFile = File(...),\n    back: UploadFile = File(...),\n    card_uuid: str | None = Form(default=None),\n):\n    \"\"\"Persist an operator-supervised image pair without re-identifying it.\n\n    This endpoint never creates trusted identity by itself. The caller must follow\n    it with an operator-confirmed lesson, which remains the trust boundary.\n    \"\"\"\n    front_content = await front.read()\n    back_content = await back.read()\n    if len(front_content) + len(back_content) > settings.max_total_image_bytes:\n        raise HTTPException(status_code=413, detail="Combined images are too large")\n    try:\n        front_image = validate_and_normalize_image(\n            front_content,\n            settings.max_image_bytes,\n        )\n        back_image = validate_and_normalize_image(\n            back_content,\n            settings.max_image_bytes,\n        )\n    except ValueError as exc:\n        raise HTTPException(status_code=400, detail=str(exc)) from exc\n\n    persist_image(front_image, image_store_path, "front")\n    persist_image(back_image, image_store_path, "back")\n    scan_id = str(uuid4())\n    created_at = datetime.now(timezone.utc)\n    combined_hash = pair_hash(front_image.sha256, back_image.sha256)\n    physical_card_uuid = _resolve_card_uuid(\n        requested=card_uuid,\n        image_pair_sha256=combined_hash,\n        first_scan_id=scan_id,\n    )\n    archive_only = ChecklistResult(\n        outcome=ChecklistOutcome.INPUT_INCOMPLETE,\n        reasons=[\n            "Operator-supervised archive only; identity is supplied by the following operator-confirmed lesson."\n        ],\n        source_receipts=["operator_supervised_archive_only"],\n    )\n    _save_scan(\n        scan_id=scan_id,\n        card_uuid=physical_card_uuid,\n        created_at=created_at,\n        front_image=front_image,\n        back_image=back_image,\n        combined_hash=combined_hash,\n        suggestion=None,\n        local_vision=None,\n        checklist_result=archive_only,\n        status="supervised_archive_pending_lesson",\n    )\n    return {\n        "schema_version": "tcos.instacomp-ai.supervised-archive.v1",\n        "scan_id": scan_id,\n        "card_uuid": physical_card_uuid,\n        "status": "supervised_archive_pending_lesson",\n        "front_sha256": front_image.sha256,\n        "back_sha256": back_image.sha256,\n        "image_pair_sha256": combined_hash,\n        "identity_created": False,\n        "nothing_published": True,\n    }\n'''
    MAIN.write_text(main_source.replace(route_marker, supervised_route + route_marker, 1), encoding="utf-8")
    print(f"patched supervised archive route: {MAIN}")
else:
    print(f"already patched supervised archive route: {MAIN}")

replace_once(
    IMPORTER,
    '''import sys\nimport tempfile\n''',
    '''import sys\nimport tempfile\nimport time\n''',
    "retry timing import",
)

helper_marker = '''\ndef verify_existing(\n    client: httpx.Client,\n'''
importer_source = IMPORTER.read_text("utf-8")
if "def trusted_example_matches(" not in importer_source:
    if helper_marker not in importer_source:
        raise SystemExit("Could not find verify_existing insertion point")
    helper = '''\ndef trusted_example_matches(\n    examples: list[dict],\n    *,\n    scan_id: str,\n    card_uuid: str,\n    card: dict,\n) -> bool:\n    return any(\n        isinstance(example, dict)\n        and example.get("scan_id") == scan_id\n        and canonical_uuid(example.get("card_uuid")) == canonical_uuid(card_uuid)\n        and example.get("trusted") is True\n        and identity_matches(example.get("confirmed_identity"), card)\n        for example in examples\n    )\n\n'''
    IMPORTER.write_text(importer_source.replace(helper_marker, helper + helper_marker, 1), encoding="utf-8")
    print(f"patched trusted example helper: {IMPORTER}")
else:
    print(f"already patched trusted example helper: {IMPORTER}")

replace_once(
    IMPORTER,
    '''        return any(\n            isinstance(example, dict)\n            and example.get("scan_id") == scan_id\n            and canonical_uuid(example.get("card_uuid")) == canonical_uuid(card_uuid)\n            and example.get("trusted") is True\n            and identity_matches(example.get("confirmed_identity"), card)\n            for example in rows\n        )\n''',
    '''        return trusted_example_matches(\n            rows,\n            scan_id=scan_id,\n            card_uuid=card_uuid,\n            card=card,\n        )\n''',
    "shared trusted example verification",
)

replace_once(
    IMPORTER,
    '''        if health.get("database") != "ready":\n            raise SystemExit(f"Local InstaComp database is not ready: {health}")\n\n        with tempfile.TemporaryDirectory(prefix="instacomp-supervised-203-") as temp_dir:\n''',
    '''        if health.get("database") != "ready":\n            raise SystemExit(f"Local InstaComp database is not ready: {health}")\n\n        # One bulk trusted read makes resume effectively instant. Every row in the\n        # receipt was archive-verified before it was written, so on resume we only\n        # need to prove that the exact trusted training row still exists. A full\n        # archive readback for all 203 cards still runs before final success.\n        resume_examples = get_json(\n            client,\n            "/v1/training/examples?trusted_only=true&limit=5000",\n            timeout=60,\n        ).get("examples") or []\n        resumable_ids: set[str] = set()\n        for card in cards:\n            external_id = card["s"]\n            row = receipt.get("cards", {}).get(external_id) or {}\n            scan_id = str(row.get("scanId") or "")\n            card_uuid = optional_uuid(row.get("cardUuid"))\n            if (\n                row.get("status") == "trusted_verified"\n                and scan_id\n                and card_uuid\n                and trusted_example_matches(\n                    resume_examples,\n                    scan_id=scan_id,\n                    card_uuid=card_uuid,\n                    card=card,\n                )\n            ):\n                resumable_ids.add(external_id)\n\n        if resumable_ids:\n            first_missing = next(\n                (int(card["o"]) for card in cards if card["s"] not in resumable_ids),\n                TOTAL_CARDS + 1,\n            )\n            print(\n                f"RESUME checkpoint: {len(resumable_ids)}/203 already trusted; "\n                f"continuing at {first_missing if first_missing <= TOTAL_CARDS else 'final verification'}.",\n                flush=True,\n            )\n\n        with tempfile.TemporaryDirectory(prefix="instacomp-supervised-203-") as temp_dir:\n''',
    "bulk resume checkpoint",
)

replace_once(
    IMPORTER,
    '''            with zipfile.ZipFile(archive) as zf:\n                zf.extractall(temp_root)\n\n            for card in cards:\n''',
    '''            with zipfile.ZipFile(archive) as zf:\n                needed_files: list[str] = []\n                for card in cards:\n                    if card["s"] in resumable_ids:\n                        continue\n                    ordinal = int(card["o"])\n                    front_index = (ordinal - 1) * 2\n                    needed_files.extend([\n                        scan_filename(front_index),\n                        scan_filename(front_index + 1),\n                    ])\n                for name in needed_files:\n                    zf.extract(name, temp_root)\n                print(\n                    f"Extracted {len(needed_files)} images for {len(needed_files) // 2} remaining cards.",\n                    flush=True,\n                )\n\n            for card in cards:\n''',
    "extract only remaining cards",
)

replace_once(
    IMPORTER,
    '''                if (\n                    existing_scan\n                    and existing_card_uuid\n                    and verify_existing(\n                        client,\n                        scan_id=existing_scan,\n                        card_uuid=existing_card_uuid,\n                        card=card,\n                    )\n                ):\n                    print(\n                        f"[{ordinal:03d}/203] VERIFIED {external_id} card={existing_card_uuid} scan={existing_scan}",\n                        flush=True,\n                    )\n                    existing["status"] = "trusted_verified"\n                    receipt["cards"][external_id] = existing\n                    continue\n''',
    '''                if external_id in resumable_ids:\n                    continue\n''',
    "instant resume skip",
)

replace_once(
    IMPORTER,
    '''                print(f"[{ordinal:03d}/203] ANALYZE {external_id} {front_path.name} + {back_path.name}", flush=True)\n\n                analyze_data = {\n                    "printed_evidence_json": json.dumps(printed_evidence(card), separators=(",", ":")),\n                }\n                if existing_card_uuid:\n                    analyze_data["card_uuid"] = canonical_uuid(existing_card_uuid)\n\n                with front_path.open("rb") as front_handle, back_path.open("rb") as back_handle:\n                    analyze = client.post(\n                        "/v1/scans/analyze",\n                        files={\n                            "front": (front_path.name, front_handle, "image/jpeg"),\n                            "back": (back_path.name, back_handle, "image/jpeg"),\n                        },\n                        data=analyze_data,\n                        timeout=240,\n                    )\n                if analyze.status_code >= 400:\n                    raise RuntimeError(f"{external_id} analyze HTTP {analyze.status_code}: {analyze.text[:1000]}")\n                analyzed = analyze.json()\n''',
    '''                print(f"[{ordinal:03d}/203] ARCHIVE {external_id} {front_path.name} + {back_path.name}", flush=True)\n\n                archive_data = {}\n                if existing_card_uuid:\n                    archive_data["card_uuid"] = canonical_uuid(existing_card_uuid)\n\n                archived_response = None\n                for attempt in range(1, 5):\n                    try:\n                        with front_path.open("rb") as front_handle, back_path.open("rb") as back_handle:\n                            archived_response = client.post(\n                                "/v1/scans/supervised-archive",\n                                files={\n                                    "front": (front_path.name, front_handle, "image/jpeg"),\n                                    "back": (back_path.name, back_handle, "image/jpeg"),\n                                },\n                                data=archive_data,\n                                timeout=90,\n                            )\n                        break\n                    except httpx.TransportError as exc:\n                        if attempt >= 4:\n                            raise\n                        print(\n                            f"[{ordinal:03d}/203] transport retry {attempt}/3 after {type(exc).__name__}: {exc}",\n                            file=sys.stderr,\n                            flush=True,\n                        )\n                        # launchd normally brings the local service back if it was\n                        # interrupted. Wait briefly for health, then retry the same\n                        # exact pair; image-pair UUID binding makes that safe.\n                        for _ in range(30):\n                            try:\n                                probe = client.get("/health", timeout=2)\n                                if probe.status_code == 200:\n                                    break\n                            except httpx.TransportError:\n                                pass\n                            time.sleep(1)\n                        time.sleep(min(attempt * 2, 6))\n                if archived_response is None:\n                    raise RuntimeError(f"{external_id} supervised archive did not return a response")\n                if archived_response.status_code >= 400:\n                    raise RuntimeError(\n                        f"{external_id} supervised archive HTTP {archived_response.status_code}: "\n                        f"{archived_response.text[:1000]}"\n                    )\n                analyzed = archived_response.json()\n''',
    "fast supervised archive with transport retry",
)

print("InstaComp supervised 203 fast-resume patch complete.")
