from __future__ import annotations

import json
import re
import os
import sqlite3
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query
from pydantic import BaseModel, Field

from .config import settings
from .deal_hunter_store import DealHunterStore
from .kingmaker_accounting import KingmakerAccounting
from .kingmaker_accounting_routes import build_kingmaker_accounting_router
from .kingmaker_pricing_control import build_kingmaker_pricing_router

PORT = 8796
settings.ensure_directories()
DATA_DIR = settings.resolve_local_path(settings.data_database_path)
CONTROL_DB = Path(os.environ.get("KINGMAKER_CONTROL_DB") or (DATA_DIR / "kingmaker_control.sqlite3")).expanduser().resolve()
DEAL_HUNTER_DB = settings.resolve_local_path(settings.deal_hunter_database_path)
ACCOUNTING_DB = DATA_DIR / "kingmaker_accounting.sqlite3"
COMMERCIAL_DB = DATA_DIR / "kingmaker_commercial_inventory.sqlite3"
INSTACOMP_DB = settings.resolve_local_path(settings.database_path)
REGISTRY_DB = DATA_DIR / "checklist_registry.sqlite3"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def text(value: Any) -> str:
    return str(value or "").strip()


def number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def json_load(value: Any, fallback: Any = None) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(str(value))
    except Exception:
        return fallback


def require_api_key(x_instacomp_ai_key: str | None = Header(default=None)) -> None:
    if settings.api_key and x_instacomp_ai_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid InstaComp AI key")


