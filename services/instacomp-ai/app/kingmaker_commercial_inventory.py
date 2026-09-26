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


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _identity_value(value: Any) -> str | None:
    candidate = _text(value)
    if not candidate:
        return None
    normalized = candidate.lower()
    if normalized in {
        "identity review required",
        "review required",
        "untitled item",
        "permanent uuid missing",
    }:
        return None
    if __import__("re").match(r"^no\.?\s*", candidate, __import__("re").I) and len(candidate.split()) <= 3:
        return None
    return candidate


def _slug(value: Any) -> str:
    import re
    import unicodedata

    normalized = unicodedata.normalize("NFKD", str(value or ""))
    normalized = "".join(
        char for char in normalized if not unicodedata.combining(char)
    )
    normalized = normalized.strip().lower().replace("'", "").replace("’", "")
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return normalized or "none"


def _normalize_subset_label(value: str) -> str:
    import re

    normalized = re.sub(r"\s+", " ", value.lower()).strip()
    aliases = {
        "all american": "All American",
        "all-american": "All American",
        "crunch time": "Crunch Time",
        "crunch-time": "Crunch Time",
        "future watch": "Future Watch",
        "young guns": "Young Guns",
        "spectrum fx": "Spectrum FX",
    }
    return aliases.get(normalized, value)


def _identity_pricing_group_key(identity_value: Any) -> str | None:
    identity = _record(identity_value)
    year = _identity_value(identity.get("year"))
    manufacturer = _identity_value(identity.get("manufacturer")) or _identity_value(identity.get("brand"))
    product = (
        _identity_value(identity.get("setName"))
        or _identity_value(identity.get("set_name"))
        or _identity_value(identity.get("product"))
    )
    subset = (
        _identity_value(identity.get("subset"))
        or _identity_value(identity.get("insertName"))
        or _identity_value(identity.get("insert"))
        or _identity_value(identity.get("seriesName"))
        or _identity_value(identity.get("series"))
        or _identity_value(identity.get("parallelName"))
        or _identity_value(identity.get("parallel"))
        or _identity_value(identity.get("player"))
        or _identity_value(identity.get("playerName"))
        or _identity_value(identity.get("subject"))
    )
    card_number = _identity_value(identity.get("cardNumber")) or _identity_value(identity.get("card_number"))
    player = _identity_value(identity.get("player")) or _identity_value(identity.get("playerName"))
    team = _identity_value(identity.get("team"))
    parallel = (
        _identity_value(identity.get("parallel"))
        or _identity_value(identity.get("checklistParallel"))
        or _identity_value(identity.get("parallelName"))
        or _identity_value(identity.get("variation"))
    )
    serial = (
        _identity_value(identity.get("serialNumber"))
        or _identity_value(identity.get("serial_number"))
        or _identity_value(identity.get("printRun"))
        or _identity_value(identity.get("serialRun"))
    )
    pieces = [
        "identity",
        year,
        manufacturer,
        product,
        _normalize_subset_label(subset) if subset else None,
        card_number,
        player,
        team,
        parallel,
        serial,
    ]
    pieces = [piece for piece in pieces if piece]
    return "|".join(_slug(piece) for piece in pieces) if len(pieces) > 1 else None


def _effective_pricing_group_key(metadata_value: Any) -> str | None:
    metadata = _record(metadata_value)
    instacomp = _record(metadata.get("instacomp"))
    manual_identity = _record(instacomp.get("manualIdentity"))
    if instacomp.get("manualIdentityLocked") is True and manual_identity:
        manual_key = _identity_pricing_group_key(manual_identity)
        if manual_key:
            return manual_key
    checklist_identity = _record(instacomp.get("checklistIdentity"))
    channel_draft = _record(instacomp.get("channelDraft"))
    ai_identity = _record(instacomp.get("ai"))
    locked_fields = _record(checklist_identity.get("lockedFields"))
    return (
        _text(checklist_identity.get("registryFingerprintSha256"))
        or _text(channel_draft.get("registryFingerprintSha256"))
        or _text(instacomp.get("registryFingerprintSha256"))
        or _identity_pricing_group_key(locked_fields)
        or _identity_pricing_group_key(ai_identity)
        or _identity_pricing_group_key(instacomp.get("identity"))
        or _identity_pricing_group_key(metadata.get("card_identity"))
        or _identity_pricing_group_key(metadata.get("sale_identity"))
        or _text(instacomp.get("pricingGroupKey"))
    )


