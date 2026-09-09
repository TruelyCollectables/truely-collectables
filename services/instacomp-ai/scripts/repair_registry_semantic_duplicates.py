from __future__ import annotations

import argparse
import json
import sqlite3
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REGISTRY = SERVICE_ROOT / "data" / "database" / "checklist_registry.sqlite3"
SUPPLEMENT_LABEL = "InstaComp Registry Gap Supplement"
REPAIR_SCHEMA = "instacomp.registrySemanticRepair.v1"
INDEX_NAME = "checklist_registry_semantic_active_unique"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def norm(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.strip().lower().split())


def semantic_key(row: sqlite3.Row | dict[str, Any]) -> tuple[Any, ...]:
    return (
        norm(row["release_id"]),
        norm(row["normalized_card_number"]),
        norm(row["player"]),
        norm(row["set_name"]),
        norm(row["parallel"] or "Base"),
        norm(row["variation"]),
        int(row["serial_run"]) if row["serial_run"] is not None else -1,
        int(row["is_auto"] or 0),
        int(row["is_relic"] or 0),
        norm(row["sport"]),
        norm(row["league"]),
        norm(row["language_code"]),
        norm(row["configuration_exclusivity"]),
    )


def source_times(db: sqlite3.Connection) -> dict[str, str]:
    return {
        str(row["source_sha256"]): str(row["imported_at"] or "")
        for row in db.execute(
            "SELECT source_sha256, imported_at FROM checklist_registry_imports"
        )
    }


def audit_duplicates(db: sqlite3.Connection) -> dict[str, Any]:
    db.row_factory = sqlite3.Row
    imported_at = source_times(db)
    releases = [
        str(row[0])
        for row in db.execute(
            """SELECT DISTINCT release_id FROM checklist_registry_entries
            WHERE active=1 AND source_label != ? ORDER BY release_id""",
            (SUPPLEMENT_LABEL,),
        )
    ]
    deactivate: list[str] = []
    duplicate_groups = 0
    affected_releases: dict[str, int] = {}
    scanned_rows = 0
    for release_id in releases:
        rows = db.execute(
            """SELECT identity_id, source_sha256, release_id, normalized_card_number,
            player, set_name, parallel, variation, serial_run, is_auto, is_relic,
            sport, league, language_code, configuration_exclusivity
            FROM checklist_registry_entries
            WHERE active=1 AND source_label != ? AND release_id=?""",
            (SUPPLEMENT_LABEL, release_id),
        ).fetchall()
        scanned_rows += len(rows)
        winners: dict[tuple[Any, ...], sqlite3.Row] = {}
        duplicate_keys: set[tuple[Any, ...]] = set()
        release_losers: list[str] = []
        for row in rows:
            key = semantic_key(row)
            current = winners.get(key)
            if current is None:
                winners[key] = row
                continue
            duplicate_keys.add(key)
            current_rank = (
                imported_at.get(str(current["source_sha256"]), ""),
                str(current["source_sha256"]),
                str(current["identity_id"]),
            )
            incoming_rank = (
                imported_at.get(str(row["source_sha256"]), ""),
                str(row["source_sha256"]),
                str(row["identity_id"]),
            )
            if incoming_rank > current_rank:
                release_losers.append(str(current["identity_id"]))
                winners[key] = row
            else:
                release_losers.append(str(row["identity_id"]))
        if release_losers:
            duplicate_groups += len(duplicate_keys)
            deactivate.extend(release_losers)
            affected_releases[release_id] = len(release_losers)
    return {
        "schema": REPAIR_SCHEMA,
        "checked_at": iso_now(),
        "scanned_releases": len(releases),
        "scanned_rows": scanned_rows,
        "duplicate_groups": duplicate_groups,
        "duplicate_rows": len(deactivate),
        "affected_releases": affected_releases,
        "deactivate_identity_ids": deactivate,
    }


def ensure_receipt_table(db: sqlite3.Connection) -> None:
    db.execute(
        """CREATE TABLE IF NOT EXISTS checklist_registry_repairs (
        repair_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        schema_name TEXT NOT NULL,
        details_json TEXT NOT NULL
        )"""
    )


def install_semantic_guard(db: sqlite3.Connection) -> None:
    # The application writers perform semantic upserts so canonical identity_id and
    # fingerprint remain stable. This partial unique index is the final database-level
    # guard against any writer accidentally creating a second active semantic copy.
    db.execute(
        f"""CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NAME}
        ON checklist_registry_entries (
            release_id,
            normalized_card_number,
            lower(trim(coalesce(player,''))),
            lower(trim(coalesce(set_name,''))),
            lower(trim(coalesce(parallel,'Base'))),
            lower(trim(coalesce(variation,''))),
            coalesce(serial_run,-1),
            coalesce(is_auto,0),
            coalesce(is_relic,0),
            lower(trim(coalesce(sport,''))),
            lower(trim(coalesce(league,''))),
            lower(trim(coalesce(language_code,''))),
            lower(trim(coalesce(configuration_exclusivity,'')))
        )
        WHERE active=1 AND source_label != '{SUPPLEMENT_LABEL}'"""
    )


def apply_repair(db: sqlite3.Connection, audit: dict[str, Any]) -> dict[str, Any]:
    ids = [str(value) for value in audit.get("deactivate_identity_ids") or []]
    db.execute("BEGIN IMMEDIATE")
    try:
        for offset in range(0, len(ids), 500):
            chunk = ids[offset : offset + 500]
            placeholders = ",".join("?" for _ in chunk)
            db.execute(
                f"UPDATE checklist_registry_entries SET active=0 WHERE active=1 AND identity_id IN ({placeholders})",
                chunk,
            )
        install_semantic_guard(db)
        ensure_receipt_table(db)
        receipt = dict(audit)
        receipt.pop("deactivate_identity_ids", None)
        receipt["applied_at"] = iso_now()
        receipt["index_name"] = INDEX_NAME
        repair_id = "semantic-dedupe-" + receipt["applied_at"].replace(":", "").replace("+00:00", "Z")
        db.execute(
            "INSERT INTO checklist_registry_repairs (repair_id,created_at,schema_name,details_json) VALUES (?,?,?,?)",
            (repair_id, receipt["applied_at"], REPAIR_SCHEMA, json.dumps(receipt, sort_keys=True)),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    post = audit_duplicates(db)
    result = dict(receipt)
    result["repair_id"] = repair_id
    result["post_duplicate_groups"] = post["duplicate_groups"]
    result["post_duplicate_rows"] = post["duplicate_rows"]
    if post["duplicate_rows"]:
        raise RuntimeError(
            f"semantic duplicate repair incomplete: {post['duplicate_rows']} active duplicate rows remain"
        )
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit/repair semantic duplicates in the Mac Checklist Registry.")
    parser.add_argument("--registry", type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.registry.is_file():
        raise SystemExit(f"Registry not found: {args.registry}")
    db = sqlite3.connect(args.registry, timeout=120)
    db.row_factory = sqlite3.Row
    try:
        audit = audit_duplicates(db)
        if args.apply:
            result = apply_repair(db, audit)
        else:
            result = dict(audit)
            result.pop("deactivate_identity_ids", None)
            result["dry_run"] = True
        print(json.dumps(result, indent=2, sort_keys=True))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
