from __future__ import annotations

import re
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any
import json


RECEIVING_CUTOVER_DATE = "2026-09-16"
FINAL_ACQUISITION_STATUSES = {"received", "linked_existing", "sold", "refunded"}


def _norm(value: Any) -> str:
    text = str(value or "").casefold().strip()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _norm_parallel(value: Any) -> str:
    raw = str(value or "").casefold().strip()
    # Serial print runs are identity evidence, not part of a parallel's name.
    raw = re.sub(r"\b\d+\s*/\s*\d+\b", " ", raw)
    raw = re.sub(r"/\s*\d+\b", " ", raw)
    text = _norm(raw)
    text = re.sub(r"\b(prizms?|parallel|set|base set)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _serial_family(value: Any) -> str:
    match = re.search(r"/(\d{1,6})\b", str(value or ""))
    return f"/{match.group(1)}" if match else ""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class AcquisitionPriceMatch:
    benchmark_cost: float
    delivered_cost: float
    delta_percent: float
    match_count: int
    purchase_ids: tuple[str, ...]


class KingmakerAccounting:
    """Mac-local acquisition/sale ledger and Deal Hunter price benchmark source."""

    def __init__(self, path: Path, scan_database_path: Path | None = None):
        self.path = path
        self.scan_database_path = scan_database_path

    @contextmanager
    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=30000")
        db.execute("PRAGMA journal_mode=WAL")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS acquisition_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    purchase_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    purchased_at TEXT,
                    title TEXT,
                    card_uuid TEXT,
                    player TEXT NOT NULL,
                    year TEXT,
                    brand TEXT,
                    set_name TEXT,
                    card_number TEXT NOT NULL,
                    parallel TEXT,
                    serial_family TEXT,
                    grading_company TEXT,
                    is_auto INTEGER,
                    is_relic INTEGER,
                    allocated_cost REAL NOT NULL,
                    cost_status TEXT NOT NULL DEFAULT 'known',
                    status TEXT NOT NULL DEFAULT 'owned',
                    evidence TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE(purchase_id, card_uuid, player, card_number, parallel, allocated_cost)
                );
                CREATE INDEX IF NOT EXISTS acquisition_identity_idx
                    ON acquisition_items(player, card_number, year);

                CREATE TABLE IF NOT EXISTS realized_sales (
                    sale_id TEXT PRIMARY KEY,
                    card_uuid TEXT,
                    channel TEXT NOT NULL,
                    sold_at TEXT NOT NULL,
                    gross_sale REAL NOT NULL,
                    selling_fees REAL NOT NULL DEFAULT 0,
                    outbound_shipping REAL NOT NULL DEFAULT 0,
                    adjustments REAL NOT NULL DEFAULT 0,
                    net_proceeds REAL NOT NULL,
                    acquisition_cost REAL,
                    net_profit REAL,
                    roi_percent REAL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS acquisition_price_alerts (
                    candidate_key TEXT PRIMARY KEY,
                    listing_url TEXT,
                    observed_at TEXT NOT NULL,
                    benchmark_cost REAL NOT NULL,
                    delivered_cost REAL NOT NULL,
                    delta_percent REAL NOT NULL,
                    match_count INTEGER NOT NULL,
                    purchase_ids TEXT NOT NULL,
                    delivery_status TEXT
                );
                CREATE TABLE IF NOT EXISTS inventory_receipts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    card_uuid TEXT NOT NULL UNIQUE,
                    inventory_item_id TEXT,
                    acquisition_item_id INTEGER NOT NULL UNIQUE,
                    status TEXT NOT NULL DEFAULT 'pending_purchase',
                    match_confidence REAL NOT NULL,
                    match_reason TEXT,
                    matched_at TEXT NOT NULL,
                    received_at TEXT,
                    snapshot_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(acquisition_item_id) REFERENCES acquisition_items(id)
                );
                CREATE INDEX IF NOT EXISTS inventory_receipts_inventory_idx
                    ON inventory_receipts(inventory_item_id);

                CREATE TABLE IF NOT EXISTS physical_inventory_receipts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    inventory_item_id TEXT NOT NULL UNIQUE,
                    scan_id TEXT NOT NULL UNIQUE,
                    card_uuid TEXT,
                    acquisition_item_id INTEGER NOT NULL UNIQUE,
                    status TEXT NOT NULL DEFAULT 'pending_purchase',
                    disposition TEXT,
                    inventory_state TEXT NOT NULL DEFAULT 'pending_purchase',
                    match_confidence REAL NOT NULL,
                    match_reason TEXT,
                    matched_at TEXT NOT NULL,
                    scan_verified_at TEXT NOT NULL,
                    scan_snapshot_json TEXT NOT NULL DEFAULT '{}',
                    received_at TEXT,
                    snapshot_json TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY(acquisition_item_id) REFERENCES acquisition_items(id)
                );
                CREATE INDEX IF NOT EXISTS physical_inventory_receipts_card_idx
                    ON physical_inventory_receipts(card_uuid);
                CREATE INDEX IF NOT EXISTS physical_inventory_receipts_state_idx
                    ON physical_inventory_receipts(inventory_state);

                CREATE TABLE IF NOT EXISTS raw_card_condition_receipts (
                    inventory_item_id TEXT PRIMARY KEY,
                    scan_id TEXT NOT NULL UNIQUE,
                    card_uuid TEXT,
                    image_pair_sha256 TEXT NOT NULL,
                    card_condition TEXT NOT NULL,
                    reviewed_by TEXT NOT NULL,
                    review_source TEXT NOT NULL,
                    reviewed_at TEXT NOT NULL,
                    notes TEXT,
                    active INTEGER NOT NULL DEFAULT 1,
                    receipt_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE INDEX IF NOT EXISTS raw_card_condition_active_idx
                    ON raw_card_condition_receipts(active, card_condition);
                """
            )
            # Old pending reservations used card_uuid as a physical identifier.
            # card_uuid is a canonical identity and can repeat across duplicate copies,
            # so those reservations must be allowed to rematch into the scan-keyed table.
            db.execute(
                "UPDATE acquisition_items SET status='owned' WHERE status='pending_purchase' AND id NOT IN (SELECT acquisition_item_id FROM physical_inventory_receipts)"
            )
            columns = {row[1] for row in db.execute("PRAGMA table_info(acquisition_items)")}
            for name, kind in (
                ("cost_status", "TEXT NOT NULL DEFAULT 'known'"),
                ("seller", "TEXT"), ("order_number", "TEXT"),
                ("source_lot", "TEXT"), ("listing_url", "TEXT"),
                ("source_key", "TEXT"), ("source_item_id", "TEXT"),
                ("registry_identity_id", "TEXT"), ("variation", "TEXT"),
                ("condition_type", "TEXT"), ("grade", "TEXT"),
                ("identity_status", "TEXT"), ("image_urls_json", "TEXT"),
                ("last_synced_at", "TEXT"),
                ("purchase_lot_id", "TEXT"), ("allocation_method", "TEXT"),
                ("individual_cost_verified", "INTEGER NOT NULL DEFAULT 0"),
                ("manual_entry", "INTEGER NOT NULL DEFAULT 0"),
                ("verification_status", "TEXT"),
                ("training_eligible", "INTEGER NOT NULL DEFAULT 0"),
                ("manual_notes", "TEXT")
            ):
                if name not in columns:
                    db.execute(f"ALTER TABLE acquisition_items ADD COLUMN {name} {kind}")
            db.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS acquisition_source_key_unique_idx "
                "ON acquisition_items(source_key) WHERE source_key IS NOT NULL"
            )
            db.execute(
                "CREATE INDEX IF NOT EXISTS acquisition_receiving_idx "
                "ON acquisition_items(status, purchased_at)"
            )
            receipt_columns = {row[1] for row in db.execute("PRAGMA table_info(physical_inventory_receipts)")}
            for name, kind in (("receipt_mode", "TEXT"), ("linked_at", "TEXT")):
                if name not in receipt_columns:
                    db.execute(f"ALTER TABLE physical_inventory_receipts ADD COLUMN {name} {kind}")

    def record_acquisition_item(self, item: dict[str, Any]) -> dict[str, Any]:
        """Idempotently preserve one marketplace purchase line/copy in the Mac ledger.

        Purchase sync is evidence intake only. It never receives inventory. Existing
        final lifecycle state is preserved when the same marketplace purchase is
        observed again by a scheduled sync.
        """
        if not str(item.get("source_key") or "").strip():
            self._record_acquisition_item_legacy(item)
            return {"created": True, "item": None}
        self.initialize()
        identity = item.get("identity") if isinstance(item.get("identity"), dict) else {}
        purchase_id = str(item.get("purchase_id") or "").strip()
        source = str(item.get("source") or "Misc").strip() or "Misc"
        source_key = str(item.get("source_key") or purchase_id).strip()
        allocated_cost = float(item.get("allocated_cost") or 0)
        if not purchase_id or not source_key or allocated_cost <= 0:
            raise ValueError("purchase_id, source_key, and positive allocated_cost are required")

        evidence = item.get("evidence")
        evidence_text = (
            json.dumps(evidence, sort_keys=True, default=str)
            if isinstance(evidence, (dict, list))
            else (str(evidence) if evidence is not None else None)
        )
        image_urls = item.get("image_urls") if isinstance(item.get("image_urls"), list) else []
        requested_status = str(item.get("status") or "awaiting_scan").strip() or "awaiting_scan"
        now = _utc_now()
        values = {
            "purchase_id": purchase_id,
            "source": source,
            "purchased_at": item.get("purchased_at"),
            "title": item.get("title"),
            "card_uuid": item.get("card_uuid"),
            "player": _norm(identity.get("player")),
            "year": str(identity.get("year") or "").strip() or None,
            "brand": _norm(identity.get("brand") or identity.get("manufacturer")) or None,
            "set_name": _norm(identity.get("setName") or identity.get("set_name") or identity.get("product")) or None,
            "card_number": _norm(identity.get("cardNumber") or identity.get("card_number")),
            "parallel": _norm_parallel(identity.get("parallel")) or None,
            "serial_family": _serial_family(identity.get("serialNumber") or identity.get("serial_number") or (f"/{identity.get('serialRun')}" if identity.get("serialRun") else "")) or None,
            "grading_company": _norm(identity.get("gradingCompany") or identity.get("grading_company")) or None,
            "is_auto": None if identity.get("isAuto") is None and identity.get("autograph") is None else int(bool(identity.get("isAuto") if identity.get("isAuto") is not None else identity.get("autograph"))),
            "is_relic": None if identity.get("isRelic") is None and identity.get("memorabilia") is None else int(bool(identity.get("isRelic") if identity.get("isRelic") is not None else identity.get("memorabilia"))),
            "allocated_cost": allocated_cost,
            "status": requested_status,
            "evidence": evidence_text,
            "seller": item.get("seller"),
            "order_number": item.get("order_number"),
            "source_lot": item.get("source_lot"),
            "listing_url": item.get("listing_url"),
            "source_key": source_key,
            "source_item_id": item.get("source_item_id"),
            "registry_identity_id": item.get("registry_identity_id") or identity.get("registryIdentityId") or identity.get("registry_identity_id"),
            "variation": _norm(identity.get("variation")) or None,
            "condition_type": _norm(identity.get("conditionType") or identity.get("condition_type")) or None,
            "grade": _norm(identity.get("grade") or identity.get("gradeValue") or identity.get("grade_value")) or None,
            "identity_status": str(item.get("identity_status") or "needs_scan_verification"),
            "image_urls_json": json.dumps([str(url) for url in image_urls if str(url).strip()][:12]),
            "last_synced_at": now,
        }
        with self._connect() as db:
            existing = db.execute(
                "SELECT * FROM acquisition_items WHERE source_key=?",
                (source_key,),
            ).fetchone()
            if existing:
                status = str(existing["status"] or "")
                values["status"] = status if status in FINAL_ACQUISITION_STATUSES or status == "pending_purchase" else requested_status
                if bool(existing["manual_entry"] if "manual_entry" in existing.keys() else 0):
                    # Once the operator has explicitly verified purchase facts,
                    # marketplace refreshes may update sync telemetry/images but
                    # must not silently rewrite the accountable manual truth.
                    protected = (
                        "purchase_id", "source", "purchased_at", "title", "card_uuid",
                        "player", "year", "brand", "set_name", "card_number", "parallel",
                        "serial_family", "grading_company", "is_auto", "is_relic",
                        "allocated_cost", "evidence", "seller", "order_number",
                        "source_lot", "listing_url", "registry_identity_id", "variation",
                        "condition_type", "grade", "identity_status",
                    )
                    for key in protected:
                        if key in values and key in existing.keys():
                            values[key] = existing[key]
                assignments = ",".join(f"{key}=?" for key in values)
                db.execute(
                    f"UPDATE acquisition_items SET {assignments} WHERE id=?",
                    (*values.values(), int(existing["id"])),
                )
                row_id = int(existing["id"])
                created = False
            else:
                insert_values = {**values, "created_at": now}
                columns = ",".join(insert_values)
                placeholders = ",".join("?" for _ in insert_values)
                cursor = db.execute(
                    f"INSERT INTO acquisition_items ({columns}) VALUES ({placeholders})",
                    tuple(insert_values.values()),
                )
                row_id = int(cursor.lastrowid)
                created = True
            row = db.execute("SELECT * FROM acquisition_items WHERE id=?", (row_id,)).fetchone()
        return {"created": created, "item": self._purchase_row_payload(row)}

    def _record_acquisition_item_legacy(self, item: dict[str, Any]) -> None:
        self.initialize()
        identity = item.get("identity") or item
        source = str(item.get("source") or "Misc").strip() or "Misc"
        raw_cost = item.get("allocated_cost")
        requested_cost_status = str(item.get("cost_status") or "").strip().lower()
        cost_known = raw_cost is not None and float(raw_cost or 0) > 0
        cost_status = "known" if cost_known else requested_cost_status or "unknown"
        allocated_cost = float(raw_cost or 0) if cost_known else 0.0
        if cost_status not in {"known", "unknown"}:
            raise ValueError("cost_status must be known or unknown")
        if cost_status == "known" and allocated_cost <= 0:
            raise ValueError("Known acquisition cost must be positive")
        if cost_status == "unknown" and source.casefold() != "misc":
            raise ValueError("Unknown acquisition cost is only allowed for Misc acquisition source")
        values = (
            str(item.get("purchase_id") or "").strip(),
            source,
            item.get("purchased_at"),
            item.get("title"),
            item.get("card_uuid"),
            _norm(identity.get("player")),
            str(identity.get("year") or "").strip() or None,
            _norm(identity.get("brand")) or None,
            _norm(identity.get("setName") or identity.get("set_name")) or None,
            _norm(identity.get("cardNumber") or identity.get("card_number")),
            _norm_parallel(identity.get("parallel")) or None,
            _serial_family(identity.get("serialNumber") or identity.get("serial_number")) or None,
            _norm(identity.get("gradingCompany") or identity.get("grading_company")) or None,
            None if identity.get("isAuto") is None else int(bool(identity.get("isAuto"))),
            None if identity.get("isRelic") is None else int(bool(identity.get("isRelic"))),
            allocated_cost,
            cost_status,
            str(item.get("status") or "owned"),
            item.get("evidence"),
            item.get("seller"),
            item.get("order_number") or item.get("purchase_id"),
            item.get("source_lot") or item.get("title"),
            item.get("listing_url"),
            _utc_now(),
        )
        if not values[0] or not values[5] or not values[9]:
            raise ValueError("purchase_id, player, and card_number are required")
        with self._connect() as db:
            db.execute(
                """
                INSERT OR REPLACE INTO acquisition_items (
                    purchase_id, source, purchased_at, title, card_uuid, player, year,
                    brand, set_name, card_number, parallel, serial_family, grading_company,
                    is_auto, is_relic, allocated_cost, cost_status, status, evidence,
                    seller, order_number, source_lot, listing_url, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                values,
            )

    @staticmethod
    def _compatible(candidate: dict[str, Any], row: sqlite3.Row) -> bool:
        year = str(candidate.get("year") or "").strip()
        if year and row["year"] and year != str(row["year"]):
            return False
        candidate_grade = _norm(candidate.get("gradingCompany"))
        row_grade = _norm(row["grading_company"])
        if bool(candidate_grade) != bool(row_grade):
            return False
        if candidate_grade and row_grade and candidate_grade != row_grade:
            return False
        candidate_parallel = _norm_parallel(candidate.get("parallel"))
        row_parallel = _norm_parallel(row["parallel"])
        generic = {"", "base", "unknown", "variation"}
        if candidate_parallel not in generic and row_parallel not in generic:
            if candidate_parallel != row_parallel:
                return False
        candidate_serial = _serial_family(candidate.get("serialNumber"))
        row_serial = str(row["serial_family"] or "")
        if candidate_serial and row_serial and candidate_serial != row_serial:
            return False
        for key, column in (("isAuto", "is_auto"), ("isRelic", "is_relic")):
            if candidate.get(key) is not None and row[column] is not None:
                if int(bool(candidate.get(key))) != int(row[column]):
                    return False
        return True

    @staticmethod
    def _set_compatible(candidate: dict[str, Any], row: sqlite3.Row) -> bool:
        left = _norm(candidate.get("setName") or candidate.get("brand"))
        right = _norm(row["set_name"] or row["brand"])
        if not left or not right:
            return True
        stop = {"panini", "topps", "upper", "deck", "basketball", "wnba", "hockey", "baseball"}
        left_tokens = {token for token in left.split() if token not in stop}
        right_tokens = {token for token in right.split() if token not in stop}
        if not left_tokens or not right_tokens:
            return True
        return bool(left_tokens & right_tokens)

    def find_price_match(
        self,
        identity: dict[str, Any],
        delivered_cost: float | None,
        threshold: float = 0.15,
    ) -> AcquisitionPriceMatch | None:
        self.initialize()
        if delivered_cost is None or delivered_cost <= 0:
            return None
        player = _norm(identity.get("player"))
        card_number = _norm(identity.get("cardNumber") or identity.get("card_number"))
        if not player or not card_number:
            return None
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM acquisition_items "
                "WHERE player=? AND card_number=? AND allocated_cost>0 "
                "AND (COALESCE(manual_entry,0)=0 OR COALESCE(individual_cost_verified,0)=1)",
                (player, card_number),
            ).fetchall()
        registry_identity_id = str(
            identity.get("registryIdentityId") or identity.get("registry_identity_id") or ""
        ).strip() or None
        matches = []
        for row in rows:
            row_registry = str(row["registry_identity_id"] or "").strip() if "registry_identity_id" in row.keys() else ""
            if registry_identity_id and row_registry and registry_identity_id != row_registry:
                continue
            if not self._compatible(identity, row) or not self._set_compatible(identity, row):
                continue
            matches.append(row)
        if not matches:
            return None
        costs = [float(row["allocated_cost"]) for row in matches]
        benchmark = float(median(costs))
        if delivered_cost > benchmark * (1.0 + max(0.0, threshold)):
            return None
        delta = ((delivered_cost / benchmark) - 1.0) * 100.0
        purchase_ids = tuple(sorted({str(row["purchase_id"]) for row in matches}))
        return AcquisitionPriceMatch(
            benchmark_cost=round(benchmark, 2),
            delivered_cost=round(float(delivered_cost), 2),
            delta_percent=round(delta, 2),
            match_count=len(matches),
            purchase_ids=purchase_ids,
        )

    def record_price_alert(
        self,
        candidate_key: str,
        listing_url: str,
        match: AcquisitionPriceMatch,
        delivery_status: str | None = None,
    ) -> None:
        self.initialize()
        with self._connect() as db:
            db.execute(
                """
                INSERT INTO acquisition_price_alerts (
                    candidate_key, listing_url, observed_at, benchmark_cost, delivered_cost,
                    delta_percent, match_count, purchase_ids, delivery_status
                ) VALUES (?,?,?,?,?,?,?,?,?)
                ON CONFLICT(candidate_key) DO UPDATE SET
                    listing_url=excluded.listing_url,
                    observed_at=excluded.observed_at,
                    benchmark_cost=excluded.benchmark_cost,
                    delivered_cost=excluded.delivered_cost,
                    delta_percent=excluded.delta_percent,
                    match_count=excluded.match_count,
                    purchase_ids=excluded.purchase_ids,
                    delivery_status=excluded.delivery_status
                """,
                (
                    candidate_key,
                    listing_url,
                    _utc_now(),
                    match.benchmark_cost,
                    match.delivered_cost,
                    match.delta_percent,
                    match.match_count,
                    ",".join(match.purchase_ids),
                    delivery_status,
                ),
            )

    def _purchase_row_payload(self, row: sqlite3.Row) -> dict[str, Any]:
        def optional(name: str) -> Any:
            return row[name] if name in row.keys() else None

        try:
            images = json.loads(str(optional("image_urls_json") or "[]"))
        except (TypeError, ValueError, json.JSONDecodeError):
            images = []
        return {
            "acquisitionItemId": int(row["id"]),
            "purchaseId": str(row["purchase_id"]),
            "sourceKey": optional("source_key"),
            "source": str(row["source"] or "Misc"),
            "sourceItemId": optional("source_item_id"),
            "purchaseDate": row["purchased_at"],
            "title": row["title"],
            "seller": optional("seller"),
            "orderNumber": optional("order_number"),
            "sourceLot": optional("source_lot"),
            "listingUrl": optional("listing_url"),
            "imageUrls": images if isinstance(images, list) else [],
            "allocatedCost": (
                None
                if str(optional("cost_status") or "known").strip().lower() == "unknown"
                else round(float(row["allocated_cost"]), 2)
            ),
            "costStatus": str(optional("cost_status") or "known"),
            "player": row["player"],
            "year": row["year"],
            "brand": row["brand"],
            "setName": row["set_name"],
            "cardNumber": row["card_number"],
            "registryIdentityId": optional("registry_identity_id"),
            "serialFamily": row["serial_family"],
            "parallel": row["parallel"],
            "variation": optional("variation"),
            "conditionType": optional("condition_type"),
            "gradingCompany": row["grading_company"],
            "grade": optional("grade"),
            "identityStatus": optional("identity_status"),
            "status": row["status"],
            "lastSyncedAt": optional("last_synced_at"),
            "purchaseLotId": optional("purchase_lot_id"),
            "allocationMethod": optional("allocation_method"),
            "individualCostVerified": bool(optional("individual_cost_verified") or 0),
            "manualEntry": bool(optional("manual_entry") or 0),
            "verificationStatus": optional("verification_status"),
            "trainingEligible": bool(optional("training_eligible") or 0),
            "manualNotes": optional("manual_notes"),
        }

    def pending_purchases(self, cutoff: str = RECEIVING_CUTOVER_DATE) -> list[dict[str, Any]]:
        self.initialize()
        with self._connect() as db:
            rows = db.execute(
                "SELECT a.*, r.inventory_item_id, r.scan_id, r.status AS receipt_status, "
                "r.disposition, r.inventory_state, r.matched_at "
                "FROM acquisition_items a LEFT JOIN physical_inventory_receipts r "
                "ON r.acquisition_item_id=a.id "
                "WHERE (date(a.purchased_at) >= date(?) OR COALESCE(a.manual_entry,0)=1) "
                "AND a.status NOT IN ('sold','refunded') "
                "ORDER BY a.purchased_at DESC, a.id DESC",
                (cutoff,),
            ).fetchall()
        output = []
        for row in rows:
            payload = self._purchase_row_payload(row)
            payload.update({
                "inventoryItemId": row["inventory_item_id"],
                "scanId": row["scan_id"],
                "receiptStatus": row["receipt_status"],
                "disposition": row["disposition"],
                "inventoryState": row["inventory_state"],
                "matchedAt": row["matched_at"],
                "awaitingOwnScan": row["receipt_status"] is None and str(row["status"]) not in FINAL_ACQUISITION_STATUSES,
            })
            output.append(payload)
        return output

    @staticmethod
    def _identity_value(identity: dict[str, Any], *keys: str) -> Any:
        for key in keys:
            if key in identity and identity.get(key) not in (None, ""):
                return identity.get(key)
        return None

    @staticmethod
    def _meaningful_variation(value: Any) -> str:
        normalized = _norm(value)
        return "" if normalized in {"", "base", "none", "standard"} else normalized

    @staticmethod
    def _title_is_multi_card(title: Any) -> bool:
        text = str(title or "")
        return bool(re.search(r"\b(?:lot|bundle|set of|pair|2x|3x|4x|\d+\s*(?:card|cards|rcs|rookies))\b", text, re.I))

    def _strict_title_proves_scan(self, title: Any, scan_identity: dict[str, Any]) -> tuple[bool, list[str]]:
        text = str(title or "").strip()
        normalized = _norm(text)
        if not text or self._title_is_multi_card(text):
            return False, ["multi_card_or_empty_title"]
        reasons: list[str] = []
        player = _norm(self._identity_value(scan_identity, "player"))
        for token in player.split():
            if token and token not in normalized.split():
                reasons.append(f"title_missing_player:{token}")
        year = str(self._identity_value(scan_identity, "year") or "").strip()
        if not year or year not in text:
            reasons.append("title_year_mismatch")
        card_number = str(self._identity_value(scan_identity, "card_number", "cardNumber") or "").strip().lstrip("#")
        if not card_number or not re.search(rf"(?:#\s*|card\s*(?:no\.?|number|#)?\s*){re.escape(card_number)}\b", text, re.I):
            reasons.append("title_card_number_mismatch")
        brand = _norm(self._identity_value(scan_identity, "brand", "manufacturer"))
        if brand and not all(token in normalized.split() for token in brand.split() if len(token) >= 3):
            reasons.append("title_brand_mismatch")
        set_name = _norm(self._identity_value(scan_identity, "set_name", "setName", "product"))
        set_tokens = [token for token in set_name.split() if len(token) >= 4 and token not in {"card", "cards", "base", "wnba", "nba", "mlb"}]
        if set_tokens and not all(token in normalized.split() for token in set_tokens):
            reasons.append("title_set_mismatch")
        parallel = _norm_parallel(self._identity_value(scan_identity, "parallel")) or "base"
        parallel_words = {"silver", "green", "red", "blue", "gold", "orange", "purple", "pink", "black", "white", "ice", "seismic", "velocity", "wave", "pandora", "refractor", "holo", "scope", "mojo", "shimmer"}
        words = set(normalized.split())
        if parallel == "base":
            if "base" not in words or words.intersection(parallel_words):
                reasons.append("title_base_parallel_not_explicit")
        else:
            wanted = [token for token in parallel.split() if token not in {"prizm", "prizms", "parallel"}]
            if wanted and not all(token in words for token in wanted):
                reasons.append("title_parallel_mismatch")
        variation = self._meaningful_variation(self._identity_value(scan_identity, "variation"))
        if variation:
            variation_tokens = [token for token in variation.split() if len(token) >= 4]
            if variation_tokens and not all(token in words for token in variation_tokens):
                reasons.append("title_variation_mismatch")
        serial = _serial_family(
            self._identity_value(scan_identity, "serial_number", "serialNumber")
            or (f"/{self._identity_value(scan_identity, 'serial_run', 'serialRun')}" if self._identity_value(scan_identity, "serial_run", "serialRun") else "")
        )
        title_serials = {f"/{match}" for match in re.findall(r"/\s*(\d{1,6})\b", text)}
        if serial:
            if serial not in title_serials:
                reasons.append("title_serial_run_mismatch")
        elif title_serials:
            reasons.append("title_unexpected_serial_run")
        auto = bool(self._identity_value(scan_identity, "autograph", "isAuto") or False)
        relic = bool(self._identity_value(scan_identity, "memorabilia", "isRelic") or False)
        title_auto = bool(re.search(r"\b(?:auto|autograph|autographed|signed)\b", text, re.I))
        title_relic = bool(re.search(r"\b(?:relic|patch|jersey|memorabilia|game used)\b", text, re.I))
        if auto != title_auto:
            reasons.append("title_autograph_state_mismatch")
        if relic != title_relic:
            reasons.append("title_relic_state_mismatch")
        grader = _norm(self._identity_value(scan_identity, "gradingCompany", "grading_company"))
        title_graded = bool(re.search(r"\b(?:PSA|BGS|SGC|CGC|TAG|CSG)\s*\d", text, re.I))
        if bool(grader) != title_graded:
            reasons.append("title_raw_graded_mismatch")
        elif grader and grader not in normalized:
            reasons.append("title_grader_mismatch")
        return not reasons, reasons or ["marketplace_title_explicitly_proves_registry_scan"]

    def _exact_purchase_identity_match(
        self,
        scan_identity: dict[str, Any],
        registry_identity_id: str | None,
        row: sqlite3.Row,
    ) -> tuple[bool, list[str]]:
        """Fail-closed identity gate for physical receiving.

        A marketplace title is evidence, never authority. A Registry UUID match is
        sufficient. Otherwise every material card-identity dimension stored from
        the source purchase must agree with the Registry-locked scan.
        """
        row_registry = str(row["registry_identity_id"] or "").strip() if "registry_identity_id" in row.keys() else ""
        if registry_identity_id and row_registry:
            if registry_identity_id == row_registry:
                return True, ["same_registry_identity"]
            return False, ["registry_identity_mismatch"]

        if self._title_is_multi_card(row["title"]):
            return False, ["multi_card_purchase_requires_manual_allocation"]
        if "identity_status" in row.keys() and str(row["identity_status"] or "") not in {"source_exact", "registry_exact"}:
            title_exact, title_reasons = self._strict_title_proves_scan(row["title"], scan_identity)
            if title_exact:
                return True, title_reasons
            return False, ["purchase_source_identity_requires_exact_review", *title_reasons]

        player = _norm(self._identity_value(scan_identity, "player"))
        year = str(self._identity_value(scan_identity, "year") or "").strip()
        brand = _norm(self._identity_value(scan_identity, "brand", "manufacturer"))
        set_name = _norm(self._identity_value(scan_identity, "set_name", "setName", "product"))
        card_number = _norm(self._identity_value(scan_identity, "card_number", "cardNumber"))
        parallel = _norm_parallel(self._identity_value(scan_identity, "parallel")) or "base"
        variation = self._meaningful_variation(self._identity_value(scan_identity, "variation"))
        serial_family = _serial_family(
            self._identity_value(scan_identity, "serial_number", "serialNumber")
            or (f"/{self._identity_value(scan_identity, 'serial_run', 'serialRun')}" if self._identity_value(scan_identity, "serial_run", "serialRun") else "")
        )
        auto_value = self._identity_value(scan_identity, "autograph", "isAuto")
        relic_value = self._identity_value(scan_identity, "memorabilia", "isRelic")
        # Preserve unknown physical attributes as unknown. Coercing missing values
        # to False would let unproven non-auto/non-relic state pass an exact gate.
        auto = None if auto_value is None else bool(auto_value)
        relic = None if relic_value is None else bool(relic_value)

        required = {
            "player": (player, _norm(row["player"])),
            "year": (year, str(row["year"] or "").strip()),
            "brand": (brand, _norm(row["brand"])),
            "set": (set_name, _norm(row["set_name"])),
            "card_number": (card_number, _norm(row["card_number"])),
        }
        reasons: list[str] = []
        for label, (left, right) in required.items():
            if not left or not right:
                reasons.append(f"missing_{label}_evidence")
            elif left != right:
                reasons.append(f"{label}_mismatch")

        row_parallel = _norm_parallel(row["parallel"]) or "base"
        if parallel != row_parallel:
            reasons.append("parallel_mismatch")
        row_variation = self._meaningful_variation(row["variation"] if "variation" in row.keys() else None)
        if variation != row_variation:
            reasons.append("variation_mismatch")
        row_serial = str(row["serial_family"] or "")
        if serial_family != row_serial:
            reasons.append("serial_run_mismatch")
        if auto is None or row["is_auto"] is None:
            reasons.append("autograph_state_unproven")
        elif int(bool(auto)) != int(row["is_auto"]):
            reasons.append("autograph_state_mismatch")
        if relic is None or row["is_relic"] is None:
            reasons.append("relic_state_unproven")
        elif int(bool(relic)) != int(row["is_relic"]):
            reasons.append("relic_state_mismatch")

        scan_grade_company = _norm(self._identity_value(scan_identity, "gradingCompany", "grading_company"))
        row_grade_company = _norm(row["grading_company"])
        scan_is_graded = bool(scan_grade_company)
        row_condition = _norm(row["condition_type"] if "condition_type" in row.keys() else None)
        row_is_graded = row_condition == "graded" or bool(row_grade_company)
        if scan_is_graded != row_is_graded:
            reasons.append("raw_graded_mismatch")
        elif scan_is_graded:
            if scan_grade_company != row_grade_company:
                reasons.append("grading_company_mismatch")
            scan_grade = _norm(self._identity_value(scan_identity, "grade", "gradeValue", "grade_value"))
            row_grade = _norm(row["grade"] if "grade" in row.keys() else None)
            if not scan_grade or not row_grade or scan_grade != row_grade:
                reasons.append("grade_mismatch")

        return not reasons, reasons or ["all_exact_identity_fields_match"]

    def _scan_match_score(self, identity: dict[str, Any], row: sqlite3.Row) -> tuple[float, list[str]]:
        if not self._compatible(identity, row) or not self._set_compatible(identity, row):
            return 0.0, ["identity_conflict"]
        score = 0.55
        reasons = ["player_and_card_number"]
        year = str(identity.get("year") or "").strip()
        if year and row["year"] and year == str(row["year"]):
            score += 0.08; reasons.append("year")
        cp = _norm_parallel(identity.get("parallel") or identity.get("variation"))
        rp = _norm_parallel(row["parallel"])
        generic = {"", "base", "unknown", "variation"}
        if cp not in generic and rp not in generic and cp == rp:
            score += 0.14; reasons.append("parallel")
        cs = _serial_family(identity.get("serialNumber") or identity.get("serial_number"))
        rs = str(row["serial_family"] or "")
        if cs and rs and cs == rs:
            score += 0.13; reasons.append("serial_family")
        if identity.get("isAuto") is not None and row["is_auto"] is not None and int(bool(identity.get("isAuto"))) == int(row["is_auto"]):
            score += 0.05; reasons.append("auto_state")
        if identity.get("isRelic") is not None and row["is_relic"] is not None and int(bool(identity.get("isRelic"))) == int(row["is_relic"]):
            score += 0.03; reasons.append("relic_state")
        if self._set_compatible(identity, row):
            score += 0.02; reasons.append("set_family")
        return min(1.0, score), reasons

    @contextmanager
    def _scan_connect(self):
        if not self.scan_database_path:
            raise ValueError("scan_database_not_configured")
        db = sqlite3.connect(self.scan_database_path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=30000")
        try:
            yield db
        finally:
            db.close()

    def _verified_scan(self, scan_id: str, expected_card_uuid: str | None = None) -> dict[str, Any]:
        scan_id = str(scan_id or "").strip()
        if not scan_id:
            raise ValueError("A real InstaComp scan is required before purchase receiving")
        with self._scan_connect() as db:
            columns = {row[1] for row in db.execute("PRAGMA table_info(scans)").fetchall()}
            required_columns = {
                "scan_id", "created_at", "front_sha256", "back_sha256",
                "image_pair_sha256", "status", "checklist_json",
            }
            missing_columns = sorted(required_columns - columns)
            if missing_columns:
                raise ValueError(
                    "The InstaComp scan schema lacks required Registry verification fields "
                    "(" + ",".join(missing_columns) + "); receiving stays blocked"
                )
            selected = [
                "scan_id", "created_at", "front_sha256", "back_sha256",
                "image_pair_sha256", "status", "checklist_json",
            ]
            if "card_uuid" in columns:
                selected.insert(1, "card_uuid")
            row = db.execute(
                f"SELECT {','.join(selected)} FROM scans WHERE scan_id=?",
                (scan_id,),
            ).fetchone()
        if not row:
            raise ValueError("The InstaComp scan could not be verified on the Mac")
        front_sha = str(row["front_sha256"] or "").strip()
        back_sha = str(row["back_sha256"] or "").strip()
        if not front_sha or not back_sha:
            raise ValueError("Both a scanned front and scanned back are required before receiving inventory")
        if front_sha == back_sha:
            raise ValueError("Front and back scan evidence must be two distinct card images")
        scan_uuid = str(row["card_uuid"] or "").strip() if "card_uuid" in row.keys() else ""
        expected_uuid = str(expected_card_uuid or "").strip()
        if expected_uuid and scan_uuid and scan_uuid != expected_uuid:
            raise ValueError("The InstaComp scan belongs to a different card UUID")
        try:
            checklist = json.loads(str(row["checklist_json"] or "{}"))
        except (TypeError, ValueError, json.JSONDecodeError):
            checklist = {}
        registry_identity_id = str(checklist.get("identity_id") or "").strip()
        registry_identity = checklist.get("identity") if isinstance(checklist.get("identity"), dict) else None
        if checklist.get("outcome") != "exact_match" or not registry_identity_id or not registry_identity:
            raise ValueError(
                "The physical scan does not have one exact Checklist Registry identity; receiving stays blocked"
            )
        scan_status = str(row["status"] or "").strip()
        if scan_status not in {"trusted_memory_match", "autonomy_auto_accept"}:
            raise ValueError(
                "The physical scan still requires identity review on the Mac; receiving stays blocked"
            )
        return {
            "scanId": str(row["scan_id"]),
            "scanCardUuid": scan_uuid or None,
            "scannedAt": row["created_at"],
            "frontSha256": str(row["front_sha256"]),
            "backSha256": str(row["back_sha256"]),
            "imagePairSha256": str(row["image_pair_sha256"] or "") or None,
            "scanStatus": str(row["status"] or "") or None,
            "registryIdentityId": registry_identity_id,
            "registryIdentity": registry_identity,
            "registryReceipts": checklist.get("source_receipts") or [],
        }

    def _condition_image_pair(self, scan: dict[str, Any]) -> tuple[str, str]:
        """Return the exact verified image pair a human condition review is allowed to certify."""
        scan_id = str(scan.get("scanId") or "").strip()
        listing = None
        with self._scan_connect() as db:
            has_receipts = db.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='listing_image_receipts'"
            ).fetchone()
            if has_receipts:
                listing = db.execute(
                    "SELECT listing_image_pair_sha256,front_verified,back_verified "
                    "FROM listing_image_receipts WHERE scan_id=?",
                    (scan_id,),
                ).fetchone()
        if listing is not None:
            if not (bool(listing["front_verified"]) and bool(listing["back_verified"])):
                raise ValueError("Condition review requires a fully verified listing-image receipt")
            pair = str(listing["listing_image_pair_sha256"] or "").strip()
            if not pair:
                raise ValueError("Condition review listing-image pair receipt is incomplete")
            return pair, "verified_listing_image_receipt"
        pair = str(scan.get("imagePairSha256") or "").strip()
        if not pair:
            raise ValueError("Condition review requires the verified front/back image pair receipt")
        return pair, "scan_archive_pair"

    def match_or_reserve_purchase(
        self,
        identity: dict[str, Any],
        card_uuid: str,
        inventory_item_id: str | None = None,
        scan_id: str | None = None,
    ) -> dict[str, Any]:
        self.initialize()
        card_uuid = str(card_uuid or "").strip()
        inventory_item_id = str(inventory_item_id or "").strip()
        if not inventory_item_id:
            return {"status": "no_match", "reason": "physical_inventory_item_required", "match": None}
        try:
            scan = self._verified_scan(str(scan_id or ""), card_uuid)
        except ValueError as exc:
            return {"status": "scan_required", "reason": str(exc), "match": None}

        scan_identity = dict(scan["registryIdentity"])
        # Grading is physical-copy state rather than Checklist identity. Accept it
        # only as a supplement from the already-scanned KINGMAKER inventory row.
        for target, keys in {
            "gradingCompany": ("gradingCompany", "grading_company"),
            "grade": ("grade", "gradeValue", "grade_value"),
        }.items():
            for key in keys:
                if identity.get(key) not in (None, ""):
                    scan_identity[target] = identity.get(key)
                    break
        registry_identity_id = str(scan["registryIdentityId"])
        player = _norm(scan_identity.get("player"))
        card_number = _norm(scan_identity.get("card_number") or scan_identity.get("cardNumber"))
        if not player or not card_number:
            return {"status": "scan_required", "reason": "Registry scan identity is missing player/card number", "match": None}

        with self._connect() as db:
            existing = db.execute(
                "SELECT r.*, a.* FROM physical_inventory_receipts r "
                "JOIN acquisition_items a ON a.id=r.acquisition_item_id "
                "WHERE r.inventory_item_id=? OR r.scan_id=?",
                (inventory_item_id, scan["scanId"]),
            ).fetchone()
            if existing:
                payload = self._purchase_row_payload(existing)
                return {
                    "status": str(existing["status"]),
                    "inventoryState": str(existing["inventory_state"]),
                    "disposition": existing["disposition"],
                    "scanId": str(existing["scan_id"]),
                    "inventoryItemId": str(existing["inventory_item_id"]),
                    "confidence": float(existing["match_confidence"]),
                    "reason": existing["match_reason"],
                    "receiptMode": existing["receipt_mode"] if "receipt_mode" in existing.keys() else None,
                    "linkedAt": existing["linked_at"] if "linked_at" in existing.keys() else None,
                    "receivedAt": existing["received_at"] if "received_at" in existing.keys() else None,
                    "match": payload,
                }

            rows = db.execute(
                "SELECT * FROM acquisition_items a "
                "WHERE a.status NOT IN ('sold','refunded','received','linked_existing') "
                "AND date(a.purchased_at) >= date(?) "
                "AND NOT EXISTS (SELECT 1 FROM physical_inventory_receipts r WHERE r.acquisition_item_id=a.id) "
                "ORDER BY a.purchased_at DESC, a.id DESC",
                (RECEIVING_CUTOVER_DATE,),
            ).fetchall()
            exact: list[tuple[sqlite3.Row, list[str]]] = []
            near: list[tuple[sqlite3.Row, list[str]]] = []
            for row in rows:
                same_player = _norm(row["player"]) == player if str(row["player"] or "").strip() else False
                same_number = _norm(row["card_number"]) == card_number if str(row["card_number"] or "").strip() else False
                title_norm = _norm(row["title"])
                title_player = bool(player) and all(token in title_norm.split() for token in player.split())
                raw_number = str(scan_identity.get("card_number") or scan_identity.get("cardNumber") or "").strip().lstrip("#")
                title_number = bool(raw_number) and bool(
                    re.search(rf"(?:#\s*|card\s*(?:no\.?|number|#)?\s*){re.escape(raw_number)}\b", str(row["title"] or ""), re.I)
                )
                registry_same = (
                    str(row["registry_identity_id"] or "").strip() == registry_identity_id
                    if "registry_identity_id" in row.keys() else False
                )
                if not (same_player and same_number) and not registry_same and not (title_player and title_number):
                    continue
                matched, reasons = self._exact_purchase_identity_match(
                    scan_identity, registry_identity_id, row
                )
                if matched:
                    exact.append((row, reasons))
                else:
                    near.append((row, reasons))

            if len(exact) != 1:
                if len(exact) > 1:
                    return {
                        "status": "possible_match",
                        "inventoryItemId": inventory_item_id,
                        "scanId": scan["scanId"],
                        "confidence": 1.0,
                        "reason": "multiple_exact_purchase_copies_require_operator_choice",
                        "matches": [self._purchase_row_payload(row) for row, _ in exact],
                        "match": None,
                    }
                if near:
                    row, reasons = near[0]
                    return {
                        "status": "possible_match",
                        "inventoryItemId": inventory_item_id,
                        "scanId": scan["scanId"],
                        "confidence": 0.0,
                        "reason": "exact_identity_not_proven:" + ",".join(reasons),
                        "match": self._purchase_row_payload(row),
                    }
                return {
                    "status": "no_match",
                    "inventoryItemId": inventory_item_id,
                    "scanId": scan["scanId"],
                    "reason": "no_exact_unreceived_purchase",
                    "match": None,
                }

            row, reasons = exact[0]
            payload = self._purchase_row_payload(row)
            reason = "exact_registry_scan_purchase_match:" + ",".join(reasons)
            now = _utc_now()
            snapshot = json.dumps(
                {"registryIdentity": scan_identity, "registryIdentityId": registry_identity_id, "purchase": payload},
                sort_keys=True,
                default=str,
            )
            scan_snapshot = json.dumps(scan, sort_keys=True, default=str)
            db.execute(
                "INSERT INTO physical_inventory_receipts("
                "inventory_item_id,scan_id,card_uuid,acquisition_item_id,status,disposition,inventory_state,"
                "match_confidence,match_reason,matched_at,scan_verified_at,scan_snapshot_json,"
                "received_at,receipt_mode,linked_at,snapshot_json"
                ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    inventory_item_id, scan["scanId"], card_uuid or scan.get("scanCardUuid"),
                    int(row["id"]), "received", "resale", "resale_ready", 1.0,
                    reason, now, now, scan_snapshot, now, "received_new", None, snapshot,
                ),
            )
            db.execute(
                "UPDATE acquisition_items SET status='received', registry_identity_id=COALESCE(registry_identity_id, ?) WHERE id=?",
                (registry_identity_id, int(row["id"])),
            )
            return {
                "status": "received",
                "inventoryState": "resale_ready",
                "disposition": "resale",
                "inventoryItemId": inventory_item_id,
                "scanId": scan["scanId"],
                "confidence": 1.0,
                "reason": reason,
                "receiptMode": "received_new",
                "linkedAt": None,
                "receivedAt": now,
                "match": payload,
            }

    def reserve_specific_acquisition(
        self,
        identity: dict[str, Any],
        card_uuid: str,
        inventory_item_id: str,
        scan_id: str,
        acquisition_item_id: int,
        verification_source: str,
    ) -> dict[str, Any]:
        """Reserve an already-selected acquisition after explicit evidence review.

        Discovery remains heuristic in match_or_reserve_purchase. This path is for a
        caller that has already proved which purchase/source belongs to this physical
        scan (for example a live eBay/Mercari order or the operator's Misc fallback).
        It never weakens identity conflicts and Misc rows must be pre-bound to the
        exact physical card UUID, preventing duplicate copies from stealing each
        other's accounting row.
        """
        self.initialize()
        card_uuid = str(card_uuid or "").strip()
        inventory_item_id = str(inventory_item_id or "").strip()
        verification_source = str(verification_source or "").strip()
        acquisition_item_id = int(acquisition_item_id or 0)
        if not inventory_item_id or acquisition_item_id <= 0 or not verification_source:
            raise ValueError("Explicit acquisition reservation requires inventory item, acquisition item, and verification source")
        scan = self._verified_scan(scan_id, card_uuid)
        with self._connect() as db:
            existing = db.execute(
                "SELECT r.*,a.* FROM physical_inventory_receipts r JOIN acquisition_items a ON a.id=r.acquisition_item_id WHERE r.inventory_item_id=? OR r.scan_id=?",
                (inventory_item_id, scan["scanId"]),
            ).fetchone()
            if existing:
                if int(existing["acquisition_item_id"]) != acquisition_item_id:
                    raise ValueError("This physical card is already reserved to a different acquisition item")
                return {
                    "status": str(existing["status"]), "inventoryState": str(existing["inventory_state"]),
                    "inventoryItemId": str(existing["inventory_item_id"]), "scanId": str(existing["scan_id"]),
                    "confidence": float(existing["match_confidence"]), "reason": existing["match_reason"],
                    "match": self._purchase_row_payload(existing),
                }
            row = db.execute(
                "SELECT * FROM acquisition_items WHERE id=? AND status NOT IN ('sold','refunded')",
                (acquisition_item_id,),
            ).fetchone()
            if not row:
                raise ValueError("Selected acquisition item is unavailable")
            already = db.execute(
                "SELECT inventory_item_id FROM physical_inventory_receipts WHERE acquisition_item_id=?",
                (acquisition_item_id,),
            ).fetchone()
            if already:
                raise ValueError("Selected acquisition item is already linked to another physical card")
            player = _norm(identity.get("player"))
            card_number = _norm(identity.get("cardNumber") or identity.get("card_number"))
            if player != _norm(row["player"]) or card_number != _norm(row["card_number"]):
                raise ValueError("Selected acquisition item conflicts with player/card number")
            if not self._compatible(identity, row) or not self._set_compatible(identity, row):
                raise ValueError("Selected acquisition item conflicts with the verified card identity")
            if str(row["source"] or "").casefold() == "misc":
                if not card_uuid or str(row["card_uuid"] or "").strip() != card_uuid:
                    raise ValueError("Misc fallback acquisition must be bound to this exact physical card UUID")
            score, reasons = self._scan_match_score(identity, row)
            payload = self._purchase_row_payload(row)
            reason = "explicit_assignment:" + verification_source + ";" + ",".join(reasons)
            now = _utc_now()
            snapshot = json.dumps({"identity": identity, "purchase": payload, "verificationSource": verification_source}, sort_keys=True, default=str)
            scan_snapshot = json.dumps(scan, sort_keys=True, default=str)
            db.execute(
                "INSERT INTO physical_inventory_receipts(inventory_item_id,scan_id,card_uuid,acquisition_item_id,status,disposition,inventory_state,match_confidence,match_reason,matched_at,scan_verified_at,scan_snapshot_json,received_at,receipt_mode,linked_at,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (inventory_item_id, scan["scanId"], card_uuid or None, acquisition_item_id, "received", "resale", "resale_ready", round(max(score, 0.99), 3), reason, now, now, scan_snapshot, now, "received_new", None, snapshot),
            )
            db.execute("UPDATE acquisition_items SET status='received' WHERE id=?", (acquisition_item_id,))
            return {
                "status": "received", "inventoryState": "resale_ready", "disposition": "resale",
                "inventoryItemId": inventory_item_id, "scanId": scan["scanId"],
                "confidence": round(max(score, 0.99), 3), "reason": reason,
                "receiptMode": "received_new", "linkedAt": None, "receivedAt": now,
                "match": payload,
            }

    def replace_misc_fallback_with_known_acquisition(
        self,
        identity: dict[str, Any],
        card_uuid: str,
        inventory_item_id: str,
        scan_id: str,
        acquisition_item_id: int,
        verification_source: str,
    ) -> dict[str, Any]:
        """Replace only a received Misc/unknown fallback with proved market acquisition."""
        self.initialize()
        card_uuid = str(card_uuid or "").strip()
        inventory_item_id = str(inventory_item_id or "").strip()
        acquisition_item_id = int(acquisition_item_id or 0)
        verification_source = str(verification_source or "").strip()
        if not inventory_item_id or acquisition_item_id <= 0 or not verification_source:
            raise ValueError("Known-acquisition replacement requires inventory, acquisition, and verification source")
        scan = self._verified_scan(scan_id, card_uuid)
        with self._connect() as db:
            receipt = db.execute(
                "SELECT r.*,a.source AS old_source,a.cost_status AS old_cost_status,a.purchase_id AS old_purchase_id FROM physical_inventory_receipts r JOIN acquisition_items a ON a.id=r.acquisition_item_id WHERE r.inventory_item_id=? AND r.scan_id=?",
                (inventory_item_id, scan["scanId"]),
            ).fetchone()
            if not receipt:
                raise ValueError("Physical inventory receipt was not found")
            if str(receipt["old_source"] or "").casefold() != "misc" or str(receipt["old_cost_status"] or "known") != "unknown":
                raise ValueError("Only a Misc/unknown fallback may be replaced")
            new = db.execute(
                "SELECT * FROM acquisition_items WHERE id=? AND status NOT IN ('sold','refunded')",
                (acquisition_item_id,),
            ).fetchone()
            if not new:
                raise ValueError("Known acquisition item is unavailable")
            if str(new["source"] or "").casefold() not in {"ebay", "mercari"} or str(new["cost_status"] or "known") != "known" or float(new["allocated_cost"] or 0) <= 0:
                raise ValueError("Replacement acquisition must be known-cost eBay or Mercari truth")
            linked = db.execute("SELECT inventory_item_id FROM physical_inventory_receipts WHERE acquisition_item_id=?", (acquisition_item_id,)).fetchone()
            if linked and str(linked["inventory_item_id"]) != inventory_item_id:
                raise ValueError("Known acquisition item is already linked to another physical card")
            player = _norm(identity.get("player")); number = _norm(identity.get("cardNumber") or identity.get("card_number"))
            if player != _norm(new["player"]) or number != _norm(new["card_number"]):
                raise ValueError("Known acquisition conflicts with player/card number")
            if not self._compatible(identity, new) or not self._set_compatible(identity, new):
                raise ValueError("Known acquisition conflicts with the verified card identity")
            payload = self._purchase_row_payload(new)
            old_id = int(receipt["acquisition_item_id"]); now = _utc_now()
            reason = "known_purchase_replaces_misc:" + verification_source
            snapshot = json.dumps({"identity": identity, "purchase": payload, "supersededMiscAcquisitionItemId": old_id, "verificationSource": verification_source}, sort_keys=True, default=str)
            db.execute(
                "UPDATE physical_inventory_receipts SET acquisition_item_id=?,match_confidence=?,match_reason=?,matched_at=?,snapshot_json=? WHERE id=?",
                (acquisition_item_id, 0.99, reason, now, snapshot, int(receipt["id"])),
            )
            db.execute("UPDATE acquisition_items SET status=? WHERE id=?", (str(receipt["status"] or "received"), acquisition_item_id))
            db.execute("UPDATE acquisition_items SET status='superseded',evidence=COALESCE(evidence,'') || ? WHERE id=?", (";superseded_by_known_market_purchase:" + str(new["purchase_id"]), old_id))
            return {
                "status": str(receipt["status"]), "inventoryState": str(receipt["inventory_state"]),
                "inventoryItemId": inventory_item_id, "scanId": scan["scanId"],
                "confidence": 0.99, "reason": reason, "match": payload,
                "supersededMiscAcquisitionItemId": old_id,
            }

    def receive_into_inventory(
        self,
        card_uuid: str,
        inventory_item_id: str | None,
        acquisition_item_id: int,
        scan_id: str | None,
        disposition: str,
    ) -> dict[str, Any]:
        self.initialize()
        inventory_item_id = str(inventory_item_id or "").strip()
        requested_scan_id = str(scan_id or "").strip()
        requested_card_uuid = str(card_uuid or "").strip()
        destination = str(disposition or "").strip().lower()
        if destination not in {"resale", "investment_stash"}:
            raise ValueError("Inventory destination must be resale or investment_stash")
        if not inventory_item_id or int(acquisition_item_id or 0) <= 0:
            raise ValueError("A scanned physical inventory item and acquisition_item_id are required")
        now = _utc_now()
        with self._connect() as db:
            receipt = db.execute(
                "SELECT * FROM physical_inventory_receipts WHERE inventory_item_id=? AND acquisition_item_id=?",
                (inventory_item_id, int(acquisition_item_id)),
            ).fetchone()
            if not receipt:
                raise ValueError("Purchase reservation was not found for this scanned physical card")
            bound_scan_id = str(receipt["scan_id"] or "").strip()
            bound_card_uuid = str(receipt["card_uuid"] or "").strip()
            if requested_scan_id and requested_scan_id != bound_scan_id:
                raise ValueError("The requested scan does not match the Mac-local purchase reservation")
            if requested_card_uuid and bound_card_uuid and requested_card_uuid != bound_card_uuid:
                raise ValueError("The requested card UUID does not match the Mac-local purchase reservation")
            scan = self._verified_scan(bound_scan_id, bound_card_uuid or requested_card_uuid)
            if not str(receipt["scan_verified_at"] or "").strip():
                raise ValueError("Inventory cannot be received without verified scan evidence")
            receipt_status = str(receipt["status"] or "").strip()
            receipt_mode = str(receipt["receipt_mode"] or "").strip()
            current_destination = str(receipt["disposition"] or "").strip()
            if receipt_status == "linked_existing" or receipt_mode == "linked_existing":
                raise ValueError("This scanned physical card is already linked to existing inventory and cannot be received as a new arrival")
            if receipt_status == "received" or receipt_mode == "received_new":
                if current_destination and current_destination != destination:
                    raise ValueError("This card is already received; use inventory disposition to change resale/investment destination")
                row = db.execute("SELECT * FROM acquisition_items WHERE id=?", (int(acquisition_item_id),)).fetchone()
                return {"status":"received","inventoryState":str(receipt["inventory_state"]),"disposition":current_destination or destination,"inventoryItemId":inventory_item_id,"scanId":scan["scanId"],"receivedAt":receipt["received_at"],"receiptMode":"received_new","match":self._purchase_row_payload(row)}
            if receipt_status != "pending_purchase":
                raise ValueError("Only a pending purchase reservation can be received into inventory")
            inventory_state = "investment_stash" if destination == "investment_stash" else "resale_ready"
            db.execute(
                "UPDATE physical_inventory_receipts SET status='received', disposition=?, inventory_state=?, received_at=?, receipt_mode='received_new', linked_at=NULL WHERE id=?",
                (destination, inventory_state, now, int(receipt["id"])),
            )
            db.execute("UPDATE acquisition_items SET status='received' WHERE id=?", (int(acquisition_item_id),))
            row = db.execute("SELECT * FROM acquisition_items WHERE id=?", (int(acquisition_item_id),)).fetchone()
        return {"status":"received","inventoryState":inventory_state,"disposition":destination,"inventoryItemId":inventory_item_id,"scanId":scan["scanId"],"receivedAt":now,"receiptMode":"received_new","match":self._purchase_row_payload(row)}

    def attach_manual_purchase_to_existing_inventory(
        self,
        card_uuid: str,
        inventory_item_id: str,
        acquisition_item_id: int,
        scan_id: str,
        disposition: str = "resale",
    ) -> dict[str, Any]:
        """Attach operator-verified manual purchase facts to existing inventory.

        This never increments commercial quantity. It creates the Mac-local
        physical/acquisition receipt needed for a card that was listed before
        its purchase facts were entered.
        """
        self.initialize()
        inventory_item_id = str(inventory_item_id or "").strip()
        card_uuid = str(card_uuid or "").strip()
        scan_id = str(scan_id or "").strip()
        acquisition_item_id = int(acquisition_item_id or 0)
        destination = str(disposition or "resale").strip().lower()
        if destination not in {"resale", "investment_stash"}:
            raise ValueError("Inventory destination must be resale or investment_stash")
        if not inventory_item_id or not scan_id or acquisition_item_id <= 0:
            raise ValueError("Existing inventory link requires inventory item, scan, and acquisition item")
        scan = self._verified_scan(scan_id, card_uuid)
        now = _utc_now()
        inventory_state = "investment_stash" if destination == "investment_stash" else "resale_ready"
        with self._connect() as db:
            acquisition = db.execute(
                "SELECT * FROM acquisition_items WHERE id=? AND status NOT IN ('sold','refunded')",
                (acquisition_item_id,),
            ).fetchone()
            if not acquisition:
                raise ValueError("Manual acquisition item is unavailable")
            existing = db.execute(
                "SELECT * FROM physical_inventory_receipts WHERE inventory_item_id=? OR scan_id=?",
                (inventory_item_id, scan["scanId"]),
            ).fetchone()
            if existing:
                if int(existing["acquisition_item_id"]) != acquisition_item_id:
                    raise ValueError("This physical inventory card is already linked to a different acquisition")
                row = db.execute(
                    "SELECT * FROM acquisition_items WHERE id=?",
                    (acquisition_item_id,),
                ).fetchone()
                return {
                    "status": str(existing["status"]),
                    "inventoryState": str(existing["inventory_state"]),
                    "disposition": existing["disposition"],
                    "inventoryItemId": inventory_item_id,
                    "scanId": str(existing["scan_id"]),
                    "linkedAt": existing["linked_at"] if "linked_at" in existing.keys() else None,
                    "receivedAt": existing["received_at"],
                    "receiptMode": existing["receipt_mode"] if "receipt_mode" in existing.keys() else None,
                    "match": self._purchase_row_payload(row),
                    "alreadyLinked": True,
                }
            payload = self._purchase_row_payload(acquisition)
            snapshot = json.dumps(
                {"manualPurchase": payload, "verificationSource": "operator_manual_purchase_evidence"},
                sort_keys=True,
                default=str,
            )
            scan_snapshot = json.dumps(scan, sort_keys=True, default=str)
            db.execute(
                "INSERT INTO physical_inventory_receipts("
                "inventory_item_id,scan_id,card_uuid,acquisition_item_id,status,disposition,inventory_state,"
                "match_confidence,match_reason,matched_at,scan_verified_at,scan_snapshot_json,"
                "received_at,receipt_mode,linked_at,snapshot_json"
                ") VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    inventory_item_id, scan["scanId"], card_uuid or scan.get("scanCardUuid"),
                    acquisition_item_id, "linked_existing", destination, inventory_state,
                    1.0, "operator_manual_purchase_evidence", now, now, scan_snapshot,
                    now, "linked_existing", now, snapshot,
                ),
            )
            db.execute(
                "UPDATE acquisition_items SET status='linked_existing' WHERE id=?",
                (acquisition_item_id,),
            )
            row = db.execute(
                "SELECT * FROM acquisition_items WHERE id=?",
                (acquisition_item_id,),
            ).fetchone()
        return {
            "status": "linked_existing",
            "inventoryState": inventory_state,
            "disposition": destination,
            "inventoryItemId": inventory_item_id,
            "scanId": scan["scanId"],
            "linkedAt": now,
            "receivedAt": now,
            "receiptMode": "linked_existing",
            "match": self._purchase_row_payload(row),
            "alreadyLinked": False,
        }

    def link_purchase_to_existing_inventory(
        self,
        card_uuid: str,
        inventory_item_id: str | None,
        acquisition_item_id: int,
        scan_id: str | None,
        disposition: str = "resale",
    ) -> dict[str, Any]:
        """Attach purchase history to an already-existing scanned physical inventory row without changing commercial quantity."""
        self.initialize()
        inventory_item_id = str(inventory_item_id or "").strip()
        requested_scan_id = str(scan_id or "").strip()
        requested_card_uuid = str(card_uuid or "").strip()
        destination = str(disposition or "resale").strip().lower()
        if destination not in {"resale", "investment_stash"}:
            raise ValueError("Inventory destination must be resale or investment_stash")
        if not inventory_item_id or int(acquisition_item_id or 0) <= 0:
            raise ValueError("A scanned existing inventory item and acquisition_item_id are required")
        now = _utc_now()
        with self._connect() as db:
            receipt = db.execute(
                "SELECT * FROM physical_inventory_receipts WHERE inventory_item_id=? AND acquisition_item_id=?",
                (inventory_item_id, int(acquisition_item_id)),
            ).fetchone()
            if not receipt:
                raise ValueError("Purchase reservation was not found for this scanned physical card")
            bound_scan_id = str(receipt["scan_id"] or "").strip()
            bound_card_uuid = str(receipt["card_uuid"] or "").strip()
            if requested_scan_id and requested_scan_id != bound_scan_id:
                raise ValueError("The requested scan does not match the Mac-local purchase reservation")
            if requested_card_uuid and bound_card_uuid and requested_card_uuid != bound_card_uuid:
                raise ValueError("The requested card UUID does not match the Mac-local purchase reservation")
            scan = self._verified_scan(bound_scan_id, bound_card_uuid or requested_card_uuid)
            if not str(receipt["scan_verified_at"] or "").strip():
                raise ValueError("Existing inventory cannot be linked without verified scan evidence")
            receipt_status = str(receipt["status"] or "").strip()
            receipt_mode = str(receipt["receipt_mode"] or "").strip()
            current_destination = str(receipt["disposition"] or "").strip()
            if receipt_status == "received" or receipt_mode == "received_new":
                raise ValueError("This scanned physical card is already received as a new arrival and cannot be relinked as existing inventory")
            if receipt_status == "linked_existing" or receipt_mode == "linked_existing":
                if current_destination and current_destination != destination:
                    raise ValueError("This card is already linked; use inventory disposition to change resale/investment destination")
                row = db.execute("SELECT * FROM acquisition_items WHERE id=?", (int(acquisition_item_id),)).fetchone()
                received_at = receipt["received_at"] or receipt["linked_at"] or receipt["matched_at"]
                return {"status":"linked_existing","inventoryState":str(receipt["inventory_state"]),"disposition":current_destination or destination,"inventoryItemId":inventory_item_id,"scanId":scan["scanId"],"linkedAt":receipt["linked_at"],"receivedAt":received_at,"receiptMode":"linked_existing","match":self._purchase_row_payload(row)}
            if receipt_status != "pending_purchase":
                raise ValueError("Only a pending purchase reservation can be linked to existing inventory")
            inventory_state = "investment_stash" if destination == "investment_stash" else "resale_ready"
            db.execute(
                "UPDATE physical_inventory_receipts SET status='linked_existing', disposition=?, inventory_state=?, receipt_mode='linked_existing', linked_at=?, received_at=? WHERE id=?",
                (destination, inventory_state, now, now, int(receipt["id"])),
            )
            db.execute("UPDATE acquisition_items SET status='linked_existing' WHERE id=?", (int(acquisition_item_id),))
            row = db.execute("SELECT * FROM acquisition_items WHERE id=?", (int(acquisition_item_id),)).fetchone()
        return {"status":"linked_existing","inventoryState":inventory_state,"disposition":destination,"inventoryItemId":inventory_item_id,"scanId":scan["scanId"],"linkedAt":now,"receivedAt":now,"receiptMode":"linked_existing","match":self._purchase_row_payload(row)}

    def inventory_truth(self, inventory_item_ids: list[str] | None = None) -> dict[str, Any]:
        """Return Mac-local physical inventory identity truth for KINGMAKER rows."""
        self.initialize()
        ids = [str(value or "").strip() for value in (inventory_item_ids or []) if str(value or "").strip()]
        with self._connect() as db:
            if ids:
                placeholders = ",".join("?" for _ in ids)
                rows = db.execute(
                    f"SELECT inventory_item_id,scan_id,card_uuid,status,disposition,inventory_state,snapshot_json FROM physical_inventory_receipts WHERE inventory_item_id IN ({placeholders})",
                    ids,
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT inventory_item_id,scan_id,card_uuid,status,disposition,inventory_state,snapshot_json FROM physical_inventory_receipts"
                ).fetchall()

        items: list[dict[str, Any]] = []
        for row in rows:
            try:
                snapshot = json.loads(str(row["snapshot_json"] or "{}"))
            except (TypeError, ValueError, json.JSONDecodeError):
                snapshot = {}
            identity = snapshot.get("identity") if isinstance(snapshot, dict) else {}
            if not isinstance(identity, dict):
                identity = {}
            fingerprint = None
            direct = str(identity.get("registryFingerprintSha256") or "").strip().lower()
            if re.fullmatch(r"[0-9a-f]{64}", direct):
                fingerprint = direct
            receipts = identity.get("internalChecklistSourceReceipts")
            if not fingerprint and isinstance(receipts, list):
                for receipt in receipts:
                    match = re.fullmatch(r"registry_fingerprint:([0-9a-f]{64})", str(receipt or "").strip(), re.I)
                    if match:
                        fingerprint = match.group(1).lower()
                        break
            items.append({
                "inventoryItemId": str(row["inventory_item_id"]),
                "scanId": str(row["scan_id"]),
                "cardUuid": str(row["card_uuid"] or "") or None,
                "status": str(row["status"]),
                "disposition": row["disposition"],
                "inventoryState": str(row["inventory_state"]),
                "identity": identity,
                "registryFingerprintSha256": fingerprint,
                "registryExact": bool(
                    fingerprint
                    or str(identity.get("internalChecklistOutcome") or "").strip().lower() == "exact_match"
                ),
                "sourceAuthority": "mac_local_sqlite",
            })
        return {
            "sourceAuthority": "mac_local_sqlite",
            "items": items,
            "count": len(items),
        }

    def pending_receipts(self, cutoff_date: str = "2026-09-16") -> dict[str, Any]:
        """Return Mac-local acquisitions that still need a physical receipt scan."""
        self.initialize()
        cutoff = str(cutoff_date or "2026-09-16").strip()
        with self._connect() as db:
            rows = db.execute(
                """
                SELECT
                    a.*,
                    r.inventory_item_id AS receipt_inventory_item_id,
                    r.scan_id AS receipt_scan_id,
                    r.status AS receipt_status,
                    r.disposition AS receipt_disposition,
                    r.inventory_state AS receipt_inventory_state,
                    r.match_confidence AS receipt_match_confidence,
                    r.matched_at AS receipt_matched_at,
                    r.received_at AS receipt_received_at,
                    r.receipt_mode AS receipt_mode,
                    r.linked_at AS receipt_linked_at
                FROM acquisition_items a
                LEFT JOIN physical_inventory_receipts r ON r.acquisition_item_id=a.id
                WHERE COALESCE(a.purchased_at, a.created_at) >= ?
                  AND a.status NOT IN ('sold','refunded','superseded','received','linked_existing')
                  AND (
                    r.id IS NULL
                    OR r.status NOT IN ('received','linked_existing')
                  )
                ORDER BY COALESCE(a.purchased_at, a.created_at) DESC, a.id DESC
                """,
                (cutoff,),
            ).fetchall()
        receipts = []
        pending_basis = 0.0
        unknown_basis_count = 0
        for row in rows:
            payload = self._purchase_row_payload(row)
            allocated = payload.get("allocatedCost")
            if isinstance(allocated, (int, float)):
                pending_basis += float(allocated)
            else:
                unknown_basis_count += 1
            status = str(row["receipt_status"] or row["status"] or "awaiting_scan")
            if not row["receipt_scan_id"]:
                status = "awaiting_scan_match"
            receipts.append({
                **payload,
                "status": status,
                "sourceAuthority": "mac_local_sqlite",
                "purchasedAt": row["purchased_at"],
                "createdAt": row["created_at"],
                "player": row["player"],
                "year": row["year"],
                "brand": row["brand"],
                "setName": row["set_name"],
                "cardNumber": row["card_number"],
                "isAuto": None if row["is_auto"] is None else bool(row["is_auto"]),
                "isRelic": None if row["is_relic"] is None else bool(row["is_relic"]),
                "inventoryItemId": row["receipt_inventory_item_id"],
                "scanId": row["receipt_scan_id"],
                "inventoryState": row["receipt_inventory_state"],
                "disposition": row["receipt_disposition"],
                "confidence": row["receipt_match_confidence"],
                "matchedAt": row["receipt_matched_at"],
                "receivedAt": row["receipt_received_at"],
                "receiptMode": row["receipt_mode"],
                "linkedAt": row["receipt_linked_at"],
            })
        return {
            "sourceAuthority": "mac_local_sqlite",
            "cutoffDate": cutoff,
            "receipts": receipts,
            "summary": {
                "pendingRows": len(receipts),
                "pendingKnownBasis": round(pending_basis, 2),
                "unknownBasisCount": unknown_basis_count,
            },
        }

    def listing_readiness(self, inventory_item_ids: list[str]) -> dict[str, Any]:
        self.initialize()
        ids = [str(value or "").strip() for value in inventory_item_ids if str(value or "").strip()]
        if not ids:
            return {"ready": True, "blocked": [], "tracked": []}
        placeholders = ",".join("?" for _ in ids)
        # Listing readiness is a read-only gate. A verified exact scan may reserve a
        # purchase, but only the explicit Receiving action is allowed to choose
        # resale vs investment_stash and advance that reservation to received.
        with self._connect() as db:
            rows = db.execute(
                f"SELECT inventory_item_id,scan_id,status,disposition,inventory_state,acquisition_item_id,receipt_mode FROM physical_inventory_receipts WHERE inventory_item_id IN ({placeholders})",
                ids,
            ).fetchall()
        tracked = []
        blocked = []
        found_ids = {str(row["inventory_item_id"]) for row in rows}
        for inventory_item_id in ids:
            if inventory_item_id not in found_ids:
                blocked.append({
                    "inventoryItemId": inventory_item_id,
                    "scanId": None,
                    "status": "untracked",
                    "disposition": None,
                    "inventoryState": "untracked",
                    "acquisitionItemId": None,
                    "receiptMode": None,
                    "reason": "physical_inventory_receipt_missing",
                })
        for row in rows:
            item = {
                "inventoryItemId": str(row["inventory_item_id"]),
                "scanId": str(row["scan_id"]),
                "status": str(row["status"]),
                "disposition": row["disposition"],
                "inventoryState": str(row["inventory_state"]),
                "acquisitionItemId": int(row["acquisition_item_id"]),
                "receiptMode": row["receipt_mode"],
            }
            tracked.append(item)
            if item["status"] not in {"received", "linked_existing"}:
                blocked.append({**item, "reason": "matched_purchase_not_received_or_linked"})
            elif item["disposition"] == "investment_stash" or item["inventoryState"] == "investment_stash":
                blocked.append({**item, "reason": "investment_stash_not_for_sale"})
        return {"ready": len(blocked) == 0, "blocked": blocked, "tracked": tracked}


    def record_raw_card_condition_review(
        self,
        inventory_item_id: str,
        scan_id: str,
        card_uuid: str,
        card_condition: str,
        reviewed_by: str,
        review_source: str = "operator_local_condition_station",
        notes: str | None = None,
    ) -> dict[str, Any]:
        """Persist a human-reviewed raw-card condition receipt bound to one scan pair."""
        self.initialize()
        inventory_item_id = str(inventory_item_id or "").strip()
        scan_id = str(scan_id or "").strip()
        card_uuid = str(card_uuid or "").strip()
        card_condition = str(card_condition or "").strip()
        reviewed_by = str(reviewed_by or "").strip()
        review_source = str(review_source or "").strip()
        allowed = {"Near Mint or Better", "Excellent", "Very Good", "Poor"}
        if card_condition not in allowed:
            raise ValueError("Raw card condition must be Near Mint or Better, Excellent, Very Good, or Poor")
        if not reviewed_by or reviewed_by.casefold() in {"ai", "model", "assistant", "chatgpt", "automation"}:
            raise ValueError("Raw card condition requires a human operator reviewer")
        if not review_source:
            raise ValueError("Condition review source is required")
        scan = self._verified_scan(scan_id, card_uuid)
        image_pair_sha256, image_pair_source = self._condition_image_pair(scan)
        now = _utc_now()
        with self._connect() as db:
            physical = db.execute(
                "SELECT * FROM physical_inventory_receipts WHERE inventory_item_id=? AND scan_id=?",
                (inventory_item_id, scan_id),
            ).fetchone()
            if not physical or str(physical["status"] or "") not in {"received", "linked_existing"}:
                raise ValueError("Condition review requires received or purchase-linked physical inventory")
            if str(physical["inventory_state"] or "") != "resale_ready":
                raise ValueError("Condition review is only valid for resale-ready inventory")
            bound_uuid = str(physical["card_uuid"] or "").strip()
            if card_uuid and bound_uuid and card_uuid != bound_uuid:
                raise ValueError("Condition review card UUID does not match physical inventory")
            payload = {
                "inventoryItemId": inventory_item_id,
                "scanId": scan_id,
                "cardUuid": card_uuid or bound_uuid or None,
                "imagePairSha256": image_pair_sha256,
                "imagePairSource": image_pair_source,
                "cardCondition": card_condition,
                "reviewedBy": reviewed_by,
                "reviewSource": review_source,
                "reviewedAt": now,
                "notes": str(notes or "").strip() or None,
            }
            db.execute(
                """
                INSERT INTO raw_card_condition_receipts(
                    inventory_item_id,scan_id,card_uuid,image_pair_sha256,card_condition,
                    reviewed_by,review_source,reviewed_at,notes,active,receipt_json
                ) VALUES(?,?,?,?,?,?,?,?,?,1,?)
                ON CONFLICT(inventory_item_id) DO UPDATE SET
                    scan_id=excluded.scan_id,card_uuid=excluded.card_uuid,
                    image_pair_sha256=excluded.image_pair_sha256,card_condition=excluded.card_condition,
                    reviewed_by=excluded.reviewed_by,review_source=excluded.review_source,
                    reviewed_at=excluded.reviewed_at,notes=excluded.notes,active=1,
                    receipt_json=excluded.receipt_json
                """,
                (inventory_item_id, scan_id, card_uuid or bound_uuid or None, image_pair_sha256,
                 card_condition, reviewed_by, review_source, now, payload["notes"],
                 json.dumps(payload, sort_keys=True, default=str)),
            )
        return {"status": "reviewed", **payload}

    def condition_review_readiness(self, inventory_item_ids: list[str]) -> dict[str, Any]:
        """Fail closed unless a human condition receipt matches the current physical scan pair."""
        self.initialize()
        ids = [str(value or "").strip() for value in inventory_item_ids if str(value or "").strip()]
        ready: list[dict[str, Any]] = []
        blocked: list[dict[str, Any]] = []
        with self._connect() as db:
            for inventory_item_id in ids:
                physical = db.execute(
                    "SELECT * FROM physical_inventory_receipts WHERE inventory_item_id=?",
                    (inventory_item_id,),
                ).fetchone()
                if not physical:
                    blocked.append({"inventoryItemId": inventory_item_id, "reason": "physical_inventory_receipt_missing"})
                    continue
                receipt = db.execute(
                    "SELECT * FROM raw_card_condition_receipts WHERE inventory_item_id=? AND active=1",
                    (inventory_item_id,),
                ).fetchone()
                if not receipt:
                    blocked.append({"inventoryItemId": inventory_item_id, "scanId": physical["scan_id"], "reason": "operator_condition_missing"})
                    continue
                try:
                    scan = self._verified_scan(str(physical["scan_id"]), str(physical["card_uuid"] or ""))
                    current_pair, current_pair_source = self._condition_image_pair(scan)
                except ValueError as exc:
                    blocked.append({"inventoryItemId": inventory_item_id, "scanId": physical["scan_id"], "reason": "condition_scan_unverifiable", "detail": str(exc)})
                    continue
                if str(receipt["scan_id"]) != str(physical["scan_id"]) or str(receipt["image_pair_sha256"]) != current_pair:
                    blocked.append({"inventoryItemId": inventory_item_id, "scanId": physical["scan_id"], "reason": "condition_receipt_stale"})
                    continue
                item = {
                    "inventoryItemId": inventory_item_id,
                    "scanId": str(receipt["scan_id"]),
                    "cardCondition": str(receipt["card_condition"]),
                    "reviewedBy": str(receipt["reviewed_by"]),
                    "reviewSource": str(receipt["review_source"]),
                    "reviewedAt": str(receipt["reviewed_at"]),
                    "imagePairSha256": str(receipt["image_pair_sha256"]),
                    "imagePairSource": current_pair_source,
                }
                ready.append(item)
        return {"ready": len(blocked) == 0, "readyCount": len(ready), "blockedCount": len(blocked), "reviewed": ready, "blocked": blocked}

    def set_inventory_disposition(self, inventory_item_id: str, disposition: str) -> dict[str, Any]:
        self.initialize()
        inventory_item_id=str(inventory_item_id or "").strip()
        destination=str(disposition or "").strip().lower()
        if destination not in {"resale", "investment_stash"}:
            raise ValueError("Inventory destination must be resale or investment_stash")
        with self._connect() as db:
            receipt=db.execute(
                "SELECT * FROM physical_inventory_receipts WHERE inventory_item_id=?",
                (inventory_item_id,),
            ).fetchone()
            if not receipt or str(receipt["status"]) not in {"received", "linked_existing"}:
                raise ValueError("Only received or purchase-linked scanned inventory can change destination")
            inventory_state = "investment_stash" if destination == "investment_stash" else "resale_ready"
            db.execute(
                "UPDATE physical_inventory_receipts SET disposition=?, inventory_state=? WHERE id=?",
                (destination, inventory_state, int(receipt["id"])),
            )
            purchase=db.execute("SELECT * FROM acquisition_items WHERE id=?", (int(receipt["acquisition_item_id"]),)).fetchone()
        return {
            "status":str(receipt["status"]),
            "inventoryState":inventory_state,
            "disposition":destination,
            "inventoryItemId":inventory_item_id,
            "scanId":str(receipt["scan_id"]),
            "receiptMode":receipt["receipt_mode"] if "receipt_mode" in receipt.keys() else None,
            "match":self._purchase_row_payload(purchase),
        }
