from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
import json
import os
import subprocess
import sys
import shutil

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .kingmaker_accounting import KingmakerAccounting
from .kingmaker_manual_purchases import KingmakerManualPurchases
from .kingmaker_commercial_inventory import KingmakerCommercialInventory, fetch_ebay_seller_snapshot


class PurchaseMatchRequest(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(min_length=1, max_length=200)
    identity: dict[str, Any] = Field(default_factory=dict)


class PurchaseReceiveRequest(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(default="", max_length=200)
    acquisition_item_id: int = Field(gt=0)
    disposition: str = Field(pattern="^(resale|investment_stash)$")


class PurchaseLinkExistingRequest(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(default="", max_length=200)
    acquisition_item_id: int = Field(gt=0)
    disposition: str = Field(default="resale", pattern="^(resale|investment_stash)$")


class EbayBridgeRequest(BaseModel):
    mode: str = Field(default="readiness", pattern="^(readiness|publish|revise|verify|oauth_exchange|inventory_snapshot)$")
    item: dict[str, Any] | None = None
    revision: dict[str, Any] | None = None
    verification: dict[str, Any] | None = None
    code: str | None = Field(default=None, max_length=4096)
    redirect_uri: str | None = Field(default=None, max_length=512)
    confirmation: str | None = Field(default=None, max_length=64)


class MercariBridgeRequest(BaseModel):
    mode: str = Field(default="status", pattern="^(status|draft|publish)$")
    item: dict[str, Any] | None = None


def _run_local_mercari_bridge(payload: dict[str, Any]) -> dict[str, Any]:
    repo_root = Path(__file__).resolve().parents[3]
    runner = repo_root / "services/instacomp-ai/scripts/kingmaker_mercari_publish.py"
    python_binary = sys.executable if Path(sys.executable).exists() else (shutil.which("python3") or "/opt/homebrew/bin/python3")
    if not runner.exists():
        raise ValueError("The Mac-local KINGMAKER Mercari runner is missing")
    if not Path(python_binary).exists():
        raise ValueError("The Mac-local Python runtime required for Mercari publishing is unavailable")
    try:
        completed = subprocess.run([python_binary, str(runner)], cwd=repo_root, input=json.dumps(payload), capture_output=True, text=True, timeout=240, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("The Mac-local Mercari publisher timed out") from exc
    raw = str(completed.stdout or "").strip()
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise ValueError("The Mac-local Mercari publisher returned invalid output") from exc
    if completed.returncode != 0 or data.get("ok") is not True:
        detail = str(data.get("error") or "").strip()
        stderr = str(completed.stderr or "").strip()
        if not detail and stderr:
            detail = stderr[-2000:]
        raise ValueError(detail or f"The Mac-local Mercari publisher failed (exit {completed.returncode})")
    return data


def _run_local_ebay_bridge(payload: dict[str, Any]) -> dict[str, Any]:
    # The Inventory API collection listing can reject legacy seller SKUs that
    # predate KINGMAKER's SKU rules. For a read-only snapshot, use the proven
    # Trading API seller-list reader which covers legacy and modern listings
    # without mutating eBay. Publish/revise/readiness still use the strict local
    # Inventory API bridge.
    if str(payload.get("mode") or "").strip() == "inventory_snapshot":
        snapshot = fetch_ebay_seller_snapshot()
        return {"ok": True, "mode": "inventory_snapshot", "snapshot": snapshot}
    repo_root = Path(__file__).resolve().parents[3]
    runner = repo_root / "services/instacomp-ai/scripts/kingmaker_ebay_publish.ts"
    local_env = Path.home() / "Library/Application Support/TCOS-Current-Review/.env.local"
    node_shims = repo_root / "services/instacomp-ai/node-shims"
    if not runner.exists():
        raise ValueError("The Mac-local KINGMAKER eBay runner is missing")
    if not local_env.exists():
        raise ValueError("The Mac-local TCOS production environment is unavailable")
    env = os.environ.copy()
    env["NODE_PATH"] = os.pathsep.join(
        [str(node_shims), str(repo_root / "node_modules"), str(env.get("NODE_PATH") or "")]
    ).rstrip(os.pathsep)
    node_binary = shutil.which("node") or "/opt/homebrew/bin/node"
    if not Path(node_binary).exists():
        raise ValueError("The Mac-local Node runtime required for eBay publishing is unavailable")
    command = [
        node_binary,
        "--conditions=react-server",
        f"--env-file={local_env}",
        "--import",
        "tsx",
        str(runner),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=repo_root,
            env=env,
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("The Mac-local eBay publisher timed out") from exc
    raw = str(completed.stdout or "").strip()
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        raise ValueError("The Mac-local eBay publisher returned invalid output") from exc
    if completed.returncode != 0 or data.get("ok") is not True:
        detail = str(data.get("error") or "The Mac-local eBay publisher failed")
        raise ValueError(detail)
    return data


class CommercialInventoryRequest(BaseModel):
    action: str = Field(default="list", pattern="^(list|get|find_image_pair|refresh|create|update|project_master|project_master_reset|master_list)$")
    items: list[dict[str, Any]] = Field(default_factory=list, max_length=1000)


class InventoryDispositionRequest(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=200)
    disposition: str = Field(pattern="^(resale|investment_stash)$")


class InventoryTruthRequest(BaseModel):
    inventory_item_ids: list[str] = Field(default_factory=list, max_length=1000)


class ListingReadinessRequest(BaseModel):
    inventory_item_ids: list[str] = Field(default_factory=list, max_length=500)


class PurchaseMatchBulkItem(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(min_length=1, max_length=200)
    identity: dict[str, Any] = Field(default_factory=dict)


class PurchaseMatchBulkRequest(BaseModel):
    items: list[PurchaseMatchBulkItem] = Field(default_factory=list, max_length=500)


class PendingPurchasesRequest(BaseModel):
    cutoff: str = Field(default="2026-09-16", max_length=40)


class PurchaseIntakeSyncRequest(BaseModel):
    cutoff: str = Field(default="2026-09-16T00:00:00-06:00", max_length=40)


class ManualPurchaseDraftCard(BaseModel):
    id: str | None = Field(default=None, max_length=200)
    title: str | None = Field(default=None, max_length=500)
    identity: dict[str, Any] = Field(default_factory=dict)
    card_uuid: str | None = Field(default=None, max_length=200)
    scan_id: str | None = Field(default=None, max_length=200)
    inventory_item_id: str | None = Field(default=None, max_length=200)
    allocated_cost: float | None = Field(default=None, ge=0)
    individual_cost_exact: bool = False


class ManualPurchaseDraftRequest(BaseModel):
    lot_id: str | None = Field(default=None, max_length=200)
    mode: str = Field(default="single", pattern="^(single|lot)$")
    source: str = Field(default="Misc", max_length=120)
    purchased_at: str | None = Field(default=None, max_length=80)
    seller: str | None = Field(default=None, max_length=240)
    order_number: str | None = Field(default=None, max_length=240)
    reference_text: str | None = Field(default=None, max_length=1000)
    total_cost: float = Field(gt=0)
    notes: str | None = Field(default=None, max_length=5000)
    cards: list[ManualPurchaseDraftCard] = Field(min_length=1, max_length=250)
    actor: str = Field(default="seller", max_length=200)


class ManualPurchaseConfirmRequest(BaseModel):
    lot_id: str = Field(min_length=1, max_length=200)
    allocation_method: str = Field(default="equal_split", pattern="^(equal_split|manual)$")
    disposition: str = Field(default="resale", pattern="^(resale|investment_stash)$")
    actor: str = Field(default="seller", max_length=200)


def build_kingmaker_accounting_router(
    require_api_key: Callable,
    database_path: Path,
    scan_database_path: Path,
):
    router = APIRouter(
        prefix="/v1/kingmaker/accounting",
        tags=["kingmaker-accounting"],
        dependencies=[Depends(require_api_key)],
    )
    accounting = KingmakerAccounting(database_path, scan_database_path)
    accounting.initialize()
    manual_purchases = KingmakerManualPurchases(database_path, scan_database_path)
    manual_purchases.initialize()
    commercial_inventory = KingmakerCommercialInventory(database_path.with_name("kingmaker_commercial_inventory.sqlite3"))
    commercial_inventory.initialize()


    @router.post("/pending-purchases")
    def pending_purchases(request: PendingPurchasesRequest):
        try:
            rows = accounting.pending_purchases(request.cutoff or "2026-09-16")
            return {
                "ok": True,
                "cutoff": request.cutoff,
                "items": rows,
                "summary": {
                    "totalTracked": len(rows),
                    "awaitingOwnScan": sum(1 for row in rows if row.get("awaitingOwnScan")),
                    "matchedPendingReceipt": sum(1 for row in rows if row.get("receiptStatus") == "pending_purchase"),
                    "received": sum(1 for row in rows if row.get("status") in {"received", "linked_existing"}),
                },
            }
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/purchase-intake-sync")
    def purchase_intake_sync(request: PurchaseIntakeSyncRequest):
        runner = Path(__file__).resolve().parents[1] / "scripts" / "kingmaker_purchase_intake.py"
        if not runner.exists():
            raise HTTPException(status_code=500, detail="KINGMAKER purchase-intake worker is missing")
        try:
            completed = subprocess.run(
                [sys.executable, str(runner), "--cutoff", request.cutoff, "--scan-db", str(scan_database_path), "--accounting-db", str(database_path)],
                cwd=Path(__file__).resolve().parents[3], capture_output=True, text=True, timeout=360, check=False,
            )
            raw = str(completed.stdout or "").strip()
            payload = json.loads(raw) if raw else {}
            if completed.returncode != 0:
                raise ValueError(str(payload.get("error") or completed.stderr or f"exit {completed.returncode}")[-2000:])
            return payload
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(status_code=504, detail="KINGMAKER purchase intake timed out") from exc
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/manual-purchase-draft")
    def manual_purchase_draft(request: ManualPurchaseDraftRequest):
        try:
            payload = request.model_dump()
            lot = manual_purchases.upsert_draft(payload, actor=request.actor)
            return {"ok": True, "lot": lot}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/manual-purchase-evidence")
    async def manual_purchase_evidence(
        lot_id: str = Form(...),
        evidence_kind: str = Form(default="receipt"),
        draft_card_id: str | None = Form(default=None),
        actor: str = Form(default="seller"),
        file: UploadFile = File(...),
    ):
        try:
            content = await file.read()
            evidence = manual_purchases.store_evidence(
                lot_id,
                content,
                file.filename or "evidence",
                file.content_type,
                evidence_kind,
                draft_card_id=draft_card_id,
                actor=actor,
            )
            return {"ok": True, "evidence": evidence}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        finally:
            await file.close()

    @router.post("/manual-purchase-confirm")
    def manual_purchase_confirm(request: ManualPurchaseConfirmRequest):
        try:
            result = manual_purchases.confirm_lot(
                request.lot_id,
                allocation_method=request.allocation_method,
                actor=request.actor,
            )
            links = []
            for acquisition in result.get("acquisitions", []):
                inventory_item_id = str(acquisition.get("inventoryItemId") or "").strip()
                scan_id = str(acquisition.get("scanId") or "").strip()
                if not inventory_item_id or not scan_id:
                    continue
                try:
                    linked = accounting.attach_manual_purchase_to_existing_inventory(
                        str(acquisition.get("cardUuid") or ""),
                        inventory_item_id,
                        int(acquisition["acquisitionItemId"]),
                        scan_id,
                        request.disposition,
                    )
                    links.append({
                        "inventoryItemId": inventory_item_id,
                        "acquisitionItemId": acquisition["acquisitionItemId"],
                        "success": True,
                        **linked,
                    })
                except Exception as exc:
                    links.append({
                        "inventoryItemId": inventory_item_id,
                        "acquisitionItemId": acquisition.get("acquisitionItemId"),
                        "success": False,
                        "error": str(exc),
                    })
            return {"ok": True, **result, "existingInventoryLinks": links}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/purchase-match")
    def purchase_match(request: PurchaseMatchRequest):
        try:
            result = accounting.match_or_reserve_purchase(
                request.identity,
                request.card_uuid,
                request.inventory_item_id,
                request.scan_id,
            )
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/purchase-match-bulk")
    def purchase_match_bulk(request: PurchaseMatchBulkRequest):
        results = []
        for item in request.items:
            result = accounting.match_or_reserve_purchase(
                item.identity, item.card_uuid, item.inventory_item_id, item.scan_id
            )
            results.append({
                "cardUuid": item.card_uuid,
                "inventoryItemId": item.inventory_item_id,
                "scanId": item.scan_id,
                **result,
            })
        return {"ok": True, "results": results}

    @router.post("/receive")
    def receive_purchase(request: PurchaseReceiveRequest):
        try:
            result = accounting.receive_into_inventory(
                request.card_uuid,
                request.inventory_item_id,
                request.acquisition_item_id,
                request.scan_id,
                request.disposition,
            )
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/link-existing")
    def link_existing_purchase(request: PurchaseLinkExistingRequest):
        try:
            result = accounting.link_purchase_to_existing_inventory(
                request.card_uuid,
                request.inventory_item_id,
                request.acquisition_item_id,
                request.scan_id,
                request.disposition,
            )
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/ebay-bridge")
    def ebay_bridge(request: EbayBridgeRequest):
        try:
            required_confirmation = {
                "publish": "PUBLISH_LIVE",
                "revise": "REVISE_LIVE",
            }.get(request.mode)
            if required_confirmation and request.confirmation != required_confirmation:
                raise HTTPException(
                    status_code=409,
                    detail=f"Explicit {required_confirmation} confirmation is required for live eBay mutation.",
                )
            result = _run_local_ebay_bridge({
                "mode": request.mode,
                "item": request.item,
                "revision": request.revision,
                "verification": request.verification,
                "code": request.code,
                "redirectUri": request.redirect_uri,
                "confirmation": request.confirmation,
            })
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


    @router.post("/mercari-bridge")
    def mercari_bridge(request: MercariBridgeRequest):
        try:
            result = _run_local_mercari_bridge({"mode": request.mode, "item": request.item})
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


    @router.post("/commercial-inventory")
    def commercial_inventory_route(request: CommercialInventoryRequest):
        try:
            if request.action in {"project_master", "project_master_reset"}:
                result = commercial_inventory.project_master_listings(
                    request.items,
                    replace=request.action == "project_master_reset",
                )
                return {"ok": True, **result}

            if request.action == "master_list":
                options = request.items[0] if request.items else {}
                folder = str(options.get("folder") or "").strip() or None
                pending_queue = str(options.get("pendingQueue") or "").strip() or None
                compact = str(options.get("compact") or "").strip().lower() in {
                    "1",
                    "true",
                    "yes",
                }
                result = commercial_inventory.list_master_listing_projection(
                    folder=folder,
                    pending_queue=pending_queue,
                    compact=compact,
                )
                return {"ok": True, **result}
            if request.action in {"list", "refresh"}:
                items = commercial_inventory.list_items()
                snapshot: dict[str, Any] | None = None
                if request.action == "refresh" or not items:
                    snapshot = fetch_ebay_seller_snapshot()
                    listings = snapshot.get("listings") if isinstance(snapshot.get("listings"), list) else []
                    commercial_inventory.absorb_ebay_snapshot(
                        listings,
                        str(snapshot.get("syncedAt") or "").strip() or None,
                    )
                    items = commercial_inventory.list_items()
                latest_sync = max(
                    (str(item.get("updatedAt") or "") for item in items),
                    default="",
                ) or None
                return {
                    "ok": True,
                    "sourceOfTruth": "mac_local",
                    "items": items,
                    "summary": {
                        "totalItems": len(items),
                        "totalQuantity": sum(max(0, int(item.get("quantity") or 0)) for item in items),
                        "activeCount": sum(1 for item in items if item.get("status") == "active"),
                        "draftCount": sum(1 for item in items if item.get("status") == "draft"),
                        "archivedCount": sum(1 for item in items if item.get("status") == "archived"),
                        "storeOwnedCount": len(items),
                    },
                    "ebaySnapshot": {
                        "listingCount": int(snapshot.get("listingCount") or len(items)) if snapshot else len(items),
                        "syncedAt": snapshot.get("syncedAt") if snapshot else latest_sync,
                        "refreshed": snapshot is not None,
                    },
                }

            if request.action == "create":
                created_items: list[dict[str, Any]] = []
                for draft in request.items:
                    created = commercial_inventory.create_local_draft(draft)
                    created_items.append(created)
                return {
                    "ok": True,
                    "sourceOfTruth": "mac_local",
                    "success": True,
                    "summary": {
                        "requestedCount": len(request.items),
                        "processedCount": len(created_items),
                        "successCount": len(created_items),
                        "failureCount": 0,
                    },
                    "items": created_items,
                    "results": [
                        {
                            "inventoryItemId": item.get("inventoryItemId"),
                            "legacyProductId": None,
                            "success": True,
                            "status": 201,
                            "message": "Mac-local KINGMAKER draft saved.",
                        }
                        for item in created_items
                    ],
                }

            results: list[dict[str, Any]] = []
            for edit in request.items:
                inventory_item_id = str(edit.get("inventoryItemId") or "").strip()
                current = commercial_inventory.get_item(inventory_item_id) if inventory_item_id else None
                if current is None:
                    results.append({
                        "inventoryItemId": inventory_item_id,
                        "legacyProductId": None,
                        "success": False,
                        "status": 404,
                        "message": "Mac-local commercial inventory item was not found.",
                    })
                    continue
                update_ebay = edit.get("updateEbay") is True
                try:
                    requested_status = str(edit.get("status", current.get("status") or "draft"))
                    if update_ebay and requested_status != "active":
                        raise ValueError("Use the dedicated channel lifecycle control to end/archive an eBay listing; in-place eBay revision requires active status.")
                    if update_ebay:
                        if str(edit.get("confirmation") or "") != "REVISE_LIVE":
                            raise ValueError("Explicit REVISE_LIVE confirmation is required for live eBay mutation.")
                        _run_local_ebay_bridge({
                            "mode": "revise",
                            "confirmation": "REVISE_LIVE",
                            "revision": {
                                "sku": current.get("sku"),
                                "listingId": current.get("ebayItemId"),
                                "title": edit.get("title", current.get("title")),
                                "description": edit.get("description", current.get("description")),
                                "quantity": edit.get("quantity", current.get("quantity")),
                                "price": edit.get("price", current.get("price")),
                            },
                        })
                    commercial_inventory.apply_local_edit(inventory_item_id, edit, update_ebay)
                    results.append({
                        "inventoryItemId": inventory_item_id,
                        "legacyProductId": None,
                        "success": True,
                        "status": 200,
                        "message": (
                            "Mac-local inventory saved and the existing eBay listing was updated in place."
                            if update_ebay
                            else "Mac-local inventory saved."
                        ),
                    })
                except Exception as exc:
                    results.append({
                        "inventoryItemId": inventory_item_id,
                        "legacyProductId": None,
                        "success": False,
                        "status": 502 if update_ebay else 400,
                        "message": str(exc),
                    })
            success_count = sum(1 for result in results if result.get("success") is True)
            return {
                "ok": True,
                "sourceOfTruth": "mac_local",
                "success": success_count == len(results),
                "summary": {
                    "requestedCount": len(request.items),
                    "processedCount": len(results),
                    "successCount": success_count,
                    "failureCount": len(results) - success_count,
                },
                "results": results,
            }
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/inventory-truth")
    def inventory_truth(request: InventoryTruthRequest):
        try:
            result = accounting.inventory_truth(request.inventory_item_ids)
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


    @router.post("/listing-readiness")
    def listing_readiness(request: ListingReadinessRequest):
        try:
            result = accounting.listing_readiness(request.inventory_item_ids)
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/pending-receipts")
    def pending_receipts(cutoff_date: str = "2026-09-16"):
        try:
            result = accounting.pending_receipts(cutoff_date)
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/inventory-disposition")
    def inventory_disposition(request: InventoryDispositionRequest):
        try:
            result = accounting.set_inventory_disposition(
                request.inventory_item_id, request.disposition
            )
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
