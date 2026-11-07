from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from typing import Any

from .models import CardIdentity, ChecklistOutcome, ChecklistResult


def _text(value: Any) -> str | None:
    clean = " ".join(str(value or "").split()).strip()
    return clean or None


def _norm(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _card_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _parallel_key(value: Any) -> str:
    normalized = _norm(value)
    return "base" if normalized in {"", "base", "base set"} else normalized


def local_registry_path() -> Path:
    configured = os.getenv("INSTACOMP_AI_CHECKLIST_REGISTRY_DB", "").strip()
    if configured:
        return Path(configured).expanduser()
    return Path(__file__).resolve().parent.parent / "data" / "database" / "checklist_registry.sqlite3"


def _serial_run(identity: CardIdentity) -> int | None:
    if identity.serial_run:
        return int(identity.serial_run)
    match = re.search(r"/\s*(\d{1,6})\b", identity.serial_number or "")
    return int(match.group(1)) if match else None


def _row_identity(row: sqlite3.Row, identity: CardIdentity) -> CardIdentity:
    locked_run = int(row["serial_run"]) if row["serial_run"] else None
    return CardIdentity(
        sport=_text(row["sport"]) or identity.sport,
        league=_text(row["league"]) or identity.league,
        year=_text(row["year"]) or identity.year,
        manufacturer=_text(row["manufacturer"]) or identity.manufacturer,
        brand=_text(row["brand"]) or identity.brand,
        set_name=_text(row["set_name"]) or identity.set_name,
        subset=_text(row["set_name"]) or identity.subset,
        player=_text(row["player"]) or identity.player,
        team=_text(row["team"]) or identity.team,
        card_number=_text(row["card_number"]) or identity.card_number,
        parallel=_text(row["parallel"]) or identity.parallel,
        variation=_text(row["variation"]) or identity.variation,
        serial_number=identity.serial_number if locked_run is not None else None,
        serial_run=locked_run,
        rookie=identity.rookie,
        autograph=bool(row["is_auto"]),
        inscription=identity.inscription,
        inscription_text=identity.inscription_text,
        memorabilia=bool(row["is_relic"]),
        memorabilia_type=identity.memorabilia_type,
    )


def resolve_local_registry_exact(
    identity: CardIdentity,
    *,
    database_path: Path | None = None,
) -> tuple[ChecklistResult | None, dict[str, Any]]:
    path = database_path or local_registry_path()
    diagnostics: dict[str, Any] = {
        "configured": path.exists(),
        "path": str(path),
        "card_number": identity.card_number,
        "candidate_count": 0,
        "filtered_candidate_count": 0,
        "status": "not_configured" if not path.exists() else "not_attempted",
        "candidate_identity_ids": [],
    }
    if not path.exists() or not identity.card_number:
        return None, diagnostics

    card_key = _card_key(identity.card_number)
    if not card_key:
        diagnostics["status"] = "input_incomplete"
        return None, diagnostics

    db: sqlite3.Connection | None = None
    try:
        db = sqlite3.connect(path, timeout=5)
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """
            SELECT *
            FROM checklist_registry_entries
            WHERE active=1 AND normalized_card_number=?
            ORDER BY score DESC, identity_id ASC
            """,
            (card_key,),
        ).fetchall()
    except sqlite3.Error as error:
        diagnostics["status"] = "error"
        diagnostics["error"] = str(error)[:300]
        return None, diagnostics
    finally:
        if db is not None:
            db.close()

    diagnostics["candidate_count"] = len(rows)
    target_player = _norm(identity.player)
    target_year = _norm(identity.year)
    target_manufacturer = _norm(identity.manufacturer)
    target_brand = _norm(identity.brand)
    target_set = _norm(identity.subset or identity.set_name)
    target_parallel = _parallel_key(identity.parallel) if identity.parallel is not None else None
    target_run = _serial_run(identity)

    accepted: list[sqlite3.Row] = []
    rejected: list[dict[str, Any]] = []
    for row in rows:
        reasons: list[str] = []
        if target_player and _norm(row["player"]) != target_player:
            reasons.append("player_mismatch")
        if target_year and _norm(row["year"]) != target_year:
            reasons.append("year_mismatch")
        if target_manufacturer and _norm(row["manufacturer"]) not in {"", target_manufacturer}:
            reasons.append("manufacturer_mismatch")
        if target_brand and _norm(row["brand"]) not in {"", target_brand}:
            reasons.append("brand_mismatch")

        row_product = _norm(row["product"])
        row_set = _norm(row["set_name"])
        if target_set and target_set not in {row_product, _norm(identity.brand)} and row_set != target_set:
            reasons.append("set_or_insert_mismatch")

        if target_parallel is not None and _parallel_key(row["parallel"]) != target_parallel:
            reasons.append("parallel_mismatch")

        row_run = int(row["serial_run"]) if row["serial_run"] else None
        if target_run is not None:
            if row_run != target_run:
                reasons.append("serial_run_mismatch")
        elif row_run is not None:
            reasons.append("unexpected_serial_run")

        if identity.autograph is not None and bool(row["is_auto"]) != bool(identity.autograph):
            reasons.append("autograph_state_mismatch")
        if identity.memorabilia is not None and bool(row["is_relic"]) != bool(identity.memorabilia):
            reasons.append("relic_state_mismatch")

        if reasons:
            rejected.append({"identity_id": row["identity_id"], "reasons": reasons})
        else:
            accepted.append(row)

    diagnostics["filtered_candidate_count"] = len(accepted)
    diagnostics["candidate_identity_ids"] = [row["identity_id"] for row in accepted[:20]]
    diagnostics["rejected"] = rejected[:50]

    if len(accepted) != 1:
        diagnostics["status"] = "ambiguous" if accepted else "no_exact_match"
        return None, diagnostics

    row = accepted[0]
    diagnostics["status"] = "exact_match"
    diagnostics["identity_id"] = row["identity_id"]
    diagnostics["fingerprint_sha256"] = row["fingerprint_sha256"]
    diagnostics["source_label"] = row["source_label"]
    result = ChecklistResult(
        outcome=ChecklistOutcome.EXACT_MATCH,
        identity_id=str(row["identity_id"]),
        identity=_row_identity(row, identity),
        candidate_count=1,
        reasons=[
            "mac_local_registry_unique_exact_card_number",
            "mac_local_registry_physical_identity_compatible",
        ],
        source_receipts=[
            f"registry_identity:{row['identity_id']}",
            f"registry_fingerprint:{row['fingerprint_sha256']}",
            "registry_resolver:mac_local_sqlite",
        ],
    )
    return result, diagnostics
