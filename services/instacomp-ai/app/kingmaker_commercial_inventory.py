from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
import base64
import json
import sqlite3
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _ebay_access_token() -> str:
    support = Path.home() / "Library/Application Support/TCOS-Current-Review"
    env_path = support / ".env.local"
    token_path = support / "ebay-seller-token.json"
    if not env_path.exists() or not token_path.exists():
        raise ValueError("Mac-local eBay credentials are not configured")
    env = _read_env_file(env_path)
    client_id = str(env.get("EBAY_CLIENT_ID") or "").strip()
    client_secret = str(env.get("EBAY_CLIENT_SECRET") or "").strip()
    token_record = json.loads(token_path.read_text(encoding="utf-8"))
    refresh_token = str(token_record.get("refreshToken") or "").strip()
    if not client_id or not client_secret or not refresh_token:
        raise ValueError("Mac-local eBay credentials are incomplete")
    api_root = "https://api.sandbox.ebay.com" if str(env.get("EBAY_ENVIRONMENT") or "production").lower() == "sandbox" else "https://api.ebay.com"
    body = urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": "https://api.ebay.com/oauth/api_scope/sell.inventory",
    }).encode("utf-8")
    encoded = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        f"{api_root}/identity/v1/oauth2/token",
        data=body,
        method="POST",
        headers={"Authorization": f"Basic {encoded}", "Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1000]
        raise ValueError(f"eBay token refresh failed: {detail}") from exc
    access_token = str(data.get("access_token") or "").strip()
    if not access_token:
        raise ValueError("eBay token refresh did not return an access token")
    return access_token


def fetch_ebay_seller_snapshot() -> dict[str, Any]:
    access_token = _ebay_access_token()
    namespace = {"e": "urn:ebay:apis:eBLBaseComponents"}
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=119)
    listings: list[dict[str, Any]] = []
    page_number = 1
    total_pages = 1
    while page_number <= total_pages:
        xml_body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">'
            '<DetailLevel>ReturnAll</DetailLevel>'
            f'<EndTimeFrom>{now.strftime("%Y-%m-%dT%H:%M:%S.000Z")}</EndTimeFrom>'
            f'<EndTimeTo>{end.strftime("%Y-%m-%dT%H:%M:%S.000Z")}</EndTimeTo>'
            f'<Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>{page_number}</PageNumber></Pagination>'
            '</GetSellerListRequest>'
        ).encode("utf-8")
        request = urllib.request.Request(
            "https://api.ebay.com/ws/api.dll",
            data=xml_body,
            method="POST",
            headers={
                "X-EBAY-API-CALL-NAME": "GetSellerList",
                "X-EBAY-API-SITEID": "0",
                "X-EBAY-API-COMPATIBILITY-LEVEL": "1363",
                "X-EBAY-API-IAF-TOKEN": access_token,
                "Content-Type": "text/xml",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                root = ET.fromstring(response.read())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:2000]
            raise ValueError(f"eBay seller-list request failed: {detail}") from exc
        ack = str(root.findtext("e:Ack", default="", namespaces=namespace))
        if ack not in {"Success", "Warning"}:
            errors = []
            for node in root.findall("e:Errors", namespace):
                message = node.findtext("e:LongMessage", default="", namespaces=namespace) or node.findtext("e:ShortMessage", default="", namespaces=namespace)
                if message:
                    errors.append(str(message))
            raise ValueError("eBay seller-list request failed: " + " ".join(errors))
        total_pages = max(1, int(root.findtext("e:PaginationResult/e:TotalNumberOfPages", default="1", namespaces=namespace) or 1))
        for item in root.findall("e:ItemArray/e:Item", namespace):
            listing_id = str(item.findtext("e:ItemID", default="", namespaces=namespace)).strip()
            native_sku = str(item.findtext("e:SKU", default="", namespaces=namespace)).strip()
            if not listing_id:
                continue
            sku = native_sku or f"legacy-ebay-{listing_id}"
            listing_status = str(item.findtext("e:SellingStatus/e:ListingStatus", default="Active", namespaces=namespace)).strip()
            quantity = int(float(item.findtext("e:Quantity", default="0", namespaces=namespace) or 0))
            sold = int(float(item.findtext("e:SellingStatus/e:QuantitySold", default="0", namespaces=namespace) or 0))
            available = max(0, quantity - sold)
            price = float(item.findtext("e:SellingStatus/e:CurrentPrice", default="0", namespaces=namespace) or 0)
            specifics: dict[str, str] = {}
            for nv in item.findall("e:ItemSpecifics/e:NameValueList", namespace):
                name = str(nv.findtext("e:Name", default="", namespaces=namespace)).strip()
                value = str(nv.findtext("e:Value", default="", namespaces=namespace)).strip()
                if name and value and name not in specifics:
                    specifics[name] = value
            pictures = [str(node.text or "").strip() for node in item.findall("e:PictureDetails/e:PictureURL", namespace) if str(node.text or "").strip()]
            title = str(item.findtext("e:Title", default=sku, namespaces=namespace)).strip() or sku
            description = str(item.findtext("e:Description", default="", namespaces=namespace))
            category_name = str(item.findtext("e:PrimaryCategory/e:CategoryName", default="", namespaces=namespace)).strip()
            category_id = str(item.findtext("e:PrimaryCategory/e:CategoryID", default="", namespaces=namespace)).strip()
            condition = str(item.findtext("e:ConditionDisplayName", default="", namespaces=namespace)).strip()
            listings.append({
                "inventoryItemId": f"ebay:{listing_id}", "legacyProductId": None,
                "ownershipScope": "store", "canEdit": True, "sku": sku,
                "offerId": None, "ebayItemId": listing_id, "title": title,
                "description": description,
                "player": specifics.get("Player") or specifics.get("Player/Athlete") or None,
                "sport": specifics.get("Sport") or None,
                "category": category_name or category_id or "other_collectable",
                "condition": condition or "unknown",
                "status": "active" if listing_status.lower() == "active" else "draft",
                "quantity": available, "price": max(0.0, round(price, 2)),
                "imageUrl": pictures[0] if pictures else None, "imageUrls": pictures,
                "authenticity": {}, "under20SellerProtectionOptIn": False,
                "nativeSku": native_sku or None,
                "updatedAt": _now(),
                "createdAt": str(item.findtext("e:ListingDetails/e:StartTime", default="", namespaces=namespace)).strip() or None,
                "syncedAt": _now(),
            })
        page_number += 1
    synced_at = _now()
    return {"listings": listings, "listingCount": len(listings), "syncedAt": synced_at}


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
