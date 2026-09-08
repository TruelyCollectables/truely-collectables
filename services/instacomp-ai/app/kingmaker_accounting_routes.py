from __future__ import annotations

from pathlib import Path
from typing import Any, Callable
import json
import os
import subprocess
import shutil

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .kingmaker_accounting import KingmakerAccounting
from .kingmaker_commercial_inventory import KingmakerCommercialInventory, fetch_ebay_seller_snapshot


class PurchaseMatchRequest(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(min_length=1, max_length=200)
    identity: dict[str, Any] = Field(default_factory=dict)


class PurchaseReceiveRequest(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(min_length=1, max_length=200)
    acquisition_item_id: int = Field(gt=0)
    disposition: str = Field(pattern="^(resale|investment_stash)$")


class PurchaseLinkExistingRequest(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(min_length=1, max_length=200)
    acquisition_item_id: int = Field(gt=0)
    disposition: str = Field(default="resale", pattern="^(resale|investment_stash)$")


class EbayBridgeRequest(BaseModel):
    mode: str = Field(default="readiness", pattern="^(readiness|publish|revise|oauth_exchange|inventory_snapshot)$")
    item: dict[str, Any] | None = None
    revision: dict[str, Any] | None = None
    code: str | None = Field(default=None, max_length=4096)
    redirect_uri: str | None = Field(default=None, max_length=512)


def _run_local_ebay_bridge(payload: dict[str, Any]) -> dict[str, Any]:
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
    action: str = Field(default="list", pattern="^(list|update)$")
    items: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


class InventoryDispositionRequest(BaseModel):
    inventory_item_id: str = Field(min_length=1, max_length=200)
    disposition: str = Field(pattern="^(resale|investment_stash)$")


class ListingReadinessRequest(BaseModel):
    inventory_item_ids: list[str] = Field(default_factory=list, max_length=500)


class PurchaseMatchBulkItem(BaseModel):
    card_uuid: str = Field(default="", max_length=200)
    inventory_item_id: str = Field(min_length=1, max_length=200)
    scan_id: str = Field(min_length=1, max_length=200)
    identity: dict[str, Any] = Field(default_factory=dict)


class PurchaseMatchBulkRequest(BaseModel):
    items: list[PurchaseMatchBulkItem] = Field(default_factory=list, max_length=500)


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
    commercial_inventory = KingmakerCommercialInventory(database_path.with_name("kingmaker_commercial_inventory.sqlite3"))
    commercial_inventory.initialize()

    @router.post("/purchase-match")
    async def purchase_match(request: PurchaseMatchRequest):
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
    async def purchase_match_bulk(request: PurchaseMatchBulkRequest):
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
    async def receive_purchase(request: PurchaseReceiveRequest):
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
    async def link_existing_purchase(request: PurchaseLinkExistingRequest):
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
    async def ebay_bridge(request: EbayBridgeRequest):
        try:
            result = _run_local_ebay_bridge({
                "mode": request.mode,
                "item": request.item,
                "revision": request.revision,
                "code": request.code,
                "redirectUri": request.redirect_uri,
            })
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


    @router.post("/commercial-inventory")
    async def commercial_inventory_route(request: CommercialInventoryRequest):
        try:
            if request.action == "list":
                snapshot = fetch_ebay_seller_snapshot()
                listings = snapshot.get("listings") if isinstance(snapshot.get("listings"), list) else []
                commercial_inventory.absorb_ebay_snapshot(
                    listings,
                    str(snapshot.get("syncedAt") or "").strip() or None,
                )
                items = commercial_inventory.list_items()
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
                        "listingCount": int(snapshot.get("listingCount") or 0),
                        "syncedAt": snapshot.get("syncedAt"),
                    },
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
                        _run_local_ebay_bridge({
                            "mode": "revise",
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

    @router.post("/listing-readiness")
    async def listing_readiness(request: ListingReadinessRequest):
        try:
            result = accounting.listing_readiness(request.inventory_item_ids)
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/inventory-disposition")
    async def inventory_disposition(request: InventoryDispositionRequest):
        try:
            result = accounting.set_inventory_disposition(
                request.inventory_item_id, request.disposition
            )
            return {"ok": True, **result}
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