@contextmanager
def connect(path: Path, *, writable: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if writable:
        db = sqlite3.connect(path, timeout=30)
    else:
        if not path.exists():
            raise FileNotFoundError(str(path))
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=30000")
    try:
        yield db
        if writable:
            db.commit()
    finally:
        db.close()


def initialize_control_db() -> None:
    with connect(CONTROL_DB, writable=True) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS opportunities (
                id TEXT PRIMARY KEY,
                source_type TEXT NOT NULL,
                source_key TEXT NOT NULL UNIQUE,
                source_watch TEXT,
                title TEXT NOT NULL,
                direct_url TEXT,
                marketplace TEXT,
                seller_name TEXT,
                asking_price REAL,
                shipping_price REAL,
                buyer_fee REAL,
                delivered_cost REAL,
                identity_status TEXT NOT NULL DEFAULT 'review_required',
                market_status TEXT NOT NULL DEFAULT 'unverified',
                lifecycle_status TEXT NOT NULL DEFAULT 'new',
                owner_decision TEXT,
                owner_decision_reason TEXT,
                decision_at TEXT,
                purchase_reference TEXT,
                first_seen_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                expires_at TEXT,
                identity_json TEXT NOT NULL DEFAULT '{}',
                exact_market_json TEXT NOT NULL DEFAULT '{}',
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS kingmaker_opportunities_status_idx
              ON opportunities(lifecycle_status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS kingmaker_opportunities_truth_idx
              ON opportunities(identity_status, market_status, updated_at DESC);

            CREATE TABLE IF NOT EXISTS opportunity_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                opportunity_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                actor_type TEXT NOT NULL,
                prior_status TEXT,
                next_status TEXT,
                reason TEXT,
                metadata_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(opportunity_id) REFERENCES opportunities(id)
            );
            CREATE INDEX IF NOT EXISTS kingmaker_events_opportunity_idx
              ON opportunity_events(opportunity_id, created_at DESC);
            """
        )


def truth_for_row(row: sqlite3.Row | dict[str, Any]) -> tuple[bool, list[str]]:
    get = row.__getitem__ if isinstance(row, sqlite3.Row) else row.get
    lifecycle = text(get("lifecycle_status"))
    owner = text(get("owner_decision"))
    identity = text(get("identity_status"))
    market = text(get("market_status"))
    purchase = text(get("purchase_reference"))
    warnings: list[str] = []
    if lifecycle == "bought" and not purchase:
        warnings.append("bought_without_purchase_reference")
    if purchase and lifecycle != "bought":
        warnings.append("purchase_reference_linked_before_bought_status")
    if identity == "verified_exact" and market != "verified_completed_sales":
        warnings.append("verified_identity_without_verified_completed_sales")
    if owner == "buy" and (identity != "verified_exact" or market != "verified_completed_sales"):
        warnings.append("buy_decision_without_truth_gates")
    return len(warnings) == 0, warnings


def identity_status(candidate: dict[str, Any]) -> str:
    identity = as_record(candidate.get("identity"))
    checklist = text(identity.get("internalChecklistOutcome"))
    confidence = number(identity.get("confidence")) or 0.0
    if candidate.get("actionable") is True and checklist == "exact_match" and confidence >= 0.85:
        return "verified_exact"
    return "review_required"


def market_status(candidate: dict[str, Any]) -> str:
    exact = as_record(candidate.get("exact_market"))
    count = int(number(exact.get("pricingEligibleSoldCount")) or number(exact.get("soldCount")) or 0)
    if text(exact.get("status")).lower() == "ready" and count >= 2:
        return "verified_completed_sales"
    if count > 0:
        return "insufficient_sales"
    return "unverified"


def candidate_opportunity_id(candidate_key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"tcos-kingmaker:{candidate_key}"))


def sync_deal_hunter(limit: int = 500) -> int:
    store = DealHunterStore(DEAL_HUNTER_DB)
    candidates = store.recent_candidates(limit=max(1, min(limit, 500)))
    stamp = now_iso()
    changed = 0
    with connect(CONTROL_DB, writable=True) as db:
        for candidate in candidates:
            source_key = text(candidate.get("candidate_key"))
            if not source_key:
                continue
            oid = candidate_opportunity_id(source_key)
            existing = db.execute(
                "SELECT lifecycle_status,owner_decision,owner_decision_reason,decision_at,purchase_reference,first_seen_at FROM opportunities WHERE source_key=?",
                (source_key,),
            ).fetchone()
            source_type = text(candidate.get("marketplace")).lower().replace(" ", "_") or "other"
            if source_type == "fanatics_collect":
                source_type = "fanatics_collect"
            first_seen = text(existing["first_seen_at"]) if existing else text(candidate.get("created_at")) or stamp
            lifecycle = text(existing["lifecycle_status"]) if existing else "new"
            owner_decision = existing["owner_decision"] if existing else None
            owner_reason = existing["owner_decision_reason"] if existing else None
            decision_at = existing["decision_at"] if existing else None
            purchase_reference = existing["purchase_reference"] if existing else None
            metadata = {
                "runId": candidate.get("run_id"),
                "lane": candidate.get("lane"),
                "watchedPerson": candidate.get("watched_person"),
                "listingItemId": candidate.get("listing_item_id"),
                "status": candidate.get("status"),
                "conservativeResale": candidate.get("conservative_resale"),
                "expectedNetProfit": candidate.get("expected_net_profit"),
                "roiPercent": candidate.get("roi_percent"),
                "dealLabel": candidate.get("deal_label"),
                "actionable": bool(candidate.get("actionable")),
                "alertworthy": bool(candidate.get("alertworthy")),
                "errorCode": candidate.get("error_code"),
                "errorMessage": candidate.get("error_message"),
                "imageUrls": candidate.get("image_urls") or [],
            }
            db.execute(
                """
                INSERT INTO opportunities (
                    id,source_type,source_key,source_watch,title,direct_url,marketplace,seller_name,
                    asking_price,shipping_price,buyer_fee,delivered_cost,identity_status,market_status,
                    lifecycle_status,owner_decision,owner_decision_reason,decision_at,purchase_reference,
                    first_seen_at,last_seen_at,expires_at,identity_json,exact_market_json,metadata_json,
                    created_at,updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(source_key) DO UPDATE SET
                    source_watch=excluded.source_watch,title=excluded.title,direct_url=excluded.direct_url,
                    marketplace=excluded.marketplace,seller_name=excluded.seller_name,
                    asking_price=excluded.asking_price,shipping_price=excluded.shipping_price,
                    buyer_fee=excluded.buyer_fee,delivered_cost=excluded.delivered_cost,
                    identity_status=excluded.identity_status,market_status=excluded.market_status,
                    last_seen_at=excluded.last_seen_at,identity_json=excluded.identity_json,
                    exact_market_json=excluded.exact_market_json,metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    oid, source_type, source_key, text(candidate.get("watched_person")) or None,
                    text(candidate.get("title")) or "Untitled opportunity", text(candidate.get("listing_url")) or None,
                    text(candidate.get("marketplace")) or None, text(candidate.get("seller_name")) or None,
                    number(candidate.get("item_price")), number(candidate.get("inbound_shipping")),
                    number(candidate.get("buyer_fees")), number(candidate.get("delivered_cost")),
                    identity_status(candidate), market_status(candidate), lifecycle, owner_decision, owner_reason,
                    decision_at, purchase_reference, first_seen, text(candidate.get("created_at")) or stamp, None,
                    json.dumps(candidate.get("identity") or {}, sort_keys=True, default=str),
                    json.dumps(candidate.get("exact_market") or {}, sort_keys=True, default=str),
                    json.dumps(metadata, sort_keys=True, default=str), first_seen, stamp,
                ),
            )
            changed += 1
    return changed


def opportunity_payload(row: sqlite3.Row) -> dict[str, Any]:
    consistent, warnings = truth_for_row(row)
    return {
        "id": row["id"],
        "sourceType": row["source_type"],
        "sourceKey": row["source_key"],
        "sourceWatch": row["source_watch"],
        "title": row["title"],
        "directUrl": row["direct_url"],
        "marketplace": row["marketplace"],
        "sellerName": row["seller_name"],
        "askingPrice": row["asking_price"],
        "shippingPrice": row["shipping_price"],
        "buyerFee": row["buyer_fee"],
        "deliveredCost": row["delivered_cost"],
        "identityStatus": row["identity_status"],
        "marketStatus": row["market_status"],
        "lifecycleStatus": row["lifecycle_status"],
        "ownerDecision": row["owner_decision"],
        "ownerDecisionReason": row["owner_decision_reason"],
        "decisionAt": row["decision_at"],
        "purchaseReference": row["purchase_reference"],
        "firstSeenAt": row["first_seen_at"],
        "lastSeenAt": row["last_seen_at"],
        "updatedAt": row["updated_at"],
        "identity": json_load(row["identity_json"], {}),
        "exactMarket": json_load(row["exact_market_json"], {}),
        "metadata": json_load(row["metadata_json"], {}),
        "truthConsistent": consistent,
        "truthWarnings": warnings,
    }


def truth_health() -> dict[str, Any]:
    initialize_control_db()
    sync_deal_hunter()
    with connect(CONTROL_DB) as db:
        rows = db.execute(
            "SELECT * FROM opportunities WHERE lifecycle_status <> 'archived' ORDER BY updated_at DESC"
        ).fetchall()
    inconsistent: list[dict[str, Any]] = []
    warnings: list[str] = []
    for row in rows:
        consistent, row_warnings = truth_for_row(row)
        if not consistent:
            inconsistent.append({"id": row["id"], "warnings": row_warnings})
            warnings.extend(row_warnings)
    return {
        "ready": len(inconsistent) == 0,
        "opportunities": len(rows),
        "inconsistent": len(inconsistent),
        "warnings": warnings,
        "lastUpdatedAt": rows[0]["updated_at"] if rows else None,
    }


def database_count(
    path: Path,
    table: str,
    *,
    approximate: bool = False,
) -> int | None:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table):
        return None
    try:
        with connect(path) as db:
            if approximate:
                # Health/operations cards do not need to full-scan multi-GB
                # databases just to display a row magnitude. Prefer SQLite's
                # planner statistics when present; otherwise use the table
                # rowid high-water mark. Exact business decisions never use
                # this approximate path.
                estimates: list[int] = []
                try:
                    stats = db.execute(
                        "SELECT stat FROM sqlite_stat1 WHERE tbl=? AND stat IS NOT NULL",
                        (table,),
                    ).fetchall()
                    for stat_row in stats:
                        first = str(stat_row["stat"] or "").split(" ", 1)[0]
                        if first.isdigit():
                            estimates.append(int(first))
                except sqlite3.OperationalError:
                    pass
                if estimates:
                    return max(estimates)
                row = db.execute(
                    f'SELECT MAX(rowid) AS c FROM "{table}"'
                ).fetchone()
                return int(row["c"] if row and row["c"] is not None else 0)

            row = db.execute(f'SELECT COUNT(*) AS c FROM "{table}"').fetchone()
            return int(row["c"] if row else 0)
    except Exception:
        return None


