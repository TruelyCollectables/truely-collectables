from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import CardIdentity

SCHEMA_VERSION = "tcos.instacomp-ai.external-metadata.v1"
SAFE_LICENSES = {"mit", "cc by 4.0", "cc-by-4.0", "cc0", "cc0-1.0"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _text(value: object) -> str:
    return " ".join(str(value or "").strip().split())


def _norm(value: object) -> str:
    return _text(value).casefold()


def _card_no(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", _norm(value))


def _fingerprint(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def initialize_external_metadata(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database_path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS external_metadata_sources (
                source_key TEXT PRIMARY KEY,
                source_name TEXT NOT NULL,
                source_url TEXT NOT NULL,
                license_name TEXT NOT NULL,
                attribution TEXT NOT NULL,
                data_date TEXT,
                record_count INTEGER NOT NULL DEFAULT 0,
                content_sha256 TEXT,
                last_imported_at TEXT,
                last_error TEXT,
                active INTEGER NOT NULL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS external_metadata_records (
                source_key TEXT NOT NULL,
                source_record_id TEXT NOT NULL,
                record_fingerprint TEXT NOT NULL,
                player TEXT,
                team TEXT,
                year TEXT,
                manufacturer TEXT,
                set_name TEXT,
                card_number TEXT,
                normalized_card_number TEXT,
                attributes_json TEXT NOT NULL,
                provenance_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(source_key, source_record_id),
                FOREIGN KEY(source_key) REFERENCES external_metadata_sources(source_key)
            );
            CREATE INDEX IF NOT EXISTS external_metadata_lookup_idx
                ON external_metadata_records(normalized_card_number, year, player, manufacturer);
            CREATE INDEX IF NOT EXISTS external_metadata_player_idx
                ON external_metadata_records(player, year);
            """
        )


def _download_json(url: str, max_bytes: int = 20 * 1024 * 1024) -> tuple[bytes, Any]:
    if not url.startswith("https://"):
        raise ValueError("External metadata source must use HTTPS")
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "InstaComp-AI-Metadata/1.0", "Accept": "application/json,text/plain,*/*"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        content = response.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise ValueError("External metadata payload exceeded safety limit")
    return content, json.loads(content)


def _license_gate(source: dict[str, Any]) -> None:
    license_name = _norm(source.get("license"))
    if source.get("license_reviewed") is not True:
        raise ValueError("Metadata source license has not been reviewed")
    if source.get("commercial_use_allowed") is not True:
        raise ValueError("Metadata source is not approved for commercial use")
    if license_name not in SAFE_LICENSES:
        raise ValueError(f"Metadata source license is not allowlisted: {source.get('license')}")


def _serial_run(attributes: list[str]) -> int | None:
    for raw in attributes:
        match = re.search(r"(?:serial\s+numbered\s+)?/(\d+)\b", _norm(raw))
        if match:
            return int(match.group(1))
    return None


def _normalize_gotthatdata(payload: Any, source: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("cards"), list):
        raise ValueError("GotThatData metadata payload is missing cards[]")
    rows: list[dict[str, Any]] = []
    for raw in payload["cards"]:
        if not isinstance(raw, dict):
            continue
        record_id = _text(raw.get("id"))
        if not record_id:
            continue
        attributes = [_text(value) for value in raw.get("attributes", []) if _text(value)]
        # Deliberately discard frontImage/backImage, OCR blobs, aiInsight and market fields.
        rows.append(
            {
                "source_record_id": record_id,
                "player": _text(raw.get("playerName")) or None,
                "team": _text(raw.get("team")) or None,
                "year": _text(raw.get("year")) or None,
                "manufacturer": _text(raw.get("manufacturer")) or None,
                "set_name": _text(raw.get("set")) or None,
                "card_number": _text(raw.get("cardNumber")) or None,
                "attributes": attributes,
                "serial_run_advisory": _serial_run(attributes),
            }
        )
    return _text(payload.get("exportDate")) or None, rows


def _normalize_ap_grading(payload: Any, source: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    # AP publishes aggregate cards.json under CC BY 4.0. The export is compact and may
    # be either object rows or positional rows; object rows are accepted directly.
    rows_raw = payload.get("cards") if isinstance(payload, dict) else payload
    if not isinstance(rows_raw, list):
        raise ValueError("AP Grading metadata payload is not a card array")
    rows: list[dict[str, Any]] = []
    for raw in rows_raw:
        if not isinstance(raw, dict):
            continue
        record_id = _text(raw.get("slug") or raw.get("id") or raw.get("url"))
        if not record_id:
            continue
        rows.append(
            {
                "source_record_id": record_id,
                "player": _text(raw.get("name") or raw.get("card_name") or raw.get("player")) or None,
                "team": None,
                "year": _text(raw.get("year")) or None,
                "manufacturer": _text(raw.get("manufacturer")) or None,
                "set_name": _text(raw.get("set") or raw.get("set_name")) or None,
                "card_number": _text(raw.get("number") or raw.get("card_number")) or None,
                "attributes": [],
                "serial_run_advisory": None,
            }
        )
    data_date = _text(payload.get("as_of") or payload.get("data_date")) if isinstance(payload, dict) else None
    return data_date or None, rows


ADAPTERS = {
    "gotthatdata_sports_cards_v1": _normalize_gotthatdata,
    "ap_grading_cards_v1": _normalize_ap_grading,
}


def import_metadata_source(database_path: Path, source: dict[str, Any]) -> dict[str, Any]:
    initialize_external_metadata(database_path)
    _license_gate(source)
    source_key = _text(source.get("key"))
    source_name = _text(source.get("name"))
    source_url = _text(source.get("url"))
    adapter_name = _text(source.get("adapter"))
    attribution = _text(source.get("attribution"))
    if not all((source_key, source_name, source_url, adapter_name, attribution)):
        raise ValueError("Metadata source requires key, name, url, adapter, and attribution")
    adapter = ADAPTERS.get(adapter_name)
    if adapter is None:
        raise ValueError(f"Unknown external metadata adapter: {adapter_name}")
    content, payload = _download_json(source_url)
    data_date, rows = adapter(payload, source)
    content_sha = hashlib.sha256(content).hexdigest()
    now = _now()
    with sqlite3.connect(database_path) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute(
            """INSERT INTO external_metadata_sources
               (source_key,source_name,source_url,license_name,attribution,data_date,record_count,content_sha256,last_imported_at,last_error,active)
               VALUES (?,?,?,?,?,?,?,?,?,NULL,1)
               ON CONFLICT(source_key) DO UPDATE SET
                 source_name=excluded.source_name,source_url=excluded.source_url,license_name=excluded.license_name,
                 attribution=excluded.attribution,data_date=excluded.data_date,record_count=excluded.record_count,
                 content_sha256=excluded.content_sha256,last_imported_at=excluded.last_imported_at,last_error=NULL,active=1""",
            (source_key, source_name, source_url, _text(source.get("license")), attribution, data_date, len(rows), content_sha, now),
        )
        for row in rows:
            canonical = {key: row.get(key) for key in ("player", "team", "year", "manufacturer", "set_name", "card_number", "attributes", "serial_run_advisory")}
            provenance = {
                "source_key": source_key,
                "source_name": source_name,
                "source_url": source_url,
                "license": _text(source.get("license")),
                "attribution": attribution,
                "data_date": data_date,
                "metadata_only": True,
                "images_imported": False,
                "trusted_identity_authority": False,
                "serial_run_is_advisory_only": True,
            }
            db.execute(
                """INSERT INTO external_metadata_records
                   (source_key,source_record_id,record_fingerprint,player,team,year,manufacturer,set_name,card_number,normalized_card_number,attributes_json,provenance_json,updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(source_key,source_record_id) DO UPDATE SET
                     record_fingerprint=excluded.record_fingerprint,player=excluded.player,team=excluded.team,year=excluded.year,
                     manufacturer=excluded.manufacturer,set_name=excluded.set_name,card_number=excluded.card_number,
                     normalized_card_number=excluded.normalized_card_number,attributes_json=excluded.attributes_json,
                     provenance_json=excluded.provenance_json,updated_at=excluded.updated_at""",
                (source_key, row["source_record_id"], _fingerprint(canonical), row.get("player"), row.get("team"), row.get("year"), row.get("manufacturer"), row.get("set_name"), row.get("card_number"), _card_no(row.get("card_number")), json.dumps({"attributes": row.get("attributes", []), "serial_run_advisory": row.get("serial_run_advisory")}), json.dumps(provenance), now),
            )
    return {"schema_version": SCHEMA_VERSION, "source_key": source_key, "records": len(rows), "data_date": data_date, "content_sha256": content_sha, "metadata_only": True, "images_imported": False, "trusted_lessons_created": 0}


def search_metadata(database_path: Path, identity: CardIdentity, limit: int = 25) -> list[dict[str, Any]]:
    initialize_external_metadata(database_path)
    card = _card_no(identity.card_number)
    player = _norm(identity.player)
    year = _norm(identity.year)
    if not card or not player or not year:
        return []
    with sqlite3.connect(database_path) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """SELECT r.*,s.source_name,s.license_name,s.attribution,s.data_date
               FROM external_metadata_records r JOIN external_metadata_sources s USING(source_key)
               WHERE r.normalized_card_number=? AND lower(r.player)=? AND lower(r.year)=? AND s.active=1
               LIMIT ?""",
            (card, player, year, max(1, min(int(limit), 100))),
        ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        manufacturer = _norm(row["manufacturer"])
        set_name = _norm(row["set_name"])
        if identity.manufacturer and manufacturer and _norm(identity.manufacturer) != manufacturer:
            continue
        if identity.set_name and set_name and _norm(identity.set_name) not in set_name and set_name not in _norm(identity.set_name):
            continue
        result.append(dict(row))
    return result


def apply_unique_metadata_hint(database_path: Path, identity: CardIdentity) -> tuple[CardIdentity, list[str]]:
    matches = search_metadata(database_path, identity)
    keys = {(row.get("manufacturer"), row.get("set_name"), row.get("team")) for row in matches}
    if len(matches) != 1 or len(keys) != 1:
        return identity, []
    row = matches[0]
    updates: dict[str, Any] = {}
    if not identity.manufacturer and row.get("manufacturer"):
        updates["manufacturer"] = row["manufacturer"]
    if not identity.set_name and row.get("set_name"):
        updates["set_name"] = row["set_name"]
    if not identity.team and row.get("team") and _norm(row.get("team")) not in {"n/a", "not available", "unknown"}:
        updates["team"] = row["team"]
    if not updates:
        return identity, []
    # Hard boundary: no parallel, serial, auto/relic, rookie, variation or pricing fields are ever copied.
    receipt = f"external_metadata_advisory:{row['source_key']}:{row['source_record_id']}"
    return identity.model_copy(update=updates), [receipt]


def metadata_status(database_path: Path) -> dict[str, Any]:
    initialize_external_metadata(database_path)
    with sqlite3.connect(database_path) as db:
        source_count = int(db.execute("SELECT COUNT(*) FROM external_metadata_sources WHERE active=1").fetchone()[0])
        record_count = int(db.execute("SELECT COUNT(*) FROM external_metadata_records").fetchone()[0])
    return {"schema_version": SCHEMA_VERSION, "active_sources": source_count, "records": record_count, "images_imported": False, "trusted_identity_authority": False, "trusted_lessons_created": 0}
