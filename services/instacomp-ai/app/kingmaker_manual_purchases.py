from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


FINAL_ACQUISITION_STATUSES = {"received", "linked_existing", "sold", "refunded"}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm(value: Any) -> str:
    text = str(value or "").casefold().strip()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def _norm_parallel(value: Any) -> str:
    raw = str(value or "").casefold().strip()
    raw = re.sub(r"\b\d+\s*/\s*\d+\b", " ", raw)
    raw = re.sub(r"/\s*\d+\b", " ", raw)
    text = _norm(raw)
    text = re.sub(r"\b(prizms?|parallel|set|base set)\b", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _serial_family(value: Any) -> str:
    match = re.search(r"/(\d{1,6})\b", str(value or ""))
    return f"/{match.group(1)}" if match else ""


def _round_money(value: Any) -> float:
    return round(float(value or 0) + 1e-9, 2)


def _safe_filename(value: str) -> str:
    stem = Path(value or "evidence").name
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._")
    return stem[:120] or "evidence"


class KingmakerManualPurchases:
    """Auditable Mac-local manual purchase intake for single cards and lots."""

    def __init__(self, database_path: Path, scan_database_path: Path | None = None):
        self.path = database_path
        self.scan_database_path = scan_database_path
        self.evidence_root = database_path.parent / "purchase-evidence"

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
        self.evidence_root.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS manual_purchase_lots (
                    id TEXT PRIMARY KEY,
                    mode TEXT NOT NULL,
                    source TEXT NOT NULL,
                    purchased_at TEXT,
                    seller TEXT,
                    order_number TEXT,
                    reference_text TEXT,
                    total_cost REAL NOT NULL,
                    notes TEXT,
                    status TEXT NOT NULL DEFAULT 'draft',
                    verification_status TEXT NOT NULL DEFAULT 'draft',
                    allocation_method TEXT,
                    evidence_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    confirmed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS manual_purchase_cards (
                    id TEXT PRIMARY KEY,
                    lot_id TEXT NOT NULL,
                    sequence_no INTEGER NOT NULL,
                    title TEXT,
                    identity_json TEXT NOT NULL DEFAULT '{}',
                    card_uuid TEXT,
                    scan_id TEXT,
                    inventory_item_id TEXT,
                    requested_allocated_cost REAL,
                    individual_cost_exact INTEGER NOT NULL DEFAULT 0,
                    active INTEGER NOT NULL DEFAULT 1,
                    acquisition_item_id INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(lot_id) REFERENCES manual_purchase_lots(id)
                );
                CREATE INDEX IF NOT EXISTS manual_purchase_cards_lot_idx
                    ON manual_purchase_cards(lot_id, active, sequence_no);
                CREATE TABLE IF NOT EXISTS manual_purchase_evidence (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lot_id TEXT NOT NULL,
                    draft_card_id TEXT,
                    evidence_kind TEXT NOT NULL,
                    original_filename TEXT NOT NULL,
                    stored_path TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    mime_type TEXT,
                    size_bytes INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS manual_purchase_evidence_unique_idx
                    ON manual_purchase_evidence(lot_id, COALESCE(draft_card_id,''), evidence_kind, sha256);
                CREATE TABLE IF NOT EXISTS manual_purchase_audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lot_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    event_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS manual_purchase_audit_idx
                    ON manual_purchase_audit_log(lot_id, created_at);
                CREATE TABLE IF NOT EXISTS purchase_learning_facts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lot_id TEXT NOT NULL,
                    acquisition_item_id INTEGER,
                    fact_type TEXT NOT NULL,
                    identity_json TEXT,
                    lot_total_cost REAL NOT NULL,
                    allocated_cost REAL,
                    individual_cost_verified INTEGER NOT NULL DEFAULT 0,
                    evidence_sha256s_json TEXT NOT NULL DEFAULT '[]',
                    verification_status TEXT NOT NULL,
                    training_eligible INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    superseded_at TEXT
                );
                CREATE INDEX IF NOT EXISTS purchase_learning_active_idx
                    ON purchase_learning_facts(lot_id, training_eligible, superseded_at);
                """
            )
            columns = {row[1] for row in db.execute("PRAGMA table_info(acquisition_items)")}
            for name, kind in (
                ("purchase_lot_id", "TEXT"),
                ("allocation_method", "TEXT"),
                ("individual_cost_verified", "INTEGER NOT NULL DEFAULT 0"),
                ("manual_entry", "INTEGER NOT NULL DEFAULT 0"),
                ("verification_status", "TEXT"),
                ("training_eligible", "INTEGER NOT NULL DEFAULT 0"),
                ("manual_notes", "TEXT"),
            ):
                if name not in columns:
                    db.execute(f"ALTER TABLE acquisition_items ADD COLUMN {name} {kind}")
            db.execute(
                "CREATE INDEX IF NOT EXISTS acquisition_manual_lot_idx "
                "ON acquisition_items(purchase_lot_id, manual_entry)"
            )

    def _audit(self, db: sqlite3.Connection, lot_id: str, event_type: str, actor: str, payload: Any) -> None:
        db.execute(
            "INSERT INTO manual_purchase_audit_log(lot_id,event_type,actor,event_json,created_at) VALUES(?,?,?,?,?)",
            (lot_id, event_type, actor or "seller", json.dumps(payload, sort_keys=True, default=str), _utc_now()),
        )

    def _scan_identity(self, scan_id: str) -> tuple[str | None, dict[str, Any]]:
        scan_id = str(scan_id or "").strip()
        if not scan_id or not self.scan_database_path:
            return None, {}
        db = sqlite3.connect(self.scan_database_path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            columns = {row[1] for row in db.execute("PRAGMA table_info(scans)")}
            wanted = [name for name in ("card_uuid", "checklist_json", "local_suggestion_json", "local_vision_json") if name in columns]
            if "card_uuid" not in wanted:
                return None, {}
            row = db.execute(
                f"SELECT {','.join(wanted)} FROM scans WHERE scan_id=?",
                (scan_id,),
            ).fetchone()
        finally:
            db.close()
        if not row:
            raise ValueError("The selected InstaComp scan was not found on the Mac")
        identity: dict[str, Any] = {}
        for column in ("checklist_json", "local_suggestion_json", "local_vision_json"):
            if column not in row.keys() or not row[column]:
                continue
            try:
                payload = json.loads(str(row[column]))
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            candidates = []
            if isinstance(payload, dict):
                candidates.extend([
                    payload.get("identity"),
                    payload.get("suggestion"),
                    payload.get("card_identity"),
                ])
                result = payload.get("result")
                if isinstance(result, dict):
                    candidates.append(result.get("identity"))
            for candidate in candidates:
                if isinstance(candidate, dict) and (candidate.get("player") or candidate.get("cardNumber") or candidate.get("card_number")):
                    identity = candidate
                    break
            if identity:
                break
        return str(row["card_uuid"] or "").strip() or None, identity

    def _lot_payload(self, db: sqlite3.Connection, lot_id: str) -> dict[str, Any]:
        lot = db.execute("SELECT * FROM manual_purchase_lots WHERE id=?", (lot_id,)).fetchone()
        if not lot:
            raise ValueError("Manual purchase lot was not found")
        cards = db.execute(
            "SELECT * FROM manual_purchase_cards WHERE lot_id=? AND active=1 ORDER BY sequence_no,id",
            (lot_id,),
        ).fetchall()
        evidence = db.execute(
            "SELECT id,draft_card_id,evidence_kind,original_filename,sha256,mime_type,size_bytes,created_at "
            "FROM manual_purchase_evidence WHERE lot_id=? ORDER BY id",
            (lot_id,),
        ).fetchall()
        def card_payload(row: sqlite3.Row) -> dict[str, Any]:
            try:
                identity = json.loads(str(row["identity_json"] or "{}"))
            except json.JSONDecodeError:
                identity = {}
            return {
                "id": row["id"],
                "title": row["title"],
                "identity": identity if isinstance(identity, dict) else {},
                "cardUuid": row["card_uuid"],
                "scanId": row["scan_id"],
                "inventoryItemId": row["inventory_item_id"],
                "requestedAllocatedCost": row["requested_allocated_cost"],
                "individualCostExact": bool(row["individual_cost_exact"]),
                "acquisitionItemId": row["acquisition_item_id"],
            }
        return {
            "id": lot["id"],
            "mode": lot["mode"],
            "source": lot["source"],
            "purchaseDate": lot["purchased_at"],
            "seller": lot["seller"],
            "orderNumber": lot["order_number"],
            "referenceText": lot["reference_text"],
            "totalCost": round(float(lot["total_cost"]), 2),
            "notes": lot["notes"],
            "status": lot["status"],
            "verificationStatus": lot["verification_status"],
            "allocationMethod": lot["allocation_method"],
            "evidenceCount": int(lot["evidence_count"] or 0),
            "createdAt": lot["created_at"],
            "updatedAt": lot["updated_at"],
            "confirmedAt": lot["confirmed_at"],
            "cards": [card_payload(row) for row in cards],
            "evidence": [dict(row) for row in evidence],
        }

    def upsert_draft(self, payload: dict[str, Any], actor: str = "seller") -> dict[str, Any]:
        self.initialize()
        mode = str(payload.get("mode") or "single").strip().lower()
        if mode not in {"single", "lot"}:
            raise ValueError("mode must be single or lot")
        total_cost = _round_money(payload.get("total_cost"))
        if total_cost <= 0:
            raise ValueError("Total purchase price must be greater than zero")
        cards = payload.get("cards") if isinstance(payload.get("cards"), list) else []
        if not cards:
            raise ValueError("Add at least one card to this purchase")
        if mode == "single" and len(cards) != 1:
            raise ValueError("Single-card purchase must contain exactly one card")
        if len(cards) > 250:
            raise ValueError("A manual lot can contain at most 250 cards")
        lot_id = str(payload.get("lot_id") or uuid4()).strip()
        source = str(payload.get("source") or "Misc").strip() or "Misc"
        now = _utc_now()
        with self._connect() as db:
            existing = db.execute("SELECT * FROM manual_purchase_lots WHERE id=?", (lot_id,)).fetchone()
            before = self._lot_payload(db, lot_id) if existing else None
            status = "needs_reconfirm" if existing and str(existing["status"]) == "confirmed" else "draft"
            verification = "modified_after_confirmation" if status == "needs_reconfirm" else "draft"
            if existing:
                db.execute(
                    "UPDATE manual_purchase_lots SET mode=?,source=?,purchased_at=?,seller=?,order_number=?,reference_text=?,"
                    "total_cost=?,notes=?,status=?,verification_status=?,allocation_method=NULL,confirmed_at=NULL,updated_at=? WHERE id=?",
                    (
                        mode, source, payload.get("purchased_at"), payload.get("seller"), payload.get("order_number"),
                        payload.get("reference_text"), total_cost, payload.get("notes"), status, verification, now, lot_id,
                    ),
                )
                db.execute("UPDATE manual_purchase_cards SET active=0,updated_at=? WHERE lot_id=?", (now, lot_id))
                db.execute(
                    "UPDATE purchase_learning_facts SET superseded_at=? WHERE lot_id=? AND superseded_at IS NULL",
                    (now, lot_id),
                )
            else:
                db.execute(
                    "INSERT INTO manual_purchase_lots(id,mode,source,purchased_at,seller,order_number,reference_text,total_cost,notes,"
                    "status,verification_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        lot_id, mode, source, payload.get("purchased_at"), payload.get("seller"), payload.get("order_number"),
                        payload.get("reference_text"), total_cost, payload.get("notes"), status, verification, now, now,
                    ),
                )
            for index, raw in enumerate(cards):
                card = raw if isinstance(raw, dict) else {}
                card_id = str(card.get("id") or uuid4()).strip()
                scan_id = str(card.get("scan_id") or card.get("scanId") or "").strip() or None
                card_uuid = str(card.get("card_uuid") or card.get("cardUuid") or "").strip() or None
                identity = card.get("identity") if isinstance(card.get("identity"), dict) else {}
                if scan_id:
                    scan_uuid, scan_identity = self._scan_identity(scan_id)
                    card_uuid = card_uuid or scan_uuid
                    if not identity and scan_identity:
                        identity = scan_identity
                existing_card = db.execute(
                    "SELECT id FROM manual_purchase_cards WHERE id=? AND lot_id=?",
                    (card_id, lot_id),
                ).fetchone()
                values = (
                    index + 1,
                    str(card.get("title") or "").strip() or None,
                    json.dumps(identity, sort_keys=True, default=str),
                    card_uuid,
                    scan_id,
                    str(card.get("inventory_item_id") or card.get("inventoryItemId") or "").strip() or None,
                    _round_money(card.get("allocated_cost") or card.get("allocatedCost")) or None,
                    1 if bool(card.get("individual_cost_exact") or card.get("individualCostExact")) else 0,
                    now,
                )
                if existing_card:
                    db.execute(
                        "UPDATE manual_purchase_cards SET sequence_no=?,title=?,identity_json=?,card_uuid=?,scan_id=?,inventory_item_id=?,"
                        "requested_allocated_cost=?,individual_cost_exact=?,active=1,updated_at=? WHERE id=?",
                        (*values, card_id),
                    )
                else:
                    db.execute(
                        "INSERT INTO manual_purchase_cards(id,lot_id,sequence_no,title,identity_json,card_uuid,scan_id,inventory_item_id,"
                        "requested_allocated_cost,individual_cost_exact,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)",
                        (card_id, lot_id, *values[:-1], now, now),
                    )
            self._audit(db, lot_id, "draft_updated" if existing else "draft_created", actor, {"before": before, "request": payload})
            return self._lot_payload(db, lot_id)

    def store_evidence(
        self,
        lot_id: str,
        content: bytes,
        filename: str,
        mime_type: str | None,
        evidence_kind: str,
        draft_card_id: str | None = None,
        actor: str = "seller",
    ) -> dict[str, Any]:
        self.initialize()
        lot_id = str(lot_id or "").strip()
        if not lot_id:
            raise ValueError("lot_id is required")
        if not content:
            raise ValueError("Evidence file is empty")
        if len(content) > 25 * 1024 * 1024:
            raise ValueError("Each evidence file must be 25 MB or smaller")
        kind = str(evidence_kind or "receipt").strip().lower()
        if kind not in {"receipt", "listing_screenshot", "card_photo", "invoice", "other"}:
            raise ValueError("Unsupported evidence kind")
        digest = hashlib.sha256(content).hexdigest()
        safe = _safe_filename(filename)
        target_dir = self.evidence_root / lot_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{digest[:16]}-{safe}"
        if not target.exists():
            target.write_bytes(content)
        now = _utc_now()
        with self._connect() as db:
            if not db.execute("SELECT 1 FROM manual_purchase_lots WHERE id=?", (lot_id,)).fetchone():
                raise ValueError("Manual purchase lot was not found")
            if draft_card_id and not db.execute(
                "SELECT 1 FROM manual_purchase_cards WHERE id=? AND lot_id=?",
                (draft_card_id, lot_id),
            ).fetchone():
                raise ValueError("The selected card does not belong to this lot")
            db.execute(
                "INSERT OR IGNORE INTO manual_purchase_evidence(lot_id,draft_card_id,evidence_kind,original_filename,stored_path,sha256,mime_type,size_bytes,created_at) "
                "VALUES(?,?,?,?,?,?,?,?,?)",
                (lot_id, draft_card_id, kind, safe, str(target), digest, mime_type, len(content), now),
            )
            count = int(db.execute("SELECT COUNT(*) FROM manual_purchase_evidence WHERE lot_id=?", (lot_id,)).fetchone()[0])
            db.execute("UPDATE manual_purchase_lots SET evidence_count=?,updated_at=? WHERE id=?", (count, now, lot_id))
            self._audit(db, lot_id, "evidence_added", actor, {"draftCardId": draft_card_id, "kind": kind, "sha256": digest, "filename": safe, "size": len(content)})
        return {
            "lotId": lot_id,
            "draftCardId": draft_card_id,
            "kind": kind,
            "filename": safe,
            "sha256": digest,
            "sizeBytes": len(content),
            "evidenceCount": count,
        }

    @staticmethod
    def _allocations(cards: list[sqlite3.Row], total_cost: float, method: str) -> list[tuple[float, bool, str]]:
        if len(cards) == 1:
            return [(total_cost, True, "single_card_exact")]
        if method == "manual":
            requested = [_round_money(row["requested_allocated_cost"]) for row in cards]
            if any(value <= 0 for value in requested):
                raise ValueError("Every card needs a positive allocation for manual lot allocation")
            if abs(sum(requested) - total_cost) > 0.009:
                raise ValueError("Manual card allocations must add up exactly to the lot purchase price")
            return [
                (requested[index], bool(row["individual_cost_exact"]), "manual_card_allocation")
                for index, row in enumerate(cards)
            ]
        cents = int(round(total_cost * 100))
        base, remainder = divmod(cents, len(cards))
        output = []
        for index in range(len(cards)):
            allocated = (base + (1 if index < remainder else 0)) / 100.0
            output.append((allocated, False, "lot_equal_split"))
        return output

    def confirm_lot(self, lot_id: str, allocation_method: str = "equal_split", actor: str = "seller") -> dict[str, Any]:
        self.initialize()
        method = str(allocation_method or "equal_split").strip().lower()
        if method not in {"equal_split", "manual"}:
            raise ValueError("allocation_method must be equal_split or manual")
        now = _utc_now()
        with self._connect() as db:
            lot = db.execute("SELECT * FROM manual_purchase_lots WHERE id=?", (lot_id,)).fetchone()
            if not lot:
                raise ValueError("Manual purchase lot was not found")
            cards = db.execute(
                "SELECT * FROM manual_purchase_cards WHERE lot_id=? AND active=1 ORDER BY sequence_no,id",
                (lot_id,),
            ).fetchall()
            if not cards:
                raise ValueError("Add at least one card before confirming this purchase")
            evidence = db.execute(
                "SELECT sha256,draft_card_id,evidence_kind FROM manual_purchase_evidence WHERE lot_id=? ORDER BY id",
                (lot_id,),
            ).fetchall()
            evidence_hashes = [str(row["sha256"]) for row in evidence]
            verification_status = "user_verified_with_evidence" if evidence_hashes else "user_confirmed_no_evidence"
            allocations = self._allocations(cards, round(float(lot["total_cost"]), 2), method)
            db.execute(
                "UPDATE purchase_learning_facts SET superseded_at=? WHERE lot_id=? AND superseded_at IS NULL",
                (now, lot_id),
            )
            acquisition_results: list[dict[str, Any]] = []
            purchase_id = str(lot["order_number"] or lot["reference_text"] or f"MANUAL-{lot_id[:8]}").strip()
            for card, (allocated_cost, exact_cost, allocation_label) in zip(cards, allocations):
                try:
                    identity = json.loads(str(card["identity_json"] or "{}"))
                except json.JSONDecodeError:
                    identity = {}
                if not isinstance(identity, dict):
                    identity = {}
                player = _norm(identity.get("player"))
                card_number = _norm(identity.get("cardNumber") or identity.get("card_number"))
                if not player or not card_number:
                    raise ValueError(
                        f"Card {card['sequence_no']} needs player and card number, or a verified InstaComp scan with that identity, before confirmation"
                    )
                source_key = f"manual:{lot_id}:{card['id']}"
                linked_receipt = None
                if str(card["inventory_item_id"] or "").strip():
                    linked_receipt = db.execute(
                        "SELECT acquisition_item_id,status FROM physical_inventory_receipts WHERE inventory_item_id=?",
                        (str(card["inventory_item_id"]).strip(),),
                    ).fetchone()
                elif str(card["scan_id"] or "").strip():
                    linked_receipt = db.execute(
                        "SELECT acquisition_item_id,status FROM physical_inventory_receipts WHERE scan_id=?",
                        (str(card["scan_id"]).strip(),),
                    ).fetchone()
                existing = (
                    db.execute(
                        "SELECT * FROM acquisition_items WHERE id=?",
                        (int(linked_receipt["acquisition_item_id"]),),
                    ).fetchone()
                    if linked_receipt
                    else db.execute(
                        "SELECT * FROM acquisition_items WHERE source_key=?",
                        (source_key,),
                    ).fetchone()
                )
                training_eligible = bool(evidence_hashes) and bool(exact_cost)
                values = {
                    "purchase_id": purchase_id,
                    "source": str(lot["source"] or "Misc"),
                    "purchased_at": lot["purchased_at"],
                    "title": card["title"] or f"{identity.get('player') or 'Card'} #{identity.get('cardNumber') or identity.get('card_number') or ''}".strip(),
                    "card_uuid": card["card_uuid"],
                    "player": player,
                    "year": str(identity.get("year") or "").strip() or None,
                    "brand": _norm(identity.get("brand") or identity.get("manufacturer")) or None,
                    "set_name": _norm(identity.get("setName") or identity.get("set_name") or identity.get("product")) or None,
                    "card_number": card_number,
                    "parallel": _norm_parallel(identity.get("parallel")) or None,
                    "serial_family": _serial_family(identity.get("serialNumber") or identity.get("serial_number") or (f"/{identity.get('serialRun')}" if identity.get("serialRun") else "")) or None,
                    "grading_company": _norm(identity.get("gradingCompany") or identity.get("grading_company")) or None,
                    "is_auto": None if identity.get("isAuto") is None and identity.get("autograph") is None else int(bool(identity.get("isAuto") if identity.get("isAuto") is not None else identity.get("autograph"))),
                    "is_relic": None if identity.get("isRelic") is None and identity.get("memorabilia") is None else int(bool(identity.get("isRelic") if identity.get("isRelic") is not None else identity.get("memorabilia"))),
                    "allocated_cost": allocated_cost,
                    "cost_status": "known",
                    "status": "awaiting_scan",
                    "evidence": json.dumps({"lotId": lot_id, "evidenceSha256": evidence_hashes}, sort_keys=True),
                    "seller": lot["seller"],
                    "order_number": lot["order_number"] or purchase_id,
                    "source_lot": lot_id,
                    "listing_url": lot["reference_text"],
                    "source_key": source_key,
                    "source_item_id": card["id"],
                    "registry_identity_id": identity.get("registryIdentityId") or identity.get("registry_identity_id"),
                    "variation": _norm(identity.get("variation")) or None,
                    "condition_type": _norm(identity.get("conditionType") or identity.get("condition_type")) or None,
                    "grade": _norm(identity.get("grade") or identity.get("gradeValue") or identity.get("grade_value")) or None,
                    "identity_status": "manual_verified_identity" if card["scan_id"] else "manual_identity_needs_scan_verification",
                    "image_urls_json": "[]",
                    "last_synced_at": now,
                    "purchase_lot_id": lot_id,
                    "allocation_method": allocation_label,
                    "individual_cost_verified": 1 if exact_cost else 0,
                    "manual_entry": 1,
                    "verification_status": verification_status,
                    "training_eligible": 1 if training_eligible else 0,
                    "manual_notes": lot["notes"],
                }
                if existing:
                    current_status = str(existing["status"] or "")
                    if current_status in FINAL_ACQUISITION_STATUSES or current_status == "pending_purchase":
                        values["status"] = current_status
                    if linked_receipt:
                        # Keep the marketplace sync key bound to the same physical
                        # acquisition row. The user's verified manual facts become
                        # the protected accounting truth on that row.
                        values["source_key"] = existing["source_key"] or source_key
                        values["source_item_id"] = existing["source_item_id"] or card["id"]
                    assignments = ",".join(f"{key}=?" for key in values)
                    db.execute(
                        f"UPDATE acquisition_items SET {assignments} WHERE id=?",
                        (*values.values(), int(existing["id"])),
                    )
                    acquisition_id = int(existing["id"])
                else:
                    insert_values = {**values, "created_at": now}
                    columns = ",".join(insert_values)
                    placeholders = ",".join("?" for _ in insert_values)
                    cursor = db.execute(
                        f"INSERT INTO acquisition_items ({columns}) VALUES ({placeholders})",
                        tuple(insert_values.values()),
                    )
                    acquisition_id = int(cursor.lastrowid)
                db.execute(
                    "UPDATE manual_purchase_cards SET acquisition_item_id=?,updated_at=? WHERE id=?",
                    (acquisition_id, now, card["id"]),
                )
                db.execute(
                    "INSERT INTO purchase_learning_facts(lot_id,acquisition_item_id,fact_type,identity_json,lot_total_cost,allocated_cost,"
                    "individual_cost_verified,evidence_sha256s_json,verification_status,training_eligible,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        lot_id, acquisition_id, "card_acquisition", json.dumps(identity, sort_keys=True, default=str),
                        float(lot["total_cost"]), allocated_cost, 1 if exact_cost else 0,
                        json.dumps(evidence_hashes), verification_status, 1 if training_eligible else 0, now,
                    ),
                )
                acquisition_results.append({
                    "draftCardId": card["id"],
                    "acquisitionItemId": acquisition_id,
                    "allocatedCost": allocated_cost,
                    "individualCostVerified": bool(exact_cost),
                    "trainingEligible": training_eligible,
                    "allocationMethod": allocation_label,
                    "inventoryItemId": card["inventory_item_id"],
                    "scanId": card["scan_id"],
                    "cardUuid": card["card_uuid"],
                    "identity": identity,
                    "alreadyLinked": bool(linked_receipt),
                })
            db.execute(
                "INSERT INTO purchase_learning_facts(lot_id,acquisition_item_id,fact_type,identity_json,lot_total_cost,allocated_cost,"
                "individual_cost_verified,evidence_sha256s_json,verification_status,training_eligible,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (
                    lot_id, None, "lot_total", None, float(lot["total_cost"]), None, 0,
                    json.dumps(evidence_hashes), verification_status, 1 if evidence_hashes else 0, now,
                ),
            )
            db.execute(
                "UPDATE manual_purchase_lots SET status='confirmed',verification_status=?,allocation_method=?,confirmed_at=?,updated_at=? WHERE id=?",
                (verification_status, method, now, now, lot_id),
            )
            self._audit(
                db, lot_id, "purchase_confirmed", actor,
                {"allocationMethod": method, "verificationStatus": verification_status, "evidenceSha256": evidence_hashes, "cards": acquisition_results},
            )
            lot_payload = self._lot_payload(db, lot_id)
        return {
            "lot": lot_payload,
            "acquisitions": acquisition_results,
            "learningFactsCreated": len(acquisition_results) + 1,
            "lotTotalTrainingEligible": bool(evidence_hashes),
        }
