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
                ("seller", "TEXT"), ("order_number", "TEXT"),
                ("source_lot", "TEXT"), ("listing_url", "TEXT")
            ):
                if name not in columns:
                    db.execute(f"ALTER TABLE acquisition_items ADD COLUMN {name} {kind}")
            receipt_columns = {row[1] for row in db.execute("PRAGMA table_info(physical_inventory_receipts)")}
            for name, kind in (("receipt_mode", "TEXT"), ("linked_at", "TEXT")):
                if name not in receipt_columns:
                    db.execute(f"ALTER TABLE physical_inventory_receipts ADD COLUMN {name} {kind}")

    def record_acquisition_item(self, item: dict[str, Any]) -> None:
        self.initialize()
        identity = item.get("identity") or item
        values = (
            str(item.get("purchase_id") or "").strip(),
            str(item.get("source") or "Misc").strip(),
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
            float(item.get("allocated_cost") or 0),
            str(item.get("status") or "owned"),
            item.get("evidence"),
            _utc_now(),
        )
        if not values[0] or not values[5] or not values[9] or values[15] <= 0:
            raise ValueError("purchase_id, player, card_number, and positive allocated_cost are required")
        with self._connect() as db:
            db.execute(
                """
                INSERT OR REPLACE INTO acquisition_items (
                    purchase_id, source, purchased_at, title, card_uuid, player, year,
                    brand, set_name, card_number, parallel, serial_family, grading_company,
                    is_auto, is_relic, allocated_cost, status, evidence, created_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
                "SELECT * FROM acquisition_items WHERE player=? AND card_number=? AND allocated_cost>0",
                (player, card_number),
            ).fetchall()
        matches = [
            row
            for row in rows
            if self._compatible(identity, row) and self._set_compatible(identity, row)
        ]
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
        return {
            "acquisitionItemId": int(row["id"]),
            "purchaseId": str(row["purchase_id"]),
            "source": str(row["source"] or "Misc"),
            "purchaseDate": row["purchased_at"],
            "title": row["title"],
            "seller": row["seller"] if "seller" in row.keys() else None,
            "orderNumber": row["order_number"] if "order_number" in row.keys() else None,
            "sourceLot": row["source_lot"] if "source_lot" in row.keys() else None,
            "listingUrl": row["listing_url"] if "listing_url" in row.keys() else None,
            "allocatedCost": round(float(row["allocated_cost"]), 2),
            "serialFamily": row["serial_family"],
            "parallel": row["parallel"],
            "status": row["status"],
        }

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
            row = db.execute(
                "SELECT scan_id,card_uuid,created_at,front_sha256,back_sha256,image_pair_sha256,status FROM scans WHERE scan_id=?",
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
        expected_uuid = str(expected_card_uuid or "").strip()
        scan_uuid = str(row["card_uuid"] or "").strip()
        if expected_uuid and scan_uuid and scan_uuid != expected_uuid:
            raise ValueError("The InstaComp scan belongs to a different card UUID")
        return {
            "scanId": str(row["scan_id"]),
            "scanCardUuid": str(row["card_uuid"] or "") or None,
            "scannedAt": row["created_at"],
            "frontSha256": str(row["front_sha256"]),
            "backSha256": str(row["back_sha256"]),
            "imagePairSha256": str(row["image_pair_sha256"] or "") or None,
            "scanStatus": str(row["status"] or "") or None,
        }

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

        with self._connect() as db:
            existing = db.execute(
                "SELECT r.*, a.* FROM physical_inventory_receipts r JOIN acquisition_items a ON a.id=r.acquisition_item_id WHERE r.inventory_item_id=? OR r.scan_id=?",
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
                    "match": payload,
                }

            player = _norm(identity.get("player"))
            card_number = _norm(identity.get("cardNumber") or identity.get("card_number"))
            if not player or not card_number:
                return {"status": "no_match", "reason": "identity_incomplete", "match": None}
            rows = db.execute(
                "SELECT * FROM acquisition_items a WHERE a.player=? AND a.card_number=? AND a.status NOT IN ('sold','refunded') AND NOT EXISTS (SELECT 1 FROM physical_inventory_receipts r WHERE r.acquisition_item_id=a.id)",
                (player, card_number),
            ).fetchall()
            ranked=[]
            for row in rows:
                score,reasons=self._scan_match_score(identity,row)
                if score>0: ranked.append((score,reasons,row))
            ranked.sort(key=lambda item:(item[0], str(item[2]["purchased_at"] or "")), reverse=True)
            if not ranked:
                return {"status":"no_match","reason":"no_compatible_purchase","match":None}
            score,reasons,row=ranked[0]
            payload=self._purchase_row_payload(row)
            if score < 0.70:
                return {
                    "status":"no_match",
                    "inventoryItemId": inventory_item_id,
                    "scanId": scan["scanId"],
                    "confidence":round(score,3),
                    "reason":"candidate_below_review_threshold:" + ",".join(reasons),
                    "match":None,
                }
            if score < 0.85:
                return {
                    "status":"possible_match",
                    "inventoryItemId": inventory_item_id,
                    "scanId": scan["scanId"],
                    "confidence":round(score,3),
                    "reason":",".join(reasons),
                    "match":payload,
                }
            reason=",".join(reasons)
            now=_utc_now()
            snapshot=json.dumps({"identity":identity,"purchase":payload}, sort_keys=True, default=str)
            scan_snapshot=json.dumps(scan, sort_keys=True, default=str)
            db.execute(
                "INSERT INTO physical_inventory_receipts(inventory_item_id,scan_id,card_uuid,acquisition_item_id,status,disposition,inventory_state,match_confidence,match_reason,matched_at,scan_verified_at,scan_snapshot_json,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (inventory_item_id, scan["scanId"], card_uuid or None, int(row["id"]), "pending_purchase", None, "pending_purchase", round(score,3), reason, now, now, scan_snapshot, snapshot),
            )
            db.execute("UPDATE acquisition_items SET status='pending_purchase' WHERE id=?", (int(row["id"]),))
            return {
                "status":"pending_purchase",
                "inventoryState":"pending_purchase",
                "inventoryItemId": inventory_item_id,
                "scanId": scan["scanId"],
                "confidence":round(score,3),
                "reason":reason,
                "match":payload,
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
                return {"status":"linked_existing","inventoryState":str(receipt["inventory_state"]),"disposition":current_destination or destination,"inventoryItemId":inventory_item_id,"scanId":scan["scanId"],"linkedAt":receipt["linked_at"],"receiptMode":"linked_existing","match":self._purchase_row_payload(row)}
            if receipt_status != "pending_purchase":
                raise ValueError("Only a pending purchase reservation can be linked to existing inventory")
            inventory_state = "investment_stash" if destination == "investment_stash" else "resale_ready"
            db.execute(
                "UPDATE physical_inventory_receipts SET status='linked_existing', disposition=?, inventory_state=?, receipt_mode='linked_existing', linked_at=?, received_at=NULL WHERE id=?",
                (destination, inventory_state, now, int(receipt["id"])),
            )
            db.execute("UPDATE acquisition_items SET status='linked_existing' WHERE id=?", (int(acquisition_item_id),))
            row = db.execute("SELECT * FROM acquisition_items WHERE id=?", (int(acquisition_item_id),)).fetchone()
        return {"status":"linked_existing","inventoryState":inventory_state,"disposition":destination,"inventoryItemId":inventory_item_id,"scanId":scan["scanId"],"linkedAt":now,"receiptMode":"linked_existing","match":self._purchase_row_payload(row)}

    def listing_readiness(self, inventory_item_ids: list[str]) -> dict[str, Any]:
        self.initialize()
        ids = [str(value or "").strip() for value in inventory_item_ids if str(value or "").strip()]
        if not ids:
            return {"ready": True, "blocked": [], "tracked": []}
        placeholders = ",".join("?" for _ in ids)
        with self._connect() as db:
            rows = db.execute(
                f"SELECT inventory_item_id,scan_id,status,disposition,inventory_state,acquisition_item_id,receipt_mode FROM physical_inventory_receipts WHERE inventory_item_id IN ({placeholders})",
                ids,
            ).fetchall()
        tracked = []
        blocked = []
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