def _master_listing_group_key(row: dict[str, Any]) -> str:
    metadata = _record(row.get("metadata"))
    instacomp = _record(metadata.get("instacomp"))
    asset = _record(metadata.get("collectible_asset"))
    ai = _record(instacomp.get("ai"))
    unique_physical = bool(
        _text(asset.get("exact_serial_number"))
        or _text(asset.get("grading_cert_number"))
        or _text(ai.get("gradingCertNumber"))
        or _text(ai.get("certificationNumber"))
    )
    group_key = None if unique_physical else _effective_pricing_group_key(metadata)
    inventory_item_id = _text(row.get("id")) or _text(row.get("inventory_item_id")) or "unknown"
    return f"group:{group_key}" if group_key else f"physical:{inventory_item_id}"


def _master_listing_queue(metadata_value: Any) -> str:
    metadata = _record(metadata_value)
    instacomp = _record(metadata.get("instacomp"))
    image_orientation = _record(instacomp.get("imageOrientation"))
    checklist_decision = _record(instacomp.get("checklistDecision"))
    checklist_identity = _record(instacomp.get("checklistIdentity"))
    mac_receipt = _record(instacomp.get("macReceipt"))

    front = _text(instacomp.get("frontImageUrl"))
    back = _text(instacomp.get("backImageUrl"))
    distinct_pair = bool(front and back and front != back)
    orientation_verified = (
        _text(image_orientation.get("status")) == "completed"
        and instacomp.get("imageOrientationPersisted") is True
        and (instacomp.get("imagePersistenceVerified") is True or distinct_pair)
    )
    manual_locked = (
        instacomp.get("manualIdentityLocked") is True
        and instacomp.get("identityComplete") is True
    )
    identity_id = (
        _text(instacomp.get("registryIdentityId"))
        or _text(checklist_identity.get("registryIdentityId"))
        or _text(checklist_identity.get("identityId"))
    )
    fingerprint = (
        _text(instacomp.get("registryFingerprintSha256"))
        or _text(checklist_identity.get("registryFingerprintSha256"))
        or _text(checklist_identity.get("fingerprintSha256"))
    )
    legacy_receipt = (
        checklist_identity.get("source") == "checklist_registry"
        and checklist_identity.get("status") == "identified"
        and mac_receipt.get("checklistOutcome") == "exact_match"
    )
    local_receipt = (
        _text(instacomp.get("identitySource")) == "mac_checklist_registry_exact"
        and checklist_identity.get("status") == "exact_match"
    )
    exact_registry = (
        instacomp.get("identityComplete") is True
        and instacomp.get("trustedForIdentity") is True
        and checklist_decision.get("status") == "exact_match"
        and (legacy_receipt or local_receipt)
        and bool(identity_id)
        and bool(fingerprint)
    )
    if not orientation_verified:
        return "verification"
    if manual_locked:
        return "listings"
    return "listings" if exact_registry else "verification"


def _master_listing_relevant(row: dict[str, Any]) -> bool:
    metadata = _record(row.get("metadata"))
    instacomp = _record(metadata.get("instacomp"))
    card_identity = _record(metadata.get("card_identity"))
    legacy_identity = _record(metadata.get("cardIdentity"))
    sale_identity = _record(metadata.get("sale_identity"))
    workflow = _record(metadata.get("listingWorkflow"))
    legacy_workflow = _record(metadata.get("listing_workflow"))
    pending_verification = _record(metadata.get("pending_verification"))
    recovered = _record(instacomp.get("recoveredImageUrls"))

    has_source = bool(_text(instacomp.get("source")) or _text(instacomp.get("scanId")))
    has_identity = any(
        _text(identity.get(key))
        for identity in (card_identity, legacy_identity, sale_identity)
        for key in ("year", "player", "cardNumber", "card_number")
    )
    queue_hint = (
        _text(workflow.get("queue"))
        or _text(legacy_workflow.get("queue"))
        or _text(pending_verification.get("status"))
    )
    has_scan_pair = bool(_text(instacomp.get("imagePairSha256")))
    source_images = instacomp.get("sourceImageUrls")
    has_images = bool(
        _text(recovered.get("front"))
        or _text(recovered.get("back"))
        or (
            isinstance(source_images, list)
            and any(_text(value) for value in source_images)
        )
    )
    if (
        not has_source
        and not has_identity
        and not has_images
        and not has_scan_pair
        and queue_hint not in {"pending_verification", "pending"}
    ):
        return False
    if (
        queue_hint in {"pending_verification", "pending"}
        or has_images
        or has_identity
        or has_scan_pair
    ):
        return True
    return bool(
        instacomp.get("identityComplete") is True
        or _text(instacomp.get("lastStatus")) in {"identity_complete", "review_required"}
        or _text(instacomp.get("pricingStatus"))
        == "identity_complete_pricing_pending"
    )


