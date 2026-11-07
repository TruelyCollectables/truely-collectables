from __future__ import annotations

import json
import os
import re
import sqlite3
import tempfile
import time
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PUBLISHER_NAMES = {"panini", "topps", "upper deck", "leaf", "bowman"}
SUPPORTED_SPORTS = {
    "baseball", "basketball", "football", "hockey", "soccer",
    "golf", "wrestling", "racing", "mma", "boxing", "tennis",
}


def _norm(value: object) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _card(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _year(value: object) -> str:
    match = re.search(r"(?:19|20)\d{2}", str(value or ""))
    return match.group(0) if match else ""


def _season(identity: dict[str, object], year: str) -> str:
    # Prefer the hobby season printed in the operator-confirmed set name.
    # identity.year is intentionally normalized to its start year elsewhere.
    for value in (identity.get("set_name"), identity.get("year")):
        match = re.search(r"((?:19|20)\d{2}(?:-\d{2})?)", str(value or ""))
        if match:
            return match.group(1)
    return year


def _sport(value: object) -> str:
    text = _norm(value)
    aliases = {
        "nba": "basketball", "wnba": "basketball", "basketball": "basketball",
        "nhl": "hockey", "hockey": "hockey", "mlb": "baseball", "baseball": "baseball",
        "nfl": "football", "football": "football", "soccer": "soccer", "golf": "golf",
        "wrestling": "wrestling", "wwe": "wrestling", "aew": "wrestling",
        "racing": "racing", "racing nascar": "racing", "nascar": "racing",
        "mma ufc": "mma", "mma": "mma", "ufc": "mma", "boxing": "boxing", "tennis": "tennis",
    }
    return aliases.get(text, text)


def _clean_set_name(identity: dict[str, Any]) -> str:
    set_name = " ".join(str(identity.get("set_name") or "").split())
    brand = " ".join(str(identity.get("brand") or "").split())
    raw = set_name or (brand if _norm(brand) not in PUBLISHER_NAMES else "")
    if not raw:
        return ""
    # Inventory truth may store a finish/parallel after a spaced dash. Sentinel
    # needs the parent release checklist, never one crawler target per parallel.
    raw = re.split(r"\s+-\s+", raw, maxsplit=1)[0].strip()
    raw = re.sub(r"^\s*(?:19|20)\d{2}(?:-\d{2})?\s+", "", raw, flags=re.I)
    publisher_brand = _norm(brand) if _norm(brand) in PUBLISHER_NAMES else ""
    raw = re.sub(r"^\s*(?:Panini|Topps|Upper Deck|Leaf)\s+", "", raw, flags=re.I)
    raw = " ".join(raw.split()).strip()
    if publisher_brand and not raw:
        return {"upper deck": "Upper Deck"}.get(publisher_brand, publisher_brand.title())
    # A small set of undashed names are known flagship insert families rather
    # than standalone products. Collapse only those; do not collapse legitimate
    # publisher products such as Panini FIFA World Cup Stickers or SP Authentic.
    flagship_insert = {
        "topps": ("national league all stars", "american league all stars", "stars of mlb", "factory set bonus"),
        "leaf": ("phenoms",),
    }
    raw_norm = _norm(raw)
    if publisher_brand and any(raw_norm.startswith(value) for value in flagship_insert.get(publisher_brand, ())):
        return {"upper deck": "Upper Deck"}.get(publisher_brand, publisher_brand.title())
    return raw


def _infer_manufacturer(identity: dict[str, Any], product: str) -> str:
    explicit = " ".join(str(identity.get("manufacturer") or "").split())
    if explicit:
        return explicit
    brand = _norm(identity.get("brand")); text = _norm(f"{identity.get('set_name') or ''} {product}")
    year_text = _year(identity.get("year") or identity.get("set_name"))
    year_num = int(year_text) if year_text.isdigit() else 0
    if brand in {"panini", "topps", "upper deck", "leaf"}:
        return {"upper deck": "Upper Deck"}.get(brand, brand.title())
    # Deterministic licensed-product ownership by era. These rules exist only
    # where the product/company relationship is stable enough for automatic
    # checklist recovery; ambiguous historical brands stay unresolved.
    if year_num >= 2009 and re.search(r"\bhoops\b", text): return "Panini"
    if year_num >= 2010 and re.search(r"\bscore\b", text): return "Panini"
    if year_num >= 2010 and re.search(r"\bpinnacle\b", text): return "Panini"
    if year_num >= 2000 and re.search(r"\bparkhurst(?: champions)?\b|\bcollector s choice\b|\bskybox metal universe\b", text): return "Upper Deck"
    if year_num >= 2020 and re.search(r"\bflair\b", text): return "Upper Deck"
    if re.search(r"\bfleer\b", text): return "Fleer"
    if re.search(r"\bultra\b", text): return "Upper Deck" if year_num >= 2005 else "Fleer"
    if brand == "bowman" or re.search(r"\bbowman\b", text): return "Topps"
    if re.search(r"\btopps\b|\bfinest\b|\bstadium club\b|\ballen ginter\b|\bgypsy queen\b", text): return "Topps"
    if re.search(r"\bpanini\b|\bprizm\b|\bselect\b|\bdonruss\b|\boptic\b|\bmosaic\b|\borigins\b|\bimmaculate\b|\bchronicles\b", text): return "Panini"
    if re.search(r"\bupper deck\b|\bsp\b|\bsp authentic\b|\bsp game used\b|\bspx\b|\bo pee chee\b|\ballure\b|\bartifacts\b|\bblack diamond\b|\bcredentials\b|\bsynergy\b", text): return "Upper Deck"
    if brand == "tristar" or re.search(r"\btristar\b", text): return "TriStar"
    if brand == "leaf" or re.search(r"\bleaf\b", text): return "Leaf"
    return ""


def _family_tokens(value: object) -> set[str]:
    ignored = {
        "panini", "topps", "upper", "deck", "leaf", "cards", "card", "trading",
        "baseball", "basketball", "football", "hockey", "soccer", "golf", "wrestling",
        "wwe", "aew", "nba", "wnba", "nfl", "nhl", "mlb", "set", "collection",
    }
    return {token for token in _norm(value).split() if token not in ignored}


def _family_match(product: str, row: sqlite3.Row) -> bool:
    product_norm = _norm(product)
    if product_norm in PUBLISHER_NAMES:
        return any(_norm(row[field]) == product_norm for field in ("product", "brand"))
    want = _family_tokens(product)
    if not want:
        return False
    values = [row["product"], row["set_name"], row["brand"]]
    for value in values:
        have = _family_tokens(value)
        if not have:
            continue
        if want == have or want.issubset(have) or have.issubset(want):
            return True
        if len(want & have) / max(1, len(want)) >= 0.75:
            return True
    return False


def _manufacturer_family(value: object) -> str:
    text = _norm(value)
    if text == "bowman": return "topps"
    if text in {"upper deck", "panini", "topps", "leaf"}: return text
    return text


def _covered(identity: dict[str, Any], product: str, manufacturer: str, candidates: list[sqlite3.Row]) -> bool:
    wanted_sport = _sport(identity.get("sport"))
    wanted_manufacturer = _manufacturer_family(manufacturer)
    for row in candidates:
        row_sport = _sport(row["sport"])
        if wanted_sport and row_sport and row_sport != wanted_sport:
            continue
        row_manufacturer = _manufacturer_family(row["manufacturer"])
        if wanted_manufacturer and row_manufacturer and row_manufacturer != wanted_manufacturer:
            # Product-family evidence can legitimately bridge Bowman -> Topps.
            if not (wanted_manufacturer == "topps" and _norm(row["brand"]) == "bowman"):
                continue
        if product:
            if not _family_match(product, row):
                continue
        return True
    return False


def _slug(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "-", _norm(value)).strip("-")


def _inventory_path() -> Path:
    configured = os.getenv("INSTACOMP_AI_INVENTORY_TRUTH_DB_PATH", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path("/Volumes/InstaCompAI/instacomp-ai-data/instacomp_ai.sqlite3")


def build_inventory_checklist_targets(registry_path: Path) -> dict[str, Any]:
    inventory_path = _inventory_path()
    generated_at = datetime.now(timezone.utc).isoformat()
    if not inventory_path.is_file():
        return {"ok": False, "reason": "inventory_truth_db_unavailable", "generated_at": generated_at, "targets": []}
    if not registry_path.is_file():
        return {"ok": False, "reason": "registry_db_unavailable", "generated_at": generated_at, "targets": []}

    inventory_db = sqlite3.connect(f"file:{inventory_path}?mode=ro", uri=True, timeout=30)
    raw_rows = inventory_db.execute(
        "SELECT training_example_id, example_json FROM training_examples "
        "WHERE json_extract(example_json,'$.verification_source')='inventory_operator_truth'"
    ).fetchall()
    inventory_db.close()

    items: list[dict[str, Any]] = []
    for training_id, raw in raw_rows:
        try:
            identity = (json.loads(raw).get("confirmed_identity") or {})
        except (json.JSONDecodeError, AttributeError):
            continue
        year = _year(identity.get("year")); card = _card(identity.get("card_number")); player = _norm(identity.get("player"))
        if not (year and card and player):
            continue
        product = _clean_set_name(identity)
        manufacturer = _infer_manufacturer(identity, product)
        player_raw = " ".join(str(identity.get("player") or "").split())
        items.append({"id": str(training_id), "identity": identity, "year": year, "season": _season(identity, year), "card": card, "player": player, "player_raw": player_raw, "product": product, "manufacturer": manufacturer})

    registry_db = sqlite3.connect(f"file:{registry_path}?mode=ro", uri=True, timeout=60)
    registry_db.row_factory = sqlite3.Row
    index_names = {row[0] for row in registry_db.execute(
        "SELECT name FROM sqlite_master WHERE type='index'"
    )}
    player_hint = " INDEXED BY checklist_registry_player_idx" if "checklist_registry_player_idx" in index_names else ""
    card_hint = " INDEXED BY checklist_registry_active_card_year_idx" if "checklist_registry_active_card_year_idx" in index_names else ""
    columns = "player, sport, manufacturer, brand, product, set_name, release_id"
    candidate_map: dict[int, list[sqlite3.Row]] = {}
    exact_cache: dict[tuple[str, str, str], list[sqlite3.Row]] = {}
    fallback_cache: dict[tuple[str, str], list[sqlite3.Row]] = {}
    for index, item in enumerate(items):
        exact_key = (item["player_raw"], item["year"], item["card"])
        rows = exact_cache.get(exact_key)
        if rows is None:
            rows = list(registry_db.execute(
                f"SELECT {columns} FROM checklist_registry_entries{player_hint} "
                "WHERE player=? AND active=1 AND year=? AND normalized_card_number=?",
                exact_key,
            ))
            rows = [row for row in rows if _norm(row["player"]) == item["player"]]
            if not rows:
                fallback_key = (item["year"], item["card"])
                fallback_rows = fallback_cache.get(fallback_key)
                if fallback_rows is None:
                    fallback_rows = list(registry_db.execute(
                        f"SELECT {columns} FROM checklist_registry_entries{card_hint} "
                        "WHERE active=1 AND normalized_card_number=? AND year=?",
                        (item["card"], item["year"]),
                    ))
                    fallback_cache[fallback_key] = fallback_rows
                rows = [row for row in fallback_rows if _norm(row["player"]) == item["player"]]
            exact_cache[exact_key] = rows
        candidate_map[index] = rows
    registry_db.close()

    gaps: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    unresolved: list[dict[str, Any]] = []
    covered = 0
    for index, item in enumerate(items):
        identity = item["identity"]
        if _covered(identity, item["product"], item["manufacturer"], candidate_map.get(index, [])):
            covered += 1
            continue
        sport = _sport(identity.get("sport"))
        product = item["product"]
        flagship_product = _norm(product) in PUBLISHER_NAMES and bool(item["manufacturer"])
        weak_product = not _family_tokens(product) and not flagship_product
        missing_manufacturer = not bool(item["manufacturer"])
        if sport not in SUPPORTED_SPORTS or weak_product or missing_manufacturer:
            reason = (
                "manufacturer_insufficient_for_safe_auto_recovery"
                if missing_manufacturer
                else "release_identity_insufficient_for_safe_auto_recovery"
            )
            unresolved.append({
                "training_example_id": item["id"], "sport": identity.get("sport"),
                "year": identity.get("year"), "brand": identity.get("brand"),
                "set_name": identity.get("set_name"), "player": identity.get("player"),
                "card_number": identity.get("card_number"), "reason": reason,
            })
            continue
        season = str(item.get("season") or item["year"])
        key = (sport, season, item["manufacturer"], product)
        gaps[key].append({
            "training_example_id": item["id"], "player": identity.get("player"),
            "card_number": identity.get("card_number"), "brand": identity.get("brand"),
            "set_name": identity.get("set_name"),
        })

    targets: list[dict[str, Any]] = []
    for (sport, season, manufacturer, product), examples in gaps.items():
        year = int(_year(season)) if _year(season) else None
        target_key = "inventory-gap-v2|" + "|".join([
            _slug(sport), _slug(season or year or "unknown"),
            _slug(manufacturer or "unknown"), _slug(product),
        ])
        targets.append({
            "target_key": target_key, "sport": sport, "year": year, "season": season,
            "manufacturer": manufacturer or None, "product": product, "scope": "inventory-gap",
            "priority": 1, "metadata": {
                "source": "live-inventory-registry-gap", "force_refresh": True,
                "inventory_gap_cards": len(examples), "generated_at": generated_at,
                "inventory_examples": examples[:5], "target_schema": 2,
            },
        })
    targets.sort(key=lambda target: (-int(target["metadata"]["inventory_gap_cards"]), -(target.get("year") or 0), target["target_key"]))
    return {
        "ok": True, "generated_at": generated_at, "inventory_truth_cards": len(raw_rows),
        "audit_eligible_cards": len(items), "covered_cards": covered,
        "missing_cards": len(items) - covered, "crawlable_missing_cards": sum(int(t["metadata"]["inventory_gap_cards"]) for t in targets),
        "unresolved_identity_cards": len(unresolved), "target_count": len(targets),
        "targets": targets, "unresolved": unresolved,
    }


def write_inventory_target_snapshot(registry_path: Path, target_path: Path, report_path: Path) -> dict[str, Any]:
    started = time.monotonic()
    payload = build_inventory_checklist_targets(registry_path)
    payload["completed_at"] = datetime.now(timezone.utc).isoformat()
    payload["build_seconds"] = round(time.monotonic() - started, 3)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if payload.get("ok"):
        target_payload = {
            "generated_at": payload["generated_at"],
            "completed_at": payload["completed_at"],
            "build_seconds": payload["build_seconds"],
            "targets": payload["targets"],
        }
        for path, body in ((target_path, target_payload), (report_path, payload)):
            fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(body, handle, indent=2, sort_keys=True); handle.write("\n")
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
    return payload
