from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.local_registry_store import LocalRegistryStore
from app.sentinel_store import SentinelStore

STATE_DB = SERVICE_ROOT / "data" / "instacomp_ai.sqlite3"
REGISTRY_DB = SERVICE_ROOT / "data" / "database" / "checklist_registry.sqlite3"
STATUS_PATH = SERVICE_ROOT / "data" / "checklist-sentinel" / "bridge-status.json"
RECEIPT_ROOT = SERVICE_ROOT / "data" / "checklist-sentinel" / "bridge-receipts"
PENDING_STATUSES = {
    "downloaded_local_pending_registry_import",
    "downloaded_local_pending_registry_validation",
}
SUPPORTED_SUFFIXES = {".html", ".htm", ".xlsx", ".xls", ".csv", ".pdf"}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utcnow().isoformat()


def norm(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def slug(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")


def parse_time(value: object) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def semantic_key(row: dict[str, Any] | sqlite3.Row) -> tuple[Any, ...]:
    return (
        norm(row["year"]), norm(row["manufacturer"]), norm(row["brand"]),
        norm(row["product"]), norm(row["player"]), norm(row["set_name"]),
        norm(row["card_number"]), norm(row["parallel"] or "Base"),
        norm(row["variation"]), row["serial_run"], int(row["is_auto"] or 0),
        int(row["is_relic"] or 0),
    )


def load_candidates(limit: int, min_age_seconds: int) -> list[dict[str, Any]]:
    db = sqlite3.connect(STATE_DB)
    db.row_factory = sqlite3.Row
    rows = db.execute("""
        SELECT d.*, f.source_id, f.trust_score, f.exact_match,
               f.status AS finding_status, s.enabled, s.import_policy,
               t.sport, t.year, t.season, t.manufacturer, t.product,
               t.scope, t.status AS target_status
        FROM checklist_sentinel_downloads d
        JOIN checklist_sentinel_findings f ON f.finding_id=d.finding_id
        JOIN checklist_sentinel_sources s ON s.source_id=f.source_id
        JOIN checklist_sentinel_targets t ON t.target_key=d.target_key
        WHERE d.status IN (?, ?)
          AND f.exact_match=1 AND f.status='validated_candidate'
          AND s.enabled=1 AND s.import_policy='auto_import'
          AND f.trust_score >= 75
        ORDER BY d.created_at ASC
        LIMIT ?
    """, (*sorted(PENDING_STATUSES), max(limit * 50, 500))).fetchall()
    running = {str(r[0]) for r in db.execute(
        "SELECT current_target_key FROM checklist_sentinel_jobs WHERE status='running' AND current_target_key IS NOT NULL"
    ).fetchall()}
    db.close()
    cutoff = utcnow().timestamp() - min_age_seconds
    eligible: list[dict[str, Any]] = []
    for row in rows:
        created = parse_time(row["created_at"])
        if not created or created.timestamp() > cutoff or row["target_key"] in running:
            continue
        eligible.append(dict(row))
    existing = [row for row in eligible if Path(str(row["local_path"])).is_file()]
    missing = [row for row in eligible if not Path(str(row["local_path"])).is_file()]
    return (existing + missing)[:limit]


def patch_release(plan: dict[str, Any], row: dict[str, Any]) -> None:
    release = plan.get("release") if isinstance(plan, dict) else None
    if not isinstance(release, dict):
        return
    manufacturer = str(row.get("manufacturer") or release.get("manufacturer") or "").strip()
    product = str(row.get("product") or release.get("product") or "").strip()
    sport = str(row.get("sport") or release.get("sport") or "").strip()
    year = str(row.get("year") or release.get("releaseYear") or "").strip()
    season = str(row.get("season") or year or release.get("season") or "").strip()
    manufacturer_display = {
        "upper-deck": "Upper Deck", "panini": "Panini", "topps": "Topps",
        "press-pass": "Press Pass", "bowman": "Bowman", "donruss": "Donruss",
    }.get(manufacturer.lower(), manufacturer)
    sport_display = {
        "baseball": "Baseball", "basketball": "Basketball", "football": "Football",
        "hockey": "Hockey", "golf": "Golf", "wrestling": "Wrestling",
        "soccer": "Soccer", "racing": "Racing",
    }.get(sport.lower(), sport.title())
    release.update({
        "manufacturer": manufacturer_display, "product": product,
        "releaseYear": year, "season": season, "sport": sport_display,
        "releaseSlug": "-".join(filter(None, [slug(year), slug(manufacturer), slug(product), slug(sport)])),
    })


def existing_source_receipt(store: LocalRegistryStore, sha256: str) -> str | None:
    with store.connection() as db:
        row = db.execute(
            "SELECT registry_receipt, import_status FROM checklist_registry_imports WHERE source_sha256=?",
            (sha256,),
        ).fetchone()
    if row and str(row["import_status"] or "").lower() == "imported":
        return str(row["registry_receipt"] or "already-imported")
    return None


def collision_check(store: LocalRegistryStore, release_id: str, entries: list[dict[str, Any]]) -> tuple[bool, str | None]:
    with store.connection() as db:
        for entry in entries:
            existing = db.execute(
                "SELECT * FROM checklist_registry_entries WHERE fingerprint_sha256=? OR identity_id=? LIMIT 1",
                (entry["fingerprint_sha256"], entry["identity_id"]),
            ).fetchone()
            if not existing or existing["release_id"] == release_id:
                continue
            if semantic_key(existing) != semantic_key(entry):
                return False, (
                    f"cross-release identity conflict existing={existing['release_id']} "
                    f"incoming={release_id} fingerprint={entry['fingerprint_sha256']}"
                )
    return True, None


def collision_check(store: LocalRegistryStore, release_id: str, entries: list[dict[str, Any]]) -> tuple[str, str | None]:
    matched = 0
    cross_matched = 0
    releases: set[str] = set()
    with store.connection() as db:
        for entry in entries:
            existing = db.execute(
                "SELECT release_id FROM checklist_registry_entries WHERE fingerprint_sha256=? OR identity_id=? LIMIT 1",
                (entry["fingerprint_sha256"], entry["identity_id"]),
            ).fetchone()
            if not existing:
                continue
            matched += 1
            releases.add(str(existing["release_id"]))
            if str(existing["release_id"]) != release_id:
                cross_matched += 1
    if matched == len(entries) and entries:
        return "already_present", f"fingerprints={matched}/{len(entries)} releases={','.join(sorted(releases))[:400]}"
    if cross_matched:
        return "conflict", f"partial cross-release overlap fingerprints={matched}/{len(entries)} cross={cross_matched} releases={','.join(sorted(releases))[:400]}"
    return "ok", None


def write_registry(store: LocalRegistryStore, row: dict[str, Any], plan: dict[str, Any], entries: list[dict[str, Any]]) -> tuple[str, int]:
    release_id = store._release_id(plan)
    columns = list(entries[0].keys())
    receipt = f"{release_id}:{len(entries)}"
    with store.connection() as db:
        db.execute("DELETE FROM checklist_registry_entries WHERE release_id=?", (release_id,))
        db.execute("DELETE FROM checklist_registry_imports WHERE source_sha256=?", (row["sha256"],))
        db.execute(
            """INSERT INTO checklist_registry_imports
            (source_sha256,source_url,source_name,target_key,source_path,authority,
             content_type,byte_count,registry_receipt,imported_at,plan_json,import_status,import_error)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,'imported',NULL)""",
            (row["sha256"], row["source_url"], Path(row["local_path"]).stem[:120],
             row["target_key"], row["local_path"],
             "official_manufacturer_or_approved_checklist_source",
             row.get("content_type"), int(row.get("byte_count") or 0), receipt,
             iso_now(), json.dumps(plan, sort_keys=True)),
        )
        db.executemany(
            f"INSERT INTO checklist_registry_entries ({','.join(columns)}) VALUES ({','.join(':'+c for c in columns)})",
            entries,
        )
        actual = int(db.execute(
            "SELECT COUNT(*) FROM checklist_registry_entries WHERE release_id=? AND active=1",
            (release_id,),
        ).fetchone()[0])
        if actual != len(entries):
            raise RuntimeError(f"post-write verification expected={len(entries)} actual={actual}")
    return receipt, len(entries)


def finish_download(state: SentinelStore, row: dict[str, Any], status: str, receipt: str, *, recovered: bool = False) -> None:
    state.update_download_status(str(row["download_id"]), status, receipt[:1000])
    if recovered:
        state.mark_target(
            str(row["target_key"]), "recovered", retry_after_seconds=24 * 60 * 60,
            recovered_download_id=str(row["download_id"]),
            metadata={"reason": "local_registry_bridge", "registry_required": False, "receipt": receipt[:700]},
        )


def process_one(store: LocalRegistryStore, state: SentinelStore, row: dict[str, Any], *, dry_run: bool) -> dict[str, Any]:
    path = Path(str(row["local_path"]))
    result: dict[str, Any] = {"download_id": row["download_id"], "target_key": row["target_key"]}
    if not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
        receipt = "bridge rejected: missing or unsupported local checklist file"
        if not dry_run:
            finish_download(state, row, "downloaded_local_registry_rejected", receipt)
        return {**result, "outcome": "rejected", "receipt": receipt}

    prior = existing_source_receipt(store, str(row["sha256"]))
    if prior:
        receipt = f"local_bridge:already_imported:{prior}"
        if not dry_run:
            finish_download(state, row, "imported_registry", receipt, recovered=True)
        return {**result, "outcome": "already_imported", "receipt": receipt}

    try:
        plan = store._parse_plan(path, str(row.get("source_url") or ""))
        patch_release(plan, row)
        validation = plan.get("validation") if isinstance(plan, dict) else None
        if not isinstance(validation, dict) or validation.get("status") != "passed":
            issues = validation.get("issues") if isinstance(validation, dict) else None
            receipt = "bridge validation rejected: " + json.dumps(issues or [], sort_keys=True)[:800]
            if not dry_run:
                finish_download(state, row, "downloaded_local_registry_rejected", receipt)
            return {**result, "outcome": "rejected", "receipt": receipt}
        entries = store._flatten_plan(
            str(row["sha256"]), str(row["source_url"]), path.stem[:120],
            str(row["target_key"]), plan,
        )
        if not entries:
            receipt = "bridge validation rejected: validated plan produced zero identities"
            if not dry_run:
                finish_download(state, row, "downloaded_local_registry_rejected", receipt)
            return {**result, "outcome": "rejected", "receipt": receipt}

        release_id = store._release_id(plan)
        collision, detail = collision_check(store, release_id, entries)
        if collision == "conflict":
            receipt = f"bridge collision rejected: {detail}"
            if not dry_run:
                finish_download(state, row, "downloaded_local_registry_rejected", receipt)
            return {**result, "outcome": "rejected", "receipt": receipt, "entries": len(entries)}
        if collision == "already_present":
            receipt = f"local_bridge:already_present:{detail}:{len(entries)}"
            if not dry_run:
                finish_download(state, row, "imported_registry", receipt, recovered=True)
            return {**result, "outcome": "already_present", "receipt": receipt, "entries": len(entries)}

        if dry_run:
            return {**result, "outcome": "would_import", "release_id": release_id, "entries": len(entries)}

        receipt, count = write_registry(store, row, plan, entries)
        final_receipt = f"local_bridge:{receipt}"
        finish_download(state, row, "imported_registry", final_receipt, recovered=True)
        return {**result, "outcome": "imported", "receipt": final_receipt, "entries": count}
    except Exception as error:
        receipt = f"bridge registry error: {type(error).__name__}: {str(error)[:850]}"
        if not dry_run:
            finish_download(state, row, "downloaded_local_registry_error", receipt)
        return {**result, "outcome": "error", "receipt": receipt}


def write_status(summary: dict[str, Any]) -> None:
    STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RECEIPT_ROOT.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(summary, indent=2, sort_keys=True) + "\n"
    tmp = STATUS_PATH.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(STATUS_PATH)
    stamp = utcnow().strftime("%Y%m%dT%H%M%SZ")
    (RECEIPT_ROOT / f"bridge-{stamp}.json").write_text(payload, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--min-age-seconds", type=int, default=120)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    state = SentinelStore(STATE_DB)
    state.initialize()
    registry = LocalRegistryStore(REGISTRY_DB, SERVICE_ROOT)
    registry.initialize()
    rows = load_candidates(max(1, min(args.limit, 250)), max(30, args.min_age_seconds))
    results = [process_one(registry, state, row, dry_run=args.dry_run) for row in rows]
    counts: dict[str, int] = {}
    for item in results:
        key = str(item.get("outcome") or "unknown")
        counts[key] = counts.get(key, 0) + 1
    summary = {
        "schema": "instacomp.sentinelRegistryBridge.v1",
        "checked_at": iso_now(), "dry_run": bool(args.dry_run),
        "selected": len(rows), "counts": counts, "results": results,
    }
    if not args.dry_run:
        write_status(summary)
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
