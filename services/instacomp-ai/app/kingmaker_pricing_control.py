from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def text(value: Any) -> str:
    return str(value or "").strip()


def num(value: Any, fallback: float | None = None) -> float | None:
    try:
        return float(value) if value not in (None, "") else fallback
    except (TypeError, ValueError):
        return fallback


def load_json(value: Any, fallback: Any = None) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(str(value))
    except (TypeError, json.JSONDecodeError):
        return fallback


@contextmanager
def db_connect(path: Path, writable: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if writable:
        db = sqlite3.connect(path, timeout=30)
    else:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=20)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=30000")
    try:
        yield db
        if writable:
            db.commit()
    finally:
        db.close()


def owner_key(store_id: str, seller_id: str | None) -> tuple[str, str]:
    return text(store_id) or "store", text(seller_id)


def initialize_pricing_schema(control_db: Path) -> None:
    with db_connect(control_db, writable=True) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS pricing_profiles(
          id TEXT PRIMARY KEY,store_id TEXT NOT NULL,seller_account_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,marketplace_fee_pct REAL NOT NULL,payment_fee_pct REAL NOT NULL,
          payment_fixed_fee REAL NOT NULL,estimated_shipping_cost REAL NOT NULL,
          target_margin_pct REAL NOT NULL,is_default INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 1,archived_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS pricing_profiles_owner_idx
          ON pricing_profiles(store_id,seller_account_id,is_default,updated_at DESC);
        CREATE TABLE IF NOT EXISTS pricing_profile_audit(
          id INTEGER PRIMARY KEY AUTOINCREMENT,profile_id TEXT,store_id TEXT NOT NULL,
          seller_account_id TEXT NOT NULL DEFAULT '',action TEXT NOT NULL,profile_name TEXT NOT NULL,
          snapshot_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS pricing_saved_views(
          id TEXT PRIMARY KEY,store_id TEXT NOT NULL,seller_account_id TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,filters_json TEXT NOT NULL DEFAULT '{}',is_default INTEGER NOT NULL DEFAULT 0,
          version INTEGER NOT NULL DEFAULT 1,archived_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        """)
        db.executescript("""
        CREATE TABLE IF NOT EXISTS pricing_decision_receipts(
          id TEXT PRIMARY KEY,store_id TEXT NOT NULL,seller_account_id TEXT NOT NULL DEFAULT '',
          identity_id TEXT NOT NULL,profile_id TEXT,profile_name TEXT NOT NULL,profile_selection TEXT NOT NULL,
          decision_status TEXT NOT NULL,suggested_list_price REAL,buy_ceiling REAL,market_median REAL,
          reference_midpoint REAL,estimated_net_proceeds REAL,expected_profit REAL,
          minimum_profitable_list_price REAL,confidence REAL NOT NULL DEFAULT 0,sold_comp_count INTEGER NOT NULL DEFAULT 0,
          review_reasons_json TEXT NOT NULL DEFAULT '[]',marketplace_fee_pct REAL NOT NULL,payment_fee_pct REAL NOT NULL,
          payment_fixed_fee REAL NOT NULL,shipping_cost REAL NOT NULL,target_margin_pct REAL NOT NULL,
          boundary TEXT NOT NULL DEFAULT 'advisory_only',created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS pricing_receipts_owner_idx
          ON pricing_decision_receipts(store_id,seller_account_id,created_at DESC);
        CREATE TABLE IF NOT EXISTS private_pricing_work_orders(
          attack_key TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'queued',priority INTEGER NOT NULL DEFAULT 3,
          notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,sport TEXT NOT NULL,release_year TEXT NOT NULL,
          manufacturer TEXT NOT NULL,product TEXT NOT NULL,set_name TEXT NOT NULL,gap_type TEXT NOT NULL,
          actionability_status TEXT NOT NULL,actionability_reasons_json TEXT NOT NULL DEFAULT '[]',recommended_action TEXT NOT NULL,
          potential_unlock INTEGER NOT NULL DEFAULT 0,distinct_card_numbers INTEGER NOT NULL DEFAULT 0,
          source_refreshed_at TEXT,last_seen_at TEXT,assignee TEXT,claimed_at TEXT,released_at TEXT,due_at TEXT,next_review_at TEXT,
          blocked_reason TEXT,resolution_code TEXT,started_at TEXT,blocked_at TEXT,resolved_at TEXT,reopened_at TEXT,
          resolution_cycle INTEGER NOT NULL DEFAULT 0,completed_at TEXT,dismissed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        """)
        db.executescript("""
        CREATE TABLE IF NOT EXISTS private_pricing_work_order_events(
          id INTEGER PRIMARY KEY AUTOINCREMENT,attack_key TEXT NOT NULL,action TEXT NOT NULL,status TEXT,
          priority INTEGER,version INTEGER,notes_changed INTEGER NOT NULL DEFAULT 0,actor_type TEXT NOT NULL DEFAULT 'admin',
          metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS private_pricing_events_key_idx
          ON private_pricing_work_order_events(attack_key,created_at DESC);
        CREATE TABLE IF NOT EXISTS kingmaker_delivery_runs(
          id INTEGER PRIMARY KEY AUTOINCREMENT,fingerprint TEXT NOT NULL UNIQUE,status TEXT NOT NULL,
          payload_json TEXT NOT NULL DEFAULT '{}',claimed_at TEXT,completed_at TEXT,error TEXT,
          created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        """)


def normalize_owner_query(store_id: str, seller_account_id: str | None) -> tuple[str, str]:
    store, seller = owner_key(store_id, seller_account_id)
    return store, seller


def add_event(db: sqlite3.Connection, attack_key: str, action: str, row: sqlite3.Row | None,
              *, actor_type: str = "admin", notes_changed: bool = False, metadata: dict[str, Any] | None = None) -> None:
    stamp = now_iso()
    db.execute(
        "INSERT INTO private_pricing_work_order_events(attack_key,action,status,priority,version,notes_changed,actor_type,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
        (attack_key, action, row["status"] if row else None, row["priority"] if row else None,
         row["version"] if row else None, 1 if notes_changed else 0, actor_type,
         json.dumps(metadata or {}, sort_keys=True, default=str), stamp),
    )


def registry_identity(registry_db: Path, identity_id: str) -> dict[str, Any] | None:
    if not registry_db.exists():
        return None
    with db_connect(registry_db) as db:
        row = db.execute(
            "SELECT identity_id,year,manufacturer,brand,product,player,set_name,card_number,parallel,sport FROM checklist_registry_entries WHERE identity_id=? AND active=1 LIMIT 1",
            (identity_id,),
        ).fetchone()
    return dict(row) if row else None


def pricing_history(instacomp_db: Path, registry_db: Path, identity_id: str, limit: int = 24) -> list[dict[str, Any]]:
    identity = registry_identity(registry_db, identity_id)
    if not identity or not instacomp_db.exists():
        return []
    params = (
        text(identity.get("year")).lower(), text(identity.get("player")).lower(),
        text(identity.get("card_number")).lower(), text(identity.get("set_name")).lower(),
        max(1, min(int(limit), 120)),
    )
    with db_connect(instacomp_db) as db:
        rows = db.execute("""
          SELECT publication_month,beckett_low,beckett_high,extraction_confidence,verification_status,created_at
          FROM beckett_price_snapshots
          WHERE lower(coalesce(normalized_year,''))=? AND lower(coalesce(normalized_player,''))=?
            AND lower(coalesce(normalized_card_number,''))=? AND lower(coalesce(normalized_set_name,''))=?
          ORDER BY publication_month DESC, created_at DESC LIMIT ?
        """, params).fetchall()
    return [{
        "editionDate": text(r["publication_month"]), "low": num(r["beckett_low"]), "high": num(r["beckett_high"]),
        "midpoint": ((num(r["beckett_low"], 0) or 0) + (num(r["beckett_high"], 0) or 0)) / 2 if r["beckett_low"] is not None and r["beckett_high"] is not None else num(r["beckett_low"] if r["beckett_low"] is not None else r["beckett_high"]),
        "currency": "USD", "confidence": num(r["extraction_confidence"], 0) or 0,
        "status": "verified" if r["verification_status"] == "source_verified" else "review_required",
    } for r in rows]


def pricing_record(instacomp_db: Path, registry_db: Path, identity_id: str) -> dict[str, Any] | None:
    history = pricing_history(instacomp_db, registry_db, identity_id, 120)
    if not history:
        return None
    identity = registry_identity(registry_db, identity_id) or {}
    latest = history[0]
    previous = history[1] if len(history) > 1 else None
    midpoint = num(latest.get("midpoint"))
    previous_midpoint = num(previous.get("midpoint")) if previous else None
    trend = ((midpoint - previous_midpoint) / previous_midpoint * 100) if midpoint is not None and previous_midpoint not in (None, 0) else None
    entity_key = "|".join(text(identity.get(k)) for k in ("year", "brand", "product", "player", "card_number", "parallel"))
    return {
        "identityId": identity_id,
        "identityKey": entity_key,
        "editionDate": latest["editionDate"],
        "low": latest["low"], "high": latest["high"], "midpoint": latest["midpoint"],
        "currency": "USD", "confidence": latest["confidence"], "status": latest["status"],
        "historyCount": len(history), "trendPct": trend, "refreshedAt": now_iso(),
    }


def coverage_targets(instacomp_db: Path, *, sport: str | None = None, search: str | None = None) -> list[dict[str, Any]]:
    if not instacomp_db.exists():
        return []
    clauses = ["card_uuid IS NULL"]
    params: list[Any] = []
    if sport:
        clauses.append("lower(coalesce(sport,''))=lower(?)")
        params.append(sport)
    sql = f"""
      SELECT sport,coalesce(raw_year,normalized_year,'Unknown') release_year,
             coalesce(raw_set_name,normalized_set_name,'Unknown') set_name,
             count(*) unresolved_rows,count(distinct normalized_card_number) distinct_cards,
             avg(extraction_confidence) avg_conf,max(created_at) refreshed_at
      FROM beckett_price_snapshots WHERE {' AND '.join(clauses)}
      GROUP BY sport,release_year,set_name ORDER BY unresolved_rows DESC LIMIT 10000
    """
    with db_connect(instacomp_db) as db:
        rows = db.execute(sql, params).fetchall()
    result: list[dict[str, Any]] = []
    needle = text(search).lower()
    for row in rows:
        manufacturer = "Unknown"
        product = text(row["set_name"]) or "Unknown"
        set_name = text(row["set_name"]) or "Base / Unspecified"
        haystack = " ".join([text(row["sport"]), text(row["release_year"]), manufacturer, product, set_name]).lower()
        if needle and needle not in haystack:
            continue
        avg_conf = num(row["avg_conf"], 0) or 0
        attack_key = hashlib.sha256(f"{text(row['sport'])}|{text(row['release_year'])}|{set_name}".encode()).hexdigest()[:32]
        result.append({
            "attackKey": attack_key, "sport": text(row["sport"]) or "Unknown",
            "releaseYear": text(row["release_year"]) or "Unknown", "manufacturer": manufacturer,
            "product": product, "setName": set_name, "gapType": "identity_gap",
            "actionabilityStatus": "actionable" if avg_conf >= 0.9 else "parser_review",
            "actionabilityReasons": [] if avg_conf >= 0.9 else ["low_extraction_confidence"],
            "recommendedAction": "Resolve exact checklist identity locally, then retain the frozen reference snapshot.",
            "potentialUnlock": int(row["unresolved_rows"] or 0), "unmatchedRows": int(row["unresolved_rows"] or 0),
            "ambiguousRows": 0, "distinctCardNumbers": int(row["distinct_cards"] or 0),
            "guideCount": 1, "setGroupCount": 1, "averageParseConfidence": avg_conf,
            "latestReferenceDate": text(row["refreshed_at"]) or None, "registryReleaseCount": 0,
            "activeVersionCount": 0, "matchingSetCount": 0, "activeIdentityCount": 0,
        })
    return result


def work_order_payload(row: sqlite3.Row | None) -> dict[str, Any]:
    if not row:
        return {"status": "untracked", "priority": 3, "notes": "", "version": 0,
                "updatedAt": None, "startedAt": None, "blockedAt": None, "resolvedAt": None,
                "reopenedAt": None, "resolutionCycle": 0, "completedAt": None, "dismissedAt": None}
    return {"status": row["status"], "priority": row["priority"], "notes": row["notes"], "version": row["version"],
            "updatedAt": row["updated_at"], "startedAt": row["started_at"], "blockedAt": row["blocked_at"],
            "resolvedAt": row["resolved_at"], "reopenedAt": row["reopened_at"], "resolutionCycle": row["resolution_cycle"],
            "completedAt": row["completed_at"], "dismissedAt": row["dismissed_at"]}


def profile_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "name": row["name"],
        "marketplaceFeePct": row["marketplace_fee_pct"], "paymentFeePct": row["payment_fee_pct"],
        "paymentFixedFee": row["payment_fixed_fee"], "estimatedShippingCost": row["estimated_shipping_cost"],
        "targetMarginPct": row["target_margin_pct"], "isDefault": bool(row["is_default"]),
        "version": row["version"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
    }


def receipt_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "identityId": row["identity_id"], "profileId": row["profile_id"],
        "profileName": row["profile_name"], "profileSelection": row["profile_selection"],
        "status": row["decision_status"], "suggestedListPrice": row["suggested_list_price"],
        "buyCeiling": row["buy_ceiling"], "marketMedian": row["market_median"],
        "referenceMidpoint": row["reference_midpoint"], "estimatedNetProceeds": row["estimated_net_proceeds"],
        "expectedProfit": row["expected_profit"], "minimumProfitableListPrice": row["minimum_profitable_list_price"],
        "confidence": row["confidence"], "soldCompCount": row["sold_comp_count"],
        "reviewReasons": load_json(row["review_reasons_json"], []), "createdAt": row["created_at"],
    }


class ProfileMutation(BaseModel):
    storeId: str
    sellerAccountId: str | None = None
    name: str = "Pricing Profile"
    marketplaceFeePct: float = 0.08
    paymentFeePct: float = 0.029
    paymentFixedFee: float = 0.30
    estimatedShippingCost: float = 6.99
    targetMarginPct: float = 0.30
    isDefault: bool = False
    expectedVersion: int | None = None


class SavedViewMutation(BaseModel):
    storeId: str
    sellerAccountId: str | None = None
    name: str
    filters: dict[str, Any] = Field(default_factory=dict)
    isDefault: bool = False
    expectedVersion: int | None = None


class ReceiptMutation(BaseModel):
    storeId: str
    sellerAccountId: str | None = None
    identityId: str
    profileId: str | None = None
    profileName: str
    profileSelection: str
    decision: dict[str, Any]
    profile: dict[str, Any]


class WorkOrderMutation(BaseModel):
    attackKey: str
    status: str
    priority: int = 3
    notes: str = ""
    expectedVersion: int = 0


class ExecutionMutation(BaseModel):
    attackKey: str
    expectedVersion: int
    operation: str
    assignee: str | None = None
    priority: int | None = None
    dueAt: str | None = None
    blockedReason: str | None = None
    resolutionCode: str | None = None


class ReviewMutation(BaseModel):
    attackKey: str
    expectedVersion: int = 0
    nextReviewAt: str | None = None


def build_kingmaker_pricing_router(
    require_api_key: Callable,
    control_db: Path,
    instacomp_db: Path,
    registry_db: Path,
) -> APIRouter:
    initialize_pricing_schema(control_db)
    router = APIRouter(
        prefix="/v1/kingmaker/pricing",
        tags=["kingmaker-pricing"],
        dependencies=[Depends(require_api_key)],
    )

    @router.get("/reference/{identity_id}")
    def reference(identity_id: str):
        if len(identity_id) < 8:
            raise HTTPException(status_code=400, detail="Invalid identityId")
        return {"ok": True, "record": pricing_record(instacomp_db, registry_db, identity_id)}

    @router.get("/history/{identity_id}")
    def history(identity_id: str, limit: int = Query(default=24, ge=1, le=120)):
        return {"ok": True, "history": pricing_history(instacomp_db, registry_db, identity_id, limit)}

    @router.get("/profiles")
    def profiles(storeId: str, sellerAccountId: str | None = None):
        store, seller = normalize_owner_query(storeId, sellerAccountId)
        with db_connect(control_db) as db:
            rows = db.execute(
                "SELECT * FROM pricing_profiles WHERE store_id=? AND seller_account_id=? AND archived_at IS NULL ORDER BY is_default DESC,name ASC",
                (store, seller),
            ).fetchall()
        return {"ok": True, "profiles": [profile_payload(row) for row in rows]}

    @router.post("/profiles")
    def create_profile(request: ProfileMutation):
        store, seller = owner_key(request.storeId, request.sellerAccountId)
        stamp = now_iso()
        profile_id = str(uuid.uuid4())
        with db_connect(control_db, writable=True) as db:
            if request.isDefault:
                db.execute("UPDATE pricing_profiles SET is_default=0,updated_at=? WHERE store_id=? AND seller_account_id=? AND archived_at IS NULL", (stamp, store, seller))
            db.execute(
                "INSERT INTO pricing_profiles(id,store_id,seller_account_id,name,marketplace_fee_pct,payment_fee_pct,payment_fixed_fee,estimated_shipping_cost,target_margin_pct,is_default,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (profile_id, store, seller, request.name[:80], request.marketplaceFeePct, request.paymentFeePct,
                 request.paymentFixedFee, request.estimatedShippingCost, request.targetMarginPct, 1 if request.isDefault else 0, 1, stamp, stamp),
            )
            row = db.execute("SELECT * FROM pricing_profiles WHERE id=?", (profile_id,)).fetchone()
            db.execute("INSERT INTO pricing_profile_audit(profile_id,store_id,seller_account_id,action,profile_name,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)",
                       (profile_id, store, seller, "created", row["name"], json.dumps(profile_payload(row), default=str), stamp))
        return {"ok": True, "profile": profile_payload(row)}

    @router.put("/profiles/{profile_id}")
    def update_profile(profile_id: str, request: ProfileMutation):
        store, seller = owner_key(request.storeId, request.sellerAccountId)
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            current = db.execute("SELECT * FROM pricing_profiles WHERE id=? AND store_id=? AND seller_account_id=? AND archived_at IS NULL", (profile_id, store, seller)).fetchone()
            if not current:
                raise HTTPException(status_code=404, detail="Pricing profile not found")
            if request.expectedVersion is None or request.expectedVersion != current["version"]:
                raise HTTPException(status_code=409, detail="Pricing profile changed. Reload and try again.")
            if request.isDefault:
                db.execute("UPDATE pricing_profiles SET is_default=0,updated_at=? WHERE store_id=? AND seller_account_id=? AND archived_at IS NULL AND id<>?", (stamp, store, seller, profile_id))
            db.execute(
                "UPDATE pricing_profiles SET name=?,marketplace_fee_pct=?,payment_fee_pct=?,payment_fixed_fee=?,estimated_shipping_cost=?,target_margin_pct=?,is_default=?,version=version+1,updated_at=? WHERE id=?",
                (request.name[:80], request.marketplaceFeePct, request.paymentFeePct, request.paymentFixedFee,
                 request.estimatedShippingCost, request.targetMarginPct, 1 if request.isDefault else 0, stamp, profile_id),
            )
            row = db.execute("SELECT * FROM pricing_profiles WHERE id=?", (profile_id,)).fetchone()
            db.execute("INSERT INTO pricing_profile_audit(profile_id,store_id,seller_account_id,action,profile_name,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)",
                       (profile_id, store, seller, "updated", row["name"], json.dumps(profile_payload(row), default=str), stamp))
        return {"ok": True, "profile": profile_payload(row)}

    @router.post("/profiles/{profile_id}/clone")
    def clone_profile(profile_id: str, request: ProfileMutation):
        store, seller = owner_key(request.storeId, request.sellerAccountId)
        with db_connect(control_db) as db:
            source = db.execute("SELECT * FROM pricing_profiles WHERE id=? AND store_id=? AND seller_account_id=? AND archived_at IS NULL", (profile_id, store, seller)).fetchone()
        if not source:
            raise HTTPException(status_code=404, detail="Pricing profile not found")
        request.name = request.name or f"{source['name']} Copy"
        request.marketplaceFeePct = source["marketplace_fee_pct"]
        request.paymentFeePct = source["payment_fee_pct"]
        request.paymentFixedFee = source["payment_fixed_fee"]
        request.estimatedShippingCost = source["estimated_shipping_cost"]
        request.targetMarginPct = source["target_margin_pct"]
        return create_profile(request)

    @router.delete("/profiles/{profile_id}")
    def retire_profile(profile_id: str, storeId: str, sellerAccountId: str | None = None, expectedVersion: int = 0):
        store, seller = owner_key(storeId, sellerAccountId)
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            row = db.execute("SELECT * FROM pricing_profiles WHERE id=? AND store_id=? AND seller_account_id=? AND archived_at IS NULL", (profile_id, store, seller)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pricing profile not found")
            if expectedVersion != row["version"]:
                raise HTTPException(status_code=409, detail="Pricing profile changed. Reload and try again.")
            db.execute("UPDATE pricing_profiles SET archived_at=?,is_default=0,version=version+1,updated_at=? WHERE id=?", (stamp, stamp, profile_id))
            updated = db.execute("SELECT * FROM pricing_profiles WHERE id=?", (profile_id,)).fetchone()
            db.execute("INSERT INTO pricing_profile_audit(profile_id,store_id,seller_account_id,action,profile_name,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?)",
                       (profile_id, store, seller, "retired", row["name"], json.dumps(profile_payload(updated), default=str), stamp))
        return {"ok": True, "id": profile_id, "version": updated["version"], "retired": True}

    @router.get("/saved-views")
    def saved_views(storeId: str, sellerAccountId: str | None = None):
        store, seller = owner_key(storeId, sellerAccountId)
        with db_connect(control_db) as db:
            rows = db.execute("SELECT * FROM pricing_saved_views WHERE store_id=? AND seller_account_id=? AND archived_at IS NULL ORDER BY is_default DESC,updated_at DESC", (store, seller)).fetchall()
        return {"ok": True, "views": [{"id": r["id"], "name": r["name"], "filters": load_json(r["filters_json"], {}), "isDefault": bool(r["is_default"]), "version": r["version"], "createdAt": r["created_at"], "updatedAt": r["updated_at"]} for r in rows]}

    @router.post("/saved-views")
    def create_saved_view(request: SavedViewMutation):
        store, seller = owner_key(request.storeId, request.sellerAccountId)
        stamp = now_iso()
        view_id = str(uuid.uuid4())
        with db_connect(control_db, writable=True) as db:
            if request.isDefault:
                db.execute("UPDATE pricing_saved_views SET is_default=0,updated_at=? WHERE store_id=? AND seller_account_id=? AND archived_at IS NULL", (stamp, store, seller))
            db.execute("INSERT INTO pricing_saved_views(id,store_id,seller_account_id,name,filters_json,is_default,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                       (view_id, store, seller, request.name[:80], json.dumps(request.filters, sort_keys=True, default=str), 1 if request.isDefault else 0, 1, stamp, stamp))
            row = db.execute("SELECT * FROM pricing_saved_views WHERE id=?", (view_id,)).fetchone()
        return {"ok": True, "view": {"id": row["id"], "name": row["name"], "filters": load_json(row["filters_json"], {}), "isDefault": bool(row["is_default"]), "version": row["version"], "createdAt": row["created_at"], "updatedAt": row["updated_at"]}}

    @router.delete("/saved-views/{view_id}")
    def retire_saved_view(view_id: str, storeId: str, sellerAccountId: str | None = None, expectedVersion: int = 0):
        store, seller = owner_key(storeId, sellerAccountId)
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            row = db.execute("SELECT * FROM pricing_saved_views WHERE id=? AND store_id=? AND seller_account_id=? AND archived_at IS NULL", (view_id, store, seller)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Saved view not found")
            if expectedVersion != row["version"]:
                raise HTTPException(status_code=409, detail="Saved view changed. Reload and try again.")
            db.execute("UPDATE pricing_saved_views SET archived_at=?,is_default=0,version=version+1,updated_at=? WHERE id=?", (stamp, stamp, view_id))
        return {"ok": True, "id": view_id, "version": expectedVersion + 1, "retired": True}

    @router.post("/receipts")
    def create_receipt(request: ReceiptMutation):
        store, seller = owner_key(request.storeId, request.sellerAccountId)
        stamp = now_iso()
        receipt_id = str(uuid.uuid4())
        decision = request.decision or {}
        profile = request.profile or {}
        with db_connect(control_db, writable=True) as db:
            db.execute("""
              INSERT INTO pricing_decision_receipts(id,store_id,seller_account_id,identity_id,profile_id,profile_name,profile_selection,
                decision_status,suggested_list_price,buy_ceiling,market_median,reference_midpoint,estimated_net_proceeds,expected_profit,
                minimum_profitable_list_price,confidence,sold_comp_count,review_reasons_json,marketplace_fee_pct,payment_fee_pct,payment_fixed_fee,
                shipping_cost,target_margin_pct,boundary,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (receipt_id, store, seller, request.identityId, request.profileId, request.profileName, request.profileSelection,
                  text(decision.get("status")) or "insufficient_evidence", num(decision.get("suggestedListPrice")), num(decision.get("buyCeiling")),
                  num(decision.get("marketMedian")), num(decision.get("referenceMidpoint")), num(decision.get("estimatedNetProceeds")),
                  num(decision.get("expectedProfit")), num(decision.get("minimumProfitableListPrice")), num(decision.get("confidence"), 0) or 0,
                  int(num(decision.get("soldCompCount"), 0) or 0), json.dumps(decision.get("reviewReasons") or []),
                  num(profile.get("marketplaceFeePct"), 0.08) or 0.08, num(profile.get("paymentFeePct"), 0.029) or 0.029,
                  num(profile.get("paymentFixedFee"), 0.30) or 0.30, num(profile.get("estimatedShippingCost"), 6.99) or 6.99,
                  num(profile.get("targetMarginPct"), 0.30) or 0.30, "advisory_only", stamp))
        return {"ok": True, "id": receipt_id}

    @router.get("/receipts")
    def receipts(storeId: str, sellerAccountId: str | None = None, limit: int = Query(default=100, ge=1, le=500)):
        store, seller = owner_key(storeId, sellerAccountId)
        with db_connect(control_db) as db:
            rows = db.execute("SELECT * FROM pricing_decision_receipts WHERE store_id=? AND seller_account_id=? ORDER BY created_at DESC LIMIT ?", (store, seller, limit)).fetchall()
        return {"ok": True, "receipts": [receipt_payload(row) for row in rows]}

    @router.get("/command-center")
    def command_center(storeId: str, sellerAccountId: str | None = None):
        store, seller = owner_key(storeId, sellerAccountId)
        with db_connect(control_db) as db:
            receipts = db.execute("SELECT * FROM pricing_decision_receipts WHERE store_id=? AND seller_account_id=? ORDER BY created_at DESC LIMIT 250", (store, seller)).fetchall()
            profiles = db.execute("SELECT * FROM pricing_profiles WHERE store_id=? AND seller_account_id=? AND archived_at IS NULL", (store, seller)).fetchall()
            views = db.execute("SELECT * FROM pricing_saved_views WHERE store_id=? AND seller_account_id=? AND archived_at IS NULL", (store, seller)).fetchall()
            audits = db.execute("SELECT * FROM pricing_profile_audit WHERE store_id=? AND seller_account_id=? ORDER BY created_at DESC LIMIT 25", (store, seller)).fetchall()
        ready = [r for r in receipts if r["decision_status"] == "ready"]
        review = [r for r in receipts if r["decision_status"] == "review_required"]
        insufficient = [r for r in receipts if r["decision_status"] == "insufficient_evidence"]
        avg = lambda values: (sum(values) / len(values)) if values else None
        confidences = [float(r["confidence"]) for r in receipts if r["confidence"] is not None]
        sold_counts = [float(r["sold_comp_count"]) for r in receipts if r["sold_comp_count"] is not None]
        return {"ok": True, "snapshot": {
            "window": {"receiptLimit": 250, "limited": True},
            "receipts": {"total": len(receipts), "ready": len(ready), "reviewRequired": len(review),
                         "insufficientEvidence": len(insufficient), "readyRate": len(ready) / len(receipts) if receipts else None,
                         "averageConfidence": avg(confidences), "averageSoldCompCount": avg(sold_counts),
                         "estimatedProfitAtCeiling": sum(float(r["expected_profit"] or 0) for r in receipts)},
            "profiles": {"active": len(profiles), "hasDefault": any(bool(r["is_default"]) for r in profiles)},
            "savedViews": {"active": len(views), "hasDefault": any(bool(r["is_default"]) for r in views)},
            "audit": [{"id": str(r["id"]), "profileId": r["profile_id"], "action": r["action"], "profileName": r["profile_name"], "createdAt": r["created_at"]} for r in audits],
            "boundary": "advisory_only"}}

    @router.get("/coverage")
    def coverage(limit: int = Query(default=100, ge=1, le=250), offset: int = Query(default=0, ge=0),
                       gapType: str | None = None, sport: str | None = None, search: str | None = None):
        targets = coverage_targets(instacomp_db, sport=sport, search=search)
        if gapType and gapType != "identity_gap":
            targets = []
        total = len(targets)
        page = targets[offset:offset + limit]
        unresolved = sum(r["potentialUnlock"] for r in targets)
        actionable = [r for r in targets if r["actionabilityStatus"] == "actionable"]
        parser = [r for r in targets if r["actionabilityStatus"] == "parser_review"]
        latest = max((r["latestReferenceDate"] or "" for r in targets), default="") or None
        for i, row in enumerate(page, start=offset + 1):
            row["rank"] = i
        return {"ok": True, "coverage": {
            "generatedAt": now_iso(), "boundary": "aggregate_private_reference_only",
            "snapshot": {"dirty": False, "status": "mac_local", "lastRefreshedAt": latest,
                         "lastRefreshDurationMs": None, "sourceSnapshotRefreshedAt": latest, "ageSeconds": None},
            "filters": {"gapType": gapType if gapType == "identity_gap" else None, "sport": sport, "search": search},
            "summary": {"totalGroups": total, "unresolvedRows": unresolved, "actionableGroups": len(actionable),
                        "actionableRows": sum(r["potentialUnlock"] for r in actionable), "parserReviewGroups": len(parser),
                        "parserReviewRows": sum(r["potentialUnlock"] for r in parser), "unmatchedRows": unresolved,
                        "ambiguousRows": 0, "missingReleaseRows": 0, "checklistPendingRows": 0, "setGapRows": 0,
                        "identityGapRows": unresolved, "largestUnlock": max((r["potentialUnlock"] for r in targets), default=0)},
            "pagination": {"limit": limit, "offset": offset, "returned": len(page), "totalGroups": total, "hasMore": offset + len(page) < total},
            "rows": page}}

    @router.get("/work-orders")
    def work_orders(limit: int = Query(default=100, ge=1, le=250), offset: int = Query(default=0, ge=0),
                          status: str | None = None, search: str | None = None):
        targets = {row["attackKey"]: row for row in coverage_targets(instacomp_db, search=search)}
        with db_connect(control_db) as db:
            stored = {r["attack_key"]: r for r in db.execute("SELECT * FROM private_pricing_work_orders").fetchall()}
        keys = list(dict.fromkeys([*targets.keys(), *stored.keys()]))
        rows: list[dict[str, Any]] = []
        for key in keys:
            target = targets.get(key)
            work = stored.get(key)
            work_status = work["status"] if work else "untracked"
            if status and status != work_status and not (status == "resolved" and work_status in {"completed", "dismissed"}):
                continue
            if not target and work:
                target = {"attackKey": key, "sport": work["sport"], "releaseYear": work["release_year"],
                          "manufacturer": work["manufacturer"], "product": work["product"], "setName": work["set_name"],
                          "gapType": work["gap_type"], "actionabilityStatus": work["actionability_status"],
                          "actionabilityReasons": load_json(work["actionability_reasons_json"], []),
                          "recommendedAction": work["recommended_action"], "potentialUnlock": work["potential_unlock"],
                          "distinctCardNumbers": work["distinct_card_numbers"], "latestReferenceDate": work["source_refreshed_at"]}
            rows.append({"attackKey": key, "targetActive": key in targets, **target,
                         "sourceRefreshedAt": target.get("latestReferenceDate"), "workOrder": work_order_payload(work)})
        status_order = {"in_progress": 0, "blocked": 1, "queued": 2, "untracked": 3, "completed": 4, "dismissed": 5}
        rows.sort(key=lambda r: (0 if r["targetActive"] else 1, status_order.get(r["workOrder"]["status"], 9),
                                 r["workOrder"]["priority"], -int(r.get("potentialUnlock") or 0)))
        for index, row in enumerate(rows, start=1):
            row["rank"] = index
        summary_rows = rows
        page = rows[offset:offset + limit]
        count = lambda state: sum(1 for r in summary_rows if r["workOrder"]["status"] == state)
        return {"ok": True, "workOrders": {
            "generatedAt": now_iso(), "boundary": "private_coverage_work_orders_only",
            "filters": {"status": status, "search": search},
            "summary": {"totalTargets": len(summary_rows), "trackedTargets": sum(1 for r in summary_rows if r["workOrder"]["status"] != "untracked"),
                        "untrackedTargets": count("untracked"), "queuedTargets": count("queued"), "inProgressTargets": count("in_progress"),
                        "blockedTargets": count("blocked"), "resolvedTargets": count("completed") + count("dismissed"),
                        "completedTargets": count("completed"), "dismissedTargets": count("dismissed"),
                        "inactiveTargets": sum(1 for r in summary_rows if not r["targetActive"]),
                        "activePotentialUnlock": sum(int(r.get("potentialUnlock") or 0) for r in summary_rows if r["targetActive"])},
            "pagination": {"limit": limit, "offset": offset, "returned": len(page), "totalTargets": len(summary_rows),
                           "hasMore": offset + len(page) < len(summary_rows)}, "rows": page}}

    @router.post("/work-orders")
    def save_work_order(request: WorkOrderMutation):
        allowed = {"queued", "in_progress", "blocked", "completed", "dismissed"}
        if request.status not in allowed:
            raise HTTPException(status_code=400, detail="Unsupported private pricing work-order status")
        targets = {row["attackKey"]: row for row in coverage_targets(instacomp_db)}
        target = targets.get(request.attackKey)
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            current = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (request.attackKey,)).fetchone()
            if current is None and target is None:
                raise HTTPException(status_code=404, detail="This private pricing coverage target is no longer active")
            if current is None:
                if request.expectedVersion not in (0, None):
                    raise HTTPException(status_code=409, detail="This work order changed. Reload and try again.")
                db.execute("""
                  INSERT INTO private_pricing_work_orders(attack_key,status,priority,notes,version,sport,release_year,manufacturer,product,set_name,
                    gap_type,actionability_status,actionability_reasons_json,recommended_action,potential_unlock,distinct_card_numbers,
                    source_refreshed_at,last_seen_at,started_at,blocked_at,completed_at,dismissed_at,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (request.attackKey, request.status, max(1, min(request.priority, 5)), request.notes[:2000], 1,
                      target["sport"], target["releaseYear"], target["manufacturer"], target["product"], target["setName"], target["gapType"],
                      target["actionabilityStatus"], json.dumps(target["actionabilityReasons"]), target["recommendedAction"], target["potentialUnlock"],
                      target["distinctCardNumbers"], target["latestReferenceDate"], stamp,
                      stamp if request.status == "in_progress" else None, stamp if request.status == "blocked" else None,
                      stamp if request.status == "completed" else None, stamp if request.status == "dismissed" else None, stamp, stamp))
                saved = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (request.attackKey,)).fetchone()
                add_event(db, request.attackKey, "created", saved, notes_changed=bool(request.notes))
            else:
                if request.expectedVersion != current["version"]:
                    raise HTTPException(status_code=409, detail="This work order changed. Reload and try again.")
                source = target or {"sport": current["sport"], "releaseYear": current["release_year"], "manufacturer": current["manufacturer"],
                                    "product": current["product"], "setName": current["set_name"], "gapType": current["gap_type"],
                                    "actionabilityStatus": current["actionability_status"], "actionabilityReasons": load_json(current["actionability_reasons_json"], []),
                                    "recommendedAction": current["recommended_action"], "potentialUnlock": current["potential_unlock"],
                                    "distinctCardNumbers": current["distinct_card_numbers"], "latestReferenceDate": current["source_refreshed_at"]}
                notes_changed = request.notes[:2000] != current["notes"]
                db.execute("""
                  UPDATE private_pricing_work_orders SET status=?,priority=?,notes=?,version=version+1,sport=?,release_year=?,manufacturer=?,product=?,set_name=?,
                    gap_type=?,actionability_status=?,actionability_reasons_json=?,recommended_action=?,potential_unlock=?,distinct_card_numbers=?,source_refreshed_at=?,
                    last_seen_at=?,started_at=COALESCE(started_at,?),blocked_at=?,completed_at=?,dismissed_at=?,updated_at=? WHERE attack_key=?
                """, (request.status, max(1, min(request.priority, 5)), request.notes[:2000], source["sport"], source["releaseYear"], source["manufacturer"],
                      source["product"], source["setName"], source["gapType"], source["actionabilityStatus"], json.dumps(source["actionabilityReasons"]),
                      source["recommendedAction"], source["potentialUnlock"], source["distinctCardNumbers"], source["latestReferenceDate"], stamp,
                      stamp if request.status == "in_progress" else current["started_at"], stamp if request.status == "blocked" else current["blocked_at"],
                      stamp if request.status == "completed" else current["completed_at"], stamp if request.status == "dismissed" else current["dismissed_at"],
                      stamp, request.attackKey))
                saved = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (request.attackKey,)).fetchone()
                add_event(db, request.attackKey, "updated", saved, notes_changed=notes_changed)
        return {"ok": True, "workOrder": work_order_payload(saved)}

    def execution_row(row: sqlite3.Row) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        due = None
        review = None
        try:
            due = datetime.fromisoformat(row["due_at"]) if row["due_at"] else None
            review = datetime.fromisoformat(row["next_review_at"]) if row["next_review_at"] else None
        except (TypeError, ValueError):
            pass
        if row["status"] == "blocked": lane = "blocked"
        elif row["status"] in {"completed", "dismissed"}: lane = "recently_resolved"
        elif due and due < now: lane = "overdue"
        elif review and review <= now: lane = "due_for_review"
        elif row["assignee"]: lane = "assigned"
        else: lane = "unassigned"
        return {"attackKey": row["attack_key"], "lane": lane, "status": row["status"], "priority": row["priority"],
                "version": row["version"], "assignee": row["assignee"], "claimedAt": row["claimed_at"], "releasedAt": row["released_at"],
                "dueAt": row["due_at"], "nextReviewAt": row["next_review_at"], "blockedReason": row["blocked_reason"],
                "resolutionCode": row["resolution_code"], "updatedAt": row["updated_at"], "sport": row["sport"],
                "releaseYear": row["release_year"], "manufacturer": row["manufacturer"], "product": row["product"],
                "setName": row["set_name"], "gapType": row["gap_type"], "actionabilityStatus": row["actionability_status"],
                "potentialUnlock": row["potential_unlock"]}

    @router.get("/work-orders/execution")
    def execution(limit: int = Query(default=100, ge=1, le=250), offset: int = Query(default=0, ge=0),
                        lane: str | None = None, search: str | None = None, sort: str = "unlock_desc"):
        with db_connect(control_db) as db:
            rows = [execution_row(r) for r in db.execute("SELECT * FROM private_pricing_work_orders").fetchall()]
        if lane:
            rows = [r for r in rows if r["lane"] == lane]
        needle = text(search).lower()
        if needle:
            rows = [r for r in rows if needle in " ".join(text(r.get(k)) for k in ("attackKey","releaseYear","manufacturer","product","sport","setName","gapType","assignee","status","lane","blockedReason","resolutionCode")).lower()]
        if sort == "priority_asc": rows.sort(key=lambda r: (r["priority"], -int(r["potentialUnlock"] or 0)))
        elif sort == "due_asc": rows.sort(key=lambda r: (r["dueAt"] or "9999", -int(r["potentialUnlock"] or 0)))
        elif sort == "target_asc": rows.sort(key=lambda r: f"{r['releaseYear']} {r['manufacturer']} {r['product']} {r['setName']} {r['sport']}")
        else: rows.sort(key=lambda r: -int(r["potentialUnlock"] or 0))
        for i, row in enumerate(rows, 1): row["rank"] = i
        page = rows[offset:offset + limit]
        lanes = {name: sum(1 for r in rows if r["lane"] == name) for name in ("unassigned","assigned","overdue","blocked","due_for_review","recently_resolved")}
        return {"ok": True, "execution": {"generatedAt": now_iso(), "boundary": "private_coverage_work_order_execution_only",
            "filters": {"lane": lane, "search": search, "sort": sort},
            "summary": {"totalTargets": len(rows), "unassignedTargets": lanes["unassigned"], "assignedTargets": lanes["assigned"],
                        "overdueTargets": lanes["overdue"], "blockedTargets": lanes["blocked"], "dueForReviewTargets": lanes["due_for_review"],
                        "recentlyResolvedTargets": lanes["recently_resolved"]},
            "pagination": {"limit": limit, "offset": offset, "returned": len(page), "totalTargets": len(rows), "hasMore": offset + len(page) < len(rows)}, "rows": page}}
    @router.post("/work-orders/execution")
    def mutate_execution(request: ExecutionMutation):
        allowed_ops = {"claim", "release", "update", "resolve"}
        if request.operation not in allowed_ops:
            raise HTTPException(status_code=400, detail="Unsupported execution operation")
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            row = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (request.attackKey,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="This work order is unavailable. Reload the queue.")
            if request.expectedVersion != row["version"]:
                raise HTTPException(status_code=409, detail="This work order changed. Reload and try again.")
            status = row["status"]
            assignee = row["assignee"]
            claimed_at = row["claimed_at"]
            released_at = row["released_at"]
            resolution = row["resolution_code"]
            resolved_at = row["resolved_at"]
            if request.operation == "claim":
                assignee = text(request.assignee) or "admin"
                claimed_at = stamp
                released_at = None
            elif request.operation == "release":
                assignee = None
                released_at = stamp
            elif request.operation == "resolve":
                status = "completed"
                resolution = text(request.resolutionCode) or "coverage_fixed"
                resolved_at = stamp
            priority = request.priority if request.priority is not None else row["priority"]
            db.execute("""
              UPDATE private_pricing_work_orders SET status=?,priority=?,assignee=?,claimed_at=?,released_at=?,due_at=?,blocked_reason=?,
                resolution_code=?,resolved_at=?,completed_at=?,version=version+1,updated_at=? WHERE attack_key=?
            """, (status, max(1, min(priority, 5)), assignee, claimed_at, released_at,
                  request.dueAt if request.dueAt is not None else row["due_at"],
                  request.blockedReason if request.blockedReason is not None else row["blocked_reason"], resolution, resolved_at,
                  stamp if status == "completed" else row["completed_at"], stamp, request.attackKey))
            saved = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (request.attackKey,)).fetchone()
            action = {"claim": "claimed", "release": "released", "update": "execution_updated", "resolve": "resolution_recorded"}[request.operation]
            add_event(db, request.attackKey, action, saved, metadata={"assignee": saved["assignee"], "dueAt": saved["due_at"], "resolutionCode": saved["resolution_code"]})
        return {"ok": True, "workOrder": execution_row(saved)}
    @router.get("/work-orders/reviews")
    def reviews(limit: int = Query(default=100, ge=1, le=250), offset: int = Query(default=0, ge=0), reviewState: str | None = None):
        now = datetime.now(timezone.utc)
        with db_connect(control_db) as db:
            source = db.execute("SELECT * FROM private_pricing_work_orders WHERE status NOT IN ('completed','dismissed')").fetchall()
        rows = []
        for raw in source:
            next_review = None
            try: next_review = datetime.fromisoformat(raw["next_review_at"]) if raw["next_review_at"] else None
            except (TypeError, ValueError): pass
            if next_review is None: state = "unscheduled"
            elif next_review < now: state = "overdue"
            elif (next_review - now).total_seconds() <= 86400: state = "due_soon"
            else: state = "scheduled"
            if reviewState and state != reviewState: continue
            rows.append({**execution_row(raw), "reviewState": state})
        rows.sort(key=lambda r: (0 if r["reviewState"] == "overdue" else 1, r["nextReviewAt"] or "9999"))
        page = rows[offset:offset + limit]
        return {"ok": True, "reviews": {"generatedAt": now_iso(), "boundary": "private_coverage_work_order_reviews_only",
            "filters": {"reviewState": reviewState}, "summary": {"totalTargets": len(rows),
                "overdueTargets": sum(1 for r in rows if r["reviewState"] == "overdue"),
                "dueSoonTargets": sum(1 for r in rows if r["reviewState"] == "due_soon"),
                "scheduledTargets": sum(1 for r in rows if r["reviewState"] == "scheduled"),
                "unscheduledTargets": sum(1 for r in rows if r["reviewState"] == "unscheduled")},
            "pagination": {"limit": limit, "offset": offset, "returned": len(page), "totalTargets": len(rows), "hasMore": offset + len(page) < len(rows)},
            "rows": page}}

    @router.post("/work-orders/reviews")
    def schedule_review(request: ReviewMutation):
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            row = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (request.attackKey,)).fetchone()
            if not row: raise HTTPException(status_code=404, detail="This work order is no longer eligible for review scheduling.")
            if request.expectedVersion != row["version"]: raise HTTPException(status_code=409, detail="This work order changed. Reload and try again.")
            db.execute("UPDATE private_pricing_work_orders SET next_review_at=?,version=version+1,updated_at=? WHERE attack_key=?", (request.nextReviewAt, stamp, request.attackKey))
            saved = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (request.attackKey,)).fetchone()
            add_event(db, request.attackKey, "review_scheduled" if request.nextReviewAt else "review_cleared", saved,
                      metadata={"nextReviewAt": request.nextReviewAt})
        return {"ok": True, "review": execution_row(saved)}
    @router.get("/work-orders/activity")
    def activity(limit: int = Query(default=100, ge=1, le=250), offset: int = Query(default=0, ge=0),
                       action: str | None = None, actorType: str | None = None):
        with db_connect(control_db) as db:
            rows = db.execute("SELECT e.*,w.sport,w.release_year,w.manufacturer,w.product,w.set_name,w.gap_type,w.actionability_status FROM private_pricing_work_order_events e LEFT JOIN private_pricing_work_orders w ON w.attack_key=e.attack_key ORDER BY e.created_at DESC").fetchall()
        payload = []
        for raw in rows:
            if action and raw["action"] != action: continue
            if actorType and raw["actor_type"] != actorType: continue
            payload.append({"rank": len(payload) + 1, "attackKey": raw["attack_key"], "action": raw["action"], "status": raw["status"],
                            "priority": raw["priority"], "version": raw["version"], "notesChanged": bool(raw["notes_changed"]),
                            "actorType": raw["actor_type"], "createdAt": raw["created_at"], "targetActive": raw["sport"] is not None,
                            "sport": raw["sport"] or "Unknown", "releaseYear": raw["release_year"] or "Unknown",
                            "manufacturer": raw["manufacturer"] or "Unknown", "product": raw["product"] or "Unknown",
                            "setName": raw["set_name"] or "Base / Unspecified", "gapType": raw["gap_type"],
                            "actionabilityStatus": raw["actionability_status"]})
        page = payload[offset:offset + limit]
        return {"ok": True, "activity": {"generatedAt": now_iso(), "boundary": "private_coverage_work_order_activity_only",
            "filters": {"action": action, "actorType": actorType},
            "pagination": {"limit": limit, "offset": offset, "returned": len(page), "totalEvents": len(payload), "hasMore": offset + len(page) < len(payload)},
            "rows": page}}

    @router.get("/work-orders/{attack_key}/history")
    def target_history(attack_key: str, limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0)):
        with db_connect(control_db) as db:
            work = db.execute("SELECT * FROM private_pricing_work_orders WHERE attack_key=?", (attack_key,)).fetchone()
            if not work: raise HTTPException(status_code=404, detail="This work order is unavailable. Reload the queue.")
            events = db.execute("SELECT * FROM private_pricing_work_order_events WHERE attack_key=? ORDER BY created_at DESC", (attack_key,)).fetchall()
        page = events[offset:offset + limit]
        counts = lambda action: sum(1 for e in events if e["action"] == action)
        return {"ok": True, "history": {"generatedAt": now_iso(), "boundary": "private_coverage_work_order_target_history_only",
            "target": {"status": work["status"], "priority": work["priority"], "version": work["version"], "targetActive": True,
                       "sport": work["sport"], "releaseYear": work["release_year"], "manufacturer": work["manufacturer"],
                       "product": work["product"], "setName": work["set_name"], "gapType": work["gap_type"],
                       "actionabilityStatus": work["actionability_status"]},
            "summary": {"totalEvents": len(events), "adminEvents": sum(1 for e in events if e["actor_type"] == "admin"),
                        "systemEvents": sum(1 for e in events if e["actor_type"] == "system"),
                        "noteChangeEvents": sum(1 for e in events if e["notes_changed"]), "createdEvents": counts("created"),
                        "updatedEvents": counts("updated"), "autoResolvedEvents": counts("auto_resolved"),
                        "autoReopenedEvents": counts("auto_reopened"), "reviewScheduledEvents": counts("review_scheduled"),
                        "reviewClearedEvents": counts("review_cleared"), "claimedEvents": counts("claimed"),
                        "releasedEvents": counts("released"), "executionUpdatedEvents": counts("execution_updated"),
                        "resolutionRecordedEvents": counts("resolution_recorded")},
            "pagination": {"limit": limit, "offset": offset, "returned": len(page), "totalEvents": len(events), "hasMore": offset + len(page) < len(events)},
            "rows": [{"rank": offset + i + 1, "action": e["action"], "status": e["status"] or "queued", "priority": e["priority"] or 3,
                      "version": e["version"] or 0, "notesChanged": bool(e["notes_changed"]), "actorType": e["actor_type"], "createdAt": e["created_at"]}
                     for i, e in enumerate(page)]}}

    @router.get("/work-orders/scoreboard")
    def scoreboard():
        with db_connect(control_db) as db:
            rows = [execution_row(r) for r in db.execute("SELECT * FROM private_pricing_work_orders").fetchall()]
        now = datetime.now(timezone.utc)
        def due_soon(row: dict[str, Any]) -> bool:
            if not row.get("dueAt"): return False
            try:
                due = datetime.fromisoformat(row["dueAt"])
                return 0 <= (due - now).total_seconds() <= 86400
            except Exception: return False
        priorities = []
        for priority in range(1, 6):
            matching = [r for r in rows if r["priority"] == priority]
            priorities.append({"priority": priority, "targets": len(matching), "potentialUnlock": sum(int(r["potentialUnlock"] or 0) for r in matching),
                               "overdueTargets": sum(1 for r in matching if r["lane"] == "overdue"),
                               "blockedTargets": sum(1 for r in matching if r["lane"] == "blocked")})
        workloads: dict[str, dict[str, Any]] = {}
        for row in rows:
            assignee = text(row.get("assignee"))
            if not assignee: continue
            current = workloads.setdefault(assignee, {"assignee": assignee, "targets": 0, "potentialUnlock": 0,
                "overdueTargets": 0, "blockedTargets": 0, "highPriorityTargets": 0, "dueWithin24HoursTargets": 0})
            current["targets"] += 1
            current["potentialUnlock"] += int(row["potentialUnlock"] or 0)
            current["overdueTargets"] += 1 if row["lane"] == "overdue" else 0
            current["blockedTargets"] += 1 if row["lane"] == "blocked" else 0
            current["highPriorityTargets"] += 1 if row["priority"] <= 2 else 0
            current["dueWithin24HoursTargets"] += 1 if due_soon(row) else 0
        assignees = sorted(workloads.values(), key=lambda r: (-r["overdueTargets"], -r["highPriorityTargets"], -r["potentialUnlock"], r["assignee"]))[:25]
        return {"ok": True, "scoreboard": {"generatedAt": now_iso(), "boundary": "private_coverage_work_order_scoreboard_only",
            "summary": {"totalTargets": len(rows), "totalPotentialUnlock": sum(int(r["potentialUnlock"] or 0) for r in rows),
                        "unassignedTargets": sum(1 for r in rows if not r["assignee"]), "assignedTargets": sum(1 for r in rows if r["assignee"]),
                        "overdueTargets": sum(1 for r in rows if r["lane"] == "overdue"), "blockedTargets": sum(1 for r in rows if r["lane"] == "blocked"),
                        "highPriorityTargets": sum(1 for r in rows if r["priority"] <= 2),
                        "highPriorityUnassignedTargets": sum(1 for r in rows if r["priority"] <= 2 and not r["assignee"]),
                        "dueWithin24HoursTargets": sum(1 for r in rows if due_soon(r)), "activeAssignees": len(workloads)},
            "priorities": priorities, "assignees": assignees}}

    @router.get("/delivery/latest-sent")
    def latest_sent():
        with db_connect(control_db) as db:
            row = db.execute("SELECT fingerprint FROM kingmaker_delivery_runs WHERE status='sent' ORDER BY completed_at DESC,id DESC LIMIT 1").fetchone()
        return {"ok": True, "fingerprint": row["fingerprint"] if row else None}

    @router.post("/delivery/claim")
    def delivery_claim(request: dict[str, Any]):
        fingerprint = text(request.get("fingerprint"))
        delivery_key = text(request.get("deliveryKey"))
        claim_token = text(request.get("claimToken"))
        if not fingerprint or not delivery_key or not claim_token:
            raise HTTPException(status_code=400, detail="Delivery claim is incomplete")
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            row = db.execute("SELECT * FROM kingmaker_delivery_runs WHERE fingerprint=?", (fingerprint,)).fetchone()
            if row and row["status"] in {"claimed", "sent"}:
                return {"ok": True, "claim": None}
            if row:
                db.execute("UPDATE kingmaker_delivery_runs SET status='claimed',payload_json=?,claimed_at=?,error=NULL,updated_at=? WHERE fingerprint=?",
                           (json.dumps(request, sort_keys=True, default=str), stamp, stamp, fingerprint))
            else:
                db.execute("INSERT INTO kingmaker_delivery_runs(fingerprint,status,payload_json,claimed_at,created_at,updated_at) VALUES(?,?,?,?,?,?)",
                           (fingerprint, "claimed", json.dumps(request, sort_keys=True, default=str), stamp, stamp, stamp))
            saved = db.execute("SELECT * FROM kingmaker_delivery_runs WHERE fingerprint=?", (fingerprint,)).fetchone()
        return {"ok": True, "claim": {"id": str(saved["id"]), "delivery_key": delivery_key, "status": "claimed", "claim_token": claim_token, "claimed_at": stamp}}
    @router.post("/delivery/{run_id}/complete")
    def delivery_complete(run_id: str, request: dict[str, Any]):
        status = text(request.get("status"))
        if status not in {"sent", "failed"}:
            raise HTTPException(status_code=400, detail="Unsupported delivery completion status")
        stamp = now_iso()
        with db_connect(control_db, writable=True) as db:
            row = db.execute("SELECT * FROM kingmaker_delivery_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Delivery claim not found")
            payload = load_json(row["payload_json"], {}) or {}
            expected_token = text(payload.get("claimToken"))
            supplied_token = text(request.get("claimToken"))
            if expected_token and supplied_token != expected_token:
                raise HTTPException(status_code=409, detail="Delivery claim token mismatch")
            detail = dict(payload)
            detail["completion"] = request
            db.execute("UPDATE kingmaker_delivery_runs SET status=?,payload_json=?,completed_at=?,error=?,updated_at=? WHERE id=? AND status='claimed'",
                       (status, json.dumps(detail, sort_keys=True, default=str), stamp,
                        text(request.get("errorCode")) or None, stamp, run_id))
        return {"ok": True, "status": status, "completedAt": stamp}

    return router
