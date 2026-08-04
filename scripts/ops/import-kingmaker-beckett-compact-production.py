#!/usr/bin/env python3
import argparse, base64, hashlib, json, lzma, os, re, time
from datetime import datetime, timezone
from pathlib import Path

import msgpack
import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

BATCH = 500
EXPECTED_SCHEMA = "tcos.kingmaker.beckettCompactRows.v1"


def clean(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def source_key(source_sha, page, row, raw_text):
    payload = {
        "sourceSha256": source_sha,
        "pageNumber": page,
        "rowOrder": row,
        "rawText": clean(raw_text),
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class Supabase:
    def __init__(self, url, key):
        self.base = url.rstrip("/") + "/rest/v1"
        self.session = requests.Session()
        self.session.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def request(self, method, path, *, params=None, body=None, headers=None, timeout=180):
        url = self.base + path
        merged = dict(headers or {})
        for attempt in range(7):
            response = self.session.request(method, url, params=params, json=body, headers=merged, timeout=timeout)
            if response.status_code not in {429, 500, 502, 503, 504}:
                if not response.ok:
                    raise RuntimeError(f"Supabase {method} {path} failed ({response.status_code}): {response.text[:1000]}")
                return response
            time.sleep(min(30, 2 ** attempt))
        raise RuntimeError(f"Supabase {method} {path} exhausted retries")

    def upsert(self, table, rows, on_conflict, *, returning=False):
        headers = {
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation" if returning else "resolution=merge-duplicates,return=minimal",
        }
        response = self.request("POST", f"/{table}", params={"on_conflict": on_conflict}, body=rows, headers=headers)
        return response.json() if returning else None

    def patch(self, table, filters, row):
        self.request("PATCH", f"/{table}", params=filters, body=row, headers={"Content-Type": "application/json", "Prefer": "return=minimal"})

    def rpc(self, name, body):
        return self.request("POST", f"/rpc/{name}", body=body, headers={"Content-Type": "application/json"}, timeout=900).json()

    def count(self, table, filters):
        response = self.request("GET", f"/{table}", params={"select": "id", **filters}, headers={"Prefer": "count=exact", "Range": "0-0"})
        total = response.headers.get("content-range", "").split("/")[-1]
        return int(total) if total.isdigit() else len(response.json())


def decode_payload(args):
    envelope = json.loads(Path(args.envelope).read_text())
    if envelope.get("schema") != "tcos.kingmaker.beckettEncryptedCompactTransport.v1":
        raise RuntimeError("Unexpected encrypted transport schema")
    if datetime.fromisoformat(envelope["expiresAt"].replace("Z", "+00:00")) <= datetime.now(timezone.utc):
        raise RuntimeError("Encrypted transport has expired")
    encoded = "".join((Path(args.chunks) / name).read_text().strip() for name in envelope["chunks"])
    ciphertext = base64.b64decode(encoded, validate=True)
    if len(ciphertext) != envelope["ciphertextBytes"]:
        raise RuntimeError("Ciphertext length mismatch")
    if hashlib.sha256(ciphertext).hexdigest() != envelope["ciphertextSha256"]:
        raise RuntimeError("Ciphertext hash mismatch")
    private_key = serialization.load_pem_private_key(Path(args.private_key).read_bytes(), password=None)
    key = private_key.decrypt(
        base64.b64decode(envelope["wrappedKeyBase64"]),
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    plaintext = AESGCM(key).decrypt(
        base64.b64decode(envelope["nonceBase64"]),
        ciphertext + base64.b64decode(envelope["authTagBase64"]),
        base64.b64decode(envelope["aadBase64"]),
    )
    if hashlib.sha256(plaintext).hexdigest() != envelope["plaintextSha256"]:
        raise RuntimeError("Plaintext hash mismatch")
    payload = msgpack.unpackb(lzma.decompress(plaintext), raw=False)
    if payload.get("schema") != EXPECTED_SCHEMA:
        raise RuntimeError("Unexpected compact payload schema")
    return envelope, payload


def batches(rows):
    for offset in range(0, len(rows), BATCH):
        yield rows[offset: offset + BATCH]


def string_at(strings, index):
    return None if index is None or index < 0 else strings[index]


def compact_raw(kind, product, card, player, low, high):
    identity = " ".join(x for x in [card or kind, player or product] if x)
    return clean(f"{identity} {low:.2f} {high:.2f}")


def import_guide(db, guide, envelope):
    manifest = guide["manifest"]
    meta = manifest["guide"]
    source_sha = meta["sourceSha256"]
    strings = guide["strings"]
    payload_hash = envelope["plaintextSha256"]
    guide_rows = db.upsert(
        "tcos_kingmaker_price_guides",
        [{
            "source": "beckett",
            "title": meta["title"],
            "sport": meta["sport"],
            "issue_code": meta.get("issueCode"),
            "edition_date": meta["editionDate"],
            "original_filename": meta["originalFilename"],
            "source_sha256": source_sha,
            "page_count": meta["pageCount"],
            "price_guide_start_page": meta["priceGuideStartPage"],
            "price_guide_end_page": meta["priceGuideEndPage"],
            "parser_version": manifest["parserVersion"],
            "extraction_status": "validation_required",
            "redistribution_allowed": False,
            "metadata": {
                "transport": "encrypted_compact_v1",
                "fullBundleValidationSha256": envelope["fullBundleValidationSha256"],
                "fullOcrPreservedOutsideDatabase": True,
                "counts": manifest["counts"],
            },
        }],
        "source_sha256",
        returning=True,
    )
    guide_id = guide_rows[0]["id"]
    run_key = f"{source_sha}:compact-v1:{payload_hash}"
    run_rows = db.upsert(
        "tcos_kingmaker_price_import_runs",
        [{
            "guide_id": guide_id,
            "run_key": run_key,
            "parser_version": manifest["parserVersion"],
            "status": "running",
            "pages_seen": len(guide["pages"]),
            "entries_seen": len(guide["entries"]),
            "metadata": {"transport": "encrypted_compact_v1", "payloadSha256": payload_hash},
        }],
        "run_key",
        returning=True,
    )
    run_id = run_rows[0]["id"]

    page_rows = []
    for page, image_i, engine_i, confidence_i, columns, width, height in guide["pages"]:
        page_rows.append({
            "guide_id": guide_id,
            "import_run_id": run_id,
            "page_number": page,
            "printed_page_number": None,
            "section_name": None,
            "image_sha256": string_at(strings, image_i),
            "ocr_engine": string_at(strings, engine_i) or "compact-import",
            "ocr_confidence": confidence_i / 10000,
            "ocr_text": None,
            "layout": {"columns": columns, "nativeWidth": width, "nativeHeight": height},
            "status": "validation_required",
            "metadata": {"fullOcrTextPreservedInValidatedPrivateBundle": True},
        })
    for batch in batches(page_rows):
        db.upsert("tcos_kingmaker_price_pages", batch, "guide_id,page_number")

    entry_rows = []
    for row in guide["entries"]:
        page, row_order, kind_i, year_i, season_i, mfr_i, product_i, parallel_i, card_i, player_i, flags, low_cents, high_cents, confidence_i, column = row
        kind = string_at(strings, kind_i) or "other"
        year = string_at(strings, year_i)
        season = string_at(strings, season_i)
        mfr = string_at(strings, mfr_i)
        product = string_at(strings, product_i)
        parallel = string_at(strings, parallel_i)
        card = string_at(strings, card_i)
        player = string_at(strings, player_i)
        low = low_cents / 100
        high = high_cents / 100
        raw_text = compact_raw(kind, product, card, player, low, high)
        entry_rows.append({
            "guide_id": guide_id,
            "import_run_id": run_id,
            "page_number": page,
            "row_order": row_order,
            "source_row_key": source_key(source_sha, page, row_order, raw_text),
            "entry_kind": kind,
            "release_year": year,
            "season": season,
            "manufacturer": mfr,
            "brand": mfr,
            "product": product,
            "set_name": product,
            "parallel_name": parallel,
            "card_number": card,
            "player_name": player,
            "team_name": None,
            "rookie_designation": bool(flags & 1),
            "autograph_designation": bool(flags & 2),
            "memorabilia_designation": bool(flags & 4),
            "short_print_designation": bool(flags & 8),
            "error_designation": bool(flags & 16),
            "variation": None,
            "serial_run": None,
            "condition_basis": "raw",
            "value_low": low,
            "value_high": high,
            "currency": "USD",
            "multiplier_low": None,
            "multiplier_high": None,
            "raw_text": raw_text,
            "parse_confidence": confidence_i / 10000,
            "validation_status": "review",
            "validation_reasons": ["ocr_value_verification_required", "checklist_identity_match_required", "compact_transport_raw_line_reconstructed"],
            "entity_key": None,
            "metadata": {"sourceEngine": "compact_transport", "column": column, "fullOcrPreservedOutsideDatabase": True},
        })
        if len(entry_rows) >= BATCH:
            db.upsert("tcos_kingmaker_price_entries", entry_rows, "guide_id,source_row_key")
            entry_rows = []
    if entry_rows:
        db.upsert("tcos_kingmaker_price_entries", entry_rows, "guide_id,source_row_key")

    match_result = db.rpc("tcos_match_kingmaker_price_entries", {"p_guide_id": guide_id})
    actual_pages = db.count("tcos_kingmaker_price_pages", {"guide_id": f"eq.{guide_id}"})
    actual_entries = db.count("tcos_kingmaker_price_entries", {"guide_id": f"eq.{guide_id}"})
    if actual_pages != len(guide["pages"]) or actual_entries != len(guide["entries"]):
        raise RuntimeError(f"Production count mismatch for {guide['name']}: pages {actual_pages}/{len(guide['pages'])}, entries {actual_entries}/{len(guide['entries'])}")
    db.patch(
        "tcos_kingmaker_price_import_runs",
        {"id": f"eq.{run_id}"},
        {
            "status": "validation_required",
            "pages_accepted": 0,
            "entries_accepted": 0,
            "entries_review": actual_entries,
            "entries_rejected": 0,
            "completed_at": iso_now(),
            "metadata": {"transport": "encrypted_compact_v1", "payloadSha256": payload_hash, "matchResult": match_result},
        },
    )
    return {
        "name": guide["name"],
        "guideId": guide_id,
        "importRunId": run_id,
        "pages": actual_pages,
        "entries": actual_entries,
        "matchResult": match_result,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--envelope", required=True)
    parser.add_argument("--chunks", required=True)
    parser.add_argument("--private-key", required=True)
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Production Supabase URL and service-role key are required")
    envelope, payload = decode_payload(args)
    db = Supabase(url, key)
    results = [import_guide(db, guide, envelope) for guide in payload["guides"]]
    total_pages = sum(item["pages"] for item in results)
    total_entries = sum(item["entries"] for item in results)
    if total_pages != envelope["totalPages"] or total_entries != envelope["totalEntries"]:
        raise RuntimeError(f"Final totals mismatch: pages {total_pages}, entries {total_entries}")
    receipt = {
        "schema": "tcos.kingmaker.beckettProductionImportReceipt.v1",
        "status": "passed",
        "completedAt": iso_now(),
        "transportId": envelope["transportId"],
        "payloadSha256": envelope["plaintextSha256"],
        "fullBundleValidationSha256": envelope["fullBundleValidationSha256"],
        "totalPages": total_pages,
        "totalEntries": total_entries,
        "promotedObservations": 0,
        "guides": results,
        "privateSourceDataCommittedToRepository": False,
        "readableOcrCommittedToRepository": False,
    }
    Path(args.receipt).parent.mkdir(parents=True, exist_ok=True)
    Path(args.receipt).write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
