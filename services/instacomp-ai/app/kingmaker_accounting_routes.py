from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .kingmaker_accounting import KingmakerAccounting


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