def http_health(url: str, timeout: float = 2.0) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            payload = json.loads(body) if body else {}
        return {"ok": True, "detail": payload}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}


def capital_summary(limit: int = 50) -> dict[str, Any]:
    KingmakerAccounting(ACCOUNTING_DB, INSTACOMP_DB).initialize()
    with connect(ACCOUNTING_DB) as db:
        summary = db.execute(
            """
            SELECT COUNT(*) AS acquisitions,
                   SUM(CASE WHEN cost_status='known' THEN allocated_cost ELSE 0 END) AS deployed,
                   SUM(CASE WHEN cost_status='unknown' THEN 1 ELSE 0 END) AS unknown_costs,
                   SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) AS sold,
                   SUM(CASE WHEN status='pending_purchase' THEN 1 ELSE 0 END) AS pending
            FROM acquisition_items
            WHERE status!='superseded'
            """
        ).fetchone()
        receipt_rows = db.execute(
            "SELECT inventory_state, COUNT(*) AS c FROM physical_inventory_receipts GROUP BY inventory_state"
        ).fetchall()
        recent = db.execute(
            """
            SELECT id,purchase_id,source,purchased_at,title,player,year,brand,set_name,card_number,
                   parallel,allocated_cost,cost_status,status,seller,order_number,listing_url,created_at
            FROM acquisition_items WHERE status!='superseded' ORDER BY COALESCE(purchased_at,created_at) DESC, id DESC LIMIT ?
            """,
            (max(1, min(limit, 200)),),
        ).fetchall()
        sale = db.execute(
            "SELECT COUNT(*) AS c, COALESCE(SUM(net_proceeds),0) AS net, COALESCE(SUM(net_profit),0) AS profit FROM realized_sales"
        ).fetchone()
    commercial = {"items": 0, "quantity": 0, "active": 0}
    if COMMERCIAL_DB.exists():
        with connect(COMMERCIAL_DB) as db:
            row = db.execute(
                "SELECT COUNT(*) AS items,COALESCE(SUM(quantity),0) AS quantity,SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active FROM commercial_inventory"
            ).fetchone()
            commercial = dict(row) if row else commercial
    return {
        "sourceAuthority": "mac_local_sqlite",
        "summary": {
            "acquisitions": int(summary["acquisitions"] or 0),
            "capitalDeployed": round(float(summary["deployed"] or 0), 2),
            "unknownCostCount": int(summary["unknown_costs"] or 0),
            "soldAcquisitions": int(summary["sold"] or 0),
            "pendingReceipt": int(summary["pending"] or 0),
            "physicalReceipts": sum(int(r["c"] or 0) for r in receipt_rows),
            "inventoryStates": {str(r["inventory_state"] or "unknown"): int(r["c"] or 0) for r in receipt_rows},
            "realizedSales": int(sale["c"] or 0),
            "realizedNet": round(float(sale["net"] or 0), 2),
            "realizedProfit": round(float(sale["profit"] or 0), 2),
            "commercialInventoryItems": int(commercial.get("items") or 0),
            "commercialInventoryQuantity": int(commercial.get("quantity") or 0),
            "commercialInventoryActive": int(commercial.get("active") or 0),
        },
        "recent": [dict(row) for row in recent],
    }


