from __future__ import annotations

from pathlib import Path
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Query

from .storage import MemoryStore
from .training import export_training_dataset, training_readiness


def build_training_router(
    require_api_key: Callable,
    store: MemoryStore,
    *,
    image_store_path: Path,
    training_export_path: Path,
) -> APIRouter:
    router = APIRouter(
        prefix="/v1/training",
        tags=["training"],
        dependencies=[Depends(require_api_key)],
    )

    @router.get("/readiness")
    async def readiness():
        return training_readiness(store.list_training_examples(trusted_only=True))

    @router.get("/examples")
    async def examples(
        trusted_only: bool = Query(default=True),
        limit: int = Query(default=100, ge=1, le=2000),
    ):
        rows = store.list_training_examples(
            trusted_only=trusted_only,
            limit=limit,
        )
        return {
            "schema_version": "tcos.instacomp-ai.training-examples.v1",
            "count": len(rows),
            "examples": [row.model_dump(mode="json") for row in rows],
        }

    @router.post("/export")
    async def export(
        validation_percent: int = Query(default=15, ge=0, le=50),
    ):
        examples = store.list_training_examples(trusted_only=True, limit=100_000)
        if not examples:
            raise HTTPException(
                status_code=409,
                detail="No trusted training examples exist yet.",
            )
        try:
            return export_training_dataset(
                examples,
                image_store_path=image_store_path,
                destination_root=training_export_path,
                validation_percent=validation_percent,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
