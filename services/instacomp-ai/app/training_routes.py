from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .deal_hunter_learning import (
    candidate_policy_receipt,
    decision_learning_manifest,
    initialize_decision_learning,
    load_decision_lessons,
    record_decision_learning_event,
)
from .storage import MemoryStore
from .teacher_comp_learning import (
    initialize_teacher_comp_learning,
    load_teacher_comp_receipts,
    record_teacher_comp_receipt,
    teacher_comp_learning_stats,
)
from .teacher_comp_training import (
    export_teacher_comp_training_dataset,
    teacher_comp_training_readiness,
)
from .training import export_training_dataset, training_readiness

ALLOWED_DEAL_HUNTER_FEEDBACK = {
    "BUY", "PASS", "TOO_MUCH", "TOO_MUCH_SHIPPING", "PASS_TOO_MUCH_SHIPPING",
    "WRONG_IDENTITY", "WRONG_PARALLEL", "HIDDEN_GEM", "NOT_AVAILABLE",
    "BAD_CONDITION", "VARIANT_PRICE_WRONG",
}


def build_training_router(require_api_key: Callable, store: MemoryStore, *, image_store_path: Path, training_export_path: Path) -> APIRouter:
    initialize_decision_learning(store.path)
    initialize_teacher_comp_learning(store.path)
    router = APIRouter(prefix="/v1/training", tags=["training"], dependencies=[Depends(require_api_key)])

    @router.get("/readiness")
    async def readiness():
        result = training_readiness(store.list_training_examples(trusted_only=True))
        lessons = load_decision_lessons(store.path)
        teacher_receipts = load_teacher_comp_receipts(store.path, limit=2000)
        result["deal_hunter_decision_learning"] = {
            "policy": decision_learning_manifest(),
            "persisted_trusted_lessons": len(lessons),
            "feedback_storage": "deal_hunter_learning_events",
            "identity_training_separated": True,
        }
        result["teacher_comp_learning"] = {
            **teacher_comp_learning_stats(store.path),
            "dataset": teacher_comp_training_readiness(teacher_receipts),
        }
        return result

    @router.get("/examples")
    async def examples(trusted_only: bool = Query(default=True), limit: int = Query(default=100, ge=1, le=2000)):
        rows = store.list_training_examples(trusted_only=trusted_only, limit=limit)
        return {"schema_version": "tcos.instacomp-ai.training-examples.v1", "count": len(rows), "examples": [row.model_dump(mode="json") for row in rows]}

    @router.get("/teacher-comp-receipts")
    async def teacher_comp_receipts(limit: int = Query(default=100, ge=1, le=2000)):
        rows = load_teacher_comp_receipts(store.path, limit=limit)
        return {
            "schema_version": "tcos.instacomp-ai.teacher-comp-receipts.v1",
            "count": len(rows),
            "student_mode": True,
            "pricing_authority": False,
            "identity_training_mutation_allowed": False,
            "receipts": rows,
        }

    @router.post("/teacher-comp-receipt")
    async def teacher_comp_receipt(body: dict[str, Any] = Body(...)):
        try:
            return record_teacher_comp_receipt(store.path, body)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/teacher-comp-export")
    async def teacher_comp_export(validation_percent: int = Query(default=15, ge=0, le=50)):
        rows = load_teacher_comp_receipts(store.path, limit=2000)
        try:
            return export_teacher_comp_training_dataset(
                rows,
                destination_root=training_export_path,
                validation_percent=validation_percent,
            )
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.get("/deal-hunter/lessons")
    async def deal_hunter_lessons():
        lessons = load_decision_lessons(store.path)
        return {"schema_version": "tcos.instacomp-ai.deal-hunter-lessons.v1", "policy": decision_learning_manifest(), "count": len(lessons), "lessons": lessons}

    @router.post("/deal-hunter/policy-receipt")
    async def deal_hunter_policy_receipt(listing: dict[str, Any] = Body(...)):
        return candidate_policy_receipt(listing)

    @router.post("/deal-hunter/feedback")
    async def deal_hunter_feedback(body: dict[str, Any] = Body(...)):
        event_type = str(body.get("eventType") or body.get("event_type") or "").strip().upper()
        if event_type not in ALLOWED_DEAL_HUNTER_FEEDBACK:
            raise HTTPException(status_code=400, detail="eventType must be one of: " + ", ".join(sorted(ALLOWED_DEAL_HUNTER_FEEDBACK)))
        candidate_key = str(body.get("candidateKey") or body.get("candidate_key") or "").strip() or None
        payload = body.get("payload")
        if payload is None:
            payload = {k: v for k, v in body.items() if k not in {"eventType", "event_type", "candidateKey", "candidate_key"}}
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="payload must be an object")
        record_decision_learning_event(store.path, event_type=event_type, candidate_key=candidate_key, payload=payload, trusted=True)
        return {"ok": True, "schema_version": "tcos.instacomp-ai.deal-hunter-feedback.v1", "event_type": event_type, "candidate_key": candidate_key, "trusted": True, "identity_training_mutated": False}

    @router.post("/export")
    async def export(validation_percent: int = Query(default=15, ge=0, le=50)):
        examples = store.list_training_examples(trusted_only=True, limit=100_000)
        if not examples:
            raise HTTPException(status_code=409, detail="No trusted training examples exist yet.")
        try:
            return export_training_dataset(examples, image_store_path=image_store_path, destination_root=training_export_path, validation_percent=validation_percent)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router
