from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import json
import sqlite3


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class KingmakerCommercialInventory:
    """Mac-local commercial listing catalog.

    eBay is a channel feed; this SQLite catalog is the KINGMAKER working authority.
    Remote snapshots refresh clean rows but never overwrite unsaved local edits.
    """

    def __init__(self, path: Path):
        self.path = path

    def _connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def initialize(self) -> None:
        with self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS commercial_inventory (
                    inventory_item_id TEXT PRIMARY KEY,
                    sku TEXT NOT NULL,
                    ebay_listing_id TEXT NOT NULL UNIQUE,
                    ebay_offer_id TEXT,
                    title TEXT NOT NULL,
                    description TEXT,
                    player TEXT,
                    sport TEXT,
                    category TEXT,
                    condition TEXT,
                    status TEXT NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 0,
                    price REAL NOT NULL DEFAULT 0,
                    image_url TEXT,
                    local_dirty INTEGER NOT NULL DEFAULT 0,
                    last_ebay_sync_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    raw_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE UNIQUE INDEX IF NOT EXISTS commercial_inventory_sku_idx
                  ON commercial_inventory(sku);
                CREATE INDEX IF NOT EXISTS commercial_inventory_status_idx
                  ON commercial_inventory(status);
                """
            )

    def absorb_ebay_snapshot(self, listings: list[dict[str, Any]], synced_at: str | None = None) -> dict[str, int]:
        self.initialize()
        stamp = str(synced_at or _now())
        inserted = updated = 0
        with self._connect() as db:
            for item in listings:
                listing_id = str(item.get("ebayItemId") or "").strip()
                sku = str(item.get("sku") or "").strip()
                inventory_item_id = str(item.get("inventoryItemId") or f"ebay:{listing_id}").strip()
                if not listing_id or not sku or not inventory_item_id:
                    continue
                existing = db.execute(
                    "SELECT inventory_item_id,local_dirty FROM commercial_inventory WHERE ebay_listing_id=? OR sku=?",
                    (listing_id, sku),
                ).fetchone()
                payload = {
                    "inventory_item_id": inventory_item_id,
                    "sku": sku,
                    "ebay_listing_id": listing_id,
                    "ebay_offer_id": str(item.get("offerId") or "").strip() or None,
                    "title": str(item.get("title") or sku).strip() or sku,
                    "description": str(item.get("description") or ""),
                    "player": str(item.get("player") or "").strip() or None,
                    "sport": str(item.get("sport") or "").strip() or None,
                    "category": str(item.get("category") or "other_collectable"),
                    "condition": str(item.get("condition") or "unknown"),
                    "status": str(item.get("status") or "draft"),
                    "quantity": max(0, int(float(item.get("quantity") or 0))),
                    "price": max(0.0, round(float(item.get("price") or 0), 2)),
                    "image_url": str(item.get("imageUrl") or "").strip() or None,
                    "raw_json": json.dumps(item, separators=(",", ":"), ensure_ascii=False),
                }
                if existing is None:
                    db.execute(
                        """INSERT INTO commercial_inventory(
                          inventory_item_id,sku,ebay_listing_id,ebay_offer_id,title,description,player,sport,
                          category,condition,status,quantity,price,image_url,local_dirty,last_ebay_sync_at,
                          created_at,updated_at,raw_json
                        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (
                            payload["inventory_item_id"], payload["sku"], payload["ebay_listing_id"],
                            payload["ebay_offer_id"], payload["title"], payload["description"], payload["player"],
                            payload["sport"], payload["category"], payload["condition"], payload["status"],
                            payload["quantity"], payload["price"], payload["image_url"], 0, stamp, stamp, stamp,
                            payload["raw_json"],
                        ),
                    )
                    inserted += 1
                    continue
                if int(existing["local_dirty"] or 0):
                    db.execute(
                        """UPDATE commercial_inventory SET ebay_offer_id=?, last_ebay_sync_at=?, raw_json=?
                           WHERE inventory_item_id=?""",
                        (payload["ebay_offer_id"], stamp, payload["raw_json"], existing["inventory_item_id"]),
                    )
                else:
                    db.execute(
                        """UPDATE commercial_inventory SET sku=?,ebay_listing_id=?,ebay_offer_id=?,title=?,description=?,
                           player=?,sport=?,category=?,condition=?,status=?,quantity=?,price=?,image_url=?,
                           last_ebay_sync_at=?,updated_at=?,raw_json=? WHERE inventory_item_id=?""",
                        (
                            payload["sku"], payload["ebay_listing_id"], payload["ebay_offer_id"], payload["title"],
                            payload["description"], payload["player"], payload["sport"], payload["category"],
                            payload["condition"], payload["status"], payload["quantity"], payload["price"],
                            payload["image_url"], stamp, stamp, payload["raw_json"], existing["inventory_item_id"],
                        ),
                    )
                updated += 1
            db.execute(
                """UPDATE commercial_inventory SET status='archived', quantity=0, updated_at=?
                   WHERE local_dirty=0 AND (last_ebay_sync_at IS NULL OR last_ebay_sync_at<>?)""",
                (stamp, stamp),
            )
        return {"inserted": inserted, "updated": updated}

    def list_items(self) -> list[dict[str, Any]]:
        self.initialize()
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM commercial_inventory ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC"
            ).fetchall()
        return [self._payload(row) for row in rows]

    def get_item(self, inventory_item_id: str) -> dict[str, Any] | None:
        self.initialize()
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM commercial_inventory WHERE inventory_item_id=?",
                (str(inventory_item_id),),
            ).fetchone()
        return self._payload(row) if row else None

    def apply_local_edit(self, inventory_item_id: str, edit: dict[str, Any], synced_to_ebay: bool) -> dict[str, Any]:
        current = self.get_item(inventory_item_id)
        if current is None:
            raise ValueError("Mac-local commercial inventory item was not found")
        title = str(edit.get("title", current["title"]) or "").strip()[:200]
        if not title:
            raise ValueError("Title is required")
        description = str(edit.get("description", current.get("description") or ""))[:100000]
        status = str(edit.get("status", current["status"]) or "draft").strip()
        if status not in {"draft", "active", "archived"}:
            raise ValueError("Status must be draft, active, or archived")
        quantity = max(0, int(float(edit.get("quantity", current["quantity"]) or 0)))
        price = max(0.0, round(float(edit.get("price", current["price"]) or 0), 2))
        if status == "archived":
            quantity = 0
        if status == "active" and quantity < 1:
            raise ValueError("Active listings must have quantity above zero")
        if status == "active" and price <= 0:
            raise ValueError("Active listings must have a positive price")
        stamp = _now()
        with self._connect() as db:
            db.execute(
                """UPDATE commercial_inventory SET title=?,description=?,player=?,sport=?,category=?,condition=?,
                   status=?,quantity=?,price=?,local_dirty=?,updated_at=? WHERE inventory_item_id=?""",
                (
                    title,
                    description,
                    str(edit.get("player", current.get("player") or "")).strip() or None,
                    str(edit.get("sport", current.get("sport") or "")).strip() or None,
                    str(edit.get("category", current.get("category") or "other_collectable")),
                    str(edit.get("condition", current.get("condition") or "unknown")),
                    status,
                    quantity,
                    price,
                    0 if synced_to_ebay else 1,
                    stamp,
                    inventory_item_id,
                ),
            )
        return self.get_item(inventory_item_id) or current

    @staticmethod
    def _payload(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "inventoryItemId": str(row["inventory_item_id"]),
            "legacyProductId": None,
            "ownershipScope": "store",
            "canEdit": True,
            "title": str(row["title"]),
            "player": row["player"],
            "sport": row["sport"],
            "sku": str(row["sku"]),
            "description": row["description"],
            "category": row["category"] or "other_collectable",
            "condition": row["condition"] or "unknown",
            "status": str(row["status"]),
            "quantity": int(row["quantity"] or 0),
            "price": float(row["price"] or 0),
            "imageUrl": row["image_url"],
            "ebayItemId": str(row["ebay_listing_id"]),
            "ebayOfferId": row["ebay_offer_id"],
            "authenticity": {},
            "under20SellerProtectionOptIn": False,
            "localDirty": bool(row["local_dirty"]),
            "updatedAt": row["updated_at"],
            "createdAt": row["created_at"],
            "sourceOfTruth": "mac_local",
        }