def _master_listing_folder(row: dict[str, Any]) -> str:
    metadata = _record(row.get("metadata"))
    lifecycle = _record(metadata.get("inventory_lifecycle"))
    if _text(lifecycle.get("disposition")) == "investment_stash" or _text(
        lifecycle.get("state")
    ) == "investment_stash":
        return "investment"
    dual = _record(metadata.get("dual_marketplace"))
    projection = _record(metadata.get("master_listing_projection"))
    website = _record(dual.get("website"))
    ebay = _record(dual.get("ebay"))
    mercari = _record(dual.get("mercari"))
    website_active = (
        projection.get("websiteActive") is True
        or _text(website.get("status")) == "active"
    )
    ebay_active = (
        projection.get("ebayActive") is True
        or _text(ebay.get("status")) in {"active", "linked"}
    )
    mercari_active = (
        projection.get("mercariActive") is True
        or _text(mercari.get("status")) in {"active", "linked", "live"}
    )
    if website_active and ebay_active and mercari_active:
        return "all3"
    if website_active and ebay_active:
        return "both"
    if website_active and mercari_active:
        return "website_mercari"
    if ebay_active and mercari_active:
        return "ebay_mercari"
    if website_active:
        return "website"
    if ebay_active:
        return "ebay"
    if mercari_active:
        return "mercari"
    return "pending"


_MASTER_LISTING_COMPACT_METADATA_KEYS = {
    "collectible_asset",
    "inventory_lifecycle",
    "listingWorkflow",
    "listing_workflow",
    "pending_verification",
    "card_identity",
    "cardIdentity",
    "sale_identity",
    "seller_review",
    "titleNormalization",
    "verified_reference",
    "card",
    "grader_verification",
    "ebay_image_urls",
    "master_listing_projection",
    "acquisition",
}

_MASTER_LISTING_COMPACT_INSTACOMP_KEYS = {
    "acquisition",
    "ai",
    "backImageSource",
    "backImageUrl",
    "backSha256",
    "cardUuid",
    "centering",
    "checklistDecision",
    "checklistIdentity",
    "duplicateGroup",
    "duplicateInventoryDecision",
    "frontImageUrl",
    "frontSha256",
    "hasBackImage",
    "humanVerified",
    "identity",
    "identityComplete",
    "identitySource",
    "identityTrace",
    "imageOrientation",
    "imageOrientationPersisted",
    "imagePairSha256",
    "imagePersistenceVerified",
    "kingmakerReviewBatchId",
    "lastStatus",
    "listingPrice",
    "listingPriceSource",
    "macReceipt",
    "manualIdentity",
    "manualIdentityLocked",
    "manualListingTitle",
    "manualListingTitleLocked",
    "marketPrice",
    "priceGuideCheckedAt",
    "priceGuideMessage",
    "priceGuideStatus",
    "pricingCheckedAt",
    "pricingGroupKey",
    "pricingReason",
    "pricingStatus",
    "recoveredImageUrls",
    "registryFingerprintSha256",
    "registryIdentityId",
    "reliableSoldCompCount",
    "scanId",
    "source",
    "sourceImageUrls",
    "suggestedPrice",
    "trustedForIdentity",
}