def market_truth_summary(limit: int = 40) -> dict[str, Any]:
    if not INSTACOMP_DB.exists():
        return {"sourceAuthority": "mac_local_sqlite", "summary": {}, "recent": [], "error": "InstaComp DB missing"}
    with connect(INSTACOMP_DB) as db:
        receipts = db.execute(
            """
            SELECT id,receipt_fingerprint,registry_identity_id,scan_id,trusted_market_truth,
                   student_training_eligible,pricing_authority,trusted_sold_count,trusted_suggested_price,
                   payload_json,created_at
            FROM teacher_comp_receipts ORDER BY created_at DESC LIMIT ?
            """,
            (max(1, min(limit, 200)),),
        ).fetchall()
        summary = db.execute(
            """
            SELECT COUNT(*) AS receipts,
                   SUM(CASE WHEN trusted_market_truth=1 THEN 1 ELSE 0 END) AS trusted,
                   SUM(CASE WHEN pricing_authority=1 THEN 1 ELSE 0 END) AS pricing_authority,
                   SUM(trusted_sold_count) AS trusted_sold,
                   MAX(created_at) AS latest
            FROM teacher_comp_receipts
            """
        ).fetchone()
        observations = db.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN event_class='SOLD' OR observation_type LIKE '%SOLD%' THEN 1 ELSE 0 END) AS sold,
                   SUM(CASE WHEN event_class='ACTIVE' OR observation_type LIKE '%ACTIVE%' THEN 1 ELSE 0 END) AS active,
                   SUM(CASE WHEN event_class='DECISION' THEN 1 ELSE 0 END) AS decisions
            FROM instacomp_market_observations
            """
        ).fetchone()
        scans = db.execute(
            "SELECT status,COUNT(*) AS c FROM scans GROUP BY status"
        ).fetchall()
    recent_payloads = []
    for row in receipts:
        payload = json_load(row["payload_json"], {}) or {}
        recent_payloads.append({
            "id": row["id"],
            "receiptFingerprint": row["receipt_fingerprint"],
            "registryIdentityId": row["registry_identity_id"],
            "scanId": row["scan_id"],
            "trusted": bool(row["trusted_market_truth"]),
            "trainingEligible": bool(row["student_training_eligible"]),
            "pricingAuthority": bool(row["pricing_authority"]),
            "trustedSoldCount": int(row["trusted_sold_count"] or 0),
            "suggestedPrice": row["trusted_suggested_price"],
            "createdAt": row["created_at"],
            "identity": payload.get("canonicalIdentity") or {},
            "decision": payload.get("decision"),
            "competitiveActiveLow": payload.get("competitiveActiveLow"),
            "competitiveActiveMedian": payload.get("competitiveActiveMedian"),
        })
    return {
        "sourceAuthority": "mac_local_instacomp",
        "summary": {
            "receipts": int(summary["receipts"] or 0),
            "trustedReceipts": int(summary["trusted"] or 0),
            "pricingAuthorityReceipts": int(summary["pricing_authority"] or 0),
            "trustedSoldComps": int(summary["trusted_sold"] or 0),
            "latestTruthAt": summary["latest"],
            "marketObservations": int(observations["total"] or 0),
            "soldObservations": int(observations["sold"] or 0),
            "activeObservations": int(observations["active"] or 0),
            "decisionObservations": int(observations["decisions"] or 0),
            "scanStates": {str(r["status"]): int(r["c"] or 0) for r in scans},
        },
        "recent": recent_payloads,
    }


def operations_summary(
    *,
    include_counts: bool = True,
    include_recent_runs: bool = True,
) -> dict[str, Any]:
    dh = DealHunterStore(DEAL_HUNTER_DB)
    scheduler = dh.scheduler_state()
    runs = dh.recent_runs(limit=5) if include_recent_runs else []

    specs = {
        "kingmakerControl": (CONTROL_DB, "opportunities", False),
        "kingmakerAccounting": (ACCOUNTING_DB, "acquisition_items", False),
        "dealHunter": (DEAL_HUNTER_DB, "deal_hunter_candidates", True),
        "instaComp": (INSTACOMP_DB, "scans", True),
        # Registry health should describe actual card identities, not the much
        # smaller import-receipt table.
        "checklistRegistry": (REGISTRY_DB, "checklist_registry_entries", True),
        "commercialInventory": (COMMERCIAL_DB, "commercial_inventory", False),
    }
    dbs: dict[str, dict[str, Any]] = {}
    for name, (path, table, approximate) in specs.items():
        rows = (
            database_count(path, table, approximate=approximate)
            if include_counts and path.exists()
            else None
        )
        dbs[name] = {
            "path": str(path),
            "exists": path.exists(),
            "rows": rows,
            "rowsApproximate": bool(include_counts and approximate),
        }

    services = {
        "instacomp": http_health("http://127.0.0.1:8787/health/live"),
        "sentinel": http_health("http://127.0.0.1:8794/health/live"),
        "kingmaker": {"ok": True, "detail": {"service": "kingmaker-control", "port": PORT}},
    }
    healthy = all(item.get("ok") is True for item in services.values()) and all(item.get("exists") for item in dbs.values())
    return {
        "sourceAuthority": "mac_local",
        "healthy": healthy,
        "services": services,
        "databases": dbs,
        "dealHunterScheduler": scheduler,
        "recentDealHunterRuns": runs,
        "checkedAt": now_iso(),
    }


class DecisionRequest(BaseModel):
    decision: str = Field(pattern="^(buy|make_offer|watch|pass|research|ignore)$")
    reason: str | None = Field(default=None, max_length=1000)


class PurchaseLinkRequest(BaseModel):
    purchaseReference: str = Field(min_length=1, max_length=250)


class ListingUpsertRequest(BaseModel):
    listing: dict[str, Any]
    sourceWatch: str | None = None


initialize_control_db()
app = FastAPI(title="KINGMAKER Mac Control Plane", version="1.0.0-mac")
app.include_router(build_kingmaker_accounting_router(require_api_key, ACCOUNTING_DB, INSTACOMP_DB))
app.include_router(build_kingmaker_pricing_router(require_api_key, CONTROL_DB, INSTACOMP_DB, REGISTRY_DB))


@app.get("/health/live")
def health_live() -> dict[str, Any]:
    return {"ok": True, "service": "kingmaker-control", "port": PORT, "authority": "mac_local"}


@app.get("/health")
def health() -> dict[str, Any]:
    # Health must stay lightweight. Exact/approximate row metrics belong to the
    # operations endpoint and must never delay liveness by scanning large DBs.
    result = operations_summary(include_counts=False, include_recent_runs=False)
    return {"ok": result["healthy"], "service": "kingmaker-control", "port": PORT, **result}


@app.get("/v1/kingmaker/truth-health")
def truth_health_route(x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    return truth_health()


@app.get("/v1/kingmaker/dashboard")
def dashboard(x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    truth = truth_health()
    capital = capital_summary(limit=10)
    market = market_truth_summary(limit=10)
    operations = operations_summary()
    with connect(CONTROL_DB) as db:
        rows = db.execute(
            "SELECT * FROM opportunities WHERE lifecycle_status <> 'archived' ORDER BY CASE WHEN json_extract(metadata_json,'$.actionable')=1 THEN 0 ELSE 1 END, updated_at DESC LIMIT 12"
        ).fetchall()
    return {
        "sourceAuthority": "mac_local",
        "truth": truth,
        "capital": capital["summary"],
        "marketTruth": market["summary"],
        "operations": operations,
        "opportunities": [opportunity_payload(row) for row in rows],
    }


@app.get("/v1/kingmaker/opportunities")
def opportunities(limit: int = Query(default=100, ge=1, le=500), x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    sync_deal_hunter(limit=500)
    with connect(CONTROL_DB) as db:
        rows = db.execute(
            "SELECT * FROM opportunities WHERE lifecycle_status <> 'archived' ORDER BY CASE WHEN json_extract(metadata_json,'$.actionable')=1 THEN 0 ELSE 1 END, CASE WHEN json_extract(metadata_json,'$.alertworthy')=1 THEN 0 ELSE 1 END, updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return {"sourceAuthority": "mac_local_deal_hunter", "opportunities": [opportunity_payload(row) for row in rows]}


@app.post("/v1/kingmaker/opportunities/{opportunity_id}/decision")
def decide(opportunity_id: str, request: DecisionRequest, x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    mapping = {"buy": "reviewing", "make_offer": "offer_planned", "watch": "watching", "pass": "passed", "research": "reviewing", "ignore": "passed"}
    stamp = now_iso()
    with connect(CONTROL_DB, writable=True) as db:
        row = db.execute("SELECT * FROM opportunities WHERE id=?", (opportunity_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="KINGMAKER opportunity not found")
        if request.decision == "buy" and (row["identity_status"] != "verified_exact" or row["market_status"] != "verified_completed_sales"):
            raise HTTPException(status_code=409, detail="KINGMAKER buy gate requires verified exact identity and verified completed-sale truth")
        prior = row["lifecycle_status"]
        next_status = mapping[request.decision]
        db.execute(
            "UPDATE opportunities SET owner_decision=?,owner_decision_reason=?,decision_at=?,lifecycle_status=?,updated_at=? WHERE id=?",
            (request.decision, request.reason, stamp, next_status, stamp, opportunity_id),
        )
        db.execute(
            "INSERT INTO opportunity_events(opportunity_id,event_type,actor_type,prior_status,next_status,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (opportunity_id, "owner_decision_changed", "owner", prior, next_status, request.reason, json.dumps({"decision": request.decision}), stamp),
        )
        updated = db.execute("SELECT * FROM opportunities WHERE id=?", (opportunity_id,)).fetchone()
    return {"ok": True, "opportunity": opportunity_payload(updated)}


@app.post("/v1/kingmaker/opportunities/{opportunity_id}/purchase-link")
def purchase_link(opportunity_id: str, request: PurchaseLinkRequest, x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    reference = text(request.purchaseReference)
    with connect(ACCOUNTING_DB) as adb:
        row = None
        if reference.isdigit():
            row = adb.execute("SELECT id,purchase_id FROM acquisition_items WHERE id=?", (int(reference),)).fetchone()
        if row is None:
            row = adb.execute("SELECT id,purchase_id FROM acquisition_items WHERE purchase_id=? LIMIT 1", (reference,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Mac-local acquisition reference not found")
    stamp = now_iso()
    purchase_ref = str(row["purchase_id"] or row["id"])
    with connect(CONTROL_DB, writable=True) as db:
        opportunity = db.execute("SELECT * FROM opportunities WHERE id=?", (opportunity_id,)).fetchone()
        if not opportunity:
            raise HTTPException(status_code=404, detail="KINGMAKER opportunity not found")
        if opportunity["owner_decision"] != "buy" or opportunity["identity_status"] != "verified_exact" or opportunity["market_status"] != "verified_completed_sales":
            raise HTTPException(status_code=409, detail="KINGMAKER purchase link requires an owner buy decision and passed truth gates")
        prior = opportunity["lifecycle_status"]
        db.execute("UPDATE opportunities SET purchase_reference=?,lifecycle_status='bought',updated_at=? WHERE id=?", (purchase_ref, stamp, opportunity_id))
        db.execute(
            "INSERT INTO opportunity_events(opportunity_id,event_type,actor_type,prior_status,next_status,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?)",
            (opportunity_id, "purchase_linked", "reconciliation", prior, "bought", None, json.dumps({"purchaseReference": purchase_ref}), stamp),
        )
        updated = db.execute("SELECT * FROM opportunities WHERE id=?", (opportunity_id,)).fetchone()
    return {"ok": True, "opportunity": opportunity_payload(updated)}


@app.post("/v1/kingmaker/opportunities/upsert-listing")
def upsert_listing(request: ListingUpsertRequest, x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    listing = request.listing
    source_key = text(listing.get("sourceKey") or listing.get("externalListingId") or listing.get("directUrl"))
    if not source_key:
        raise HTTPException(status_code=400, detail="Listing requires a source key or URL")
    oid = candidate_opportunity_id(source_key)
    stamp = now_iso()
    with connect(CONTROL_DB, writable=True) as db:
        existing = db.execute("SELECT * FROM opportunities WHERE source_key=?", (source_key,)).fetchone()
        first_seen = existing["first_seen_at"] if existing else stamp
        lifecycle = existing["lifecycle_status"] if existing else "new"
        db.execute(
            """
            INSERT INTO opportunities(id,source_type,source_key,source_watch,title,direct_url,marketplace,seller_name,asking_price,shipping_price,buyer_fee,delivered_cost,identity_status,market_status,lifecycle_status,owner_decision,owner_decision_reason,decision_at,purchase_reference,first_seen_at,last_seen_at,identity_json,exact_market_json,metadata_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(source_key) DO UPDATE SET source_watch=excluded.source_watch,title=excluded.title,direct_url=excluded.direct_url,marketplace=excluded.marketplace,seller_name=excluded.seller_name,asking_price=excluded.asking_price,shipping_price=excluded.shipping_price,buyer_fee=excluded.buyer_fee,delivered_cost=excluded.delivered_cost,identity_status=excluded.identity_status,market_status=excluded.market_status,last_seen_at=excluded.last_seen_at,identity_json=excluded.identity_json,exact_market_json=excluded.exact_market_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
            """,
            (oid,text(listing.get("sourceType")) or "other",source_key,request.sourceWatch,text(listing.get("title")) or "Untitled opportunity",text(listing.get("directUrl")) or None,text(listing.get("marketplace")) or None,text(listing.get("sellerName")) or None,number(listing.get("askingPrice")),number(listing.get("shippingPrice")),number(listing.get("buyerFee")),number(listing.get("deliveredCost")),text(listing.get("identityStatus")) or "review_required",text(listing.get("marketStatus")) or "unverified",lifecycle,existing["owner_decision"] if existing else None,existing["owner_decision_reason"] if existing else None,existing["decision_at"] if existing else None,existing["purchase_reference"] if existing else None,first_seen,stamp,json.dumps(listing.get("identity") or {},sort_keys=True,default=str),json.dumps(listing.get("exactMarket") or {},sort_keys=True,default=str),json.dumps(listing.get("metadata") or {},sort_keys=True,default=str),first_seen,stamp)
        )
        row = db.execute("SELECT * FROM opportunities WHERE source_key=?", (source_key,)).fetchone()
    return {"ok": True, "opportunity": opportunity_payload(row)}


@app.get("/v1/kingmaker/capital")
def capital(limit: int = Query(default=50, ge=1, le=200), x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    return capital_summary(limit=limit)


@app.get("/v1/kingmaker/market-truth")
def market_truth(limit: int = Query(default=40, ge=1, le=200), x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    return market_truth_summary(limit=limit)


@app.get("/v1/kingmaker/operations")
def operations(x_instacomp_ai_key: str | None = Header(default=None)):
    require_api_key(x_instacomp_ai_key)
    return operations_summary()