def _compact_master_listing_row(row: dict[str, Any]) -> dict[str, Any]:
    compact = dict(row or {})
    metadata = _record(compact.get("metadata"))
    instacomp = _record(metadata.get("instacomp"))
    compact_metadata = {
        key: metadata[key]
        for key in _MASTER_LISTING_COMPACT_METADATA_KEYS
        if key in metadata
    }
    compact_metadata["instacomp"] = {
        key: instacomp[key]
        for key in _MASTER_LISTING_COMPACT_INSTACOMP_KEYS
        if key in instacomp
    }

    dual = _record(metadata.get("dual_marketplace"))
    website = _record(dual.get("website"))
    ebay = _record(dual.get("ebay"))
    mercari = _record(dual.get("mercari"))
    compact_metadata["dual_marketplace"] = {
        "website": {
            key: website[key]
            for key in ("status", "price")
            if key in website
        },
        "ebay": {
            key: ebay[key]
            for key in (
                "status",
                "price",
                "cardCondition",
                "categoryId",
                "lastError",
                "lastAttemptAt",
                "itemId",
                "itemUrl",
            )
            if key in ebay
        },
        "mercari": {
            key: mercari[key]
            for key in (
                "status",
                "price",
                "itemId",
                "itemUrl",
                "sourceListingId",
                "account",
            )
            if key in mercari
        },
    }
    compact["metadata"] = compact_metadata
    return compact

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

    def _read_connect(self) -> sqlite3.Connection:
        """Fast read-only connection for seller-facing inventory projections.

        The database is initialized once when the KINGMAKER router starts. Re-running
        schema DDL and WAL negotiation for every Pending-page read made a simple
        inventory list take ~10 seconds on the external authority volume, causing
        the web bridge's 2-second deadline to silently omit received-review cards.
        """
        uri = f"file:{self.path}?mode=ro"
        db = sqlite3.connect(uri, uri=True, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        db.execute("PRAGMA busy_timeout=5000")
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

                CREATE TABLE IF NOT EXISTS master_listing_projection (
                    inventory_item_id TEXT PRIMARY KEY,
                    folder TEXT NOT NULL,
                    pending_queue TEXT NOT NULL,
                    group_key TEXT,
                    source_updated_at TEXT,
                    projected_at TEXT NOT NULL,
                    row_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS master_listing_projection_folder_idx
                  ON master_listing_projection(folder);
                CREATE INDEX IF NOT EXISTS master_listing_projection_queue_idx
                  ON master_listing_projection(pending_queue);
                """
            )
            columns = {
                str(row[1])
                for row in db.execute("PRAGMA table_info(master_listing_projection)").fetchall()
            }
            if "group_key" not in columns:
                db.execute("ALTER TABLE master_listing_projection ADD COLUMN group_key TEXT")
            db.execute(
                "CREATE INDEX IF NOT EXISTS master_listing_projection_folder_group_idx "
                "ON master_listing_projection(folder,pending_queue,group_key)"
            )
            stale_groups = db.execute(
                "SELECT inventory_item_id,row_json FROM master_listing_projection "
                "WHERE group_key IS NULL OR group_key=''"
            ).fetchall()
            for stale in stale_groups:
                try:
                    payload = json.loads(str(stale["row_json"] or "{}"))
                except (TypeError, ValueError, json.JSONDecodeError):
                    payload = {}
                if not isinstance(payload, dict):
                    payload = {}
                if "id" not in payload:
                    payload["id"] = str(stale["inventory_item_id"] or "")
                db.execute(
                    "UPDATE master_listing_projection SET group_key=? WHERE inventory_item_id=?",
                    (_master_listing_group_key(payload), str(stale["inventory_item_id"])),
                )

    def project_master_listings(
        self,
        items: list[dict[str, Any]],
        *,
        replace: bool = False,
    ) -> dict[str, Any]:
        self.initialize()
        stamp = _now()
        upserted = 0
        with self._connect() as db:
            if replace:
                db.execute("DELETE FROM master_listing_projection")
            for raw in items:
                row = dict(raw or {})
                inventory_item_id = str(
                    row.get("id")
                    or row.get("inventory_item_id")
                    or row.get("inventoryItemId")
                    or ""
                ).strip()
                if not inventory_item_id:
                    continue
                status = str(row.get("status") or "").strip().lower()
                try:
                    quantity = int(float(row.get("quantity") or 0))
                except (TypeError, ValueError):
                    quantity = 0
                if (
                    status in {"archived", "sold"}
                    or quantity <= 0
                    or not _master_listing_relevant(row)
                ):
                    db.execute(
                        "DELETE FROM master_listing_projection WHERE inventory_item_id=?",
                        (inventory_item_id,),
                    )
                    continue
                folder = _master_listing_folder(row)
                pending_queue = _master_listing_queue(row.get("metadata"))
                compact_row = _compact_master_listing_row(row)
                group_key = _master_listing_group_key(compact_row)
                db.execute(
                    """
                    INSERT INTO master_listing_projection(
                      inventory_item_id,folder,pending_queue,group_key,source_updated_at,projected_at,row_json
                    ) VALUES(?,?,?,?,?,?,?)
                    ON CONFLICT(inventory_item_id) DO UPDATE SET
                      folder=excluded.folder,
                      pending_queue=excluded.pending_queue,
                      group_key=excluded.group_key,
                      source_updated_at=excluded.source_updated_at,
                      projected_at=excluded.projected_at,
                      row_json=excluded.row_json
                    """,
                    (
                        inventory_item_id,
                        folder,
                        pending_queue,
                        group_key,
                        str(row.get("updated_at") or ""),
                        stamp,
                        json.dumps(
                            compact_row,
                            separators=(",", ":"),
                            ensure_ascii=False,
                        ),
                    ),
                )
                upserted += 1
        return {"upserted": upserted, **self.master_listing_projection_summary()}

    def master_listing_projection_summary(self) -> dict[str, Any]:
        self.initialize()
        folder_names = (
            "pending",
            "website",
            "ebay",
            "mercari",
            "both",
            "website_mercari",
            "ebay_mercari",
            "all3",
            "investment",
        )
        folder_counts = {folder: 0 for folder in folder_names}
        queue_counts = {"listings": 0, "verification": 0}
        with self._read_connect() as db:
            total = int(
                db.execute("SELECT COUNT(*) FROM master_listing_projection").fetchone()[0]
            )
            folder_rows = db.execute(
                """
                SELECT folder,COUNT(DISTINCT group_key) AS count
                FROM master_listing_projection
                WHERE NOT (folder='pending' AND pending_queue<>'listings')
                GROUP BY folder
                """
            ).fetchall()
            queue_rows = db.execute(
                """
                SELECT pending_queue,COUNT(*) AS count
                FROM master_listing_projection
                WHERE folder='pending'
                GROUP BY pending_queue
                """
            ).fetchall()
        for row in folder_rows:
            folder = str(row["folder"] or "")
            if folder in folder_counts:
                folder_counts[folder] = int(row["count"] or 0)
        for row in queue_rows:
            queue_name = str(row["pending_queue"] or "")
            if queue_name in queue_counts:
                queue_counts[queue_name] = int(row["count"] or 0)
        return {
            "sourceAuthority": "mac_local_sqlite",
            "total": total,
            "folderCounts": folder_counts,
            "queueCounts": queue_counts,
        }

    def list_master_listing_projection(
        self,
        *,
        folder: str | None = None,
        pending_queue: str | None = None,
        compact: bool = False,
    ) -> dict[str, Any]:
        self.initialize()
        clauses: list[str] = []
        params: list[Any] = []
        if folder:
            clauses.append("folder=?")
            params.append(str(folder))
        if pending_queue:
            clauses.append("pending_queue=?")
            params.append(str(pending_queue))
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        with self._read_connect() as db:
            rows = db.execute(
                "SELECT row_json FROM master_listing_projection"
                + where
                + " ORDER BY source_updated_at DESC, inventory_item_id",
                params,
            ).fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            try:
                payload = json.loads(str(row["row_json"] or "{}"))
            except (TypeError, ValueError, json.JSONDecodeError):
                payload = {}
            if isinstance(payload, dict) and payload:
                items.append(
                    _compact_master_listing_row(payload)
                    if compact
                    else payload
                )
        return {
            **self.master_listing_projection_summary(),
            "items": items,
            "count": len(items),
        }

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
